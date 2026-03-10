import { useState, useEffect, useCallback } from "react";
import type {
	DashboardState,
	AppId,
	TunnelStatus,
} from "../shared/types";
import { APPS } from "../shared/apps";

const STATUS_COLORS: Record<TunnelStatus, string> = {
	connected: "bg-green-400",
	connecting: "bg-yellow-400 animate-pulse",
	disconnected: "bg-gray-400",
	error: "bg-red-400",
};

const STATUS_LABELS: Record<TunnelStatus, string> = {
	connected: "Connected",
	connecting: "Connecting...",
	disconnected: "Disconnected",
	error: "Error",
};

// Stub for when Electroview RPC isn't available (e.g., Vite HMR dev mode)
const isElectrobun = typeof (window as any).electroview !== "undefined";

function App() {
	const [state, setState] = useState<DashboardState>({
		tunnel: "disconnected",
		apps: {
			whatsapp: { id: "whatsapp", status: "idle" },
			gmail: { id: "gmail", status: "idle" },
			calendar: { id: "calendar", status: "idle" },
			drive: { id: "drive", status: "idle" },
			chrome: { id: "chrome", status: "idle" },
		},
	});

	// Listen for state updates from main process
	useEffect(() => {
		if (!isElectrobun) return;

		// Get initial state
		(window as any).electroview.rpc.request.bun
			.getState()
			.then((s: DashboardState) => setState(s))
			.catch(() => {});

		// Subscribe to state changes via RPC messages
		const handler = (newState: DashboardState) => {
			setState(newState);
		};

		if ((window as any).electroview?.rpc?.handlers?.webview?.messages) {
			(window as any).electroview.rpc.handlers.webview.messages.stateChanged =
				handler;
		}
	}, []);

	const handleToggleApp = useCallback(async (appId: AppId) => {
		if (!isElectrobun) {
			// Dev mode stub — toggle locally for UI testing
			setState((prev) => ({
				...prev,
				apps: {
					...prev.apps,
					[appId]: {
						...prev.apps[appId],
						status:
							prev.apps[appId].status === "active"
								? "idle"
								: "active",
					},
				},
			}));
			return;
		}
		try {
			await (window as any).electroview.rpc.request.bun.toggleApp(appId);
		} catch (err) {
			console.error("Failed to toggle app:", err);
		}
	}, []);

	const handleTunnelToggle = useCallback(async () => {
		if (!isElectrobun) {
			setState((prev) => ({
				...prev,
				tunnel:
					prev.tunnel === "connected" ? "disconnected" : "connected",
			}));
			return;
		}
		try {
			if (state.tunnel === "connected") {
				await (window as any).electroview.rpc.request.bun.disconnect();
			} else {
				await (window as any).electroview.rpc.request.bun.connect();
			}
		} catch (err) {
			console.error("Failed to toggle tunnel:", err);
		}
	}, [state.tunnel]);

	const activeCount = Object.values(state.apps).filter(
		(a) => a.status === "active",
	).length;

	return (
		<div className="min-h-screen bg-gray-950 text-white flex flex-col select-none">
			{/* Desktop area */}
			<div className="flex-1 p-8">
				<div className="grid grid-cols-5 gap-6 max-w-2xl mx-auto mt-8">
					{APPS.map((app) => {
						const appState = state.apps[app.id];
						const isActive = appState?.status === "active";
						const isLoading = appState?.status === "loading";
						const hasError = appState?.status === "error";

						return (
							<button
								key={app.id}
								onClick={() => handleToggleApp(app.id)}
								className={`
									flex flex-col items-center gap-2 p-4 rounded-2xl
									transition-all duration-200 cursor-pointer
									${isActive ? "bg-white/15 ring-2 ring-white/30 shadow-lg shadow-white/5" : "bg-white/5 hover:bg-white/10"}
									${isLoading ? "animate-pulse" : ""}
									${hasError ? "ring-2 ring-red-500/50" : ""}
								`}
								title={
									hasError
										? appState.error
										: app.description
								}
							>
								<div
									className={`
										w-14 h-14 rounded-xl flex items-center justify-center text-2xl
										${isActive ? app.color : "bg-white/10"}
										transition-colors duration-200
									`}
								>
									{app.icon}
								</div>
								<span className="text-xs font-medium text-white/80">
									{app.name}
								</span>
								{isActive && (
									<div className="w-1.5 h-1.5 rounded-full bg-green-400" />
								)}
								{hasError && (
									<div className="w-1.5 h-1.5 rounded-full bg-red-400" />
								)}
							</button>
						);
					})}
				</div>
			</div>

			{/* Status bar */}
			<div className="border-t border-white/10 bg-gray-900/80 px-4 py-2 flex items-center justify-between text-xs">
				<div className="flex items-center gap-3">
					<button
						onClick={handleTunnelToggle}
						className="flex items-center gap-2 hover:bg-white/10 rounded px-2 py-1 transition-colors cursor-pointer"
					>
						<div
							className={`w-2 h-2 rounded-full ${STATUS_COLORS[state.tunnel]}`}
						/>
						<span className="text-white/60">
							Tunnel: {STATUS_LABELS[state.tunnel]}
						</span>
					</button>
					{state.tunnelError && (
						<span className="text-red-400/80">
							{state.tunnelError}
						</span>
					)}
				</div>
				<div className="text-white/40">
					{activeCount > 0
						? `${activeCount} app${activeCount > 1 ? "s" : ""} active`
						: "No apps active"}
				</div>
			</div>
		</div>
	);
}

export default App;
