import { normalizeExtensionCommandName } from "./extension-command-intent.js";

const AUTO_RENAME_COMMANDS = new Set<string>(["auto-rename", "name-ai-config"]);
const VOICE_NOTIFY_COMMANDS = new Set<string>(["voice-notify"]);

const AUTO_RENAME_USAGE_HINT = "Args: config, test, init, regen, <name>";
const VOICE_NOTIFY_USAGE_HINT =
	"No arg opens extension settings; args: status, reload, on, off, test <idle|permission|question|error>";
const VOICE_NOTIFY_CANONICAL_DESCRIPTION =
	"Voice notifications: no arg opens extension settings, or use status/reload/on/off/test";

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function extensionCommandUsageHint(commandName: string): string | null {
	const normalized = normalizeExtensionCommandName(commandName);
	if (!normalized) return null;
	if (AUTO_RENAME_COMMANDS.has(normalized)) return AUTO_RENAME_USAGE_HINT;
	if (VOICE_NOTIFY_COMMANDS.has(normalized)) return VOICE_NOTIFY_USAGE_HINT;
	return null;
}

function descriptionAlreadyContainsHint(commandName: string, description: string): boolean {
	const normalized = normalizeExtensionCommandName(commandName);
	const lower = description.toLowerCase();
	if (AUTO_RENAME_COMMANDS.has(normalized)) {
		return lower.includes("config") && lower.includes("test");
	}
	if (VOICE_NOTIFY_COMMANDS.has(normalized)) {
		return lower.includes("status") && lower.includes("reload") && lower.includes("test");
	}
	return false;
}

function shouldUseVoiceNotifyCanonicalDescription(commandName: string, description: string): boolean {
	const normalized = normalizeExtensionCommandName(commandName);
	if (!VOICE_NOTIFY_COMMANDS.has(normalized)) return false;
	if (!description) return true;
	return /^configure windows smart voice notifications$/i.test(description);
}

export function withExtensionCommandUsageHint(commandName: string, description: string): string {
	const normalizedDescription = normalizeText(description);
	if (shouldUseVoiceNotifyCanonicalDescription(commandName, normalizedDescription)) {
		return VOICE_NOTIFY_CANONICAL_DESCRIPTION;
	}
	const hint = extensionCommandUsageHint(commandName);
	if (!hint) return normalizedDescription;
	if (!normalizedDescription) return hint;
	if (descriptionAlreadyContainsHint(commandName, normalizedDescription)) return normalizedDescription;
	return `${normalizedDescription} · ${hint}`;
}
