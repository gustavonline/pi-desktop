import { withExtensionCommandUsageHint } from "../extensions/extension-command-hints.js";

export interface BuiltinSlashCommandDefinition {
	name: string;
	description: string;
}

export type RuntimeSlashCommandSource = "extension" | "prompt" | "skill" | "other";

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function normalizeSlashCommandName(name: string): string {
	return normalizeText(name).replace(/^\/+/, "").toLowerCase();
}

export function withRuntimeCommandUsageHint(name: string, description: string): string {
	return withExtensionCommandUsageHint(name, normalizeText(description));
}

export function normalizeRuntimeSlashCommandSource(rawSource: string): RuntimeSlashCommandSource {
	const source = normalizeText(rawSource).toLowerCase();
	switch (source) {
		case "extension":
		case "prompt":
		case "skill":
			return source;
		default:
			return "other";
	}
}

export const BUILTIN_SLASH_COMMANDS: BuiltinSlashCommandDefinition[] = [
	{ name: "settings", description: "Open Desktop settings" },
	{ name: "model", description: "No arg opens picker; exact arg sets model, otherwise opens picker near matches" },
	{ name: "scoped-models", description: "Open Settings scoped-models editor (Ctrl+P model cycle scope)" },
	{ name: "export", description: "No arg opens save dialog, /export <path> writes HTML directly" },
	{ name: "import", description: "No arg opens file picker, /import <path> imports a session file" },
	{ name: "share", description: "Create secret gist and post minimal links to pi.dev + GitHub gist" },
	{ name: "copy", description: "Copy last assistant message" },
	{ name: "name", description: "No arg opens inline rename, /name <text> sets name directly" },
	{ name: "session", description: "Append detailed session info + token stats" },
	{ name: "changelog", description: "Show latest changelog in collapsible row (/changelog all, /changelog refresh)" },
	{ name: "hotkeys", description: "Open keyboard shortcuts" },
	{ name: "terminal", description: "Toggle docked terminal" },
	{ name: "fork", description: "Open fork flow, /fork <query> pre-fills message search" },
	{ name: "tree", description: "Open full session tree across branches, /tree <query> pre-fills search" },
	{ name: "login", description: "No arg opens model picker auth actions; /login <provider> opens provider login guidance/setup" },
	{ name: "logout", description: "No arg opens model picker auth actions; /logout <provider> clears auth.json credentials" },
	{ name: "new", description: "Start fresh session tab" },
	{ name: "compact", description: "Manually compact context, /compact <instructions> optional" },
	{ name: "resume", description: "Open session browser, /resume <query> pre-fills search" },
	{ name: "reload", description: "Reload runtime (bridge restart + state/models/commands refresh)" },
	{ name: "quit", description: "Quit Desktop app" },
];
