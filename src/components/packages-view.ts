/**
 * PackagesView - package/config/resource management surface shown in main pane
 */

import { html, nothing, render, type TemplateResult } from "lit";
import { normalizeRecommendedSource, RECOMMENDED_PACKAGES, type RecommendedPackageDefinition } from "../recommended-packages.js";
import { RECOMMENDED_SKILLS, type RecommendedSkillDefinition } from "../recommended-skills.js";
import { rpcBridge } from "../rpc/bridge.js";
import { collectBuiltInOAuthProviderIds } from "../auth/provider-auth.js";
import { isExtensionConfigIntent } from "../extensions/extension-command-intent.js";
import { extensionCommandUsageHint, withExtensionCommandUsageHint } from "../extensions/extension-command-hints.js";
import { getBundledThemesStatus, isBundledThemeId, removeBundledThemes, restoreBundledThemes } from "../theme/bundled-themes.js";

interface CatalogPackageItem {
	name: string;
	description: string;
	version: string;
	npmUrl: string;
	score: number;
}

interface InstalledPackageItem {
	source: string;
	location: string;
	scope: "user" | "project";
}

interface InstalledDisplayItem extends InstalledPackageItem {
	displayName: string;
	openUrl: string | null;
}

interface PackageConfigCommand {
	name: string;
	description: string;
	path: string;
}

interface PackageProjectOption {
	id: string;
	name: string;
	path: string;
}

interface AutoRenameConfigDraft {
	enabled: boolean;
	modelSelection: "current" | "cheapest";
	model: string;
	fallbackModel: string;
	fallbackDeterministic: "truncate" | "words" | "none" | "readable-id";
	prefix: string;
	prefixCommand: string;
	prefixOnly: boolean;
	readableIdSuffix: boolean;
	debug: boolean;
}

interface ModelOption {
	provider: string;
	id: string;
	label: string;
}

interface DiscoveredResourceItem {
	id: string;
	kind: "prompt" | "skill";
	name: string;
	description: string;
	commandText: string;
	path: string;
	origin: string | null;
	loaded: boolean;
	packageSource: string | null;
	packageScope: "user" | "project" | null;
	packageDisplayName: string | null;
	sourceKind: "npm" | "git" | "url" | "local" | "unknown";
}

interface DiscoveredThemeItem {
	id: string;
	name: string;
	description: string;
	variant: "light" | "dark";
	accent: string;
	background: string;
	foreground: string;
	path: string;
}

interface ExtensionSurfaceItem {
	id: string;
	displayName: string;
	source: string;
	description: string;
	note: string;
	openUrl: string | null;
	sourceKind: "npm" | "git" | "url" | "local" | "unknown";
	installState: { global: boolean; project: boolean };
	installedItemForScope: InstalledDisplayItem | null;
}

interface RecommendedSkillSurfaceItem {
	id: string;
	definition: RecommendedSkillDefinition;
	resource: DiscoveredResourceItem | null;
	installed: boolean;
	packageInstalled: boolean;
}

type ActivePackagesModal =
	| { kind: "extension"; item: ExtensionSurfaceItem }
	| { kind: "skill"; item: DiscoveredResourceItem }
	| { kind: "recommended-skill"; item: RecommendedSkillSurfaceItem }
	| { kind: "theme"; item: DiscoveredThemeItem };

type UiIcon =
	| "package"
	| "extension"
	| "skill"
	| "theme"
	| "prompt"
	| "open"
	| "settings"
	| "plus"
	| "remove";

const PACKAGES_CATALOG_URL = "https://shittycodingagent.ai/packages";
const PACKAGES_SEARCH_URL = "https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250";
const RESOURCE_CREATOR_SKILL_NAME = "creatorskill";
const DESKTOP_THEMES_PACKAGE_SOURCE = "local:pi-desktop-themes";
const DESKTOP_THEMES_DOC_URL = "https://github.com/gustavonline/pi-desktop/blob/dev/docs/THEMES_DESKTOP_MAPPING.md";
const AUTO_RENAME_PRIMARY_SOURCE = normalizeRecommendedSource("npm:@byteowlz/pi-auto-rename");
const AUTO_RENAME_LEGACY_SOURCE = normalizeRecommendedSource("npm:pi-session-auto-rename");
const AUTO_RENAME_COMMAND_NAMES = new Set(["auto-rename", "name-ai-config"]);
const AUTO_RENAME_SCHEMA_RELATIVE = "./auto-rename.schema.json";
const SMART_NOTIFY_COMMAND_NAMES = new Set(["voice-notify"]);
const SMART_NOTIFY_PRIMARY_SOURCE = normalizeRecommendedSource("npm:pi-smart-voice-notify");
const SMART_NOTIFY_LEGACY_SOURCE = normalizeRecommendedSource("npm:pi-desktop-notify");
const SMART_NOTIFY_INSTALL_SOURCE = "npm:pi-smart-voice-notify";
const PROVIDER_AUTH_CLEANUP_HINTS = new Map<string, string[]>([
	["pi-cursor-agent", ["cursor-agent"]],
	["cursor-agent", ["cursor-agent"]],
	["pi-kilocode", ["kilo"]],
	["kilocode", ["kilo"]],
	["kilo-pi-provider", ["kilo"]],
	["pi-kilo", ["kilo"]],
]);

function defaultAutoRenameConfigDraft(): AutoRenameConfigDraft {
	return {
		enabled: true,
		modelSelection: "current",
		model: "",
		fallbackModel: "",
		fallbackDeterministic: "readable-id",
		prefix: "",
		prefixCommand: "",
		prefixOnly: false,
		readableIdSuffix: false,
		debug: false,
	};
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of items) {
		const key = getKey(item);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

function parsePiListOutput(output: string): { user: InstalledPackageItem[]; project: InstalledPackageItem[] } {
	const user: InstalledPackageItem[] = [];
	const project: InstalledPackageItem[] = [];
	let section: "user" | "project" | null = null;
	let pending: InstalledPackageItem | null = null;

	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.replace(/\t/g, "    ");
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (/^User packages:/i.test(trimmed)) {
			section = "user";
			pending = null;
			continue;
		}
		if (/^Project packages:/i.test(trimmed)) {
			section = "project";
			pending = null;
			continue;
		}
		if (!section) continue;
		if (/^\(none\)$/i.test(trimmed)) {
			pending = null;
			continue;
		}

		if (/^\s{4}\S/.test(line) && pending) {
			pending.location = trimmed;
			continue;
		}

		if (/^\s{2}\S/.test(line)) {
			pending = {
				source: trimmed,
				location: "",
				scope: section,
			};
			if (section === "user") user.push(pending);
			else project.push(pending);
		}
	}

	return { user, project };
}

function normalizeFsPath(path: string | null | undefined): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isLikelyConfigCommand(name: string, description: string): boolean {
	const haystack = `${name} ${description}`.toLowerCase();
	return /\bconfig\b/.test(haystack) ||
		/(^|\b)(configure|settings|setup)(\b|$)/.test(haystack);
}

function normalizeCommandNameForMatch(name: string): string {
	const normalized = name.trim().toLowerCase();
	return normalized.startsWith("/") ? normalized.slice(1) : normalized;
}

function commandNamesMatch(left: string, right: string): boolean {
	const leftName = normalizeCommandNameForMatch(left);
	const rightName = normalizeCommandNameForMatch(right);
	if (!leftName || !rightName) return false;
	return leftName === rightName;
}

function npmPackageNameFromSource(source: string): string {
	if (!source) return "";
	if (source.startsWith("npm:")) return source.slice(4).trim().toLowerCase();
	if (/^[@a-z0-9][\w./-]*$/i.test(source) && !source.includes(":")) return source.trim().toLowerCase();
	return "";
}

function pathMatchesNpmPackage(normalizedPath: string, source: string): boolean {
	const packageName = npmPackageNameFromSource(source);
	if (!packageName) return false;
	return normalizedPath.includes(`/node_modules/${packageName}/`) || normalizedPath.endsWith(`/node_modules/${packageName}`);
}

function commandLikelyNeedsModelArg(command: PackageConfigCommand): boolean {
	const normalizedName = normalizeCommandNameForMatch(command.name);
	if (AUTO_RENAME_COMMAND_NAMES.has(normalizedName)) return true;
	const haystack = `${command.name} ${command.description}`.toLowerCase();
	return /(^|\b)(model|provider)(\b|$)/.test(haystack) || haystack.includes("provider/model");
}

function normalizeAutoRenameConfigDraft(raw: Record<string, unknown>): AutoRenameConfigDraft {
	const defaults = defaultAutoRenameConfigDraft();
	let model = "";
	const modelRaw = raw.model;
	if (typeof modelRaw === "string" && splitModelRef(modelRaw)) {
		model = modelRaw.trim();
	} else if (modelRaw && typeof modelRaw === "object" && !Array.isArray(modelRaw)) {
		const modelObj = modelRaw as Record<string, unknown>;
		const provider = readString(modelObj.provider);
		const id = readString(modelObj.id);
		if (provider && id) model = modelRef(provider, id);
	}
	if (!model) {
		model = readModelRefFromConfigObject(raw) || "";
	}

	let fallbackModel = "";
	const fallbackRaw = raw.fallbackModel;
	if (typeof fallbackRaw === "string" && splitModelRef(fallbackRaw)) {
		fallbackModel = fallbackRaw.trim();
	} else if (fallbackRaw && typeof fallbackRaw === "object" && !Array.isArray(fallbackRaw)) {
		const fallbackObj = fallbackRaw as Record<string, unknown>;
		const provider = readString(fallbackObj.provider);
		const id = readString(fallbackObj.id);
		if (provider && id) fallbackModel = modelRef(provider, id);
	}
	return {
		enabled: readBoolean(raw.enabled) ?? defaults.enabled,
		modelSelection: readString(raw.modelSelection) === "cheapest" ? "cheapest" : "current",
		model,
		fallbackModel,
		fallbackDeterministic:
			readString(raw.fallbackDeterministic) === "truncate" ||
			readString(raw.fallbackDeterministic) === "words" ||
			readString(raw.fallbackDeterministic) === "none" ||
			readString(raw.fallbackDeterministic) === "readable-id"
				? (readString(raw.fallbackDeterministic) as AutoRenameConfigDraft["fallbackDeterministic"])
				: defaults.fallbackDeterministic,
		prefix: readString(raw.prefix),
		prefixCommand: readString(raw.prefixCommand),
		prefixOnly: readBoolean(raw.prefixOnly) ?? defaults.prefixOnly,
		readableIdSuffix: readBoolean(raw.readableIdSuffix) ?? defaults.readableIdSuffix,
		debug: readBoolean(raw.debug) ?? defaults.debug,
	};
}

function modelRef(provider: string, id: string): string {
	return `${provider}/${id}`;
}

function splitModelRef(value: string): { provider: string; id: string } | null {
	const input = value.trim();
	const slash = input.indexOf("/");
	if (slash <= 0 || slash >= input.length - 1) return null;
	const provider = input.slice(0, slash).trim();
	const id = input.slice(slash + 1).trim();
	if (!provider || !id) return null;
	return { provider, id };
}

function readModelRefFromConfigObject(parsed: Record<string, unknown>): string | null {
	const provider = readString(parsed.provider) || readString(parsed.providerId) || readString(parsed.provider_id);
	const id = readString(parsed.id) || readString(parsed.modelId) || readString(parsed.model_id);
	if (provider && id) return modelRef(provider, id);
	const model = readString(parsed.model);
	if (model && splitModelRef(model)) return model;
	return null;
}

interface ParsedSkillDocSection {
	heading: string | null;
	paragraphs: string[];
}

interface ParsedSkillDoc {
	title: string;
	summary: string;
	sections: ParsedSkillDocSection[];
}

function parseFrontmatter(content: string): { attributes: Record<string, string>; body: string } {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	if (lines[0]?.trim() !== "---") return { attributes: {}, body: normalized };
	const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (endIndex <= 0) return { attributes: {}, body: normalized };
	const attributes: Record<string, string> = {};
	for (const line of lines.slice(1, endIndex)) {
		const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!match) continue;
		let value = match[2].trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		attributes[match[1].toLowerCase()] = value;
	}
	return {
		attributes,
		body: lines.slice(endIndex + 1).join("\n").trim(),
	};
}

function normalizeDocLine(line: string): string {
	if (/^---+$/.test(line.trim())) return "";
	return line
		.replace(/!\[[^\]]*\]\(([^)]+)\)/g, "image: $1")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/^[-*+]\s+/, "• ")
		.replace(/^>\s?/, "")
		.trim();
}

function linesToParagraphs(lines: string[]): string[] {
	const paragraphs: string[] = [];
	let chunk: string[] = [];
	for (const raw of lines) {
		const line = raw.trim();
		if (!line) {
			if (chunk.length > 0) {
				paragraphs.push(chunk.join(" "));
				chunk = [];
			}
			continue;
		}
		chunk.push(line);
	}
	if (chunk.length > 0) paragraphs.push(chunk.join(" "));
	return paragraphs;
}

function parseSkillDoc(content: string): ParsedSkillDoc {
	const { attributes, body } = parseFrontmatter(content);
	const sections: ParsedSkillDocSection[] = [];
	let activeHeading: string | null = null;
	let activeLines: string[] = [];
	let title = attributes.name ? toTitleFromSlug(attributes.name) : "Skill details";
	const summary = attributes.description ?? "";

	const pushSection = () => {
		const paragraphs = linesToParagraphs(activeLines);
		if (!activeHeading && paragraphs.length === 0) return;
		sections.push({ heading: activeHeading, paragraphs });
		activeLines = [];
	};

	for (const raw of body.split(/\r?\n/)) {
		const trimmed = raw.trim();
		if (!trimmed) {
			activeLines.push("");
			continue;
		}
		const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
		if (headingMatch) {
			pushSection();
			activeHeading = headingMatch[1].trim();
			if (!title || title === "Skill details") title = activeHeading;
			continue;
		}
		activeLines.push(normalizeDocLine(trimmed));
	}
	pushSection();

	if (sections.length === 0 && body.trim()) {
		sections.push({ heading: null, paragraphs: [normalizeDocLine(body.trim())] });
	}
	if (!title) title = "Skill details";

	return { title, summary, sections };
}

function icon(name: UiIcon): TemplateResult {
	switch (name) {
		case "package":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 5.1L8 2.4l5.2 2.7L8 7.8z"></path><path d="M2.8 5.1V11L8 13.7V7.8"></path><path d="M13.2 5.1V11L8 13.7"></path></svg>`;
		case "extension":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.1 3.2a2.1 2.1 0 1 1 3.8 1.2h1a1.8 1.8 0 0 1 1.8 1.8v1.1H9.8"></path><path d="M9.9 12.8a2.1 2.1 0 1 1-3.8-1.2h-1a1.8 1.8 0 0 1-1.8-1.8V8.7h2.9"></path><path d="M7.9 5.6v4.8"></path></svg>`;
		case "skill":
			return html`<svg class="filled" viewBox="0 0 20 20" aria-hidden="true"><path d="M9.2 2.3a1.5 1.5 0 0 1 3 0v3.8h.8V3.8a1.5 1.5 0 0 1 3 0v6.4a4.8 4.8 0 0 1-4.8 4.8H9.8A4.8 4.8 0 0 1 5 10.2V7.8a1.5 1.5 0 1 1 3 0v1.4h.8V2.3a1.5 1.5 0 0 1 .4-1z"></path></svg>`;
		case "theme":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.4a5.6 5.6 0 1 0 0 11.2c1.4 0 1.9-.8 1.9-1.5 0-.5-.2-1 .6-1h1.2a1.9 1.9 0 0 0 1.9-1.9A5.6 5.6 0 0 0 8 2.4z"></path><circle cx="5.3" cy="6.4" r=".8"></circle><circle cx="8" cy="5.4" r=".8"></circle><circle cx="10.6" cy="6.5" r=".8"></circle></svg>`;
		case "prompt":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.1 2.8h5.4l2.4 2.4V13H4.1z"></path><path d="M9.5 2.8v2.4h2.4"></path><path d="M5.8 8h4.4"></path><path d="M5.8 10.2h3.4"></path></svg>`;
		case "open":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7"></path><path d="M13 3L5.4 10.6"></path><path d="M12.5 9v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"></path></svg>`;
		case "settings":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 4h4.5"></path><path d="M9.8 4h3.4"></path><circle cx="8.3" cy="4" r="1.3"></circle><path d="M2.8 8h2.3"></path><path d="M7.2 8h6"></path><circle cx="6" cy="8" r="1.3"></circle><path d="M2.8 12h5.7"></path><path d="M10.5 12h2.7"></path><circle cx="9.1" cy="12" r="1.3"></circle></svg>`;
		case "plus":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.4v9.2"></path><path d="M3.4 8h9.2"></path></svg>`;
		case "remove":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 4.4l7.2 7.2"></path><path d="M11.6 4.4l-7.2 7.2"></path></svg>`;
	}
}

function sourceKindLabel(kind: "npm" | "git" | "url" | "local" | "unknown"): string {
	switch (kind) {
		case "npm":
			return "npm";
		case "git":
			return "git";
		case "url":
			return "url";
		case "local":
			return "local";
		default:
			return "source";
	}
}

function inferSourceKindFromSource(source: string): "npm" | "git" | "url" | "local" | "unknown" {
	const value = source.trim();
	if (!value) return "unknown";
	if (value.startsWith("npm:") || /^[@a-z0-9][\w./-]*$/i.test(value)) return "npm";
	if (value.startsWith("git:") || value.startsWith("github:")) return "git";
	if (/^https?:\/\//i.test(value)) return "url";
	if (
		value.startsWith("file:") ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.startsWith("/") ||
		value.startsWith("~/") ||
		/^[a-zA-Z]:[\\/]/.test(value)
	) {
		return "local";
	}
	return "unknown";
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function normalizeSourceScope(value: string): "user" | "project" | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === "user" || normalized === "global") return "user";
	if (normalized === "project" || normalized === "local") return "project";
	return null;
}

function readCommandSourceInfo(raw: Record<string, unknown>): {
	path: string;
	source: string;
	scope: "user" | "project" | null;
	origin: string;
	baseDir: string;
} {
	const info = (raw.sourceInfo ?? raw.source_info) as Record<string, unknown> | undefined;
	const path = readString(raw.path) || readString(raw.location) || readString(info?.path);
	const source = readString(info?.source);
	const scope = normalizeSourceScope(readString(info?.scope));
	const origin = readString(info?.origin);
	const baseDir = readString(info?.baseDir ?? info?.base_dir);
	return { path, source, scope, origin, baseDir };
}

function joinFsPath(base: string, child: string): string {
	const sep = base.includes("\\") ? "\\" : "/";
	const normalizedBase = base.replace(/[\\/]+$/, "");
	return `${normalizedBase}${sep}${child}`;
}

function pathBaseName(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/");
	return parts[parts.length - 1] || normalized;
}

function fileStem(path: string): string {
	const base = pathBaseName(path);
	const idx = base.lastIndexOf(".");
	if (idx <= 0) return base;
	return base.slice(0, idx);
}

function pathDirName(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const slashIdx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
	if (slashIdx <= 0) return normalized;
	return normalized.slice(0, slashIdx);
}

