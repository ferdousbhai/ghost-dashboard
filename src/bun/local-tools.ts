// Local tool executors — handle tool_request from the ghost
// Local tools: bash, read_file, edit_file, write_file, glob, grep, ls

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const DEFAULT_TIMEOUT = 120_000; // 2 min

/** Known local tool names that we handle directly (not MCP) */
export const LOCAL_TOOLS = new Set([
	"bash",
	"read_file",
	"edit_file",
	"write_file",
	"glob",
	"grep",
	"ls",
]);

export async function executeLocalTool(
	name: string,
	args: Record<string, unknown>,
): Promise<string> {
	switch (name) {
		case "bash":
			return execBash(args);
		case "read_file":
			return execReadFile(args);
		case "edit_file":
			return execEditFile(args);
		case "write_file":
			return execWriteFile(args);
		case "glob":
			return execGlob(args);
		case "grep":
			return execGrep(args);
		case "ls":
			return execLs(args);
		default:
			throw new Error(`Unknown local tool: ${name}`);
	}
}

async function execBash(args: Record<string, unknown>): Promise<string> {
	const command = args.command as string;
	const timeout = (args.timeout as number) || DEFAULT_TIMEOUT;
	const cwd = (args.cwd as string) || process.cwd();

	const proc = Bun.spawn(["bash", "-c", command], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});

	const timer = setTimeout(() => proc.kill(), timeout);

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	clearTimeout(timer);

	let result = "";
	if (stdout) result += stdout;
	if (stderr) result += (result ? "\n" : "") + `stderr: ${stderr}`;
	if (exitCode !== 0) result += (result ? "\n" : "") + `exit code: ${exitCode}`;
	return result || "(no output)";
}

function execReadFile(args: Record<string, unknown>): string {
	const path = resolve(args.path as string);
	const offset = (args.offset as number) || 0;
	const limit = (args.limit as number) || 2000;

	if (!existsSync(path)) {
		throw new Error(`File not found: ${path}`);
	}

	const content = readFileSync(path, "utf-8");
	const lines = content.split("\n");
	const slice = lines.slice(offset, offset + limit);

	// Format with line numbers like Claude Code
	return slice
		.map((line, i) => `${String(offset + i + 1).padStart(6)}\t${line}`)
		.join("\n");
}

function execEditFile(args: Record<string, unknown>): string {
	const path = resolve(args.path as string);
	const oldString = args.old_string as string;
	const newString = args.new_string as string;

	if (!existsSync(path)) {
		throw new Error(`File not found: ${path}`);
	}

	const content = readFileSync(path, "utf-8");
	const occurrences = content.split(oldString).length - 1;

	if (occurrences === 0) {
		throw new Error("old_string not found in file");
	}
	if (occurrences > 1) {
		throw new Error(`old_string found ${occurrences} times — must be unique`);
	}

	const updated = content.replace(oldString, newString);
	writeFileSync(path, updated);
	return `Edited ${path}`;
}

function execWriteFile(args: Record<string, unknown>): string {
	const path = resolve(args.path as string);
	const content = args.content as string;
	writeFileSync(path, content);
	return `Wrote ${path} (${content.length} bytes)`;
}

async function execGlob(args: Record<string, unknown>): Promise<string> {
	const pattern = args.pattern as string;
	const path = (args.path as string) || process.cwd();

	const glob = new Bun.Glob(pattern);
	const matches: string[] = [];
	for await (const entry of glob.scan({ cwd: path, dot: false })) {
		matches.push(entry);
		if (matches.length >= 500) break;
	}
	return matches.join("\n") || "(no matches)";
}

async function execGrep(args: Record<string, unknown>): Promise<string> {
	const pattern = args.pattern as string;
	const path = (args.path as string) || process.cwd();
	const include = args.include as string | undefined;

	const rgArgs = ["rg", "--no-heading", "-n", pattern, path];
	if (include) rgArgs.push("--glob", include);
	rgArgs.push("--max-count", "100");

	const proc = Bun.spawn(rgArgs, {
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	await proc.exited;
	return stdout.trim() || "(no matches)";
}

function execLs(args: Record<string, unknown>): string {
	const path = resolve((args.path as string) || process.cwd());

	if (!existsSync(path)) {
		throw new Error(`Directory not found: ${path}`);
	}

	const entries = readdirSync(path);
	return entries
		.map((entry) => {
			try {
				const stat = statSync(join(path, entry));
				const suffix = stat.isDirectory() ? "/" : "";
				return `${entry}${suffix}`;
			} catch {
				return entry;
			}
		})
		.join("\n");
}
