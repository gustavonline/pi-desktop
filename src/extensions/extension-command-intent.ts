const DEFAULT_SETTINGS_COMMANDS = new Set<string>(["voice-notify"]);

export function normalizeExtensionCommandName(commandName: string): string {
	return commandName.trim().toLowerCase().replace(/^\/+/, "");
}

export function normalizeExtensionCommandArgs(args: string): string {
	return args.trim().toLowerCase();
}

export function isExtensionConfigIntent(commandName: string, args: string): boolean {
	const normalizedName = normalizeExtensionCommandName(commandName);
	if (!normalizedName) return false;
	const normalizedArgs = normalizeExtensionCommandArgs(args);
	if (DEFAULT_SETTINGS_COMMANDS.has(normalizedName) && normalizedArgs.length === 0) {
		return true;
	}
	if (normalizedName.endsWith("config")) return true;
	return normalizedArgs === "config" || normalizedArgs.startsWith("config ");
}
