import { getAppearanceProfileForResolvedTheme, loadDesktopAppearanceProfiles } from "./appearance-profiles.js";
import type { DesktopThemeResolved } from "./theme-manager.js";

interface PiThemeFile {
	name?: string;
	vars?: Record<string, unknown>;
	colors?: Record<string, unknown>;
}

// Theme input for desktop should stay minimal (Codex-like):
// Accent + Background + Foreground are the primary user-facing knobs.
const PI_THEME_OVERLAY_VARS = [
	"--color-accent-primary",
	"--color-accent-soft",
	"--color-bg-app",
	"--color-bg-elevated",
	"--color-bg-muted",
	"--color-bg-soft",
	"--color-bg-sidebar",
	"--color-bg-workspace-chrome",
	"--color-bg-workspace-chrome-soft",
	"--color-text-primary",
	"--color-text-secondary",
	"--color-text-tertiary",
	"--color-border-default",
] as const;

const PI_THEME_ACCENT_TOKENS = ["accent", "toolTitle", "mdHeading", "mdLink", "customMessageLabel"] as const;
const PI_THEME_BACKGROUND_TOKENS = ["selectedBg", "userMessageBg", "customMessageBg", "toolPendingBg", "mdCodeBlock"] as const;
const PI_THEME_FOREGROUND_TOKENS = ["text", "userMessageText", "customMessageText", "toolOutput", "syntaxVariable"] as const;

const XTERM_LEVELS = [0, 95, 135, 175, 215, 255] as const;

let lastSyncKey = "";
let lastSyncAt = 0;

function normalizeFsPath(path: string | null | undefined): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function joinFsPath(base: string, child: string): string {
	const b = base.replace(/\\/g, "/").replace(/\/+$/, "");
	const c = child.replace(/\\/g, "/").replace(/^\/+/, "");
	return b ? `${b}/${c}` : c;
}

function expandHomePath(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/")) return joinFsPath(home, path.slice(2));
	return path;
}

function isLikelyAbsolutePath(path: string): boolean {
	if (path.startsWith("/")) return true;
	return /^[A-Za-z]:[\\/]/.test(path);
}

