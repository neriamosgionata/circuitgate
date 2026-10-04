package dev.circuitgate.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;

@ConfigurationProperties(prefix = "circuitgate")
public class CircuitGateProperties {

	private final App app = new App();

	private final Mail mail = new Mail();

	private final Tokens tokens = new Tokens();

	private final Throttle throttle = new Throttle();

	private final Security security = new Security();

	private final Network network = new Network();

	private final Projects projects = new Projects();

	public App getApp() {
		return app;
	}

	public Mail getMail() {
		return mail;
	}

	public Tokens getTokens() {
		return tokens;
	}

	public Throttle getThrottle() {
		return throttle;
	}

	public Security getSecurity() {
		return security;
	}

	public Network getNetwork() {
		return network;
	}

	public Projects getProjects() {
		return projects;
	}

	public static class App {

		private String baseUrl = "http://localhost:5173";

		public String getBaseUrl() {
			return baseUrl;
		}

		public void setBaseUrl(String baseUrl) {
			this.baseUrl = baseUrl;
		}
	}

	public static class Mail {

		private String mode = "capture";

		private String from = "no-reply@circuitgate.local";

		public String getMode() {
			return mode;
		}

		public void setMode(String mode) {
			this.mode = mode;
		}

		public String getFrom() {
			return from;
		}

		public void setFrom(String from) {
			this.from = from;
		}
	}

	public static class Tokens {

		private Duration verificationTtl = Duration.ofHours(24);

		private Duration resetTtl = Duration.ofHours(1);

		private Duration resendWindow = Duration.ofMinutes(15);

		private int resendMax = 3;

		private Duration resetRequestWindow = Duration.ofMinutes(15);

		private int resetRequestMax = 5;

		private String cleanupCron = "0 30 3 * * *";

		public Duration getVerificationTtl() {
			return verificationTtl;
		}

		public void setVerificationTtl(Duration verificationTtl) {
			this.verificationTtl = verificationTtl;
		}

		public Duration getResetTtl() {
			return resetTtl;
		}

		public void setResetTtl(Duration resetTtl) {
			this.resetTtl = resetTtl;
		}

		public Duration getResendWindow() {
			return resendWindow;
		}

		public void setResendWindow(Duration resendWindow) {
			this.resendWindow = resendWindow;
		}

		public int getResendMax() {
			return resendMax;
		}

		public void setResendMax(int resendMax) {
			this.resendMax = resendMax;
		}

		public Duration getResetRequestWindow() {
			return resetRequestWindow;
		}

		public void setResetRequestWindow(Duration resetRequestWindow) {
			this.resetRequestWindow = resetRequestWindow;
		}

		public int getResetRequestMax() {
			return resetRequestMax;
		}

		public void setResetRequestMax(int resetRequestMax) {
			this.resetRequestMax = resetRequestMax;
		}

		public String getCleanupCron() {
			return cleanupCron;
		}

		public void setCleanupCron(String cleanupCron) {
			this.cleanupCron = cleanupCron;
		}
	}

	public static class Throttle {

		private final Login login = new Login();

		private String cleanupCron = "0 45 3 * * *";

		public Login getLogin() {
			return login;
		}

		public String getCleanupCron() {
			return cleanupCron;
		}

		public void setCleanupCron(String cleanupCron) {
			this.cleanupCron = cleanupCron;
		}

		public static class Login {

			private int threshold = 5;

			private Duration baseDelay = Duration.ofSeconds(1);

			private Duration maxDelay = Duration.ofMinutes(15);

			public int getThreshold() {
				return threshold;
			}

			public void setThreshold(int threshold) {
				this.threshold = threshold;
			}

			public Duration getBaseDelay() {
				return baseDelay;
			}

			public void setBaseDelay(Duration baseDelay) {
				this.baseDelay = baseDelay;
			}

			public Duration getMaxDelay() {
				return maxDelay;
			}

			public void setMaxDelay(Duration maxDelay) {
				this.maxDelay = maxDelay;
			}
		}
	}

	public static class Security {

		private final RememberMe rememberMe = new RememberMe();

		public RememberMe getRememberMe() {
			return rememberMe;
		}

		public static class RememberMe {

			private String key = "circuitgate-development-remember-me-key";

			private Duration ttl = Duration.ofDays(14);

			private boolean secureCookie = true;

			private String cookieName = "circuitgate-remember-me";

			public String getKey() {
				return key;
			}

			public void setKey(String key) {
				this.key = key;
			}

			public Duration getTtl() {
				return ttl;
			}

			public void setTtl(Duration ttl) {
				this.ttl = ttl;
			}

			public boolean isSecureCookie() {
				return secureCookie;
			}

			public void setSecureCookie(boolean secureCookie) {
				this.secureCookie = secureCookie;
			}

			public String getCookieName() {
				return cookieName;
			}

			public void setCookieName(String cookieName) {
				this.cookieName = cookieName;
			}
		}
	}

	public static class Network {

		private List<String> trustedProxies = List.of();

		public List<String> getTrustedProxies() {
			return trustedProxies;
		}

		public void setTrustedProxies(List<String> trustedProxies) {
			this.trustedProxies = trustedProxies;
		}
	}

	public static class Projects {

		private DataSize maxDocumentBytes = DataSize.ofMegabytes(2);

		private int maxDepth = 50;

		private int maxStringLength = 10000;

		private int schemaVersion = 1;

		public DataSize getMaxDocumentBytes() {
			return maxDocumentBytes;
		}

		public void setMaxDocumentBytes(DataSize maxDocumentBytes) {
			this.maxDocumentBytes = maxDocumentBytes;
		}

		public int getMaxDepth() {
			return maxDepth;
		}

		public void setMaxDepth(int maxDepth) {
			this.maxDepth = maxDepth;
		}

		public int getMaxStringLength() {
			return maxStringLength;
		}

		public void setMaxStringLength(int maxStringLength) {
			this.maxStringLength = maxStringLength;
		}

		public int getSchemaVersion() {
			return schemaVersion;
		}

		public void setSchemaVersion(int schemaVersion) {
			this.schemaVersion = schemaVersion;
		}
	}
}
