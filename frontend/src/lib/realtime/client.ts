import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs';

import { clearCsrf, getCsrf } from '../api/client';
import type { ProjectRealtimeEvent } from './stores';

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';

export interface RealtimeMessage {
	topic: string;
	event: ProjectRealtimeEvent;
}

export interface RealtimeClientOptions {
	onMessage?: (message: RealtimeMessage) => void;
	onStatus?: (status: RealtimeStatus) => void;
	onResync?: () => void;
}

const MAX_RECONNECT_DELAY = 30_000;

export class RealtimeClient {
	private readonly options: RealtimeClientOptions;

	private client: Client | null = null;

	private readonly destinations = new Set<string>();

	private readonly subscriptions = new Map<string, StompSubscription>();

	private reconnectAttempts = 0;

	private everConnected = false;

	private stopped = false;

	constructor(options: RealtimeClientOptions = {}) {
		this.options = options;
	}

	connect(): void {
		if (typeof window === 'undefined' || this.client) return;
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const client = new Client({
			brokerURL: `${protocol}//${window.location.host}/ws`,
			reconnectDelay: 1000,
			heartbeatIncoming: 10_000,
			heartbeatOutgoing: 10_000,
			beforeConnect: async () => {
				const csrf = await getCsrf();
				client.connectHeaders = { [csrf.headerName]: csrf.token };
			},
			onConnect: () => {
				this.reconnectAttempts = 0;
				client.reconnectDelay = 1000;
				this.options.onStatus?.('connected');
				for (const destination of this.destinations) {
					this.attach(destination);
				}
				if (this.everConnected) {
					this.options.onResync?.();
				}
				this.everConnected = true;
			},
			onStompError: () => {
				clearCsrf();
			},
			onWebSocketClose: () => {
				this.subscriptions.clear();
				this.reconnectAttempts += 1;
				client.reconnectDelay = Math.min(
					MAX_RECONNECT_DELAY,
					1000 * 2 ** Math.min(this.reconnectAttempts, 5)
				);
				this.options.onStatus?.('disconnected');
			}
		});
		this.client = client;
		this.options.onStatus?.('connecting');
		client.activate();
	}

	disconnect(): void {
		this.stopped = true;
		for (const subscription of this.subscriptions.values()) {
			subscription.unsubscribe();
		}
		this.subscriptions.clear();
		this.client?.deactivate();
		this.client = null;
	}

	subscribe(destination: string): void {
		this.destinations.add(destination);
		if (this.client?.connected) {
			this.attach(destination);
		}
	}

	unsubscribe(destination: string): void {
		this.destinations.delete(destination);
		const subscription = this.subscriptions.get(destination);
		if (subscription) {
			subscription.unsubscribe();
			this.subscriptions.delete(destination);
		}
	}

	private attach(destination: string): void {
		if (!this.client || this.subscriptions.has(destination)) return;
		const subscription = this.client.subscribe(destination, (message: IMessage) => {
			this.handleMessage(destination, message);
		});
		this.subscriptions.set(destination, subscription);
	}

	private handleMessage(destination: string, message: IMessage): void {
		let event: ProjectRealtimeEvent;
		try {
			event = JSON.parse(message.body) as ProjectRealtimeEvent;
		} catch {
			return;
		}
		if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return;
		this.options.onMessage?.({ topic: destination, event });
	}

	isStopped(): boolean {
		return this.stopped;
	}
}
