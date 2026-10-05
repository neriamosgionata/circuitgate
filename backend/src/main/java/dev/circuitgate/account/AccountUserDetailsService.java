package dev.circuitgate.account;

import java.util.Locale;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;

public class AccountUserDetailsService implements UserDetailsService {

	private final UserRepository users;

	public AccountUserDetailsService(UserRepository users) {
		this.users = users;
	}

	@Override
	public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
		String email = username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
		User user = users.findByEmail(email)
			.orElseThrow(() -> new UsernameNotFoundException("No account for the supplied credentials"));
		return org.springframework.security.core.userdetails.User.withUsername(user.getEmail())
			.password(user.getPasswordHash())
			.disabled(!user.isEmailVerified())
			.authorities("ROLE_USER")
			.build();
	}
}
