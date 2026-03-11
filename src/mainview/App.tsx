import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
	DashboardState,
	AppId,
	TunnelStatus,
	ApprovalRequest,
	ActivityEvent,
} from "../shared/types";
import { getServerMeta } from "../shared/apps";
import { getRpc, onStateChanged, waitForRpc } from "./rpc";

const STATUS_LABELS: Record<TunnelStatus, string> = {
	connected: "Connected",
	connecting: "Connecting...",
	disconnected: "Disconnected",
	error: "Error",
};

const ACTIVITY_ICONS: Record<string, string> = {
	tool_call: "\u26A1",
	command: "\u25B6",
	approval: "\u2714",
	connection: "\u25CE",
	app: "\u25C9",
	error: "\u2718",
};

function relativeTime(timestamp: number): string {
	const delta = Math.floor((Date.now() - timestamp) / 1000);
	if (delta < 5) return "now";
	if (delta < 60) return `${delta}s ago`;
	if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
	return `${Math.floor(delta / 3600)}h ago`;
}

function App() {
	const [state, setState] = useState<DashboardState>({
		tunnel: "disconnected",
		apps: {},
		loggedIn: false,
		hasMcpConfig: false,
		firstRun: true,
		pendingApprovals: [],
		activityLog: [],
	});
	const [loginLoading, setLoginLoading] = useState(false);

	useEffect(() => {
		onStateChanged((newState) => setState(newState));

		waitForRpc().then(() => {
			const rpc = getRpc();
			if (rpc) {
				rpc.request.bun
					.getState()
					.then((s: DashboardState) => setState(s))
					.catch(() => {});
			}
		});
	}, []);

	const handleToggleApp = useCallback(async (appId: AppId) => {
		try {
			await getRpc().request.bun.toggleApp(appId);
		} catch (err) {
			console.error("Failed to toggle app:", err);
		}
	}, []);

	const handleTunnelToggle = useCallback(async () => {
		try {
			if (state.tunnel === "connected") {
				await getRpc().request.bun.disconnect();
			} else {
				await getRpc().request.bun.connect();
			}
		} catch (err) {
			console.error("Failed to toggle tunnel:", err);
		}
	}, [state.tunnel]);

	const handleLogin = useCallback(async () => {
		setLoginLoading(true);
		try {
			await getRpc().request.bun.login();
		} catch (err) {
			console.error("Login failed:", err);
		} finally {
			setLoginLoading(false);
		}
	}, []);

	const handleLogout = useCallback(async () => {
		await getRpc().request.bun.logout();
	}, []);

	const handleApprove = useCallback(
		async (id: string, pattern: "once" | "always") => {
			try {
				await getRpc().request.bun.approveCommand(id, pattern);
			} catch (err) {
				console.error("Failed to approve command:", err);
			}
		},
		[],
	);

	const handleDeny = useCallback(async (id: string) => {
		try {
			await getRpc().request.bun.denyCommand(id);
		} catch (err) {
			console.error("Failed to deny command:", err);
		}
	}, []);

	const appIds = Object.keys(state.apps);

	const sortedAppIds = useMemo(
		() =>
			[...appIds].sort((a, b) => {
				const aActive = state.apps[a]?.status === "active" ? 0 : 1;
				const bActive = state.apps[b]?.status === "active" ? 0 : 1;
				return aActive - bActive;
			}),
		[state.apps],
	);

	const { activeCount, totalTools } = useMemo(() => {
		let active = 0;
		let tools = 0;
		for (const a of Object.values(state.apps)) {
			if (a.status === "active") {
				active++;
				tools += a.toolCount ?? 0;
			}
		}
		return { activeCount: active, totalTools: tools };
	}, [state.apps]);

	const currentAction = useMemo(() => {
		for (let i = state.activityLog.length - 1; i >= 0; i--) {
			if (state.activityLog[i].status === "pending")
				return state.activityLog[i].summary;
		}
		return undefined;
	}, [state.activityLog]);

	const handleSetupDefaults = useCallback(async () => {
		try {
			await getRpc().request.bun.setupDefaults();
		} catch (err) {
			console.error("Failed to setup defaults:", err);
		}
	}, []);

	const handleDismissOnboarding = useCallback(async () => {
		try {
			await getRpc().request.bun.dismissOnboarding();
		} catch (err) {
			console.error("Failed to dismiss onboarding:", err);
		}
	}, []);

	// Show welcome screen when not logged in
	if (!state.loggedIn) {
		return (
			<WelcomeScreen
				hasMcpConfig={state.hasMcpConfig}
				appCount={appIds.length}
				onLogin={handleLogin}
				onSetupDefaults={handleSetupDefaults}
				loginLoading={loginLoading}
			/>
		);
	}

	return (
		<div className="h-screen bg-surface text-white flex flex-col select-none overflow-hidden">
			{/* Onboarding overlay (shown once after first login) */}
			{state.firstRun && state.loggedIn && appIds.length > 0 && (
				<OnboardingOverlay
					apps={state.apps}
					username={state.username}
					onToggle={handleToggleApp}
					onDismiss={handleDismissOnboarding}
				/>
			)}

			{/* Header */}
			<div className="border-b border-white/10 bg-surface-raised/50 px-4 py-2.5 flex items-center justify-between shrink-0">
				<h1 className="text-sm font-semibold tracking-tight text-white/70 font-mono">
					Ghost Dashboard
				</h1>
				<button
					onClick={handleLogout}
					className="text-xs text-white/40 hover:text-white/70 transition-colors cursor-pointer"
				>
					Log out
				</button>
			</div>

			{/* Main content area — 2-panel layout */}
			<div className="flex-1 flex min-h-0">
				{appIds.length === 0 ? (
					<EmptyState />
				) : (
					<>
						{/* Left panel: Tools sidebar */}
						<div className="w-[45%] border-r border-white/10 flex flex-col min-h-0">
							<div className="px-3 py-2 border-b border-white/5">
								<span className="text-[10px] font-medium text-white/30 uppercase tracking-widest">
									Tools
								</span>
							</div>
							<div className="flex-1 overflow-y-auto">
								{sortedAppIds.map((appId) => (
									<AppRow
										key={appId}
										appId={appId}
										meta={getServerMeta(appId)}
										appState={state.apps[appId]}
										onToggle={handleToggleApp}
									/>
								))}
							</div>
						</div>

						{/* Right panel: Activity feed */}
						<div className="flex-1 flex flex-col min-h-0">
							<div className="px-3 py-2 border-b border-white/5">
								<span className="text-[10px] font-medium text-white/30 uppercase tracking-widest">
									Activity
								</span>
							</div>
							<ActivityFeed
								events={state.activityLog}
								pendingApprovals={state.pendingApprovals}
								onApprove={handleApprove}
								onDeny={handleDeny}
							/>
						</div>
					</>
				)}
			</div>

			{/* Status bar */}
			<div className="border-t border-white/10 bg-surface-raised/80 px-3 py-1.5 flex items-center justify-between text-xs shrink-0">
				<div className="flex items-center gap-2 min-w-0">
					<button
						onClick={handleTunnelToggle}
						className="flex items-center gap-2 hover:bg-white/10 rounded px-2 py-0.5 transition-colors cursor-pointer shrink-0"
					>
						<GhostPulse
							tunnel={state.tunnel}
							active={!!currentAction}
						/>
						<span className="text-white/60">
							{STATUS_LABELS[state.tunnel]}
						</span>
					</button>
					{currentAction && (
						<span className="text-cyan-400/70 font-mono text-[11px] truncate min-w-0">
							{"\u26A1"} {currentAction}
						</span>
					)}
					{state.tunnelError && !currentAction && (
						<span className="text-red-400/80 truncate">
							{state.tunnelError}
						</span>
					)}
				</div>
				<div className="text-white/40 shrink-0">
					{activeCount > 0
						? `${activeCount} app${activeCount > 1 ? "s" : ""} \u00B7 ${totalTools} tool${totalTools !== 1 ? "s" : ""}`
						: appIds.length > 0
							? "No apps active"
							: ""}
				</div>
			</div>
		</div>
	);
}

