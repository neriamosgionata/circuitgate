package dev.circuitgate.account;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Date;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.authentication.rememberme.InvalidCookieException;
import org.springframework.security.web.authentication.rememberme.PersistentRememberMeToken;
import org.springframework.security.web.authentication.rememberme.PersistentTokenBasedRememberMeServices;
import org.springframework.security.web.authentication.rememberme.PersistentTokenRepository;
import org.springframework.security.web.authentication.rememberme.RememberMeAuthenticationException;

public class HashedPersistentTokenRememberMeServices extends PersistentTokenBasedRememberMeServices {

	public static final String REMEMBER_ME_REQUEST_ATTRIBUTE = HashedPersistentTokenRememberMeServices.class.getName()
			+ ".REMEMBER_ME";

	private final PersistentTokenRepository tokenRepository;

	public HashedPersistentTokenRememberMeServices(String key, UserDetailsService userDetailsService,
			PersistentTokenRepository tokenRepository) {
		super(key, userDetailsService, tokenRepository);
		this.tokenRepository = tokenRepository;
	}

	@Override
	protected boolean rememberMeRequested(HttpServletRequest request, String parameter) {
		if (Boolean.TRUE.equals(request.getAttribute(REMEMBER_ME_REQUEST_ATTRIBUTE))) {
			return true;
		}
		return super.rememberMeRequested(request, parameter);
	}

	@Override
	protected UserDetails processAutoLoginCookie(String[] cookieTokens, HttpServletRequest request,
			HttpServletResponse response) {
		if (cookieTokens.length != 2) {
			throw new InvalidCookieException(
					"Cookie token did not contain 2 tokens, but contained '" + Arrays.asList(cookieTokens) + "'");
		}
		String presentedSeries = cookieTokens[0];
		String presentedToken = cookieTokens[1];
		PersistentRememberMeToken token = tokenRepository.getTokenForSeries(presentedSeries);
		if (token == null) {
			throw new RememberMeAuthenticationException("No persistent token found for series id: " + presentedSeries);
		}
		String presentedHash = TokenHasher.sha256Hex(presentedToken);
		if (!MessageDigest.isEqual(presentedHash.getBytes(StandardCharsets.US_ASCII),
				token.getTokenValue().getBytes(StandardCharsets.US_ASCII))) {
			tokenRepository.removeUserTokens(token.getUsername());
			logger.warn("Remember-me token replay detected; persistent series revoked");
			throw new RememberMeAuthenticationException(
					"Invalid remember-me token (series/token) mismatch; the persistent series was revoked");
		}
		if (System.currentTimeMillis() > token.getDate().getTime() + getTokenValiditySeconds() * 1000L) {
			tokenRepository.removeUserTokens(token.getUsername());
			throw new RememberMeAuthenticationException("Remember-me login has expired");
		}
		String newToken = generateTokenData();
		tokenRepository.updateToken(presentedSeries, newToken, new Date());
		setCookie(new String[] { presentedSeries, newToken }, getTokenValiditySeconds(), request, response);
		return getUserDetailsService().loadUserByUsername(token.getUsername());
	}
}
