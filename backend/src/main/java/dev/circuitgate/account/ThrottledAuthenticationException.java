package dev.circuitgate.account;

import org.springframework.security.authentication.BadCredentialsException;

public class ThrottledAuthenticationException extends BadCredentialsException {

	public ThrottledAuthenticationException() {
		super("Too many failed attempts");
	}
}
