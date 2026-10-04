package dev.circuitgate.account;

import java.time.Duration;

import dev.circuitgate.config.CircuitGateProperties;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ThrottlingService {

	private static final String LOGIN = "LOGIN";

	private static final String ACCOUNT = "ACCOUNT";

	private static final String SOURCE = "SOURCE";

	private final JdbcTemplate jdbc;

	private final CircuitGateProperties properties;

	public ThrottlingService(JdbcTemplate jdbc, CircuitGateProperties properties) {
		this.jdbc = jdbc;
		this.properties = properties;
	}

	@Transactional(readOnly = true)
	public boolean isLoginBlocked(String email, String source) {
		Integer blocked = jdbc.queryForObject("""
				select count(*) from throttle_counters
				where action = 'LOGIN'
				  and blocked_until > now()
				  and ((scope = 'ACCOUNT' and subject = ?) or (scope = 'SOURCE' and subject = ?))
				""", Integer.class, email, source);
		return blocked != null && blocked > 0;
	}

	@Transactional
	public void recordLoginFailure(String email, String source) {
		int accountFailures = incrementLoginCounter(ACCOUNT, email);
		int sourceFailures = incrementLoginCounter(SOURCE, source);
		applyBackoff(ACCOUNT, email, accountFailures);
		applyBackoff(SOURCE, source, sourceFailures);
	}

	@Transactional
	public void recordLoginSuccess(String email, String source) {
		jdbc.update("""
				delete from throttle_counters
				where action = 'LOGIN'
				  and ((scope = 'ACCOUNT' and subject = ?) or (scope = 'SOURCE' and subject = ?))
				""", email, source);
	}

	@Transactional
	public boolean tryAcquire(String action, String email, String source, int max, Duration window) {
		boolean accountAllowed = acquireFixedWindow(action, ACCOUNT, email, max, window);
		boolean sourceAllowed = acquireFixedWindow(action, SOURCE, source, max, window);
		return accountAllowed && sourceAllowed;
	}

	@Scheduled(cron = "${circuitgate.throttle.cleanup-cron:0 45 3 * * *}")
	@Transactional
	public void purgeStaleCounters() {
		jdbc.update("delete from throttle_counters where updated_at < now() - interval '1 day'");
	}

	private int incrementLoginCounter(String scope, String subject) {
		Integer failures = jdbc.queryForObject("""
				insert into throttle_counters (scope, action, subject, failures, window_start, updated_at)
				values (?, 'LOGIN', ?, 1, now(), now())
				on conflict (scope, action, subject) do update
				  set failures = throttle_counters.failures + 1,
				      updated_at = now()
				returning failures
				""", Integer.class, scope, subject);
		return failures == null ? 1 : failures;
	}

	private void applyBackoff(String scope, String subject, int failures) {
		int threshold = properties.getThrottle().getLogin().getThreshold();
		if (failures < threshold) {
			return;
		}
		long baseMillis = properties.getThrottle().getLogin().getBaseDelay().toMillis();
		long maxMillis = properties.getThrottle().getLogin().getMaxDelay().toMillis();
		int exponent = Math.min(failures - threshold, 30);
		long delayMillis = Math.min(maxMillis, baseMillis << exponent);
		jdbc.update("""
				update throttle_counters
				set blocked_until = now() + (? * interval '1 millisecond'),
				    updated_at = now()
				where scope = ? and action = 'LOGIN' and subject = ?
				""", delayMillis, scope, subject);
	}

	private boolean acquireFixedWindow(String action, String scope, String subject, int max, Duration window) {
		long windowMillis = window.toMillis();
		Integer failures = jdbc.queryForObject("""
				insert into throttle_counters (scope, action, subject, failures, window_start, updated_at)
				values (?, ?, ?, 1, now(), now())
				on conflict (scope, action, subject) do update
				  set failures = case
				        when throttle_counters.window_start < now() - (? * interval '1 millisecond') then 1
				        else throttle_counters.failures + 1
				      end,
				      window_start = case
				        when throttle_counters.window_start < now() - (? * interval '1 millisecond') then now()
				        else throttle_counters.window_start
				      end,
				      blocked_until = null,
				      updated_at = now()
				returning failures
				""", Integer.class, scope, action, subject, windowMillis, windowMillis);
		return failures == null || failures <= max;
	}
}
