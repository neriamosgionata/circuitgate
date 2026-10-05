package dev.circuitgate.realtime;

public interface TopicBroadcaster {

	void send(String destination, Object payload);
}
