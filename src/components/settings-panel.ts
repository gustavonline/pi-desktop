/**
 * Settings Panel - runtime controls for RPC session + app preferences
 */

import { html, nothing, render, type TemplateResult } from "lit";
import { fetchDesktopUpdateStatus, openDesktopUpdate, type DesktopUpdateStatus } from "../desktop-updates.js";
import {
	applyDesktopAppearanceProfileToRoot,
	DEFAULT_APPEARANCE_PROFILES,
	type DesktopAppearanceProfile,
	type DesktopAppearanceProfiles,
	type ThemeVariant,
	loadDesktopAppearanceProfiles,
	notifyDesktopAppearanceProfileChanged,
	saveDesktopAppearanceProfiles,
} from "../theme/appearance-profiles.js";
import {
	type CliUpdateStatus,
	type PiAuthStatus,
	type QueueMode,
	type RpcCompatibilityReport,
	rpcBridge,
} from "../rpc/bridge.js";
import { applyDesktopTheme, getResolvedDesktopTheme, readStoredDesktopTheme, type DesktopThemeMode } from "../theme/theme-manager.js";
import { buildPiThemeDocument } from "../theme/pi-theme-document.js";

interface ThemeOption {
	id: string;
	label: string;
	variant: ThemeVariant;
	accent: string;
	background: string;
	foreground: string;
	contrast: number | null;
	uiFont: string | null;
	codeFont: string | null;
	translucentSidebar: boolean | null;
}

interface ThemeColorDraft {
	accent: string;
	background: string;
	foreground: string;
}

interface SettingsState {
	theme: DesktopThemeMode;
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
	steeringMode: QueueMode;
	followUpMode: QueueMode;
}

export class SettingsPanel {
	private container: HTMLElement;
	private isOpen = false;
	private state: SettingsState = {
		theme: "dark",
		autoCompactionEnabled: true,
		autoRetryEnabled: true,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
	};
	private onClose: (() => void) | null = null;
	private saving = false;
	private authStatus: PiAuthStatus | null = null;
	private authLoading = false;
	private desktopStatus: DesktopUpdateStatus | null = null;
	private desktopLoading = false;
	private desktopOpening = false;
	private desktopActionMessage = "";
	private onDesktopStatusChange: ((status: DesktopUpdateStatus | null) => void) | null = null;
	private cliStatus: CliUpdateStatus | null = null;
	private cliLoading = false;
	private cliUpdating = false;
	private cliActionMessage = "";
	private onCliStatusChange: ((status: CliUpdateStatus | null) => void) | null = null;
	private compatibilityReport: RpcCompatibilityReport | null = null;
	private compatibilityLoading = false;
	private appearanceProfiles: DesktopAppearanceProfiles = loadDesktopAppearanceProfiles();
	private availableThemes: ThemeOption[] = [];
	private themeCatalogLoading = false;
	private themeCatalogError = "";
	private themeCatalogMessage = "";
	private createThemeDialogOpen = false;
	private createThemeDialogTheme: ThemeVariant = "dark";
	private createThemeDialogName = "";
	private createThemeDialogSaving = false;
	private createThemeDialogError = "";
	private colorDrafts: Record<ThemeVariant, ThemeColorDraft> = {
		light: { accent: "", background: "", foreground: "" },
		dark: { accent: "", background: "", foreground: "" },
	};

	constructor(container: HTMLElement) {
		this.container = container;
		this.loadTheme();
	}

	setContainer(container: HTMLElement): void {
		if (this.container === container) return;
		const wasOpen = this.isOpen;
		this.container = container;
		if (wasOpen) this.render();
	}

