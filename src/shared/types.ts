// Shared types between main process (Bun) and renderer (React)

// Dynamic string IDs instead of hardcoded union
export type AppId = string;

export interface AppMeta {
	name: string;
	description: string;
	icon: string;
	color: string;
}

export type AppStatus = "idle" | "loading" | "active" | "error";

export type TunnelStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "error";

export interface AppState {
	id: AppId;
	status: AppStatus;
	error?: string;
	toolCount?: number;
	installed?: boolean;
}

export interface ApprovalRequest {
	id: string;
	command: string;
	args: string[];
	cwd?: string;
}

export type ActivityType =
	| "tool_call"
	| "command"
	| "approval"
	| "connection"
	| "app"
	| "error";

export interface ActivityEvent {
	id: string;
	timestamp: number;
	type: ActivityType;
	summary: string;
	detail?: string;
	appId?: string;
	status: "pending" | "success" | "error";
}

export interface DashboardState {
	tunnel: TunnelStatus;
	apps: Record<AppId, AppState>;
	tunnelError?: string;
	loggedIn: boolean;
	username?: string;
	hasMcpConfig: boolean;
	firstRun: boolean;
	pendingApprovals: ApprovalRequest[];
	activityLog: ActivityEvent[];
}

// RPC schema for main <-> webview communication
export type DashboardRPC = {
	bun: {
		requests: {
			getState(): Promise<DashboardState>;
			toggleApp(appId: AppId): Promise<AppState>;
			connect(): Promise<void>;
			disconnect(): Promise<void>;
			login(): Promise<void>;
			logout(): Promise<void>;
			setupDefaults(): Promise<void>;
			dismissOnboarding(): Promise<void>;
			approveCommand(
				id: string,
				pattern: "once" | "always",
			): Promise<void>;
			denyCommand(id: string): Promise<void>;
		};
		messages: {
			log(message: string): void;
		};
	};
	webview: {
		requests: {};
		messages: {
			stateChanged(state: DashboardState): void;
		};
	};
};
