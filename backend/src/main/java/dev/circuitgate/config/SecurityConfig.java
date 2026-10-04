package dev.circuitgate.config;

import java.util.List;
import java.util.Map;

import dev.circuitgate.account.AccountUserDetailsService;
import dev.circuitgate.account.HashedPersistentTokenRememberMeServices;
import dev.circuitgate.account.JdbcPersistentTokenRepository;
import dev.circuitgate.account.JsonLoginFailureHandler;
import dev.circuitgate.account.JsonLoginFilter;
import dev.circuitgate.account.JsonLoginSuccessHandler;
import dev.circuitgate.account.ThrottlingService;
import dev.circuitgate.account.UserRepository;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.RequestCacheConfigurer;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.authentication.rememberme.PersistentTokenRepository;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;

import tools.jackson.databind.ObjectMapper;

@Configuration
@EnableWebSecurity
@EnableConfigurationProperties(CircuitGateProperties.class)
public class SecurityConfig {

	@Bean
	public PasswordEncoder passwordEncoder() {
		return PasswordEncoderFactories.createDelegatingPasswordEncoder();
	}

	@Bean
	public UserDetailsService userDetailsService(UserRepository users) {
		return new AccountUserDetailsService(users);
	}

	@Bean
	public PersistentTokenRepository persistentTokenRepository(JdbcTemplate jdbcTemplate) {
		return new JdbcPersistentTokenRepository(jdbcTemplate);
	}

	@Bean
	public HashedPersistentTokenRememberMeServices rememberMeServices(CircuitGateProperties properties,
			UserDetailsService userDetailsService, PersistentTokenRepository persistentTokenRepository) {
		CircuitGateProperties.Security.RememberMe config = properties.getSecurity().getRememberMe();
		HashedPersistentTokenRememberMeServices services = new HashedPersistentTokenRememberMeServices(config.getKey(),
				userDetailsService, persistentTokenRepository);
		services.setCookieName(config.getCookieName());
		services.setTokenValiditySeconds((int) config.getTtl().toSeconds());
		services.setUseSecureCookie(config.isSecureCookie());
		services.setCookieCustomizer(cookie -> {
			cookie.setHttpOnly(true);
			cookie.setPath("/");
			cookie.setAttribute("SameSite", "Lax");
		});
		return services;
	}

	@Bean
	public CsrfTokenRepository csrfTokenRepository() {
		return new HttpSessionCsrfTokenRepository();
	}

	@Bean
	public AuthenticationManager authenticationManager(AuthenticationConfiguration configuration) throws Exception {
		return configuration.getAuthenticationManager();
	}

	@Bean
	public JsonLoginFilter jsonLoginFilter(AuthenticationManager authenticationManager, ObjectMapper objectMapper,
			ClientAddressResolver addressResolver, ThrottlingService throttling,
			HashedPersistentTokenRememberMeServices rememberMeServices, CsrfTokenRepository csrfTokenRepository) {
		JsonLoginFilter filter = new JsonLoginFilter(objectMapper, addressResolver, throttling, authenticationManager);
		filter.setRememberMeServices(rememberMeServices);
		filter.setSessionAuthenticationStrategy(new CompositeSessionAuthenticationStrategy(
				List.of(new ChangeSessionIdAuthenticationStrategy(), new CsrfAuthenticationStrategy(csrfTokenRepository))));
		filter.setSecurityContextRepository(new HttpSessionSecurityContextRepository());
		filter.setAuthenticationSuccessHandler(new JsonLoginSuccessHandler(throttling, addressResolver));
		filter.setAuthenticationFailureHandler(new JsonLoginFailureHandler(objectMapper, throttling, addressResolver));
		return filter;
	}

	@Bean
	public SecurityFilterChain securityFilterChain(HttpSecurity http, JsonLoginFilter jsonLoginFilter,
			HashedPersistentTokenRememberMeServices rememberMeServices, CsrfTokenRepository csrfTokenRepository,
			ObjectMapper objectMapper) throws Exception {
		AuthenticationEntryPoint entryPoint = (request, response, exception) -> ApiResponses.write(response, objectMapper,
				HttpServletResponse.SC_UNAUTHORIZED, Map.of("error", "unauthorized"));
		AccessDeniedHandler accessDeniedHandler = (request, response, exception) -> ApiResponses.write(response,
				objectMapper, HttpServletResponse.SC_FORBIDDEN, Map.of("error", "forbidden"));

		http
			.csrf(csrf -> csrf.csrfTokenRepository(csrfTokenRepository)
				.csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
			.authorizeHttpRequests(authorize -> authorize
				.requestMatchers(HttpMethod.GET, "/api/auth/csrf")
				.permitAll()
				.requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/verify-email",
						"/api/auth/verify-email/resend", "/api/auth/password/reset-request",
						"/api/auth/password/reset", "/api/auth/login")
				.permitAll()
				.requestMatchers("/error")
				.permitAll()
				.anyRequest()
				.authenticated())
			.requestCache(RequestCacheConfigurer::disable)
			.sessionManagement(session -> session.sessionFixation(fixation -> fixation.changeSessionId()))
			.rememberMe(remember -> remember.rememberMeServices(rememberMeServices))
			.addFilterAt(jsonLoginFilter, UsernamePasswordAuthenticationFilter.class)
			.logout(logout -> logout
				.logoutRequestMatcher(
						PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST, "/api/auth/logout"))
				.logoutSuccessHandler(
						(request, response, authentication) -> response.setStatus(HttpServletResponse.SC_NO_CONTENT))
				.invalidateHttpSession(true)
				.clearAuthentication(true)
				.permitAll())
			.exceptionHandling(handling -> handling.authenticationEntryPoint(entryPoint)
				.accessDeniedHandler(accessDeniedHandler));
		return http.build();
	}
}
