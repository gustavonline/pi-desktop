import { buildPiThemeDocument, isThemeDocumentSchemaCompatible } from "./pi-theme-document.js";

interface BundledThemeSpec {
	fileName: string;
	legacyFileName?: string;
	name: string;
	variant: "dark" | "light";
	codeThemeId: string;
	accent: string;
	surface: string;
	ink: string;
	diffAdded: string;
	diffRemoved: string;
	skill: string;
	contrast: number;
}

const BUNDLED_THEME_SPECS: readonly BundledThemeSpec[] = [
	{
		fileName: "pi-desktop-notion-dark.json",
		legacyFileName: "codex-notion-dark.json",
		name: "pi-desktop-notion-dark",
		variant: "dark",
		codeThemeId: "notion",
		accent: "#3183d8",
		surface: "#191919",
		ink: "#d9d9d8",
		diffAdded: "#4ec9b0",
		diffRemoved: "#fa423e",
		skill: "#3183d8",
		contrast: 60,
	},
	{
		fileName: "pi-desktop-catppuccin-dark.json",
		legacyFileName: "codex-catppuccin-dark.json",
		name: "pi-desktop-catppuccin-dark",
		variant: "dark",
		codeThemeId: "catppuccin",
		accent: "#cba6f7",
		surface: "#1e1e2e",
		ink: "#cdd6f4",
		diffAdded: "#a6e3a1",
		diffRemoved: "#f38ba8",
		skill: "#cba6f7",
		contrast: 60,
	},
	{
		fileName: "pi-desktop-github-dark.json",
		legacyFileName: "codex-github-dark.json",
		name: "pi-desktop-github-dark",
		variant: "dark",
		codeThemeId: "github",
		accent: "#1f6feb",
		surface: "#0d1117",
		ink: "#e6edf3",
		diffAdded: "#3fb950",
		diffRemoved: "#f85149",
		skill: "#bc8cff",
		contrast: 60,
	},
	{
		fileName: "pi-desktop-vscode-plus-dark.json",
		legacyFileName: "codex-vscode-plus-dark.json",
		name: "pi-desktop-vscode-plus-dark",
		variant: "dark",
		codeThemeId: "vscode-plus",
		accent: "#007acc",
		surface: "#1e1e1e",
		ink: "#d4d4d4",
		diffAdded: "#369432",
		diffRemoved: "#f44747",
		skill: "#000080",
		contrast: 60,
	},
	{
		fileName: "pi-desktop-default-dark.json",
		name: "pi-desktop-default-dark",
		variant: "dark",
		codeThemeId: "vscode-plus",
		accent: "#7a818f",
		surface: "#0d0d0f",
		ink: "#f5f5f7",
		diffAdded: "#22c55e",
		diffRemoved: "#ef4444",
		skill: "#7a818f",
		contrast: 50,
	},
	{
		fileName: "pi-desktop-notion-light.json",
		legacyFileName: "codex-notion-light.json",
		name: "pi-desktop-notion-light",
		variant: "light",
		codeThemeId: "notion",
		accent: "#3183d8",
		surface: "#ffffff",
		ink: "#37352f",
		diffAdded: "#008000",
		diffRemoved: "#a31515",
		skill: "#0000ff",
		contrast: 45,
	},
	{
		fileName: "pi-desktop-default-light.json",
		name: "pi-desktop-default-light",
		variant: "light",
		codeThemeId: "vscode-plus",
		accent: "#6b7280",
		surface: "#f3f3f5",
		ink: "#151518",
		diffAdded: "#16a34a",
		diffRemoved: "#dc2626",
		skill: "#6b7280",
		contrast: 50,
	},
	{
		fileName: "pi-desktop-vscode-plus-light.json",
		legacyFileName: "codex-vscode-plus-light.json",
		name: "pi-desktop-vscode-plus-light",
		variant: "light",
		codeThemeId: "vscode-plus",
		accent: "#007acc",
		surface: "#ffffff",
		ink: "#000000",
		diffAdded: "#008000",
		diffRemoved: "#ee0000",
		skill: "#0000ff",
		contrast: 45,
	},
	{
		fileName: "pi-desktop-catppuccin-light.json",
		legacyFileName: "codex-catppuccin-light.json",
		name: "pi-desktop-catppuccin-light",
		variant: "light",
		codeThemeId: "catppuccin",
		accent: "#8839ef",
		surface: "#eff1f5",
		ink: "#4c4f69",
		diffAdded: "#40a02b",
		diffRemoved: "#d20f39",
		skill: "#8839ef",
		contrast: 45,
	},
	{
		fileName: "pi-desktop-github-light.json",
		legacyFileName: "codex-github-light.json",
		name: "pi-desktop-github-light",
		variant: "light",
		codeThemeId: "github",
		accent: "#0969da",
		surface: "#ffffff",
		ink: "#1f2328",
		diffAdded: "#1a7f37",
		diffRemoved: "#cf222e",
		skill: "#8250df",
		contrast: 45,
	},
] as const;

