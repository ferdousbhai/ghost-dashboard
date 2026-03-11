// Collect local project context to send to the ghost on connect
// Provides git info and file tree for awareness

import { readdirSync } from "fs";

interface ProjectContext {
	cwd: string;
	gitBranch?: string;
	gitStatus?: string;
	fileTree?: string[];
}

async function runGit(args: string[], cwd: string): Promise<string | undefined> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const text = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;
		return exitCode === 0 ? text.trim() : undefined;
	} catch {
		return undefined;
	}
}

export async function collectProjectContext(): Promise<ProjectContext> {
	const cwd = process.cwd();

	const [gitBranch, gitStatus] = await Promise.all([
		runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
		runGit(["status", "--short"], cwd),
	]);

	let fileTree: string[] | undefined;
	try {
		fileTree = readdirSync(cwd)
			.filter((f) => !f.startsWith(".") || f === ".gitignore")
			.sort();
	} catch {
		// Not a readable directory
	}

	return { cwd, gitBranch, gitStatus, fileTree };
}
