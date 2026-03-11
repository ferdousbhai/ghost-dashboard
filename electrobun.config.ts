import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Ghost Dashboard",
		identifier: "com.summonghost.dashboard",
		version: "0.1.0",
	},
	build: {
		// Electrobun bundles the RPC entry point for the webview
		views: {
			mainview: {
				entrypoint: "src/mainview/electrobun-entry.ts",
			},
		},
		// Vite builds the React UI to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
