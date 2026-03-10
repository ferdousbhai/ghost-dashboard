import {
	BrowserWindow,
	BrowserView,
	ApplicationMenu,
	Updater,
} from "electrobun/bun";
import type {
	DashboardRPC,
	DashboardState,
	AppId,
	AppState,
} from "../shared/types";
import { TunnelClient } from "./tunnel";
import { McpManager } from "./mcp-manager";
import { getToken, getServerUrl } from "./config";

// --- State ---

const state: DashboardState = {
	tunnel: "disconnected",
	apps: {
		whatsapp: { id: "whatsapp", status: "idle" },
		gmail: { id: "gmail", status: "idle" },
		calendar: { id: "calendar", status: "idle" },
		drive: { id: "drive", status: "idle" },
		chrome: { id: "chrome", status: "idle" },
	},
};

let mainWindow: BrowserWindow<typeof rpc> | null = null;

function broadcastState() {
	try {
		mainWindow?.rpc?.message?.webview?.stateChanged(state);
	} catch {
		// Window may not be ready yet
	}
}

/** Push current MCP tool list to the server via tunnel */
function syncToolsToServer() {
	if (tunnel) {
		const tools = mcpManager.getActiveTools();
		tunnel.sendProjectContext(tools);
	}
}

// --- MCP Manager ---

const mcpManager = new McpManager((appId: AppId, appState: AppState) => {
	state.apps[appId] = appState;
	broadcastState();

	// When an app finishes starting or stops, sync tool list to server
	if (appState.status === "active" || appState.status === "idle") {
		syncToolsToServer();
	}
});

// --- Tunnel Client ---

let tunnel: TunnelClient | null = null;

function setupTunnel() {
	const token = getToken();
	if (!token) {
		state.tunnel = "disconnected";
		state.tunnelError = "Not logged in. Run ghost-cli login first.";
		broadcastState();
		return;
	}

	const serverUrl = getServerUrl();
	tunnel = new TunnelClient(
		serverUrl,
		token,
		// Status callback
		(status, error) => {
			state.tunnel = status;
			state.tunnelError = error;
			broadcastState();
		},
		// Command callback — execute raw shell commands from the ghost
		async (cmd) => {
			console.log(
				`[tunnel] Command: ${cmd.command} ${cmd.args.join(" ")}`,
			);
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
				return { type: "result", id: cmd.id, stdout, stderr, exitCode };
			} catch (err) {
				return {
					type: "result",
					id: cmd.id,
					stdout: "",
					stderr:
						err instanceof Error ? err.message : "Execution failed",
					exitCode: 1,
				};
			}
		},
		// Tool request callback — route MCP tool calls to local servers
		async (req) => {
			console.log(`[tunnel] Tool request: ${req.name}`, req.args);
			try {
				const result = await mcpManager.callToolById(req.name, req.args);
				return {
					type: "tool_response",
					toolCallId: req.toolCallId,
					result,
				};
			} catch (err) {
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

// --- RPC (main process <-> webview) ---

const rpc = BrowserView.defineRPC<DashboardRPC>({
	maxRequestTime: 30000,
	handlers: {
		bun: {
			requests: {
				async getState() {
					return state;
				},
				async toggleApp(appId: AppId) {
					return mcpManager.toggleServer(appId);
				},
				async connect() {
					if (!tunnel) setupTunnel();
					tunnel?.connect();
				},
				async disconnect() {
					tunnel?.disconnect();
				},
			},
			messages: {
				log(message: string) {
					console.log(`[renderer] ${message}`);
				},
			},
		},
	},
});

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

// Auto-connect tunnel on launch
setupTunnel();
if (tunnel) {
	tunnel.connect();
}

console.log("Ghost Dashboard started!");