const BUNDLED_THEME_ID_SET = new Set<string>(
	BUNDLED_THEME_SPECS.flatMap((spec) => {
		const ids = [spec.fileName.replace(/\.json$/i, "").toLowerCase()];
		if (spec.legacyFileName) ids.push(spec.legacyFileName.replace(/\.json$/i, "").toLowerCase());
		return ids;
	}),
);

export function isBundledThemeId(id: string): boolean {
	return BUNDLED_THEME_ID_SET.has(id.trim().toLowerCase());
}

function joinFsPath(base: string, child: string): string {
	const b = base.replace(/\\/g, "/").replace(/\/+$/, "");
	const c = child.replace(/\\/g, "/").replace(/^\/+/, "");
	return b ? `${b}/${c}` : c;
}

function toPiThemeDocument(spec: BundledThemeSpec) {
	return buildPiThemeDocument({
		name: spec.name,
		variant: spec.variant,
		accent: spec.accent,
		surface: spec.surface,
		ink: spec.ink,
		skill: spec.skill,
		diffAdded: spec.diffAdded,
		diffRemoved: spec.diffRemoved,
		success: spec.diffAdded,
		error: spec.diffRemoved,
		contrast: spec.contrast,
		codeThemeId: spec.codeThemeId,
		source: "pi-desktop-theme-v1",
	});
}

const BUNDLED_THEMES_MARKER = "pi-desktop-default-themes-installed-v2.marker";
const LEGACY_BUNDLED_THEMES_MARKERS = [
	".pi-desktop-default-themes-installed-v1",
] as const;

export interface BundledThemeInstallResult {
	created: number;
	updated: number;
	renamed: number;
	removedLegacy: number;
	skippedByMarker: boolean;
}

export interface BundledThemesStatus {
	themesRoot: string;
	total: number;
	installedCount: number;
	installed: boolean;
}

export interface BundledThemeRemoveResult {
	removed: number;
	removedLegacy: number;
}

async function resolveThemesRoot(): Promise<string | null> {
	const { homeDir } = await import("@tauri-apps/api/path");
	const home = (await homeDir()).replace(/\\/g, "/").replace(/\/+$/, "");
	if (!home) return null;
	return joinFsPath(joinFsPath(joinFsPath(home, ".pi"), "agent"), "themes");
}

async function readJsonFile(path: string, readTextFile: (path: string) => Promise<string>): Promise<unknown | null> {
	try {
		const content = await readTextFile(path);
		return JSON.parse(content) as unknown;
	} catch {
		return null;
	}
}

async function hasBundledThemeRepairCandidate(
	themesRoot: string,
	exists: (path: string) => Promise<boolean>,
	readTextFile: (path: string) => Promise<string>,
): Promise<boolean> {
	for (const spec of BUNDLED_THEME_SPECS) {
		const targetPath = joinFsPath(themesRoot, spec.fileName);
		const legacyPath = spec.legacyFileName ? joinFsPath(themesRoot, spec.legacyFileName) : null;

		if (legacyPath && !(await exists(targetPath)) && (await exists(legacyPath))) {
			return true;
		}

		if (await exists(targetPath)) {
			const doc = await readJsonFile(targetPath, readTextFile);
			if (!isThemeDocumentSchemaCompatible(doc)) {
				return true;
			}
		}
	}

	return false;
}

async function existsSafe(exists: (path: string) => Promise<boolean>, path: string): Promise<boolean> {
	try {
		return await exists(path);
	} catch {
		return false;
	}
}

async function hasBundledThemesMarker(
	themesRoot: string,
	exists: (path: string) => Promise<boolean>,
): Promise<boolean> {
	const markerNames = [BUNDLED_THEMES_MARKER, ...LEGACY_BUNDLED_THEMES_MARKERS];
	for (const markerName of markerNames) {
		if (await existsSafe(exists, joinFsPath(themesRoot, markerName))) return true;
	}
	return false;
}

