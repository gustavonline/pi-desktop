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
		description: "Default Pi Desktop light/dark themes for desktop + TUI (Notion, Catppuccin, GitHub, VSCode Plus).",
		installScopeHint: "global",
		source: "local:pi-desktop-themes",
		sourceKind: "local",
		publisher: "first-party",
		resourcesLabel: "8 themes",
		installSourceHint: "~/.pi/agent/themes/pi-desktop-*.json",
		aliases: ["pi-desktop-themes"],
	},
	{
		id: "pi-desktop-notify",
		name: "Pi Desktop Notify",
		description: "Focus-aware desktop notifications for Pi Desktop and other RPC hosts via ctx.ui.notify().",
		installScopeHint: "global",
		source: "npm:pi-desktop-notify",
		sourceKind: "npm",
		publisher: "first-party",
		resourcesLabel: "1 extension",
		installSourceHint: "npm:pi-desktop-notify",
		aliases: ["pi-desktop-notify"],
	},
	{
		id: "pi-session-auto-rename",
		name: "Pi Session Auto Rename",
		description: "Automatically renames Pi sessions with AI after turns, with configurable naming behavior.",
		installScopeHint: "global",
		source: "npm:pi-session-auto-rename",
		sourceKind: "npm",
		publisher: "community",
		resourcesLabel: "1 extension",
		installSourceHint: "npm:pi-session-auto-rename",
		aliases: ["pi-session-auto-rename"],
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
