// Config persistence — stores auth token and settings
// Stored at ~/.summonghost/config.json (same as ghost-cli)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".summonghost");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
	token?: string;
	serverUrl?: string;
}

const DEFAULT_SERVER_URL = "https://summonghost.com";

export function loadConfig(): Config {
	try {
		if (existsSync(CONFIG_FILE)) {
			return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
		}
	} catch {
		// Corrupted config, return default
	}
	return {};
}

export function saveConfig(config: Config) {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getToken(): string | undefined {
	return loadConfig().token;
}

export function getServerUrl(): string {
	return loadConfig().serverUrl || DEFAULT_SERVER_URL;
}
