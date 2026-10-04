package dev.circuitgate.config;

import java.time.Clock;

import org.springframework.boot.web.server.Cookie;
import org.springframework.boot.web.server.autoconfigure.ServerProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.session.DelegatingIndexResolver;
import org.springframework.session.PrincipalNameIndexResolver;
import org.springframework.session.Session;
import org.springframework.session.config.SessionRepositoryCustomizer;
import org.springframework.session.jdbc.JdbcIndexedSessionRepository;
import org.springframework.session.web.http.DefaultCookieSerializer;

@Configuration
@EnableScheduling
public class SessionConfig {

	@Bean
	public Clock clock() {
		return Clock.systemUTC();
	}

	@Bean
	public DefaultCookieSerializer sessionCookieSerializer(ServerProperties serverProperties) {
		Cookie cookie = serverProperties.getServlet().getSession().getCookie();
		DefaultCookieSerializer serializer = new DefaultCookieSerializer();
		if (cookie.getName() != null) {
			serializer.setCookieName(cookie.getName());
		}
		if (cookie.getDomain() != null) {
			serializer.setDomainName(cookie.getDomain());
		}
		if (cookie.getPath() != null) {
			serializer.setCookiePath(cookie.getPath());
		}
		if (cookie.getHttpOnly() != null) {
			serializer.setUseHttpOnlyCookie(cookie.getHttpOnly());
		}
		if (cookie.getSecure() != null) {
			serializer.setUseSecureCookie(cookie.getSecure());
		}
		if (cookie.getSameSite() != null) {
			serializer.setSameSite(cookie.getSameSite().name());
		}
		if (cookie.getMaxAge() != null) {
			serializer.setCookieMaxAge((int) cookie.getMaxAge().toSeconds());
		}
		return serializer;
	}

	@Bean
	public SessionRepositoryCustomizer<JdbcIndexedSessionRepository> principalNameSessionRepositoryCustomizer() {
		return repository -> repository.setIndexResolver(principalNameIndexResolver());
	}

	private DelegatingIndexResolver<Session> principalNameIndexResolver() {
		return new DelegatingIndexResolver<>(new PrincipalNameIndexResolver<Session>());
	}
}
