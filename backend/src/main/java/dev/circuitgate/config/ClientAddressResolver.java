package dev.circuitgate.config;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.stereotype.Component;

@Component
public class ClientAddressResolver {

	private static final Pattern IP_LITERAL = Pattern.compile("[0-9a-fA-F:.]+");

	private final List<CidrRange> trustedProxies;

	public ClientAddressResolver(CircuitGateProperties properties) {
		List<CidrRange> ranges = new ArrayList<>();
		for (String value : properties.getNetwork().getTrustedProxies()) {
			if (value == null || value.isBlank()) {
				continue;
			}
			ranges.add(CidrRange.parse(value.trim()));
		}
		this.trustedProxies = List.copyOf(ranges);
	}

	public String resolve(HttpServletRequest request) {
		String remoteAddress = request.getRemoteAddr();
		if (remoteAddress == null || remoteAddress.isBlank()) {
			return "unknown";
		}
		if (isTrusted(remoteAddress)) {
			String forwarded = firstForwardedAddress(request.getHeader("X-Forwarded-For"));
			if (forwarded != null) {
				return forwarded;
			}
		}
		return remoteAddress;
	}

	private boolean isTrusted(String address) {
		byte[] bytes = parse(address);
		if (bytes == null) {
			return false;
		}
		for (CidrRange range : trustedProxies) {
			if (range.contains(bytes)) {
				return true;
			}
		}
		return false;
	}

	private String firstForwardedAddress(String header) {
		if (header == null || header.isBlank()) {
			return null;
		}
		String candidate = header.split(",")[0].trim();
		if (candidate.startsWith("\"") && candidate.endsWith("\"") && candidate.length() > 1) {
			candidate = candidate.substring(1, candidate.length() - 1).trim();
		}
		return isIpLiteral(candidate) ? candidate : null;
	}

	private byte[] parse(String address) {
		if (!isIpLiteral(address)) {
			return null;
		}
		try {
			return InetAddress.getByName(address).getAddress();
		}
		catch (UnknownHostException ex) {
			return null;
		}
	}

	private boolean isIpLiteral(String address) {
		return address != null && !address.isBlank() && IP_LITERAL.matcher(address).matches();
	}

	private record CidrRange(byte[] network, int prefixLength) {

		static CidrRange parse(String value) {
			String[] parts = value.split("/", 2);
			byte[] network;
			try {
				network = InetAddress.getByName(parts[0]).getAddress();
			}
			catch (UnknownHostException ex) {
				throw new IllegalArgumentException("Invalid trusted proxy address: " + value, ex);
			}
			int prefix = parts.length == 2 ? Integer.parseInt(parts[1]) : network.length * 8;
			if (prefix < 0 || prefix > network.length * 8) {
				throw new IllegalArgumentException("Invalid trusted proxy prefix: " + value);
			}
			return new CidrRange(network, prefix);
		}

		boolean contains(byte[] address) {
			if (address.length != network.length) {
				return false;
			}
			int fullBytes = prefixLength / 8;
			int remainingBits = prefixLength % 8;
			for (int i = 0; i < fullBytes; i++) {
				if (address[i] != network[i]) {
					return false;
				}
			}
			if (remainingBits == 0) {
				return true;
			}
			int mask = 0xFF << (8 - remainingBits) & 0xFF;
			return (address[fullBytes] & mask) == (network[fullBytes] & mask);
		}
	}
}
