// WebSocket tunnel client — connects to SummonGhost server
// Ported from ghost-cli's cmd_tunnel.go

import type { TunnelStatus } from "../shared/types";

const PING_INTERVAL = 25_000; // 25s keepalive
const INITIAL_BACKOFF = 10_000; // 10s
const MAX_BACKOFF = 300_000; // 5min
const MAX_RETRIES = 10;

type StatusCallback = (status: TunnelStatus, error?: string) => void;
type CommandCallback = (command: TunnelCommand) => Promise<TunnelResult>;

interface TunnelCommand {
	type: "command";
	id: string;
	command: string;
	args: string[];
	cwd?: string;
	timeout?: number;
	sessionId?: string;
}

interface TunnelResult {
	type: "result";
	id: string;
	stdout: string;
	stderr: string;
	exitCode: number;
}

export class TunnelClient {
	private ws: WebSocket | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private retryCount = 0;
	private backoff = INITIAL_BACKOFF;
	private intentionalClose = false;

	constructor(
		private serverUrl: string,
		private token: string,
		private onStatus: StatusCallback,
		private onCommand: CommandCallback,
	) {}

	connect() {
		this.intentionalClose = false;
		this.onStatus("connecting");

		const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/api/tunnel/ws";
		this.ws = new WebSocket(wsUrl, {
			headers: { Authorization: `Bearer ${this.token}` },
		} as any);

		this.ws.onopen = () => {
			console.log("[tunnel] Connected");
			this.retryCount = 0;
			this.backoff = INITIAL_BACKOFF;
			this.onStatus("connected");
			this.startPing();
		};

		this.ws.onmessage = async (event) => {
			try {
				const data = JSON.parse(
					typeof event.data === "string"
						? event.data
						: new TextDecoder().decode(event.data as ArrayBuffer),
				);

				if (data.type === "command") {
					const result = await this.onCommand(data as TunnelCommand);
					this.send(result);
				}
			} catch (err) {
				console.error("[tunnel] Message handling error:", err);
			}
		};

		this.ws.onclose = () => {
			this.stopPing();
			if (!this.intentionalClose) {
				this.onStatus("disconnected");
				this.scheduleReconnect();
			}
		};

		this.ws.onerror = (err) => {
			console.error("[tunnel] WebSocket error:", err);
			this.onStatus("error", "Connection failed");
		};
	}

	disconnect() {
		this.intentionalClose = true;
		this.stopPing();
		this.ws?.close();
		this.ws = null;
		this.onStatus("disconnected");
	}

	private send(data: unknown) {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	private startPing() {
		this.pingTimer = setInterval(() => {
			this.send({ type: "ping" });
		}, PING_INTERVAL);
	}

	private stopPing() {
		if (this.pingTimer) {
			clearInterval(this.pingTimer);
			this.pingTimer = null;
		}
	}

	private scheduleReconnect() {
		if (this.retryCount >= MAX_RETRIES) {
			this.onStatus("error", `Failed after ${MAX_RETRIES} retries`);
			return;
		}
		this.retryCount++;
		const jitter = Math.random() * 1000;
		const delay = Math.min(this.backoff + jitter, MAX_BACKOFF);
		console.log(
			`[tunnel] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.retryCount}/${MAX_RETRIES})`,
		);
		setTimeout(() => this.connect(), delay);
		this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
	}
}
