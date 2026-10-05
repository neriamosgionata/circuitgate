package dev.circuitgate.account;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.web.authentication.rememberme.PersistentRememberMeToken;
import org.springframework.security.web.authentication.rememberme.PersistentTokenRepository;

public class JdbcPersistentTokenRepository implements PersistentTokenRepository {

	private final JdbcTemplate jdbc;

	public JdbcPersistentTokenRepository(JdbcTemplate jdbc) {
		this.jdbc = jdbc;
	}

	@Override
	public void createNewToken(PersistentRememberMeToken token) {
		jdbc.update("""
				insert into persistent_logins (series, username, token, last_used)
				values (?, ?, ?, ?)
				""", token.getSeries(), token.getUsername(), TokenHasher.sha256Hex(token.getTokenValue()),
				Timestamp.from(token.getDate().toInstant()));
	}

	@Override
	public void updateToken(String series, String tokenValue, java.util.Date lastUsed) {
		jdbc.update("""
				update persistent_logins
				set token = ?, last_used = ?
				where series = ?
				""", TokenHasher.sha256Hex(tokenValue), Timestamp.from(lastUsed.toInstant()), series);
	}

	@Override
	public PersistentRememberMeToken getTokenForSeries(String seriesId) {
		List<PersistentRememberMeToken> found = jdbc.query("""
				select username, series, token, last_used
				from persistent_logins
				where series = ?
				""", (rs, rowNum) -> new PersistentRememberMeToken(rs.getString("username"), rs.getString("series"),
				rs.getString("token"), new java.util.Date(rs.getTimestamp("last_used").getTime())), seriesId);
		Optional<PersistentRememberMeToken> first = found.stream().findFirst();
		return first.orElse(null);
	}

	@Override
	public void removeUserTokens(String username) {
		jdbc.update("delete from persistent_logins where username = ?", username);
	}
}
