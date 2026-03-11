import {
	BrowserWindow,
	BrowserView,
	ApplicationMenu,
	Updater,
} from "electrobun/bun";
import type {
	DashboardRPC,
	DashboardState,
	AppState,
	ApprovalRequest,
	ActivityEvent,
	ActivityType,
} from "../shared/types";
import { TunnelClient } from "./tunnel";
import { McpManager } from "./mcp-manager";
import { getToken, clearToken, getBaseUrl, loadMcpConfig, mcpConfigExists, saveMcpConfig, isFirstRun, dismissFirstRun } from "./config";
import { loginViaBrowser } from "./auth";
import { isApproved, approvePattern, clearApprovals } from "./permissions";
import { collectProjectContext } from "./context";
import { LOCAL_TOOLS, executeLocalTool } from "./local-tools";

// --- State ---

// --- Service apps (non-MCP, managed via systemd) ---

const SERVICE_APPS: Record<string, { unit: string; cli: string }> = {
	whatsapp: {
		unit: "whatsapp-bridge",
		cli: `${process.env.HOME}/.claude/skills/whatsapp/wa`,
	},
};

async function getServiceStatus(unit: string): Promise<"active" | "idle"> {
	try {
		const proc = Bun.spawn(["systemctl", "--user", "is-active", unit], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		return out.trim() === "active" ? "active" : "idle";
	} catch {
		return "idle";
	}
}

async function toggleService(appId: string): Promise<AppState> {
	const svc = SERVICE_APPS[appId];
	if (!svc) return { id: appId, status: "error", error: "Unknown service" };

	const current = await getServiceStatus(svc.unit);
	const action = current === "active" ? "stop" : "start";

	try {
		const proc = Bun.spawn(["systemctl", "--user", action, svc.unit], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;

		// Give the service a moment to start
		if (action === "start") {
			await new Promise((r) => setTimeout(r, 2000));
		}

		const newStatus = await getServiceStatus(svc.unit);
		return { id: appId, status: newStatus };
	} catch (err) {
		return {
			id: appId,
			status: "error",
			error: err instanceof Error ? err.message : "Service toggle failed",
		};
	}
}

function buildInitialApps(): Record<string, AppState> {
	const config = loadMcpConfig();
	const apps: Record<string, AppState> = {};
	for (const id of Object.keys(config.mcpServers)) {
		apps[id] = { id, status: "idle" };
	}
	// Add service apps
	for (const id of Object.keys(SERVICE_APPS)) {
		apps[id] = { id, status: "idle" };
	}
	return apps;
}

const initialApps = buildInitialApps();
console.log("[init] Apps from config:", Object.keys(initialApps));
console.log("[init] Token present:", !!getToken());

// Check service app statuses on startup
(async () => {
	for (const [id, svc] of Object.entries(SERVICE_APPS)) {
		const status = await getServiceStatus(svc.unit);
		if (initialApps[id]) {
			initialApps[id].status = status;
		}
	}
})();

const MAX_ACTIVITY_LOG = 50;
let activityCounter = 0;

function pushActivity(
	type: ActivityType,
	summary: string,
	opts?: { detail?: string; appId?: string; status?: ActivityEvent["status"] },
): string {
	const id = `act_${++activityCounter}`;
	const event: ActivityEvent = {
		id,
		timestamp: Date.now(),
		type,
		summary,
		detail: opts?.detail,
		appId: opts?.appId,
		status: opts?.status ?? "success",
	};
	state.activityLog.push(event);
	if (state.activityLog.length > MAX_ACTIVITY_LOG) {
		state.activityLog.splice(0, state.activityLog.length - MAX_ACTIVITY_LOG);
	}
	scheduleBroadcast();
	return id;
}

function updateActivity(id: string, updates: Partial<ActivityEvent>) {
	const event = state.activityLog.find((e) => e.id === id);
	if (event) Object.assign(event, updates);
}

const state: DashboardState = {
	tunnel: "disconnected",
	apps: initialApps,
	loggedIn: !!getToken(),
	hasMcpConfig: mcpConfigExists(),
	firstRun: isFirstRun(),
	pendingApprovals: [],
	activityLog: [],
};

let lastTunnelStatus: string | null = null;

let mainWindow: BrowserWindow<typeof rpc> | null = null;

let broadcastPending = false;
function scheduleBroadcast() {
	if (broadcastPending) return;
	broadcastPending = true;
	queueMicrotask(() => {
		broadcastPending = false;
		broadcastState();
	});
}

function broadcastState() {
	// Primary: inject state via executeJavascript (works even without RPC WebSocket)
	try {
		const json = JSON.stringify(state);
		mainWindow?.webview?.executeJavascript(
			`window.__ghostState && window.__ghostState(${json})`,
		);
	} catch {
		// Webview not ready yet
	}

	// Fallback: try RPC too
	try {
		mainWindow?.rpc?.message?.webview?.stateChanged(state);
	} catch {
		// RPC not connected
	}
}

// --- Pending approvals ---

const pendingResolvers = new Map<
	string,
	{
		resolve: (value: { stdout: string; stderr: string; exitCode: number }) => void;
		command: string;
		args: string[];
		cwd?: string;
	}
>();

// --- Project context ---

async function syncToolsToServer() {
	if (!tunnel) return;
	const tools = mcpManager.getActiveTools();
	const ctx = await collectProjectContext();
	tunnel.sendProjectContext(tools, {
		gitBranch: ctx.gitBranch,
		gitStatus: ctx.gitStatus,
		fileTree: ctx.fileTree,
	});
}

// --- MCP Manager ---

const mcpManager = new McpManager((appId, appState) => {
	state.apps[appId] = appState;
	broadcastState();

	if (appState.status === "active" || appState.status === "idle") {
		syncToolsToServer();
	}
});

// Check binary availability on startup
for (const server of mcpManager.getConfiguredServers()) {
	if (state.apps[server.id]) {
		state.apps[server.id].installed = server.installed;
	}
}

// --- Tunnel Client ---

let tunnel: TunnelClient | null = null;

async function executeCommand(cmd: {
	id: string;
	command: string;
	args: string[];
	cwd?: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const fullCommand = [cmd.command, ...cmd.args].join(" ");

	if (isApproved(fullCommand)) {
		return runCommand(cmd);
	}

	// Need approval — send to UI
	const approval: ApprovalRequest = {
		id: cmd.id,
		command: cmd.command,
		args: cmd.args,
		cwd: cmd.cwd,
	};
	state.pendingApprovals.push(approval);
	broadcastState();

	return new Promise((resolve) => {
		pendingResolvers.set(cmd.id, {
			resolve,
			command: cmd.command,
			args: cmd.args,
			cwd: cmd.cwd,
		});
	});
}

async function runCommand(cmd: {
	command: string;
	args: string[];
	cwd?: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	try {
		const proc = Bun.spawn([cmd.command, ...cmd.args], {
			cwd: cmd.cwd || process.cwd(),
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		return { stdout, stderr, exitCode };
	} catch (err) {
		return {
			stdout: "",
			stderr: err instanceof Error ? err.message : "Execution failed",
			exitCode: 1,
		};
	}
}

function setupTunnel() {
	const token = getToken();
	if (!token) {
		state.tunnel = "disconnected";
		state.tunnelError = "Not logged in";
		broadcastState();
		return;
	}

	const TUNNEL_MESSAGES: Record<string, (err?: string) => string> = {
		connected: () => "Tunnel connected",
		connecting: () => "Connecting...",
		error: (err) => `Connection error: ${err ?? "unknown"}`,
		disconnected: () => "Tunnel disconnected",
	};

	const serverUrl = getBaseUrl();
	tunnel = new TunnelClient(
		serverUrl,
		token,
		(status, error) => {
			// Skip redundant "connecting" events during reconnect
			if (status === "connecting" && lastTunnelStatus === "connecting") return;
			lastTunnelStatus = status;

			state.tunnel = status;
			state.tunnelError = error;
			if (status === "disconnected") clearApprovals();
			pushActivity(
				"connection",
				TUNNEL_MESSAGES[status](error),
				{ status: status === "error" ? "error" : "success" },
			);
		},
		// Command callback
		async (cmd) => {
			console.log(
				`[tunnel] Command: ${cmd.command} ${cmd.args.join(" ")}`,
			);
			const fullCmd = [cmd.command, ...cmd.args].join(" ");
			const actId = pushActivity("command", fullCmd, {
				detail: cmd.cwd,
				status: "pending",
			});
			const result = await executeCommand(cmd);
			updateActivity(actId, {
				status: result.exitCode === 0 ? "success" : "error",
			});
			scheduleBroadcast();
			return { type: "result", id: cmd.id, ...result };
		},
		// Tool request callback — local tools first, then MCP
		async (req) => {
			console.log(`[tunnel] Tool request: ${req.name}`, req.args);
			const actId = pushActivity("tool_call", req.name, {
				detail: JSON.stringify(req.args).slice(0, 200),
				status: "pending",
			});
			try {
				let result: string;
				if (LOCAL_TOOLS.has(req.name)) {
					result = await executeLocalTool(req.name, req.args);
				} else {
					result = await mcpManager.callToolById(req.name, req.args);
				}
				updateActivity(actId, { status: "success" });
				scheduleBroadcast();
				return {
					type: "tool_response",
					toolCallId: req.toolCallId,
					result,
				};
			} catch (err) {
				updateActivity(actId, { status: "error" });
				scheduleBroadcast();
				return {
					type: "tool_response",
					toolCallId: req.toolCallId,
					error:
						err instanceof Error
							? err.message
							: "Tool execution failed",
				};
			}
		},
	);
}

// --- Shared handlers (used by both RPC and HTTP bridge) ---

async function handleToggleApp(appId: string): Promise<AppState> {
	let result: AppState;
	if (SERVICE_APPS[appId]) {
		result = await toggleService(appId);
		state.apps[appId] = result;
	} else {
		result = await mcpManager.toggleServer(appId);
	}
	pushActivity("app", `${appId} ${result.status === "active" ? "started" : "stopped"}`, {
		appId,
		status: result.status === "error" ? "error" : "success",
	});
	return result;
}

function handleConnect() {
	if (!tunnel) setupTunnel();
	tunnel?.connect();
}

async function handleLogin() {
	try {
		await loginViaBrowser();
		state.loggedIn = true;
		scheduleBroadcast();
		setupTunnel();
		tunnel?.connect();
	} catch (err) {
		console.error("[auth] Login failed:", err);
		throw err;
	}
}

function handleLogout() {
	tunnel?.disconnect();
	tunnel = null;
	clearToken();
	state.loggedIn = false;
	state.tunnel = "disconnected";
	state.tunnelError = undefined;
	scheduleBroadcast();
}

function handleSetupDefaults() {
	// loadMcpConfig() returns defaults (chrome) when file doesn't exist
	const config = loadMcpConfig();
	if (!config.mcpServers.filesystem) {
		config.mcpServers.filesystem = {
			command: "mcp-server-filesystem",
			args: [process.env.HOME ?? "/home"],
			npmPackage: "@anthropic-ai/mcp-server-filesystem",
		};
	}
	saveMcpConfig(config);
	state.hasMcpConfig = true;

	for (const id of Object.keys(config.mcpServers)) {
		if (!state.apps[id]) {
			state.apps[id] = { id, status: "idle" };
		}
	}
	scheduleBroadcast();
}

function handleDismissOnboarding() {
	dismissFirstRun();
	state.firstRun = false;
	scheduleBroadcast();
}

// --- RPC (main process <-> webview) ---

const rpc = BrowserView.defineRPC<DashboardRPC>({
	maxRequestTime: 300_000, // 5min for login flow
	handlers: {
		bun: {
			requests: {
				async getState() {
					return state;
				},
				toggleApp: handleToggleApp,
				async connect() { handleConnect(); },
				async disconnect() { tunnel?.disconnect(); },
				login: handleLogin,
				async logout() { handleLogout(); },
				async setupDefaults() { handleSetupDefaults(); },
				async dismissOnboarding() { handleDismissOnboarding(); },
				approveCommand: handleApproveCommand,
				denyCommand: handleDenyCommand,
			},
			messages: {
				log(message: string) {
					console.log(`[renderer] ${message}`);
				},
			},
		},
	},
});

// --- HTTP Bridge (webview -> main, fallback for broken WebSocket RPC) ---

const bridgeServer = Bun.serve({
	port: 0, // Random available port
	async fetch(req) {
		const url = new URL(req.url);
		const headers = { "Access-Control-Allow-Origin": "*" };

		if (req.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					...headers,
					"Access-Control-Allow-Methods": "POST",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}

		try {
			const body = await req.json();
			const { method, args } = body;

			let result: any;
			switch (method) {
				case "getState":
					result = state;
					break;
				case "toggleApp":
					result = await handleToggleApp(args[0]);
					break;
				case "connect":
					handleConnect();
					break;
				case "disconnect":
					tunnel?.disconnect();
					break;
				case "login":
					await handleLogin();
					break;
				case "logout":
					handleLogout();
					break;
				case "setupDefaults":
					handleSetupDefaults();
					break;
				case "dismissOnboarding":
					handleDismissOnboarding();
					break;
				case "approveCommand":
					await handleApproveCommand(args[0], args[1]);
					break;
				case "denyCommand":
					await handleDenyCommand(args[0]);
					break;
				default:
					return Response.json({ error: "Unknown method" }, { status: 400, headers });
			}
			return Response.json({ result }, { headers });
		} catch (err) {
			return Response.json(
				{ error: err instanceof Error ? err.message : "Unknown error" },
				{ status: 500, headers },
			);
		}
	},
});

console.log(`[bridge] HTTP bridge on port ${bridgeServer.port}`);

// Helper functions for approval
async function handleApproveCommand(id: string, pattern: "once" | "always") {
	const pending = pendingResolvers.get(id);
	if (!pending) return;
	const fullCommand = [pending.command, ...pending.args].join(" ");
	if (pattern === "always") approvePattern(fullCommand);
	pendingResolvers.delete(id);
	state.pendingApprovals = state.pendingApprovals.filter((a) => a.id !== id);
	pushActivity("approval", `Allowed: ${fullCommand}`, {
		detail: pattern === "always" ? "always allow" : "once",
	});
	const result = await runCommand({ command: pending.command, args: pending.args, cwd: pending.cwd });
	pending.resolve(result);
}

async function handleDenyCommand(id: string) {
	const pending = pendingResolvers.get(id);
	if (!pending) return;
	const fullCommand = [pending.command, ...pending.args].join(" ");
	pendingResolvers.delete(id);
	state.pendingApprovals = state.pendingApprovals.filter((a) => a.id !== id);
	pushActivity("approval", `Denied: ${fullCommand}`, { status: "error" });
	pending.resolve({ stdout: "", stderr: "Command denied by user", exitCode: 1 });
}

// --- Window ---

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(
				`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`,
			);
			return DEV_SERVER_URL;
		} catch {
			// Vite not running, use bundled
		}
	}
	return "views://mainview/index.html";
}

const url = await getMainViewUrl();

ApplicationMenu.setApplicationMenu([
	{
		submenu: [{ label: "Quit", role: "quit" }],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
]);

mainWindow = new BrowserWindow<typeof rpc>({
	title: "Ghost Dashboard",
	url,
	rpc,
	frame: {
		width: 720,
		height: 540,
		x: 200,
		y: 200,
	},
});

// Auto-connect tunnel on launch if logged in
if (state.loggedIn) {
	setupTunnel();
	if (tunnel) {
		tunnel.connect();
	}
}

console.log("Ghost Dashboard started!");

// Push state + bridge port to webview once it's ready
try {
	mainWindow?.webview?.on("dom-ready", () => {
		console.log("[main] Webview ready, injecting bridge port and state");
		mainWindow?.webview?.executeJavascript(
			`window.__ghostBridgePort = ${bridgeServer.port}`,
		);
		broadcastState();
	});
} catch {
	// dom-ready not supported
}

// Retry pushes
setTimeout(() => {
	mainWindow?.webview?.executeJavascript(
		`window.__ghostBridgePort = ${bridgeServer.port}`,
	);
	broadcastState();
}, 1000);
setTimeout(() => broadcastState(), 3000);
