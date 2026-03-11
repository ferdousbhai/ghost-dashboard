// WebSocket tunnel client — connects to TunnelAgent on SummonGhost
//
// Protocol:
// - Connects to /api/tunnel/ws with Bearer auth
// - Sends project_context (MCP tools, git info) on connect
// - Receives tool_request → routes to local executor or MCP → sends tool_response
// - Receives command → executes locally → sends result
// - Heartbeat keepalive every 25s

import type { TunnelStatus } from "../shared/types";

const HEARTBEAT_INTERVAL = 25_000; // 25s keepalive
const INITIAL_BACKOFF = 10_000; // 10s
const MAX_BACKOFF = 300_000; // 5min
const MAX_RETRIES = 10;

// --- Shared types matching summon-ghost server protocol ---

export interface McpToolInfo {
	id: string;
	name: string;
	description: string;
	serverName: string;
}

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

export interface ToolRequest {
	type: "tool_request";
	toolCallId: string;
	name: string;
	args: Record<string, unknown>;
}

interface ToolResponse {
	type: "tool_response";
	toolCallId: string;
	result?: string;
	error?: string;
}

interface ProjectContext {
	type: "project_context";
	cwd: string;
	mcpTools: McpToolInfo[];
	gitBranch?: string;
	gitStatus?: string;
	fileTree?: string[];
}

type StatusCallback = (status: TunnelStatus, error?: string) => void;
type CommandCallback = (command: TunnelCommand) => Promise<TunnelResult>;
type ToolRequestCallback = (request: ToolRequest) => Promise<ToolResponse>;

export class TunnelClient {
	private ws: WebSocket | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private retryCount = 0;
	private backoff = INITIAL_BACKOFF;
	private intentionalClose = false;
	private currentTools: McpToolInfo[] = [];

	constructor(
		private serverUrl: string,
		private token: string,
		private onStatus: StatusCallback,
		private onCommand: CommandCallback,
		private onToolRequest: ToolRequestCallback,
	) {}

	connect() {
		this.intentionalClose = false;
		this.onStatus("connecting");

		// Connect to TunnelAgent (per-user DO)
		const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/api/tunnel/ws";
		console.log(`[tunnel] Connecting to ${wsUrl}`);

		this.ws = new WebSocket(wsUrl, {
			headers: { Authorization: `Bearer ${this.token}` },
		} as any);

		this.ws.onopen = () => {
			console.log("[tunnel] WebSocket open, waiting for connected message");
		};

		this.ws.onmessage = async (event) => {
			try {
				const data = JSON.parse(
					typeof event.data === "string"
						? event.data
						: new TextDecoder().decode(event.data as ArrayBuffer),
				);

				switch (data.type) {
					case "connected":
						console.log("[tunnel] Connected to ghost:", data.ghostName);
						this.retryCount = 0;
						this.backoff = INITIAL_BACKOFF;
						this.onStatus("connected");
						this.startHeartbeat();
						// Send tool list on connect
						if (this.currentTools.length > 0) {
							this.sendProjectContext(this.currentTools);
						}
						break;

					case "heartbeat_ack":
						// Server acknowledged our heartbeat
						break;

					case "command":
						const result = await this.onCommand(data as TunnelCommand);
						this.send(result);
						break;

					case "tool_request":
						const response = await this.onToolRequest(data as ToolRequest);
						this.send(response);
						break;

					default:
						// Ignore other messages (cf_agent_use_chat_response, etc.)
						break;
				}
			} catch (err) {
				console.error("[tunnel] Message handling error:", err);
			}
		};

		this.ws.onclose = (event) => {
			this.stopHeartbeat();
			console.log(`[tunnel] WebSocket closed: code=${event.code} reason=${event.reason}`);
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
		this.stopHeartbeat();
		this.ws?.close();
		this.ws = null;
		this.onStatus("disconnected");
	}

	/** Send updated project context and MCP tool list to the server */
	sendProjectContext(
		tools: McpToolInfo[],
		extra?: {
			gitBranch?: string;
			gitStatus?: string;
			fileTree?: string[];
		},
	) {
		this.currentTools = tools;
		const msg: ProjectContext = {
			type: "project_context",
			cwd: process.cwd(),
			mcpTools: tools,
			...extra,
		};
		this.send(msg);
		console.log(
			`[tunnel] Sent project_context with ${tools.length} tools`,
		);
	}

	private send(data: unknown) {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(data));
		}
	}

	private startHeartbeat() {
		this.heartbeatTimer = setInterval(() => {
			this.send({ type: "heartbeat" });
		}, HEARTBEAT_INTERVAL);
	}

	private stopHeartbeat() {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
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