	hasRenderedContent(): boolean {
		return this.container.childElementCount > 0;
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	setOnDesktopStatusChange(callback: (status: DesktopUpdateStatus | null) => void): void {
		this.onDesktopStatusChange = callback;
	}

	setOnCliStatusChange(callback: (status: CliUpdateStatus | null) => void): void {
		this.onCliStatusChange = callback;
	}

	isVisible(): boolean {
		return this.isOpen;
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.appearanceProfiles = loadDesktopAppearanceProfiles();
		this.resetColorDrafts();
		this.createThemeDialogOpen = false;
		this.createThemeDialogSaving = false;
		this.createThemeDialogError = "";
		this.clearPersistedProfileColorOverrides();
		this.themeCatalogMessage = "";
		this.loadTheme();
		this.render();
		await this.loadState();
		if (!this.isOpen) return;
		this.render();
	}

	close(notify = true): void {
		this.resetColorDrafts();
		this.createThemeDialogOpen = false;
		this.createThemeDialogSaving = false;
		this.createThemeDialogError = "";
		this.applyAppearanceProfileForCurrentResolvedTheme();
		this.isOpen = false;
		this.render();
		if (notify) this.onClose?.();
	}

	hideWithoutClearing(): void {
		this.resetColorDrafts();
		this.createThemeDialogOpen = false;
		this.createThemeDialogSaving = false;
		this.createThemeDialogError = "";
		this.applyAppearanceProfileForCurrentResolvedTheme();
		this.isOpen = false;
	}

	private loadTheme(): void {
		const saved = readStoredDesktopTheme();
		this.state.theme = saved;
		this.applyTheme(saved);
	}

	private applyTheme(theme: DesktopThemeMode): void {
		applyDesktopTheme(theme);
	}

	private getCurrentResolvedTheme(): ThemeVariant {
		return getResolvedDesktopTheme() === "light" ? "light" : "dark";
	}

	private applyAppearanceProfileForCurrentResolvedTheme(notify = true): void {
		const resolved = this.getCurrentResolvedTheme();
		applyDesktopAppearanceProfileToRoot(resolved, this.appearanceProfiles);
		if (this.isOpen) this.applyColorDraftPreviewToRoot(resolved);
		if (notify) notifyDesktopAppearanceProfileChanged();
	}

	private getProfile(theme: ThemeVariant): DesktopAppearanceProfile {
		return theme === "light" ? this.appearanceProfiles.light : this.appearanceProfiles.dark;
	}

	private saveAppearanceProfiles(): void {
		saveDesktopAppearanceProfiles(this.appearanceProfiles);
	}

	private normalizeThemeSelection(value: unknown): string {
		if (typeof value !== "string") return "";
		const trimmed = value.trim();
		if (!trimmed || trimmed === "dark" || trimmed === "light" || trimmed === "system") return "";
		return trimmed;
	}

	private resetColorDrafts(): void {
		this.colorDrafts.light = { accent: "", background: "", foreground: "" };
		this.colorDrafts.dark = { accent: "", background: "", foreground: "" };
	}

	private clearPersistedProfileColorOverrides(): void {
		let changed = false;
		for (const variant of ["light", "dark"] as const) {
			const profile = this.getProfile(variant);
			if (profile.accent || profile.background || profile.foreground) {
				profile.accent = "";
				profile.background = "";
				profile.foreground = "";
				changed = true;
			}
		}
		if (changed) this.saveAppearanceProfiles();
	}

	private applyColorDraftPreviewToRoot(theme: ThemeVariant): void {
		const draft = this.colorDrafts[theme];
		if (!draft.accent && !draft.background && !draft.foreground) return;

		const root = document.documentElement;
		const base = this.baseThemePreview(theme);
		const effectiveBackground = draft.background || base.background;
		const neutralLift = theme === "dark" ? "white" : "black";

		if (draft.accent) {
			root.style.setProperty("--color-accent-primary", draft.accent);
			root.style.setProperty("--color-accent-soft", `color-mix(in srgb, ${draft.accent} 20%, transparent)`);
		}

		if (draft.background) {
			root.style.setProperty("--color-bg-app", draft.background);
			root.style.setProperty("--color-bg-elevated", `color-mix(in srgb, ${draft.background} 94%, ${neutralLift} 6%)`);
			root.style.setProperty("--color-bg-muted", `color-mix(in srgb, ${draft.background} 89%, ${neutralLift} 11%)`);
			root.style.setProperty("--color-bg-soft", `color-mix(in srgb, ${draft.background} 84%, ${neutralLift} 16%)`);
			root.style.setProperty("--color-bg-sidebar", `color-mix(in srgb, ${draft.background} 91%, ${neutralLift} 9%)`);
			root.style.setProperty("--color-bg-workspace-chrome", `color-mix(in srgb, ${draft.background} 92%, ${neutralLift} 8%)`);
			root.style.setProperty("--color-bg-workspace-chrome-soft", `color-mix(in srgb, ${draft.background} 86%, ${neutralLift} 14%)`);
		}

		if (draft.foreground) {
			root.style.setProperty("--color-text-primary", draft.foreground);
			root.style.setProperty("--color-text-secondary", `color-mix(in srgb, ${draft.foreground} 68%, ${effectiveBackground} 32%)`);
			root.style.setProperty("--color-text-tertiary", `color-mix(in srgb, ${draft.foreground} 52%, ${effectiveBackground} 48%)`);
			root.style.setProperty("--color-border-default", `color-mix(in srgb, ${draft.foreground} 12%, transparent)`);
			root.style.setProperty("--border", `color-mix(in srgb, var(--color-border-default) ${40 + Math.round((this.getProfile(theme).contrast / 100) * 60)}%, transparent)`);
		}
	}

	private async refreshThemeCatalog(): Promise<void> {
		this.themeCatalogLoading = true;
		this.themeCatalogError = "";
		this.render();
		try {
			const { homeDir } = await import("@tauri-apps/api/path");
			const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
			const home = await homeDir();
			const themesRoot = `${home.replace(/\\/g, "/").replace(/\/+$/, "")}/.pi/agent/themes`;
			if (!(await exists(themesRoot))) {
				this.availableThemes = [];
				return;
			}
			const entries = await readDir(themesRoot);
			const list: ThemeOption[] = [];
			for (const entry of entries) {
				if (!entry.isFile || !entry.name.toLowerCase().endsWith(".json")) continue;
				const path = `${themesRoot}/${entry.name}`;
				const id = entry.name.replace(/\.json$/i, "");
				try {
					const raw = await readTextFile(path);
					const parsed = JSON.parse(raw) as Record<string, unknown>;
					const label = id;
					const preview = this.extractThemePreview(parsed);
					const variant = this.extractThemeVariant(parsed, id, preview.background);
					const defaults = this.extractThemeDesktopDefaults(parsed);
					list.push({
						id,
						label,
						variant,
						accent: preview.accent,
						background: preview.background,
						foreground: preview.foreground,
						contrast: defaults.contrast,
						uiFont: defaults.uiFont,
						codeFont: defaults.codeFont,
						translucentSidebar: defaults.translucentSidebar,
					});
				} catch {
					// ignore malformed theme file
				}
			}
			list.sort((a, b) => a.label.localeCompare(b.label));
			this.availableThemes = list;

			let migrated = false;
			for (const variant of ["light", "dark"] as const) {
				const profile = this.getProfile(variant);
				const match = this.lookupThemeOption(profile.themeName);
				if (match && profile.themeName !== match.id) {
					profile.themeName = match.id;
					migrated = true;
				}
				const selected = this.lookupThemeOption(profile.themeName);
				if (!profile.themeName || !selected || selected.variant !== variant) {
					const defaultId = this.resolveDefaultThemeId(variant);
					if (defaultId && profile.themeName !== defaultId) {
						profile.themeName = defaultId;
						migrated = true;
					}
				}
			}
			if (migrated) this.saveAppearanceProfiles();
		} catch (err) {
			this.themeCatalogError = err instanceof Error ? err.message : String(err);
			this.availableThemes = [];
		} finally {
			this.themeCatalogLoading = false;
			this.render();
		}
	}

	private xtermIndexToHex(index: number): string | null {
		if (!Number.isInteger(index) || index < 0 || index > 255) return null;
		const hex = (value: number): string => value.toString(16).padStart(2, "0");
		const levels = [0, 95, 135, 175, 215, 255] as const;
		if (index < 16) {
			const ansi = [
				"#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
				"#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
			] as const;
			return ansi[index] ?? null;
		}
		if (index <= 231) {
			const value = index - 16;
			const r = Math.floor(value / 36);
			const g = Math.floor((value % 36) / 6);
			const b = value % 6;
			return `#${hex(levels[r] ?? 0)}${hex(levels[g] ?? 0)}${hex(levels[b] ?? 0)}`;
		}
		const gray = 8 + (index - 232) * 10;
		return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
	}

	private normalizeColorLiteral(value: unknown): string | null {
		if (typeof value === "number") return this.xtermIndexToHex(value);
		if (typeof value !== "string") return null;
		const trimmed = value.trim();
		if (!trimmed) return null;
		if (/^#([0-9a-f]{3,8})$/i.test(trimmed)) return trimmed;
		if (/^\d{1,3}$/.test(trimmed)) return this.xtermIndexToHex(Number(trimmed));
		return null;
	}

	private resolveThemeValue(theme: Record<string, unknown>, value: unknown, seen = new Set<string>()): string | null {
		const direct = this.normalizeColorLiteral(value);
		if (direct) return direct;
		if (typeof value !== "string") return null;
		const ref = value.trim();
		if (!ref || seen.has(ref)) return null;
		seen.add(ref);
		const vars = (theme.vars as Record<string, unknown> | undefined) ?? {};
		if (Object.prototype.hasOwnProperty.call(vars, ref)) {
			const fromVar = this.resolveThemeValue(theme, vars[ref], seen);
			if (fromVar) return fromVar;
		}
		const colors = (theme.colors as Record<string, unknown> | undefined) ?? {};
		if (Object.prototype.hasOwnProperty.call(colors, ref)) {
			const fromColor = this.resolveThemeValue(theme, colors[ref], seen);
			if (fromColor) return fromColor;
		}
		return null;
	}

	private extractThemePreview(theme: Record<string, unknown>): { accent: string; background: string; foreground: string } {
		const colors = (theme.colors as Record<string, unknown> | undefined) ?? {};
		const accent = this.resolveThemeValue(theme, colors.accent) ?? "#7a818f";
		const background =
			this.resolveThemeValue(theme, colors.selectedBg) ??
			this.resolveThemeValue(theme, colors.userMessageBg) ??
			(this.getCurrentResolvedTheme() === "light" ? "#ffffff" : "#101010");
		const foreground =
			this.resolveThemeValue(theme, colors.text) ??
			this.resolveThemeValue(theme, colors.userMessageText) ??
			(this.getCurrentResolvedTheme() === "light" ? "#37352f" : "#efefef");
		return { accent, background, foreground };
	}

	private parseColorRgb(color: string): { r: number; g: number; b: number } | null {
		const trimmed = color.trim();
		const short = trimmed.match(/^#([0-9a-f]{3})$/i);
		if (short) {
			const [r, g, b] = short[1].split("");
			return {
				r: parseInt(`${r}${r}`, 16),
				g: parseInt(`${g}${g}`, 16),
				b: parseInt(`${b}${b}`, 16),
			};
		}
		const full = trimmed.match(/^#([0-9a-f]{6})$/i);
		if (full) {
			return {
				r: parseInt(full[1].slice(0, 2), 16),
				g: parseInt(full[1].slice(2, 4), 16),
				b: parseInt(full[1].slice(4, 6), 16),
			};
		}
		const rgb = trimmed.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
		if (rgb) {
			return {
				r: Math.max(0, Math.min(255, Number(rgb[1]))),
				g: Math.max(0, Math.min(255, Number(rgb[2]))),
				b: Math.max(0, Math.min(255, Number(rgb[3]))),
			};
		}
		return null;
	}

	private colorLuminance(color: string): number | null {
		const rgb = this.parseColorRgb(color);
		if (!rgb) return null;
		const toLinear = (channel: number): number => {
			const s = channel / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		const r = toLinear(rgb.r);
		const g = toLinear(rgb.g);
		const b = toLinear(rgb.b);
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	}

	private inferVariantFromBackground(background: string): ThemeVariant | null {
		const luminance = this.colorLuminance(background);
		if (luminance === null) return null;
		return luminance >= 0.42 ? "light" : "dark";
	}

	private extractThemeVariant(theme: Record<string, unknown>, id: string, background: string): ThemeVariant {
		const colors = (theme.colors as Record<string, unknown> | undefined) ?? {};
		const directBackground =
			this.resolveThemeValue(theme, colors.selectedBg) ??
			this.resolveThemeValue(theme, colors.userMessageBg) ??
			this.resolveThemeValue(theme, colors.customMessageBg) ??
			null;
		if (directBackground) {
			const byDirectBackground = this.inferVariantFromBackground(directBackground);
			if (byDirectBackground) return byDirectBackground;
		}

		const meta = theme.piDesktop;
		if (meta && typeof meta === "object" && !Array.isArray(meta)) {
			const variant = (meta as Record<string, unknown>).variant;
			if (variant === "light" || variant === "dark") return variant;
		}
		const normalizedId = id.toLowerCase();
		if (normalizedId.includes("-light")) return "light";
		if (normalizedId.includes("-dark")) return "dark";
		const fromBackground = this.inferVariantFromBackground(background);
		if (fromBackground) return fromBackground;
		return normalizedId.includes("light") ? "light" : "dark";
	}

	private extractThemeDesktopDefaults(theme: Record<string, unknown>): {
		contrast: number | null;
		uiFont: string | null;
		codeFont: string | null;
		translucentSidebar: boolean | null;
	} {
		const meta = theme.piDesktop;
		if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
			return { contrast: null, uiFont: null, codeFont: null, translucentSidebar: null };
		}
		const m = meta as Record<string, unknown>;
		const contrast = typeof m.contrast === "number" && Number.isFinite(m.contrast)
			? Math.max(0, Math.min(100, Math.round(m.contrast)))
			: null;
		const fonts = m.fonts;
		const fontsObj = fonts && typeof fonts === "object" && !Array.isArray(fonts)
			? (fonts as Record<string, unknown>)
			: null;
		const uiFont = fontsObj && typeof fontsObj.ui === "string" && fontsObj.ui.trim() ? fontsObj.ui.trim() : null;
		const codeFont = fontsObj && typeof fontsObj.code === "string" && fontsObj.code.trim() ? fontsObj.code.trim() : null;
		const translucentSidebar = typeof m.opaqueWindows === "boolean" ? !m.opaqueWindows : null;
		return { contrast, uiFont, codeFont, translucentSidebar };
	}

	private themeOptionsForVariant(theme: ThemeVariant): ThemeOption[] {
		return this.availableThemes.filter((entry) => entry.variant === theme);
	}

	private lookupThemeOption(themeName: string): ThemeOption | null {
		const normalized = themeName.trim().toLowerCase();
		if (!normalized) return null;
		return this.availableThemes.find((entry) => entry.id.toLowerCase() === normalized || entry.label.toLowerCase() === normalized) ?? null;
	}

	private resolveDefaultThemeId(theme: ThemeVariant): string {
		const scoped = this.themeOptionsForVariant(theme);
		const preferred = `pi-desktop-notion-${theme}`;
		const exact = scoped.find((entry) => entry.id.toLowerCase() === preferred);
		if (exact) return exact.id;
		return scoped[0]?.id ?? "";
	}

	private themeBehaviorDefaults(theme: ThemeVariant, selected: ThemeOption | null): {
		contrast: number;
		uiFont: string;
		codeFont: string;
		translucentSidebar: boolean;
	} {
		const profileDefaults = theme === "light" ? DEFAULT_APPEARANCE_PROFILES.light : DEFAULT_APPEARANCE_PROFILES.dark;
		return {
			contrast: selected?.contrast ?? profileDefaults.contrast,
			uiFont: selected?.uiFont ?? profileDefaults.uiFont,
			codeFont: selected?.codeFont ?? profileDefaults.codeFont,
			translucentSidebar: selected?.translucentSidebar ?? profileDefaults.translucentSidebar,
		};
	}

	private hasThemeDraftChanges(theme: ThemeVariant): boolean {
		const draft = this.colorDrafts[theme];
		if (draft.accent || draft.background || draft.foreground) return true;
		const profile = this.getProfile(theme);
		const selected = this.lookupThemeOption(profile.themeName);
		const defaults = this.themeBehaviorDefaults(theme, selected);
		return (
			profile.contrast !== defaults.contrast ||
			profile.uiFont !== defaults.uiFont ||
			profile.codeFont !== defaults.codeFont ||
			profile.translucentSidebar !== defaults.translucentSidebar
		);
	}

	private baseThemePreview(theme: ThemeVariant): { accent: string; background: string; foreground: string } {
		const profile = this.getProfile(theme);
		const option = this.lookupThemeOption(profile.themeName);
		if (option) {
			return { accent: option.accent, background: option.background, foreground: option.foreground };
		}
		if (theme === "light") return { accent: "#3183D8", background: "#FFFFFF", foreground: "#37352F" };
		return { accent: "#FF6363", background: "#101010", foreground: "#EFEFEF" };
	}

	private profilePreview(theme: ThemeVariant): { accent: string; background: string; foreground: string } {
		const base = this.baseThemePreview(theme);
		const draft = this.colorDrafts[theme];
		return {
			accent: draft.accent || base.accent,
			background: draft.background || base.background,
			foreground: draft.foreground || base.foreground,
		};
	}

	private setProfileThemeName(theme: ThemeVariant, name: string): void {
		const profile = this.getProfile(theme);
		const normalized = this.normalizeThemeSelection(name);
		profile.themeName = normalized || this.resolveDefaultThemeId(theme);
		profile.accent = "";
		profile.background = "";
		profile.foreground = "";

		const selected = this.lookupThemeOption(profile.themeName);
		const defaults = this.themeBehaviorDefaults(theme, selected);
		profile.contrast = defaults.contrast;
		profile.uiFont = defaults.uiFont;
		profile.codeFont = defaults.codeFont;
		profile.translucentSidebar = defaults.translucentSidebar;

		this.colorDrafts[theme] = { accent: "", background: "", foreground: "" };
		this.saveAppearanceProfiles();
		if (theme === this.getCurrentResolvedTheme()) {
			this.applyAppearanceProfileForCurrentResolvedTheme();
		}
		this.render();
	}

	private setProfileTranslucentSidebar(theme: ThemeVariant, value: boolean): void {
		const profile = this.getProfile(theme);
		profile.translucentSidebar = value;
		this.saveAppearanceProfiles();
		if (theme === this.getCurrentResolvedTheme()) {
			this.applyAppearanceProfileForCurrentResolvedTheme(false);
		}
		this.render();
	}

	private setProfileContrast(theme: ThemeVariant, value: number): void {
		const profile = this.getProfile(theme);
		profile.contrast = Math.max(0, Math.min(100, Math.round(value)));
		this.saveAppearanceProfiles();
		if (theme === this.getCurrentResolvedTheme()) {
			this.applyAppearanceProfileForCurrentResolvedTheme(false);
		}
		this.render();
	}

	private normalizeHex6(value: string): string | null {
		const trimmed = value.trim();
		const short = trimmed.match(/^#([0-9a-f]{3})$/i);
		if (short) {
			const [r, g, b] = short[1].split("");
			return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
		}
		const full = trimmed.match(/^#([0-9a-f]{6})$/i);
		if (full) return `#${full[1].toUpperCase()}`;
		return null;
	}

	private coercePickerColor(value: string): string {
		return this.normalizeHex6(value) ?? "#7A818F";
	}

	private setProfileColor(theme: ThemeVariant, key: "accent" | "background" | "foreground", value: string): void {
		const normalized = this.normalizeHex6(value);
		if (!normalized) return;
		this.colorDrafts[theme][key] = normalized;
		if (theme === this.getCurrentResolvedTheme()) {
			this.applyAppearanceProfileForCurrentResolvedTheme(false);
		}
		this.render();
	}

	private setProfileFont(theme: ThemeVariant, key: "uiFont" | "codeFont", value: string): void {
		const next = value.trim();
		if (!next) return;
		const profile = this.getProfile(theme);
		profile[key] = next;
		this.saveAppearanceProfiles();
		if (theme === this.getCurrentResolvedTheme()) {
			this.applyAppearanceProfileForCurrentResolvedTheme(false);
		}
		this.render();
	}

	private joinFsPath(base: string, child: string): string {
		const b = base.replace(/\\/g, "/").replace(/\/+$/, "");
		const c = child.replace(/\\/g, "/").replace(/^\/+/, "");
		return b ? `${b}/${c}` : c;
	}

	private async createThemeFromProfile(theme: ThemeVariant): Promise<void> {
		if (!this.hasThemeDraftChanges(theme)) return;
		this.createThemeDialogOpen = true;
		this.createThemeDialogTheme = theme;
		this.createThemeDialogName = `${theme}-custom`;
		this.createThemeDialogSaving = false;
		this.createThemeDialogError = "";
		this.render();
	}

	private closeCreateThemeDialog(): void {
		if (this.createThemeDialogSaving) return;
		this.createThemeDialogOpen = false;
		this.createThemeDialogError = "";
		this.render();
	}

	private async saveCreateThemeFromDialog(): Promise<void> {
		if (!this.createThemeDialogOpen || this.createThemeDialogSaving) return;
		const normalizedName = this.createThemeDialogName.trim();
		if (!normalizedName) {
			this.createThemeDialogError = "Theme name is required.";
			this.render();
			return;
		}
		this.createThemeDialogSaving = true;
		this.createThemeDialogError = "";
		this.render();
		try {
			await this.persistThemeFromProfile(this.createThemeDialogTheme, normalizedName);
			this.createThemeDialogOpen = false;
			this.createThemeDialogSaving = false;
			this.createThemeDialogError = "";
			this.render();
		} catch (err) {
			this.createThemeDialogSaving = false;
			this.createThemeDialogError = err instanceof Error ? err.message : String(err);
			this.render();
		}
	}

	private async persistThemeFromProfile(theme: ThemeVariant, normalizedName: string): Promise<void> {
		const profile = this.getProfile(theme);
		const preview = this.profilePreview(theme);
		const accent = preview.accent;
		const background = preview.background;
		const foreground = preview.foreground;
		const doc = buildPiThemeDocument({
			name: normalizedName,
			variant: theme,
			accent,
			surface: background,
			ink: foreground,
			contrast: profile.contrast,
			fonts: {
				ui: profile.uiFont || null,
				code: profile.codeFont || null,
			},
			opaqueWindows: !profile.translucentSidebar,
			source: "pi-desktop-theme-v1",
		});

		const safeBase = normalizedName
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+/, "")
			.replace(/-+$/, "") || `${theme}-custom`;

		const { homeDir } = await import("@tauri-apps/api/path");
		const { exists, mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
		const home = (await homeDir()).replace(/\\/g, "/").replace(/\/+$/, "");
		const themesRoot = this.joinFsPath(this.joinFsPath(this.joinFsPath(home, ".pi"), "agent"), "themes");
		await mkdir(themesRoot, { recursive: true });

		let fileStem = safeBase;
		let targetPath = this.joinFsPath(themesRoot, `${fileStem}.json`);
		let index = 2;
		while (await exists(targetPath)) {
			fileStem = `${safeBase}-${index}`;
			targetPath = this.joinFsPath(themesRoot, `${fileStem}.json`);
			index += 1;
		}

		await writeTextFile(targetPath, `${JSON.stringify(doc, null, 2)}\n`);
		profile.themeName = fileStem;
		profile.accent = "";
		profile.background = "";
		profile.foreground = "";
		this.colorDrafts[theme] = { accent: "", background: "", foreground: "" };
		this.saveAppearanceProfiles();
		if (theme === this.getCurrentResolvedTheme()) {
			this.applyAppearanceProfileForCurrentResolvedTheme();
		}
		await this.refreshThemeCatalog();
		this.themeCatalogMessage = `Created theme ${fileStem}.json in ~/.pi/agent/themes`;
	}

	private async loadState(): Promise<void> {
		try {
			const sessionState = await rpcBridge.getState();
			this.state.autoCompactionEnabled = sessionState.autoCompactionEnabled;
			this.state.steeringMode = sessionState.steeringMode;
			this.state.followUpMode = sessionState.followUpMode;
		} catch {
			// ignore
		}

		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const saved = (await invoke("load_settings")) as {
				theme?: string;
				auto_retry?: boolean;
			};
			if (saved.theme === "dark" || saved.theme === "light" || saved.theme === "system") {
				this.state.theme = saved.theme;
				this.applyTheme(saved.theme);
			}
			if (typeof saved.auto_retry === "boolean") {
				this.state.autoRetryEnabled = saved.auto_retry;
			}
		} catch {
			// ignore missing persisted settings
		}

		await Promise.all([
			this.refreshAuthStatus(),
			this.refreshDesktopStatus(),
			this.refreshCliStatus(),
			this.refreshCompatibilityStatus(),
			this.refreshThemeCatalog(),
		]);
		this.applyAppearanceProfileForCurrentResolvedTheme(false);
	}

	private async refreshAuthStatus(): Promise<void> {
		this.authLoading = true;
		this.render();
		try {
			this.authStatus = await rpcBridge.getPiAuthStatus();
		} catch {
			this.authStatus = null;
		} finally {
			this.authLoading = false;
			this.render();
		}
	}

	private async refreshDesktopStatus(): Promise<void> {
		this.desktopLoading = true;
		this.render();
		try {
			this.desktopStatus = await fetchDesktopUpdateStatus();
		} catch {
			this.desktopStatus = null;
		} finally {
			this.desktopLoading = false;
			this.render();
			this.onDesktopStatusChange?.(this.desktopStatus);
		}
	}

	private async openDesktopUpdateNow(): Promise<void> {
		if (this.desktopOpening) return;
		if (!this.desktopStatus?.updateAvailable) return;
		this.desktopOpening = true;
		this.desktopActionMessage = this.desktopStatus.assetUrl ? "Opening desktop installer…" : "Opening release page…";
		this.render();
		try {
			await openDesktopUpdate(this.desktopStatus);
			this.desktopActionMessage = this.desktopStatus.assetName
				? `Opened ${this.desktopStatus.assetName} for download.`
				: "Opened release page.";
		} catch (err) {
			this.desktopActionMessage = err instanceof Error ? err.message : "Failed to open desktop update.";
		} finally {
			this.desktopOpening = false;
			this.render();
		}
	}

	private async refreshCliStatus(): Promise<void> {
		this.cliLoading = true;
		this.render();
		try {
			this.cliStatus = await rpcBridge.getCliUpdateStatus();
		} catch {
			this.cliStatus = null;
		} finally {
			this.cliLoading = false;
			this.render();
			this.onCliStatusChange?.(this.cliStatus);
		}
	}

	private async refreshCompatibilityStatus(): Promise<void> {
		this.compatibilityLoading = true;
		this.render();
		try {
			this.compatibilityReport = await rpcBridge.checkRpcCompatibility();
		} catch (err) {
			this.compatibilityReport = {
				ok: false,
				checks: [],
				error: err instanceof Error ? err.message : String(err),
				checkedAt: Date.now(),
			};
		} finally {
			this.compatibilityLoading = false;
			this.render();
		}
	}


	private async updateCliNow(): Promise<void> {
		if (this.cliUpdating) return;
		this.cliUpdating = true;
		this.cliActionMessage = "Updating CLI via npm…";
		this.render();
		try {
			const result = await rpcBridge.updateCliViaNpm();
			if (result.exit_code === 0) {
				this.cliActionMessage = "CLI updated successfully.";
			} else {
				this.cliActionMessage = `CLI update failed (exit ${result.exit_code}).`;
			}
			await this.refreshCliStatus();
			await this.refreshCompatibilityStatus();
		} catch (err) {
			this.cliActionMessage = err instanceof Error ? err.message : "Failed to update CLI.";
		} finally {
			this.cliUpdating = false;
			this.render();
		}
	}

	private async setTheme(theme: DesktopThemeMode): Promise<void> {
		this.state.theme = theme;
		this.applyTheme(theme);
		this.applyAppearanceProfileForCurrentResolvedTheme(false);
		this.render();
		await this.saveSettings();
	}

	private async setAutoCompaction(enabled: boolean): Promise<void> {
		try {
			await rpcBridge.setAutoCompaction(enabled);
			this.state.autoCompactionEnabled = enabled;
			this.render();
			await this.saveSettings();
		} catch (err) {
			console.error("Failed to set auto-compaction:", err);
		}
	}

	private async setAutoRetry(enabled: boolean): Promise<void> {
		try {
			await rpcBridge.setAutoRetry(enabled);
			this.state.autoRetryEnabled = enabled;
			this.render();
			await this.saveSettings();
		} catch (err) {
			console.error("Failed to set auto-retry:", err);
		}
	}

	private async setSteeringMode(mode: QueueMode): Promise<void> {
		try {
			await rpcBridge.setSteeringMode(mode);
			this.state.steeringMode = mode;
			this.render();
			await this.saveSettings();
		} catch (err) {
			console.error("Failed to set steering mode:", err);
		}
	}

	private async setFollowUpMode(mode: QueueMode): Promise<void> {
		try {
			await rpcBridge.setFollowUpMode(mode);
			this.state.followUpMode = mode;
			this.render();
			await this.saveSettings();
		} catch (err) {
			console.error("Failed to set follow-up mode:", err);
		}
	}

	private async saveSettings(): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("save_settings", {
				settings: {
					theme: this.state.theme,
					thinking_level: "medium",
					auto_compaction: this.state.autoCompactionEnabled,
					auto_retry: this.state.autoRetryEnabled,
					steering_mode: this.state.steeringMode,
					follow_up_mode: this.state.followUpMode,
					model_provider: null,
					model_id: null,
				},
			});
		} catch (err) {
			console.error("Failed to save settings:", err);
		} finally {
			this.saving = false;
		}
	}

	private renderToggle(
		label: string,
		description: string,
		checked: boolean,
		onChange: (checked: boolean) => void,
	): TemplateResult {
		return html`
			<div class="settings-row">
				<div>
					<div class="settings-label">${label}</div>
					<div class="settings-desc">${description}</div>
				</div>
				<button class="toggle ${checked ? "on" : "off"}" @click=${() => onChange(!checked)}>
					<span></span>
				</button>
			</div>
		`;
	}

	private renderColorControl(
		theme: ThemeVariant,
		key: "accent" | "background" | "foreground",
		value: string,
	): TemplateResult {
		const normalized = this.coercePickerColor(value);
		const inputId = `appearance-${theme}-${key}`;
		return html`
			<label class="appearance-pill appearance-pill-button" for=${inputId}>
				<input
					id=${inputId}
					type="color"
					class="appearance-color-input"
					.value=${normalized}
					@input=${(e: Event) => this.setProfileColor(theme, key, (e.target as HTMLInputElement).value)}
				/>
				<span class="appearance-swatch" style=${`background:${normalized}`}></span>
				<span>${normalized}</span>
			</label>
		`;
	}

	private renderThemeProfileCard(theme: ThemeVariant): TemplateResult {
		const title = theme === "light" ? "Light theme" : "Dark theme";
		const profile = this.getProfile(theme);
		const preview = this.profilePreview(theme);
		const scopedOptions = this.themeOptionsForVariant(theme);
		const selected = profile.themeName;
		const selectedOption = this.lookupThemeOption(selected);
		const selectedValue = selectedOption && selectedOption.variant === theme
			? selectedOption.id
			: this.resolveDefaultThemeId(theme);
		const canCreateTheme = this.hasThemeDraftChanges(theme);
		return html`
			<section class="appearance-profile-card">
				<div class="appearance-profile-header">
					<div class="appearance-profile-title">${title}</div>
					<button
						class="appearance-profile-action-btn"
						?disabled=${!canCreateTheme}
						title=${canCreateTheme ? "Create a new theme from current adjustments" : "Adjust colors, fonts, contrast, or translucency first"}
						@click=${() => this.createThemeFromProfile(theme)}
					>
						Create theme
					</button>
					<div class="appearance-theme-select-wrap">
						<select
							class="appearance-theme-select"
							.value=${selectedValue}
							@change=${(e: Event) => this.setProfileThemeName(theme, (e.target as HTMLSelectElement).value)}
						>
							${scopedOptions.map((entry) => html`<option value=${entry.id} ?selected=${selectedValue === entry.id}>${entry.label}</option>`)}
						</select>
					</div>
				</div>
				<div class="appearance-profile-row"><span>Accent</span>${this.renderColorControl(theme, "accent", preview.accent)}</div>
				<div class="appearance-profile-row"><span>Background</span>${this.renderColorControl(theme, "background", preview.background)}</div>
				<div class="appearance-profile-row"><span>Foreground</span>${this.renderColorControl(theme, "foreground", preview.foreground)}</div>
				<div class="appearance-profile-row">
					<span>UI font</span>
					<input
						class="appearance-font-input"
						.value=${profile.uiFont}
						@change=${(e: Event) => this.setProfileFont(theme, "uiFont", (e.target as HTMLInputElement).value)}
					/>
				</div>
				<div class="appearance-profile-row">
					<span>Code font</span>
					<input
						class="appearance-font-input"
						.value=${profile.codeFont}
						@change=${(e: Event) => this.setProfileFont(theme, "codeFont", (e.target as HTMLInputElement).value)}
					/>
				</div>
				<div class="appearance-profile-row">
					<span>Translucent sidebar</span>
					<button class="toggle ${profile.translucentSidebar ? "on" : "off"}" @click=${() => this.setProfileTranslucentSidebar(theme, !profile.translucentSidebar)}>
						<span></span>
					</button>
				</div>
				<div class="appearance-profile-row">
					<span>Contrast</span>
					<div class="appearance-contrast-wrap">
						<input
							type="range"
							min="0"
							max="100"
							.step="1"
							.value=${String(profile.contrast)}
							@input=${(e: Event) => this.setProfileContrast(theme, Number((e.target as HTMLInputElement).value))}
						/>
						<span>${profile.contrast}</span>
					</div>
				</div>
			</section>
		`;
	}

	private renderCreateThemeDialog(): TemplateResult | typeof nothing {
		if (!this.createThemeDialogOpen) return nothing;
		const variantLabel = this.createThemeDialogTheme === "dark" ? "Dark" : "Light";
		return html`
			<div class="settings-subdialog-backdrop" @click=${() => this.closeCreateThemeDialog()}>
				<div class="settings-subdialog-card" @click=${(e: Event) => e.stopPropagation()}>
					<div class="settings-subdialog-title">Create theme (${variantLabel})</div>
					<div class="settings-subdialog-desc">Give your adjusted theme a name and save it to ~/.pi/agent/themes.</div>
					<input
						class="settings-subdialog-input"
						placeholder="my-theme-name"
						.value=${this.createThemeDialogName}
						?disabled=${this.createThemeDialogSaving}
						@input=${(e: Event) => {
							this.createThemeDialogName = (e.target as HTMLInputElement).value;
							if (this.createThemeDialogError) this.createThemeDialogError = "";
							this.render();
						}}
						@keydown=${(e: KeyboardEvent) => {
							if (e.key === "Enter") {
								e.preventDefault();
								void this.saveCreateThemeFromDialog();
							}
						}}
					/>
					${this.createThemeDialogError ? html`<div class="settings-subdialog-error">${this.createThemeDialogError}</div>` : nothing}
					<div class="settings-subdialog-actions">
						<button class="ghost-btn" ?disabled=${this.createThemeDialogSaving} @click=${() => this.closeCreateThemeDialog()}>Cancel</button>
						<button class="ghost-btn" ?disabled=${this.createThemeDialogSaving} @click=${() => void this.saveCreateThemeFromDialog()}>
							${this.createThemeDialogSaving ? "Saving…" : "Save theme"}
						</button>
					</div>
				</div>
			</div>
		`;
	}

	render(): void {
		if (!this.isOpen) {
			this.container.innerHTML = "";
			return;
		}

		const template = html`
			<div class="settings-view-root">
				<div class="settings-view-header">
					<div class="settings-view-title-wrap">
						<div class="settings-view-title">Settings</div>
						<div class="settings-view-meta">Desktop configuration and runtime preferences.</div>
					</div>
					<div class="settings-view-header-actions">
						<button class="settings-back-btn" @click=${() => this.close()}>← Back</button>
					</div>
				</div>

				<div class="settings-view-body">
					<div class="settings-view-grid">
						<section class="settings-group settings-group-full">
							<div class="settings-section">
								<div class="settings-section-title">Appearance</div>
								<div class="appearance-theme-block">
									<div class="appearance-theme-header-row">
										<div>
											<div class="settings-label">Theme</div>
											<div class="settings-desc">Use light, dark, or match your system.</div>
										</div>
										<div class="theme-grid">
											<button class="theme-btn ${this.state.theme === "light" ? "active" : ""}" @click=${() => this.setTheme("light")}>Light</button>
											<button class="theme-btn ${this.state.theme === "dark" ? "active" : ""}" @click=${() => this.setTheme("dark")}>Dark</button>
											<button class="theme-btn ${this.state.theme === "system" ? "active" : ""}" @click=${() => this.setTheme("system")}>System</button>
										</div>
									</div>
									${this.themeCatalogLoading ? html`<div class="settings-desc">Loading available Pi themes…</div>` : nothing}
									${this.themeCatalogError ? html`<div class="settings-desc">Theme catalog error: ${this.themeCatalogError}</div>` : nothing}
									${this.themeCatalogMessage ? html`<div class="settings-desc">${this.themeCatalogMessage}</div>` : nothing}
									${this.renderThemeProfileCard("light")}
									${this.renderThemeProfileCard("dark")}
								</div>
							</div>
						</section>

						<section class="settings-group">
							<div class="settings-section">
								<div class="settings-section-title">Assistant</div>
								${this.renderToggle(
									"Auto-compaction",
									"Summarize older context automatically when conversations get long.",
									this.state.autoCompactionEnabled,
									(v) => this.setAutoCompaction(v),
								)}
								${this.renderToggle(
									"Auto-retry",
									"Retry temporary provider errors automatically.",
									this.state.autoRetryEnabled,
									(v) => this.setAutoRetry(v),
								)}
							</div>
							<div class="settings-section">
								<div class="settings-section-title">Message queue</div>
								<div class="settings-row">
									<div>
										<div class="settings-label">Steering messages</div>
										<div class="settings-desc">How queued steering messages are sent while a response is streaming.</div>
									</div>
									<select class="settings-select" .value=${this.state.steeringMode} @change=${(e: Event) => this.setSteeringMode((e.target as HTMLSelectElement).value as QueueMode)}>
										<option value="one-at-a-time">One at a time</option>
										<option value="all">All queued</option>
									</select>
								</div>
								<div class="settings-row">
									<div>
										<div class="settings-label">Follow-up messages</div>
										<div class="settings-desc">How queued follow-up prompts are sent after each run.</div>
									</div>
									<select class="settings-select" .value=${this.state.followUpMode} @change=${(e: Event) => this.setFollowUpMode((e.target as HTMLSelectElement).value as QueueMode)}>
										<option value="one-at-a-time">One at a time</option>
										<option value="all">All queued</option>
									</select>
								</div>
							</div>
						</section>

						<section class="settings-group">
							<div class="settings-section">
								<div class="settings-section-title">Account</div>
								${this.authLoading
									? html`<div class="settings-desc">Checking account status…</div>`
									: html`
										<div class="settings-desc">
											${this.authStatus && this.authStatus.configured_providers.length > 0
												? `Connected providers: ${this.authStatus.configured_providers.length}`
												: "No provider connected yet."}
										</div>
										<div class="settings-actions">
											<button class="ghost-btn" @click=${() => this.refreshAuthStatus()}>Refresh account status</button>
										</div>
										${this.authStatus && this.authStatus.configured_providers.length > 0
											? html`
												<div class="account-chips">
													${this.authStatus.configured_providers.map(
														(p) => html`<span class="account-chip">${p.provider} · ${p.source === "environment" ? "env" : p.kind}</span>`,
													)}
												</div>
											`
											: null}
										<div class="settings-desc">Tip: run <code>/login</code> in terminal once, then restart desktop.</div>
										${this.authStatus?.auth_file
											? html`
												<details class="settings-advanced">
													<summary>Advanced account details</summary>
													<div class="settings-desc">Auth file: <code>${this.authStatus.auth_file}</code></div>
												</details>
											`
											: null}
									`}
							</div>
							<div class="settings-section">
								<div class="settings-section-title">Package configuration</div>
								<div class="settings-desc">Package-specific settings are managed in <strong>Packages</strong> (gear icon on installed packages).</div>
								<div class="settings-desc">Desktop stays capability-driven: packages can expose config commands, and those run via the normal chat/runtime flow.</div>
							</div>
						</section>

						<section class="settings-group settings-group-full">
							<div class="settings-section">
								<div class="settings-section-title">Desktop updates</div>
								${this.desktopLoading
									? html`<div class="settings-desc">Checking desktop release…</div>`
									: html`
										<div class="settings-desc">Current: <code>${this.desktopStatus?.currentVersion || "unknown"}</code> · Latest: <code>${this.desktopStatus?.latestVersion || "unknown"}</code></div>
										${this.desktopStatus
											? this.desktopStatus.updateAvailable
												? html`<div class="settings-desc">A newer Pi Desktop release is available.</div>`
												: html`<div class="settings-desc">No desktop update available right now.</div>`
											: html`<div class="settings-desc">Desktop update status unavailable. Check your network and try again.</div>`}
										${this.desktopStatus?.assetName ? html`<div class="settings-desc">Recommended installer: <code>${this.desktopStatus.assetName}</code></div>` : null}
										${this.desktopStatus?.note ? html`<div class="settings-desc">${this.desktopStatus.note}</div>` : null}
									`}
								<div class="settings-actions">
									<button class="ghost-btn" ?disabled=${this.desktopLoading} @click=${() => this.refreshDesktopStatus()}>Refresh desktop status</button>
									<button class="ghost-btn" ?disabled=${this.desktopOpening || !this.desktopStatus?.updateAvailable} @click=${() => this.openDesktopUpdateNow()}>
										${this.desktopOpening ? "Opening…" : this.desktopStatus?.assetUrl ? "Download desktop update" : "Open release page"}
									</button>
								</div>
								${this.desktopActionMessage ? html`<div class="settings-desc">${this.desktopActionMessage}</div>` : null}
							</div>

							<div class="settings-section">
								<div class="settings-section-title">CLI updates</div>
								${this.cliLoading
									? html`<div class="settings-desc">Checking CLI version…</div>`
									: html`
										<div class="settings-desc">Current: <code>${this.cliStatus?.current_version || "unknown"}</code> · Latest: <code>${this.cliStatus?.latest_version || "unknown"}</code></div>
										${this.cliStatus
											? this.cliStatus.update_available
												? html`<div class="settings-desc">A newer Pi CLI is available.</div>`
												: html`<div class="settings-desc">No update available right now.</div>`
											: html`<div class="settings-desc">CLI status unavailable. Install or reconnect CLI, then refresh.</div>`}
										${this.cliStatus?.note ? html`<div class="settings-desc">${this.cliStatus.note}</div>` : null}
									`}
								<div class="settings-actions">
									<button class="ghost-btn" ?disabled=${this.cliLoading} @click=${() => this.refreshCliStatus()}>Refresh CLI status</button>
									<button
										class="ghost-btn"
										?disabled=${
											this.cliUpdating ||
											!this.cliStatus?.can_update_in_app ||
											!this.cliStatus?.npm_available ||
											!this.cliStatus?.update_available
										}
										@click=${() => this.updateCliNow()}
									>
										${this.cliUpdating ? "Updating…" : "Update CLI now"}
									</button>
								</div>
								${this.cliActionMessage ? html`<div class="settings-desc">${this.cliActionMessage}</div>` : null}
								<details class="settings-advanced">
									<summary>Advanced CLI diagnostics</summary>
									<div class="settings-desc">Discovery: <code>${this.cliStatus?.discovery || rpcBridge.discoveryInfo || "unknown"}</code></div>
									${this.cliStatus?.update_command ? html`<div class="settings-desc">Manual update: <code>${this.cliStatus.update_command}</code></div>` : null}
									<div class="settings-actions">
										<button class="ghost-btn" ?disabled=${this.compatibilityLoading} @click=${() => this.refreshCompatibilityStatus()}>
											${this.compatibilityLoading ? "Checking RPC…" : "Run RPC compatibility check"}
										</button>
									</div>
									${this.compatibilityReport
										? html`
											<div class="settings-desc">
												RPC compatibility: ${this.compatibilityReport.ok ? "OK" : "Failed"}
												${this.compatibilityReport.checks.length > 0 ? html` (${this.compatibilityReport.checks.join(", ")})` : null}
											</div>
											${this.compatibilityReport.error ? html`<div class="settings-desc">${this.compatibilityReport.error}</div>` : null}
										`
										: null}
								</details>
							</div>
						</section>
					</div>
				</div>
				${this.renderCreateThemeDialog()}
			</div>
		`;

		render(template, this.container);
	}

	destroy(): void {
		this.container.innerHTML = "";
	}
}
