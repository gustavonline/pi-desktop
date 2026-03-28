import type { DesktopThemeResolved } from "./theme-manager.js";

export type ThemeVariant = "light" | "dark";

export interface DesktopAppearanceProfile {
	themeName: string;
	accent: string;
	background: string;
	foreground: string;
	uiFont: string;
	codeFont: string;
	translucentSidebar: boolean;
	contrast: number;
}

export interface DesktopAppearanceProfiles {
	light: DesktopAppearanceProfile;
	dark: DesktopAppearanceProfile;
}

export const DESKTOP_APPEARANCE_PROFILES_STORAGE_KEY = "pi-desktop.appearance.profiles.v1";
export const DESKTOP_APPEARANCE_PROFILE_CHANGED_EVENT = "pi-desktop:appearance-profile-changed";

const DEFAULT_UI_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DEFAULT_CODE_FONT = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

export const DEFAULT_APPEARANCE_PROFILES: DesktopAppearanceProfiles = {
	light: {
		themeName: "pi-desktop-notion-light",
		accent: "",
		background: "",
		foreground: "",
		uiFont: DEFAULT_UI_FONT,
		codeFont: DEFAULT_CODE_FONT,
		translucentSidebar: false,
		contrast: 45,
	},
	dark: {
		themeName: "pi-desktop-notion-dark",
		accent: "",
		background: "",
		foreground: "",
		uiFont: DEFAULT_UI_FONT,
		codeFont: DEFAULT_CODE_FONT,
		translucentSidebar: false,
		contrast: 60,
	},
};