function normalizeThemeModeFromDom(): DesktopThemeResolved {
	return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function normalizeThemeName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function xtermIndexToHex(index: number): string | null {
	if (!Number.isInteger(index) || index < 0 || index > 255) return null;
	const hex = (value: number): string => value.toString(16).padStart(2, "0");

	if (index < 16) {
		const ansi = [
			"#000000",
			"#800000",
			"#008000",
			"#808000",
			"#000080",
			"#800080",
			"#008080",
			"#c0c0c0",
			"#808080",
			"#ff0000",
			"#00ff00",
			"#ffff00",
			"#0000ff",
			"#ff00ff",
			"#00ffff",
			"#ffffff",
		] as const;
		return ansi[index] ?? null;
	}

	if (index >= 16 && index <= 231) {
		const value = index - 16;
		const r = Math.floor(value / 36);
		const g = Math.floor((value % 36) / 6);
		const b = value % 6;
		return `#${hex(XTERM_LEVELS[r] ?? 0)}${hex(XTERM_LEVELS[g] ?? 0)}${hex(XTERM_LEVELS[b] ?? 0)}`;
	}

	const gray = 8 + (index - 232) * 10;
	return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
}

function normalizeColorString(input: string): string | null {
	const value = input.trim();
	if (!value) return null;
	if (/^#([0-9a-f]{3,8})$/i.test(value)) return value;
	if (/^\d{1,3}$/.test(value)) return xtermIndexToHex(Number(value));
	if (/^(rgb|hsl|oklch|oklab|color|var)\(/i.test(value)) return value;
	return null;
}

function resolveThemeColorValue(
	value: unknown,
	theme: PiThemeFile,
	seenVars: Set<string>,
	seenColorRefs: Set<string>,
): string | null {
	if (typeof value === "number") return xtermIndexToHex(value);
	if (typeof value !== "string") return null;

	const direct = normalizeColorString(value);
	if (direct) return direct;

	const ref = value.trim();
	if (!ref) return null;

	const vars = theme.vars ?? {};
	if (Object.prototype.hasOwnProperty.call(vars, ref)) {
		if (seenVars.has(ref)) return null;
		seenVars.add(ref);
		const resolved = resolveThemeColorValue(vars[ref], theme, seenVars, seenColorRefs);
		seenVars.delete(ref);
		if (resolved) return resolved;
	}

	const colors = theme.colors ?? {};
	if (Object.prototype.hasOwnProperty.call(colors, ref)) {
		if (seenColorRefs.has(ref)) return null;
		seenColorRefs.add(ref);
		const resolved = resolveThemeColorValue(colors[ref], theme, seenVars, seenColorRefs);
		seenColorRefs.delete(ref);
		if (resolved) return resolved;
	}

	return null;
}

function resolveThemeColorToken(theme: PiThemeFile, token: string): string | null {
	const colors = theme.colors ?? {};
	if (!Object.prototype.hasOwnProperty.call(colors, token)) return null;
	return resolveThemeColorValue(colors[token], theme, new Set<string>(), new Set<string>([token]));
}

function firstResolvedToken(theme: PiThemeFile, tokens: readonly string[]): string | null {
	for (const token of tokens) {
		const value = resolveThemeColorToken(theme, token);
		if (value) return value;
	}
	return null;
}

function buildPiThemeOverlay(
	theme: PiThemeFile,
	mode: DesktopThemeResolved,
): Partial<Record<(typeof PI_THEME_OVERLAY_VARS)[number], string>> {
	const result: Partial<Record<(typeof PI_THEME_OVERLAY_VARS)[number], string>> = {};
	const accent = firstResolvedToken(theme, PI_THEME_ACCENT_TOKENS);
	const background = firstResolvedToken(theme, PI_THEME_BACKGROUND_TOKENS);
	const foreground = firstResolvedToken(theme, PI_THEME_FOREGROUND_TOKENS);
	const neutralLift = mode === "dark" ? "white" : "black";
	const sidebarBase = mode === "dark" ? "86%" : "92%";
	const sidebarShade = mode === "dark" ? "14%" : "8%";

	if (accent) {
		result["--color-accent-primary"] = accent;
		result["--color-accent-soft"] = `color-mix(in srgb, ${accent} 20%, transparent)`;
	}

	// Important: foreground should mainly control text, not surface tint.
	// Keep surface derivation tied to background to avoid colored "veil" overlays.
	if (background) {
		result["--color-bg-app"] = background;
		result["--color-bg-elevated"] = `color-mix(in srgb, ${background} 94%, ${neutralLift} 6%)`;
		result["--color-bg-muted"] = `color-mix(in srgb, ${background} 89%, ${neutralLift} 11%)`;
		result["--color-bg-soft"] = `color-mix(in srgb, ${background} 84%, ${neutralLift} 16%)`;
		result["--color-bg-sidebar"] = `color-mix(in srgb, ${background} ${sidebarBase}, black ${sidebarShade})`;
		result["--color-bg-workspace-chrome"] = `color-mix(in srgb, ${background} 92%, ${neutralLift} 8%)`;
		result["--color-bg-workspace-chrome-soft"] = `color-mix(in srgb, ${background} 86%, ${neutralLift} 14%)`;
	}

	if (foreground) {
		result["--color-text-primary"] = foreground;
		if (background) {
			result["--color-text-secondary"] = `color-mix(in srgb, ${foreground} 68%, ${background} 32%)`;
			result["--color-text-tertiary"] = `color-mix(in srgb, ${foreground} 52%, ${background} 48%)`;
		} else {
			result["--color-text-secondary"] = `color-mix(in srgb, ${foreground} 68%, transparent)`;
			result["--color-text-tertiary"] = `color-mix(in srgb, ${foreground} 52%, transparent)`;
		}
		// Keep border subtle and neutral-ish relative to foreground.
		result["--color-border-default"] = `color-mix(in srgb, ${foreground} 12%, transparent)`;
	}

	return result;
}

function clearPiThemeOverlay(root: HTMLElement): void {
	for (const cssVar of PI_THEME_OVERLAY_VARS) {
		root.style.removeProperty(cssVar);
	}
	delete root.dataset.piTheme;
}

function applyPiThemeOverlay(root: HTMLElement, overlay: Partial<Record<(typeof PI_THEME_OVERLAY_VARS)[number], string>>, themeName: string): void {
	for (const cssVar of PI_THEME_OVERLAY_VARS) {
		const value = overlay[cssVar];
		if (value && value.trim().length > 0) {
			root.style.setProperty(cssVar, value);
		} else {
			root.style.removeProperty(cssVar);
		}
	}
	root.dataset.piTheme = themeName;
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
	try {
		const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
		if (!(await exists(path))) return null;
		const content = await readTextFile(path);
		const parsed = JSON.parse(content) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function resolveSelectedPiThemeName(projectPath: string | null | undefined, home: string): Promise<string | null> {
	const globalSettingsPath = joinFsPath(joinFsPath(joinFsPath(home, ".pi"), "agent"), "settings.json");
	const globalSettings = await readJsonFile(globalSettingsPath);
	let selectedTheme = normalizeThemeName(globalSettings?.theme);

	const normalizedProjectPath = normalizeFsPath(projectPath);
	if (normalizedProjectPath) {
		const projectSettingsPath = joinFsPath(joinFsPath(normalizedProjectPath, ".pi"), "settings.json");
		const projectSettings = await readJsonFile(projectSettingsPath);
		const projectTheme = normalizeThemeName(projectSettings?.theme);
		if (projectTheme) selectedTheme = projectTheme;
	}

	return selectedTheme;
}

async function resolvePiThemeFilePath(themeName: string, projectPath: string | null | undefined, home: string): Promise<string | null> {
	const { exists, readDir } = await import("@tauri-apps/plugin-fs");

	const raw = themeName.trim();
	if (!raw) return null;
	if (raw === "dark" || raw === "light") return null;

	const candidates: string[] = [];
	const normalizedProjectPath = normalizeFsPath(projectPath);

	if (isLikelyAbsolutePath(raw) || raw.startsWith("~/")) {
		candidates.push(expandHomePath(raw, home));
	} else {
		if (normalizedProjectPath) {
			candidates.push(joinFsPath(joinFsPath(joinFsPath(normalizedProjectPath, ".pi"), "themes"), `${raw}.json`));
		}
		candidates.push(joinFsPath(joinFsPath(joinFsPath(joinFsPath(home, ".pi"), "agent"), "themes"), `${raw}.json`));
	}

	for (const candidate of candidates) {
		try {
			if (await exists(candidate)) return candidate;
		} catch {
			// ignore and continue
		}
	}

	// Backward compatibility: allow selecting by theme document "name" label (not only file stem).
	if (!isLikelyAbsolutePath(raw) && !raw.startsWith("~/")) {
		const normalizedWanted = raw.toLowerCase();
		const roots: string[] = [];
		if (normalizedProjectPath) roots.push(joinFsPath(joinFsPath(normalizedProjectPath, ".pi"), "themes"));
		roots.push(joinFsPath(joinFsPath(joinFsPath(home, ".pi"), "agent"), "themes"));

		for (const root of roots) {
			try {
				if (!(await exists(root))) continue;
				const entries = await readDir(root);
				for (const entry of entries) {
					if (!entry.isFile || !entry.name.toLowerCase().endsWith(".json")) continue;
					const candidate = joinFsPath(root, entry.name);
					const json = await readJsonFile(candidate);
					const fileStem = entry.name.replace(/\.json$/i, "").toLowerCase();
					const declared = typeof json?.name === "string" ? json.name.trim().toLowerCase() : "";
					if (fileStem === normalizedWanted || declared === normalizedWanted) {
						return candidate;
					}
				}
			} catch {
				// ignore and continue
			}
		}
	}

	return null;
}

export async function syncDesktopThemeWithPiTheme(projectPath?: string | null, preferredThemeName?: string | null): Promise<void> {
	const normalizedProjectPath = normalizeFsPath(projectPath);
	const mode = normalizeThemeModeFromDom();
	const explicitName = (preferredThemeName ?? "").trim();
	const root = document.documentElement;

	try {
		const { homeDir } = await import("@tauri-apps/api/path");
		const home = normalizeFsPath(await homeDir());
		if (!home) {
			clearPiThemeOverlay(root);
			return;
		}

		let selectedThemeName = explicitName;
		if (!selectedThemeName) {
			try {
				const profiles = loadDesktopAppearanceProfiles();
				selectedThemeName = getAppearanceProfileForResolvedTheme(profiles, mode).themeName.trim();
			} catch {
				selectedThemeName = "";
			}
		}
		if (!selectedThemeName) {
			selectedThemeName = (await resolveSelectedPiThemeName(normalizedProjectPath, home)) ?? "";
		}

		const syncKey = `${mode}|${normalizedProjectPath}|${selectedThemeName}`;
		const now = Date.now();
		if (syncKey === lastSyncKey && now - lastSyncAt < 1200) return;
		lastSyncKey = syncKey;
		lastSyncAt = now;

		if (!selectedThemeName || selectedThemeName === "dark" || selectedThemeName === "light" || selectedThemeName === "system") {
			clearPiThemeOverlay(root);
			return;
		}

		const themeFilePath = await resolvePiThemeFilePath(selectedThemeName, normalizedProjectPath, home);
		if (!themeFilePath) {
			clearPiThemeOverlay(root);
			return;
		}

		const themeJson = await readJsonFile(themeFilePath);
		if (!themeJson) {
			clearPiThemeOverlay(root);
			return;
		}

		const theme: PiThemeFile = {
			name: typeof themeJson.name === "string" ? themeJson.name : selectedThemeName,
			vars: (themeJson.vars as Record<string, unknown> | undefined) ?? {},
			colors: (themeJson.colors as Record<string, unknown> | undefined) ?? {},
		};

		const overlay = buildPiThemeOverlay(theme, mode);
		if (Object.keys(overlay).length === 0) {
			clearPiThemeOverlay(root);
			return;
		}

		applyPiThemeOverlay(root, overlay, theme.name ?? selectedThemeName);
	} catch {
		clearPiThemeOverlay(root);
	}
}