// --- Ghost Pulse (connection indicator) ---

const GHOST_PULSE_CLASSES: Record<string, string> = {
	error: "bg-red-400",
	disconnected: "bg-white/20",
	connecting: "bg-yellow-400 animate-pulse",
};

function GhostPulse({
	tunnel,
	active,
}: {
	tunnel: TunnelStatus;
	active: boolean;
}) {
	const base = "w-2.5 h-2.5 rounded-full shrink-0";

	if (tunnel !== "connected") {
		return <div className={`${base} ${GHOST_PULSE_CLASSES[tunnel]}`} />;
	}

	return (
		<div
			className={`${base} ${active ? "bg-cyan-400 animate-[pulse_0.6s_ease-in-out_infinite]" : "bg-green-400 animate-[pulse_3s_ease-in-out_infinite]"}`}
		/>
	);
}

// --- App Row ---

function AppRow({
	appId,
	meta,
	appState,
	onToggle,
}: {
	appId: string;
	meta: { name: string; icon: string; color: string; description: string };
	appState: {
		status: string;
		error?: string;
		toolCount?: number;
		installed?: boolean;
	};
	onToggle: (id: string) => void;
}) {
	const isActive = appState.status === "active";
	const isLoading = appState.status === "loading";
	const hasError = appState.status === "error";
	const notInstalled = appState.installed === false;

	return (
		<button
			onClick={() => onToggle(appId)}
			className={`
				w-full flex items-center gap-3 px-3 py-2.5
				transition-all duration-200 cursor-pointer
				border-l-2
				${isActive ? "border-l-cyan-400 bg-white/5" : "border-l-transparent hover:bg-white/5"}
				${isLoading ? "animate-pulse" : ""}
				${hasError ? "border-l-red-400" : ""}
				${notInstalled ? "opacity-40" : ""}
			`}
			title={hasError ? appState.error : meta.description}
		>
			<span className="text-lg w-7 text-center shrink-0">{meta.icon}</span>
			<div className="flex-1 min-w-0 text-left">
				<div className="text-xs font-medium text-white/80 truncate">
					{meta.name}
				</div>
				{hasError && appState.error && (
					<div className="text-[10px] text-red-400/70 truncate">
						{appState.error}
					</div>
				)}
			</div>
			<div className="flex items-center gap-2 shrink-0">
				{isActive && appState.toolCount !== undefined && (
					<span className="text-[10px] text-white/30">
						{appState.toolCount}t
					</span>
				)}
				<div
					className={`w-1.5 h-1.5 rounded-full ${
						isActive
							? "bg-green-400"
							: hasError
								? "bg-red-400"
								: "bg-white/15"
					}`}
				/>
			</div>
		</button>
	);
}

