package dev.circuitgate.sharing;

public class ShareNotFoundException extends RuntimeException {

	public ShareNotFoundException() {
		super("share not found");
	}
}
