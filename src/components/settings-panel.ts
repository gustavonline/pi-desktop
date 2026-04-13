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
	piBinaryPath: string;
}

interface ScopedModelOption {
	fullId: string;
	provider: string;
	id: string;
	name: string;
}

export type SettingsSectionId = "general" | "appearance" | "account" | "updates";

export interface SettingsSectionNavItem {
	id: SettingsSectionId;
	label: string;
	description: string;
	runtimeRequired?: boolean;
}

export interface SettingsSectionNavState extends SettingsSectionNavItem {
	disabled: boolean;
}

export interface SettingsNavigationState {
	activeSection: SettingsSectionId;
	items: SettingsSectionNavState[];
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
		piBinaryPath: "",
	};
	private onClose: (() => void) | null = null;
	private onRequestAddProject: (() => void) | null = null;
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
	private piPathActionMessage = "";
	private onCliStatusChange: ((status: CliUpdateStatus | null) => void) | null = null;
	private onPiBinaryPathChange: ((path: string | null) => void) | null = null;
	private onNavigationStateChange: ((state: SettingsNavigationState) => void) | null = null;
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
	private runtimeProjectPath: string | null = null;
	private colorDrafts: Record<ThemeVariant, ThemeColorDraft> = {
		light: { accent: "", background: "", foreground: "" },
		dark: { accent: "", background: "", foreground: "" },
	};
	private scopedModelsLoading = false;
	private scopedModelsSaving = false;
	private scopedModelsError = "";
	private scopedModelsMessage = "";
	private scopedModelsSearch = "";
	private scopedModels: ScopedModelOption[] = [];
	private scopedModelsHasFilter = false;
	private scopedModelsEnabledIds: string[] = [];
	private scopedModelsSavedSnapshot = "";
	private scopedModelsSettingsPath: string | null = null;
	private scopedModelsUnknownPatterns: string[] = [];
	private activeSection: SettingsSectionId = "general";

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

	setOnRequestAddProject(callback: () => void): void {
		this.onRequestAddProject = callback;
	}

	setOnDesktopStatusChange(callback: (status: DesktopUpdateStatus | null) => void): void {
		this.onDesktopStatusChange = callback;
	}

	setOnCliStatusChange(callback: (status: CliUpdateStatus | null) => void): void {
		this.onCliStatusChange = callback;
	}

	setOnPiBinaryPathChange(callback: ((path: string | null) => void) | null): void {
		this.onPiBinaryPathChange = callback;
	}

	setOnNavigationStateChange(callback: ((state: SettingsNavigationState) => void) | null): void {
		this.onNavigationStateChange = callback;
		if (callback) callback(this.getNavigationState());
	}

	getActiveSection(): SettingsSectionId {
		return this.getNavigationState().activeSection;
	}

	setActiveSection(section: SettingsSectionId): void {
		const navItems = this.getSettingsNavItems();
		const target = navItems.find((item) => item.id === section);
		if (!target) return;
		const runtimeControlsEnabled = this.isRuntimeControlsEnabled();
		if (target.runtimeRequired && !runtimeControlsEnabled) return;
		if (this.activeSection === section) return;
		this.activeSection = section;
		this.emitNavigationState(runtimeControlsEnabled);
		if (this.isOpen) this.render();
	}

	getNavigationState(): SettingsNavigationState {
		const runtimeControlsEnabled = this.isRuntimeControlsEnabled();
		const activeSection = this.normalizeActiveSection(runtimeControlsEnabled);
		const items = this.getSettingsNavItems().map((item) => ({
			...item,
			disabled: Boolean(item.runtimeRequired && !runtimeControlsEnabled),
		}));
		return { activeSection, items };
	}

	setRuntimeProjectPath(projectPath: string | null): void {
		this.runtimeProjectPath = typeof projectPath === "string" && projectPath.trim().length > 0 ? projectPath : null;
		this.emitNavigationState();
	}

	private isRuntimeControlsEnabled(): boolean {
		return Boolean(this.runtimeProjectPath) && rpcBridge.isConnected;
	}

	private normalizeActiveSection(runtimeControlsEnabled = this.isRuntimeControlsEnabled()): SettingsSectionId {
		const navItems = this.getSettingsNavItems();
		const requested = navItems.find((item) => item.id === this.activeSection) ?? navItems[0];
		if (requested?.runtimeRequired && !runtimeControlsEnabled) {
			this.activeSection = "appearance";
		}
		return (this.activeSection ?? "appearance") as SettingsSectionId;
	}

	private emitNavigationState(runtimeControlsEnabled = this.isRuntimeControlsEnabled()): void {
		if (!this.onNavigationStateChange) return;
		this.onNavigationStateChange({
			activeSection: this.normalizeActiveSection(runtimeControlsEnabled),
			items: this.getSettingsNavItems().map((item) => ({
				...item,
				disabled: Boolean(item.runtimeRequired && !runtimeControlsEnabled),
			})),
		});
	}

	isVisible(): boolean {
		return this.isOpen;
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.emitNavigationState();
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
		this.emitNavigationState();
	}

	close(notify = true): void {
		this.resetColorDrafts();
		this.createThemeDialogOpen = false;
		this.createThemeDialogSaving = false;
		this.createThemeDialogError = "";
		this.applyAppearanceProfileForCurrentResolvedTheme();
		this.isOpen = false;
		this.render();
		this.emitNavigationState();
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
		const candidate = theme === "light" ? this.appearanceProfiles?.light : this.appearanceProfiles?.dark;
		if (candidate && typeof candidate === "object") {
			return candidate;
		}
		this.appearanceProfiles = loadDesktopAppearanceProfiles();
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

	private lookupThemeOption(themeName: unknown): ThemeOption | null {
		if (typeof themeName !== "string") return null;
		const normalized = themeName.trim().toLowerCase();
		if (!normalized) return null;
		if (!Array.isArray(this.availableThemes)) return null;
		return this.availableThemes.find((entry) => {
			const id = typeof entry?.id === "string" ? entry.id.toLowerCase() : "";
			const label = typeof entry?.label === "string" ? entry.label.toLowerCase() : "";
			return id === normalized || label === normalized;
		}) ?? null;
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

	private normalizeHex6(value: unknown): string | null {
		if (typeof value !== "string") return null;
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

	private coercePickerColor(value: unknown): string {
		return this.normalizeHex6(value) ?? "#7A818F";
	}

	private setProfileColor(theme: ThemeVariant, key: "accent" | "background" | "foreground", value: unknown): void {
		const normalized = this.normalizeHex6(value);
		if (!normalized) return;
		this.colorDrafts[theme][key] = normalized;
		if (theme === this.getCurrentResolvedTheme()) {
			this.applyAppearanceProfileForCurrentResolvedTheme(false);
		}
		this.render();
	}

	private setProfileFont(theme: ThemeVariant, key: "uiFont" | "codeFont", value: unknown): void {
		if (typeof value !== "string") return;
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

	private normalizePiBinaryPath(value: string | null | undefined): string | null {
		const normalized = typeof value === "string" ? value.trim() : "";
		return normalized.length > 0 ? normalized : null;
	}

	private setPiBinaryPathDraft(value: string): void {
		this.state.piBinaryPath = value;
		this.piPathActionMessage = "";
		this.render();
	}

	private async choosePiBinaryPathFromDialog(): Promise<void> {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				multiple: false,
				directory: false,
				title: "Select pi binary",
			});
			if (typeof selected !== "string" || selected.trim().length === 0) return;
			this.state.piBinaryPath = selected;
			this.piPathActionMessage = "";
			this.render();
		} catch (err) {
			this.piPathActionMessage = err instanceof Error ? err.message : "Could not open file picker.";
			this.render();
		}
	}

	private async savePiBinaryPathOverride(): Promise<void> {
		const normalized = this.normalizePiBinaryPath(this.state.piBinaryPath);
		this.state.piBinaryPath = normalized ?? "";
		try {
			await this.saveSettings();
			this.onPiBinaryPathChange?.(normalized);
			this.piPathActionMessage = normalized
				? "Saved CLI binary override. Use /reload to reconnect active runtimes."
				: "Cleared CLI binary override.";
			await this.refreshCliStatus();
			if (this.isRuntimeControlsEnabled()) {
				await this.refreshCompatibilityStatus();
			}
		} catch (err) {
			this.piPathActionMessage = err instanceof Error ? err.message : "Failed to save CLI binary override.";
		}
		this.render();
	}

	private async clearPiBinaryPathOverride(): Promise<void> {
		this.state.piBinaryPath = "";
		await this.savePiBinaryPathOverride();
	}

	private async loadState(): Promise<void> {
		const runtimeReady = Boolean(this.runtimeProjectPath) && rpcBridge.isConnected;
		if (runtimeReady) {
			try {
				const sessionState = await rpcBridge.getState();
				this.state.autoCompactionEnabled = Boolean(sessionState.autoCompactionEnabled);
				this.state.steeringMode = sessionState.steeringMode === "all" ? "all" : "one-at-a-time";
				this.state.followUpMode = sessionState.followUpMode === "all" ? "all" : "one-at-a-time";
			} catch {
				// ignore
			}
		} else {
			this.authStatus = null;
			this.compatibilityReport = null;
			this.authLoading = false;
			this.compatibilityLoading = false;
			this.scopedModelsLoading = false;
			this.scopedModelsSaving = false;
			this.scopedModelsError = "";
			this.scopedModelsMessage = "";
			this.scopedModelsSearch = "";
			this.scopedModels = [];
			this.scopedModelsHasFilter = false;
			this.scopedModelsEnabledIds = [];
			this.scopedModelsSavedSnapshot = "";
			this.scopedModelsSettingsPath = null;
			this.scopedModelsUnknownPatterns = [];
		}

		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const saved = (await invoke("load_settings")) as {
				theme?: string;
				auto_retry?: boolean;
				pi_path?: string | null;
			};
			if (saved.theme === "dark" || saved.theme === "light" || saved.theme === "system") {
				this.state.theme = saved.theme;
				this.applyTheme(saved.theme);
			}
			if (typeof saved.auto_retry === "boolean") {
				this.state.autoRetryEnabled = saved.auto_retry;
			}
			const normalizedPiPath = this.normalizePiBinaryPath(saved.pi_path);
			this.state.piBinaryPath = normalizedPiPath ?? "";
			this.onPiBinaryPathChange?.(normalizedPiPath);
		} catch {
			// ignore missing persisted settings
		}

		const refreshTasks: Promise<void>[] = [
			this.refreshDesktopStatus(),
			this.refreshCliStatus(),
			this.refreshThemeCatalog(),
		];
		if (runtimeReady) {
			refreshTasks.push(
				this.refreshAccountStatus(),
				this.refreshCompatibilityStatus(),
				this.refreshScopedModels(),
			);
		}

		await Promise.all(refreshTasks);
		this.applyAppearanceProfileForCurrentResolvedTheme(false);
	}

	private async refreshAuthStatus(): Promise<void> {
		this.authLoading = true;
		this.render();
		try {
			const raw = await rpcBridge.getPiAuthStatus();
			const providers = Array.isArray(raw?.configured_providers)
				? raw.configured_providers
					.filter((entry) => entry && typeof entry === "object")
					.map((entry) => {
						const provider = typeof entry.provider === "string" && entry.provider.trim().length > 0 ? entry.provider.trim() : "unknown";
						const source = entry.source === "environment" || entry.source === "auth_file_api_key" || entry.source === "auth_file_oauth"
							? entry.source
							: "environment";
						const kind = entry.kind === "api_key" || entry.kind === "oauth" || entry.kind === "unknown"
							? entry.kind
							: "unknown";
						return { provider, source, kind };
					})
				: [];
			this.authStatus = {
				agent_dir: typeof raw?.agent_dir === "string" ? raw.agent_dir : null,
				auth_file: typeof raw?.auth_file === "string" ? raw.auth_file : null,
				auth_file_exists: Boolean(raw?.auth_file_exists),
				configured_providers: providers,
			};
		} catch {
			this.authStatus = null;
		} finally {
			this.authLoading = false;
			this.render();
		}
	}

	private async refreshAccountStatus(): Promise<void> {
		await this.refreshAuthStatus();
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
			const raw = await rpcBridge.checkRpcCompatibility();
			this.compatibilityReport = {
				ok: Boolean(raw?.ok),
				checks: Array.isArray(raw?.checks) ? raw.checks.filter((entry) => typeof entry === "string") : [],
				error: typeof raw?.error === "string" && raw.error.trim().length > 0 ? raw.error : undefined,
				checkedAt: typeof raw?.checkedAt === "number" && Number.isFinite(raw.checkedAt) ? raw.checkedAt : Date.now(),
			};
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

	private readStringPath(source: Record<string, unknown>, path: string): string | null {
		const parts = path.split(".");
		let current: unknown = source;
		for (const part of parts) {
			if (!current || typeof current !== "object") return null;
			current = (current as Record<string, unknown>)[part];
		}
		if (typeof current !== "string") return null;
		const value = current.trim();
		return value.length > 0 ? value : null;
	}

	private pickStringPath(source: Record<string, unknown>, paths: string[]): string | null {
		for (const path of paths) {
			const value = this.readStringPath(source, path);
			if (value !== null) return value;
		}
		return null;
	}

	private parseScopedModelOptions(rawModels: Array<Record<string, unknown>>): ScopedModelOption[] {
		const byId = new Map<string, ScopedModelOption>();
		for (const raw of rawModels) {
			const provider = this.pickStringPath(raw, ["provider", "target.provider", "model.provider"]);
			const id = this.pickStringPath(raw, ["id", "modelId", "model_id", "model", "target.id", "target.modelId"]);
			if (!provider || !id) continue;
			const fullId = `${provider}/${id}`;
			const key = fullId.toLowerCase();
			if (byId.has(key)) continue;
			const name = this.pickStringPath(raw, ["name", "label", "target.name"]) ?? id;
			byId.set(key, {
				fullId,
				provider,
				id,
				name,
			});
		}
		return [...byId.values()].sort((a, b) => {
			const providerCmp = a.provider.localeCompare(b.provider);
			if (providerCmp !== 0) return providerCmp;
			return a.id.localeCompare(b.id);
		});
	}

	private async resolvePiSettingsPath(): Promise<string> {
		let agentDir = "";
		try {
			const status = await rpcBridge.getPiAuthStatus();
			agentDir = typeof status.agent_dir === "string" ? status.agent_dir.trim() : "";
		} catch {
			// ignore and fallback to default path
		}
		if (!agentDir) {
			const { homeDir } = await import("@tauri-apps/api/path");
			const home = (await homeDir()).replace(/\\/g, "/").replace(/\/+$/, "");
			agentDir = this.joinFsPath(this.joinFsPath(home, ".pi"), "agent");
		}
		return this.joinFsPath(agentDir, "settings.json");
	}

	private async readPiGlobalSettingsDoc(): Promise<{ path: string; doc: Record<string, unknown> }> {
		const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
		const path = await this.resolvePiSettingsPath();
		this.scopedModelsSettingsPath = path;
		if (!(await exists(path))) {
			return { path, doc: {} };
		}
		const content = await readTextFile(path);
		if (!content.trim()) return { path, doc: {} };
		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`Failed to parse ${path}: ${message}`);
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(`Expected object in ${path}, but found ${Array.isArray(parsed) ? "array" : typeof parsed}`);
		}
		return { path, doc: parsed as Record<string, unknown> };
	}

	private patternToRegex(pattern: string): RegExp | null {
		const trimmed = pattern.trim();
		if (!trimmed) return null;
		const escaped = trimmed.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
		try {
			return new RegExp(`^${escaped}$`, "i");
		} catch {
			return null;
		}
	}

	private resolveScopedModelIdsFromPatterns(
		patterns: string[] | undefined,
		models: ScopedModelOption[],
	): { hasFilter: boolean; enabledIds: string[]; unknownPatterns: string[] } {
		const allIds = models.map((model) => model.fullId);
		if (!patterns || patterns.length === 0) {
			return { hasFilter: false, enabledIds: [...allIds], unknownPatterns: [] };
		}

		const idByLower = new Map(allIds.map((id) => [id.toLowerCase(), id]));
		const enabledIds: string[] = [];
		const seen = new Set<string>();
		const unknownPatterns: string[] = [];

		for (const rawPattern of patterns) {
			const pattern = rawPattern.trim();
			if (!pattern) continue;
			const hasWildcard = pattern.includes("*");
			if (!hasWildcard) {
				const exact = idByLower.get(pattern.toLowerCase());
				if (!exact) {
					unknownPatterns.push(pattern);
					continue;
				}
				if (!seen.has(exact)) {
					seen.add(exact);
					enabledIds.push(exact);
				}
				continue;
			}
			const regex = this.patternToRegex(pattern);
			if (!regex) {
				unknownPatterns.push(pattern);
				continue;
			}
			let matched = false;
			for (const id of allIds) {
				if (!regex.test(id)) continue;
				matched = true;
				if (!seen.has(id)) {
					seen.add(id);
					enabledIds.push(id);
				}
			}
			if (!matched) unknownPatterns.push(pattern);
		}

		if (enabledIds.length >= allIds.length) {
			return { hasFilter: false, enabledIds: [...allIds], unknownPatterns };
		}
		return { hasFilter: true, enabledIds, unknownPatterns };
	}

	private setScopedModelsSelection(hasFilter: boolean, enabledIds: string[]): void {
		const allIds = this.scopedModels.map((model) => model.fullId);
		const allowed = new Set(allIds);
		const deduped: string[] = [];
		for (const id of enabledIds) {
			if (!allowed.has(id)) continue;
			if (deduped.includes(id)) continue;
			deduped.push(id);
		}

		if (!hasFilter || deduped.length >= allIds.length) {
			this.scopedModelsHasFilter = false;
			this.scopedModelsEnabledIds = [...allIds];
			return;
		}

		this.scopedModelsHasFilter = true;
		this.scopedModelsEnabledIds = deduped;
	}

	private scopedModelsSnapshot(): string {
		if (!this.scopedModelsHasFilter) return "all:*";
		return `filtered:${this.scopedModelsEnabledIds.join("|")}`;
	}

	private scopedModelsDirty(): boolean {
		return this.scopedModelsSnapshot() !== this.scopedModelsSavedSnapshot;
	}

	private isScopedModelEnabled(fullId: string): boolean {
		return !this.scopedModelsHasFilter || this.scopedModelsEnabledIds.includes(fullId);
	}

	private allScopedModelIds(): string[] {
		return this.scopedModels.map((model) => model.fullId);
	}

	private toggleScopedModel(fullId: string): void {
		const allIds = this.allScopedModelIds();
		if (allIds.length === 0) return;
		const currentlyEnabled = this.isScopedModelEnabled(fullId);
		if (!this.scopedModelsHasFilter) {
			if (!currentlyEnabled) return;
			const nextEnabled = allIds.filter((id) => id !== fullId);
			this.setScopedModelsSelection(true, nextEnabled);
		} else if (currentlyEnabled) {
			this.setScopedModelsSelection(
				true,
				this.scopedModelsEnabledIds.filter((id) => id !== fullId),
			);
		} else {
			this.setScopedModelsSelection(true, [...this.scopedModelsEnabledIds, fullId]);
		}
		this.scopedModelsError = "";
		this.scopedModelsMessage = "";
		this.render();
	}

	private enableAllScopedModels(): void {
		this.setScopedModelsSelection(false, this.allScopedModelIds());
		this.scopedModelsError = "";
		this.scopedModelsMessage = "";
		this.render();
	}

	private clearAllScopedModels(): void {
		this.setScopedModelsSelection(true, []);
		this.scopedModelsError = "";
		this.scopedModelsMessage = "";
		this.render();
	}

	private toggleScopedProvider(provider: string): void {
		const providerIds = this.scopedModels
			.filter((model) => model.provider === provider)
			.map((model) => model.fullId);
		if (providerIds.length === 0) return;
		const allIds = this.allScopedModelIds();
		const providerFullyEnabled = providerIds.every((id) => this.isScopedModelEnabled(id));
		if (!this.scopedModelsHasFilter) {
			if (providerFullyEnabled) {
				const nextEnabled = allIds.filter((id) => !providerIds.includes(id));
				this.setScopedModelsSelection(true, nextEnabled);
			}
		} else if (providerFullyEnabled) {
			this.setScopedModelsSelection(
				true,
				this.scopedModelsEnabledIds.filter((id) => !providerIds.includes(id)),
			);
		} else {
			const next = [...this.scopedModelsEnabledIds];
			for (const id of providerIds) {
				if (!next.includes(id)) next.push(id);
			}
			this.setScopedModelsSelection(true, next);
		}
		this.scopedModelsError = "";
		this.scopedModelsMessage = "";
		this.render();
	}

	private async refreshScopedModels(): Promise<void> {
		this.scopedModelsLoading = true;
		this.scopedModelsError = "";
		this.scopedModelsMessage = "";
		this.scopedModelsUnknownPatterns = [];
		this.render();
		try {
			const raw = await rpcBridge.getAvailableModels();
			const modelRecords = Array.isArray(raw)
				? raw.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
				: [];
			this.scopedModels = this.parseScopedModelOptions(modelRecords);

			const { path, doc } = await this.readPiGlobalSettingsDoc();
			this.scopedModelsSettingsPath = path;
			const patterns = Array.isArray(doc.enabledModels)
				? doc.enabledModels
					.filter((value): value is string => typeof value === "string")
					.map((value) => value.trim())
					.filter(Boolean)
				: undefined;
			const resolved = this.resolveScopedModelIdsFromPatterns(patterns, this.scopedModels);
			this.scopedModelsUnknownPatterns = resolved.unknownPatterns;
			this.setScopedModelsSelection(resolved.hasFilter, resolved.enabledIds);
			this.scopedModelsSavedSnapshot = this.scopedModelsSnapshot();
			if (resolved.unknownPatterns.length > 0) {
				this.scopedModelsMessage = "Some saved model patterns are not currently available and were skipped in this view.";
			}
		} catch (err) {
			this.scopedModels = [];
			this.scopedModelsHasFilter = false;
			this.scopedModelsEnabledIds = [];
			this.scopedModelsSavedSnapshot = "";
			this.scopedModelsError = err instanceof Error ? err.message : String(err);
		} finally {
			this.scopedModelsLoading = false;
			this.render();
		}
	}

	private async saveScopedModels(): Promise<void> {
		if (this.scopedModelsSaving) return;
		this.scopedModelsSaving = true;
		this.scopedModelsError = "";
		this.scopedModelsMessage = "Saving scoped models…";
		this.render();
		try {
			const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
			const { path, doc } = await this.readPiGlobalSettingsDoc();
			const nextDoc: Record<string, unknown> = { ...doc };
			const allIds = this.allScopedModelIds();
			const enabledIds = this.scopedModelsHasFilter ? this.scopedModelsEnabledIds : allIds;
			const deduped = enabledIds.filter((id, index) => enabledIds.indexOf(id) === index && allIds.includes(id));
			const shouldClearFilter = !this.scopedModelsHasFilter || deduped.length >= allIds.length;
			if (shouldClearFilter) {
				delete nextDoc.enabledModels;
				this.setScopedModelsSelection(false, allIds);
			} else {
				nextDoc.enabledModels = deduped;
				this.setScopedModelsSelection(true, deduped);
			}

			const dir = path.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
			if (dir) {
				await mkdir(dir, { recursive: true });
			}
			await writeTextFile(path, `${JSON.stringify(nextDoc, null, 2)}\n`);
			this.scopedModelsSettingsPath = path;
			this.scopedModelsSavedSnapshot = this.scopedModelsSnapshot();
			this.scopedModelsMessage = "Scoped models saved. Run /reload to apply this scope to the current runtime.";
		} catch (err) {
			this.scopedModelsError = err instanceof Error ? err.message : String(err);
			this.scopedModelsMessage = "";
		} finally {
			this.scopedModelsSaving = false;
			this.render();
		}
	}

	private renderScopedModelsSection(): TemplateResult {
		const totalModels = this.scopedModels.length;
		const enabledCount = this.scopedModelsHasFilter ? this.scopedModelsEnabledIds.length : totalModels;
		const query = this.scopedModelsSearch.trim().toLowerCase();
		const visibleModels = query
			? this.scopedModels.filter((model) => `${model.id} ${model.provider} ${model.name}`.toLowerCase().includes(query))
			: this.scopedModels;
		const grouped = new Map<string, ScopedModelOption[]>();
		for (const model of visibleModels) {
			const bucket = grouped.get(model.provider) ?? [];
			bucket.push(model);
			grouped.set(model.provider, bucket);
		}
		const providers = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
		const dirty = this.scopedModelsDirty();

		return html`
			<div class="settings-section">
				<div class="settings-section-title">Scoped models</div>
				<div class="settings-desc">Choose which models are included when cycling models with Ctrl+P. This matches CLI <code>/scoped-models</code> behavior.</div>
				<div class="settings-row scoped-models-toolbar-row">
					<div class="scoped-models-summary">Enabled: <strong>${enabledCount}</strong> / ${totalModels || "0"}${dirty ? html` <span class="scoped-models-unsaved">(unsaved)</span>` : nothing}</div>
					<input
						class="appearance-font-input scoped-models-search"
						type="text"
						placeholder="Search models"
						.value=${this.scopedModelsSearch}
						@input=${(e: Event) => {
							this.scopedModelsSearch = (e.target as HTMLInputElement).value;
							this.render();
						}}
					/>
				</div>
				<div class="settings-actions scoped-models-actions">
					<button class="ghost-btn" ?disabled=${this.scopedModelsLoading || totalModels === 0} @click=${() => this.enableAllScopedModels()}>Enable all</button>
					<button class="ghost-btn" ?disabled=${this.scopedModelsLoading || totalModels === 0} @click=${() => this.clearAllScopedModels()}>Clear all</button>
					<button class="ghost-btn" ?disabled=${this.scopedModelsLoading || !dirty || this.scopedModelsSaving} @click=${() => this.saveScopedModels()}>
						${this.scopedModelsSaving ? "Saving…" : "Save scoped models"}
					</button>
					<button class="ghost-btn" ?disabled=${this.scopedModelsLoading} @click=${() => this.refreshScopedModels()}>Refresh</button>
				</div>
				${this.scopedModelsLoading ? html`<div class="settings-desc">Loading available models…</div>` : nothing}
				${this.scopedModelsError ? html`<div class="settings-desc scoped-models-error">${this.scopedModelsError}</div>` : nothing}
				${this.scopedModelsUnknownPatterns.length > 0
					? html`<div class="settings-desc">Unresolved saved patterns: <code>${this.scopedModelsUnknownPatterns.join(", ")}</code></div>`
					: nothing}
				${this.scopedModelsMessage ? html`<div class="settings-desc">${this.scopedModelsMessage}</div>` : nothing}
				${this.scopedModelsSettingsPath ? html`<div class="settings-desc">Settings file: <code>${this.scopedModelsSettingsPath}</code></div>` : nothing}
				${!this.scopedModelsLoading && !this.scopedModelsError
					? providers.length === 0
						? html`<div class="settings-desc">No models available for scoped configuration.</div>`
						: html`
							<div class="scoped-models-list">
								${providers.map(([provider, models]) => {
									const providerEnabledCount = models.filter((model) => this.isScopedModelEnabled(model.fullId)).length;
									const providerAllEnabled = providerEnabledCount === models.length;
									return html`
										<div class="scoped-models-provider-header">
											<div class="scoped-models-provider-meta">
												<span class="settings-label">${provider}</span>
												<span class="settings-desc">${providerEnabledCount}/${models.length} enabled</span>
											</div>
											<button class="ghost-btn" @click=${() => this.toggleScopedProvider(provider)}>${providerAllEnabled ? "Disable provider" : "Enable provider"}</button>
										</div>
										${models.map((model) => {
											const enabled = this.isScopedModelEnabled(model.fullId);
											return html`
												<div class="settings-row scoped-model-row">
													<div class="scoped-model-row-main">
														<div class="settings-label">${model.id}</div>
														<div class="settings-desc">${model.provider}${model.name && model.name !== model.id ? ` · ${model.name}` : ""}</div>
													</div>
													<button class="toggle ${enabled ? "on" : "off"}" @click=${() => this.toggleScopedModel(model.fullId)}><span></span></button>
												</div>
											`;
										})}
									`;
								})}
							</div>
						`
					: nothing}
			</div>
		`;
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
					pi_path: this.normalizePiBinaryPath(this.state.piBinaryPath),
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

	private renderBasicSettingsShell(runtimeMessage: string, options: { showAddProject: boolean; warning?: string } = { showAddProject: false }): void {
		const { showAddProject, warning } = options;
		render(
			html`
				<div class="settings-view-root">
					<div class="settings-view-header">
						<div class="settings-view-title-wrap">
							<div class="settings-view-title">Appearance</div>
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
									<div class="settings-label">Theme</div>
									<div class="settings-desc">Choose light, dark, or system mode.</div>
									<div class="theme-grid" style="margin-top:10px;">
										<button class="theme-btn ${this.state.theme === "light" ? "active" : ""}" @click=${() => this.setTheme("light")}>Light</button>
										<button class="theme-btn ${this.state.theme === "dark" ? "active" : ""}" @click=${() => this.setTheme("dark")}>Dark</button>
										<button class="theme-btn ${this.state.theme === "system" ? "active" : ""}" @click=${() => this.setTheme("system")}>System</button>
									</div>
								</div>
							</section>
							<section class="settings-group settings-group-full">
								<div class="settings-section">
									<div class="settings-section-title">Runtime</div>
									<div class="settings-desc">${runtimeMessage}</div>
									${warning ? html`<div class="settings-desc" style="margin-top:8px;">${warning}</div>` : nothing}
									${showAddProject
										? html`
											<div class="settings-actions" style="margin-top:10px;">
												<button class="ghost-btn" @click=${() => this.onRequestAddProject?.()}>Add project</button>
											</div>
										`
										: nothing}
								</div>
							</section>
						</div>
					</div>
				</div>
			`,
			this.container,
		);
	}

	private getSettingsNavItems(): SettingsSectionNavItem[] {
		return [
			{
				id: "general",
				label: "General",
				description: "Assistant behavior, model scope, and queue defaults.",
				runtimeRequired: true,
			},
			{
				id: "appearance",
				label: "Appearance",
				description: "Theme mode and desktop appearance profiles.",
			},
			{
				id: "account",
				label: "Account",
				description: "Provider auth status and package config notes.",
				runtimeRequired: true,
			},
			{
				id: "updates",
				label: "Updates",
				description: "Desktop releases, CLI version, and runtime diagnostics.",
			},
		];
	}

	private renderAppearanceSection(): TemplateResult {
		return html`
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
			</div>
		`;
	}

	private renderGeneralSection(runtimeControlsEnabled: boolean, hasProjectContext: boolean): TemplateResult {
		if (!runtimeControlsEnabled) {
			const runtimeMessage = hasProjectContext
				? "Runtime is still starting for this project. General controls unlock once runtime is ready."
				: "Open a project to configure assistant behavior and scoped models.";
			return html`
				<div class="settings-view-grid">
					<section class="settings-group settings-group-full">
						<div class="settings-section">
							<div class="settings-section-title">General</div>
							<div class="settings-desc">${runtimeMessage}</div>
							${!hasProjectContext
								? html`
									<div class="settings-actions" style="margin-top:10px;">
										<button class="ghost-btn" @click=${() => this.onRequestAddProject?.()}>Add project</button>
									</div>
								`
								: nothing}
						</div>
					</section>
				</div>
			`;
		}

		return html`
			<div class="settings-view-grid">
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
				</section>

				<section class="settings-group">
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

				<section class="settings-group settings-group-full">
					${this.renderScopedModelsSection()}
				</section>
			</div>
		`;
	}

	private renderAccountSection(
		runtimeControlsEnabled: boolean,
		hasProjectContext: boolean,
		authProviders: PiAuthStatus["configured_providers"],
	): TemplateResult {
		const runtimeMessage = hasProjectContext
			? "Runtime is still starting for this project. Account diagnostics unlock when runtime is ready."
			: "Open a project to inspect account diagnostics.";

		const uniqueAuthProviders = new Map<string, PiAuthStatus["configured_providers"][number]>();
		for (const entry of authProviders) {
			const key = (entry?.provider ?? "").trim().toLowerCase();
			if (!key) continue;
			const existing = uniqueAuthProviders.get(key);
			const score = entry.source === "environment" ? 2 : 1;
			const existingScore = existing ? (existing.source === "environment" ? 2 : 1) : -1;
			if (!existing || score >= existingScore) {
				uniqueAuthProviders.set(key, entry);
			}
		}
		const connectedProviders = Array.from(uniqueAuthProviders.values()).sort((a, b) => a.provider.localeCompare(b.provider));

		return html`
			<div class="settings-view-grid">
				<section class="settings-group">
					<div class="settings-section">
						<div class="settings-section-title">Account (work in progress)</div>
						<div class="settings-desc">This section is being redesigned for real account features instead of model/provider login controls.</div>
						<div class="settings-desc">Planned direction: GitHub/Google sign-in, profile/avatar in the app sidebar, and optional cloud sync for preferences.</div>
						<div class="settings-desc">Model/provider login/logout is handled from the model picker.</div>
						<div class="settings-desc">Package install + provider setup flows stay in <strong>Packages</strong>.</div>
					</div>
				</section>

				<section class="settings-group">
					<div class="settings-section">
						<div class="settings-section-title">Current account diagnostics</div>
						${!runtimeControlsEnabled
							? html`<div class="settings-desc">${runtimeMessage}</div>`
							: this.authLoading
								? html`<div class="settings-desc">Checking account diagnostics…</div>`
								: html`
									<div class="settings-desc">
										${connectedProviders.length > 0
											? `Connected providers detected: ${connectedProviders.length}`
											: "No provider credentials detected."}
									</div>
									<div class="settings-actions">
										<button class="ghost-btn" @click=${() => this.refreshAccountStatus()}>Refresh diagnostics</button>
									</div>
									${connectedProviders.length > 0
										? html`
											<div class="account-chips">
												${connectedProviders.map((provider) => html`<span class="account-chip">${provider.provider} · ${provider.source === "environment" ? "env" : provider.kind}</span>`) }
											</div>
										`
										: null}
									${this.authStatus?.auth_file
										? html`
											<details class="settings-advanced">
												<summary>Advanced details</summary>
												<div class="settings-desc">Auth file: <code>${this.authStatus.auth_file}</code></div>
											</details>
										`
										: null}
								`}
					</div>
				</section>
			</div>
		`;
	}

	private renderUpdatesSection(runtimeControlsEnabled: boolean, compatibilityChecks: string[]): TemplateResult {
		return html`
			<div class="settings-view-grid">
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
						<div class="settings-row settings-row-top">
							<div>
								<div class="settings-label">CLI binary path override (optional)</div>
								<div class="settings-desc">Set an absolute path to your <code>pi</code> binary if Desktop cannot discover it automatically.</div>
								<div class="settings-desc">Examples: <code>~/.npm-global/bin/pi</code>, <code>/usr/local/bin/pi</code>, <code>C:\\Users\\you\\AppData\\Roaming\\npm\\pi.cmd</code></div>
							</div>
						</div>
						<input
							type="text"
							class="settings-path-input"
							placeholder="/absolute/path/to/pi"
							.value=${this.state.piBinaryPath}
							@input=${(e: Event) => this.setPiBinaryPathDraft((e.target as HTMLInputElement).value)}
						/>
						<div class="settings-actions" style="margin-top:8px;">
							<button class="ghost-btn" @click=${() => this.choosePiBinaryPathFromDialog()}>Browse…</button>
							<button class="ghost-btn" ?disabled=${this.saving} @click=${() => this.savePiBinaryPathOverride()}>
								${this.saving ? "Saving…" : "Save path override"}
							</button>
							<button class="ghost-btn" ?disabled=${this.saving || this.state.piBinaryPath.trim().length === 0} @click=${() => this.clearPiBinaryPathOverride()}>
								Clear override
							</button>
						</div>
						${this.piPathActionMessage ? html`<div class="settings-desc">${this.piPathActionMessage}</div>` : null}
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
						${runtimeControlsEnabled
							? html`
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
												${compatibilityChecks.length > 0 ? html` (${compatibilityChecks.join(", ")})` : null}
											</div>
											${this.compatibilityReport.error ? html`<div class="settings-desc">${this.compatibilityReport.error}</div>` : null}
										`
										: null}
								</details>
							`
							: html`<div class="settings-desc">Open a project to enable CLI runtime diagnostics.</div>`}
					</div>
				</section>
			</div>
		`;
	}

	private renderActiveSection(
		section: SettingsSectionId,
		runtimeControlsEnabled: boolean,
		hasProjectContext: boolean,
		authProviders: PiAuthStatus["configured_providers"],
		compatibilityChecks: string[],
	): TemplateResult {
		switch (section) {
			case "appearance":
				return this.renderAppearanceSection();
			case "account":
				return this.renderAccountSection(runtimeControlsEnabled, hasProjectContext, authProviders);
			case "updates":
				return this.renderUpdatesSection(runtimeControlsEnabled, compatibilityChecks);
			case "general":
			default:
				return this.renderGeneralSection(runtimeControlsEnabled, hasProjectContext);
		}
	}

	private renderActiveSectionSafe(
		section: SettingsSectionId,
		runtimeControlsEnabled: boolean,
		hasProjectContext: boolean,
		authProviders: PiAuthStatus["configured_providers"],
		compatibilityChecks: string[],
	): TemplateResult {
		try {
			return this.renderActiveSection(section, runtimeControlsEnabled, hasProjectContext, authProviders, compatibilityChecks);
		} catch (err) {
			console.error("Settings section render failed:", err);
			const message = err instanceof Error ? err.message : String(err);
			return html`
				<div class="settings-view-grid">
					<section class="settings-group settings-group-full">
						<div class="settings-section">
							<div class="settings-section-title">Section error</div>
							<div class="settings-desc">Could not render this settings section.</div>
							<div class="settings-desc"><code>${message}</code></div>
						</div>
					</section>
				</div>
			`;
		}
	}

	render(): void {
		if (!this.isOpen) {
			return;
		}

		const authProviders = Array.isArray(this.authStatus?.configured_providers) ? this.authStatus.configured_providers : [];
		const compatibilityChecks = Array.isArray(this.compatibilityReport?.checks) ? this.compatibilityReport.checks : [];
		const hasProjectContext = Boolean(this.runtimeProjectPath);
		const runtimeControlsEnabled = this.isRuntimeControlsEnabled();
		const navigation = this.getNavigationState();
		const activeSection = navigation.activeSection;
		const activeItem = navigation.items.find((item) => item.id === activeSection) ?? navigation.items[0];
		this.emitNavigationState(runtimeControlsEnabled);

		try {
			const template = html`
				<div class="settings-view-root">
					<div class="settings-view-header">
						<div class="settings-view-title-wrap">
							<div class="settings-view-title">${activeItem?.label ?? "Settings"}</div>
						</div>
						<div class="settings-view-header-actions">
							<button class="settings-back-btn" @click=${() => this.close()}>← Back</button>
						</div>
					</div>

					<div class="settings-view-body settings-view-body-flat">
						<section class="settings-main" aria-live="polite">
							<div class="settings-main-content settings-main-content-flat">
								${this.renderActiveSectionSafe(activeSection, runtimeControlsEnabled, hasProjectContext, authProviders, compatibilityChecks)}
							</div>
						</section>
					</div>
					${this.renderCreateThemeDialog()}
				</div>
			`;

			render(template, this.container);
		} catch (err) {
			console.error("Settings panel render failed:", err);
			try {
				this.renderBasicSettingsShell(
					"Advanced runtime settings are temporarily unavailable. You can still use appearance settings.",
					{ showAddProject: false, warning: "Open another session or reopen settings once runtime stabilizes." },
				);
			} catch {
				render(
					html`<div class="settings-view-root"><div class="settings-view-body"><div class="settings-desc">Unable to render settings right now.</div></div></div>`,
					this.container,
				);
			}
		}
	}

	destroy(): void {
		render(nothing, this.container);
	}
}