// --- Activity Feed ---

function ActivityFeed({
	events,
	pendingApprovals,
	onApprove,
	onDeny,
}: {
	events: ActivityEvent[];
	pendingApprovals: ApprovalRequest[];
	onApprove: (id: string, pattern: "once" | "always") => void;
	onDeny: (id: string) => void;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [, setTick] = useState(0);

	// Re-render every 10s to update relative timestamps
	useEffect(() => {
		const interval = setInterval(() => setTick((t) => t + 1), 10_000);
		return () => clearInterval(interval);
	}, []);

	// Auto-scroll only when user is already near the bottom
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
		if (nearBottom) el.scrollTop = el.scrollHeight;
	}, [events.length, pendingApprovals.length]);

	if (events.length === 0 && pendingApprovals.length === 0) {
		return (
			<div className="flex-1 flex items-center justify-center">
				<p className="text-white/20 text-xs">
					No activity yet
				</p>
			</div>
		);
	}

	return (
		<div ref={scrollRef} className="flex-1 overflow-y-auto">
			{events.map((event) => (
				<ActivityRow key={event.id} event={event} />
			))}
			{pendingApprovals.map((approval) => (
				<ApprovalCard
					key={approval.id}
					approval={approval}
					onApprove={onApprove}
					onDeny={onDeny}
				/>
			))}
		</div>
	);
}

