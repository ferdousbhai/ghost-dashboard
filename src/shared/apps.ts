import type { AppConfig } from "./types";

export const APPS: AppConfig[] = [
	{
		id: "whatsapp",
		name: "WhatsApp",
		description: "Read & send messages",
		icon: "\u{1F4AC}", // speech bubble
		color: "bg-green-500",
	},
	{
		id: "gmail",
		name: "Gmail",
		description: "Email management",
		icon: "\u{2709}\u{FE0F}", // envelope
		color: "bg-red-500",
	},
	{
		id: "calendar",
		name: "Calendar",
		description: "Schedule & events",
		icon: "\u{1F4C5}", // calendar
		color: "bg-blue-500",
	},
	{
		id: "drive",
		name: "Drive",
		description: "File management",
		icon: "\u{1F4C1}", // folder
		color: "bg-yellow-500",
	},
	{
		id: "chrome",
		name: "Chrome",
		description: "Web browsing",
		icon: "\u{1F310}", // globe
		color: "bg-indigo-500",
	},
];