function toTitleFromSlug(value: string): string {
	return value
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export class PackagesView {
	private container: HTMLElement;
	private catalogItems: CatalogPackageItem[] = [];
	private installedUser: InstalledPackageItem[] = [];
	private installedProject: InstalledPackageItem[] = [];
	private promptTemplateResources: DiscoveredResourceItem[] = [];
	private skillResources: DiscoveredResourceItem[] = [];
	private themeResources: DiscoveredThemeItem[] = [];

	private loadingCatalog = false;
	private loadingResources = false;
	private resourcesError = "";
	private loadingConfig = false;
	private runningCommand = false;
	private catalogError = "";
	private configError = "";
	private commandStatus = "";
	private commandOutput = "";
	private smartNotifyMigrationAttempted = false;
	private packageScope: "global" | "local" = "global";
	private query = "";
	private currentProjectPath: string | null = null;
	private onBack: (() => void) | null = null;
	private onInsertPromptTemplate: ((commandText: string) => void | Promise<void>) | null = null;
	private packageConfigCommands = new Map<string, PackageConfigCommand[]>();
	private activePackageConfigSource: string | null = null;
	private activePackageConfigLabel = "";
	private runningConfigCommand = false;
	private packageConfigStatus = "";
	private packageConfigCommandArgs = new Map<string, string>();
	private packageConfigLoadedModelBySource = new Map<string, string>();
	private autoRenameConfig = defaultAutoRenameConfigDraft();
	private autoRenameConfigRaw: Record<string, unknown> = {};
	private autoRenameConfigPath = "";
	private autoRenameConfigScopeLabel = "";
	private autoRenameConfigSaveScope: "global" | "project" = "global";
	private autoRenameConfigTargetProjectId = "";
	private autoRenameConfigTargetProjectPath = "";
	private autoRenameProjectOptions: PackageProjectOption[] = [];
	private projectOptionsProvider: (() => PackageProjectOption[]) | null = null;
	private autoRenameConfigLoading = false;
	private autoRenameConfigSaving = false;
	private autoRenameConfigLoadedSource = "";
	private autoRenameConfigError = "";
	private configModels: ModelOption[] = [];
	private configModelsLoading = false;
	private configModelsLoaded = false;
	private configModelsError = "";
	private homePath: string | null = null;
	private creatingResource = false;
	private deletingResource = false;
	private resourceStatus = "";
	private resourceEditorOpen = false;
	private resourceEditorMode: "create" | "edit" = "create";
	private resourceEditorKind: "prompt" | "skill" = "prompt";
	private resourceEditorScope: "global" | "project" = "global";
	private resourceEditorName = "";
	private resourceEditorDescription = "";
	private resourceEditorContent = "";
	private resourceEditorPath: string | null = null;
	private resourceEditorLoaded = false;
	private resourceEditorError = "";
	private resourceCreatorOpen = false;
	private resourceCreatorKind: "auto" | "prompt" | "skill" = "auto";
	private resourceCreatorScope: "global" | "project" = "global";
	private resourceCreatorBrief = "";
	private resourceCreatorRunning = false;
	private resourceCreatorError = "";
	private resourceCreatorKindLocked = false;
	private activePackagesModal: ActivePackagesModal | null = null;
	private activeSkillContent = "";
	private activeSkillContentPath: string | null = null;
	private activeSkillContentLoading = false;
	private activeSkillContentError = "";
	private activeSkillContentNotice = "";
	private desktopThemesInstalled = false;
	private desktopThemesInstalledCount = 0;
	private desktopThemesTotal = 10;
	private desktopThemesRootPath = "";

	constructor(container: HTMLElement) {
		this.container = container;
		this.render();
	}

	setProjectPath(path: string | null): void {
		this.currentProjectPath = path;
		this.packageScope = "global";
		if (!path && this.resourceEditorScope === "project") {
			this.resourceEditorScope = "global";
		}
		this.resourceCreatorScope = "global";
		this.refreshAutoRenameProjectOptions();
		this.render();
	}

	setProjectOptionsProvider(cb: (() => PackageProjectOption[]) | null): void {
		this.projectOptionsProvider = cb;
		this.refreshAutoRenameProjectOptions();
		this.render();
	}

	private refreshAutoRenameProjectOptions(): void {
		const providerItems = this.projectOptionsProvider ? this.projectOptionsProvider() : [];
		const merged = uniqueBy(
			[
				...providerItems
					.filter((item) => item && item.id && item.path)
					.map((item) => ({ id: item.id, name: item.name || item.path, path: item.path })),
				...(this.currentProjectPath
					? [{ id: `current:${normalizeFsPath(this.currentProjectPath)}`, name: pathBaseName(this.currentProjectPath), path: this.currentProjectPath }]
					: []),
			],
			(item) => normalizeFsPath(item.path),
		).sort((a, b) => a.name.localeCompare(b.name));
		this.autoRenameProjectOptions = merged;

		if (this.autoRenameConfigSaveScope === "project") {
			const selected = this.autoRenameProjectOptions.find((item) => item.id === this.autoRenameConfigTargetProjectId)
				?? this.autoRenameProjectOptions.find((item) => normalizeFsPath(item.path) === normalizeFsPath(this.autoRenameConfigTargetProjectPath))
				?? (this.currentProjectPath
					? this.autoRenameProjectOptions.find((item) => normalizeFsPath(item.path) === normalizeFsPath(this.currentProjectPath))
					: null)
				?? this.autoRenameProjectOptions[0]
				?? null;
			if (selected) {
				this.autoRenameConfigTargetProjectId = selected.id;
				this.autoRenameConfigTargetProjectPath = selected.path;
			} else {
				this.autoRenameConfigSaveScope = "global";
				this.autoRenameConfigTargetProjectId = "";
				this.autoRenameConfigTargetProjectPath = "";
			}
		} else if (!this.autoRenameConfigTargetProjectPath && this.currentProjectPath) {
			const currentMatch = this.autoRenameProjectOptions.find((item) => normalizeFsPath(item.path) === normalizeFsPath(this.currentProjectPath));
			if (currentMatch) {
				this.autoRenameConfigTargetProjectId = currentMatch.id;
				this.autoRenameConfigTargetProjectPath = currentMatch.path;
			}
		}
	}

	setOnBack(cb: () => void): void {
		this.onBack = cb;
	}

	setOnInsertPromptTemplate(cb: ((commandText: string) => void | Promise<void>) | null): void {
		this.onInsertPromptTemplate = cb;
	}

	setQuery(query: string): void {
		if (this.query === query) return;
		this.query = query;
		this.render();
	}

	getQuery(): string {
		return this.query;
	}

	async open(): Promise<void> {
		await Promise.all([this.loadCatalog(this.catalogItems.length === 0), this.loadConfig(), this.refreshBundledThemesStatus()]);
		await this.refreshDiscoveredResources();
	}

	async openCatalog(): Promise<void> {
		await this.openExternal(PACKAGES_CATALOG_URL);
	}

	async refreshPackages(forceCatalog = false): Promise<void> {
		await Promise.all([this.loadCatalog(forceCatalog), this.loadConfig(), this.refreshBundledThemesStatus()]);
		await this.refreshDiscoveredResources();
	}

	private async refreshBundledThemesStatus(): Promise<void> {
		try {
			const status = await getBundledThemesStatus();
			this.desktopThemesInstalled = status.installed;
			this.desktopThemesInstalledCount = status.installedCount;
			this.desktopThemesTotal = status.total;
			this.desktopThemesRootPath = status.themesRoot;
		} catch {
			this.desktopThemesInstalled = false;
			this.desktopThemesInstalledCount = 0;
			this.desktopThemesRootPath = "";
		}
	}

	private updateBundledThemeInstallStateFromResources(resources: DiscoveredThemeItem[]): void {
		const bundledResources = resources.filter((item) => isBundledThemeId(item.id));
		if (bundledResources.length === 0) return;
		this.desktopThemesInstalledCount = Math.max(this.desktopThemesInstalledCount, bundledResources.length);
		if (!this.desktopThemesRootPath) {
			const samplePath = bundledResources[0]?.path ?? "";
			if (samplePath) {
				this.desktopThemesRootPath = pathDirName(samplePath);
			}
		}
		if (bundledResources.length >= this.desktopThemesTotal) {
			this.desktopThemesInstalled = true;
		}
	}

	private async openExternal(url: string): Promise<void> {
		try {
			const { open } = await import("@tauri-apps/plugin-shell");
			await open(url);
		} catch {
			window.open(url, "_blank", "noopener,noreferrer");
		}
	}

	private normalizeQuery(): string {
		return this.query.trim().toLowerCase();
	}

	private normalizeResourceName(name: string): string {
		const trimmed = name.trim();
		if (this.resourceEditorKind === "skill") {
			return trimmed
				.toLowerCase()
				.replace(/[^a-z0-9-]/g, "-")
				.replace(/--+/g, "-")
				.replace(/^-+|-+$/g, "")
				.slice(0, 64);
		}
		return trimmed
			.toLowerCase()
			.replace(/[^a-z0-9_-]/g, "-")
			.replace(/--+/g, "-")
			.replace(/^[-_]+|[-_]+$/g, "")
			.slice(0, 64);
	}

	private validateResourceName(name: string, kind: "prompt" | "skill"): string | null {
		const trimmed = name.trim();
		if (!trimmed) return "Name is required.";
		if (kind === "skill") {
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
				return "Skill name must use lowercase letters, numbers, and hyphens.";
			}
			if (trimmed.length > 64) return "Skill name must be 64 characters or fewer.";
			return null;
		}
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(trimmed)) {
			return "Prompt name must start with a letter/number and use letters, numbers, hyphens, or underscores.";
		}
		if (trimmed.length > 64) return "Prompt name must be 64 characters or fewer.";
		return null;
	}

	private async ensureHomePath(): Promise<void> {
		if (this.homePath) return;
		try {
			const { homeDir } = await import("@tauri-apps/api/path");
			this.homePath = await homeDir();
		} catch {
			this.homePath = null;
		}
	}

	private resourceRootPath(kind: "prompt" | "skill", scope: "global" | "project"): string | null {
		const suffix = kind === "prompt" ? "prompts" : "skills";
		if (scope === "global") {
			if (!this.homePath) return null;
			return joinFsPath(joinFsPath(joinFsPath(this.homePath, ".pi"), "agent"), suffix);
		}
		if (!this.currentProjectPath) return null;
		return joinFsPath(joinFsPath(this.currentProjectPath, ".pi"), suffix);
	}

	private resourceFilePath(kind: "prompt" | "skill", scope: "global" | "project", name: string): string | null {
		const root = this.resourceRootPath(kind, scope);
		if (!root) return null;
		if (kind === "prompt") {
			return joinFsPath(root, `${name}.md`);
		}
		return joinFsPath(joinFsPath(root, name), "SKILL.md");
	}

	private createPromptTemplateContent(description: string): string {
		const safeDescription = description.trim() || "Describe when to use this template";
		return `---\ndescription: ${JSON.stringify(safeDescription)}\n---\nWrite the prompt instructions here.\n\nUse arguments if needed:\n- $1 for first arg\n- $@ for all args\n`;
	}

	private createSkillTemplateContent(name: string, description: string): string {
		const safeName = name.trim() || "my-skill";
		const safeDescription = description.trim() || "What this skill does and when to use it.";
		const heading = toTitleFromSlug(safeName) || "My Skill";
		return `---\nname: ${safeName}\ndescription: ${JSON.stringify(safeDescription)}\n---\n\n# ${heading}\n\n## Purpose\nDescribe the task this skill handles and when to use it.\n\n## Setup\nAdd one-time setup steps if needed.\n\n## Workflow\n1. Gather required context.\n2. Execute the core steps for this skill.\n3. Return a concise summary and next actions.\n`;
	}

	private applyResourceTemplate(): void {
		if (this.resourceEditorKind === "prompt") {
			this.resourceEditorContent = this.createPromptTemplateContent(this.resourceEditorDescription);
		} else {
			this.resourceEditorContent = this.createSkillTemplateContent(this.resourceEditorName, this.resourceEditorDescription);
		}
		this.render();
	}

	private normalizeLoadedResourceName(item: DiscoveredResourceItem): string {
		const raw = item.name.trim();
		if (item.kind === "skill") {
			if (raw.startsWith("skill:")) return raw.slice("skill:".length);
			if (raw.startsWith("/skill:")) return raw.slice("/skill:".length);
		}
		return raw.startsWith("/") ? raw.slice(1) : raw;
	}

	private isResourcePathWithin(path: string, root: string | null): boolean {
		const normalizedPath = normalizeFsPath(path);
		const normalizedRoot = normalizeFsPath(root ?? "");
		if (!normalizedPath || !normalizedRoot) return false;
		return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
	}

	private canEditResource(item: DiscoveredResourceItem): boolean {
		if (!item.path) return false;
		const normalizedPath = normalizeFsPath(item.path);
		if (!normalizedPath) return false;
		if (normalizedPath.includes("/node_modules/")) return false;
		const globalRoot = this.resourceRootPath(item.kind, "global");
		const projectRoot = this.resourceRootPath(item.kind, "project");
		return this.isResourcePathWithin(item.path, globalRoot) || this.isResourcePathWithin(item.path, projectRoot);
	}

	private normalizeResourceListItem(item: DiscoveredResourceItem): DiscoveredResourceItem {
		if (item.kind === "skill") {
			const normalizedSkillName = this.normalizeLoadedResourceName(item);
			return {
				...item,
				name: normalizedSkillName,
				commandText: `/skill:${normalizedSkillName}`,
			};
		}
		const normalizedPromptName = this.normalizeLoadedResourceName(item);
		return {
			...item,
			name: normalizedPromptName,
			commandText: `/${normalizedPromptName}`,
		};
	}

	private async loadCatalog(force = false): Promise<void> {
		if (!force && this.catalogItems.length > 0) {
			this.render();
			return;
		}
		if (this.loadingCatalog) return;

		this.loadingCatalog = true;
		this.catalogError = "";
		this.render();

		try {
			const response = await fetch(PACKAGES_SEARCH_URL);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const payload = (await response.json()) as {
				objects?: Array<{
					package?: {
						name?: string;
						description?: string;
						version?: string;
						links?: { npm?: string };
					};
					score?: { final?: number };
				}>;
			};

			this.catalogItems = (payload.objects ?? [])
				.map((entry) => {
					const pkg = entry.package;
					if (!pkg?.name) return null;
					return {
						name: pkg.name,
						description: pkg.description ?? "",
						version: pkg.version ?? "",
						npmUrl: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
						score: entry.score?.final ?? 0,
					} satisfies CatalogPackageItem;
				})
				.filter((item): item is CatalogPackageItem => item !== null)
				.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
		} catch (err) {
			this.catalogError = err instanceof Error ? err.message : String(err);
		} finally {
			this.loadingCatalog = false;
			this.render();
		}
	}

	private async loadConfig(): Promise<void> {
		if (this.loadingConfig) return;

		this.loadingConfig = true;
		this.configError = "";
		this.render();

		try {
			const userListResult = await rpcBridge.runPiCliCommand(["list"], { cwd: "/" });
			const parsedUser = parsePiListOutput(userListResult.stdout ?? "");

			this.installedUser = uniqueBy([...parsedUser.user], (item) => item.source);
			this.installedProject = [];

			const migratedNotifyPackage = await this.migrateLegacyNotifyPackageIfNeeded();
			if (migratedNotifyPackage) {
				const refreshedListResult = await rpcBridge.runPiCliCommand(["list"], { cwd: "/" });
				const refreshedParsed = parsePiListOutput(refreshedListResult.stdout ?? "");
				this.installedUser = uniqueBy([...refreshedParsed.user], (item) => item.source);
				this.installedProject = [];
			}

			await this.refreshPackageConfigCommands();
			if (this.activePackageConfigSource && !this.isNormalizedSourceInstalled(this.activePackageConfigSource)) {
				this.closeActivePackageConfig();
			}
		} catch (err) {
			this.configError = err instanceof Error ? err.message : String(err);
		} finally {
			this.loadingConfig = false;
			this.render();
		}
	}

	private async migrateLegacyNotifyPackageIfNeeded(): Promise<boolean> {
		if (this.smartNotifyMigrationAttempted) return false;
		const legacyInstalled = this.installedUser.find((item) => normalizeRecommendedSource(item.source) === SMART_NOTIFY_LEGACY_SOURCE) ?? null;
		if (!legacyInstalled) return false;
		this.smartNotifyMigrationAttempted = true;

		const hasPreferred = this.installedUser.some((item) => normalizeRecommendedSource(item.source) === SMART_NOTIFY_PRIMARY_SOURCE);
		let changed = false;

		if (!hasPreferred) {
			const installOk = await this.executePackageCommand(["install", SMART_NOTIFY_INSTALL_SOURCE], {
				scope: "global",
				appendLocalFlag: false,
				statusText: `Installing ${SMART_NOTIFY_INSTALL_SOURCE}…`,
				refreshOnSuccess: false,
			});
			if (!installOk) {
				this.commandStatus = `Failed to install ${SMART_NOTIFY_INSTALL_SOURCE}.`;
				return false;
			}
			changed = true;
		}

		const removeSource = legacyInstalled.source || "npm:pi-desktop-notify";
		const removeOk = await this.executePackageCommand(["remove", removeSource], {
			scope: "global",
			appendLocalFlag: false,
			statusText: `Removing ${removeSource}…`,
			refreshOnSuccess: false,
		});
		if (!removeOk) {
			if (changed) {
				this.commandStatus = `Installed ${SMART_NOTIFY_INSTALL_SOURCE}, but failed to remove legacy ${removeSource}.`;
			}
			return changed;
		}

		this.commandStatus = hasPreferred
			? `Removed legacy notifications package: ${removeSource}`
			: `Migrated notifications package to ${SMART_NOTIFY_INSTALL_SOURCE}.`;
		return true;
	}

	private async refreshPackageConfigCommands(): Promise<void> {
		const installedItems = this.getInstalledItems(false);
		if (installedItems.length === 0) {
			this.packageConfigCommands = new Map();
			return;
		}

		let commands: Array<Record<string, unknown>> = [];
		try {
			commands = await rpcBridge.getCommands();
		} catch {
			this.packageConfigCommands = new Map();
			return;
		}

		const bySource = new Map<string, PackageConfigCommand[]>();
		for (const item of installedItems) {
			const key = normalizeRecommendedSource(item.source);
			if (!bySource.has(key)) bySource.set(key, []);
		}

		for (const raw of commands) {
			const source = readString(raw.source).toLowerCase();
			const name = readString(raw.name);
			const baseDescription = readString(raw.description);
			const sourceInfo = readCommandSourceInfo(raw);
			if (source !== "extension" || !name) continue;
			const description = withExtensionCommandUsageHint(name, baseDescription);
			if (!isLikelyConfigCommand(name, description)) continue;

			const matchedPackage = this.findInstalledItemForCommand(
				{
					path: sourceInfo.path,
					sourceHint: sourceInfo.source,
					baseDir: sourceInfo.baseDir,
				},
				installedItems,
			);
			if (!matchedPackage) continue;

			const normalizedSource = normalizeRecommendedSource(matchedPackage.source);
			const list = bySource.get(normalizedSource);
			if (!list) continue;

			if (list.some((command) => command.name === name)) continue;
			list.push({
				name,
				description,
				path: sourceInfo.path || sourceInfo.baseDir,
			});
		}

		for (const list of bySource.values()) {
			list.sort((a, b) => a.name.localeCompare(b.name));
		}

		this.packageConfigCommands = bySource;
	}

	private matchesInstalledItemPath(path: string, item: InstalledDisplayItem): boolean {
		const normalizedPath = normalizeFsPath(path);
		if (!normalizedPath) return false;
		const normalizedLocation = normalizeFsPath(item.location);
		const locationMatches = normalizedLocation
			? normalizedPath === normalizedLocation || normalizedPath.startsWith(`${normalizedLocation}/`)
			: false;
		const npmFallbackMatches = !locationMatches && pathMatchesNpmPackage(normalizedPath, item.source);
		return locationMatches || npmFallbackMatches;
	}

	private findInstalledItemForCommand(
		meta: { path: string; sourceHint: string; baseDir: string },
		installedItems: InstalledDisplayItem[],
	): InstalledDisplayItem | null {
		const normalizedSourceHint = meta.sourceHint && meta.sourceHint.toLowerCase() !== "auto"
			? normalizeRecommendedSource(meta.sourceHint)
			: "";
		if (normalizedSourceHint) {
			const bySource = installedItems.find((item) => normalizeRecommendedSource(item.source) === normalizedSourceHint) ?? null;
			if (bySource) return bySource;
		}

		for (const candidatePath of [meta.path, meta.baseDir]) {
			if (!candidatePath) continue;
			for (const item of installedItems) {
				if (this.matchesInstalledItemPath(candidatePath, item)) return item;
			}
		}

		return null;
	}

	private toDiscoveredResourceItem(raw: Record<string, unknown>, installedItems: InstalledDisplayItem[]): DiscoveredResourceItem | null {
		const kind = readString(raw.source).toLowerCase();
		if (kind !== "prompt" && kind !== "skill") return null;
		const name = readString(raw.name);
		if (!name) return null;
		const description = readString(raw.description);
		const sourceInfo = readCommandSourceInfo(raw);
		const path = sourceInfo.path || sourceInfo.baseDir;
		const matchedPackage = this.findInstalledItemForCommand(
			{
				path,
				sourceHint: sourceInfo.source,
				baseDir: sourceInfo.baseDir,
			},
			installedItems,
		);
		const sourceInfoSource = sourceInfo.source && sourceInfo.source.toLowerCase() !== "auto" ? sourceInfo.source : "";
		const packageSource = matchedPackage?.source ?? (sourceInfoSource || null);
		const packageScope = matchedPackage?.scope ?? sourceInfo.scope;
		const packageDisplayName = matchedPackage?.displayName ?? (packageSource ? this.getDisplayName(packageSource) : null);
		const commandText = name.startsWith("/") ? name : `/${name}`;
		const idBase = `${kind}:${name}:${path || packageSource || sourceInfo.origin || "runtime"}`.toLowerCase();
		return {
			id: idBase,
			kind,
			name,
			description,
			commandText,
			path,
			origin: sourceInfo.origin || null,
			loaded: true,
			packageSource,
			packageScope,
			packageDisplayName,
			sourceKind: packageSource ? inferSourceKindFromSource(packageSource) : "unknown",
		};
	}

	private async listDirSafe(path: string): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }>> {
		try {
			const { exists, readDir } = await import("@tauri-apps/plugin-fs");
			if (!(await exists(path))) return [];
			return await readDir(path);
		} catch {
			return [];
		}
	}

	private async scanPromptResources(scope: "global" | "project"): Promise<DiscoveredResourceItem[]> {
		const root = this.resourceRootPath("prompt", scope);
		if (!root) return [];
		const entries = await this.listDirSafe(root);
		const out: DiscoveredResourceItem[] = [];
		for (const entry of entries) {
			if (!entry.isFile) continue;
			if (!entry.name.toLowerCase().endsWith(".md")) continue;
			const name = fileStem(entry.name).trim();
			if (!name) continue;
			const path = joinFsPath(root, entry.name);
			out.push({
				id: `prompt:${name}:${path}`.toLowerCase(),
				kind: "prompt",
				name,
				description: "Local prompt template",
				commandText: `/${name}`,
				path,
				origin: scope === "global" ? "user" : "project",
				loaded: false,
				packageSource: null,
				packageScope: scope === "global" ? "user" : "project",
				packageDisplayName: null,
				sourceKind: "local",
			});
		}
		return out;
	}

	private async scanSkillResources(scope: "global" | "project"): Promise<DiscoveredResourceItem[]> {
		const root = this.resourceRootPath("skill", scope);
		if (!root) return [];
		const out: DiscoveredResourceItem[] = [];
		const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
		while (queue.length > 0) {
			const next = queue.shift()!;
			if (next.depth > 5) continue;
			const entries = await this.listDirSafe(next.path);
			for (const entry of entries) {
				const fullPath = joinFsPath(next.path, entry.name);
				if (entry.isDirectory) {
					queue.push({ path: fullPath, depth: next.depth + 1 });
					continue;
				}
				if (!entry.isFile) continue;
				const lower = entry.name.toLowerCase();
				if (lower === "skill.md") {
					const skillName = pathBaseName(next.path).trim();
					if (!skillName) continue;
					out.push({
						id: `skill:${skillName}:${fullPath}`.toLowerCase(),
						kind: "skill",
						name: skillName,
						description: "Local skill",
						commandText: `/skill:${skillName}`,
						path: fullPath,
						origin: scope === "global" ? "user" : "project",
						loaded: false,
						packageSource: null,
						packageScope: scope === "global" ? "user" : "project",
						packageDisplayName: null,
						sourceKind: "local",
					});
					continue;
				}
				if (next.depth !== 0) continue;
				if (!lower.endsWith(".md")) continue;
				const skillName = fileStem(entry.name).trim();
				if (!skillName) continue;
				out.push({
					id: `skill:${skillName}:${fullPath}`.toLowerCase(),
					kind: "skill",
					name: skillName,
					description: "Local skill",
					commandText: `/skill:${skillName}`,
					path: fullPath,
					origin: scope === "global" ? "user" : "project",
					loaded: false,
					packageSource: null,
					packageScope: scope === "global" ? "user" : "project",
					packageDisplayName: null,
					sourceKind: "local",
				});
			}
		}
		return out;
	}

	private mergeDiscoveredResources(
		commandResources: DiscoveredResourceItem[],
		localResources: DiscoveredResourceItem[],
	): DiscoveredResourceItem[] {
		const merged = localResources.map((item) => this.normalizeResourceListItem(item));
		for (const item of commandResources) {
			const normalized = this.normalizeResourceListItem(item);
			const normalizedPath = normalizeFsPath(normalized.path);
			let matchIndex = normalizedPath
				? merged.findIndex((existing) => normalizeFsPath(existing.path) === normalizedPath)
				: -1;

			if (matchIndex === -1) {
				const nameMatches = merged
					.map((existing, index) => ({ existing, index }))
					.filter(({ existing }) => existing.kind === normalized.kind && existing.name === normalized.name);
				if (nameMatches.length === 1) {
					matchIndex = nameMatches[0].index;
				}
			}

			if (matchIndex === -1) {
				merged.push(normalized);
				continue;
			}

			const existing = merged[matchIndex];
			merged[matchIndex] = {
				...existing,
				...normalized,
				path: normalized.path || existing.path,
				description: normalized.description || existing.description,
				loaded: true,
				sourceKind: normalized.sourceKind === "unknown" ? existing.sourceKind : normalized.sourceKind,
				packageSource: normalized.packageSource ?? existing.packageSource,
				packageScope: normalized.packageScope ?? existing.packageScope,
				packageDisplayName: normalized.packageDisplayName ?? existing.packageDisplayName,
				origin: normalized.origin ?? existing.origin,
			};
		}
		return merged;
	}

	private async refreshDiscoveredResources(): Promise<void> {
		if (this.loadingResources) return;
		this.loadingResources = true;
		this.resourcesError = "";
		this.render();

		try {
			await this.ensureHomePath();
			const installedItems = this.getInstalledItems(false);

			let commands: Array<Record<string, unknown>> = [];
			try {
				commands = await rpcBridge.getCommands();
			} catch (err) {
				this.resourcesError = err instanceof Error ? err.message : String(err);
			}

			const commandResources = commands
				.map((raw) => this.toDiscoveredResourceItem(raw, installedItems))
				.filter((item): item is DiscoveredResourceItem => item !== null)
				.map((item) => ({ ...item, loaded: true }))
				.filter((item) => item.packageScope !== "project");

			const [globalPrompts, globalSkills, globalThemes] = await Promise.all([
				this.scanPromptResources("global"),
				this.scanSkillResources("global"),
				this.scanThemeResources(),
			]);
			const localResources = [...globalPrompts, ...globalSkills];
			const merged = this.mergeDiscoveredResources(commandResources, localResources);

			this.promptTemplateResources = uniqueBy(
				merged.filter((item) => item.kind === "prompt"),
				(item) => `${item.kind}:${item.name}:${normalizeFsPath(item.path) || item.packageScope || "runtime"}`.toLowerCase(),
			).sort((a, b) => a.name.localeCompare(b.name));

			this.skillResources = uniqueBy(
				merged.filter((item) => item.kind === "skill"),
				(item) => `${item.kind}:${item.name}:${normalizeFsPath(item.path) || item.packageScope || "runtime"}`.toLowerCase(),
			).sort((a, b) => a.name.localeCompare(b.name));

			this.themeResources = uniqueBy(
				globalThemes,
				(item) => `${item.id}:${normalizeFsPath(item.path)}`,
			).sort((a, b) => a.name.localeCompare(b.name));
			this.updateBundledThemeInstallStateFromResources(this.themeResources);
		} catch (err) {
			this.promptTemplateResources = [];
			this.skillResources = [];
			this.themeResources = [];
			this.resourcesError = err instanceof Error ? err.message : String(err);
		} finally {
			this.loadingResources = false;
			this.render();
		}
	}

	private packageConfigCommandKey(source: string, commandName: string): string {
		return `${normalizeRecommendedSource(source)}::${commandName.trim().toLowerCase()}`;
	}

	private packageConfigStorageKey(source: string, commandName: string): string {
		const normalized = normalizeRecommendedSource(source);
		return `pi.packages.configArg.v1::${normalized}::${commandName.trim().toLowerCase()}`;
	}

	private getPackageConfigCommandArg(source: string, commandName: string): string {
		const normalizedCommand = commandName.trim().toLowerCase();
		const variants = uniqueBy(
			[normalizedCommand, normalizedCommand.startsWith("/") ? normalizedCommand.slice(1) : `/${normalizedCommand}`],
			(value) => value,
		);

		for (const variant of variants) {
			const key = this.packageConfigCommandKey(source, variant);
			if (this.packageConfigCommandArgs.has(key)) return (this.packageConfigCommandArgs.get(key) || "").trim();
		}

		// Fallback to localStorage for persisted values
		try {
			for (const variant of variants) {
				const storageKey = this.packageConfigStorageKey(source, variant);
				const stored = localStorage.getItem(storageKey);
				if (stored && stored.trim()) {
					const trimmed = stored.trim();
					for (const syncVariant of variants) {
						this.packageConfigCommandArgs.set(this.packageConfigCommandKey(source, syncVariant), trimmed);
					}
					return trimmed;
				}
			}
		} catch {
			// ignore storage errors
		}
		return "";
	}

	private setPackageConfigCommandArg(source: string, commandName: string, value: string): void {
		const normalizedCommand = commandName.trim().toLowerCase();
		const variants = uniqueBy(
			[normalizedCommand, normalizedCommand.startsWith("/") ? normalizedCommand.slice(1) : `/${normalizedCommand}`],
			(v) => v,
		);
		const trimmed = value.trim();
		if (!trimmed) {
			for (const variant of variants) {
				this.packageConfigCommandArgs.delete(this.packageConfigCommandKey(source, variant));
				try {
					localStorage.removeItem(this.packageConfigStorageKey(source, variant));
				} catch {
					// ignore
				}
			}
			return;
		}
		for (const variant of variants) {
			this.packageConfigCommandArgs.set(this.packageConfigCommandKey(source, variant), trimmed);
			try {
				localStorage.setItem(this.packageConfigStorageKey(source, variant), trimmed);
			} catch {
				// ignore
			}
		}
	}

	private mapModelOptions(models: Array<Record<string, unknown>>): ModelOption[] {
		const mapped: ModelOption[] = [];
		const seen = new Set<string>();
		for (const raw of models) {
			const provider = typeof raw.provider === "string"
				? raw.provider.trim()
				: typeof raw.providerId === "string"
					? raw.providerId.trim()
					: typeof raw.provider_id === "string"
						? raw.provider_id.trim()
						: "";
			const id = typeof raw.id === "string"
				? raw.id.trim()
				: typeof raw.modelId === "string"
					? raw.modelId.trim()
					: typeof raw.model_id === "string"
						? raw.model_id.trim()
						: typeof raw.model === "string"
							? raw.model.trim()
							: "";
			if (!provider || !id) continue;
			const ref = modelRef(provider, id);
			if (seen.has(ref)) continue;
			seen.add(ref);
			mapped.push({ provider, id, label: ref });
		}
		return mapped.sort((a, b) => a.label.localeCompare(b.label));
	}

	private seedModelArgsForSource(source: string, commands: PackageConfigCommand[]): void {
		if (this.configModels.length === 0) return;
		const fallback = modelRef(this.configModels[0].provider, this.configModels[0].id);
		for (const command of commands) {
			if (!commandLikelyNeedsModelArg(command)) continue;
			const currentArg = this.getPackageConfigCommandArg(source, command.name); // checks localStorage fallback
			if (currentArg) continue;
			this.setPackageConfigCommandArg(source, command.name, fallback);
		}
	}

	private async ensureConfigModelsLoaded(force = false): Promise<void> {
		if (this.configModelsLoading) return;
		if (this.configModelsLoaded && !force) return;

		this.configModelsLoading = true;
		this.configModelsError = "";
		this.render();
		try {
			const models = await rpcBridge.getAvailableModels().catch(() => []);
			this.configModels = this.mapModelOptions(models as Array<Record<string, unknown>>);
			this.configModelsLoaded = true;

			if (this.activePackageConfigSource) {
				const commands = this.packageConfigCommands.get(this.activePackageConfigSource) ?? [];
				this.seedModelArgsForSource(this.activePackageConfigSource, commands);
			}
		} catch (err) {
			this.configModels = [];
			this.configModelsLoaded = true;
			this.configModelsError = err instanceof Error ? err.message : String(err);
		} finally {
			this.configModelsLoading = false;
			this.render();
		}
	}

	private getConfigCommandsForItem(item: InstalledDisplayItem): PackageConfigCommand[] {
		const normalizedSource = normalizeRecommendedSource(item.source);
		return this.packageConfigCommands.get(normalizedSource) ?? [];
	}

	private isNormalizedSourceInstalled(normalizedSource: string): boolean {
		return this.getInstalledItems(false).some((item) => normalizeRecommendedSource(item.source) === normalizedSource);
	}

	private isAutoRenameSource(source: string): boolean {
		const normalized = normalizeRecommendedSource(source);
		return normalized === AUTO_RENAME_PRIMARY_SOURCE || normalized === AUTO_RENAME_LEGACY_SOURCE;
	}

	private isAutoRenameConfigCommand(source: string, command: PackageConfigCommand): boolean {
		const normalizedName = normalizeCommandNameForMatch(command.name);
		if (AUTO_RENAME_COMMAND_NAMES.has(normalizedName)) return true;
		return this.isAutoRenameSource(source);
	}

	private resolveAutoRenameCommandForSource(source: string): PackageConfigCommand | null {
		const commands = this.packageConfigCommands.get(source) ?? [];
		for (const command of commands) {
			if (this.isAutoRenameConfigCommand(source, command)) return command;
		}
		return null;
	}

	private resolveGlobalAutoRenameConfigPath(): string {
		if (!this.homePath) return "";
		return joinFsPath(joinFsPath(joinFsPath(this.homePath, ".pi"), "agent"), "auto-rename.json");
	}

	private resolveProjectOptionForPath(path: string): PackageProjectOption | null {
		const normalized = normalizeFsPath(path);
		if (!normalized) return null;
		const sorted = [...this.autoRenameProjectOptions]
			.sort((a, b) => normalizeFsPath(b.path).length - normalizeFsPath(a.path).length);
		for (const option of sorted) {
			const projectPath = normalizeFsPath(option.path);
			if (!projectPath) continue;
			if (normalized === projectPath || normalized.startsWith(`${projectPath}/`)) {
				return option;
			}
		}
		return null;
	}

	private async findExistingProjectAutoRenameConfig(projectPath: string): Promise<{ path: string; scopeLabel: string } | null> {
		const normalizedProjectPath = projectPath.trim();
		if (!normalizedProjectPath) return null;
		const { exists } = await import("@tauri-apps/plugin-fs");
		const option = this.resolveProjectOptionForPath(normalizedProjectPath);
		const projectLabel = option?.name || pathBaseName(normalizedProjectPath) || "Project";
		const candidates = [
			joinFsPath(normalizedProjectPath, "auto-rename.json"),
			joinFsPath(joinFsPath(normalizedProjectPath, ".pi"), "auto-rename.json"),
		];
		for (const candidate of candidates) {
			try {
				if (await exists(candidate)) {
					return { path: candidate, scopeLabel: `Project · ${projectLabel}` };
				}
			} catch {
				// ignore path errors
			}
		}
		return null;
	}

	private async resolveProjectAutoRenameConfigPath(projectPath: string): Promise<{ path: string; scopeLabel: string }> {
		const normalizedProjectPath = projectPath.trim();
		if (!normalizedProjectPath) return { path: "", scopeLabel: "" };
		const existing = await this.findExistingProjectAutoRenameConfig(normalizedProjectPath);
		if (existing) return existing;
		const option = this.resolveProjectOptionForPath(normalizedProjectPath);
		const projectLabel = option?.name || pathBaseName(normalizedProjectPath) || "Project";
		return {
			path: joinFsPath(joinFsPath(normalizedProjectPath, ".pi"), "auto-rename.json"),
			scopeLabel: `Project · ${projectLabel}`,
		};
	}

	private applyAutoRenameScopeFromPath(path: string): void {
		const normalized = normalizeFsPath(path);
		const globalPath = normalizeFsPath(this.resolveGlobalAutoRenameConfigPath());
		if (normalized && globalPath && normalized === globalPath) {
			this.autoRenameConfigSaveScope = "global";
			this.autoRenameConfigTargetProjectId = "";
			this.autoRenameConfigTargetProjectPath = "";
			return;
		}
		const projectOption = this.resolveProjectOptionForPath(path)
			?? this.autoRenameProjectOptions.find((item) => normalizeFsPath(item.path) === normalizeFsPath(this.currentProjectPath))
			?? this.autoRenameProjectOptions[0]
			?? null;
		if (projectOption) {
			this.autoRenameConfigSaveScope = "project";
			this.autoRenameConfigTargetProjectId = projectOption.id;
			this.autoRenameConfigTargetProjectPath = projectOption.path;
		}
	}

	private async resolveAutoRenameConfigPathPreference(options?: {
		scope?: "global" | "project";
		projectPath?: string | null;
	}): Promise<{ path: string; scopeLabel: string }> {
		await this.ensureHomePath();
		this.refreshAutoRenameProjectOptions();

		const requestedScope = options?.scope;
		const requestedProjectPath = options?.projectPath?.trim() || "";
		const globalPath = this.resolveGlobalAutoRenameConfigPath();

		if (requestedScope === "global") {
			return { path: globalPath, scopeLabel: "Global" };
		}

		if (requestedScope === "project") {
			const projectPath = requestedProjectPath || this.autoRenameConfigTargetProjectPath || this.currentProjectPath || "";
			if (!projectPath) {
				throw new Error("No project selected for project-scoped auto-rename settings.");
			}
			return await this.resolveProjectAutoRenameConfigPath(projectPath);
		}

		const preferredProjectPaths = uniqueBy(
			[this.autoRenameConfigTargetProjectPath, this.currentProjectPath || ""].filter((entry) => entry && entry.trim().length > 0),
			(entry) => normalizeFsPath(entry),
		);
		for (const projectPath of preferredProjectPaths) {
			const existing = await this.findExistingProjectAutoRenameConfig(projectPath);
			if (existing) return existing;
		}

		if (globalPath) {
			const { exists } = await import("@tauri-apps/plugin-fs");
			try {
				if (await exists(globalPath)) {
					return { path: globalPath, scopeLabel: "Global" };
				}
			} catch {
				// ignore exists errors
			}
		}

		if (preferredProjectPaths.length > 0) {
			return await this.resolveProjectAutoRenameConfigPath(preferredProjectPaths[0]);
		}
		if (globalPath) {
			return { path: globalPath, scopeLabel: "Global" };
		}
		return { path: "", scopeLabel: "" };
	}

	private async ensureAutoRenameConfigLoaded(
		source: string,
		force = false,
		options?: { scope?: "global" | "project"; projectPath?: string | null },
	): Promise<void> {
		const normalizedSource = normalizeRecommendedSource(source);
		const preferred = await this.resolveAutoRenameConfigPathPreference(options);
		if (!force && this.autoRenameConfigLoadedSource === normalizedSource && normalizeFsPath(this.autoRenameConfigPath) === normalizeFsPath(preferred.path)) {
			return;
		}
		if (this.autoRenameConfigLoading) return;
		this.autoRenameConfigLoading = true;
		this.autoRenameConfigError = "";
		this.render();
		try {
			this.autoRenameConfigPath = preferred.path;
			this.autoRenameConfigScopeLabel = preferred.scopeLabel;
			this.autoRenameConfigRaw = {};
			this.autoRenameConfig = defaultAutoRenameConfigDraft();

			if (preferred.path) {
				const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
				if (await exists(preferred.path)) {
					const rawText = await readTextFile(preferred.path);
					const parsedUnknown = JSON.parse(rawText) as unknown;
					if (parsedUnknown && typeof parsedUnknown === "object" && !Array.isArray(parsedUnknown)) {
						const parsed = parsedUnknown as Record<string, unknown>;
						this.autoRenameConfigRaw = parsed;
						this.autoRenameConfig = normalizeAutoRenameConfigDraft(parsed);
					}
				}
			}
			this.applyAutoRenameScopeFromPath(preferred.path);
			if (options?.scope === "project" && options.projectPath?.trim()) {
				const selected = this.resolveProjectOptionForPath(options.projectPath.trim());
				if (selected) {
					this.autoRenameConfigTargetProjectId = selected.id;
					this.autoRenameConfigTargetProjectPath = selected.path;
				}
			}
			if (options?.scope === "global") {
				this.autoRenameConfigSaveScope = "global";
			}
			this.autoRenameConfigLoadedSource = normalizedSource;
		} catch (err) {
			this.autoRenameConfigRaw = {};
			this.autoRenameConfig = defaultAutoRenameConfigDraft();
			this.autoRenameConfigError = err instanceof Error ? err.message : String(err);
		} finally {
			this.autoRenameConfigLoading = false;
			this.render();
		}
	}

	private async setAutoRenameSaveScope(source: string, scope: "global" | "project"): Promise<void> {
		this.autoRenameConfigSaveScope = scope;
		if (scope === "project") {
			this.refreshAutoRenameProjectOptions();
			const selected = this.autoRenameProjectOptions.find((item) => item.id === this.autoRenameConfigTargetProjectId)
				?? this.autoRenameProjectOptions.find((item) => normalizeFsPath(item.path) === normalizeFsPath(this.currentProjectPath))
				?? this.autoRenameProjectOptions[0]
				?? null;
			if (!selected) {
				this.autoRenameConfigError = "No opened project is available for project-scoped save.";
				this.render();
				return;
			}
			this.autoRenameConfigTargetProjectId = selected.id;
			this.autoRenameConfigTargetProjectPath = selected.path;
			await this.ensureAutoRenameConfigLoaded(source, true, { scope: "project", projectPath: selected.path });
			return;
		}
		this.autoRenameConfigTargetProjectId = "";
		this.autoRenameConfigTargetProjectPath = "";
		await this.ensureAutoRenameConfigLoaded(source, true, { scope: "global" });
	}

	private async setAutoRenameTargetProject(source: string, projectId: string): Promise<void> {
		const selected = this.autoRenameProjectOptions.find((item) => item.id === projectId) ?? null;
		if (!selected) return;
		this.autoRenameConfigTargetProjectId = selected.id;
		this.autoRenameConfigTargetProjectPath = selected.path;
		this.autoRenameConfigSaveScope = "project";
		await this.ensureAutoRenameConfigLoaded(source, true, { scope: "project", projectPath: selected.path });
	}

	private setAutoRenameConfigField<K extends keyof AutoRenameConfigDraft>(key: K, value: AutoRenameConfigDraft[K]): void {
		this.autoRenameConfig = {
			...this.autoRenameConfig,
			[key]: value,
		};
		this.render();
	}

	private async saveAutoRenameConfig(source: string): Promise<void> {
		if (this.autoRenameConfigSaving || this.runningConfigCommand || this.runningCommand) return;
		this.autoRenameConfigSaving = true;
		this.autoRenameConfigError = "";
		this.packageConfigStatus = "Saving auto-rename settings…";
		this.render();
		try {
			const targetScope = this.autoRenameConfigSaveScope;
			const targetProjectPath = targetScope === "project" ? this.autoRenameConfigTargetProjectPath : "";
			if (targetScope === "project" && !targetProjectPath) {
				throw new Error("Choose a project for project-scoped save.");
			}
			const preferred = await this.resolveAutoRenameConfigPathPreference({
				scope: targetScope,
				projectPath: targetProjectPath,
			});
			const configPath = preferred.path;
			const scopeLabel = preferred.scopeLabel;
			this.autoRenameConfigPath = configPath;
			this.autoRenameConfigScopeLabel = scopeLabel;
			if (!configPath) {
				throw new Error("Could not resolve auto-rename config path.");
			}

			const primaryModelValue = this.autoRenameConfig.model.trim();
			const fallbackModelValue = this.autoRenameConfig.fallbackModel.trim();
			const primaryModel = primaryModelValue ? splitModelRef(primaryModelValue) : null;
			const fallbackModel = fallbackModelValue ? splitModelRef(fallbackModelValue) : null;

			if (primaryModelValue && !primaryModel) {
				throw new Error("Primary model must use provider/model format.");
			}
			if (fallbackModelValue && !fallbackModel) {
				throw new Error("Fallback model must use provider/model format.");
			}

			const nextDoc: Record<string, unknown> = {
				...this.autoRenameConfigRaw,
				$schema: readString(this.autoRenameConfigRaw.$schema) || AUTO_RENAME_SCHEMA_RELATIVE,
				model: primaryModel ? { provider: primaryModel.provider, id: primaryModel.id } : null,
				fallbackModel: fallbackModel ? { provider: fallbackModel.provider, id: fallbackModel.id } : null,
				modelSelection: this.autoRenameConfig.modelSelection,
				fallbackDeterministic: this.autoRenameConfig.fallbackDeterministic,
				prefix: this.autoRenameConfig.prefix,
				prefixCommand: this.autoRenameConfig.prefixCommand.trim() ? this.autoRenameConfig.prefixCommand.trim() : null,
				prefixOnly: this.autoRenameConfig.prefixOnly,
				readableIdSuffix: this.autoRenameConfig.readableIdSuffix,
				enabled: this.autoRenameConfig.enabled,
				debug: this.autoRenameConfig.debug,
			};

			const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
			await mkdir(pathDirName(configPath), { recursive: true });
			await writeTextFile(configPath, `${JSON.stringify(nextDoc, null, 2)}\n`);

			this.autoRenameConfigRaw = nextDoc;
			this.autoRenameConfigLoadedSource = normalizeRecommendedSource(source);
			this.packageConfigStatus = `Saved auto-rename settings to ${configPath}${scopeLabel ? ` (${scopeLabel})` : ""}.`;
			this.commandStatus = "Saved auto-rename settings.";
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.autoRenameConfigError = message;
			this.packageConfigStatus = `Failed to save auto-rename settings: ${message}`;
			this.commandStatus = `Auto-rename settings failed: ${message}`;
		} finally {
			this.autoRenameConfigSaving = false;
			this.render();
		}
	}

	private async openPackageConfig(item: InstalledDisplayItem): Promise<void> {
		const source = normalizeRecommendedSource(item.source);
		const commands = this.getConfigCommandsForItem(item);
		this.activePackageConfigSource = source;
		this.activePackageConfigLabel = item.displayName;
		this.packageConfigStatus = "";
		if (this.configModelsLoaded) {
			this.seedModelArgsForSource(source, commands);
		}
		if (commands.some((command) => commandLikelyNeedsModelArg(command))) {
			void this.ensureConfigModelsLoaded();
		}
		// attempt to read existing package config files and seed args from disk (native only)
		void this.loadPackageConfigFromPackage(source, commands).catch(() => {});
		this.render();
	}

	async openExtensionConfigBySource(source: string): Promise<boolean> {
		const normalized = normalizeRecommendedSource(source);
		const installed = this.findInstalledItemForSource(normalized, "global");
		if (!installed) return false;
		const item: ExtensionSurfaceItem = {
			id: `installed:${normalized}`,
			displayName: installed.displayName,
			source: installed.source,
			description: "Installed extension package",
			note: installed.location || installed.source,
			openUrl: installed.openUrl,
			sourceKind: inferSourceKindFromSource(installed.source),
			installState: this.extensionInstallState(installed.source),
			installedItemForScope: installed,
		};
		await this.openPackagesItemModal({ kind: "extension", item });
		return true;
	}

	private async findInstalledItemForExtensionCommand(commandName: string): Promise<InstalledDisplayItem | null> {
		const normalizedCommand = normalizeCommandNameForMatch(commandName);
		if (!normalizedCommand) return null;
		const installedItems = this.getInstalledItems(false);
		if (installedItems.length === 0) return null;

		let commands: Array<Record<string, unknown>> = [];
		try {
			commands = await rpcBridge.getCommands();
		} catch {
			return null;
		}

		for (const raw of commands) {
			const source = readString(raw.source).toLowerCase();
			const name = readString(raw.name);
			if (source !== "extension" || !name) continue;
			if (!commandNamesMatch(name, normalizedCommand)) continue;

			const sourceInfo = readCommandSourceInfo(raw);
			const matchedPackage = this.findInstalledItemForCommand(
				{
					path: sourceInfo.path,
					sourceHint: sourceInfo.source,
					baseDir: sourceInfo.baseDir,
				},
				installedItems,
			);
			if (matchedPackage) return matchedPackage;
		}

		return null;
	}

	private ensureSyntheticExtensionConfigCommand(
		source: string,
		commandName: string,
		args: string,
		installed: InstalledDisplayItem | null,
	): void {
		const normalizedSource = normalizeRecommendedSource(source);
		const normalizedCommand = normalizeCommandNameForMatch(commandName);
		if (!normalizedSource || !normalizedCommand) return;

		const currentCommands = [...(this.packageConfigCommands.get(normalizedSource) ?? [])];
		if (!currentCommands.some((command) => commandNamesMatch(command.name, normalizedCommand))) {
			const hintedDescription = withExtensionCommandUsageHint(
				normalizedCommand,
				"Run extension config command",
			);
			currentCommands.push({
				name: normalizedCommand,
				description: hintedDescription,
				path: installed?.location || "",
			});
			currentCommands.sort((a, b) => a.name.localeCompare(b.name));
			this.packageConfigCommands.set(normalizedSource, currentCommands);
		}

		if (args.trim()) {
			this.setPackageConfigCommandArg(normalizedSource, normalizedCommand, args.trim());
		}
	}

	async openExtensionConfigByCommand(commandName: string, args = ""): Promise<boolean> {
		const normalizedCommand = normalizeCommandNameForMatch(commandName);
		if (!normalizedCommand) return false;

		if (!isExtensionConfigIntent(normalizedCommand, args)) return false;

		await this.refreshPackageConfigCommands();

		for (const [source, commands] of this.packageConfigCommands.entries()) {
			if (!commands.some((command) => commandNamesMatch(command.name, normalizedCommand))) continue;
			if (args.trim()) {
				this.setPackageConfigCommandArg(source, normalizedCommand, args.trim());
			}
			return await this.openExtensionConfigBySource(source);
		}

		const installed = await this.findInstalledItemForExtensionCommand(normalizedCommand);
		if (installed) {
			const source = normalizeRecommendedSource(installed.source);
			this.ensureSyntheticExtensionConfigCommand(source, normalizedCommand, args, installed);
			return await this.openExtensionConfigBySource(source);
		}

		const heuristicMatches = this.getInstalledItems(false).filter((item) => {
			const normalizedSource = normalizeRecommendedSource(item.source);
			const sourceName = normalizedSource.startsWith("npm:") ? normalizedSource.slice(4) : normalizedSource;
			const sourceTail = sourceName.split("/").filter(Boolean).pop() || sourceName;
			const display = item.displayName.toLowerCase();
			return display.includes(normalizedCommand) || sourceName.includes(normalizedCommand) || sourceTail.includes(normalizedCommand);
		});
		if (heuristicMatches.length === 1) {
			const match = heuristicMatches[0];
			const source = normalizeRecommendedSource(match.source);
			this.ensureSyntheticExtensionConfigCommand(source, normalizedCommand, args, match);
			return await this.openExtensionConfigBySource(source);
		}

		return false;
	}

	async openExtensionConfigByProvider(provider: string): Promise<boolean> {
		const providerToken = normalizeCommandNameForMatch(provider);
		if (!providerToken) return false;
		await this.refreshPackageConfigCommands();

		const tokenParts = providerToken.split(/[-_.]/).filter((part) => part.length > 1);
		const scoreText = (value: string): number => {
			const haystack = value.toLowerCase();
			let score = 0;
			if (haystack.includes(providerToken)) score += 6;
			for (const part of tokenParts) {
				if (haystack.includes(part)) score += 1;
			}
			return score;
		};

		let bestSource: string | null = null;
		let bestScore = 0;
		for (const item of this.getInstalledItems(false)) {
			const normalizedSource = normalizeRecommendedSource(item.source);
			const sourceName = normalizedSource.startsWith("npm:") ? normalizedSource.slice(4) : normalizedSource;
			const sourceTail = sourceName.split("/").filter(Boolean).pop() || sourceName;
			const commands = this.packageConfigCommands.get(normalizedSource) ?? [];
			let score = 0;
			score += scoreText(item.displayName);
			score += scoreText(sourceName);
			score += scoreText(sourceTail);
			for (const command of commands) {
				score += scoreText(command.name) * 2;
				score += scoreText(command.description);
			}
			if (commands.length > 0) score += 1;
			if (score > bestScore) {
				bestScore = score;
				bestSource = normalizedSource;
			}
		}

		if (!bestSource || bestScore <= 0) return false;
		return await this.openExtensionConfigBySource(bestSource);
	}

	private closeActivePackageConfig(): void {
		this.activePackageConfigSource = null;
		this.activePackageConfigLabel = "";
		this.packageConfigStatus = "";
		this.render();
	}

	private async loadPackageConfigFromPackage(source: string, commands: PackageConfigCommand[]): Promise<void> {
		if (commands.length === 0) return;
		try {
			const installed = this.findInstalledItemForSource(source, "global");
			await this.ensureHomePath();
			const { exists, readTextFile, readDir, stat } = await import("@tauri-apps/plugin-fs");
			const pkgName = this.getDisplayName(source);
			const npmName = npmPackageNameFromSource(source) || pkgName;

			const roots = uniqueBy(
				[
					this.homePath ? joinFsPath(joinFsPath(joinFsPath(this.homePath, ".pi"), "agent"), "extensions") : "",
					...commands.map((command) => command.path?.trim() || ""),
					installed?.location?.trim() || "",
				].filter((value): value is string => Boolean(value)),
				(value) => normalizeFsPath(value),
			);

			const candidates: string[] = [];
			const addCandidate = (path: string) => {
				if (!path) return;
				if (!candidates.includes(path)) candidates.push(path);
			};

			for (const root of roots) {
				let dir = root;
				try {
					if (await exists(root)) {
						const info = await stat(root).catch(() => null);
						if (info?.isFile) {
							if (root.toLowerCase().endsWith(".json")) addCandidate(root);
							dir = pathDirName(root);
						} else if (!info?.isDirectory) {
							continue;
						}
					} else if (/\.[a-z0-9]+$/i.test(root)) {
						dir = pathDirName(root);
					}
				} catch {
					continue;
				}

				const preferred = [
					joinFsPath(dir, `${pkgName}.json`),
					joinFsPath(dir, `${npmName}.json`),
					joinFsPath(dir, "pi-package-config.json"),
				];
				for (const filePath of preferred) {
					if (await exists(filePath)) addCandidate(filePath);
				}

				try {
					const entries = await readDir(dir);
					for (const entry of entries) {
						if (entry && typeof entry.name === "string" && entry.name.toLowerCase().endsWith(".json")) {
							addCandidate(joinFsPath(dir, entry.name));
						}
					}
				} catch {
					// ignore readDir errors for this root
				}
			}

			const seeded = new Set<string>();
			let loadedFromPath = "";
			let loadedModelValue = "";
			for (const filePath of candidates) {
				try {
					const txt = await readTextFile(filePath);
					const parsedUnknown = JSON.parse(txt) as unknown;
					if (!parsedUnknown || typeof parsedUnknown !== "object" || Array.isArray(parsedUnknown)) continue;
					const parsed = parsedUnknown as Record<string, unknown>;
					const modelFromObject = readModelRefFromConfigObject(parsed);

					for (const command of commands) {
						const commandId = command.name.trim().toLowerCase();
						if (seeded.has(commandId)) continue;
						const key = command.name.startsWith("/") ? command.name.slice(1) : command.name;
						let value = "";

						if (typeof parsed[key] === "string") {
							value = String(parsed[key]).trim();
						}

						if (!value && commandLikelyNeedsModelArg(command)) {
							if (modelFromObject) {
								value = modelFromObject;
							} else {
								for (const k of Object.keys(parsed)) {
									if (!/model|name-ai-config|auto-rename/i.test(k)) continue;
									const raw = parsed[k];
									if (typeof raw === "string" && raw.trim()) {
										value = raw.trim();
										break;
									}
								}
							}
						}

						if (!value) continue;
						this.setPackageConfigCommandArg(source, command.name, value);
						seeded.add(commandId);
						if (!loadedFromPath && commandLikelyNeedsModelArg(command)) {
							loadedFromPath = filePath;
							loadedModelValue = value;
						}
					}
				} catch {
					// ignore parse/read errors for this file
				}
			}
			if (loadedFromPath) {
				if (loadedModelValue) {
					this.packageConfigLoadedModelBySource.set(normalizeRecommendedSource(source), loadedModelValue);
				}
				this.packageConfigStatus = `Loaded package model ${loadedModelValue || "(unknown)"} from ${loadedFromPath}.`;
			} else if (commands.some((command) => commandLikelyNeedsModelArg(command))) {
				this.packageConfigLoadedModelBySource.delete(normalizeRecommendedSource(source));
				this.packageConfigStatus = "No saved model found on disk. Using package default.";
			}
			this.render();
		} catch {
			// ignore errors
		}
	}

	private async runPackageConfigCommand(command: PackageConfigCommand, args = ""): Promise<void> {
		if (this.runningConfigCommand || this.runningCommand) return;
		this.runningConfigCommand = true;
		const slashCommand = command.name.startsWith("/") ? command.name : `/${command.name}`;
		const trimmedArgs = args.trim();
		const promptText = trimmedArgs ? `${slashCommand} ${trimmedArgs}` : slashCommand;
		const supportsModelPicker = commandLikelyNeedsModelArg(command);
		const parsedModelArg = splitModelRef(trimmedArgs);
		const isModelSave = supportsModelPicker && Boolean(parsedModelArg || !trimmedArgs);
		const actionVerb = isModelSave ? "save" : "run";
		const actionVerbPast = isModelSave ? "Saved" : "Ran";
		this.packageConfigStatus = `${actionVerb[0].toUpperCase()}${actionVerb.slice(1)} package setting…`;
		this.render();
		try {
			await rpcBridge.prompt(promptText);
			this.packageConfigStatus = `${actionVerbPast} package setting.`;
			this.commandStatus = `${actionVerbPast} package setting for ${this.activePackageConfigLabel || "package"}.`;
			this.commandOutput += `${this.commandOutput ? "\n" : ""}[package-config] ${promptText}\n`;

			if (supportsModelPicker && this.activePackageConfigSource && parsedModelArg) {
				this.packageConfigLoadedModelBySource.set(normalizeRecommendedSource(this.activePackageConfigSource), trimmedArgs);
			}

			// Persist model-picker changes to canonical extension config file when possible.
			if (supportsModelPicker && this.activePackageConfigSource && parsedModelArg) {
				try {
					const normalized = this.activePackageConfigSource;
					const installed = this.findInstalledItemForSource(normalized, "global");
					const basePath = installed?.location?.trim() || command.path?.trim() || "";
					const key = command.name.startsWith("/") ? command.name.slice(1) : command.name;
					const parsedModel = parsedModelArg;
					const pkgName = this.getDisplayName(normalized);
					await this.ensureHomePath();
					const { exists, readTextFile, writeTextFile, stat, mkdir } = await import("@tauri-apps/plugin-fs");
					const writtenPaths: string[] = [];
					const writeErrors: string[] = [];

					// 1) Canonical extension config (~/.pi/agent/extensions/<package>.json)
					if (parsedModel && this.homePath) {
						try {
							const extensionsDir = joinFsPath(joinFsPath(joinFsPath(this.homePath, ".pi"), "agent"), "extensions");
							const extensionConfigPath = joinFsPath(extensionsDir, `${pkgName}.json`);
							await mkdir(extensionsDir, { recursive: true });
							let existing: Record<string, unknown> = {};
							if (await exists(extensionConfigPath)) {
								try {
									const raw = JSON.parse(await readTextFile(extensionConfigPath)) as unknown;
									if (raw && typeof raw === "object" && !Array.isArray(raw)) {
										existing = raw as Record<string, unknown>;
									}
								} catch {
									// ignore invalid json and overwrite with valid structure
								}
							}
							existing.provider = parsedModel.provider;
							existing.id = parsedModel.id;
							await writeTextFile(extensionConfigPath, `${JSON.stringify(existing, null, 2)}\n`);
							writtenPaths.push(extensionConfigPath);
						} catch (err) {
							writeErrors.push(err instanceof Error ? err.message : String(err));
						}
					}

					// 2) Package-local fallback file (keeps previous behavior)
					if (basePath) {
						try {
							let baseDir = basePath;
							if (await exists(baseDir)) {
								const info = await stat(baseDir).catch(() => null);
								if (info?.isFile) baseDir = pathDirName(baseDir);
							}
							const configPath = joinFsPath(baseDir, "pi-package-config.json");
							let existing: Record<string, unknown> = {};
							if (await exists(configPath)) {
								try {
									const raw = JSON.parse(await readTextFile(configPath)) as unknown;
									if (raw && typeof raw === "object" && !Array.isArray(raw)) {
										existing = raw as Record<string, unknown>;
									}
								} catch {
									// ignore invalid json
								}
							}
							existing[key] = trimmedArgs;
							await writeTextFile(configPath, `${JSON.stringify(existing, null, 2)}\n`);
							writtenPaths.push(configPath);
						} catch (err) {
							writeErrors.push(err instanceof Error ? err.message : String(err));
						}
					}

					if (writtenPaths.length > 0) {
						this.packageConfigStatus = `${actionVerbPast} package setting and saved to ${writtenPaths.join(" · ")}.`;
					} else if (writeErrors.length > 0) {
						this.packageConfigStatus = `${actionVerbPast} package setting (failed to persist file: ${writeErrors.join("; ")})`;
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					this.packageConfigStatus = `${actionVerbPast} package setting (failed to persist file: ${message})`;
				}
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.packageConfigStatus = `Failed to ${actionVerb} package setting: ${message}`;
			this.commandStatus = `Config command failed: ${message}`;
		} finally {
			this.runningConfigCommand = false;
			this.render();
		}
	}

	private renderPackageConfigCommandEditor(source: string, command: PackageConfigCommand): TemplateResult {
		if (this.isAutoRenameConfigCommand(source, command)) {
			return this.renderAutoRenameConfigEditor(source, command);
		}
		const supportsModelPicker = commandLikelyNeedsModelArg(command);
		const normalizedCommandName = normalizeCommandNameForMatch(command.name);
		const isSmartNotifyCommand = SMART_NOTIFY_COMMAND_NAMES.has(normalizedCommandName);
		const sourceLoadedModel = this.packageConfigLoadedModelBySource.get(normalizeRecommendedSource(source)) || "";
		const currentArgs = this.getPackageConfigCommandArg(source, command.name) || (supportsModelPicker ? sourceLoadedModel : "");
		const selectedModel = this.configModels.some((model) => modelRef(model.provider, model.id) === currentArgs) ? currentArgs : "";
		const modelSelectValue = selectedModel || currentArgs || "";
		const title = command.description?.trim() || "Package setting";
		const defaultDescription = supportsModelPicker ? "Choose model and save." : "Apply command arguments.";
		const commandDescription = isSmartNotifyCommand && !supportsModelPicker
			? "No args opens settings. Add args to run slash subcommands directly."
			: defaultDescription;
		const argsPlaceholder = isSmartNotifyCommand
			? "status | reload | on | off | test idle|permission|question|error"
			: "Optional command arguments";
		const buttonLabel = supportsModelPicker ? "Save" : "Apply";
		const buttonBusyLabel = supportsModelPicker ? "Saving…" : "Applying…";

		return html`
			<div class="packages-config-command-card">
				<div class="packages-config-command-name">${title}</div>
				<div class="packages-config-command-desc">${commandDescription}</div>
				${isSmartNotifyCommand && !supportsModelPicker
					? html`<div class="packages-section-submeta">Examples: status · reload · on · off · test idle|permission|question|error</div>`
					: nothing}

				${supportsModelPicker
					? html`
						<div class="packages-config-field">
							<label class="packages-config-field-label">Model</label>
							<select
								class="packages-config-select"
								.value=${modelSelectValue}
								?disabled=${this.configModelsLoading || this.runningConfigCommand || this.runningCommand}
								@change=${(event: Event) => {
									const value = (event.target as HTMLSelectElement).value;
									this.setPackageConfigCommandArg(source, command.name, value);
									this.render();
								}}
							>
								${this.configModelsLoading ? html`<option value="" ?selected=${!modelSelectValue}>Loading models…</option>` : nothing}
								${!this.configModelsLoading ? html`<option value="" ?selected=${!modelSelectValue}>Use package default</option>` : nothing}
								${!this.configModelsLoading && currentArgs ? html`<option value=${currentArgs} ?selected=${modelSelectValue === currentArgs}>${currentArgs}</option>` : nothing}
								${this.configModels.map((model) => {
									const ref = modelRef(model.provider, model.id);
									return html`<option value=${ref} ?selected=${modelSelectValue === ref}>${model.label}</option>`;
								})}
							</select>
						</div>
					`
					: html`
						<div class="packages-config-field">
							<label class="packages-config-field-label">Arguments</label>
							<input
								class="packages-config-input"
								type="text"
								placeholder=${argsPlaceholder}
								.value=${currentArgs}
								?disabled=${this.runningConfigCommand || this.runningCommand}
								@input=${(event: Event) => {
									const value = (event.target as HTMLInputElement).value;
									this.setPackageConfigCommandArg(source, command.name, value);
									this.render();
								}}
							/>
						</div>
					`}

				<div class="packages-config-command-actions">
					<button
						class="ghost-btn"
						?disabled=${this.runningConfigCommand || this.runningCommand}
						@click=${() => void this.runPackageConfigCommand(command, this.getPackageConfigCommandArg(source, command.name))}
					>
						${this.runningConfigCommand ? buttonBusyLabel : buttonLabel}
					</button>
				</div>
			</div>
		`;
	}

	private renderAutoRenameConfigEditor(source: string, command: PackageConfigCommand): TemplateResult {
		const busy = this.runningConfigCommand || this.runningCommand || this.autoRenameConfigSaving;
		const modelOptions = this.configModels;
		const modelValue = this.autoRenameConfig.model;
		const fallbackModelValue = this.autoRenameConfig.fallbackModel;
		const usageHint = extensionCommandUsageHint(command.name) || "Args: config, test, init, regen, <name>";
		const supportsProjectScope = Boolean(this.currentProjectPath);
		const configScopeLabel = this.autoRenameConfigScopeLabel || (supportsProjectScope ? "Project (.pi)" : "Global");
		const projectOptions = this.autoRenameProjectOptions;
		const canUseProjectScope = projectOptions.length > 0;
		const saveScope = this.autoRenameConfigSaveScope;
		const activeProjectTarget = projectOptions.find((item) => item.id === this.autoRenameConfigTargetProjectId)
			?? projectOptions.find((item) => normalizeFsPath(item.path) === normalizeFsPath(this.autoRenameConfigTargetProjectPath))
			?? null;
		const hasPrimaryModel = modelValue.trim().length > 0;
		const hasFallbackModel = fallbackModelValue.trim().length > 0;
		const primaryInOptions = modelOptions.some((model) => modelRef(model.provider, model.id) === modelValue);
		const fallbackInOptions = modelOptions.some((model) => modelRef(model.provider, model.id) === fallbackModelValue);
		const hasExplicitModels = hasPrimaryModel || hasFallbackModel;
		const extensionDisabled = !this.autoRenameConfig.enabled;
		const prefixOnlyActive = this.autoRenameConfig.prefixOnly;

		const modelControlsDisabled = busy || extensionDisabled || prefixOnlyActive;
		const modeControlsDisabled = busy || extensionDisabled || prefixOnlyActive || hasExplicitModels;
		const basicControlsDisabled = busy || extensionDisabled;
		const targetProjectMissing = saveScope === "project" && !activeProjectTarget;
		const saveDisabled = busy || this.autoRenameConfigLoading || targetProjectMissing;

		const autoModeHelper = extensionDisabled
			? "Auto mode is disabled while auto-rename is turned off."
			: prefixOnlyActive
				? "Auto mode is disabled in prefix-only mode."
				: hasExplicitModels
					? "Auto mode is locked while Primary/Fallback model is set. Clear those to use auto mode."
					: this.autoRenameConfig.modelSelection === "current"
						? "Auto mode: use the currently selected chat model first."
						: "Auto mode: use the cheapest available model first.";

		const resolutionOrder = [
			hasPrimaryModel ? `Primary (${modelValue})` : null,
			hasFallbackModel ? `Fallback (${fallbackModelValue})` : null,
			`Auto (${this.autoRenameConfig.modelSelection})`,
		]
			.filter((entry): entry is string => Boolean(entry))
			.join(" → ");

		const boolSelect = (value: boolean): string => (value ? "true" : "false");

		return html`
			<div class="packages-config-command-card">
				<div class="packages-config-command-name">Auto-rename settings</div>
				<div class="packages-config-command-desc">${usageHint}</div>
				<div class="packages-section-submeta">Resolution order: ${resolutionOrder}</div>

				${this.autoRenameConfigLoading
					? html`<div class="packages-section-submeta">Loading auto-rename configuration…</div>`
					: html`
						<div class="packages-config-field-grid">
							<div class="packages-config-toggle-row ${busy ? "disabled" : ""}">
								<span class="packages-config-field-label">Enabled</span>
								<label class="packages-config-toggle-switch" aria-label="Enabled">
									<input
										type="checkbox"
										class="packages-config-toggle-input"
										?checked=${this.autoRenameConfig.enabled}
										?disabled=${busy}
										@change=${(event: Event) => {
											const value = (event.target as HTMLInputElement).checked;
											this.setAutoRenameConfigField("enabled", value);
										}}
									/>
									<span class="packages-config-toggle-slider"></span>
								</label>
							</div>
							<div class="packages-config-toggle-row ${busy || extensionDisabled ? "disabled" : ""}">
								<span class="packages-config-field-label">Prefix-only mode</span>
								<label class="packages-config-toggle-switch" aria-label="Prefix-only mode">
									<input
										type="checkbox"
										class="packages-config-toggle-input"
										?checked=${this.autoRenameConfig.prefixOnly}
										?disabled=${busy || extensionDisabled}
										@change=${(event: Event) => {
											const value = (event.target as HTMLInputElement).checked;
											this.setAutoRenameConfigField("prefixOnly", value);
										}}
									/>
									<span class="packages-config-toggle-slider"></span>
								</label>
							</div>
						</div>

						<div class="packages-config-field-grid">
							<div class="packages-config-field">
								<label class="packages-config-field-label">Primary model</label>
								<select
									class="packages-config-select"
									.value=${modelValue}
									?disabled=${modelControlsDisabled || this.configModelsLoading}
									@change=${(event: Event) => {
										const value = (event.target as HTMLSelectElement).value;
										this.setAutoRenameConfigField("model", value);
									}}
								>
									<option value="">None (use auto mode)</option>
									${hasPrimaryModel && !primaryInOptions ? html`<option value=${modelValue}>${modelValue} (saved)</option>` : nothing}
									${modelOptions.map((model) => {
										const ref = modelRef(model.provider, model.id);
										return html`<option value=${ref} ?selected=${modelValue === ref}>${model.label}</option>`;
									})}
								</select>
							</div>
							<div class="packages-config-field">
								<label class="packages-config-field-label">Fallback model</label>
								<select
									class="packages-config-select"
									.value=${fallbackModelValue}
									?disabled=${modelControlsDisabled || this.configModelsLoading}
									@change=${(event: Event) => {
										const value = (event.target as HTMLSelectElement).value;
										this.setAutoRenameConfigField("fallbackModel", value);
									}}
								>
									<option value="">None</option>
									${hasFallbackModel && !fallbackInOptions ? html`<option value=${fallbackModelValue}>${fallbackModelValue} (saved)</option>` : nothing}
									${modelOptions.map((model) => {
										const ref = modelRef(model.provider, model.id);
										return html`<option value=${ref} ?selected=${fallbackModelValue === ref}>${model.label}</option>`;
									})}
								</select>
							</div>
						</div>

						<div class="packages-config-field-grid">
							<div class="packages-config-field">
								<label class="packages-config-field-label">Auto mode</label>
								<select
									class="packages-config-select"
									.value=${this.autoRenameConfig.modelSelection}
									?disabled=${modeControlsDisabled}
									@change=${(event: Event) => {
										const value = (event.target as HTMLSelectElement).value === "cheapest" ? "cheapest" : "current";
										this.setAutoRenameConfigField("modelSelection", value);
									}}
								>
									<option value="current">Prefer current model</option>
									<option value="cheapest">Prefer cheapest model</option>
								</select>
							</div>
							<div class="packages-config-field">
								<label class="packages-config-field-label">Prefix</label>
								<input
									class="packages-config-input"
									type="text"
									placeholder="Optional static prefix"
									.value=${this.autoRenameConfig.prefix}
									?disabled=${basicControlsDisabled}
									@input=${(event: Event) => {
										const value = (event.target as HTMLInputElement).value;
										this.setAutoRenameConfigField("prefix", value);
									}}
								/>
							</div>
						</div>

						<div class="packages-section-submeta">${autoModeHelper}</div>

						<details class="packages-config-advanced">
							<summary>More options (optional)</summary>
							<div class="packages-config-field-grid">
								<div class="packages-config-field">
									<label class="packages-config-field-label">Deterministic fallback</label>
									<select
										class="packages-config-select"
										.value=${this.autoRenameConfig.fallbackDeterministic}
										?disabled=${busy || extensionDisabled || prefixOnlyActive}
										@change=${(event: Event) => {
											const value = (event.target as HTMLSelectElement).value as AutoRenameConfigDraft["fallbackDeterministic"];
											this.setAutoRenameConfigField("fallbackDeterministic", value);
										}}
									>
										<option value="readable-id">readable-id</option>
										<option value="words">words</option>
										<option value="truncate">truncate</option>
										<option value="none">none</option>
									</select>
								</div>
								<div class="packages-config-field">
									<label class="packages-config-field-label">Prefix command</label>
									<input
										class="packages-config-input"
										type="text"
										placeholder="Optional shell command"
										.value=${this.autoRenameConfig.prefixCommand}
										?disabled=${basicControlsDisabled}
										@input=${(event: Event) => {
											const value = (event.target as HTMLInputElement).value;
											this.setAutoRenameConfigField("prefixCommand", value);
										}}
									/>
								</div>
							</div>
							<div class="packages-config-field-grid">
								<div class="packages-config-field">
									<label class="packages-config-field-label">Readable-id suffix</label>
									<select
										class="packages-config-select"
										.value=${boolSelect(this.autoRenameConfig.readableIdSuffix)}
										?disabled=${basicControlsDisabled}
										@change=${(event: Event) => {
											const value = (event.target as HTMLSelectElement).value === "true";
											this.setAutoRenameConfigField("readableIdSuffix", value);
										}}
									>
										<option value="false">Off</option>
										<option value="true">On</option>
									</select>
								</div>
								<div class="packages-config-field">
									<label class="packages-config-field-label">Debug notifications</label>
									<select
										class="packages-config-select"
										.value=${boolSelect(this.autoRenameConfig.debug)}
										?disabled=${basicControlsDisabled}
										@change=${(event: Event) => {
											const value = (event.target as HTMLSelectElement).value === "true";
											this.setAutoRenameConfigField("debug", value);
										}}
									>
										<option value="false">Off</option>
										<option value="true">On</option>
									</select>
								</div>
							</div>
						</details>
					`}

				<div class="packages-config-command-actions">
					<div class="packages-config-save-inline">
						<span class="packages-config-field-label">Save to</span>
						<select
							class="packages-config-select"
							.value=${saveScope}
							?disabled=${busy}
							@change=${(event: Event) => {
								const value = (event.target as HTMLSelectElement).value === "project" ? "project" : "global";
								if (value === "project" && !canUseProjectScope) {
									this.autoRenameConfigError = "No opened projects available for project-scoped save.";
									this.render();
									return;
								}
								void this.setAutoRenameSaveScope(source, value);
							}}
						>
							<option value="global">Global</option>
							<option value="project" ?disabled=${!canUseProjectScope}>Project</option>
						</select>
						${saveScope === "project"
							? html`
								<select
									class="packages-config-select"
									.value=${activeProjectTarget?.id || ""}
									?disabled=${busy || !canUseProjectScope}
									@change=${(event: Event) => {
										const nextId = (event.target as HTMLSelectElement).value;
										void this.setAutoRenameTargetProject(source, nextId);
									}}
								>
									<option value="" ?selected=${!activeProjectTarget}>Select project…</option>
									${projectOptions.map((item) => html`<option value=${item.id} ?selected=${activeProjectTarget?.id === item.id}>${item.name}</option>`)}
								</select>
							`
							: nothing}
					</div>
					<button
						class="ghost-btn"
						?disabled=${saveDisabled}
						@click=${() => void this.saveAutoRenameConfig(source)}
					>
						${this.autoRenameConfigSaving ? "Saving…" : "Save settings"}
					</button>
					<button
						class="ghost-btn"
						?disabled=${this.runningConfigCommand || this.runningCommand || this.autoRenameConfigLoading}
						@click=${() => void this.runPackageConfigCommand(command, "config")}
					>
						Show config
					</button>
					<button
						class="ghost-btn"
						?disabled=${this.runningConfigCommand || this.runningCommand || this.autoRenameConfigLoading || extensionDisabled}
						@click=${() => void this.runPackageConfigCommand(command, "test")}
					>
						Run test
					</button>
				</div>

				${this.autoRenameConfigPath
					? html`<div class="packages-section-submeta">Config file: ${this.autoRenameConfigPath}${configScopeLabel ? ` (${configScopeLabel})` : ""}</div>`
					: nothing}
				${targetProjectMissing ? html`<div class="packages-config-inline-error">Choose a project for project-scoped save.</div>` : nothing}
				${this.autoRenameConfigError ? html`<div class="packages-config-inline-error">${this.autoRenameConfigError}</div>` : nothing}
			</div>
		`;
	}

	private renderPackageConfigModal(): TemplateResult | typeof nothing {
		if (!this.activePackageConfigSource) return nothing;
		const source = this.activePackageConfigSource;
		const commands = this.packageConfigCommands.get(source) ?? [];
		const hasModelCommand = commands.some((command) => commandLikelyNeedsModelArg(command));

		return html`
			<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.closeActivePackageConfig()}>
				<div class="overlay-card packages-config-modal">
					<div class="overlay-header">
						<div>
							<div class="packages-config-modal-title">Package settings · ${this.activePackageConfigLabel}</div>
							<div class="packages-config-modal-sub">Configure package capabilities directly from Packages.</div>
						</div>
						<button @click=${() => this.closeActivePackageConfig()}>✕</button>
					</div>
					<div class="overlay-body packages-config-modal-body">
						${commands.length === 0
							? html`
								<div class="packages-empty">
									No package config commands were discovered. This package appears to only add runtime capabilities.
								</div>
							`
							: commands.map((command) => this.renderPackageConfigCommandEditor(source, command))}

						<div class="packages-config-modal-actions">
							<button class="ghost-btn" ?disabled=${this.loadingConfig || this.runningCommand} @click=${() => void this.refreshPackages(false)}>
								Refresh package commands
							</button>
							${hasModelCommand
								? html`
									<button class="ghost-btn" ?disabled=${this.configModelsLoading || this.runningConfigCommand} @click=${() => void this.ensureConfigModelsLoaded(true)}>
										${this.configModelsLoading ? "Refreshing models…" : "Refresh models"}
									</button>
								`
								: nothing}
						</div>

						${this.configModelsError ? html`<div class="packages-config-inline-error">Model lookup failed: ${this.configModelsError}</div>` : nothing}
						${this.packageConfigStatus ? html`<div class="packages-section-submeta">${this.packageConfigStatus}</div>` : nothing}
					</div>
				</div>
			</div>
		`;
	}

	private getDisplayName(source: string): string {
		if (source.startsWith("npm:")) return source.slice(4);
		if (source.startsWith("git:")) return source.slice(4);
		if (source.startsWith("github:")) return source.slice(7);
		if (source.startsWith("file:")) return source.slice(5);
		return source;
	}

	private resolveSourceUrl(source: string): string | null {
		if (!source) return null;
		if (normalizeRecommendedSource(source) === DESKTOP_THEMES_PACKAGE_SOURCE) return DESKTOP_THEMES_DOC_URL;
		if (/^https?:\/\//i.test(source)) return source;
		if (source.startsWith("npm:")) return `https://www.npmjs.com/package/${source.slice(4)}`;
		if (source.startsWith("github:")) return `https://github.com/${source.slice(7).replace(/^\/+/, "")}`;
		if (source.startsWith("git:")) {
			const rest = source.slice(4).replace(/^\/+/, "");
			if (/^https?:\/\//i.test(rest)) return rest;
			if (/^[\w.-]+\/[\w./-]+(@.+)?$/i.test(rest)) return `https://${rest.replace(/@.+$/, "")}`;
			return `https://${rest}`;
		}
		if (/^[@a-z0-9][\w./-]*$/i.test(source)) return `https://www.npmjs.com/package/${source}`;
		return null;
	}

	private matchesRecommendedSource(installedSource: string, definition: RecommendedPackageDefinition): boolean {
		const normalizedInstalledSource = normalizeRecommendedSource(installedSource);
		const candidates = [definition.source, ...(definition.aliases ?? [])].map((value) => normalizeRecommendedSource(value));
		return candidates.includes(normalizedInstalledSource);
	}

	private getRecommendedInstallState(definition: RecommendedPackageDefinition): { global: boolean; project: boolean } {
		return {
			global: this.installedUser.some((item) => this.matchesRecommendedSource(item.source, definition)),
			project: false,
		};
	}

	private getInstalledItems(applyQuery = true): InstalledDisplayItem[] {
		const unique = uniqueBy(this.installedUser.map((item) => ({ ...item, scope: "user" as const })), (item) => `${item.scope}:${item.source}`)
			.map(
				(item) =>
					({
						...item,
						displayName: this.getDisplayName(item.source),
						openUrl: this.resolveSourceUrl(item.source),
					} satisfies InstalledDisplayItem),
			)
			.sort((a, b) => a.displayName.localeCompare(b.displayName));

		if (!applyQuery) return unique;
		const q = this.normalizeQuery();
		if (!q) return unique;
		return unique.filter((item) => `${item.displayName} ${item.source} ${item.location}`.toLowerCase().includes(q));
	}

	private filteredPromptTemplateResources(): DiscoveredResourceItem[] {
		const q = this.normalizeQuery();
		if (!q) return this.promptTemplateResources;
		return this.promptTemplateResources.filter((item) => {
			const haystack = `${item.name} ${item.description} ${item.commandText} ${item.packageSource ?? ""} ${item.path}`.toLowerCase();
			return haystack.includes(q);
		});
	}

	private filteredSkillResources(): DiscoveredResourceItem[] {
		const q = this.normalizeQuery();
		if (!q) return this.skillResources;
		return this.skillResources.filter((item) => {
			const haystack = `${item.name} ${item.description} ${item.commandText} ${item.packageSource ?? ""} ${item.path}`.toLowerCase();
			return haystack.includes(q);
		});
	}

	private filteredThemeResources(): DiscoveredThemeItem[] {
		const q = this.normalizeQuery();
		if (!q) return this.themeResources;
		return this.themeResources.filter((item) => {
			const haystack = `${item.name} ${item.description} ${item.variant} ${item.path}`.toLowerCase();
			return haystack.includes(q);
		});
	}

	private parseThemeRgb(color: string): { r: number; g: number; b: number } | null {
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
		return null;
	}

	private inferThemeVariantFromBackground(background: string): "light" | "dark" {
		const rgb = this.parseThemeRgb(background);
		if (!rgb) return "dark";
		const toLinear = (channel: number): number => {
			const s = channel / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		const luminance = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
		return luminance >= 0.42 ? "light" : "dark";
	}

	private normalizeThemeColorLiteral(value: unknown): string | null {
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return trimmed;
		}
		return null;
	}

	private resolveThemeColorValue(doc: Record<string, unknown>, value: unknown, seen = new Set<string>()): string | null {
		const direct = this.normalizeThemeColorLiteral(value);
		if (direct) return direct;
		if (typeof value !== "string") return null;
		const ref = value.trim();
		if (!ref || seen.has(ref)) return null;
		seen.add(ref);
		const vars = (doc.vars as Record<string, unknown> | undefined) ?? {};
		if (Object.prototype.hasOwnProperty.call(vars, ref)) {
			const fromVar = this.resolveThemeColorValue(doc, vars[ref], seen);
			if (fromVar) return fromVar;
		}
		const colors = (doc.colors as Record<string, unknown> | undefined) ?? {};
		if (Object.prototype.hasOwnProperty.call(colors, ref)) {
			const fromColor = this.resolveThemeColorValue(doc, colors[ref], seen);
			if (fromColor) return fromColor;
		}
		return null;
	}

	private themeBackgroundColor(doc: Record<string, unknown>): string {
		const colors = (doc.colors as Record<string, unknown> | undefined) ?? {};
		return (
			this.resolveThemeColorValue(doc, colors.selectedBg) ??
			this.resolveThemeColorValue(doc, colors.userMessageBg) ??
			this.resolveThemeColorValue(doc, colors.customMessageBg) ??
			"#101010"
		);
	}

	private inferThemeVariant(doc: Record<string, unknown>, fileName: string): "light" | "dark" {
		const meta = doc.piDesktop;
		if (meta && typeof meta === "object" && !Array.isArray(meta)) {
			const variant = (meta as Record<string, unknown>).variant;
			if (variant === "light" || variant === "dark") return variant;
		}
		const background = this.themeBackgroundColor(doc);
		const byBackground = this.inferThemeVariantFromBackground(background);
		if (byBackground) return byBackground;
		return fileName.toLowerCase().includes("light") ? "light" : "dark";
	}

	private async scanThemeResources(): Promise<DiscoveredThemeItem[]> {
		await this.ensureHomePath();
		if (!this.homePath) return [];
		const themesRoot = joinFsPath(joinFsPath(joinFsPath(this.homePath, ".pi"), "agent"), "themes");
		try {
			const { exists, readDir, readTextFile } = await import("@tauri-apps/plugin-fs");
			if (!(await exists(themesRoot))) return [];
			const entries = await readDir(themesRoot);
			const out: DiscoveredThemeItem[] = [];
			for (const entry of entries) {
				if (!entry.isFile || !entry.name.toLowerCase().endsWith(".json")) continue;
				const path = joinFsPath(themesRoot, entry.name);
				let parsed: Record<string, unknown> = {};
				try {
					const raw = await readTextFile(path);
					const json = JSON.parse(raw) as unknown;
					if (json && typeof json === "object" && !Array.isArray(json)) {
						parsed = json as Record<string, unknown>;
					}
				} catch {
					// keep defaults for malformed files
				}
				const fileId = entry.name.replace(/\.json$/i, "");
				const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fileId;
				const variant = this.inferThemeVariant(parsed, fileId);
				const colors = (parsed.colors as Record<string, unknown> | undefined) ?? {};
				const accent = this.resolveThemeColorValue(parsed, colors.accent) ?? "#7A818F";
				const background = this.themeBackgroundColor(parsed);
				const foreground =
					this.resolveThemeColorValue(parsed, colors.text) ??
					this.resolveThemeColorValue(parsed, colors.userMessageText) ??
					(variant === "dark" ? "#EFEFEF" : "#37352F");
				const description = typeof parsed.description === "string" && parsed.description.trim()
					? parsed.description.trim()
					: `${variant === "dark" ? "Dark" : "Light"} theme`;
				out.push({ id: fileId.toLowerCase(), name, description, variant, accent, background, foreground, path });
			}
			return out.sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			return [];
		}
	}

	private findSkillResourceByName(name: string): DiscoveredResourceItem | null {
		const normalized = name.trim().toLowerCase();
		return this.skillResources.find((item) => item.name.trim().toLowerCase() === normalized) ?? null;
	}

	private isRecommendedSkillInstalled(
		definition: RecommendedSkillDefinition,
		resource: DiscoveredResourceItem | null,
		packageInstalled: boolean,
	): boolean {
		if (packageInstalled) return true;
		if (!resource) return false;

		const normalizedPackageSource = normalizeRecommendedSource(definition.packageSource);
		const isLocalRecommendedSkill = normalizedPackageSource.startsWith("local:");
		if (isLocalRecommendedSkill) return true;

		const resourceSource = (resource.packageSource || "").trim();
		if (!resourceSource) return false;
		return this.sourceMatchesInstalled(definition.packageSource, resourceSource);
	}

	private buildRecommendedSkillItems(): RecommendedSkillSurfaceItem[] {
		return RECOMMENDED_SKILLS.map((definition) => {
			const resource = this.findSkillResourceByName(definition.skillName);
			const packageInstalled = this.isSourceInstalledForScope(definition.packageSource, "global");
			const installed = this.isRecommendedSkillInstalled(definition, resource, packageInstalled);
			return {
				id: `recommended-skill:${definition.id}`,
				definition,
				resource,
				installed,
				packageInstalled,
			};
		}).sort((a, b) => a.definition.name.localeCompare(b.definition.name));
	}

	private recommendedSkillNameSet(items: RecommendedSkillSurfaceItem[]): Set<string> {
		return new Set(items.map((item) => item.definition.skillName.toLowerCase()));
	}

	private shouldSkipPackagedSkillDir(name: string): boolean {
		const normalized = name.trim().toLowerCase();
		return normalized === ".git" || normalized === "node_modules";
	}

	private async copyFilePreservingMode(sourcePath: string, targetPath: string): Promise<void> {
		const { readFile, writeFile, stat } = await import("@tauri-apps/plugin-fs");
		const data = await readFile(sourcePath);
		let mode: number | undefined;
		try {
			const sourceInfo = await stat(sourcePath);
			if (typeof sourceInfo.mode === "number" && Number.isFinite(sourceInfo.mode)) {
				mode = sourceInfo.mode;
			}
		} catch {
			// ignore mode fallback
		}
		await writeFile(targetPath, data, {
			append: false,
			create: true,
			mode,
		});
	}

	private async copyDirectoryRecursive(fromPath: string, toPath: string): Promise<void> {
		const { mkdir, readDir, stat } = await import("@tauri-apps/plugin-fs");
		await mkdir(toPath, { recursive: true });
		const entries = await readDir(fromPath);
		for (const entry of entries) {
			const sourcePath = joinFsPath(fromPath, entry.name);
			const targetPath = joinFsPath(toPath, entry.name);

			let isDirectory = entry.isDirectory;
			let isFile = entry.isFile;
			if (!isDirectory && !isFile) {
				try {
					const sourceInfo = await stat(sourcePath);
					isDirectory = sourceInfo.isDirectory;
					isFile = sourceInfo.isFile;
				} catch {
					continue;
				}
			}

			if (isDirectory) {
				if (this.shouldSkipPackagedSkillDir(entry.name)) continue;
				await this.copyDirectoryRecursive(sourcePath, targetPath);
				continue;
			}
			if (!isFile) continue;
			await this.copyFilePreservingMode(sourcePath, targetPath);
		}
	}

	private async resolveSkillDirectoryFromPackage(basePath: string, skillName: string): Promise<string | null> {
		const normalizedSkill = skillName.trim().toLowerCase();
		if (!normalizedSkill) return null;
		try {
			const { exists, readDir } = await import("@tauri-apps/plugin-fs");
			const directCandidates = [
				joinFsPath(basePath, skillName),
				joinFsPath(joinFsPath(basePath, "skills"), skillName),
			];
			for (const candidate of directCandidates) {
				if (await exists(joinFsPath(candidate, "SKILL.md"))) return candidate;
			}

			const queue: Array<{ path: string; depth: number }> = [{ path: basePath, depth: 0 }];
			while (queue.length > 0) {
				const next = queue.shift()!;
				if (next.depth > 3) continue;
				const entries = await readDir(next.path).catch(() => []);
				for (const entry of entries) {
					if (!entry.isDirectory || this.shouldSkipPackagedSkillDir(entry.name)) continue;
					const fullPath = joinFsPath(next.path, entry.name);
					const normalizedName = entry.name.trim().toLowerCase();
					if (normalizedName === normalizedSkill && await exists(joinFsPath(fullPath, "SKILL.md"))) {
						return fullPath;
					}
					queue.push({ path: fullPath, depth: next.depth + 1 });
				}
			}
		} catch {
			// ignore
		}
		return null;
	}

	private async materializeRecommendedSkillFromPackage(item: RecommendedSkillSurfaceItem): Promise<string | null> {
		if (item.definition.sourceKind === "local") return item.resource?.path || null;
		await this.ensureHomePath();
		const skillsRoot = this.resourceRootPath("skill", "global");
		if (!skillsRoot) return null;

		const targetDir = joinFsPath(skillsRoot, item.definition.skillName);
		const targetSkillPath = joinFsPath(targetDir, "SKILL.md");
		const { exists, mkdir, readTextFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
		if (await exists(targetSkillPath)) return targetSkillPath;

		const installedPackage = this.findInstalledItemForSource(item.definition.packageSource, "global");
		const basePath = installedPackage?.location?.trim();
		if (!basePath) return null;

		const sourceDir = await this.resolveSkillDirectoryFromPackage(basePath, item.definition.skillName);
		if (!sourceDir) return null;
		const sourceSkillPath = joinFsPath(sourceDir, "SKILL.md");
		await mkdir(skillsRoot, { recursive: true });

		let copyError: string | null = null;
		try {
			await this.copyDirectoryRecursive(sourceDir, targetDir);
		} catch (err) {
			copyError = err instanceof Error ? err.message : String(err);
		}

		if (!(await exists(targetSkillPath)) && await exists(sourceSkillPath)) {
			await mkdir(targetDir, { recursive: true });
			const sourceSkillContent = await readTextFile(sourceSkillPath);
			await writeTextFile(targetSkillPath, sourceSkillContent, { append: false, create: true });
		}

		if (!(await exists(targetSkillPath))) {
			throw new Error(`Missing SKILL.md for ${item.definition.skillName} after install.${copyError ? ` ${copyError}` : ""}`);
		}
		return targetSkillPath;
	}

	private async resolvePackageSkillContentPath(skillName: string, packageSource: string | null): Promise<string | null> {
		if (!packageSource) return null;
		const installedPackage = this.findInstalledItemForSource(packageSource, "global");
		const basePath = installedPackage?.location?.trim();
		if (!basePath) return null;

		const skillDir = await this.resolveSkillDirectoryFromPackage(basePath, skillName);
		if (skillDir) return joinFsPath(skillDir, "SKILL.md");

		const candidates = [
			joinFsPath(basePath, `${skillName}.md`),
			joinFsPath(joinFsPath(basePath, "skills"), `${skillName}.md`),
		];
		try {
			const { exists } = await import("@tauri-apps/plugin-fs");
			for (const candidate of candidates) {
				if (await exists(candidate)) return candidate;
			}
		} catch {
			// ignore
		}
		return null;
	}

	private async resolveRecommendedSkillContentPath(item: RecommendedSkillSurfaceItem): Promise<string | null> {
		if (item.resource?.path) return item.resource.path;
		return this.resolvePackageSkillContentPath(item.definition.skillName, item.definition.packageSource);
	}

	private async loadActiveSkillContent(path: string | null, fallbackMessage: string): Promise<void> {
		this.activeSkillContent = "";
		this.activeSkillContentError = "";
		this.activeSkillContentNotice = "";
		this.activeSkillContentPath = path;
		if (!path) {
			this.activeSkillContentNotice = fallbackMessage;
			this.render();
			return;
		}
		this.activeSkillContentLoading = true;
		this.render();
		try {
			const { readTextFile } = await import("@tauri-apps/plugin-fs");
			this.activeSkillContent = await readTextFile(path);
		} catch (err) {
			this.activeSkillContentError = err instanceof Error ? err.message : String(err);
		} finally {
			this.activeSkillContentLoading = false;
			this.render();
		}
	}

	private filteredCatalogItems(): CatalogPackageItem[] {
		const q = this.normalizeQuery();
		if (!q) return this.catalogItems;
		return this.catalogItems.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(q));
	}

	private getEffectiveScope(_scope: "global" | "local"): "global" | "local" {
		return "global";
	}

	private async executePackageCommand(
		args: string[],
		options: {
			scope: "global" | "local";
			appendLocalFlag: boolean;
			statusText: string;
			refreshOnSuccess?: boolean;
		},
	): Promise<boolean> {
		if (this.runningCommand) return false;

		this.runningCommand = true;
		this.commandStatus = options.statusText;
		const finalArgs = args;
		const cwd = "/";
		this.commandOutput = `${this.commandOutput ? `${this.commandOutput}\n\n` : ""}$ pi ${finalArgs.join(" ")}\n`;
		this.render();

		try {
			const result = await rpcBridge.runPiCliCommand(finalArgs, { cwd });
			const stdOut = result.stdout?.trim();
			const stdErr = result.stderr?.trim();
			this.commandOutput += [
				`[exit ${result.exit_code}] via ${result.discovery}`,
				stdOut,
				stdErr,
			]
				.filter(Boolean)
				.join("\n") + "\n";

			if (result.exit_code !== 0) {
				this.commandStatus = (stdErr || stdOut || `Command failed (exit ${result.exit_code})`).trim();
				return false;
			}

			if (options.refreshOnSuccess) {
				await this.refreshPackages(true);
			}
			return true;
		} catch (err) {
			this.commandStatus = `Command failed: ${err instanceof Error ? err.message : String(err)}`;
			return false;
		} finally {
			this.runningCommand = false;
			this.render();
		}
	}

	private async installPackage(source: string, scope: "global" | "local"): Promise<void> {
		const trimmed = source.trim();
		if (!trimmed) return;
		const effectiveScope = this.getEffectiveScope(scope);
		const success = await this.executePackageCommand(["install", trimmed], {
			scope: effectiveScope,
			appendLocalFlag: false,
			statusText: `Installing ${trimmed}…`,
			refreshOnSuccess: true,
		});
		if (success) {
			this.commandStatus = `Installed: ${trimmed}`;
		}
	}

	private inferRemovedPackageAuthProviderCandidates(source: string): string[] {
		const normalized = normalizeRecommendedSource(source);
		if (!normalized.startsWith("npm:")) return [];
		const packageName = normalized.slice(4);
		if (!packageName) return [];
		const packageTail = packageName.split("/").filter(Boolean).pop() || packageName;
		const candidates = new Set<string>();
		const hinted = [...(PROVIDER_AUTH_CLEANUP_HINTS.get(packageName) ?? []), ...(PROVIDER_AUTH_CLEANUP_HINTS.get(packageTail) ?? [])];
		for (const provider of hinted) {
			const normalizedProvider = provider.trim().toLowerCase();
			if (normalizedProvider) candidates.add(normalizedProvider);
		}
		if (packageName.includes("cursor") || packageTail.includes("cursor")) {
			candidates.add("cursor-agent");
		}
		if (packageName.includes("kilo") || packageTail.includes("kilo")) {
			candidates.add("kilo");
		}
		const withoutPiPrefix = packageTail.startsWith("pi-") ? packageTail.slice(3) : packageTail;
		if (withoutPiPrefix) {
			candidates.add(withoutPiPrefix);
			if (withoutPiPrefix.endsWith("-provider")) {
				candidates.add(withoutPiPrefix.slice(0, -"-provider".length));
			}
		}
		return [...candidates].filter(Boolean);
	}

	private async cleanupProviderAuthForRemovedPackage(source: string): Promise<string[]> {
		const candidates = this.inferRemovedPackageAuthProviderCandidates(source);
		if (candidates.length === 0) return [];
		let authProviders: Array<{ provider: string; source: string; kind: string }> = [];
		try {
			const status = await rpcBridge.getPiAuthStatus();
			authProviders = Array.isArray(status?.configured_providers)
				? status.configured_providers.map((item) => ({
					provider: String(item.provider || "").trim().toLowerCase(),
					source: String(item.source || "").trim().toLowerCase(),
					kind: String(item.kind || "").trim().toLowerCase(),
				})).filter((item) => item.provider.length > 0)
				: [];
		} catch {
			return [];
		}

		const packageTokens = normalizeRecommendedSource(source)
			.replace(/^npm:/, "")
			.split(/[\/_-]+/)
			.map((token) => token.trim().toLowerCase())
			.filter((token) => token.length >= 4 && token !== "provider" && token !== "package");

		let builtInOAuthProviders = collectBuiltInOAuthProviderIds([]);
		try {
			const oauthProviders = await rpcBridge.getPiOAuthProviders();
			builtInOAuthProviders = collectBuiltInOAuthProviderIds(oauthProviders);
		} catch {
			// keep fallback built-in IDs only
		}

		const targets = new Set<string>();
		for (const auth of authProviders) {
			if (auth.source === "environment") continue;
			if (auth.kind !== "oauth") continue;
			if (builtInOAuthProviders.has(auth.provider)) continue;
			const directMatch = candidates.some((candidate) => auth.provider === candidate || auth.provider.includes(candidate) || candidate.includes(auth.provider));
			const tokenMatch = packageTokens.some((token) => auth.provider.includes(token));
			if (directMatch || tokenMatch) {
				targets.add(auth.provider);
			}
		}

		if (targets.size === 0) return [];
		const removed: string[] = [];
		for (const provider of targets) {
			try {
				const result = await rpcBridge.clearPiProviderAuth(provider);
				if (result.removed) {
					removed.push(provider);
				}
			} catch {
				// best-effort cleanup
			}
		}
		if (removed.length > 0) {
			this.commandOutput = `${this.commandOutput ? `${this.commandOutput}\n` : ""}[auth-cleanup] removed oauth credentials for: ${removed.join(", ")}\n`;
		}
		return removed;
	}

	private async removePackage(source: string, scope: "global" | "local"): Promise<void> {
		const trimmed = source.trim();
		if (!trimmed) return;
		const effectiveScope = this.getEffectiveScope(scope);
		const success = await this.executePackageCommand(["remove", trimmed], {
			scope: effectiveScope,
			appendLocalFlag: false,
			statusText: `Removing ${trimmed}…`,
			refreshOnSuccess: true,
		});
		if (success) {
			const removedProviders = await this.cleanupProviderAuthForRemovedPackage(trimmed);
			if (removedProviders.length > 0) {
				this.commandStatus = `Removed: ${trimmed} · Cleared auth for ${removedProviders.join(", ")}`;
			} else {
				this.commandStatus = `Removed: ${trimmed}`;
			}
		}
	}

	private async updatePackages(): Promise<void> {
		const effectiveScope = this.getEffectiveScope(this.packageScope);
		const success = await this.executePackageCommand(["update"], {
			scope: effectiveScope,
			appendLocalFlag: false,
			statusText: "Updating installed packages…",
			refreshOnSuccess: true,
		});
		if (success) {
			this.commandStatus = "Updated packages.";
		}
	}

	private async listPackages(): Promise<void> {
		const effectiveScope = this.getEffectiveScope(this.packageScope);
		const success = await this.executePackageCommand(["list"], {
			scope: effectiveScope,
			appendLocalFlag: false,
			statusText: "Refreshing installed package list…",
			refreshOnSuccess: true,
		});
		if (success) {
			this.commandStatus = "Refreshed package list.";
		}
	}

	private async installRecommendedPackage(definition: RecommendedPackageDefinition, scope: "global" | "local"): Promise<void> {
		await this.installPackage(definition.source, scope);
	}

	private async addCatalogItem(item: CatalogPackageItem): Promise<void> {
		await this.installPackage(`npm:${item.name}`, this.packageScope);
	}

	private async openInstalledItem(item: InstalledDisplayItem): Promise<void> {
		if (!item.openUrl) return;
		await this.openExternal(item.openUrl);
	}

	private async runResourceCommand(item: DiscoveredResourceItem, actionLabel: string): Promise<void> {
		if (this.runningCommand || this.runningConfigCommand) return;
		this.runningCommand = true;
		this.commandStatus = `${actionLabel} ${item.commandText}…`;
		this.commandOutput = `${this.commandOutput ? `${this.commandOutput}\n\n` : ""}[resource] ${item.commandText}\n`;
		this.render();
		try {
			await rpcBridge.prompt(item.commandText);
			this.commandStatus = `${actionLabel} ${item.commandText}.`;
		} catch (err) {
			this.commandStatus = `Failed to run ${item.commandText}: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			this.runningCommand = false;
			this.render();
		}
	}

	private async applyPromptTemplate(item: DiscoveredResourceItem): Promise<void> {
		await this.runResourceCommand(item, "Applied prompt template");
	}

	private async stageResourceCommandInChat(commandText: string, successLabel: string): Promise<void> {
		if (!this.onInsertPromptTemplate) {
			this.commandStatus = "Chat composer is not available right now.";
			this.render();
			return;
		}
		try {
			await this.onInsertPromptTemplate(commandText);
			this.commandStatus = successLabel;
			this.commandOutput = `${this.commandOutput ? `${this.commandOutput}\n\n` : ""}[resource-draft] ${commandText}\n`;
		} catch (err) {
			this.commandStatus = `Failed to prepare command in chat: ${err instanceof Error ? err.message : String(err)}`;
		}
		this.render();
	}

	private async runSkill(item: DiscoveredResourceItem): Promise<void> {
		await this.stageResourceCommandInChat(item.commandText, `Prepared ${item.commandText} in chat. Press Enter to run.`);
	}

	private async installRecommendedSkill(item: RecommendedSkillSurfaceItem): Promise<void> {
		if (this.runningCommand) return;
		if (!item.installed) {
			await this.installPackage(item.definition.packageSource, "global");
		}

		await this.refreshDiscoveredResources();
		const packageInstalled = this.isSourceInstalledForScope(item.definition.packageSource, "global");
		if (item.definition.sourceKind !== "local" && !packageInstalled) {
			this.commandStatus = `Failed to install ${item.definition.name}.`;
			this.render();
			return;
		}

		let materializedSkillPath: string | null = null;
		try {
			materializedSkillPath = await this.materializeRecommendedSkillFromPackage(item);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.commandStatus = `Installed ${item.definition.name}, but failed to prepare local skill files: ${message}`;
			this.render();
		}

		await this.refreshDiscoveredResources();
		const resolvedSkill = this.findSkillResourceByName(item.definition.skillName);
		if (!resolvedSkill) {
			this.commandStatus = `Installed ${item.definition.name}, but no SKILL.md was discovered for ${item.definition.skillName} in ~/.pi/agent/skills.`;
			this.render();
			return;
		}
		const commandText = resolvedSkill.commandText;
		const setupSuffix = item.definition.setupHint ? ` Setup: ${item.definition.setupHint}` : "";
		const skillPath = materializedSkillPath || resolvedSkill.path;
		const locationSuffix = skillPath ? ` Skill files at ${pathDirName(skillPath)}.` : "";
		await this.stageResourceCommandInChat(commandText, `Prepared ${commandText} in chat. Press Enter to run.${locationSuffix}${setupSuffix}`);
		if (this.activePackagesModal?.kind === "recommended-skill") {
			this.closePackagesItemModal();
		}
	}

	private insertPromptTemplate(item: DiscoveredResourceItem): void {
		void this.stageResourceCommandInChat(item.commandText, `Inserted ${item.commandText} into composer.`);
	}

	async ensureCreatorSkillInstalled(): Promise<void> {
		await this.ensureResourceCreatorSkillInstalled();
		if (rpcBridge.isConnected) {
			await this.refreshDiscoveredResources();
		}
	}

	private openResourceCreatorModal(kind: "auto" | "prompt" | "skill" = "auto", lockKind = false): void {
		this.resourceCreatorOpen = true;
		this.resourceCreatorKind = kind;
		this.resourceCreatorKindLocked = lockKind;
		this.resourceCreatorScope = "global";
		this.resourceCreatorBrief = "";
		this.resourceCreatorError = "";
		this.resourceStatus = "";
		void this.ensureHomePath();
		this.render();
	}

	private openCreateSkillModal(): void {
		this.openResourceCreatorModal("skill", true);
	}

	private async triggerCreatorSkillInChat(): Promise<void> {
		const creatorItem = this.buildRecommendedSkillItems().find((item) => item.definition.skillName === RESOURCE_CREATOR_SKILL_NAME) ?? null;
		if (creatorItem) {
			await this.installRecommendedSkill(creatorItem);
			return;
		}
		const commandText = `/skill:${RESOURCE_CREATOR_SKILL_NAME}`;
		await this.stageResourceCommandInChat(commandText, `Prepared ${commandText} in chat. Press Enter to run.`);
	}

	private closeResourceCreatorModal(): void {
		if (this.resourceCreatorRunning) return;
		this.resourceCreatorOpen = false;
		this.resourceCreatorKindLocked = false;
		this.resourceCreatorError = "";
		this.render();
	}

	private resourceCreatorSkillPath(): string | null {
		if (!this.homePath) return null;
		const skillsRoot = joinFsPath(joinFsPath(joinFsPath(this.homePath, ".pi"), "agent"), "skills");
		return joinFsPath(joinFsPath(skillsRoot, RESOURCE_CREATOR_SKILL_NAME), "SKILL.md");
	}

	private createResourceCreatorSkillMarkdown(): string {
		return `---
name: ${RESOURCE_CREATOR_SKILL_NAME}
description: Create or update Pi prompt templates and Agent skills from a short user brief. Produces minimal, well-structured SKILL.md or prompt files that follow Agent Skills best practices.
metadata:
  short-description: Create or update a skill or prompt from a brief
---

# ${RESOURCE_CREATOR_SKILL_NAME}

Purpose

This skill creates a lightweight, production\u2011ready Pi resource (prompt template or Agent skill) from a short user brief. It favors concise, actionable files that follow the Agent Skills conventions and progressive disclosure: only the minimal metadata is kept in immediate context and larger references are stored separately.

When to use

- You want a new prompt template or skill scaffolded quickly from a short description.
- You want a small, standards-compliant SKILL.md written for immediate use by Pi or other Agent Skill runtimes.
- You prefer a single, reviewable change staged in chat (nothing is executed automatically).

Input contract

The skill expects a JSON payload (appended to the command) or equivalent user message with these fields:
- kind: "auto" | "prompt" | "skill"        # preferred resource type or "auto" to infer
- scope: "global" | "project"               # target location (global preferred)
- brief: string                                # one-paragraph description of what the resource should do
- name: string?                                # optional slug hint (will be normalized)

Behavior

1. Validate the brief. If essential details are missing, ask one concise clarification question.
2. If kind == "auto", infer whether a prompt template or skill fits the brief.
3. Determine a safe slug:
   - Prefer an explicit \`name\` if provided after normalization.
   - Otherwise derive a short, verb-led slug from the brief (lowercase, letters/numbers/hyphens, \u2264 64 chars).
4. Create the resource under the chosen scope using Pi conventions:
   - Prompt template: ~/.pi/agent/prompts/<slug>.md
   - Skill: ~/.pi/agent/skills/<slug>/SKILL.md
5. SKILL.md structure for skills:
   - YAML frontmatter with \`name\` and \`description\` (these are the trigger fields)
   - Body: short Purpose, Setup (one-time steps), Workflow (ordered steps), Examples (if helpful)
   - Keep body concise; move large examples or references to \`references/\` files.
6. For prompt templates:
   - Create a markdown file with frontmatter \`description\` and a short reusable prompt body and usage notes.
7. Never execute external commands or run the created scripts—always stage the operation and summarize the created files for user review.

Naming rules

- 1–64 chars, lowercase a-z, digits, hyphens only
- No leading/trailing hyphens, no consecutive hyphens
- Must match parent directory for SKILL.md (skill folder name)

Examples

Prepare a skill in chat (staged command):

/skill:${RESOURCE_CREATOR_SKILL_NAME} {"kind":"skill","scope":"global","brief":"Create a skill that reviews staged git changes for security issues and outputs a short remediation plan."}

Prepare a prompt template in chat (staged command):

/skill:${RESOURCE_CREATOR_SKILL_NAME} {"kind":"prompt","scope":"global","brief":"Template for reviewing staged git changes with a strict security checklist."}

Sample SKILL.md created for a security-review skill:

\`\`\`markdown
---
name: security-review
description: Review staged git changes for security issues and suggest concise remediation steps. Use when you want an automated checklist and file-level recommendations for changed files.
---

# Security Review

## Purpose
Quickly identify security-relevant changes in staged files and provide prioritized remediation suggestions.

## Setup
No one-time setup required. (If helper scripts are included, document how to run them.)

## Workflow
1. List staged files and their diffs.
2. For each file, check for secrets, insecure patterns, and risky configuration changes.
3. Produce a short summary and per-file remediation steps.

## Examples
- \`./scripts/check_secrets.sh\` (run locally after review)
\`\`\`

Validation & Best Practices

- Keep SKILL.md focused: put large references under \`references/\` and link from SKILL.md.
- Frontmatter MUST contain \`name\` and \`description\` (description should include trigger contexts).
- Prefer short, imperative language and examples instead of long prose.
- Ask at most one clarifying question if input is ambiguous.

Notes

- This skill only prepares and writes files under the chosen scope. It does not run or install anything.
- On successful creation, summarize exactly which files were written and their absolute paths so the user can review and run them manually.
`;
	}

	private async ensureResourceCreatorSkillInstalled(): Promise<string | null> {
		await this.ensureHomePath();
		const skillPath = this.resourceCreatorSkillPath();
		if (!skillPath) return null;
		try {
			const { exists, mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
			if (await exists(skillPath)) return skillPath;
			const skillDir = skillPath.replace(/[\\/]SKILL\.md$/i, "");
			await mkdir(skillDir, { recursive: true });

			// Prefer packaged asset if available (assets/skills/creatorskill/SKILL.md), fallback to generated template
			let skillContent = this.createResourceCreatorSkillMarkdown();
			try {
				// Path relative from this module to assets directory
				const assetUrl = new URL("../../assets/skills/creatorskill/SKILL.md", import.meta.url).href;
				const resp = await fetch(assetUrl);
				if (resp && resp.ok) {
					skillContent = await resp.text();
				}
			} catch {
				// ignore and use generated content
			}

			await writeTextFile(skillPath, skillContent);
			return skillPath;
		} catch {
			return null;
		}
	}

	private resolveResourceCreatorLoadedCommand(): string | null {
		const entry = this.skillResources.find((item) => item.name === RESOURCE_CREATOR_SKILL_NAME && item.loaded);
		if (!entry) return null;
		return entry.commandText || `/skill:${RESOURCE_CREATOR_SKILL_NAME}`;
	}

	private buildResourceCreatorFallbackPrompt(): string {
		const kind = this.resourceCreatorKind;
		const brief = this.resourceCreatorBrief.trim();
		return `Create a Pi resource from this brief with minimal manual steps.

Preferred skill (if available): /skill:${RESOURCE_CREATOR_SKILL_NAME}
Kind preference: ${kind}
Scope: global
Important: create ONLY global resources under ~/.pi/agent.

Brief:
${brief}

Use Pi conventions:
- Prompt templates: ~/.pi/agent/prompts/*.md
- Skills: ~/.pi/agent/skills/<name>/SKILL.md
- Prompt template format: frontmatter description + reusable markdown body
- Skill format: Agent Skills style SKILL.md with name + description frontmatter and clear workflow steps

Execute the required file creation/edits directly, then summarize exactly which files were created.`;
	}

	private async runResourceCreator(): Promise<void> {
		if (this.resourceCreatorRunning || this.runningCommand || this.runningConfigCommand) return;
		if (!this.resourceCreatorBrief.trim()) {
			this.resourceCreatorError = "Describe what you want to create first.";
			this.render();
			return;
		}
		this.resourceCreatorScope = "global";

		this.resourceCreatorRunning = true;
		this.resourceCreatorError = "";
		this.resourceStatus = "Preparing command draft for chat…";
		this.render();

		try {
			await this.ensureResourceCreatorSkillInstalled();
			await this.refreshDiscoveredResources();
			const loadedCommand = this.resolveResourceCreatorLoadedCommand();
			const payload = JSON.stringify({
				kind: this.resourceCreatorKind,
				scope: "global",
				brief: this.resourceCreatorBrief.trim(),
			});
			const commandPrefix = loadedCommand || `/skill:${RESOURCE_CREATOR_SKILL_NAME}`;
			const commandText = `${commandPrefix} ${payload}`;
			const statusText = loadedCommand
				? "Prepared creator skill command in chat. Press Enter to run."
				: "Prepared creator skill command in chat (runtime lookup pending). Press Enter to run.";

			await this.stageResourceCommandInChat(commandText, statusText);
			this.resourceStatus = statusText;
			this.resourceCreatorOpen = false;
		} catch (err) {
			this.resourceCreatorError = err instanceof Error ? err.message : String(err);
		} finally {
			this.resourceCreatorRunning = false;
			this.render();
		}
	}

	private renderResourceCreatorModal(): TemplateResult | typeof nothing {
		if (!this.resourceCreatorOpen) return nothing;
		const globalTarget = this.homePath
			? joinFsPath(joinFsPath(this.homePath, ".pi"), "agent")
			: "~/.pi/agent";
		const creatingSkill = this.resourceCreatorKindLocked && this.resourceCreatorKind === "skill";
		return html`
			<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.closeResourceCreatorModal()}>
				<div class="overlay-card packages-config-modal packages-item-modal">
					<div class="overlay-header">
						<div>
							<div class="packages-config-modal-title">${creatingSkill ? "Create skill" : "Create resource"} (AI-assisted)</div>
							<div class="packages-config-modal-sub">Prepares a command in chat. Nothing runs before you press Enter.</div>
						</div>
						<button ?disabled=${this.resourceCreatorRunning} @click=${() => this.closeResourceCreatorModal()}>✕</button>
					</div>
					<div class="overlay-body packages-config-modal-body">
						<div class="packages-config-field-grid">
							${!this.resourceCreatorKindLocked
								? html`
									<div class="packages-config-field">
										<label class="packages-config-field-label">Resource type</label>
										<select
											class="packages-config-select"
											.value=${this.resourceCreatorKind}
											?disabled=${this.resourceCreatorRunning}
											@change=${(event: Event) => {
												this.resourceCreatorKind = (event.target as HTMLSelectElement).value as "auto" | "prompt" | "skill";
												this.render();
											}}
										>
											<option value="auto">Auto (let AI choose)</option>
											<option value="prompt">Prompt template</option>
											<option value="skill">Skill</option>
										</select>
									</div>
								`
								: nothing}

							<div class="packages-config-field">
								<label class="packages-config-field-label">Destination</label>
								<div class="packages-section-submeta">${globalTarget}</div>
								<div class="packages-section-submeta">Command is staged in chat and only runs after Enter.</div>
							</div>
						</div>

						<div class="packages-config-field">
							<label class="packages-config-field-label">What should this resource do?</label>
							<textarea
								class="packages-config-textarea"
								placeholder="Example: Create a prompt template for reviewing staged git changes with a strict bug/security checklist"
								?disabled=${this.resourceCreatorRunning}
								.value=${this.resourceCreatorBrief}
								@input=${(event: Event) => {
									this.resourceCreatorBrief = (event.target as HTMLTextAreaElement).value;
									this.render();
								}}
							></textarea>
						</div>

						<div class="packages-config-modal-actions">
							<button class="ghost-btn" ?disabled=${this.resourceCreatorRunning} @click=${() => this.closeResourceCreatorModal()}>Cancel</button>
							<button class="ghost-btn" ?disabled=${this.resourceCreatorRunning} @click=${() => void this.runResourceCreator()}>
								${this.resourceCreatorRunning ? "Preparing…" : "Prepare in chat"}
							</button>
						</div>
						<div class="packages-section-submeta">Always prepares <code>/skill:${RESOURCE_CREATOR_SKILL_NAME}</code> in chat. You review and press Enter manually.</div>
						${this.resourceCreatorError ? html`<div class="packages-config-inline-error">${this.resourceCreatorError}</div>` : nothing}
						${this.resourceStatus ? html`<div class="packages-section-submeta">${this.resourceStatus}</div>` : nothing}
					</div>
				</div>
			</div>
		`;
	}

	private openCreateResourceEditor(kind: "prompt" | "skill"): void {
		this.resourceEditorOpen = true;
		this.resourceEditorMode = "create";
		this.resourceEditorKind = kind;
		this.resourceEditorScope = "global";
		this.resourceEditorName = kind === "skill" ? "my-skill" : "new-template";
		this.resourceEditorDescription = kind === "skill"
			? "What this skill does and when to use it."
			: "Describe when to use this template.";
		this.resourceEditorPath = null;
		this.resourceEditorLoaded = false;
		this.resourceEditorError = "";
		this.resourceStatus = "";
		this.applyResourceTemplate();
	}

	private closeResourceEditor(): void {
		this.resourceEditorOpen = false;
		this.resourceEditorError = "";
		this.resourceEditorLoaded = false;
		this.resourceEditorPath = null;
		this.render();
	}

	private async openEditResourceEditor(item: DiscoveredResourceItem): Promise<void> {
		if (!this.canEditResource(item) || !item.path) return;
		this.resourceEditorOpen = true;
		this.resourceEditorMode = "edit";
		this.resourceEditorKind = item.kind;
		this.resourceEditorScope = "global";
		this.resourceEditorName = this.normalizeLoadedResourceName(item);
		this.resourceEditorDescription = item.description || "";
		this.resourceEditorPath = item.path;
		this.resourceEditorLoaded = item.loaded;
		this.resourceEditorError = "";
		this.resourceStatus = "";
		this.render();
		try {
			const { readTextFile } = await import("@tauri-apps/plugin-fs");
			this.resourceEditorContent = await readTextFile(item.path);
		} catch (err) {
			this.resourceEditorContent = "";
			this.resourceEditorError = err instanceof Error ? err.message : String(err);
		}
		this.render();
	}

	private async saveResourceEditor(): Promise<void> {
		if (this.creatingResource || this.deletingResource) return;
		const kind = this.resourceEditorKind;
		const name = this.normalizeResourceName(this.resourceEditorName);
		const validationError = this.validateResourceName(name, kind);
		if (validationError) {
			this.resourceEditorError = validationError;
			this.render();
			return;
		}
		if (!this.resourceEditorContent.trim()) {
			this.resourceEditorError = "Content cannot be empty.";
			this.render();
			return;
		}

		this.creatingResource = true;
		this.resourceEditorError = "";
		this.resourceStatus = this.resourceEditorMode === "create" ? "Saving new resource…" : "Saving resource…";
		this.render();

		try {
			await this.ensureHomePath();
			const { exists, mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
			const targetPath = this.resourceEditorMode === "edit" && this.resourceEditorPath
				? this.resourceEditorPath
				: this.resourceFilePath(kind, this.resourceEditorScope, name);
			if (!targetPath) {
				throw new Error("Could not resolve resource path.");
			}

			const root = this.resourceRootPath(kind, this.resourceEditorScope);
			if (!root) throw new Error("Could not resolve resource root directory.");
			await mkdir(root, { recursive: true });
			if (kind === "skill") {
				const skillDir = joinFsPath(root, name);
				await mkdir(skillDir, { recursive: true });
			}

			if (this.resourceEditorMode === "create" && (await exists(targetPath))) {
				throw new Error("A resource with that name already exists.");
			}

			await writeTextFile(targetPath, this.resourceEditorContent);
			this.resourceStatus = this.resourceEditorMode === "create"
				? "Resource saved. Restart or open a new session to load new commands."
				: "Resource updated. Restart or open a new session to refresh loaded commands.";
			this.commandStatus = this.resourceStatus;
			await this.refreshDiscoveredResources();
			this.closeResourceEditor();
		} catch (err) {
			this.resourceEditorError = err instanceof Error ? err.message : String(err);
			this.resourceStatus = "";
			this.render();
		} finally {
			this.creatingResource = false;
		}
	}

	private async deleteResource(item: DiscoveredResourceItem): Promise<void> {
		if (!this.canEditResource(item) || !item.path) return;
		if (this.deletingResource || this.creatingResource) return;
		const confirmed = window.confirm(`Delete ${item.kind} \"${item.name}\"?`);
		if (!confirmed) return;
		this.deletingResource = true;
		this.resourceStatus = `Deleting ${item.name}…`;
		this.resourceEditorError = "";
		this.render();
		try {
			const { remove } = await import("@tauri-apps/plugin-fs");
			if (item.kind === "skill" && /[\\/]skill\.md$/i.test(item.path)) {
				const skillDir = item.path.replace(/[\\/]skill\.md$/i, "");
				await remove(skillDir, { recursive: true });
			} else {
				await remove(item.path);
			}
			this.resourceStatus = `Deleted ${item.kind} ${item.name}.`;
			this.commandStatus = this.resourceStatus;
			await this.refreshDiscoveredResources();
		} catch (err) {
			this.resourceEditorError = err instanceof Error ? err.message : String(err);
		} finally {
			this.deletingResource = false;
			this.render();
		}
	}

	private renderResourceEditorModal(): TemplateResult | typeof nothing {
		if (!this.resourceEditorOpen) return nothing;
		const creating = this.resourceEditorMode === "create";
		const saveLabel = this.creatingResource ? "Saving…" : creating ? "Create resource" : "Save changes";
		const typeLocked = !creating;
		return html`
			<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.closeResourceEditor()}>
				<div class="overlay-card packages-config-modal">
					<div class="overlay-header">
						<div>
							<div class="packages-config-modal-title">${creating ? "Create resource" : "Edit resource"}</div>
							<div class="packages-config-modal-sub">Create prompt templates or skills with best-practice starter templates.</div>
						</div>
						<button @click=${() => this.closeResourceEditor()}>✕</button>
					</div>
					<div class="overlay-body packages-config-modal-body">
						<div class="packages-config-field-grid">
							<div class="packages-config-field">
								<label class="packages-config-field-label">Type</label>
								<select
									class="packages-config-select"
									.value=${this.resourceEditorKind}
									?disabled=${typeLocked || this.creatingResource}
									@change=${(event: Event) => {
										const next = (event.target as HTMLSelectElement).value as "prompt" | "skill";
										this.resourceEditorKind = next;
										this.resourceEditorName = this.normalizeResourceName(this.resourceEditorName) || (next === "skill" ? "my-skill" : "new-template");
										this.applyResourceTemplate();
									}}
								>
									<option value="prompt">Prompt template</option>
									<option value="skill">Skill</option>
								</select>
							</div>
						</div>

						<div class="packages-config-field">
							<label class="packages-config-field-label">Name</label>
							<input
								class="packages-config-input"
								type="text"
								.value=${this.resourceEditorName}
								?disabled=${!creating || this.creatingResource}
								@input=${(event: Event) => {
									this.resourceEditorName = (event.target as HTMLInputElement).value;
									this.render();
								}}
							/>
						</div>

						<div class="packages-config-field">
							<label class="packages-config-field-label">Description</label>
							<input
								class="packages-config-input"
								type="text"
								.value=${this.resourceEditorDescription}
								?disabled=${this.creatingResource}
								@input=${(event: Event) => {
									this.resourceEditorDescription = (event.target as HTMLInputElement).value;
									this.render();
								}}
							/>
						</div>

						<div class="packages-config-field">
							<label class="packages-config-field-label">Content</label>
							<textarea
								class="packages-config-textarea"
								?disabled=${this.creatingResource}
								.value=${this.resourceEditorContent}
								@input=${(event: Event) => {
									this.resourceEditorContent = (event.target as HTMLTextAreaElement).value;
									this.render();
								}}
							></textarea>
						</div>

						<div class="packages-config-modal-actions">
							<button class="ghost-btn" ?disabled=${this.creatingResource} @click=${() => this.applyResourceTemplate()}>Use best-practice template</button>
							<button class="ghost-btn" ?disabled=${this.creatingResource} @click=${() => this.closeResourceEditor()}>Cancel</button>
							<button class="ghost-btn" ?disabled=${this.creatingResource} @click=${() => void this.saveResourceEditor()}>
								${saveLabel}
							</button>
						</div>
						${this.resourceEditorPath && !creating
							? html`<div class="packages-section-submeta">Path: ${this.resourceEditorPath}</div>`
							: nothing}
						${this.resourceEditorLoaded && !creating
							? html`<div class="packages-section-submeta">Loaded command may require a new session/restart to pick up changes.</div>`
							: nothing}
						${this.resourceEditorError ? html`<div class="packages-config-inline-error">${this.resourceEditorError}</div>` : nothing}
						${this.resourceStatus ? html`<div class="packages-section-submeta">${this.resourceStatus}</div>` : nothing}
					</div>
				</div>
			</div>
		`;
	}

	private statusTone(): "info" | "success" | "error" {
		const text = this.commandStatus.toLowerCase();
		if (!text) return "info";
		if (text.includes("failed") || text.includes("error")) return "error";
		if (text.startsWith("installed") || text.startsWith("removed") || text.startsWith("updated") || text.startsWith("refreshed")) {
			return "success";
		}
		return "info";
	}

	private getNotifyDebugLines(): string[] {
		const getter = (window as typeof window & {
			__PI_DESKTOP_GET_TRACE__?: () => string[];
		}).__PI_DESKTOP_GET_TRACE__;
		if (typeof getter !== "function") return [];
		try {
			const lines = getter();
			return lines
				.filter((line) => {
					const lower = line.toLowerCase();
					return lower.includes("notify:") || lower.includes("notify-action") || lower.includes("notify-target") || lower.includes("extension_ui_request") || lower.includes("rpc:event") || lower.includes("parse-failed");
				})
				.slice(-24);
		} catch {
			return [];
		}
	}

	private async runDesktopNotificationSmokeTest(): Promise<void> {
		if (this.runningCommand) return;
		this.runningCommand = true;
		this.commandStatus = "Testing desktop notification…";
		this.render();
		try {
			const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
			let granted = await isPermissionGranted();
			if (!granted) {
				const permission = await requestPermission();
				granted = permission === "granted";
				this.commandOutput += `${this.commandOutput ? "\n" : ""}[notify-test] permission=${permission}\n`;
			}
			if (!granted) {
				this.commandStatus = "Notification permission denied by OS.";
				return;
			}
			sendNotification({
				title: "Pi Desktop",
				body: "Desktop notification smoke test",
				autoCancel: true,
				sound: "Ping",
				extra: { source: "packages-notify-smoke" },
			});
			this.commandOutput += `${this.commandOutput ? "\n" : ""}[notify-test] sent via tauri notification plugin\n`;
			this.commandStatus = "Desktop notification test sent.";
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.commandOutput += `${this.commandOutput ? "\n" : ""}[notify-test] failed: ${message}\n`;
			this.commandStatus = `Notification test failed: ${message}`;
		} finally {
			this.runningCommand = false;
			this.render();
		}
	}

	private isRecommendedPackageInstalledForScope(_scope: "global" | "local", state: { global: boolean; project: boolean }): boolean {
		return state.global;
	}

	private sourceMatchesInstalled(source: string, installedSource: string): boolean {
		const normalizedSource = normalizeRecommendedSource(source);
		const normalizedInstalled = normalizeRecommendedSource(installedSource);
		if (normalizedSource === normalizedInstalled) return true;
		const bareSource = normalizedSource.startsWith("npm:") ? normalizedSource.slice(4) : normalizedSource;
		const bareInstalled = normalizedInstalled.startsWith("npm:") ? normalizedInstalled.slice(4) : normalizedInstalled;
		return bareSource === bareInstalled;
	}

	private isSourceInstalledForScope(source: string, _scope: "global" | "local"): boolean {
		return this.installedUser.some((item) => this.sourceMatchesInstalled(source, item.source));
	}

	private resolveInstalledRemoveSource(item: InstalledDisplayItem): string {
		const source = item.source.trim();
		const location = item.location.trim();
		const localLike =
			source.startsWith("./") ||
			source.startsWith("../") ||
			source.startsWith("/") ||
			source.startsWith("~/") ||
			source.startsWith("file:") ||
			/^[a-zA-Z]:[\\/]/.test(source);
		if (localLike && location) return location;
		return source;
	}

	private extensionInstallState(source: string): { global: boolean; project: boolean } {
		if (normalizeRecommendedSource(source) === DESKTOP_THEMES_PACKAGE_SOURCE) {
			return {
				global: this.desktopThemesInstalled,
				project: false,
			};
		}
		return {
			global: this.installedUser.some((item) => this.sourceMatchesInstalled(source, item.source)),
			project: false,
		};
	}

	private findInstalledItemForSource(source: string, _scope: "global" | "local"): InstalledDisplayItem | null {
		if (normalizeRecommendedSource(source) === DESKTOP_THEMES_PACKAGE_SOURCE) {
			if (!this.desktopThemesInstalled) return null;
			return {
				source: DESKTOP_THEMES_PACKAGE_SOURCE,
				location: this.desktopThemesRootPath || "~/.pi/agent/themes",
				scope: "user",
				displayName: "Pi Desktop Themes",
				openUrl: this.resolveSourceUrl(DESKTOP_THEMES_PACKAGE_SOURCE),
			};
		}
		const hit = this.installedUser.find((item) => this.sourceMatchesInstalled(source, item.source)) ?? null;
		if (!hit) return null;
		return {
			...hit,
			displayName: this.getDisplayName(hit.source),
			openUrl: this.resolveSourceUrl(hit.source),
		};
	}

	private buildExtensionSurfaceItems(
		recommended: RecommendedPackageDefinition[],
		discover: CatalogPackageItem[],
		installed: InstalledDisplayItem[],
	): { installed: ExtensionSurfaceItem[]; gallery: ExtensionSurfaceItem[] } {
		const bySource = new Map<string, ExtensionSurfaceItem>();

		for (const item of installed) {
			const source = item.source;
			const normalized = normalizeRecommendedSource(source);
			const installState = this.extensionInstallState(source);
			bySource.set(normalized, {
				id: `installed:${normalized}`,
				displayName: item.displayName,
				source,
				description: "Installed extension package",
				note: item.location || source,
				openUrl: item.openUrl,
				sourceKind: inferSourceKindFromSource(source),
				installState,
				installedItemForScope: this.findInstalledItemForSource(source, "global"),
			});
		}

		for (const item of recommended) {
			const source = item.source;
			const normalized = normalizeRecommendedSource(source);
			if (bySource.has(normalized)) {
				const existing = bySource.get(normalized)!;
				bySource.set(normalized, {
					...existing,
					description: item.description || existing.description,
					note: item.installSourceHint || existing.note,
					displayName: item.name || existing.displayName,
				});
				continue;
			}
			const installState = this.extensionInstallState(source);
			bySource.set(normalized, {
				id: `recommended:${normalized}`,
				displayName: item.name,
				source,
				description: item.description,
				note: item.installSourceHint,
				openUrl: this.resolveSourceUrl(source),
				sourceKind: item.sourceKind,
				installState,
				installedItemForScope: this.findInstalledItemForSource(source, "global"),
			});
		}

		for (const item of discover) {
			const source = `npm:${item.name}`;
			const normalized = normalizeRecommendedSource(source);
			if (bySource.has(normalized)) continue;
			const installState = this.extensionInstallState(source);
			bySource.set(normalized, {
				id: `discover:${normalized}`,
				displayName: item.name,
				source,
				description: item.description || "No description",
				note: `v${item.version}`,
				openUrl: item.npmUrl,
				sourceKind: "npm",
				installState,
				installedItemForScope: this.findInstalledItemForSource(source, "global"),
			});
		}

		const all = [...bySource.values()]
			.sort((a, b) => a.displayName.localeCompare(b.displayName));
		const installedOnly = all.filter((item) => item.installState.global || item.installState.project);
		const galleryOnly = all.filter((item) => !(item.installState.global || item.installState.project));
		return { installed: installedOnly, gallery: galleryOnly };
	}

	private buildRecommendedExtensionItems(): ExtensionSurfaceItem[] {
		return RECOMMENDED_PACKAGES.map((item) => {
			const source = item.source;
			const normalized = normalizeRecommendedSource(source);
			const installState = this.extensionInstallState(source);
			return {
				id: `recommended:${normalized}`,
				displayName: item.name,
				source,
				description: item.description,
				note: item.installSourceHint,
				openUrl: this.resolveSourceUrl(source),
				sourceKind: item.sourceKind,
				installState,
				installedItemForScope: this.findInstalledItemForSource(source, "global"),
			} satisfies ExtensionSurfaceItem;
		});
	}

	private async openPackagesItemModal(modal: ActivePackagesModal): Promise<void> {
		this.activePackagesModal = modal;
		this.activeSkillContent = "";
		this.activeSkillContentPath = null;
		this.activeSkillContentError = "";
		this.activeSkillContentNotice = "";
		this.activeSkillContentLoading = false;
		if (modal.kind === "extension") {
			const source = normalizeRecommendedSource(modal.item.source);
			let commands = this.packageConfigCommands.get(source) ?? [];
			if (commands.length === 0 && this.isAutoRenameSource(source)) {
				this.ensureSyntheticExtensionConfigCommand(source, "auto-rename", "config", modal.item.installedItemForScope ?? null);
				commands = this.packageConfigCommands.get(source) ?? [];
			}
			this.activePackageConfigSource = source;
			this.activePackageConfigLabel = modal.item.displayName;
			this.packageConfigStatus = "";
			this.autoRenameConfigError = "";
			this.refreshAutoRenameProjectOptions();
			this.autoRenameConfigSaveScope = "global";
			this.autoRenameConfigTargetProjectId = "";
			this.autoRenameConfigTargetProjectPath = "";
			this.render();

			await this.loadPackageConfigFromPackage(source, commands).catch(() => {});
			if (commands.some((command) => commandLikelyNeedsModelArg(command))) {
				await this.ensureConfigModelsLoaded();
			}
			const autoRenameCommand = this.resolveAutoRenameCommandForSource(source);
			if (autoRenameCommand) {
				await this.ensureAutoRenameConfigLoaded(source, false, { scope: "global" }).catch(() => {});
			}
			this.seedModelArgsForSource(source, commands);
			this.render();
			return;
		}

		this.render();
		if (modal.kind === "theme") {
			return;
		}
		if (modal.kind === "skill") {
			const directPath = modal.item.path.trim() || null;
			const fallbackPath = directPath ? null : await this.resolvePackageSkillContentPath(modal.item.name, modal.item.packageSource);
			const path = directPath ?? fallbackPath;
			const fallbackMessage = modal.item.packageSource
				? "Skill content is unavailable. Start a new session to refresh skills."
				: "Skill content is unavailable.";
			await this.loadActiveSkillContent(path, fallbackMessage);
			return;
		}

		const contentPath = await this.resolveRecommendedSkillContentPath(modal.item);
		const fallbackMessage = modal.item.installed
			? "Skill content is unavailable. Start a new session to refresh skills."
			: "Install this skill to view setup instructions.";
		await this.loadActiveSkillContent(contentPath, fallbackMessage);
	}

	private closePackagesItemModal(): void {
		this.activePackagesModal = null;
		this.activePackageConfigSource = null;
		this.activePackageConfigLabel = "";
		this.packageConfigStatus = "";
		this.autoRenameConfigError = "";
		this.autoRenameConfigLoading = false;
		this.autoRenameConfigSaving = false;
		this.autoRenameConfigPath = "";
		this.autoRenameConfigScopeLabel = "";
		this.autoRenameConfigSaveScope = "global";
		this.autoRenameConfigTargetProjectId = "";
		this.autoRenameConfigTargetProjectPath = "";
		this.autoRenameConfigLoadedSource = "";
		this.autoRenameConfigRaw = {};
		this.autoRenameConfig = defaultAutoRenameConfigDraft();
		this.activeSkillContent = "";
		this.activeSkillContentPath = null;
		this.activeSkillContentLoading = false;
		this.activeSkillContentError = "";
		this.activeSkillContentNotice = "";
		this.render();
	}

	private async openPath(path: string): Promise<void> {
		if (!path) return;
		try {
			let resolved = path;
			// Expand ~ to home directory when present
			if (resolved === "~" || resolved.startsWith("~/")) {
				try {
					const { homeDir } = await import("@tauri-apps/api/path");
					const home = await homeDir();
					resolved = resolved === "~" ? home : joinFsPath(home, resolved.slice(2));
				} catch {
					// ignore, fall back to original
				}
			}

			const { exists } = await import("@tauri-apps/plugin-fs");
			const { open } = await import("@tauri-apps/plugin-shell");
			if (await exists(resolved)) {
				await open(resolved);
				return;
			}
			// Try parent folder
			const parent = pathDirName(resolved);
			if (parent && await exists(parent)) {
				await open(parent);
				return;
			}

			throw new Error("Path not found");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.commandStatus = `Failed to open folder: ${message}`;
			this.render();
		}
	}

	private async installExtensionItem(item: ExtensionSurfaceItem): Promise<void> {
		if (normalizeRecommendedSource(item.source) === DESKTOP_THEMES_PACKAGE_SOURCE) {
			if (this.runningCommand || this.runningConfigCommand) return;
			this.runningCommand = true;
			this.commandStatus = "Installing Pi Desktop Themes…";
			this.render();
			try {
				const result = await restoreBundledThemes();
				await this.refreshBundledThemesStatus();
				this.commandStatus = `Installed Pi Desktop Themes (${result.created} created, ${result.updated} updated, ${result.renamed} renamed).`;
			} catch (err) {
				this.commandStatus = `Failed to install Pi Desktop Themes: ${err instanceof Error ? err.message : String(err)}`;
			} finally {
				this.runningCommand = false;
				this.render();
			}
			return;
		}
		await this.installPackage(item.source, "global");
		await this.refreshPackages(false);
	}

	private async uninstallExtensionItem(item: ExtensionSurfaceItem): Promise<void> {
		if (this.runningCommand || this.runningConfigCommand) return;
		this.closePackagesItemModal();
		if (normalizeRecommendedSource(item.source) === DESKTOP_THEMES_PACKAGE_SOURCE) {
			this.runningCommand = true;
			this.commandStatus = "Uninstalling Pi Desktop Themes…";
			this.render();
			try {
				const result = await removeBundledThemes();
				await this.refreshBundledThemesStatus();
				this.commandStatus = `Uninstalled Pi Desktop Themes (${result.removed} removed, ${result.removedLegacy} legacy removed).`;
			} catch (err) {
				this.commandStatus = `Failed to uninstall Pi Desktop Themes: ${err instanceof Error ? err.message : String(err)}`;
			} finally {
				this.runningCommand = false;
				this.render();
			}
			return;
		}
		const installed = item.installedItemForScope ?? this.findInstalledItemForSource(item.source, "global");
		if (!installed) return;
		await this.removePackage(this.resolveInstalledRemoveSource(installed), "global");
		await this.refreshPackages(false);
	}

	private async uninstallThemeItem(item: DiscoveredThemeItem): Promise<void> {
		if (this.runningCommand || this.runningConfigCommand) return;
		this.runningCommand = true;
		this.commandStatus = `Uninstalling theme ${item.name}…`;
		this.render();
		try {
			const { exists, remove } = await import("@tauri-apps/plugin-fs");
			if (await exists(item.path)) {
				await remove(item.path);
			}
			this.closePackagesItemModal();
			await this.refreshPackages(false);
			this.commandStatus = `Uninstalled theme ${item.name}.`;
		} catch (err) {
			this.commandStatus = `Failed to uninstall theme ${item.name}: ${err instanceof Error ? err.message : String(err)}`;
		} finally {
			this.runningCommand = false;
			this.render();
		}
	}

	private renderSkillContentBlock(): TemplateResult {
		if (this.activeSkillContentLoading) {
			return html`
				<div class="packages-skill-content">
					<div class="packages-empty">Loading skill content…</div>
				</div>
			`;
		}
		if (this.activeSkillContentError) {
			return html`
				<div class="packages-skill-content">
					<div class="packages-empty error">${this.activeSkillContentError}</div>
				</div>
			`;
		}
		if (this.activeSkillContent) {
			const doc = parseSkillDoc(this.activeSkillContent);
			const modalTitle = this.activePackagesModal?.kind === "recommended-skill"
				? this.activePackagesModal.item.definition.name
				: this.activePackagesModal?.kind === "skill"
					? this.activePackagesModal.item.name
					: "";
			const normalizedModalTitle = modalTitle.trim().toLowerCase();
			const sections = doc.sections.map((section, index) => {
				if (index === 0 && section.heading && normalizedModalTitle && section.heading.trim().toLowerCase() === normalizedModalTitle) {
					return { ...section, heading: null };
				}
				return section;
			});
			return html`
				<div class="packages-skill-content">
					<div class="packages-skill-doc">
						${doc.summary ? html`<div class="packages-skill-doc-summary">${doc.summary}</div>` : nothing}
						${sections.length > 0
							? sections.map((section) => html`
								<section class="packages-skill-doc-section">
									${section.heading ? html`<h4>${section.heading}</h4>` : nothing}
									${section.paragraphs.map((paragraph) => html`<p>${paragraph}</p>`) }
								</section>
							`)
							: html`<div class="packages-empty">No readable content found in SKILL.md.</div>`}
					</div>
				</div>
			`;
		}
		if (this.activeSkillContentNotice) {
			return html`
				<div class="packages-skill-content">
					<div class="packages-empty">${this.activeSkillContentNotice}</div>
				</div>
			`;
		}
		return html`
			<div class="packages-skill-content">
				<div class="packages-empty">Skill content not available.</div>
			</div>
		`;
	}

	private renderItemMetaRows(entries: Array<{ label: string; value: string }>): TemplateResult {
		return html`
			<div class="packages-item-meta-grid">
				${entries.map((entry) => html`
					<div class="packages-item-meta-row">
						<div class="packages-item-meta-label">${entry.label}</div>
						<div class="packages-item-meta-value" title=${entry.value}>${entry.value}</div>
					</div>
				`)}
			</div>
		`;
	}

	private renderPackagesItemModal(): TemplateResult | typeof nothing {
		const modal = this.activePackagesModal;
		if (!modal) return nothing;
		if (modal.kind === "extension") {
			const item = modal.item;
			const source = normalizeRecommendedSource(item.source);
			const commands = this.packageConfigCommands.get(source) ?? [];
			const installedForScope = item.installedItemForScope ?? this.findInstalledItemForSource(item.source, "global");
			const selectedScopeInstalled = item.installState.global;
			const pathNote = installedForScope?.location || "Not installed";
			return html`
				<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.closePackagesItemModal()}>
					<div class="overlay-card packages-config-modal packages-item-modal">
						<div class="overlay-header">
							<div>
								<div class="packages-config-modal-title">${item.displayName}</div>
							</div>
							<button @click=${() => this.closePackagesItemModal()}>✕</button>
						</div>
						<div class="overlay-body packages-config-modal-body">
							${item.description ? html`<div class="packages-section-desc">${item.description}</div>` : nothing}
							${this.renderItemMetaRows([
								{ label: "Source", value: item.source },
								{ label: "Status", value: selectedScopeInstalled ? "Installed" : "Not installed" },
								{ label: "Path", value: pathNote },
							])}

							${commands.length > 0
								? html`
									<div class="packages-section-submeta">Extension settings</div>
									${commands.map((command) => this.renderPackageConfigCommandEditor(source, command))}
								`
								: html`<div class="packages-empty">No extension settings commands discovered.</div>`}
							${this.packageConfigStatus ? html`<div class="packages-section-submeta">${this.packageConfigStatus}</div>` : nothing}

							<div class="packages-config-modal-actions">
								<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => void (selectedScopeInstalled ? this.uninstallExtensionItem(item) : this.installExtensionItem(item))}>
									${this.runningCommand ? (selectedScopeInstalled ? "Uninstalling…" : "Installing…") : selectedScopeInstalled ? "Uninstall" : "Install"}
								</button>
								${item.openUrl ? html`<button class="ghost-btn" @click=${() => void this.openExternal(item.openUrl!)}>Open page</button>` : nothing}
								${installedForScope?.location ? html`<button class="ghost-btn" @click=${() => void this.openPath(installedForScope.location)}>Open folder</button>` : nothing}
							</div>
						</div>
					</div>
				</div>
			`;
		}

		if (modal.kind === "theme") {
			const item = modal.item;
			return html`
				<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.closePackagesItemModal()}>
					<div class="overlay-card packages-config-modal packages-item-modal">
						<div class="overlay-header">
							<div>
								<div class="packages-config-modal-title">${item.name}</div>
							</div>
							<button @click=${() => this.closePackagesItemModal()}>✕</button>
						</div>
						<div class="overlay-body packages-config-modal-body">
							${item.description ? html`<div class="packages-section-desc">${item.description}</div>` : nothing}
							${this.renderItemMetaRows([
								{ label: "Type", value: `${item.variant === "dark" ? "Dark" : "Light"} theme` },
								{ label: "Path", value: item.path },
							])}
							<div class="packages-theme-preview-grid">
								<div class="packages-theme-preview-row">
									<span>Accent</span>
									<div class="packages-theme-color-chip"><span class="packages-theme-color-dot" style=${`background:${item.accent}`}></span>${item.accent}</div>
								</div>
								<div class="packages-theme-preview-row">
									<span>Background</span>
									<div class="packages-theme-color-chip"><span class="packages-theme-color-dot" style=${`background:${item.background}`}></span>${item.background}</div>
								</div>
								<div class="packages-theme-preview-row">
									<span>Foreground</span>
									<div class="packages-theme-color-chip"><span class="packages-theme-color-dot" style=${`background:${item.foreground}`}></span>${item.foreground}</div>
								</div>
							</div>
							<div class="packages-config-modal-actions">
								<button class="ghost-btn danger" ?disabled=${this.runningCommand || this.runningConfigCommand} @click=${() => void this.uninstallThemeItem(item)}>
									${this.runningCommand ? "Uninstalling…" : "Uninstall"}
								</button>
								<button class="ghost-btn" @click=${() => void this.openPath(pathDirName(item.path))}>Open folder</button>
							</div>
						</div>
					</div>
				</div>
			`;
		}

		if (modal.kind === "recommended-skill") {
			const item = modal.item;
			const definition = item.definition;
			const resource = item.resource;
			const commandText = resource?.commandText ?? `/skill:${definition.skillName}`;
			const skillPath = this.activeSkillContentPath;
			const skillOpenUrl = definition.openUrl ?? (resource?.packageSource ? this.resolveSourceUrl(resource.packageSource) : null);
			const skillContent = this.renderSkillContentBlock();
			const primaryLabel = this.runningCommand
				? item.installed
					? "Preparing…"
					: "Installing…"
				: item.installed
					? "Try in chat"
					: "Install + try";
			return html`
				<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.closePackagesItemModal()}>
					<div class="overlay-card packages-config-modal packages-item-modal">
						<div class="overlay-header">
							<div>
								<div class="packages-config-modal-title">${definition.name}</div>
							</div>
							<button @click=${() => this.closePackagesItemModal()}>✕</button>
						</div>
						<div class="overlay-body packages-config-modal-body">
							${definition.description ? html`<div class="packages-section-desc">${definition.description}</div>` : nothing}
							${this.renderItemMetaRows([
								{ label: "Command", value: commandText },
								{ label: "Status", value: item.installed ? "Installed" : "Not installed" },
								{ label: "Path", value: skillPath ?? "Install to view location" },
							])}
							${skillContent}
							${!this.activeSkillContent && !this.activeSkillContentLoading && definition.setupHint
								? html`<div class="packages-section-submeta">${definition.setupHint}</div>`
								: nothing}
							<div class="packages-config-modal-actions">
								<button
									class="ghost-btn"
									?disabled=${this.runningCommand || this.runningConfigCommand}
									@click=${() => void this.installRecommendedSkill(item)}
								>
									${primaryLabel}
								</button>
								${skillPath ? html`<button class="ghost-btn" @click=${() => void this.openPath(pathDirName(skillPath))}>Open folder</button>` : nothing}
								${skillOpenUrl ? html`<button class="ghost-btn" @click=${() => void this.openExternal(skillOpenUrl)}>Open page</button>` : nothing}
							</div>
						</div>
					</div>
				</div>
			`;
		}

		const item = modal.item;
		const canDelete = this.canEditResource(item);
		const skillOpenUrl = item.packageSource ? this.resolveSourceUrl(item.packageSource) : null;
		const skillPath = this.activeSkillContentPath ?? (item.path.trim() || null);
		const skillContent = this.renderSkillContentBlock();
		return html`
			<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.closePackagesItemModal()}>
				<div class="overlay-card packages-config-modal packages-item-modal">
					<div class="overlay-header">
						<div>
							<div class="packages-config-modal-title">${item.name}</div>
						</div>
						<button @click=${() => this.closePackagesItemModal()}>✕</button>
					</div>
					<div class="overlay-body packages-config-modal-body">
						${item.description ? html`<div class="packages-section-desc">${item.description}</div>` : nothing}
						${this.renderItemMetaRows([
							{ label: "Command", value: item.commandText },
							{ label: "Source", value: item.loaded ? "Runtime" : "File" },
							{ label: "Path", value: skillPath ?? "Runtime command" },
						])}
						${skillContent}
						<div class="packages-config-modal-actions">
							<button class="ghost-btn" ?disabled=${this.runningCommand || this.runningConfigCommand} @click=${() => void this.runSkill(item)}>Try in chat</button>
							${skillPath ? html`<button class="ghost-btn" @click=${() => void this.openPath(pathDirName(skillPath))}>Open folder</button>` : nothing}
							${skillOpenUrl
								? html`<button class="ghost-btn" @click=${() => void this.openExternal(skillOpenUrl)}>Open page</button>`
								: nothing}
							${canDelete
								? html`<button class="ghost-btn danger" ?disabled=${this.deletingResource} @click=${() => void this.deleteResource(item)}>${this.deletingResource ? "Removing…" : "Uninstall skill"}</button>`
								: nothing}
						</div>
					</div>
				</div>
			</div>
		`;
	}

	private renderPackageRow(options: {
		title: string;
		description: string;
		note?: string | null;
		badges?: TemplateResult[];
		iconName?: UiIcon;
		actions?: TemplateResult | typeof nothing;
		titleAttr?: string;
		onTitleClick?: (() => void) | null;
	}): TemplateResult {
		const iconName = options.iconName ?? "package";
		return html`
			<div class="packages-list-row" title=${options.titleAttr ?? ""}>
				<div class="packages-list-row-icon ${iconName}">
					<span class="packages-inline-icon">${icon(iconName)}</span>
				</div>
				<div class="packages-list-row-main">
					<div class="packages-list-row-top">
						${options.onTitleClick
							? html`
								<button class="packages-list-row-title packages-list-row-title-link" @click=${() => options.onTitleClick?.()}>
									${options.title}
								</button>
							`
							: html`<div class="packages-list-row-title">${options.title}</div>`}
						${options.badges && options.badges.length > 0
							? html`<div class="packages-list-row-badges">${options.badges}</div>`
							: nothing}
					</div>
					<div class="packages-list-row-sub">${options.description}</div>
					${options.note ? html`<div class="packages-list-row-note">${options.note}</div>` : nothing}
				</div>
				${options.actions ? html`<div class="packages-list-row-actions">${options.actions}</div>` : nothing}
			</div>
		`;
	}

	render(): void {
		const installedItems = this.getInstalledItems();
		const catalogItems = this.filteredCatalogItems();
		const skillResources = this.filteredSkillResources();
		const themeResources = this.filteredThemeResources().filter((item) => !isBundledThemeId(item.id));
		const query = this.normalizeQuery();
		const hasQuery = query.length > 0;
		const queryLabel = this.query.trim();
		const recommendedSkills = this.buildRecommendedSkillItems().filter((item) => {
			if (!query) return true;
			return `${item.definition.name} ${item.definition.description}`.toLowerCase().includes(query);
		});
		const recommendedSkillNames = this.recommendedSkillNameSet(recommendedSkills);
		const visibleSkillResources = skillResources.filter((item) => !recommendedSkillNames.has(item.name.toLowerCase()));
		const recommendedExtensions = this.buildRecommendedExtensionItems().filter((item) => {
			if (!query) return true;
			return `${item.displayName} ${item.description} ${item.note ?? ""}`.toLowerCase().includes(query);
		});
		const recommendedExtensionSources = new Set(
			RECOMMENDED_PACKAGES.map((item) => normalizeRecommendedSource(item.source)),
		);
		const recommendedPackages = RECOMMENDED_PACKAGES.filter((item) => {
			if (!query) return true;
			return `${item.name} ${item.description} ${item.installSourceHint}`.toLowerCase().includes(query);
		});
		const extensionSurfaces = this.buildExtensionSurfaceItems(recommendedPackages, catalogItems, installedItems);
		const extensionInstalled = extensionSurfaces.installed;
		const extensionDiscover = hasQuery
			? extensionSurfaces.gallery.filter((item) => !recommendedExtensionSources.has(normalizeRecommendedSource(item.source)))
			: [];
		const galleryItems = !hasQuery
			? extensionSurfaces.gallery
					.filter((item) => !recommendedExtensionSources.has(normalizeRecommendedSource(item.source)))
					.slice(0, 12)
			: [];

		const installedRecommendedSkills = recommendedSkills.filter((item) => item.installed);
		const availableRecommendedSkills = recommendedSkills.filter((item) => !item.installed);
		const availableRecommendedExtensions = recommendedExtensions.filter((item) => !item.installState.global);

		type RowOptions = {
			title: string;
			description: string;
			note?: string | null;
			badges?: TemplateResult[];
			iconName?: UiIcon;
			actions?: TemplateResult | typeof nothing;
			titleAttr?: string;
			onTitleClick?: (() => void) | null;
		};

		const installedRowsData: Array<{ sortKey: string; options: RowOptions }> = [];
		const discoverRowsData: Array<{ sortKey: string; priority: number; options: RowOptions }> = [];
		const recommendedBadge = html`<span class="packages-card-scope recommended">Recommended</span>`;
		const extensionIconFor = (item: ExtensionSurfaceItem): UiIcon =>
			normalizeRecommendedSource(item.source) === DESKTOP_THEMES_PACKAGE_SOURCE ? "theme" : "extension";

		const addInstalledRow = (sortKey: string, options: RowOptions) => {
			installedRowsData.push({ sortKey, options });
		};

		const addDiscoverRow = (priority: number, sortKey: string, options: RowOptions) => {
			discoverRowsData.push({ priority, sortKey, options });
		};

		for (const item of installedRecommendedSkills) {
			const note = item.resource?.path || `Package: ${this.getDisplayName(item.definition.packageSource)}`;
			addInstalledRow(item.definition.name.toLowerCase(), {
				title: item.definition.name,
				description: item.resource?.description || item.definition.description,
				note,
				iconName: "skill",
				actions: html`<button class="packages-row-install installed" title="Installed" @click=${() => void this.openPackagesItemModal({ kind: "recommended-skill", item })}>✓</button>`,
				onTitleClick: () => void this.openPackagesItemModal({ kind: "recommended-skill", item }),
				titleAttr: item.definition.skillName,
			});
		}

		for (const item of visibleSkillResources) {
			addInstalledRow(item.name.toLowerCase(), {
				title: item.name,
				description: item.description || "Skill",
				note: item.path || (item.packageDisplayName ? `Package: ${item.packageDisplayName}` : "Runtime command"),
				iconName: "skill",
				actions: html`<button class="packages-row-install installed" title="Installed" @click=${() => void this.openPackagesItemModal({ kind: "skill", item })}>✓</button>`,
				onTitleClick: () => void this.openPackagesItemModal({ kind: "skill", item }),
				titleAttr: item.path || item.commandText,
			});
		}

		for (const item of themeResources) {
			addInstalledRow(`theme:${item.name.toLowerCase()}`, {
				title: item.name,
				description: item.description,
				note: item.path,
				iconName: "theme",
				actions: html`<button class="packages-row-install installed" title="Installed" @click=${() => void this.openPackagesItemModal({ kind: "theme", item })}>✓</button>`,
				onTitleClick: () => void this.openPackagesItemModal({ kind: "theme", item }),
				titleAttr: item.path,
			});
		}

		for (const item of extensionInstalled) {
			addInstalledRow(item.displayName.toLowerCase(), {
				title: item.displayName,
				description: item.description || item.source,
				note: item.note,
				iconName: extensionIconFor(item),
				actions: html`<button class="packages-row-install installed" title="Installed" @click=${() => void this.openPackagesItemModal({ kind: "extension", item })}>✓</button>`,
				onTitleClick: () => void this.openPackagesItemModal({ kind: "extension", item }),
				titleAttr: item.source,
			});
		}

		for (const item of availableRecommendedSkills) {
			addDiscoverRow(0, item.definition.name.toLowerCase(), {
				title: item.definition.name,
				description: item.definition.description,
				note: `Package: ${this.getDisplayName(item.definition.packageSource)}`,
				iconName: "skill",
				badges: [recommendedBadge],
				actions: html`
					<button
						class="packages-row-install add"
						?disabled=${this.runningCommand}
						title="Install"
						@click=${() => void this.installRecommendedSkill(item)}
					>
						+
					</button>
				`,
				onTitleClick: () => void this.openPackagesItemModal({ kind: "recommended-skill", item }),
				titleAttr: item.definition.skillName,
			});
		}

		for (const item of availableRecommendedExtensions) {
			addDiscoverRow(0, item.displayName.toLowerCase(), {
				title: item.displayName,
				description: item.description || item.source,
				note: item.note,
				iconName: extensionIconFor(item),
				badges: [recommendedBadge],
				actions: html`
					<button
						class="packages-row-install add"
						?disabled=${this.runningCommand}
						title="Open"
						@click=${() => void this.openPackagesItemModal({ kind: "extension", item })}
					>
						+
					</button>
				`,
				onTitleClick: () => void this.openPackagesItemModal({ kind: "extension", item }),
				titleAttr: item.source,
			});
		}

		for (const item of galleryItems) {
			addDiscoverRow(1, item.displayName.toLowerCase(), {
				title: item.displayName,
				description: item.description || item.source,
				note: item.note,
				iconName: extensionIconFor(item),
				badges: [html`<span class="packages-card-scope">${sourceKindLabel(item.sourceKind)}</span>`],
				actions: html`
					<button
						class="packages-row-install add"
						?disabled=${this.runningCommand}
						title="Open"
						@click=${() => void this.openPackagesItemModal({ kind: "extension", item })}
					>
						+
					</button>
				`,
				onTitleClick: () => void this.openPackagesItemModal({ kind: "extension", item }),
				titleAttr: item.openUrl || item.source,
			});
		}

		for (const item of extensionDiscover) {
			addDiscoverRow(1, item.displayName.toLowerCase(), {
				title: item.displayName,
				description: item.description || item.source,
				note: item.note,
				iconName: "extension",
				actions: html`
					<button
						class="packages-row-install add"
						?disabled=${this.runningCommand}
						title="Open"
						@click=${() => void this.openPackagesItemModal({ kind: "extension", item })}
					>
						+
					</button>
				`,
				onTitleClick: () => void this.openPackagesItemModal({ kind: "extension", item }),
				titleAttr: item.openUrl || item.source,
			});
		}

		const sortedInstalled = installedRowsData.sort((a, b) => {
			const typeOrder = (opt: { sortKey: string; options: RowOptions }) => (opt.options.iconName === "skill" ? 0 : opt.options.iconName === "extension" ? 1 : 2);
			const ta = typeOrder(a);
			const tb = typeOrder(b);
			if (ta !== tb) return ta - tb;
			return a.sortKey.localeCompare(b.sortKey);
		});
		const installedRows = sortedInstalled.map((entry) => this.renderPackageRow(entry.options));

		const discoverRows = discoverRowsData
			.sort((a, b) => a.priority - b.priority || a.sortKey.localeCompare(b.sortKey))
			.map((entry) => this.renderPackageRow(entry.options));
		const installedCount = sortedInstalled.length;
		const discoverCount = discoverRows.length;
		const installedLoading = this.loadingResources || this.loadingConfig;
		const discoverLoading = this.loadingCatalog && hasQuery;
		const discoverTitle = hasQuery ? "Results" : "Recommended";
		const discoverSubmeta = hasQuery
			? `Results for “${queryLabel}”.`
			: "Recommended skills and extensions to get started.";
		const discoverEmptyMessage = hasQuery ? "No matches found." : "No recommendations available.";
		const notifyDebugLines = this.getNotifyDebugLines();
		const hasDiagnostics = this.runningCommand || this.statusTone() === "error" || notifyDebugLines.length > 0 || this.commandOutput.trim().length > 0;
		const diagnosticsOpen = this.runningCommand || this.statusTone() === "error";
		const loadingPackagesInitial = (this.loadingConfig || this.loadingResources) &&
			installedCount === 0 &&
			!this.configError &&
			!this.resourcesError;

		const template = html`
			<div class="packages-view-root">
				<div class="packages-view-header">
					<div class="packages-view-title-wrap">
						<div class="packages-view-title">Packages</div>
					</div>
					<div class="packages-view-header-actions">
						<button class="packages-back-btn" ?disabled=${this.runningCommand} @click=${() => void this.refreshPackages(true)}>Refresh</button>
						<button class="packages-back-btn" ?disabled=${this.runningCommand || this.runningConfigCommand} @click=${() => void this.triggerCreatorSkillInChat()}>Create skill</button>
						<button class="packages-back-btn" @click=${() => void this.openCatalog()}>Browse</button>
						${this.onBack
							? html`<button class="packages-back-btn" @click=${() => this.onBack?.()}>← Back</button>`
							: nothing}
					</div>
				</div>

				<div class="packages-view-body minimal">
					${this.commandStatus ? html`<div class="packages-banner ${this.statusTone()}">${this.commandStatus}</div>` : nothing}
					${this.configError ? html`<div class="packages-banner error">Config error: ${this.configError}</div>` : nothing}
					${this.resourcesError ? html`<div class="packages-banner error">Resource error: ${this.resourcesError}</div>` : nothing}
					${this.catalogError ? html`<div class="packages-banner error">Catalog error: ${this.catalogError}</div>` : nothing}

					${loadingPackagesInitial
						? html`<div class="packages-loading-state">Loading packages…</div>`
						: html`
							<section class="packages-section">
								<div class="packages-section-head">
									<div>
										<div class="packages-section-title">Installed</div>
										<div class="packages-section-submeta">Skills and extensions available in this session.</div>
									</div>
								</div>
								${installedLoading
									? html`<div class="packages-empty">Loading installed items…</div>`
									: installedRows.length === 0
										? html`<div class="packages-empty">No packages installed yet.</div>`
										: html`
											<div class="packages-list packages-list-grid">
												${installedRows}
											</div>
										`}
							</section>

							<section class="packages-section packages-section-discover">
								<div class="packages-section-head">
									<div>
										<div class="packages-section-title">${discoverTitle}</div>
										<div class="packages-section-submeta">${discoverSubmeta}</div>
									</div>
								</div>
								${discoverLoading
									? html`<div class="packages-empty">Loading results…</div>`
									: discoverRows.length === 0
										? html`<div class="packages-empty">${discoverEmptyMessage}</div>`
										: html`
											<div class="packages-list packages-list-grid">
												${discoverRows}
											</div>
										`}
							</section>

							${hasDiagnostics
								? html`
									<details class="packages-diagnostics" ?open=${diagnosticsOpen}>
										<summary>Diagnostics</summary>
										<div class="packages-diagnostics-actions">
											<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => void this.updatePackages()}>Update target</button>
											<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => void this.listPackages()}>List target</button>
											<button class="ghost-btn" ?disabled=${this.runningCommand || this.loadingResources} @click=${() => void this.refreshDiscoveredResources()}>Refresh skills</button>
											<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => void this.runDesktopNotificationSmokeTest()}>Test desktop notifications</button>
											<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => this.render()}>Refresh logs</button>
										</div>
										<pre class="tool-output packages-command-log">${this.commandOutput || "No package command run yet."}</pre>
										<pre class="tool-output packages-command-log">${notifyDebugLines.length > 0 ? notifyDebugLines.join("\n") : "No notify trace lines yet."}</pre>
									</details>
								`
								: nothing}
						`}
				</div>
			</div>
			${this.renderPackagesItemModal()}
			${this.renderResourceCreatorModal()}
		`;

		render(template, this.container);
	}

}
