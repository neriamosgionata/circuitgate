package dev.circuitgate.realtime;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

@Component
public class StompTopicBroadcaster implements TopicBroadcaster {

	private final SimpMessagingTemplate messaging;

	public StompTopicBroadcaster(SimpMessagingTemplate messaging) {
		this.messaging = messaging;
	}

	@Override
	public void send(String destination, Object payload) {
		messaging.convertAndSend(destination, payload);
	}
}
