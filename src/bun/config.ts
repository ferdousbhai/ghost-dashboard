// Config persistence — auth, server URL, and MCP server configuration
// Stored at ~/.summonghost/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".summonghost");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const MCP_CONFIG_FILE = join(CONFIG_DIR, "mcp.json");

interface Config {
	token?: string;
	baseUrl?: string;
	// Legacy field
	serverUrl?: string;
	firstRunDismissed?: boolean;
}

export interface McpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	/** npm package to auto-install if command not found */
	npmPackage?: string;
}

export interface McpConfig {
	mcpServers: Record<string, McpServerConfig>;
}

const DEFAULT_BASE_URL = "https://summonghost.com";

function ensureConfigDir() {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

export function loadConfig(): Config {
	try {
		if (existsSync(CONFIG_FILE)) {
			return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
		}
	} catch {
		// Corrupted config
	}
	return {};
}

function saveConfig(config: Config) {
	ensureConfigDir();
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function getToken(): string | undefined {
	return loadConfig().token;
}

export function setToken(token: string) {
	const config = loadConfig();
	config.token = token;
	saveConfig(config);
}

export function clearToken() {
	const config = loadConfig();
	delete config.token;
	saveConfig(config);
}

export function isFirstRun(): boolean {
	return !loadConfig().firstRunDismissed;
}

export function dismissFirstRun() {
	const config = loadConfig();
	config.firstRunDismissed = true;
	saveConfig(config);
}

export function getBaseUrl(): string {
	const config = loadConfig();
	return config.baseUrl || config.serverUrl || DEFAULT_BASE_URL;
}

// --- MCP Config ---

const DEFAULT_MCP_CONFIG: McpConfig = {
	mcpServers: {
		chrome: {
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-puppeteer"],
			npmPackage: "@modelcontextprotocol/server-puppeteer",
		},
	},
};

export function mcpConfigExists(): boolean {
	return existsSync(MCP_CONFIG_FILE);
}

export function loadMcpConfig(): McpConfig {
	console.log(`[config] Loading MCP config from ${MCP_CONFIG_FILE}`);
	try {
		if (existsSync(MCP_CONFIG_FILE)) {
			const config = JSON.parse(readFileSync(MCP_CONFIG_FILE, "utf-8"));
			console.log(`[config] Loaded ${Object.keys(config.mcpServers || {}).length} servers from file`);
			return config;
		}
	} catch (err) {
		console.error("[config] Error loading mcp.json:", err);
	}
	console.log(`[config] Using defaults: ${Object.keys(DEFAULT_MCP_CONFIG.mcpServers).length} servers`);
	return DEFAULT_MCP_CONFIG;
}

export function saveMcpConfig(config: McpConfig) {
	ensureConfigDir();
	writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2));
}