async function installBundledThemes(options: { respectMarker: boolean }): Promise<BundledThemeInstallResult> {
	const { exists, mkdir, writeTextFile, readTextFile, rename, remove } = await import("@tauri-apps/plugin-fs");
	const themesRoot = await resolveThemesRoot();
	if (!themesRoot) return { created: 0, updated: 0, renamed: 0, removedLegacy: 0, skippedByMarker: true };
	await mkdir(themesRoot, { recursive: true });

	const markerPath = joinFsPath(themesRoot, BUNDLED_THEMES_MARKER);
	if (options.respectMarker && (await hasBundledThemesMarker(themesRoot, exists))) {
		const hasRepairCandidate = await hasBundledThemeRepairCandidate(themesRoot, exists, readTextFile);
		if (!hasRepairCandidate) {
			return { created: 0, updated: 0, renamed: 0, removedLegacy: 0, skippedByMarker: true };
		}
	}

	let created = 0;
	let updated = 0;
	let renamed = 0;
	let removedLegacy = 0;

	for (const spec of BUNDLED_THEME_SPECS) {
		const targetPath = joinFsPath(themesRoot, spec.fileName);
		const legacyPath = spec.legacyFileName ? joinFsPath(themesRoot, spec.legacyFileName) : null;

		if (!(await exists(targetPath)) && legacyPath && (await exists(legacyPath))) {
			try {
				await rename(legacyPath, targetPath);
				renamed += 1;
			} catch {
				// ignore and fallback to write below
			}
		}

		if (!(await exists(targetPath))) {
			const doc = toPiThemeDocument(spec);
			await writeTextFile(targetPath, `${JSON.stringify(doc, null, 2)}\n`);
			created += 1;
		} else {
			const existingDoc = await readJsonFile(targetPath, readTextFile);
			if (!isThemeDocumentSchemaCompatible(existingDoc)) {
				const doc = toPiThemeDocument(spec);
				await writeTextFile(targetPath, `${JSON.stringify(doc, null, 2)}\n`);
				updated += 1;
			}
		}

		if (legacyPath && legacyPath !== targetPath && (await exists(legacyPath))) {
			try {
				await remove(legacyPath);
				removedLegacy += 1;
			} catch {
				// ignore cleanup failure
			}
		}
	}

	try {
		await writeTextFile(markerPath, `${new Date().toISOString()}\n`);
	} catch {
		// marker writes are best effort; avoid blocking theme installation
	}
	return { created, updated, renamed, removedLegacy, skippedByMarker: false };
}

export async function ensureBundledThemesInstalled(): Promise<void> {
	try {
		await installBundledThemes({ respectMarker: true });
	} catch {
		// best effort only
	}
}

export async function restoreBundledThemes(): Promise<BundledThemeInstallResult> {
	return installBundledThemes({ respectMarker: false });
}

export async function getBundledThemesStatus(): Promise<BundledThemesStatus> {
	const { exists } = await import("@tauri-apps/plugin-fs");
	const themesRoot = await resolveThemesRoot();
	if (!themesRoot) {
		return { themesRoot: "", total: BUNDLED_THEME_SPECS.length, installedCount: 0, installed: false };
	}
	let installedCount = 0;
	for (const spec of BUNDLED_THEME_SPECS) {
		const targetPath = joinFsPath(themesRoot, spec.fileName);
		if (await exists(targetPath)) installedCount += 1;
	}
	return {
		themesRoot,
		total: BUNDLED_THEME_SPECS.length,
		installedCount,
		installed: installedCount === BUNDLED_THEME_SPECS.length,
	};
}

export async function removeBundledThemes(): Promise<BundledThemeRemoveResult> {
	const { exists, remove } = await import("@tauri-apps/plugin-fs");
	const themesRoot = await resolveThemesRoot();
	if (!themesRoot) return { removed: 0, removedLegacy: 0 };

	let removed = 0;
	let removedLegacy = 0;
	for (const spec of BUNDLED_THEME_SPECS) {
		const targetPath = joinFsPath(themesRoot, spec.fileName);
		if (await exists(targetPath)) {
			try {
				await remove(targetPath);
				removed += 1;
			} catch {
				// ignore
			}
		}
		if (spec.legacyFileName) {
			const legacyPath = joinFsPath(themesRoot, spec.legacyFileName);
			if (await exists(legacyPath)) {
				try {
					await remove(legacyPath);
					removedLegacy += 1;
				} catch {
					// ignore
				}
			}
		}
	}

	// Keep marker file so automatic first-run bootstrap does not reinstall after explicit uninstall.
	return { removed, removedLegacy };
}
