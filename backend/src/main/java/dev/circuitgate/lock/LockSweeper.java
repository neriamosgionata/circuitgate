package dev.circuitgate.lock;

import java.util.List;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class LockSweeper {

	private final LockService locks;

	public LockSweeper(LockService locks) {
		this.locks = locks;
	}

	@Scheduled(fixedDelayString = "${circuitgate.locks.sweep-interval:30s}")
	public List<LockTransition> sweep() {
		return locks.expireOverdue();
	}
}
