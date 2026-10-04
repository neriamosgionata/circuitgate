package dev.circuitgate.account;

import dev.circuitgate.account.dto.AccountDtos.ChangePasswordRequest;
import dev.circuitgate.account.dto.AccountDtos.CsrfResponse;
import dev.circuitgate.account.dto.AccountDtos.EmailRequest;
import dev.circuitgate.account.dto.AccountDtos.MeResponse;
import dev.circuitgate.account.dto.AccountDtos.RegisterRequest;
import dev.circuitgate.account.dto.AccountDtos.ResetPasswordRequest;
import dev.circuitgate.account.dto.AccountDtos.StatusResponse;
import dev.circuitgate.account.dto.AccountDtos.VerifyEmailRequest;
import dev.circuitgate.config.ClientAddressResolver;
import dev.circuitgate.realtime.RealtimeSessionRegistry;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AccountController {

	private final AccountService accountService;

	private final ClientAddressResolver addressResolver;

	private final HashedPersistentTokenRememberMeServices rememberMeServices;

	private final RealtimeSessionRegistry realtime;

	private final SecurityContextLogoutHandler logoutHandler = new SecurityContextLogoutHandler();

	public AccountController(AccountService accountService, ClientAddressResolver addressResolver,
			HashedPersistentTokenRememberMeServices rememberMeServices, RealtimeSessionRegistry realtime) {
		this.accountService = accountService;
		this.addressResolver = addressResolver;
		this.rememberMeServices = rememberMeServices;
		this.realtime = realtime;
	}

	@GetMapping("/csrf")
	public CsrfResponse csrf(CsrfToken csrfToken) {
		return new CsrfResponse(csrfToken.getToken(), csrfToken.getHeaderName());
	}

	@PostMapping("/register")
	@ResponseStatus(HttpStatus.ACCEPTED)
	public StatusResponse register(@Valid @RequestBody RegisterRequest request) {
		accountService.register(request.email(), request.password());
		return new StatusResponse("verification_sent");
	}

	@PostMapping("/verify-email")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void verifyEmail(@Valid @RequestBody VerifyEmailRequest request) {
		accountService.verifyEmail(request.token());
	}

	@PostMapping("/verify-email/resend")
	@ResponseStatus(HttpStatus.ACCEPTED)
	public StatusResponse resendVerification(@Valid @RequestBody EmailRequest request, HttpServletRequest httpRequest) {
		accountService.resendVerification(request.email(), addressResolver.resolve(httpRequest));
		return new StatusResponse("verification_sent");
	}

	@PostMapping("/password/reset-request")
	@ResponseStatus(HttpStatus.ACCEPTED)
	public StatusResponse requestPasswordReset(@Valid @RequestBody EmailRequest request, HttpServletRequest httpRequest) {
		accountService.requestPasswordReset(request.email(), addressResolver.resolve(httpRequest));
		return new StatusResponse("accepted");
	}

	@PostMapping("/password/reset")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
		accountService.resetPassword(request.token(), request.newPassword());
	}

	@PostMapping("/password/change")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void changePassword(@Valid @RequestBody ChangePasswordRequest request, Authentication authentication,
			HttpServletRequest httpRequest) {
		accountService.changePassword(authentication.getName(), request.currentPassword(), request.newPassword(),
				currentSessionId(httpRequest));
	}

	@PostMapping("/logout-all")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	public void logoutAll(Authentication authentication, HttpServletRequest request, HttpServletResponse response) {
		accountService.revokeSessions(authentication.getName());
		realtime.disconnectUser(authentication.getName());
		rememberMeServices.logout(request, response, authentication);
		logoutHandler.logout(request, response, authentication);
	}

	@GetMapping("/me")
	public MeResponse me(Authentication authentication) {
		AccountService.Profile profile = accountService.getProfile(authentication.getName());
		return new MeResponse(profile.id(), profile.email(), profile.emailVerified());
	}

	private String currentSessionId(HttpServletRequest request) {
		HttpSession session = request.getSession(false);
		return session == null ? null : session.getId();
	}
}
