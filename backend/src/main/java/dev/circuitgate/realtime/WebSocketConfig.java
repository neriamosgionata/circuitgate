package dev.circuitgate.realtime;

import java.util.List;

import dev.circuitgate.account.UserRepository;
import dev.circuitgate.config.CircuitGateProperties;
import dev.circuitgate.project.ProjectAccess;
import dev.circuitgate.project.ProjectRepository;
import dev.circuitgate.team.TeamMemberRepository;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;
import org.springframework.web.socket.handler.WebSocketHandlerDecoratorFactory;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

	private final CircuitGateProperties properties;

	private final UserRepository users;

	private final CsrfTokenRepository csrfTokenRepository;

	private final RealtimeSessionRegistry registry;

	private final ProjectRepository projects;

	private final ProjectAccess access;

	private final TeamMemberRepository members;

	public WebSocketConfig(CircuitGateProperties properties, UserRepository users,
			CsrfTokenRepository csrfTokenRepository, RealtimeSessionRegistry registry, ProjectRepository projects,
			ProjectAccess access, TeamMemberRepository members) {
		this.properties = properties;
		this.users = users;
		this.csrfTokenRepository = csrfTokenRepository;
		this.registry = registry;
		this.projects = projects;
		this.access = access;
		this.members = members;
	}

	@Override
	public void registerStompEndpoints(StompEndpointRegistry endpointRegistry) {
		List<String> configured = properties.getRealtime().getAllowedOrigins();
		String[] origins = (configured.isEmpty() ? List.of(properties.getApp().getBaseUrl()) : configured)
			.toArray(String[]::new);
		endpointRegistry.addEndpoint("/ws")
			.addInterceptors(new HandshakeAuthInterceptor(properties, users, csrfTokenRepository))
			.setAllowedOriginPatterns(origins);
	}

	@Override
	public void configureMessageBroker(MessageBrokerRegistry brokerRegistry) {
		brokerRegistry.enableSimpleBroker("/topic");
		brokerRegistry.setApplicationDestinationPrefixes("/app");
	}

	@Override
	public void configureClientInboundChannel(ChannelRegistration registration) {
		registration.interceptors(new StompChannelInterceptor(registry, projects, access, members));
	}

	@Override
	public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
		registration.addDecoratorFactory(new WebSocketHandlerDecoratorFactory() {
			@Override
			public WebSocketHandler decorate(WebSocketHandler handler) {
				return new WebSocketHandlerDecorator(handler) {
					@Override
					public void afterConnectionEstablished(WebSocketSession session) throws Exception {
						registry.socketEstablished(session);
						super.afterConnectionEstablished(session);
					}

					@Override
					public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
						try {
							super.afterConnectionClosed(session, status);
						}
						finally {
							registry.socketClosed(session.getId());
						}
					}
				};
			}
		});
	}
}
