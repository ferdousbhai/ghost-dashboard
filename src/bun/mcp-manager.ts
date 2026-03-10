// MCP Server Manager — spawns and manages MCP server processes via stdio
// Each "app" in the dashboard maps to an MCP server command

import { type Subprocess } from "bun";
import type { AppId, AppState } from "../shared/types";
import type { McpToolInfo } from "./tunnel";

interface McpServerConfig {
	command: string;
	args: string[];
	env?: Record<string, string>;
}

// MCP server configs for each app
// These map to actual MCP server binaries/scripts on the local machine
const MCP_SERVERS: Record<AppId, McpServerConfig> = {
	whatsapp: {
		command: "whatsapp-mcp",
		args: ["--stdio"],
	},
	gmail: {
		command: "gws",
		args: ["gmail", "--mcp"],
	},
	calendar: {
		command: "gws",
		args: ["calendar", "--mcp"],
	},
	drive: {
		command: "gws",
		args: ["drive", "--mcp"],
	},
	chrome: {
		command: "claude-in-chrome-mcp",
		args: [],
	},
};

interface ManagedServer {
	process: Subprocess;
	tools: McpToolInfo[];
	appId: AppId;
}

export class McpManager {
	private servers = new Map<AppId, ManagedServer>();
	private onStateChange: (appId: AppId, state: AppState) => void;

	constructor(onStateChange: (appId: AppId, state: AppState) => void) {
		this.onStateChange = onStateChange;
	}

	async startServer(appId: AppId): Promise<AppState> {
		if (this.servers.has(appId)) {
			return { id: appId, status: "active" };
		}

		this.onStateChange(appId, { id: appId, status: "loading" });

		const config = MCP_SERVERS[appId];
		if (!config) {
			const state: AppState = {
				id: appId,
				status: "error",
				error: `No MCP server config for ${appId}`,
			};
			this.onStateChange(appId, state);
			return state;
		}

		try {
			const proc = Bun.spawn([config.command, ...config.args], {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, ...config.env },
			});

			// Send initialize request per MCP protocol
			const initRequest = JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: {
						name: "ghost-dashboard",
						version: "0.1.0",
					},
				},
			});
			proc.stdin.write(initRequest + "\n");

			// Read the initialize response, then discover tools
			await this.readMcpResponse(proc, 5000);
			const tools = await this.discoverTools(proc, appId);

			this.servers.set(appId, { process: proc, tools, appId });

			const state: AppState = { id: appId, status: "active" };
			this.onStateChange(appId, state);
			return state;
		} catch (err) {
			const errorMsg =
				err instanceof Error ? err.message : "Failed to start server";
			const state: AppState = {
				id: appId,
				status: "error",
				error: errorMsg,
			};
			this.onStateChange(appId, state);
			return state;
		}
	}

	async stopServer(appId: AppId): Promise<AppState> {
		const server = this.servers.get(appId);
		if (server) {
			server.process.kill();
			this.servers.delete(appId);
		}
		const state: AppState = { id: appId, status: "idle" };
		this.onStateChange(appId, state);
		return state;
	}

	async toggleServer(appId: AppId): Promise<AppState> {
		if (this.servers.has(appId)) {
			return this.stopServer(appId);
		}
		return this.startServer(appId);
	}

	getActiveTools(): McpToolInfo[] {
		const tools: McpToolInfo[] = [];
		for (const server of this.servers.values()) {
			tools.push(...server.tools);
		}
		return tools;
	}

	/**
	 * Call a tool by its compound id (e.g. "whatsapp__send_message").
	 * This matches the protocol used by GhostChatAgent's tool_request.
	 */
	async callToolById(
		toolId: string,
		args: Record<string, unknown>,
	): Promise<string> {
		for (const server of this.servers.values()) {
			const tool = server.tools.find((t) => t.id === toolId);
			if (tool) {
				const result = await this.sendMcpRequest(
					server.process,
					"tools/call",
					{ name: tool.name, arguments: args },
				);
				// MCP tools/call returns { content: [{ type, text }] }
				if (
					result &&
					typeof result === "object" &&
					"content" in (result as any)
				) {
					const content = (result as any).content;
					if (Array.isArray(content)) {
						return content
							.map((c: any) => c.text ?? JSON.stringify(c))
							.join("\n");
					}
				}
				return typeof result === "string"
					? result
					: JSON.stringify(result);
			}
		}
		throw new Error(`Tool ${toolId} not found in any active MCP server`);
	}

	private async discoverTools(
		proc: Subprocess,
		appId: AppId,
	): Promise<McpToolInfo[]> {
		const listRequest = JSON.stringify({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/list",
			params: {},
		});
		proc.stdin.write(listRequest + "\n");

		const response = await this.readMcpResponse(proc, 5000);
		if (response?.result?.tools) {
			return response.result.tools.map(
				(t: { name: string; description?: string }) => ({
					id: `${appId}__${t.name}`,
					name: t.name,
					description: t.description || "",
					serverName: appId,
				}),
			);
		}
		return [];
	}

	private async sendMcpRequest(
		proc: Subprocess,
		method: string,
		params: unknown,
	): Promise<unknown> {
		const id = Math.floor(Math.random() * 1_000_000);
		const request = JSON.stringify({
			jsonrpc: "2.0",
			id,
			method,
			params,
		});
		proc.stdin.write(request + "\n");
		const response = await this.readMcpResponse(proc, 30000);
		if (response?.error) {
			throw new Error(response.error.message || "MCP call failed");
		}
		return response?.result;
	}

	private readMcpResponse(proc: Subprocess, timeoutMs: number): Promise<any> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error("MCP response timeout")),
				timeoutMs,
			);

			const reader = proc.stdout.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			const read = () => {
				reader
					.read()
					.then(({ done, value }) => {
						if (done) {
							clearTimeout(timeout);
							reject(new Error("MCP server closed"));
							return;
						}
						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split("\n");
						for (let i = 0; i < lines.length - 1; i++) {
							const line = lines[i].trim();
							if (line) {
								try {
									const parsed = JSON.parse(line);
									if (parsed.id !== undefined) {
										clearTimeout(timeout);
										reader.releaseLock();
										resolve(parsed);
										return;
									}
								} catch {
									// Not JSON, skip
								}
							}
						}
						buffer = lines[lines.length - 1];
						read();
					})
					.catch((err) => {
						clearTimeout(timeout);
						reject(err);
					});
			};
			read();
		});
	}

	shutdown() {
		for (const [appId] of this.servers) {
			this.stopServer(appId);
		}
	}
}
