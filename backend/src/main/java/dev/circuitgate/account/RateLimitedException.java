package dev.circuitgate.account;

public class RateLimitedException extends RuntimeException {

	public RateLimitedException() {
		super("Too many requests");
	}
}