function clampContrast(value: number): number {
	if (!Number.isFinite(value)) return 50;
	return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeFont(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeThemeName(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (!trimmed || trimmed === "dark" || trimmed === "light" || trimmed === "system") return "";
	return trimmed;
}

function sanitizeProfile(value: unknown, fallback: DesktopAppearanceProfile): DesktopAppearanceProfile {
	const input = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	const themeName = sanitizeThemeName(input.themeName) || fallback.themeName;
	return {
		themeName,
		// Color overrides are intentionally ephemeral in Settings and only persisted via "Create theme".
		accent: "",
		background: "",
		foreground: "",
		uiFont: sanitizeFont(input.uiFont, fallback.uiFont),
		codeFont: sanitizeFont(input.codeFont, fallback.codeFont),
		translucentSidebar: typeof input.translucentSidebar === "boolean" ? input.translucentSidebar : fallback.translucentSidebar,
		contrast: clampContrast(typeof input.contrast === "number" ? input.contrast : fallback.contrast),
	};
}

export function loadDesktopAppearanceProfiles(): DesktopAppearanceProfiles {
	try {
		const raw = localStorage.getItem(DESKTOP_APPEARANCE_PROFILES_STORAGE_KEY);
		if (!raw) {
			return {
				light: sanitizeProfile({}, DEFAULT_APPEARANCE_PROFILES.light),
				dark: sanitizeProfile({}, DEFAULT_APPEARANCE_PROFILES.dark),
			};
		}
		const parsed = JSON.parse(raw) as unknown;
		const input = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
		return {
			light: sanitizeProfile(input.light, DEFAULT_APPEARANCE_PROFILES.light),
			dark: sanitizeProfile(input.dark, DEFAULT_APPEARANCE_PROFILES.dark),
		};
	} catch {
		return {
			light: sanitizeProfile({}, DEFAULT_APPEARANCE_PROFILES.light),
			dark: sanitizeProfile({}, DEFAULT_APPEARANCE_PROFILES.dark),
		};
	}
}

export function saveDesktopAppearanceProfiles(profiles: DesktopAppearanceProfiles): void {
	try {
		localStorage.setItem(DESKTOP_APPEARANCE_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
	} catch {
		// ignore
	}
}

export function getAppearanceProfileForResolvedTheme(
	profiles: DesktopAppearanceProfiles,
	resolved: DesktopThemeResolved,
): DesktopAppearanceProfile {
	return resolved === "light" ? profiles.light : profiles.dark;
}

export function applyDesktopAppearanceProfileToRoot(
	resolved: DesktopThemeResolved,
	profiles: DesktopAppearanceProfiles,
): void {
	const profile = getAppearanceProfileForResolvedTheme(profiles, resolved);
	const root = document.documentElement;

	if (profile.accent) {
		root.style.setProperty("--color-accent-primary", profile.accent);
		root.style.setProperty("--color-accent-soft", `color-mix(in srgb, ${profile.accent} 20%, transparent)`);
	}

	if (profile.background) {
		const neutralLift = resolved === "dark" ? "white" : "black";
		const sidebarBase = resolved === "dark" ? "86%" : "92%";
		const sidebarShade = resolved === "dark" ? "14%" : "8%";
		root.style.setProperty("--color-bg-app", profile.background);
		root.style.setProperty("--color-bg-elevated", `color-mix(in srgb, ${profile.background} 94%, ${neutralLift} 6%)`);
		root.style.setProperty("--color-bg-muted", `color-mix(in srgb, ${profile.background} 89%, ${neutralLift} 11%)`);
		root.style.setProperty("--color-bg-soft", `color-mix(in srgb, ${profile.background} 84%, ${neutralLift} 16%)`);
		root.style.setProperty("--color-bg-sidebar", `color-mix(in srgb, ${profile.background} ${sidebarBase}, black ${sidebarShade})`);
		root.style.setProperty("--color-bg-workspace-chrome", `color-mix(in srgb, ${profile.background} 92%, ${neutralLift} 8%)`);
		root.style.setProperty("--color-bg-workspace-chrome-soft", `color-mix(in srgb, ${profile.background} 86%, ${neutralLift} 14%)`);
	}

	if (profile.foreground) {
		const bgForMix = profile.background || "transparent";
		root.style.setProperty("--color-text-primary", profile.foreground);
		root.style.setProperty("--color-text-secondary", `color-mix(in srgb, ${profile.foreground} 68%, ${bgForMix} 32%)`);
		root.style.setProperty("--color-text-tertiary", `color-mix(in srgb, ${profile.foreground} 52%, ${bgForMix} 48%)`);
		root.style.setProperty("--color-border-default", `color-mix(in srgb, ${profile.foreground} 12%, transparent)`);
	}

	root.style.setProperty("--font-family-sans", profile.uiFont);
	root.style.setProperty("--font-family-mono", profile.codeFont);
	root.style.setProperty("--desktop-sidebar-opacity", profile.translucentSidebar ? "88%" : "100%");
	root.style.setProperty("--desktop-sidebar-blur", profile.translucentSidebar ? "14px" : "0px");
	root.style.setProperty("--desktop-sidebar-tint-color", profile.foreground || "var(--color-text-primary)");
	root.style.setProperty("--desktop-sidebar-tint-strength", profile.translucentSidebar ? "8%" : "0%");
	root.style.setProperty("--desktop-chrome-opacity", profile.translucentSidebar ? "92%" : "100%");
	root.style.setProperty("--desktop-chrome-blur", profile.translucentSidebar ? "12px" : "0px");
	root.style.setProperty("--desktop-chrome-tint-strength", profile.translucentSidebar ? "5%" : "0%");
	root.style.setProperty("--desktop-contrast", String(profile.contrast));

	const borderMix = 40 + Math.round((profile.contrast / 100) * 60);
	root.style.setProperty("--border", `color-mix(in srgb, var(--color-border-default) ${borderMix}%, transparent)`);
	root.dataset.desktopContrast = String(profile.contrast);
}

export function notifyDesktopAppearanceProfileChanged(): void {
	window.dispatchEvent(new CustomEvent(DESKTOP_APPEARANCE_PROFILE_CHANGED_EVENT));
}
