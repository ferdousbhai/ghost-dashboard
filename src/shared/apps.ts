import type { AppMeta } from "./types";

// Curated metadata for known MCP servers.
// Unknown servers get auto-generated metadata.
const KNOWN_SERVERS: Record<string, AppMeta> = {
	filesystem: {
		name: "Filesystem",
		description: "Read & write local files",
		icon: "\u{1F4BE}",
		color: "bg-gray-500",
	},
	github: {
		name: "GitHub",
		description: "Repos, issues & PRs",
		icon: "\u{1F4BB}",
		color: "bg-gray-700",
	},
	"brave-search": {
		name: "Web Search",
		description: "Search the web via Brave",
		icon: "\u{1F50D}",
		color: "bg-orange-500",
	},
	chrome: {
		name: "Chrome",
		description: "Web browsing via Puppeteer",
		icon: "\u{1F310}",
		color: "bg-indigo-500",
	},
	whatsapp: {
		name: "WhatsApp",
		description: "Read & send messages via wa CLI",
		icon: "\u{1F4AC}",
		color: "bg-green-500",
	},
	gmail: {
		name: "Gmail",
		description: "Email management",
		icon: "\u{2709}\u{FE0F}",
		color: "bg-red-500",
	},
	calendar: {
		name: "Calendar",
		description: "Schedule & events",
		icon: "\u{1F4C5}",
		color: "bg-blue-500",
	},
	drive: {
		name: "Drive",
		description: "File management",
		icon: "\u{1F4C1}",
		color: "bg-yellow-500",
	},
};

const COLORS = [
	"bg-purple-500",
	"bg-teal-500",
	"bg-orange-500",
	"bg-pink-500",
	"bg-cyan-500",
	"bg-emerald-500",
	"bg-rose-500",
	"bg-amber-500",
];

export function getServerMeta(id: string): AppMeta {
	if (KNOWN_SERVERS[id]) return KNOWN_SERVERS[id];

	const name = id
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
	const colorIndex =
		id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) %
		COLORS.length;

	return {
		name,
		description: `MCP server: ${id}`,
		icon: name.charAt(0).toUpperCase(),
		color: COLORS[colorIndex],
	};
}