function ActivityRow({ event }: { event: ActivityEvent }) {
	const icon = ACTIVITY_ICONS[event.type] ?? "\u2022";
	const isPending = event.status === "pending";
	const isError = event.status === "error";

	return (
		<div
			className={`
				flex items-start gap-2 px-3 py-1.5 text-xs
				border-b border-white/5 last:border-b-0
				${isPending ? "animate-pulse" : ""}
				${isError ? "bg-red-500/5" : ""}
			`}
		>
			<span className="text-white/30 shrink-0 w-4 text-center">
				{icon}
			</span>
			<span
				className={`flex-1 min-w-0 truncate font-mono ${
					isError ? "text-red-400/80" : "text-white/60"
				}`}
				title={event.detail ?? event.summary}
			>
				{event.summary}
			</span>
			<span className="text-white/20 shrink-0 text-[10px] tabular-nums">
				{relativeTime(event.timestamp)}
			</span>
		</div>
	);
}

// --- Approval Card (inline in activity feed) ---

function ApprovalCard({
	approval,
	onApprove,
	onDeny,
}: {
	approval: ApprovalRequest;
	onApprove: (id: string, pattern: "once" | "always") => void;
	onDeny: (id: string) => void;
}) {
	const fullCommand = [approval.command, ...approval.args].join(" ");

	return (
		<div className="mx-2 my-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
			<div className="flex items-center gap-2 mb-2">
				<span className="text-yellow-400 text-xs">{"\u26A0"}</span>
				<span className="text-[11px] font-medium text-white/70">
					Approval needed
				</span>
			</div>
			<div className="bg-black/30 rounded px-2.5 py-1.5 mb-2 font-mono text-[11px] text-green-300 break-all">
				{fullCommand}
			</div>
			{approval.cwd && (
				<p className="text-[10px] text-white/25 mb-2">
					in {approval.cwd}
				</p>
			)}
			<div className="flex gap-1.5">
				<button
					onClick={() => onApprove(approval.id, "once")}
					className="flex-1 px-2 py-1 bg-green-600/80 hover:bg-green-500 rounded text-[10px] font-medium transition-colors cursor-pointer"
				>
					Allow
				</button>
				<button
					onClick={() => onApprove(approval.id, "always")}
					className="flex-1 px-2 py-1 bg-blue-600/80 hover:bg-blue-500 rounded text-[10px] font-medium transition-colors cursor-pointer"
				>
					Always
				</button>
				<button
					onClick={() => onDeny(approval.id)}
					className="flex-1 px-2 py-1 bg-red-600/60 hover:bg-red-500 rounded text-[10px] font-medium transition-colors cursor-pointer"
				>
					Deny
				</button>
			</div>
		</div>
	);
}

// --- Onboarding Overlay (shown once after first login) ---

const RECOMMENDED_APPS = new Set(["chrome", "filesystem"]);

