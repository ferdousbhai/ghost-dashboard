// MCP Server Manager — config-driven, with auto-install support
// Reads server configs from ~/.summonghost/mcp.json
// Spawns MCP servers via stdio, discovers tools, routes calls

import { type Subprocess } from "bun";
import type { AppId, AppState } from "../shared/types";
import { loadMcpConfig, type McpServerConfig } from "./config";
import type { McpToolInfo } from "./tunnel";

interface ManagedServer {
	process: Subprocess;
	tools: McpToolInfo[];
	appId: string;
	config: McpServerConfig;
}

type StateCallback = (appId: string, state: AppState) => void;

export class McpManager {
	private servers = new Map<string, ManagedServer>();
	private onStateChange: StateCallback;
	private nextRpcId = 10;

	constructor(onStateChange: StateCallback) {
		this.onStateChange = onStateChange;
	}

	/** Get all configured server IDs with their installation status */
	getConfiguredServers(): Array<{ id: string; installed: boolean }> {
		const config = loadMcpConfig();
		return Object.entries(config.mcpServers).map(([id, cfg]) => ({
			id,
			// npx/bunx auto-install, so always "available"
			installed:
				cfg.command === "npx" ||
				cfg.command === "bunx" ||
				this.isCommandAvailable(cfg.command),
		}));
	}

	async startServer(appId: string): Promise<AppState> {
		if (this.servers.has(appId)) {
			return { id: appId, status: "active" };
		}

		this.onStateChange(appId, { id: appId, status: "loading" });

		const config = loadMcpConfig();
		const serverConfig = config.mcpServers[appId];

		if (!serverConfig) {
			const state: AppState = {
				id: appId,
				status: "error",
				error: `No config for "${appId}" in ~/.summonghost/mcp.json`,
			};
			this.onStateChange(appId, state);
			return state;
		}

		// npx/bunx handle their own installation; skip binary check for them
		const isAutoInstallRunner =
			serverConfig.command === "npx" || serverConfig.command === "bunx";

		if (!isAutoInstallRunner && !this.isCommandAvailable(serverConfig.command)) {
			if (serverConfig.npmPackage) {
				try {
					await this.installNpmPackage(serverConfig.npmPackage);
				} catch (err) {
					const state: AppState = {
						id: appId,
						status: "error",
						error: `Install failed: ${err instanceof Error ? err.message : "Unknown error"}`,
						installed: false,
					};
					this.onStateChange(appId, state);
					return state;
				}
			} else {
				const state: AppState = {
					id: appId,
					status: "error",
					error: `Command "${serverConfig.command}" not found. Install it or add "npmPackage" to mcp.json.`,
					installed: false,
				};
				this.onStateChange(appId, state);
				return state;
			}
		}

		try {
			const args = serverConfig.args ?? [];
			const proc = Bun.spawn([serverConfig.command, ...args], {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, ...serverConfig.env },
			});

			// Log stderr for debugging
			this.pipeStderr(appId, proc);

			// MCP handshake: initialize → notifications/initialized → tools/list
			// 60s timeout for npx first-run (needs to download package)
			await this.sendRpcRequest(
				proc,
				"initialize",
				{
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "ghost-dashboard", version: "0.1.0" },
				},
				60_000,
			);

			// Send initialized notification (no response expected)
			proc.stdin.write(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "notifications/initialized",
					params: {},
				}) + "\n",
			);

			const tools = await this.discoverTools(proc, appId);

			this.servers.set(appId, {
				process: proc,
				tools,
				appId,
				config: serverConfig,
			});

			const state: AppState = {
				id: appId,
				status: "active",
				toolCount: tools.length,
				installed: true,
			};
			this.onStateChange(appId, state);
			return state;
		} catch (err) {
			const errorMsg =
				err instanceof Error ? err.message : "Failed to start server";
			const state: AppState = {
				id: appId,
				status: "error",
				error: errorMsg,
				installed: true,
			};
			this.onStateChange(appId, state);
			return state;
		}
	}

	async stopServer(appId: string): Promise<AppState> {
		const server = this.servers.get(appId);
		if (server) {
			server.process.kill();
			this.servers.delete(appId);
		}
		const state: AppState = { id: appId, status: "idle" };
		this.onStateChange(appId, state);
		return state;
	}

	async toggleServer(appId: string): Promise<AppState> {
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

	/** Call a tool by its compound id (e.g. "mcp__gmail__send_message") */
	async callToolById(
		toolId: string,
		args: Record<string, unknown>,
	): Promise<string> {
		for (const server of this.servers.values()) {
			const tool = server.tools.find((t) => t.id === toolId);
			if (tool) {
				const result = await this.sendRpcRequest(
					server.process,
					"tools/call",
					{ name: tool.name, arguments: args },
				);
				if (result && typeof result === "object" && "content" in result) {
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

	shutdown() {
		for (const [appId] of this.servers) {
			this.stopServer(appId);
		}
	}

	// --- Private ---

	private isCommandAvailable(command: string): boolean {
		try {
			const result = Bun.spawnSync(["which", command], {
				stdout: "pipe",
				stderr: "pipe",
			});
			return result.exitCode === 0;
		} catch {
			return false;
		}
	}

	private async installNpmPackage(pkg: string): Promise<void> {
		console.log(`[mcp] Auto-installing npm package: ${pkg}`);
		const proc = Bun.spawn(["bun", "install", "-g", pkg], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			throw new Error(`bun install -g ${pkg} failed: ${stderr}`);
		}
		console.log(`[mcp] Installed ${pkg}`);
	}

	private async discoverTools(
		proc: Subprocess,
		appId: string,
	): Promise<McpToolInfo[]> {
		const result = await this.sendRpcRequest(proc, "tools/list", {});
		if (result && typeof result === "object" && "tools" in result) {
			return (result as any).tools.map(
				(t: { name: string; description?: string }) => ({
					id: `mcp__${appId}__${t.name}`,
					name: t.name,
					description: t.description || "",
					serverName: appId,
				}),
			);
		}
		return [];
	}

	private async sendRpcRequest(
		proc: Subprocess,
		method: string,
		params: unknown,
		timeoutMs = 30_000,
	): Promise<unknown> {
		const id = this.nextRpcId++;
		const request = JSON.stringify({
			jsonrpc: "2.0",
			id,
			method,
			params,
		});
		proc.stdin.write(request + "\n");
		const response = await this.readRpcResponse(proc, timeoutMs);
		if (response?.error) {
			throw new Error(
				response.error.message || `MCP ${method} failed`,
			);
		}
		return response?.result;
	}

	private readRpcResponse(proc: Subprocess, timeoutMs: number): Promise<any> {
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

	private pipeStderr(appId: string, proc: Subprocess) {
		const reader = proc.stderr.getReader();
		const decoder = new TextDecoder();
		const read = () => {
			reader.read().then(({ done, value }) => {
				if (done) return;
				const text = decoder.decode(value, { stream: true }).trim();
				if (text) console.error(`[mcp:${appId}] ${text}`);
				read();
			}).catch(() => {});
		};
		read();
	}
}
