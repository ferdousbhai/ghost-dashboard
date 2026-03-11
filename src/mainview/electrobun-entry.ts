// Electrobun webview entry point — sets up RPC then loads the React app
// This file is bundled by Electrobun (not Vite) to enable the RPC bridge

import { Electroview } from "electrobun/view";
import type { DashboardRPC, DashboardState } from "../shared/types";

// State bridge — the React app reads from this
(window as any).__ghostDashboardState = null;
(window as any).__ghostDashboardStateListeners = [] as Array<(s: DashboardState) => void>;

const rpc = Electroview.defineRPC<DashboardRPC>({
	maxRequestTime: 300_000,
	handlers: {
		webview: {
			requests: {},
			messages: {
				stateChanged(state: DashboardState) {
					(window as any).__ghostDashboardState = state;
					for (const listener of (window as any).__ghostDashboardStateListeners) {
						listener(state);
					}
				},
			},
		},
	},
});

const view = new Electroview({ rpc });

// Expose RPC to the React app
(window as any).__ghostRpc = view.rpc;

console.log("[electrobun-entry] RPC initialized, fetching initial state...");

// Fetch initial state after a short delay to ensure WebSocket is connected
setTimeout(async () => {
	try {
		const state = await view.rpc!.request.bun.getState();
		(window as any).__ghostDashboardState = state;
		for (const listener of (window as any).__ghostDashboardStateListeners) {
			listener(state);
		}
		console.log("[electrobun-entry] Got initial state, apps:", Object.keys(state.apps));
	} catch (err) {
		console.error("[electrobun-entry] getState failed:", err);
	}
}, 500);
