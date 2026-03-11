// Bridge between main process and React app
//
// Main → Webview: executeJavascript injects state via window.__ghostState()
// Webview → Main: HTTP POST to localhost bridge server

import type { DashboardState } from "../shared/types";

type StateListener = (state: DashboardState) => void;

const listeners: StateListener[] = [];

// Main process pushes state by calling window.__ghostState(data)
(window as any).__ghostState = (state: DashboardState) => {
	for (const listener of listeners) {
		listener(state);
	}
};

export function onStateChanged(listener: StateListener) {
	listeners.push(listener);
}

/** Call a method on the main process via HTTP bridge */
async function callMain(method: string, ...args: any[]): Promise<any> {
	const port = (window as any).__ghostBridgePort;
	if (!port) {
		console.warn("[rpc] Bridge port not set yet");
		return null;
	}

	const res = await fetch(`http://localhost:${port}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ method, args }),
	});

	const data = await res.json();
	if (data.error) throw new Error(data.error);
	return data.result;
}

// Proxy object that mimics the Electrobun RPC interface
const rpcProxy = {
	request: {
		bun: {
			getState: () => callMain("getState"),
			toggleApp: (appId: string) => callMain("toggleApp", appId),
			connect: () => callMain("connect"),
			disconnect: () => callMain("disconnect"),
			login: () => callMain("login"),
			logout: () => callMain("logout"),
			setupDefaults: () => callMain("setupDefaults"),
			dismissOnboarding: () => callMain("dismissOnboarding"),
			approveCommand: (id: string, pattern: "once" | "always") =>
				callMain("approveCommand", id, pattern),
			denyCommand: (id: string) => callMain("denyCommand", id),
		},
	},
};

export function getRpc() {
	return rpcProxy;
}

export function waitForRpc(): Promise<void> {
	return new Promise((resolve) => {
		if ((window as any).__ghostBridgePort) {
			resolve();
			return;
		}
		const check = setInterval(() => {
			if ((window as any).__ghostBridgePort) {
				clearInterval(check);
				resolve();
			}
		}, 100);
		setTimeout(() => {
			clearInterval(check);
			resolve();
		}, 5000);
	});
}

export const isElectrobun =
	typeof (window as any).__electrobunWebviewId !== "undefined";