function OnboardingOverlay({
	apps,
	username,
	onToggle,
	onDismiss,
}: {
	apps: Record<string, { id: string; status: string; toolCount?: number }>;
	username?: string;
	onToggle: (id: string) => void;
	onDismiss: () => void;
}) {
	const appIds = Object.keys(apps);

	return (
		<div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-40">
			<div className="bg-surface-raised border border-white/20 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
				<div className="flex items-center gap-2 mb-1">
					<span className="text-green-400">{"\u2713"}</span>
					<h2 className="text-sm font-semibold text-white/90">
						{username ? `Connected as @${username}` : "Connected"}
					</h2>
				</div>
				<p className="text-xs text-white/50 mb-5">
					Enable tools for your ghost:
				</p>

				<div className="space-y-1 mb-6">
					{appIds.map((id) => {
						const meta = getServerMeta(id);
						const isActive = apps[id].status === "active";
						const recommended = RECOMMENDED_APPS.has(id);

						return (
							<button
								key={id}
								onClick={() => onToggle(id)}
								className={`
									w-full flex items-center gap-3 px-3 py-2 rounded-lg
									transition-colors cursor-pointer text-left
									${isActive ? "bg-white/10" : "hover:bg-white/5"}
								`}
							>
								<span className="text-base w-6 text-center">
									{meta.icon}
								</span>
								<span className="flex-1 text-xs text-white/80">
									{meta.name}
								</span>
								{recommended && !isActive && (
									<span className="text-[9px] text-cyan-400/60 uppercase tracking-wide">
										recommended
									</span>
								)}
								<div
									className={`w-2 h-2 rounded-full ${
										isActive ? "bg-green-400" : "bg-white/15"
									}`}
								/>
							</button>
						);
					})}
				</div>

				<button
					onClick={onDismiss}
					className="w-full py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs font-medium text-white/80 transition-colors cursor-pointer"
				>
					Done
				</button>
			</div>
		</div>
	);
}

// --- Welcome Screen (first-run / not logged in) ---

function WelcomeScreen({
	hasMcpConfig,
	appCount,
	onLogin,
	onSetupDefaults,
	loginLoading,
}: {
	hasMcpConfig: boolean;
	appCount: number;
	onLogin: () => void;
	onSetupDefaults: () => void;
	loginLoading: boolean;
}) {
	return (
		<div className="h-screen bg-surface text-white flex flex-col items-center justify-center select-none px-10">
			<div className="max-w-sm w-full">
				{/* Logo area */}
				<div className="text-center mb-8">
					<div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/5 border border-white/10 mb-4">
						<span className="text-3xl">{"\u{1F47B}"}</span>
					</div>
					<h1 className="text-lg font-semibold text-white/90 mb-2">
						SummonGhost
					</h1>
					<p className="text-sm text-white/40 leading-relaxed">
						Your ghost needs local access to work with your files,
						browser, and services.
					</p>
				</div>

				{/* Steps */}
				<div className="space-y-3 mb-8">
					{[
						"Log in to SummonGhost",
						"Enable the tools you need",
						"Your ghost works for you",
					].map((step, i) => (
						<div key={i} className="flex items-center gap-3">
							<span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px] text-white/40 font-medium shrink-0">
								{i + 1}
							</span>
							<span className="text-xs text-white/50">{step}</span>
						</div>
					))}
				</div>

				{/* CTA */}
				<button
					onClick={onLogin}
					disabled={loginLoading}
					className="w-full py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 rounded-lg text-sm font-medium text-gray-950 transition-colors cursor-pointer"
				>
					{loginLoading ? "Opening browser..." : "Connect to SummonGhost"}
				</button>

				{/* Config status */}
				<div className="mt-6 text-center">
					{hasMcpConfig ? (
						<p className="text-[11px] text-white/30">
							<span className="text-green-400/60">{"\u2713"}</span>{" "}
							mcp.json detected
							{appCount > 0 && ` \u00B7 ${appCount} server${appCount !== 1 ? "s" : ""}`}
						</p>
					) : (
						<div>
							<p className="text-[11px] text-white/25 mb-2">
								No tools configured yet
							</p>
							<button
								onClick={onSetupDefaults}
								className="text-[11px] text-cyan-400/60 hover:text-cyan-400 transition-colors cursor-pointer"
							>
								Set up default tools (Chrome + Filesystem)
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="flex-1 flex flex-col items-center justify-center text-center px-8">
			<p className="text-white/40 text-sm mb-2">No apps configured</p>
			<p className="text-white/25 text-xs max-w-xs">
				Add MCP servers to{" "}
				<code className="bg-white/10 px-1 rounded">
					~/.summonghost/mcp.json
				</code>{" "}
				to give your ghost local capabilities.
			</p>
		</div>
	);
}

export default App;
