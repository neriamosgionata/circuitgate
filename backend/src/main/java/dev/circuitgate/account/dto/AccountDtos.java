package dev.circuitgate.account.dto;

import java.util.UUID;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AccountDtos {

	private AccountDtos() {
	}

	public record LoginRequest(@Email String email, @NotBlank String password, Boolean rememberMe) {
	}

	public record RegisterRequest(@NotBlank @Email @Size(max = 320) String email,
			@NotBlank @Size(min = 8, max = 128) String password) {
	}

	public record VerifyEmailRequest(@NotBlank @Size(max = 128) String token) {
	}

	public record EmailRequest(@NotBlank @Email @Size(max = 320) String email) {
	}

	public record ResetPasswordRequest(@NotBlank @Size(max = 128) String token,
			@NotBlank @Size(min = 8, max = 128) String newPassword) {
	}

	public record ChangePasswordRequest(@NotBlank String currentPassword,
			@NotBlank @Size(min = 8, max = 128) String newPassword) {
	}

	public record CsrfResponse(String token, String headerName) {
	}

	public record StatusResponse(String status) {
	}

	public record MeResponse(UUID id, String email, boolean verified) {
	}
}
