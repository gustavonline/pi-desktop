export interface RecommendedPackageDefinition {
	id: string;
	name: string;
	description: string;
	installScopeHint: "global" | "project" | "either";
	source: string;
	sourceKind: "npm" | "git" | "url" | "local";
	publisher: "first-party" | "community";
	resourcesLabel: string;
	installSourceHint: string;
	aliases?: string[];
}

export const RECOMMENDED_PACKAGES: RecommendedPackageDefinition[] = [
	{
		id: "pi-desktop-themes",
		name: "Pi Desktop Themes",
		description: "Default Pi Desktop light/dark themes for desktop + TUI (Default, Notion, Catppuccin, GitHub, VSCode Plus).",
		installScopeHint: "global",
		source: "local:pi-desktop-themes",
		sourceKind: "local",
		publisher: "first-party",
		resourcesLabel: "10 themes",
		installSourceHint: "~/.pi/agent/themes/pi-desktop-*.json",
		aliases: ["pi-desktop-themes"],
	},
	{
		id: "pi-smart-voice-notify",
		name: "Pi Smart Voice Notify",
		description: "Smart voice/sound/desktop notifications with interactive settings via /voice-notify (ctx.ui.notify-capable).",
		installScopeHint: "global",
		source: "npm:pi-smart-voice-notify",
		sourceKind: "npm",
		publisher: "community",
		resourcesLabel: "1 extension",
		installSourceHint: "npm:pi-smart-voice-notify",
		aliases: ["pi-smart-voice-notify", "pi-desktop-notify"],
	},
	{
		id: "pi-auto-rename",
		name: "Pi Auto Rename",
		description: "Automatically renames Pi sessions from the first prompt, with configurable model, fallback, and prefix behavior.",
		installScopeHint: "global",
		source: "npm:@byteowlz/pi-auto-rename",
		sourceKind: "npm",
		publisher: "community",
		resourcesLabel: "1 extension",
		installSourceHint: "npm:@byteowlz/pi-auto-rename",
		aliases: ["@byteowlz/pi-auto-rename", "pi-session-auto-rename"],
	},
	{
		id: "pi-cursor-provider",
		name: "Cursor Provider",
		description: "Connect Pi to Cursor-authenticated models through the Cursor local proxy/provider extension.",
		installScopeHint: "global",
		source: "npm:pi-cursor-provider",
		sourceKind: "npm",
		publisher: "community",
		resourcesLabel: "1 provider extension",
		installSourceHint: "npm:pi-cursor-provider",
		aliases: ["pi-cursor-provider", "cursor-provider", "cursor"],
	},
	{
		id: "pi-kilocode",
		name: "Kilo Code Provider",
		description: "Adds Kilo Code as a Pi provider with capability-friendly integration for Desktop.",
		installScopeHint: "global",
		source: "npm:pi-kilocode",
		sourceKind: "npm",
		publisher: "community",
		resourcesLabel: "1 provider extension",
		installSourceHint: "npm:pi-kilocode",
		aliases: ["pi-kilocode", "kilo", "kilocode"],
	},
];

function normalizeNpmSource(value: string): string {
	const spec = value.slice(4).trim().toLowerCase();
	if (!spec) return "npm:";
	if (spec.startsWith("@")) {
		const versionIndex = spec.indexOf("@", 1);
		return `npm:${versionIndex === -1 ? spec : spec.slice(0, versionIndex)}`;
	}
	const versionIndex = spec.indexOf("@");
	return `npm:${versionIndex === -1 ? spec : spec.slice(0, versionIndex)}`;
}

export function normalizeRecommendedSource(value: string): string {
	const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "").trim();
	const lower = normalized.toLowerCase();
	if (lower.startsWith("npm:")) return normalizeNpmSource(lower);
	return lower;
}
