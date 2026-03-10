// Shared types between main process (Bun) and renderer (React)

export type AppId =
	| "whatsapp"
	| "gmail"
	| "calendar"
	| "drive"
	| "chrome";

export interface AppConfig {
	id: AppId;
	name: string;
	description: string;
	icon: string; // emoji for now, can be replaced with SVG later
	color: string; // tailwind bg color class
}

export type AppStatus = "idle" | "loading" | "active" | "error";

export type TunnelStatus = "disconnected" | "connecting" | "connected" | "error";

export interface AppState {
	id: AppId;
	status: AppStatus;
	error?: string;
}

export interface DashboardState {
	tunnel: TunnelStatus;
	apps: Record<AppId, AppState>;
	tunnelError?: string;
}

// RPC schema for main <-> webview communication
export type DashboardRPC = {
	bun: {
		requests: {
			getState(): Promise<DashboardState>;
			toggleApp(appId: AppId): Promise<AppState>;
			connect(): Promise<void>;
			disconnect(): Promise<void>;
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
