// Session-scoped permission store for command approval
// Pattern-based auto-approval

interface ApprovalPattern {
	prefix: string;
}

const approvedPatterns: ApprovalPattern[] = [];

/** Extract the program name from a full command string */
function getProgram(command: string): string {
	const parts = command.trim().split(/\s+/);
	return parts[0] || "";
}

/** Generate a prefix for pattern matching */
function generatePrefix(command: string): string {
	const program = getProgram(command);
	if (!program) return "\0"; // Unmatchable sentinel

	// If command has args, approve all commands with same program
	const hasArgs = command.trim().includes(" ");
	return hasArgs ? `${program} ` : program;
}

/** Check if a command matches any approved pattern */
export function isApproved(command: string): boolean {
	const fullCmd = command.trim();
	return approvedPatterns.some((p) => fullCmd.startsWith(p.prefix));
}

/** Store an approval pattern derived from the given command */
export function approvePattern(command: string): void {
	const prefix = generatePrefix(command);
	if (prefix === "\0") return;

	// Don't add duplicates
	if (!approvedPatterns.some((p) => p.prefix === prefix)) {
		approvedPatterns.push({ prefix });
		console.log(`[permissions] Auto-approved pattern: "${prefix}*"`);
	}
}

/** Clear all approval patterns (e.g., on disconnect) */
export function clearApprovals(): void {
	approvedPatterns.length = 0;
}
