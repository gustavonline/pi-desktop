/**
 * ChatView - rich RPC chat surface for Pi Desktop
 */

import "@mariozechner/mini-lit/dist/CodeBlock.js";
import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import { html, nothing, render, type TemplateResult } from "lit";
import {
	type PiAuthProviderStatus,
	type RpcImageInput,
	type RpcSessionState,
	type ThinkingLevel,
	rpcBridge,
} from "../rpc/bridge.js";
import { buildGitBranchIndex, findGitBranchEntryByQuery, type GitBranchEntry } from "../git/branches.js";

type DeliveryMode = "prompt" | "steer" | "followUp";

type UiRole = "user" | "assistant" | "system" | "custom";

interface PendingImage {
	id: string;
	name: string;
	mimeType: string;
	data: string;
	previewUrl: string;
	size: number;
}

interface QueuedComposerMessage {
	id: string;
	text: string;
	attachments: PendingImage[];
	imageCount: number;
	createdAt: number;
}

interface ToolCallBlock {
	id: string;
	name: string;
	args: Record<string, unknown>;
	result?: string;
	streamingOutput?: string;
	isError?: boolean;
	isRunning: boolean;
	isExpanded: boolean;
	startedAt?: number;
	endedAt?: number;
}

interface UiMessage {
	id: string;
	sessionEntryId?: string;
	role: UiRole;
	text: string;
	toolCalls: ToolCallBlock[];
	attachments?: PendingImage[];
	thinking?: string;
	thinkingExpanded?: boolean;
	thinkingScrollTop?: number;
	isThinkingStreaming?: boolean;
	isStreaming?: boolean;
	errorText?: string;
	deliveryMode?: DeliveryMode;
	label?: string;
	renderAsMarkdown?: boolean;
	collapsibleTitle?: string;
	collapsibleExpanded?: boolean;
}

interface Notice {
	id: string;
	text: string;
	kind: "info" | "success" | "error";
}

interface ModelOption {
	provider: string;
	id: string;
	label: string;
	reasoning: boolean;
	contextWindow?: number;
}

interface ForkOption {
	entryId: string;
	text: string;
}

interface ForkTimelineRow {
	main: UiMessage;
	sourceIndex: number;
	thinkingSnippets: string[];
	tools: ToolCallBlock[];
}

interface SessionTreeEntryRecord {
	id: string;
	parentId: string | null;
	type: string;
	index: number;
	role: UiRole;
	entryLabel: string;
	preview: string;
	displayText: string;
	canFork: boolean;
}

interface HistoryTreeRow {
	entryId: string;
	depth: number;
	role: UiRole;
	entryLabel: string;
	preview: string;
	displayText: string;
	linePrefix: string;
	onActivePath: boolean;
	canFork: boolean;
}

interface SessionStatsSummary {
	tokens: number | null;
	lifetimeTokens: number | null;
	costUsd: number | null;
	messageCount: number;
	pendingCount: number;
	contextWindow: number | null;
	usageRatio: number | null;
	updatedAt: number;
}

interface GitSummary {
	isRepo: boolean;
	branch: string | null;
	branches: string[];
	branchEntries: GitBranchEntry[];
	hasRemoteBranches: boolean;
	dirtyFiles: number;
	additions: number;
	deletions: number;
	updatedAt: number;
}

interface WelcomeDashboardSummary {
	loading: boolean;
	skills: string[];
	extensions: string[];
	themes: string[];
	currentCliVersion: string | null;
	latestCliVersion: string | null;
	updateAvailable: boolean;
	error: string | null;
	updatedAt: number;
}

interface WelcomeProjectSummary {
	id: string;
	name: string;
	path: string;
}

interface ComposerSkillDraft {
	name: string;
	commandText: string;
	scope: string | null;
}

type SlashPaletteSection = "CLI" | "Extensions" | "Prompts" | "Skills";
type SlashCommandSource = "builtin" | "extension" | "prompt" | "skill";

interface RuntimeSlashCommand {
	name: string;
	description: string;
	source: "extension" | "prompt" | "skill";
}

interface SlashPaletteItem {
	id: string;
	section: SlashPaletteSection;
	label: string;
	hint: string;
	commandName: string;
	source: SlashCommandSource;
}

interface ToolCallGroup {
	id: string;
	toolName: string;
	preview: string;
	calls: ToolCallBlock[];
}

interface CompactionCycleState {
	id: string;
	status: "running" | "done" | "aborted" | "error";
	startedAt: number;
	endedAt: number | null;
	summary: string;
	errorMessage: string | null;
	details: string[];
	expanded: boolean;
}

function runtimeCommandUsageHint(name: string): string | null {
	const normalized = normalizeText(name).toLowerCase().replace(/^\/+/, "");
	if (normalized === "auto-rename" || normalized === "name-ai-config") {
		return "Args: config, test, init, regen, <name>";
	}
	if (normalized === "voice-notify") {
		return "No arg opens extension settings; args: status, reload, on, off, test <idle|permission|question|error>";
	}
	return null;
}

function runtimeCommandDescriptionOverride(name: string, description: string): string | null {
	const normalizedName = normalizeText(name).toLowerCase().replace(/^\/+/, "");
	if (normalizedName === "voice-notify") {
		return "Voice notifications: no arg opens extension settings, or use status/reload/on/off/test";
	}
	const normalizedDescription = normalizeText(description);
	if (/^configure windows smart voice notifications$/i.test(normalizedDescription)) {
		return "Voice notifications: no arg opens extension settings, or use status/reload/on/off/test";
	}
	return null;
}

function withRuntimeCommandUsageHint(name: string, description: string): string {
	const override = runtimeCommandDescriptionOverride(name, description);
	if (override) return override;
	const normalizedDescription = normalizeText(description);
	const hint = runtimeCommandUsageHint(name);
	if (!hint) return normalizedDescription;
	if (!normalizedDescription) return hint;
	const lower = normalizedDescription.toLowerCase();
	const normalizedName = normalizeText(name).toLowerCase().replace(/^\/+/, "");
	if (normalizedName === "auto-rename" && lower.includes("config") && lower.includes("test")) {
		return normalizedDescription;
	}
	if (
		normalizedName === "voice-notify" &&
		lower.includes("status") &&
		lower.includes("reload") &&
		lower.includes("test")
	) {
		return normalizedDescription;
	}
	return `${normalizedDescription} · ${hint}`;
}

const BUILTIN_SLASH_COMMANDS: Array<{ name: string; description: string }> = [
	{ name: "settings", description: "Open Desktop settings" },
	{ name: "model", description: "No arg opens picker; exact arg sets model, otherwise opens picker near matches" },
	{ name: "scoped-models", description: "Open Settings scoped-models editor (Ctrl+P model cycle scope)" },
	{ name: "export", description: "No arg opens save dialog, /export <path> writes HTML directly" },
	{ name: "import", description: "No arg opens file picker, /import <path> imports a session file" },
	{ name: "share", description: "Create secret gist and post minimal links to pi.dev + GitHub gist" },
	{ name: "copy", description: "Copy last assistant message" },
	{ name: "name", description: "No arg opens inline rename, /name <text> sets name directly" },
	{ name: "session", description: "Append detailed session info + token stats" },
	{ name: "changelog", description: "Show latest changelog in collapsible row (/changelog all, /changelog refresh)" },
	{ name: "hotkeys", description: "Open keyboard shortcuts" },
	{ name: "terminal", description: "Toggle docked terminal" },
	{ name: "fork", description: "Open fork flow, /fork <query> pre-fills message search" },
	{ name: "tree", description: "Open full session tree across branches, /tree <query> pre-fills search" },
	{ name: "login", description: "No arg opens model picker auth actions; /login <provider> opens setup" },
	{ name: "logout", description: "No arg opens model picker auth actions; /logout <provider> clears auth.json credentials" },
	{ name: "new", description: "Start fresh session tab" },
	{ name: "compact", description: "Manually compact context, /compact <instructions> optional" },
	{ name: "resume", description: "Open session browser, /resume <query> pre-fills search" },
	{ name: "reload", description: "Reload runtime (bridge restart + state/models/commands refresh)" },
	{ name: "quit", description: "Quit Desktop app" },
];

const MODEL_PICKER_AUTH_CACHE_MS = 15_000;
const MODEL_PICKER_CATALOG_CACHE_MS = 60_000;

// Mirrors built-in OAuth providers from @mariozechner/pi-ai/oauth.
const DEFAULT_OAUTH_PROVIDER_IDS = [
	"anthropic",
	"github-copilot",
	"google-gemini-cli",
	"google-antigravity",
	"openai-codex",
] as const;
const DEFAULT_OAUTH_PROVIDER_SET = new Set<string>(DEFAULT_OAUTH_PROVIDER_IDS);

function uid(prefix = "id"): string {
	return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function truncate(value: string, len: number): string {
	if (value.length <= len) return value;
	return `${value.slice(0, len - 1)}…`;
}

function joinFsPath(base: string, child: string): string {
	const sep = base.includes("\\") ? "\\" : "/";
	const cleanBase = base.replace(/[\\/]+$/, "");
	return `${cleanBase}${sep}${child}`;
}

function normalizeComparablePath(value: string | null | undefined): string {
	return (value ?? "").replace(/\\/g, "/").replace(/\/+$|\s+$/g, "").toLowerCase();
}

function formatUsd(value: number): string {
	if (value < 0.01) return `$${value.toFixed(3)}`;
	return `$${value.toFixed(2)}`;
}

function formatAge(ts: number): string {
	if (!ts) return "";
	const diff = Math.max(0, Date.now() - ts);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (diff < minute) return "just now";
	if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
	if (diff < day) return `${Math.floor(diff / hour)}h ago`;
	return `${Math.floor(diff / day)}d ago`;
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(1, Math.round(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

function readNumberPath(source: Record<string, unknown>, path: string): number | null {
	const parts = path.split(".");
	let current: unknown = source;
	for (const part of parts) {
		if (!current || typeof current !== "object") return null;
		current = (current as Record<string, unknown>)[part];
	}
	if (typeof current === "number" && Number.isFinite(current)) return current;
	if (typeof current === "string") {
		const cleaned = current.replace(/,/g, "").trim();
		const parsedDirect = Number(cleaned);
		if (Number.isFinite(parsedDirect)) return parsedDirect;
		const match = cleaned.match(/-?\d+(?:\.\d+)?/);
		if (match) {
			const parsed = Number(match[0]);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}

function pickNumber(source: Record<string, unknown>, paths: string[]): number | null {
	for (const path of paths) {
		const value = readNumberPath(source, path);
		if (value !== null) return value;
	}
	return null;
}

function readStringPath(source: Record<string, unknown>, path: string): string | null {
	const parts = path.split(".");
	let current: unknown = source;
	for (const part of parts) {
		if (!current || typeof current !== "object") return null;
		current = (current as Record<string, unknown>)[part];
	}
	if (typeof current === "string") {
		const value = current.trim();
		return value.length > 0 ? value : null;
	}
	if (typeof current === "number" || typeof current === "boolean") {
		return String(current);
	}
	if (current && typeof current === "object") {
		const nested = current as Record<string, unknown>;
		for (const key of ["name", "label", "id", "model", "provider"]) {
			const value = nested[key];
			if (typeof value === "string" && value.trim().length > 0) return value.trim();
		}
	}
	return null;
}

function pickString(source: Record<string, unknown>, paths: string[]): string | null {
	for (const path of paths) {
		const value = readStringPath(source, path);
		if (value !== null) return value;
	}
	return null;
}

function normalizeText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value && typeof value === "object") {
		const nested = value as Record<string, unknown>;
		for (const key of ["name", "label", "id", "model", "provider"]) {
			const candidate = nested[key];
			if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
		}
	}
	return "";
}

function formatProviderDisplayName(provider: string): string {
	const normalized = normalizeText(provider).toLowerCase();
	switch (normalized) {
		case "openai":
			return "OpenAI";
		case "openai-codex":
			return "OpenAI Codex";
		case "anthropic":
			return "Anthropic";
		case "google":
		case "googleai":
		case "gemini":
			return "Google";
		case "google-gemini-cli":
			return "Google Gemini CLI";
		case "google-antigravity":
			return "Google Antigravity";
		case "github-copilot":
			return "GitHub Copilot";
		case "xai":
			return "xAI";
		case "openrouter":
			return "OpenRouter";
		case "ollama":
			return "Ollama";
		case "lmstudio":
			return "LM Studio";
		case "cursor-agent":
			return "Cursor";
		case "kilo":
			return "Kilo";
		default:
			return normalized
				.split(/[-_\s]+/)
				.filter(Boolean)
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(" ");
	}
}

function formatModelDisplayName(modelId: string): string {
	const raw = normalizeText(modelId);
	if (!raw) return "Model";
	let value = raw.replace(/^models\//i, "").trim();
	value = value.replace(/^(openai|anthropic|google|xai|openrouter|ollama|lmstudio)[:/]/i, "");
	if (!value) return "Model";
	if (/^gpt/i.test(value)) return value.replace(/^gpt/i, "GPT");
	if (/^claude/i.test(value)) {
		const tail = value.slice("claude".length).replace(/^[-_\s]+/, "");
		if (!tail) return "Claude";
		const humanTail = tail
			.replace(/[-_]+/g, " ")
			.split(/\s+/)
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
		return `Claude ${humanTail}`;
	}
	if (/^gemini/i.test(value)) return value.replace(/^gemini/i, "Gemini");
	return value
		.replace(/[-_]+/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function parseListModelsContextWindow(raw: string): number | undefined {
	const token = normalizeText(raw).toLowerCase();
	if (!token) return undefined;
	const match = token.match(/^(\d+(?:\.\d+)?)([km])?$/i);
	if (!match) return undefined;
	const base = Number(match[1]);
	if (!Number.isFinite(base) || base <= 0) return undefined;
	const unit = match[2]?.toLowerCase();
	if (unit === "k") return Math.round(base * 1_000);
	if (unit === "m") return Math.round(base * 1_000_000);
	return Math.round(base);
}

function parseListModelsCatalog(output: string): ModelOption[] {
	const mapped: ModelOption[] = [];
	const seen = new Set<string>();
	for (const rawLine of output.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		if (/^provider\s+/i.test(trimmed)) continue;
		if (/^[\-=]{3,}/.test(trimmed)) continue;
		const cols = trimmed.split(/\s+/);
		if (cols.length < 2) continue;
		const provider = cols[0]?.trim();
		const id = cols[1]?.trim();
		if (!provider || !id) continue;
		const key = `${provider.toLowerCase()}::${id.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		mapped.push({
			provider,
			id,
			label: `${provider}/${id}`,
			reasoning: (cols[4] || "").toLowerCase() === "yes",
			contextWindow: parseListModelsContextWindow(cols[2] || ""),
		});
	}
	mapped.sort((a, b) => {
		const providerCompare = formatProviderDisplayName(a.provider).localeCompare(formatProviderDisplayName(b.provider), undefined, {
			sensitivity: "base",
		});
		if (providerCompare !== 0) return providerCompare;
		return formatModelDisplayName(a.id).localeCompare(formatModelDisplayName(b.id), undefined, { sensitivity: "base" });
	});
	return mapped;
}

function formatThinkingDisplayName(level: ThinkingLevel): string {
	switch (level) {
		case "off":
			return "off";
		case "minimal":
			return "minimal";
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return "xhigh";
		default:
			return "off";
	}
}

const THINKING_LEVEL_CYCLE_ORDER: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function uiIcon(name: "edit" | "retry" | "copy" | "attach" | "send" | "stop" | "spinner" | "spark" | "terminal" | "git"): TemplateResult {
	switch (name) {
		case "edit":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 11.8l.5-2.5L10.2 2.8a1.2 1.2 0 0 1 1.7 0l1.3 1.3a1.2 1.2 0 0 1 0 1.7l-6.5 6.5z"></path><path d="M3.2 11.8l2.5-.5"></path></svg>`;
		case "retry":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.7 8a4.7 4.7 0 1 1-1.4-3.4"></path><path d="M12.7 4.2v2.4h-2.4"></path></svg>`;
		case "copy":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.4"></rect><rect x="3" y="3" width="8" height="8" rx="1.4"></rect></svg>`;
		case "attach":
			return html`
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M4.2 2.6h5.1l2.5 2.5v7.1a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 12.2V3.8a1.2 1.2 0 0 1 1.2-1.2z"></path>
					<path d="M9.3 2.6v2.5h2.5"></path>
					<path d="M5.6 4.5v3.6a2.4 2.4 0 1 0 4.8 0V4.9a1.6 1.6 0 1 0-3.2 0v3a.8.8 0 1 0 1.6 0V5.5"></path>
				</svg>
			`;
		case "send":
			return html`<svg class="send-arrow-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.7V3.6"></path><path d="M4.6 7L8 3.6 11.4 7"></path></svg>`;
		case "stop":
			return html`<svg class="stop-square-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="4.9" y="4.9" width="6.2" height="6.2" rx="1.2"></rect></svg>`;
		case "spinner":
			return html`<svg class="spinner-icon" viewBox="0 0 16 16" aria-hidden="true"><circle class="spinner-track" cx="8" cy="8" r="5.4"></circle><path class="spinner-arc" d="M8 2.6a5.4 5.4 0 0 1 5.4 5.4"></path></svg>`;
		case "spark":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l1.3 3.1 3.2 1.3-3.2 1.3L8 11.3l-1.3-3.1-3.2-1.3 3.2-1.3z"></path></svg>`;
		case "terminal":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2h10v9.6H3z"></path><path d="M5.1 6.2l1.9 1.8-1.9 1.8"></path><path d="M8.6 9.8h2.6"></path></svg>`;
		case "git":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="3.6" r="1.2"></circle><circle cx="4" cy="12.4" r="1.2"></circle><circle cx="12" cy="8" r="1.2"></circle><path d="M4 4.8v6.4"></path><path d="M5 4.2l5.8 2.9"></path><path d="M5 11.8l5.8-2.9"></path></svg>`;
	}
}

function skillGlyphIcon(): TemplateResult {
	return html`<svg class="filled" viewBox="0 0 20 20" aria-hidden="true"><path d="M9.2 2.3a1.5 1.5 0 0 1 3 0v3.8h.8V3.8a1.5 1.5 0 0 1 3 0v6.4a4.8 4.8 0 0 1-4.8 4.8H9.8A4.8 4.8 0 0 1 5 10.2V7.8a1.5 1.5 0 1 1 3 0v1.4h.8V2.3a1.5 1.5 0 0 1 .4-1z"></path></svg>`;
}

function piGlyphIcon(): TemplateResult {
	return html`
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3.3 3.3H10.3V8H8V10.3H5.7V12.7H3.3Z"></path>
			<path d="M10.3 8H12.7V12.7H10.3Z"></path>
		</svg>
	`;
}

export class ChatView {
	private container: HTMLElement;
	private messages: UiMessage[] = [];
	private inputText = "";
	private state: RpcSessionState | null = null;
	private isConnected = false;
	private scrollContainer: HTMLElement | null = null;
	private unsubscribeEvents: (() => void) | null = null;
	private nativeFileDropUnlisteners: Array<() => void> = [];
	private lastDropSignature = "";
	private lastDropAt = 0;
	private onStateChange: ((state: RpcSessionState) => void) | null = null;
	private onOpenTerminal: (() => void) | null = null;
	private onAddProject: (() => void) | null = null;
	private onOpenSettings: ((sectionId?: string) => void) | null = null;
	private onOpenPackages: (() => void) | null = null;
	private onOpenExtensionConfig: ((commandName: string, args: string) => boolean | Promise<boolean>) | null = null;
	private onOpenProviderConfig: ((provider: string) => boolean | Promise<boolean>) | null = null;
	private onBeginRenameCurrentSession: (() => boolean | Promise<boolean>) | null = null;
	private onRenameCurrentSession: ((nextName: string) => boolean | Promise<boolean>) | null = null;
	private onCreateFreshSession: (() => boolean | Promise<boolean>) | null = null;
	private onReloadRuntime: (() => boolean | Promise<boolean>) | null = null;
	private onOpenSessionBrowser: ((query?: string) => void) | null = null;
	private onOpenShortcuts: (() => void) | null = null;
	private onQuitApp: (() => void) | null = null;
	private onSelectWelcomeProject: ((projectId: string) => void) | null = null;
	private onPromptSubmitted: (() => void) | null = null;
	private onRunStateChange: ((running: boolean) => void) | null = null;
	private availableModels: ModelOption[] = [];
	private modelCatalog: ModelOption[] = [];
	private loadingModels = false;
	private loadingModelCatalog = false;
	private loadingProviderAuth = false;
	private modelLoadRequestSeq = 0;
	private modelCatalogLoadedAt = 0;
	private providerAuthLoadedAt = 0;
	private providerAuthById = new Map<string, Pick<PiAuthProviderStatus, "source" | "kind">>();
	private providerAuthConfigured = new Set<string>();
	private providerAuthForcedLoggedOut = new Set<string>();
	private lastBackendRefreshError: string | null = null;
	private lastModelLoadError: string | null = null;
	private lastBackendSessionFile: string | null = null;
	private settingModel = false;
	private settingThinking = false;
	private unsupportedThinkingLevelsByModel = new Map<string, Set<ThinkingLevel>>();
	private modelPickerOpen = false;
	private modelPickerActiveProvider = "";
	private modelPickerGlobalListenersBound = false;
	private runningProviderAuthAction: { provider: string; action: "login" | "logout" } | null = null;
	private sendingPrompt = false;
	private pendingImages: PendingImage[] = [];
	private notices: Notice[] = [];
	private changelogCacheMarkdown: string | null = null;
	private changelogCacheAt = 0;
	private loadingChangelog = false;
	private allThinkingExpanded = false;
	private retryStatus = "";
	private compactionCycle: CompactionCycleState | null = null;
	private compactionInsertIndex: number | null = null;
	private lastRuntimeNoticeSignature = "";
	private lastRuntimeNoticeAt = 0;
	private extensionCompatibilityHintsShown = new Set<string>();
	private pendingDeliveryMode: DeliveryMode = "prompt";
	private queuedComposerMessages: QueuedComposerMessage[] = [];
	private openingForkPicker = false;
	private forkPickerOpen = false;
	private forkOptions: ForkOption[] = [];
	private historyViewerOpen = false;
	private historyViewerMode: "browse" | "fork" = "browse";
	private historyViewerLoading = false;
	private historyViewerSessionLabel = "";
	private historyTreeRows: HistoryTreeRow[] = [];
	private historyTreeRequestSeq = 0;
	private forkEntryIdByMessageId = new Map<string, string>();
	private forkTargetsRequestSeq = 0;
	private forkExpandedMessageRows = new Set<string>();
	private forkExpandedToolRows = new Set<string>();
	private historyQuery = "";
	private historyRoleFilter: UiRole | "all" = "all";
	private autoFollowChat = true;
	private expandedToolWorkflowIds = new Set<string>();
	private expandedToolGroupByWorkflowId = new Map<string, string>();
	private expandedWorkflowThinkingIds = new Set<string>();
	private collapsedAutoWorkflowIds = new Set<string>();
	private selectedSkillDraft: ComposerSkillDraft | null = null;
	private slashPaletteOpen = false;
	private slashPaletteQuery = "";
	private slashPaletteIndex = 0;
	private slashPaletteNavigationMode: "pointer" | "keyboard" = "pointer";
	private slashRuntimeCommands: RuntimeSlashCommand[] = [];
	private slashCommandsLoading = false;
	private slashCommandsUpdatedAt = 0;
	private composerInputHistory: string[] = [];
	private composerHistoryIndex = -1;
	private composerHistoryDraft = "";
	private runHasAssistantText = false;
	private runSawToolActivity = false;
	private keepWorkflowExpandedUntilAssistantText = false;
	private readonly workingStatusPhrases = [
		"starting",
		"warming up",
		"working on it",
		"planning next steps",
		"running tools",
		"checking files",
		"reading context",
		"mapping dependencies",
		"editing safely",
		"verifying output",
		"reviewing details",
		"applying changes",
		"thinking through",
		"finalizing",
		"wrapping up",
	];
	private workingStatusPhraseIndex = 0;
	private workingStatusPhase: "typing" | "hold" = "typing";
	private workingStatusCharCount = 0;
	private workingStatusTimer: ReturnType<typeof setTimeout> | null = null;
	private disconnectNoticeTimer: ReturnType<typeof setTimeout> | null = null;
	private streamingReconcileTimer: ReturnType<typeof setTimeout> | null = null;
	private composerResizeObserver: ResizeObserver | null = null;
	private observedComposerElement: HTMLElement | null = null;
	private composerOffsetPx = 196;
	private sessionStats: SessionStatsSummary = {
		tokens: null,
		lifetimeTokens: null,
		costUsd: null,
		messageCount: 0,
		pendingCount: 0,
		contextWindow: null,
		usageRatio: null,
		updatedAt: 0,
	};
	private lastAssistantContextTokens: number | null = null;
	private refreshingSessionStats = false;
	private sessionStatsHover = false;
	private gitSummary: GitSummary = {
		isRepo: false,
		branch: null,
		branches: [],
		branchEntries: [],
		hasRemoteBranches: false,
		dirtyFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: 0,
	};
	private refreshingGitSummary = false;
	private gitMenuOpen = false;
	private gitBranchQuery = "";
	private switchingGitBranch = false;
	private fetchingGitRemotes = false;
	private creatingGitRepo = false;
	private projectPath: string | null = null;
	private bindingStatusText: string | null = null;
	private gitKnownBranchesByProject = new Map<string, string[]>();
	private welcomeDashboard: WelcomeDashboardSummary = {
		loading: false,
		skills: [],
		extensions: [],
		themes: [],
		currentCliVersion: null,
		latestCliVersion: null,
		updateAvailable: false,
		error: null,
		updatedAt: 0,
	};
	private welcomeProjectMenuOpen = false;
	private welcomeProjects: WelcomeProjectSummary[] = [];
	private welcomeActiveProjectId: string | null = null;
	private welcomeHeadlineTimer: ReturnType<typeof setInterval> | null = null;
	private welcomeHeadlineIndex = 0;
	private readonly welcomeHeadlines = ["Ready when you are", "Your move when you’re back", "Come back when you want, I’m here", "I’m waiting for you"];

	constructor(container: HTMLElement) {
		this.container = container;
	}

	setOnStateChange(cb: (state: RpcSessionState) => void): void {
		this.onStateChange = cb;
	}

	setOnOpenTerminal(cb: () => void): void {
		this.onOpenTerminal = cb;
	}

	setOnAddProject(cb: () => void): void {
		this.onAddProject = cb;
	}

	setOnOpenSettings(cb: (sectionId?: string) => void): void {
		this.onOpenSettings = cb;
	}

	setOnOpenPackages(cb: () => void): void {
		this.onOpenPackages = cb;
	}

	setOnOpenExtensionConfig(cb: (commandName: string, args: string) => boolean | Promise<boolean>): void {
		this.onOpenExtensionConfig = cb;
	}

	setOnOpenProviderConfig(cb: (provider: string) => boolean | Promise<boolean>): void {
		this.onOpenProviderConfig = cb;
	}

	setOnBeginRenameCurrentSession(cb: () => boolean | Promise<boolean>): void {
		this.onBeginRenameCurrentSession = cb;
	}

	setOnRenameCurrentSession(cb: (nextName: string) => boolean | Promise<boolean>): void {
		this.onRenameCurrentSession = cb;
	}

	setOnCreateFreshSession(cb: () => boolean | Promise<boolean>): void {
		this.onCreateFreshSession = cb;
	}

	setOnReloadRuntime(cb: () => boolean | Promise<boolean>): void {
		this.onReloadRuntime = cb;
	}

	setOnOpenSessionBrowser(cb: (query?: string) => void): void {
		this.onOpenSessionBrowser = cb;
	}

	setOnOpenShortcuts(cb: () => void): void {
		this.onOpenShortcuts = cb;
	}

	setOnQuitApp(cb: () => void): void {
		this.onQuitApp = cb;
	}

	setOnSelectWelcomeProject(cb: (projectId: string) => void): void {
		this.onSelectWelcomeProject = cb;
	}

	setWelcomeProjects(projects: Array<{ id: string; name: string; path: string }>, activeProjectId: string | null): void {
		this.welcomeProjects = projects
			.filter((entry) => Boolean(entry?.id) && Boolean(entry?.name) && Boolean(entry?.path))
			.map((entry) => ({ id: entry.id, name: entry.name, path: entry.path }));
		this.welcomeActiveProjectId = activeProjectId;
		if (!this.projectPath) this.render();
	}

	setOnPromptSubmitted(cb: () => void): void {
		this.onPromptSubmitted = cb;
	}

	setOnRunStateChange(cb: (running: boolean) => void): void {
		this.onRunStateChange = cb;
	}

	setProjectPath(path: string | null): void {
		if (this.projectPath === path) return;
		const previous = this.projectPath;
		this.projectPath = path;
		const push = (window as typeof window & {
			__PI_DESKTOP_PUSH_TRACE__?: (message: string) => void;
		}).__PI_DESKTOP_PUSH_TRACE__;
		push?.(`chat:setProjectPath ${previous ?? "-"} -> ${path ?? "-"}`);
		this.gitMenuOpen = false;
		this.welcomeProjectMenuOpen = false;
		this.modelPickerOpen = false;
		this.selectedSkillDraft = null;
		this.slashPaletteOpen = false;
		this.slashPaletteQuery = "";
		this.slashPaletteIndex = 0;
		this.slashCommandsUpdatedAt = 0;
		this.slashRuntimeCommands = [];
		this.expandedToolWorkflowIds.clear();
		this.expandedToolGroupByWorkflowId.clear();
		this.expandedWorkflowThinkingIds.clear();
		this.collapsedAutoWorkflowIds.clear();
		this.compactionCycle = null;
		this.compactionInsertIndex = null;
		this.keepWorkflowExpandedUntilAssistantText = false;
		this.runningProviderAuthAction = null;
		this.modelCatalogLoadedAt = 0;
		if (!path) {
			this.bindingStatusText = null;
			this.welcomeHeadlineIndex = (this.welcomeHeadlineIndex + 1) % this.welcomeHeadlines.length;
			this.modelLoadRequestSeq += 1;
			this.loadingModels = false;
			this.loadingModelCatalog = false;
			this.loadingProviderAuth = false;
			this.modelCatalog = [];
			this.providerAuthById.clear();
			this.providerAuthConfigured.clear();
			this.providerAuthForcedLoggedOut.clear();
			this.providerAuthLoadedAt = 0;
			this.runHasAssistantText = false;
			this.runSawToolActivity = false;
			this.clearWorkingStatusTimer(true);
			void this.refreshWelcomeDashboard(true);
		}
		void this.refreshGitSummary(true);
		this.render();
	}

	prepareForSessionSwitch(projectPath: string | null, statusText?: string): void {
		if (this.projectPath !== projectPath) {
			this.setProjectPath(projectPath);
		}
		this.isConnected = rpcBridge.isConnected;
		this.state = null;
		this.messages = [];
		this.lastBackendSessionFile = null;
		this.lastBackendRefreshError = null;
		this.pendingDeliveryMode = "prompt";
		this.modelPickerOpen = false;
		this.selectedSkillDraft = null;
		this.slashPaletteOpen = false;
		this.slashPaletteQuery = "";
		this.slashPaletteIndex = 0;
		this.slashCommandsUpdatedAt = 0;
		this.slashRuntimeCommands = [];
		this.expandedToolWorkflowIds.clear();
		this.expandedToolGroupByWorkflowId.clear();
		this.expandedWorkflowThinkingIds.clear();
		this.collapsedAutoWorkflowIds.clear();
		this.compactionCycle = null;
		this.compactionInsertIndex = null;
		this.runningProviderAuthAction = null;
		this.providerAuthForcedLoggedOut.clear();
		this.runHasAssistantText = false;
		this.runSawToolActivity = false;
		this.keepWorkflowExpandedUntilAssistantText = false;
		this.clearWorkingStatusTimer(true);
		this.bindingStatusText = projectPath ? (statusText ?? "Loading session…") : null;
		this.render();
	}

	getState(): RpcSessionState | null {
		return this.state;
	}

	setInputText(text: string): void {
		this.inputText = text;
		this.resetComposerHistoryNavigation();
		this.updateSlashPaletteStateFromInput();
		this.render();
		requestAnimationFrame(() => {
			const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
			if (!textarea) return;
			textarea.value = text;
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
			textarea.focus();
		});
	}

	stageComposerCommand(commandText: string): void {
		const draft = this.parseComposerSkillDraftFromCommand(commandText);
		if (draft) {
			this.selectedSkillDraft = draft;
			this.inputText = "";
			this.resetComposerHistoryNavigation();
			this.updateSlashPaletteStateFromInput();
			this.render();
			requestAnimationFrame(() => {
				const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
				textarea?.focus();
			});
			return;
		}
		this.selectedSkillDraft = null;
		this.inputText = commandText;
		this.resetComposerHistoryNavigation();
		this.closeSlashPalette();
		this.render();
		requestAnimationFrame(() => {
			const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
			if (!textarea) return;
			textarea.value = commandText;
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
			textarea.focus();
		});
	}

	private parseComposerSkillDraftFromCommand(commandText: string): ComposerSkillDraft | null {
		const trimmed = commandText.trim();
		const match = trimmed.match(/^\/skill:([a-zA-Z0-9._-]+)\b([\s\S]*)$/);
		if (!match) return null;
		const name = match[1] || "";
		const suffix = (match[2] || "").trim();
		if (!suffix) {
			return { name, commandText: `/skill:${name}`, scope: null };
		}
		if (!suffix.startsWith("{")) {
			return { name, commandText: `/skill:${name} ${suffix}`, scope: null };
		}
		try {
			const payload = JSON.parse(suffix) as { scope?: unknown };
			return {
				name,
				commandText: `/skill:${name} ${suffix}`,
				scope: typeof payload.scope === "string" && payload.scope.trim().length > 0 ? payload.scope.trim() : null,
			};
		} catch {
			return { name, commandText: `/skill:${name} ${suffix}`, scope: null };
		}
	}

	private removeComposerSkillDraft(): void {
		this.selectedSkillDraft = null;
		this.render();
		requestAnimationFrame(() => {
			const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
			textarea?.focus();
		});
	}

	private slashQueryFromInput(): string | null {
		const raw = this.inputText;
		if (!raw.startsWith("/")) return null;
		if (raw.includes("\n")) return null;
		return raw.slice(1).trimStart();
	}

	private updateSlashPaletteStateFromInput(): void {
		const query = this.slashQueryFromInput();
		if (query === null) {
			this.slashPaletteOpen = false;
			this.slashPaletteQuery = "";
			this.slashPaletteIndex = 0;
			this.slashPaletteNavigationMode = "pointer";
			return;
		}
		const wasOpen = this.slashPaletteOpen;
		const normalized = query.toLowerCase();
		if (!wasOpen || normalized !== this.slashPaletteQuery) {
			this.slashPaletteIndex = 0;
			this.slashPaletteNavigationMode = "pointer";
		}
		this.slashPaletteOpen = true;
		this.slashPaletteQuery = normalized;
		void this.ensureSlashCommandsLoaded(!wasOpen);
	}

	private closeSlashPalette(clearInput = false): void {
		this.slashPaletteOpen = false;
		this.slashPaletteQuery = "";
		this.slashPaletteIndex = 0;
		this.slashPaletteNavigationMode = "pointer";
		if (clearInput) this.inputText = "";
	}

	private parseSlashInput(value: string): { commandText: string; commandName: string; args: string } | null {
		const raw = value.trim();
		if (!raw.startsWith("/")) return null;
		if (raw.includes("\n")) return null;
		const body = raw.slice(1).trim();
		if (!body) return null;
		const splitIndex = body.search(/\s/);
		if (splitIndex < 0) {
			const commandToken = body.trim();
			const commandName = commandToken.toLowerCase();
			return {
				commandName,
				args: "",
				commandText: `/${commandToken}`,
			};
		}
		const commandToken = body.slice(0, splitIndex).trim();
		const commandName = commandToken.toLowerCase();
		const args = body.slice(splitIndex + 1).trim();
		return {
			commandName,
			args,
			commandText: `/${commandToken}${args ? ` ${args}` : ""}`,
		};
	}

	private normalizeRuntimeSlashCommand(raw: Record<string, unknown>): RuntimeSlashCommand | null {
		const source = normalizeText(raw.source).toLowerCase();
		if (source !== "extension" && source !== "prompt" && source !== "skill") return null;
		const name = normalizeText(raw.name).replace(/^\/+/, "").trim().toLowerCase();
		if (!name) return null;
		const description = withRuntimeCommandUsageHint(name, normalizeText(raw.description) || `Run /${name}`);
		return {
			name,
			description,
			source,
		};
	}

	private async ensureSlashCommandsLoaded(force = false): Promise<void> {
		if (this.slashCommandsLoading) return;
		if (!force && this.slashRuntimeCommands.length > 0 && Date.now() - this.slashCommandsUpdatedAt < 15_000) return;
		this.slashCommandsLoading = true;
		if (this.slashPaletteOpen) this.render();
		try {
			const runtimeCommands = await rpcBridge.getCommands().catch(() => []);
			const normalized: RuntimeSlashCommand[] = [];
			const seen = new Set<string>();
			for (const raw of runtimeCommands as Array<Record<string, unknown>>) {
				const parsed = this.normalizeRuntimeSlashCommand(raw);
				if (!parsed) continue;
				const key = `${parsed.source}:${parsed.name}`;
				if (seen.has(key)) continue;
				seen.add(key);
				normalized.push(parsed);
			}
			const sourceOrder: Record<RuntimeSlashCommand["source"], number> = {
				extension: 0,
				prompt: 1,
				skill: 2,
			};
			normalized.sort((a, b) => {
				const sourceDiff = sourceOrder[a.source] - sourceOrder[b.source];
				if (sourceDiff !== 0) return sourceDiff;
				return a.name.localeCompare(b.name);
			});
			this.slashRuntimeCommands = normalized;
			this.slashCommandsUpdatedAt = Date.now();
		} catch {
			this.slashRuntimeCommands = this.slashRuntimeCommands.slice();
			this.slashCommandsUpdatedAt = Date.now();
		} finally {
			this.slashCommandsLoading = false;
			if (this.slashPaletteOpen) this.render();
		}
	}

	private slashSectionForSource(source: SlashCommandSource): SlashPaletteSection {
		switch (source) {
			case "builtin":
				return "CLI";
			case "extension":
				return "Extensions";
			case "prompt":
				return "Prompts";
			case "skill":
			default:
				return "Skills";
		}
	}

	private buildAllSlashPaletteItems(): SlashPaletteItem[] {
		const builtinItems: SlashPaletteItem[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
			id: `builtin:${command.name}`,
			section: "CLI",
			label: `/${command.name}`,
			hint: command.description,
			commandName: command.name,
			source: "builtin",
		}));
		const builtinNames = new Set(builtinItems.map((item) => item.commandName));
		const runtimeItems: SlashPaletteItem[] = this.slashRuntimeCommands
			.filter((command) => !builtinNames.has(command.name))
			.map((command) => ({
				id: `${command.source}:${command.name}`,
				section: this.slashSectionForSource(command.source),
				label: `/${command.name}`,
				hint: command.description,
				commandName: command.name,
				source: command.source,
			}));
		return [...builtinItems, ...runtimeItems];
	}

	private slashQueryToken(): string {
		const raw = this.slashPaletteQuery.trim();
		if (!raw) return "";
		const [token] = raw.split(/\s+/, 1);
		return (token || "").toLowerCase();
	}

	private matchesSlashQuery(query: string, ...values: string[]): boolean {
		if (!query) return true;
		const haystack = values.join(" ").toLowerCase();
		return haystack.includes(query);
	}

	private getSlashPaletteItems(): SlashPaletteItem[] {
		if (!this.slashPaletteOpen) return [];
		const query = this.slashQueryToken();
		const allItems = this.buildAllSlashPaletteItems();
		if (!query) return allItems;
		const startsWith: SlashPaletteItem[] = [];
		const contains: SlashPaletteItem[] = [];
		for (const item of allItems) {
			if (!this.matchesSlashQuery(query, item.commandName, item.label, item.hint, item.section)) continue;
			if (item.commandName.startsWith(query) || item.label.toLowerCase().startsWith(`/${query}`)) {
				startsWith.push(item);
			} else {
				contains.push(item);
			}
		}
		return [...startsWith, ...contains];
	}

	private findSlashPaletteItemByName(commandName: string): SlashPaletteItem | null {
		const normalized = commandName.trim().toLowerCase();
		if (!normalized) return null;
		return this.buildAllSlashPaletteItems().find((item) => item.commandName === normalized) ?? null;
	}

	private unwrapQuotedArg(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return "";
		if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
			return trimmed.slice(1, -1).trim();
		}
		return trimmed;
	}

	private normalizedAuthProviderArg(rawArgs: string): string {
		const provider = this.unwrapQuotedArg(rawArgs).toLowerCase();
		if (!provider) return "";
		if (!/^[a-z0-9._-]+$/.test(provider)) return "";
		return provider;
	}

	private providerKey(provider: string): string {
		return normalizeText(provider).toLowerCase();
	}

	private recomputeProviderAuthConfigured(): void {
		const next = new Set<string>();
		for (const provider of this.providerAuthById.keys()) {
			if (this.providerAuthForcedLoggedOut.has(provider)) continue;
			next.add(provider);
		}
		this.providerAuthConfigured = next;
	}

	private async loadProviderAuthStatus(force = false): Promise<void> {
		if (this.loadingProviderAuth) return;
		const stale = Date.now() - this.providerAuthLoadedAt > MODEL_PICKER_AUTH_CACHE_MS;
		if (!force && this.providerAuthLoadedAt > 0 && !stale) return;
		this.loadingProviderAuth = true;
		try {
			const raw = await rpcBridge.getPiAuthStatus();
			const next = new Map<string, Pick<PiAuthProviderStatus, "source" | "kind">>();
			const providers = Array.isArray(raw?.configured_providers) ? raw.configured_providers : [];
			for (const entry of providers) {
				const provider = this.providerKey(typeof entry?.provider === "string" ? entry.provider : "");
				if (!provider) continue;
				const source = entry?.source;
				const kind = entry?.kind;
				next.set(provider, {
					source:
						source === "environment" || source === "auth_file_api_key" || source === "auth_file_oauth"
							? source
							: "auth_file_api_key",
					kind: kind === "api_key" || kind === "oauth" || kind === "unknown" ? kind : "unknown",
				});
			}
			this.providerAuthById = next;
			this.providerAuthLoadedAt = Date.now();
			for (const provider of next.keys()) {
				this.providerAuthForcedLoggedOut.delete(provider);
			}
			this.recomputeProviderAuthConfigured();
		} catch (err) {
			console.error("Failed to load provider auth status:", err);
			if (this.providerAuthLoadedAt === 0) {
				this.providerAuthById = new Map();
			}
			this.recomputeProviderAuthConfigured();
		} finally {
			this.loadingProviderAuth = false;
			this.render();
		}
	}

	private async loadModelCatalog(force = false): Promise<void> {
		if (this.loadingModelCatalog) return;
		const stale = Date.now() - this.modelCatalogLoadedAt > MODEL_PICKER_CATALOG_CACHE_MS;
		if (!force && this.modelCatalogLoadedAt > 0 && !stale) return;
		this.loadingModelCatalog = true;
		try {
			const result = await rpcBridge.runPiCliCommand(["--list-models"], {
				cwd: this.projectPath || ".",
			});
			if (result.exit_code !== 0) {
				throw new Error(result.stderr || result.stdout || `pi --list-models failed with exit ${result.exit_code}`);
			}
			const parsed = parseListModelsCatalog(result.stdout || "");
			this.modelCatalog = parsed;
			this.modelCatalogLoadedAt = Date.now();
		} catch (err) {
			console.error("Failed to load model catalog:", err);
		} finally {
			this.loadingModelCatalog = false;
			this.render();
		}
	}

	private resolveProviderSetupCommand(provider: string): string | null {
		const providerKey = this.providerKey(provider);
		if (!providerKey) return null;
		const providerTokens = providerKey.split(/[-_.]+/).filter(Boolean);
		let best: { name: string; score: number } | null = null;
		for (const command of this.slashRuntimeCommands) {
			if (command.source !== "extension") continue;
			const name = normalizeText(command.name).toLowerCase().replace(/^\/+/, "");
			if (!name) continue;
			const description = normalizeText(command.description).toLowerCase();
			const haystack = `${name} ${description}`;
			let score = 0;
			if (haystack.includes(providerKey)) score += 9;
			score += providerTokens.filter((token) => token.length > 2 && haystack.includes(token)).length * 2;
			if (/\b(config|setup|settings|auth|login)\b/.test(haystack)) score += 3;
			if (/config/.test(name)) score += 2;
			if (score <= 0) continue;
			if (!best || score > best.score) {
				best = { name, score };
			}
		}
		return best?.name ?? null;
	}

	private async openProviderSetup(provider: string): Promise<boolean> {
		const providerKey = this.providerKey(provider);
		if (!providerKey) return false;
		if (this.onOpenProviderConfig) {
			try {
				const handled = await this.onOpenProviderConfig(providerKey);
				if (handled) return true;
			} catch {
				// ignore and continue fallback flow
			}
		}
		await this.ensureSlashCommandsLoaded();
		const setupCommand = this.resolveProviderSetupCommand(providerKey);
		if (setupCommand && this.onOpenExtensionConfig) {
			const handled = await this.onOpenExtensionConfig(setupCommand, "config");
			if (handled) return true;
		}
		return false;
	}

	private async handleProviderAuthAction(provider: string, action: "login" | "logout"): Promise<void> {
		const providerKey = this.providerKey(provider);
		if (!providerKey) return;
		if (this.runningProviderAuthAction) return;

		this.runningProviderAuthAction = { provider: providerKey, action };
		this.render();
		const providerLabel = formatProviderDisplayName(providerKey);

		try {
			if (action === "login") {
				const openedPackageConfig = await this.openProviderSetup(providerKey);
				if (openedPackageConfig) {
					this.pushNotice(`Opened ${providerLabel} setup`, "info");
					return;
				}
				if (this.onOpenSettings) {
					this.onOpenSettings("account");
				}
				this.appendSystemMessage(
					`Open setup for **${providerLabel}** in Packages. For built-in OAuth providers, run \`pi\` in terminal and use \`/login\`.`,
					{ label: "auth", markdown: true },
				);
				this.pushNotice(`Opened account setup for ${providerLabel}`, "info");
				return;
			}

			const result = await rpcBridge.clearPiProviderAuth(providerKey);
			if (result.removed) {
				this.providerAuthForcedLoggedOut.add(providerKey);
				this.providerAuthById.delete(providerKey);
				this.recomputeProviderAuthConfigured();
				this.pushNotice(`Logged out of ${providerLabel}`, "success");
			} else if (result.source === "environment") {
				this.pushNotice(`${providerLabel} is configured via environment variable; remove env var to fully log out.`, "info");
			} else {
				this.providerAuthForcedLoggedOut.add(providerKey);
				this.providerAuthById.delete(providerKey);
				this.recomputeProviderAuthConfigured();
				this.pushNotice(`No stored auth.json credentials found for ${providerLabel}`, "info");
			}

			if (this.onReloadRuntime) {
				try {
					await this.onReloadRuntime();
				} catch {
					// best-effort reload only
				}
			}

			await Promise.all([
				this.refreshFromBackend(),
				this.loadProviderAuthStatus(true),
				this.loadAvailableModels(),
				this.loadModelCatalog(true),
			]);
			await this.switchAwayFromLoggedOutProvider(providerKey);
		} catch (err) {
			console.error(`Provider auth action failed (${action}:${providerKey}):`, err);
			this.pushNotice(err instanceof Error ? err.message : "Provider auth action failed", "error");
		} finally {
			this.runningProviderAuthAction = null;
			this.render();
		}
	}

	private async switchAwayFromLoggedOutProvider(providerKey: string): Promise<void> {
		const currentProvider = this.providerKey(this.state?.model?.provider ?? "");
		if (!currentProvider || currentProvider !== providerKey) return;
		const fallback = this.availableModels.find((model) => this.providerKey(model.provider) !== providerKey) ?? null;
		if (!fallback) {
			this.pushNotice("No other authenticated models available. Log in to another provider.", "info");
			return;
		}
		await this.setModel(fallback.provider, fallback.id);
	}

	private async pickSessionImportPathFromDialog(): Promise<string | null> {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				multiple: false,
				directory: false,
				filters: [{ name: "Session JSONL", extensions: ["jsonl", "json"] }],
				defaultPath: this.projectPath || undefined,
			});
			if (Array.isArray(selected)) {
				const first = selected.find((entry) => typeof entry === "string" && entry.trim().length > 0);
				return typeof first === "string" ? first : null;
			}
			if (typeof selected === "string" && selected.trim().length > 0) {
				return selected;
			}
			return null;
		} catch (err) {
			console.error("Failed to open session import picker:", err);
			this.pushNotice("Failed to open import picker", "error");
			return null;
		}
	}

	private async pickSessionExportPathFromDialog(): Promise<string | null> {
		try {
			const { save } = await import("@tauri-apps/plugin-dialog");
			const basePath = this.projectPath ? `${this.projectPath.replace(/\\/g, "/")}/session.html` : "session.html";
			const selected = await save({
				title: "Export session",
				defaultPath: basePath,
				filters: [{ name: "HTML", extensions: ["html"] }],
			});
			if (typeof selected === "string" && selected.trim().length > 0) {
				return selected;
			}
			return null;
		} catch (err) {
			console.error("Failed to open export picker:", err);
			this.pushNotice("Failed to open export picker", "error");
			return null;
		}
	}

	private async executeSlashCommandFromComposer(): Promise<void> {
		const slashQuery = this.slashQueryFromInput();
		const parsed = this.parseSlashInput(this.inputText);
		if (!parsed && slashQuery === null) return;
		if (this.pendingImages.length > 0) {
			this.pushNotice("Slash commands cannot be sent with image attachments", "info");
			return;
		}
		await this.ensureSlashCommandsLoaded();
		const liveItems = this.getSlashPaletteItems();
		if (parsed) {
			const exact = this.findSlashPaletteItemByName(parsed.commandName);
			if (exact) {
				await this.runSlashCommand(parsed.commandText, exact, parsed.args);
				return;
			}
		}
		if (this.slashPaletteOpen && liveItems.length > 0) {
			const picked = liveItems[Math.max(0, Math.min(this.slashPaletteIndex, liveItems.length - 1))];
			const pickedArgs = parsed && parsed.commandName === picked.commandName ? parsed.args : "";
			const commandText = `/${picked.commandName}${pickedArgs ? ` ${pickedArgs}` : ""}`;
			await this.runSlashCommand(commandText, picked, pickedArgs);
			return;
		}
		if (parsed) {
			this.pushNotice(`Unknown slash command: /${parsed.commandName}`, "error");
			return;
		}
		this.pushNotice("Select a slash command from the menu", "info");
	}

	private async runSlashCommand(commandText: string, item: SlashPaletteItem, args: string): Promise<void> {
		const trimmedCommandText = commandText.trim();
		if (!trimmedCommandText) return;
		this.rememberComposerHistoryEntry(trimmedCommandText);
		this.clearComposer();
		this.sendingPrompt = true;
		this.render();
		try {
			if (item.source === "builtin") {
				await this.executeBuiltinSlashCommand(item.commandName, args);
			} else {
				await this.executeRuntimeSlashCommand(trimmedCommandText, item.source, item.commandName, args);
			}
		} catch (err) {
			console.error(`Slash command failed (${item.commandName}):`, err);
			const message = err instanceof Error ? err.message : String(err);
			this.pushNotice(message || `Failed to run /${item.commandName}`, "error");
		} finally {
			this.sendingPrompt = false;
			this.render();
		}
	}

	private async executeRuntimeSlashCommand(
		commandText: string,
		source: SlashCommandSource,
		commandName: string,
		args: string,
	): Promise<void> {
		if (source === "builtin") return;
		if (source === "extension" && this.onOpenExtensionConfig) {
			const normalizedName = commandName.trim().toLowerCase();
			const normalizedArgs = args.trim().toLowerCase();
			const defaultSettingsIntent = normalizedName === "voice-notify" && normalizedArgs.length === 0;
			const configIntent =
				defaultSettingsIntent ||
				normalizedName.endsWith("config") ||
				normalizedArgs === "config" ||
				normalizedArgs.startsWith("config ");
			if (configIntent) {
				const handled = await this.onOpenExtensionConfig(normalizedName, args);
				if (handled) return;
			}
		}
		const options = this.currentIsStreaming() ? { streamingBehavior: "steer" as const } : {};
		await rpcBridge.prompt(commandText, options);
		this.onPromptSubmitted?.();
	}

	private openModelPicker(options: { preferredProvider?: string } = {}): void {
		if (!this.loadingModels && this.availableModels.length === 0) {
			void this.loadAvailableModels();
		}
		if (!this.loadingProviderAuth) {
			void this.loadProviderAuthStatus();
		}
		if (!this.loadingModelCatalog && this.modelCatalog.length === 0) {
			void this.loadModelCatalog();
		}
		const preferred = normalizeText(options.preferredProvider).toLowerCase();
		if (preferred) {
			const providerPool = [...this.availableModels, ...this.modelCatalog];
			const exact = providerPool.find((model) => model.provider.toLowerCase() === preferred)?.provider;
			if (exact) {
				this.modelPickerActiveProvider = exact;
			} else {
				const partial = providerPool.find((model) => model.provider.toLowerCase().includes(preferred))?.provider;
				if (partial) this.modelPickerActiveProvider = partial;
			}
		}
		if (!this.modelPickerActiveProvider) {
			const currentProvider = normalizeText(this.state?.model?.provider);
			if (currentProvider) {
				this.modelPickerActiveProvider = currentProvider;
			}
		}
		this.modelPickerOpen = true;
		this.render();
	}

	private resolveProviderHintFromModelArg(rawArg: string): string | null {
		const arg = rawArg.trim().replace(/^\/+/, "");
		if (!arg) return null;

		const byDelim = arg.includes("/") ? arg.split("/")[0] : arg.includes("::") ? arg.split("::")[0] : arg;
		const token = byDelim.trim().toLowerCase();
		if (!token) return null;

		const providerPool = [...this.availableModels, ...this.modelCatalog];
		const providers = [...new Set(providerPool.map((model) => model.provider))];
		const exact = providers.find((provider) => provider.toLowerCase() === token);
		if (exact) return exact;
		const partial = providers.find((provider) => provider.toLowerCase().includes(token));
		if (partial) return partial;

		const fuzzy = providerPool.filter((model) => `${model.provider}/${model.id}`.toLowerCase().includes(token));
		if (fuzzy.length > 0) {
			const uniqueProviders = [...new Set(fuzzy.map((model) => model.provider))];
			if (uniqueProviders.length === 1) return uniqueProviders[0];
		}

		return null;
	}

	private resolveModelCandidateFromArg(rawArg: string): ModelOption | null {
		const arg = rawArg.trim();
		if (!arg) return null;
		const normalizedArg = arg.replace(/^\/+/, "").trim();
		const viaDoubleColon = normalizedArg.split("::");
		if (viaDoubleColon.length === 2) {
			const provider = viaDoubleColon[0]?.trim().toLowerCase();
			const id = viaDoubleColon[1]?.trim().toLowerCase();
			if (provider && id) {
				return this.availableModels.find((model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id) ?? null;
			}
		}
		const slashIndex = normalizedArg.indexOf("/");
		if (slashIndex > 0) {
			const provider = normalizedArg.slice(0, slashIndex).trim().toLowerCase();
			const id = normalizedArg.slice(slashIndex + 1).trim().toLowerCase();
			if (provider && id) {
				const exact = this.availableModels.find((model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id);
				if (exact) return exact;
			}
		}
		const lower = normalizedArg.toLowerCase();
		const exactById = this.availableModels.find((model) => model.id.toLowerCase() === lower);
		if (exactById) return exactById;
		const fuzzy = this.availableModels.filter((model) => `${model.provider}/${model.id}`.toLowerCase().includes(lower));
		if (fuzzy.length === 1) return fuzzy[0];
		return null;
	}

	private getSessionMessageBreakdown(): {
		user: number;
		assistant: number;
		toolCalls: number;
		toolResults: number;
	} {
		let user = 0;
		let assistant = 0;
		let toolCalls = 0;
		let toolResults = 0;
		for (const message of this.messages) {
			if (message.role === "user") {
				user += 1;
				continue;
			}
			if (message.role !== "assistant") continue;
			assistant += 1;
			toolCalls += message.toolCalls.length;
			toolResults += message.toolCalls.filter((call) => typeof call.result === "string" && call.result.trim().length > 0).length;
		}
		return { user, assistant, toolCalls, toolResults };
	}

	private formatSessionInfoBlock(): string {
		const lines: string[] = [];
		const sessionName = normalizeText(this.state?.sessionName);
		const sessionFile = normalizeText(this.state?.sessionFile);
		const sessionId = normalizeText(this.state?.sessionId);
		const modelProvider = normalizeText(this.state?.model?.provider);
		const modelId = normalizeText(this.state?.model?.id);
		const modelLabel = modelProvider && modelId ? `${modelProvider}/${modelId}` : "—";
		const { user, assistant, toolCalls, toolResults } = this.getSessionMessageBreakdown();
		const totalMessages = this.state?.messageCount ?? this.sessionStats.messageCount;
		const pendingMessages = this.state?.pendingMessageCount ?? this.sessionStats.pendingCount;

		lines.push("Session info");
		lines.push("");
		lines.push(`Name: ${sessionName || "(unnamed)"}`);
		lines.push(`File: ${sessionFile || "In-memory"}`);
		lines.push(`ID: ${sessionId || "—"}`);
		lines.push(`Model: ${modelLabel}`);
		lines.push(`Thinking: ${this.state?.thinkingLevel ?? "—"}`);
		lines.push("");
		lines.push("Messages");
		lines.push(`User: ${user}`);
		lines.push(`Assistant: ${assistant}`);
		lines.push(`Tool calls: ${toolCalls}`);
		lines.push(`Tool results: ${toolResults}`);
		lines.push(`Total: ${Math.max(0, totalMessages)}`);
		lines.push(`Pending: ${Math.max(0, pendingMessages)}`);
		lines.push("");
		lines.push("Tokens");
		lines.push(
			`Context: ${this.sessionStats.tokens !== null ? Math.round(this.sessionStats.tokens).toLocaleString() : "—"}`,
		);
		lines.push(
			`Context window: ${this.sessionStats.contextWindow !== null ? Math.round(this.sessionStats.contextWindow).toLocaleString() : "—"}`,
		);
		lines.push(`Usage: ${this.sessionStats.usageRatio !== null ? `${(this.sessionStats.usageRatio * 100).toFixed(1)}%` : "—"}`);
		lines.push(
			`Session tokens total: ${this.sessionStats.lifetimeTokens !== null ? Math.round(this.sessionStats.lifetimeTokens).toLocaleString() : "—"}`,
		);
		lines.push(`Cost: ${this.sessionStats.costUsd !== null ? formatUsd(this.sessionStats.costUsd) : "—"}`);
		return lines.join("\n");
	}

	private async executeBuiltinSlashCommand(commandName: string, args: string): Promise<void> {
		switch (commandName) {
			case "settings": {
				if (!this.onOpenSettings) {
					this.pushNotice("Settings panel is unavailable", "error");
					return;
				}
				this.onOpenSettings();
				return;
			}
			case "model": {
				const rawArg = args.trim();
				if (!rawArg) {
					this.openModelPicker();
					return;
				}
				if (this.availableModels.length === 0) {
					await this.loadAvailableModels();
				}
				const candidate = this.resolveModelCandidateFromArg(rawArg);
				if (!candidate) {
					const providerHint = this.resolveProviderHintFromModelArg(rawArg) ?? undefined;
					this.openModelPicker({ preferredProvider: providerHint });
					return;
				}
				await this.setModel(candidate.provider, candidate.id);
				return;
			}
			case "scoped-models": {
				if (this.onOpenSettings) {
					this.onOpenSettings("general");
				} else {
					this.pushNotice("Settings panel is unavailable", "error");
				}
				return;
			}
			case "export": {
				let outputPath = this.unwrapQuotedArg(args);
				if (!outputPath) {
					outputPath = (await this.pickSessionExportPathFromDialog()) || "";
				}
				if (!outputPath) {
					this.pushNotice("Export cancelled", "info");
					return;
				}
				const result = await rpcBridge.exportHtml(outputPath);
				this.pushNotice(`Exported session to ${truncate(result.path, 70)}`, "success");
				return;
			}
			case "import": {
				let target = this.unwrapQuotedArg(args);
				if (!target) {
					target = (await this.pickSessionImportPathFromDialog()) || "";
				}
				if (!target) {
					this.pushNotice("Import cancelled", "info");
					return;
				}
				const result = await rpcBridge.switchSession(target);
				if (!result.cancelled) {
					await this.refreshFromBackend();
					this.pushNotice(`Session imported from ${truncate(target, 56)}`, "success");
				} else {
					this.pushNotice("Import cancelled", "info");
				}
				return;
			}
			case "share": {
				await this.shareAsGist();
				return;
			}
			case "copy": {
				await this.copyLastMessage();
				return;
			}
			case "name": {
				const nextName = args.trim();
				if (!nextName) {
					if (this.onBeginRenameCurrentSession) {
						const handled = await this.onBeginRenameCurrentSession();
						if (handled) return;
					}
					await this.renameSession();
					return;
				}
				await this.renameSessionTo(nextName);
				return;
			}
			case "session": {
				await this.refreshSessionStats(true);
				this.appendSystemMessage(this.formatSessionInfoBlock(), { label: "session" });
				return;
			}
			case "changelog": {
				const tokens = args
					.split(/\s+/)
					.map((token) => token.trim().toLowerCase())
					.filter(Boolean);
				const forceRefresh = tokens.includes("refresh");
				const showAll = tokens.includes("all") || tokens.includes("full");
				const markdownFull = await this.loadPiAgentChangelogMarkdown(forceRefresh);
				const markdown = showAll ? markdownFull : this.extractLatestChangelogSections(markdownFull, 2);
				this.appendSystemMessage(markdown, {
					label: "changelog",
					markdown: true,
					collapsibleTitle: showAll ? "Changelog · all" : "Changelog · latest",
					collapsedByDefault: true,
				});
				return;
			}
			case "hotkeys": {
				if (this.onOpenShortcuts) {
					this.onOpenShortcuts();
				} else {
					this.pushNotice("Keyboard shortcuts panel is unavailable", "info");
				}
				return;
			}
			case "terminal": {
				if (this.onOpenTerminal) {
					this.onOpenTerminal();
				} else {
					this.pushNotice("Terminal panel is unavailable", "info");
				}
				return;
			}
			case "fork": {
				this.openHistoryViewerForFork({
					loading: false,
					sessionName: this.state?.sessionName ?? null,
					query: args.trim() || undefined,
				});
				return;
			}
			case "tree": {
				this.openHistoryViewer({ query: args.trim() || undefined });
				return;
			}
			case "login": {
				const provider = this.normalizedAuthProviderArg(args);
				if (!provider) {
					this.openModelPicker();
					return;
				}
				await this.handleProviderAuthAction(provider, "login");
				return;
			}
			case "logout": {
				const provider = this.normalizedAuthProviderArg(args);
				if (!provider) {
					this.openModelPicker();
					return;
				}
				await this.handleProviderAuthAction(provider, "logout");
				return;
			}
			case "new": {
				if (this.onCreateFreshSession) {
					const handled = await this.onCreateFreshSession();
					if (handled) return;
				}
				await this.newSession();
				return;
			}
			case "compact": {
				await this.compactNow(args.trim() || undefined);
				return;
			}
			case "resume": {
				if (this.onOpenSessionBrowser) {
					this.onOpenSessionBrowser(args.trim() || undefined);
				} else {
					this.pushNotice("Session browser is unavailable", "info");
				}
				return;
			}
			case "reload": {
				if (this.onReloadRuntime) {
					const handled = await this.onReloadRuntime();
					if (handled) {
						await this.ensureSlashCommandsLoaded(true);
						await Promise.all([
							this.loadProviderAuthStatus(true),
							this.loadModelCatalog(true),
						]);
						this.pushNotice("Reloaded runtime state", "success");
						return;
					}
				}
				await this.ensureSlashCommandsLoaded(true);
				await this.refreshFromBackend();
				await Promise.all([
					this.loadAvailableModels(),
					this.loadProviderAuthStatus(true),
					this.loadModelCatalog(true),
				]);
				this.pushNotice("Reloaded runtime state", "success");
				return;
			}
			case "quit": {
				if (this.onQuitApp) {
					this.onQuitApp();
				} else {
					this.pushNotice("Quit is unavailable in this context", "info");
				}
				return;
			}
			default: {
				this.pushNotice(`Unknown slash command: /${commandName}`, "error");
				return;
			}
		}
	}

	private previewSlashPaletteItem(item: SlashPaletteItem): void {
		const parsed = this.parseSlashInput(this.inputText);
		const args = parsed && parsed.commandName === item.commandName ? parsed.args : "";
		const commandText = `/${item.commandName}${args ? ` ${args}` : ""}`;
		if (this.inputText === commandText) return;
		this.inputText = commandText;
		requestAnimationFrame(() => {
			const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
			if (!textarea) return;
			textarea.value = commandText;
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
			const end = commandText.length;
			textarea.setSelectionRange(end, end);
		});
	}

	private selectSlashPaletteItem(item: SlashPaletteItem): void {
		const parsed = this.parseSlashInput(this.inputText);
		const args = parsed && parsed.commandName === item.commandName ? parsed.args : "";
		const commandText = `/${item.commandName}${args ? ` ${args}` : ""}`;
		void this.runSlashCommand(commandText, item, args);
	}

	private async bindNativeFileDropListener(): Promise<void> {
		if (this.nativeFileDropUnlisteners.length > 0) return;

		const handler = (event: { payload?: unknown }) => {
			const payload = event.payload as { type?: string; paths?: string[] };
			if (payload?.type !== "drop") return;
			if (!this.projectPath) return;
			const paths = Array.isArray(payload.paths) ? payload.paths : [];
			if (paths.length === 0) {
				this.pushNotice("No readable files found in drop payload", "info");
				return;
			}
			if (this.shouldIgnoreDuplicateDrop(paths.map((path) => this.fileNameFromPath(path)))) {
				return;
			}
			void this.prepareImagesFromPaths(paths);
		};

		try {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const unlisten = await getCurrentWindow().onDragDropEvent(handler as any);
			this.nativeFileDropUnlisteners.push(unlisten);
		} catch (err) {
			console.warn("Failed to bind native window file-drop listener:", err);
		}

		try {
			const { getCurrentWebview } = await import("@tauri-apps/api/webview");
			const unlisten = await getCurrentWebview().onDragDropEvent(handler as any);
			this.nativeFileDropUnlisteners.push(unlisten);
		} catch (err) {
			console.warn("Failed to bind native webview file-drop listener:", err);
		}
	}

	private scheduleStreamingUiReconcile(delayMs = 1800): void {
		if (this.streamingReconcileTimer) {
			clearTimeout(this.streamingReconcileTimer);
		}
		this.streamingReconcileTimer = setTimeout(() => {
			this.streamingReconcileTimer = null;
			void this.reconcileStreamingUiState();
		}, delayMs);
	}

	private cancelStreamingUiReconcile(): void {
		if (!this.streamingReconcileTimer) return;
		clearTimeout(this.streamingReconcileTimer);
		this.streamingReconcileTimer = null;
	}

	private onGlobalPointerDownForModelPicker = (event: Event): void => {
		if (!this.modelPickerOpen) return;
		const target = event.target;
		if (target instanceof Element && target.closest(".model-picker-root")) return;
		this.modelPickerOpen = false;
		this.render();
	};

	private onGlobalEscapeForModelPicker = (event: KeyboardEvent): void => {
		if (!this.modelPickerOpen || event.key !== "Escape") return;
		event.preventDefault();
		this.modelPickerOpen = false;
		this.render();
	};

	private bindModelPickerGlobalListeners(): void {
		if (this.modelPickerGlobalListenersBound || typeof document === "undefined") return;
		document.addEventListener("pointerdown", this.onGlobalPointerDownForModelPicker, true);
		document.addEventListener("mousedown", this.onGlobalPointerDownForModelPicker, true);
		document.addEventListener("keydown", this.onGlobalEscapeForModelPicker, true);
		this.modelPickerGlobalListenersBound = true;
	}

	private unbindModelPickerGlobalListeners(): void {
		if (!this.modelPickerGlobalListenersBound || typeof document === "undefined") return;
		document.removeEventListener("pointerdown", this.onGlobalPointerDownForModelPicker, true);
		document.removeEventListener("mousedown", this.onGlobalPointerDownForModelPicker, true);
		document.removeEventListener("keydown", this.onGlobalEscapeForModelPicker, true);
		this.modelPickerGlobalListenersBound = false;
	}

	connect(): void {
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = rpcBridge.onEvent((event) => this.handleEvent(event));
		this.bindModelPickerGlobalListeners();
		void this.bindNativeFileDropListener();
		this.isConnected = rpcBridge.isConnected;
		if (!this.isConnected) return;
		void this.refreshFromBackend();
		void this.loadAvailableModels();
		void this.loadProviderAuthStatus();
		void this.loadModelCatalog();
	}

	disconnect(): void {
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = null;
		this.cancelStreamingUiReconcile();
		this.runHasAssistantText = false;
		this.runSawToolActivity = false;
		this.keepWorkflowExpandedUntilAssistantText = false;
		this.clearWorkingStatusTimer(true);
		if (this.welcomeHeadlineTimer) {
			clearInterval(this.welcomeHeadlineTimer);
			this.welcomeHeadlineTimer = null;
		}
		for (const unlisten of this.nativeFileDropUnlisteners) {
			unlisten();
		}
		this.nativeFileDropUnlisteners = [];
		this.unbindModelPickerGlobalListeners();
		this.composerResizeObserver?.disconnect();
		this.composerResizeObserver = null;
		this.observedComposerElement = null;
	}

	async refreshFromBackend(options: { throwOnError?: boolean } = {}): Promise<void> {
		const push = (window as typeof window & {
			__PI_DESKTOP_PUSH_TRACE__?: (message: string) => void;
		}).__PI_DESKTOP_PUSH_TRACE__;
		const requestInstanceId = rpcBridge.getInstanceId();
		push?.(`chat:refreshFromBackend start instance=${requestInstanceId}`);
		try {
			const [state, backendMessages] = await Promise.all([rpcBridge.getState(), rpcBridge.getMessages()]);
			if (requestInstanceId !== rpcBridge.getInstanceId()) {
				push?.(`chat:refreshFromBackend stale instance=${requestInstanceId} active=${rpcBridge.getInstanceId()}`);
				return;
			}
			this.isConnected = rpcBridge.isConnected;
			const previousSessionFile = this.lastBackendSessionFile;
			const currentSessionFile = state.sessionFile ?? null;
			this.state = state;
			this.syncComposerQueueFromState(state);
			this.recomputeProviderAuthConfigured();
			this.lastBackendSessionFile = currentSessionFile;
			if ((previousSessionFile ?? "") !== (currentSessionFile ?? "")) {
				this.sessionStats = {
					tokens: null,
					lifetimeTokens: null,
					costUsd: null,
					messageCount: state.messageCount ?? 0,
					pendingCount: state.pendingMessageCount ?? 0,
					contextWindow: this.resolveContextWindow() ?? null,
					usageRatio: null,
					updatedAt: 0,
				};
				if (this.historyViewerOpen && this.historyViewerMode === "browse") {
					this.historyTreeRows = [];
					this.historyViewerLoading = true;
					void this.loadSessionTreeForHistory();
				}
			}
			this.lastBackendRefreshError = null;
			this.onStateChange?.(state);
			this.messages = this.mapBackendMessages(backendMessages);
			if (this.compactionInsertIndex !== null) {
				this.compactionInsertIndex = Math.max(0, Math.min(this.compactionInsertIndex, this.messages.length));
			}
			this.expandedToolWorkflowIds.clear();
			this.expandedToolGroupByWorkflowId.clear();
			this.expandedWorkflowThinkingIds.clear();
			this.collapsedAutoWorkflowIds.clear();
			this.forkEntryIdByMessageId.clear();
			this.lastAssistantContextTokens = this.deriveLatestAssistantContextTokens(backendMessages);
			if (state.isStreaming) {
				let lastUserIndex = -1;
				for (let i = backendMessages.length - 1; i >= 0; i -= 1) {
					if ((backendMessages[i].role as string) === "user") {
						lastUserIndex = i;
						break;
					}
				}
				const streamWindow = lastUserIndex >= 0 ? backendMessages.slice(lastUserIndex + 1) : backendMessages;
				this.runHasAssistantText = streamWindow.some((entry) => {
					if ((entry.role as string) !== "assistant") return false;
					return this.extractText((entry as Record<string, unknown>).content).trim().length > 0;
				});
				const sawToolInStreamWindow = streamWindow.some((entry) => {
					const role = (entry.role as string) ?? "";
					if (role === "toolResult") return true;
					if (role !== "assistant") return false;
					const directToolCalls = (entry as { toolCalls?: unknown }).toolCalls;
					if (Array.isArray(directToolCalls) && directToolCalls.length > 0) return true;
					const content = (entry as Record<string, unknown>).content;
					if (!Array.isArray(content)) return false;
					return content.some((part) => {
						if (!part || typeof part !== "object") return false;
						const rec = part as Record<string, unknown>;
						const type = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
						return type.includes("tool") || Boolean(rec.toolCall);
					});
				});
				this.runSawToolActivity = this.runSawToolActivity || sawToolInStreamWindow;
				if (this.runSawToolActivity) {
					this.keepWorkflowExpandedUntilAssistantText = !this.runHasAssistantText;
				}
			} else {
				this.runHasAssistantText = false;
				this.runSawToolActivity = false;
				this.keepWorkflowExpandedUntilAssistantText = false;
			}
			this.pendingDeliveryMode = state.isStreaming ? "steer" : "prompt";
			this.bindingStatusText = null;
			this.render();
			this.scrollToBottom();
			void this.refreshSessionStats(true);
			void this.refreshGitSummary(true);
			if (!this.loadingModels && this.availableModels.length === 0) {
				void this.loadAvailableModels();
			}
			if (!this.loadingProviderAuth && this.providerAuthLoadedAt === 0) {
				void this.loadProviderAuthStatus();
			}
			if (!this.loadingModelCatalog && this.modelCatalog.length === 0) {
				void this.loadModelCatalog();
			}
			push?.(`chat:refreshFromBackend ok session=${state.sessionFile ?? "-"} messages=${backendMessages.length}`);
		} catch (err) {
			console.error("Failed to refresh chat state:", err);
			this.lastBackendRefreshError = err instanceof Error ? err.message : String(err);
			push?.(`chat:refreshFromBackend failed ${this.lastBackendRefreshError}`);
			if (options.throwOnError) {
				throw err;
			}
		}
	}

	async refreshModels(): Promise<void> {
		await Promise.all([
			this.loadAvailableModels(),
			this.loadProviderAuthStatus(true),
			this.loadModelCatalog(true),
		]);
	}

	private mapBackendMessages(backendMessages: Array<Record<string, unknown>>): UiMessage[] {
		const mapped: UiMessage[] = [];
		const toolCallMap = new Map<string, ToolCallBlock>();

		for (const raw of backendMessages) {
			const role = raw.role as string | undefined;
			if (!role) continue;
			const sessionEntryId = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : undefined;

			switch (role) {
				case "user": {
					const text = this.extractText(raw.content);
					const attachments = this.extractImages(raw.content);
					mapped.push({
						id: uid("user"),
						sessionEntryId,
						role: "user",
						text,
						attachments,
						toolCalls: [],
					});
					break;
				}
				case "assistant": {
					const content = Array.isArray(raw.content) ? raw.content : [];
					let text = "";
					let thinking = "";
					const toolCalls: ToolCallBlock[] = [];

					for (const part of content) {
						if (!part || typeof part !== "object") continue;
						const p = part as Record<string, unknown>;
						const type = p.type as string | undefined;

						if (type === "text" && typeof p.text === "string") {
							text += p.text;
						}
						const typeLower = (type ?? "").toLowerCase();
						if (typeLower === "thinking" || typeLower === "reasoning" || typeLower.includes("thinking") || typeLower.includes("reason")) {
							if (typeof p.thinking === "string") thinking += p.thinking;
							else if (typeof p.reasoning === "string") thinking += p.reasoning;
							else if (typeof p.text === "string") thinking += p.text;
						}
						if (type === "toolCall") {
							const id = typeof p.id === "string" && p.id.trim().length > 0 ? p.id.trim() : uid("tc");
							const existing = toolCalls.find((entry) => entry.id === id);
							if (existing) {
								existing.name = typeof p.name === "string" ? p.name : existing.name;
								existing.args = (p.arguments as Record<string, unknown>) ?? existing.args;
								existing.isRunning = false;
								existing.isExpanded = false;
								toolCallMap.set(existing.id, existing);
								continue;
							}
							const tc: ToolCallBlock = {
								id,
								name: typeof p.name === "string" ? p.name : "tool",
								args: (p.arguments as Record<string, unknown>) ?? {},
								isRunning: false,
								isExpanded: false,
								startedAt: pickNumber(p, ["startedAt", "startTime", "timestamp", "ts"]) ?? undefined,
								endedAt: pickNumber(p, ["endedAt", "endTime"]) ?? undefined,
							};
							toolCalls.push(tc);
							toolCallMap.set(tc.id, tc);
						}
					}

					const normalizedThinking = thinking.trim();
					if (text.trim().length === 0 && normalizedThinking.length === 0 && toolCalls.length === 0) {
						break;
					}
					mapped.push({
						id: uid("assistant"),
						sessionEntryId,
						role: "assistant",
						text,
						thinking: normalizedThinking || undefined,
						thinkingExpanded: this.allThinkingExpanded,
						isThinkingStreaming: false,
						toolCalls,
					});
					break;
				}
				case "toolResult": {
					const toolCallId = raw.toolCallId as string | undefined;
					const content = this.extractToolOutput(raw.content ?? raw.result ?? raw);
					const isError = Boolean(raw.isError);
					if (toolCallId && toolCallMap.has(toolCallId)) {
						const tool = toolCallMap.get(toolCallId)!;
						tool.result = content || "(no output)";
						tool.isError = isError;
						tool.isRunning = false;
						tool.isExpanded = false;
						tool.endedAt = Date.now();
						if (!tool.startedAt) tool.startedAt = tool.endedAt;
					} else {
						const target = [...mapped].reverse().find((entry) => entry.role === "assistant");
						if (target) {
							target.toolCalls.push({
								id: toolCallId || uid("tc"),
								name: (typeof raw.toolName === "string" && raw.toolName.trim().length > 0 ? raw.toolName : "tool") as string,
								args: {},
								result: content || "(no output)",
								isError,
								isRunning: false,
								isExpanded: false,
								startedAt: Date.now(),
								endedAt: Date.now(),
							});
						} else {
							mapped.push({
								id: uid("toolResult"),
								sessionEntryId,
								role: "system",
								text: `Tool result${isError ? " (error)" : ""}:\n${content || "(no output)"}`,
								label: "tool-result",
								toolCalls: [],
							});
						}
					}
					break;
				}
				case "bashExecution": {
					const command = typeof raw.command === "string" ? raw.command : "bash";
					const output = typeof raw.output === "string" ? raw.output : "";
					mapped.push({
						id: uid("bash"),
						sessionEntryId,
						role: "system",
						text: `!${command}\n${output}`,
						label: "bash",
						toolCalls: [],
					});
					break;
				}
				case "branchSummary":
				case "compactionSummary": {
					const summary = typeof raw.summary === "string" ? raw.summary : this.extractText(raw.content);
					mapped.push({
						id: uid(role),
						sessionEntryId,
						role: "system",
						text: summary,
						label: role === "branchSummary" ? "branch summary" : "compaction summary",
						toolCalls: [],
					});
					break;
				}
				case "custom": {
					const customType = typeof raw.customType === "string" ? raw.customType : "custom";
					const content = this.extractText(raw.content);
					mapped.push({
						id: uid("custom"),
						sessionEntryId,
						role: "custom",
						text: content,
						label: customType,
						toolCalls: [],
					});
					break;
				}
				default:
					break;
			}
		}

		return mapped;
	}

	private extractText(content: unknown): string {
		if (!content) return "";
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const parts: string[] = [];
			for (const part of content) {
				if (typeof part === "string") {
					parts.push(part);
					continue;
				}
				if (!part || typeof part !== "object") continue;
				const p = part as Record<string, unknown>;
				const type = p.type as string | undefined;
				if (type === "text" && typeof p.text === "string") parts.push(p.text);
			}
			return parts.join("\n\n").trim();
		}
		if (typeof content === "object") {
			const c = content as Record<string, unknown>;
			if (typeof c.text === "string") return c.text;
		}
		return "";
	}

	private stringifyData(value: unknown): string {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}

	private extractToolOutput(payload: unknown, depth = 0): string {
		if (depth > 6 || payload === null || typeof payload === "undefined") return "";
		if (typeof payload === "string") return payload;
		if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
		if (Array.isArray(payload)) {
			const parts = payload
				.map((item) => this.extractToolOutput(item, depth + 1).trim())
				.filter(Boolean);
			return parts.join("\n").trim();
		}
		if (typeof payload !== "object") return "";

		const source = payload as Record<string, unknown>;
		const textFirst = this.extractText(source.content ?? payload).trim();
		const chunks: string[] = textFirst ? [textFirst] : [];
		const append = (value: unknown): void => {
			const text = this.extractToolOutput(value, depth + 1).trim();
			if (!text) return;
			if (!chunks.includes(text)) chunks.push(text);
		};

		for (const key of ["output", "stdout", "stderr", "result", "message", "error", "text", "delta", "reasoning", "thinking"]) {
			if (key in source) append(source[key]);
		}
		if ("content" in source) append(source.content);
		if ("parts" in source) append(source.parts);
		if ("messages" in source) append(source.messages);

		if (chunks.length > 0) return chunks.join("\n").trim();
		return this.stringifyData(source);
	}

	private mergeStreamingText(current: string, partial: string | null, deltaCandidate: unknown): string {
		const delta = typeof deltaCandidate === "string" ? deltaCandidate : "";
		if (partial !== null) {
			if (!current) return partial;
			if (partial === current) return current;
			if (partial.startsWith(current)) return partial;
			if (current.startsWith(partial) && delta) return current + delta;
			if (partial.length > current.length + 24) {
				const overlap = current.slice(Math.max(0, current.length - 24));
				if (!overlap || partial.includes(overlap)) return partial;
			}
		}
		if (delta) return current + delta;
		if (partial !== null) {
			if (current.endsWith(partial)) return current;
			return current + partial;
		}
		return current;
	}

	private extractImages(content: unknown): PendingImage[] {
		if (!Array.isArray(content)) return [];
		const images: PendingImage[] = [];
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const p = part as Record<string, unknown>;
			if (p.type !== "image" || typeof p.data !== "string" || typeof p.mimeType !== "string") continue;
			images.push({
				id: uid("img"),
				name: "image",
				mimeType: p.mimeType,
				data: p.data,
				previewUrl: `data:${p.mimeType};base64,${p.data}`,
				size: Math.floor((p.data.length * 3) / 4),
			});
		}
		return images;
	}

	private extractAssistantPartialContent(assistantEvent: Record<string, unknown>, mode: "text" | "thinking"): string | null {
		const partial = assistantEvent.partial;
		if (!partial || typeof partial !== "object") return null;
		const content = (partial as Record<string, unknown>).content;
		if (!Array.isArray(content)) return null;

		const fromPart = (part: unknown): string | null => {
			if (!part || typeof part !== "object") return null;
			const p = part as Record<string, unknown>;
			const type = typeof p.type === "string" ? p.type : "";
			const typeLower = type.toLowerCase();
			if (mode === "text" && typeLower === "text" && typeof p.text === "string") return p.text;
			if (mode === "thinking" && (typeLower.includes("thinking") || typeLower.includes("reason"))) {
				if (typeof p.thinking === "string") return p.thinking;
				if (typeof p.reasoning === "string") return p.reasoning;
				if (typeof p.text === "string") return p.text;
			}
			return null;
		};

		const contentIndex = assistantEvent.contentIndex;
		if (typeof contentIndex === "number" && Number.isInteger(contentIndex) && contentIndex >= 0 && contentIndex < content.length) {
			const indexed = fromPart(content[contentIndex]);
			if (indexed !== null) return indexed;
		}

		for (let i = content.length - 1; i >= 0; i -= 1) {
			const fallback = fromPart(content[i]);
			if (fallback !== null) return fallback;
		}

		return null;
	}

	private async loadAvailableModels(): Promise<void> {
		const push = (window as typeof window & {
			__PI_DESKTOP_PUSH_TRACE__?: (message: string) => void;
		}).__PI_DESKTOP_PUSH_TRACE__;
		const requestInstanceId = rpcBridge.getInstanceId();
		if (!rpcBridge.isConnected) {
			this.loadingModels = false;
			this.render();
			return;
		}

		const requestSeq = ++this.modelLoadRequestSeq;
		push?.(`chat:loadModels start instance=${rpcBridge.getInstanceId()} seq=${requestSeq}`);
		this.loadingModels = true;
		this.render();
		try {
			const models = await Promise.race([
				rpcBridge.getAvailableModels(),
				new Promise<Array<Record<string, unknown>>>((_, reject) => {
					setTimeout(() => reject(new Error("Timed out loading models")), 8000);
				}),
			]);
			if (requestSeq !== this.modelLoadRequestSeq) return;
			if (requestInstanceId !== rpcBridge.getInstanceId()) {
				push?.(`chat:loadModels stale instance=${requestInstanceId} active=${rpcBridge.getInstanceId()}`);
				return;
			}
			const mapped: ModelOption[] = [];
			const seen = new Set<string>();
			for (const m of models) {
				const provider = pickString(m, ["provider", "providerId", "provider_id", "vendor", "source.provider"]) ?? "";
				const id = pickString(m, ["id", "modelId", "model_id", "model", "target.id", "target.modelId"]) ?? "";
				if (!provider || !id) continue;
				const key = `${provider}::${id}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const contextWindow = pickNumber(m, [
					"contextWindow",
					"context_window",
					"maxInputTokens",
					"max_input_tokens",
					"limits.contextWindow",
					"limits.context_window",
				]);
				mapped.push({
					provider,
					id,
					contextWindow: typeof contextWindow === "number" ? contextWindow : undefined,
					reasoning: Boolean((m as Record<string, unknown>).reasoning),
					label: `${provider}/${id}`,
				});
			}
			mapped.sort((a, b) => {
				const providerCompare = formatProviderDisplayName(a.provider).localeCompare(formatProviderDisplayName(b.provider), undefined, {
					sensitivity: "base",
				});
				if (providerCompare !== 0) return providerCompare;
				return formatModelDisplayName(a.id).localeCompare(formatModelDisplayName(b.id), undefined, { sensitivity: "base" });
			});
			this.availableModels = mapped;
			this.recomputeProviderAuthConfigured();
			this.lastModelLoadError = null;
			push?.(`chat:loadModels ok count=${mapped.length}`);
		} catch (err) {
			console.error("Failed to load available models:", err);
			this.lastModelLoadError = err instanceof Error ? err.message : String(err);
			push?.(`chat:loadModels failed ${this.lastModelLoadError}`);
			if (this.availableModels.length === 0) {
				this.pushNotice(`Could not load models right now: ${truncate(this.lastModelLoadError, 120)}`, "info");
			}
		} finally {
			if (requestSeq !== this.modelLoadRequestSeq) return;
			this.loadingModels = false;
			this.render();
		}
	}

	private async setModel(provider: string, modelId: string): Promise<boolean> {
		if (this.settingModel) return false;
		this.modelPickerOpen = false;
		this.settingModel = true;
		this.render();
		try {
			await rpcBridge.setModel(provider, modelId);
			this.state = await rpcBridge.getState();
			this.syncComposerQueueFromState(this.state);
			this.recomputeProviderAuthConfigured();
			if (this.state) this.onStateChange?.(this.state);
			void this.refreshSessionStats(true);
			this.pushNotice(`Switched to ${provider}/${modelId}`, "success");
			return true;
		} catch (err) {
			console.error("Failed to set model:", err);
			this.pushNotice("Failed to switch model", "error");
			return false;
		} finally {
			this.settingModel = false;
			this.render();
		}
	}

	private thinkingLevelModelKey(state: RpcSessionState | null | undefined = this.state): string {
		const provider = state?.model?.provider?.trim() ?? "";
		const modelId = state?.model?.id?.trim() ?? "";
		if (!provider || !modelId) return "";
		return `${provider}::${modelId}`;
	}

	private markThinkingLevelUnsupported(level: ThinkingLevel, state: RpcSessionState | null | undefined = this.state): void {
		const key = this.thinkingLevelModelKey(state);
		if (!key) return;
		const existing = this.unsupportedThinkingLevelsByModel.get(key) ?? new Set<ThinkingLevel>();
		existing.add(level);
		this.unsupportedThinkingLevelsByModel.set(key, existing);
	}

	private clearThinkingLevelUnsupported(level: ThinkingLevel, state: RpcSessionState | null | undefined = this.state): void {
		const key = this.thinkingLevelModelKey(state);
		if (!key) return;
		const existing = this.unsupportedThinkingLevelsByModel.get(key);
		if (!existing) return;
		existing.delete(level);
		if (existing.size === 0) {
			this.unsupportedThinkingLevelsByModel.delete(key);
		}
	}

	private unsupportedThinkingLevelsForCurrentModel(): Set<ThinkingLevel> {
		const key = this.thinkingLevelModelKey(this.state);
		if (!key) return new Set<ThinkingLevel>();
		return this.unsupportedThinkingLevelsByModel.get(key) ?? new Set<ThinkingLevel>();
	}

	private async setThinkingLevel(level: ThinkingLevel): Promise<ThinkingLevel | null> {
		if (this.settingThinking) return this.state?.thinkingLevel ?? null;
		const requestedLevel = level;
		if (this.state) {
			this.state = { ...this.state, thinkingLevel: requestedLevel };
		}
		this.settingThinking = true;
		this.render();
		try {
			await rpcBridge.setThinkingLevel(requestedLevel);
			this.state = await rpcBridge.getState();
			this.syncComposerQueueFromState(this.state);
			if (this.state) this.onStateChange?.(this.state);
			if (this.state?.thinkingLevel === requestedLevel) {
				this.clearThinkingLevelUnsupported(requestedLevel, this.state);
			} else {
				this.markThinkingLevelUnsupported(requestedLevel, this.state);
			}
			if (requestedLevel === "xhigh" && this.state?.thinkingLevel !== "xhigh") {
				this.pushNotice(`xhigh is not available for this model (using ${this.state?.thinkingLevel || "high"})`, "info");
			}
			void this.refreshSessionStats(true);
			return this.state?.thinkingLevel ?? null;
		} catch (err) {
			console.error("Failed to set thinking level:", err);
			this.pushNotice("Failed to set thinking level", "error");
			return this.state?.thinkingLevel ?? null;
		} finally {
			this.settingThinking = false;
			this.render();
		}
	}

	private async cycleThinkingLevel(direction: 1 | -1 = 1): Promise<void> {
		if (this.settingThinking) return;
		const order = THINKING_LEVEL_CYCLE_ORDER;
		let cursor = Math.max(0, order.indexOf((this.state?.thinkingLevel ?? "off") as ThinkingLevel));

		for (let attempt = 0; attempt < order.length; attempt += 1) {
			const blocked = this.unsupportedThinkingLevelsForCurrentModel();
			let candidate: ThinkingLevel | null = null;
			for (let step = 1; step <= order.length; step += 1) {
				const nextIndex = (cursor + step * direction + order.length * 2) % order.length;
				const nextLevel = order[nextIndex] ?? "off";
				if (blocked.has(nextLevel)) continue;
				candidate = nextLevel;
				cursor = nextIndex;
				break;
			}
			if (!candidate) return;
			const applied = await this.setThinkingLevel(candidate);
			if (applied === candidate) return;
			const appliedIndex = order.indexOf((applied ?? candidate) as ThinkingLevel);
			if (appliedIndex >= 0) {
				cursor = appliedIndex;
			}
		}
	}

	private resolveContextWindow(raw?: Record<string, unknown>): number | null {
		const stateWindow =
			typeof this.state?.model?.contextWindow === "number" && Number.isFinite(this.state.model.contextWindow)
				? this.state.model.contextWindow
				: null;
		if (stateWindow && stateWindow > 0) return stateWindow;

		const provider = this.state?.model?.provider ?? "";
		const modelId = this.state?.model?.id ?? "";
		if (provider && modelId) {
			const fromCatalog = this.availableModels.find((m) => m.provider === provider && m.id === modelId)?.contextWindow;
			if (typeof fromCatalog === "number" && Number.isFinite(fromCatalog) && fromCatalog > 0) {
				return fromCatalog;
			}
		}

		if (raw) {
			const fromRaw = pickNumber(raw, [
				"contextWindow",
				"context_window",
				"contextUsage.contextWindow",
				"contextUsage.context_window",
				"usage.contextWindow",
				"usage.context_window",
			]);
			if (fromRaw && fromRaw > 0) return fromRaw;
		}

		return null;
	}

	private normalizeUsageRatio(rawRatio: number | null): number | null {
		if (rawRatio === null || !Number.isFinite(rawRatio)) return null;
		if (rawRatio > 1) return Math.min(1, Math.max(0, rawRatio / 100));
		return Math.min(1, Math.max(0, rawRatio));
	}

	private deriveLatestAssistantContextTokens(messages: Array<Record<string, unknown>>): number | null {
		const estimateMessageTokens = (message: Record<string, unknown>): number => {
			const role = typeof message.role === "string" ? message.role : "";
			let chars = 0;
			const content = (message as Record<string, unknown>).content;
			if (typeof content === "string") {
				chars += content.length;
			} else if (Array.isArray(content)) {
				for (const part of content) {
					if (!part || typeof part !== "object") continue;
					const block = part as Record<string, unknown>;
					const type = typeof block.type === "string" ? block.type : "";
					if (type === "text" && typeof block.text === "string") {
						chars += block.text.length;
					} else if (type === "thinking" || type === "reasoning") {
						if (typeof block.thinking === "string") chars += block.thinking.length;
						else if (typeof block.reasoning === "string") chars += block.reasoning.length;
						else if (typeof block.text === "string") chars += block.text.length;
					} else if (type === "toolCall") {
						const name = typeof block.name === "string" ? block.name : "";
						const args = JSON.stringify(block.arguments ?? {});
						chars += name.length + args.length;
					} else if (type === "image") {
						chars += 4800;
					}
				}
			}
			if (role === "bashExecution") {
				const command = typeof message.command === "string" ? message.command : "";
				const output = typeof message.output === "string" ? message.output : "";
				chars += command.length + output.length;
			}
			return Math.ceil(chars / 4);
		};

		for (let i = messages.length - 1; i >= 0; i -= 1) {
			const message = messages[i];
			if (!message || typeof message !== "object") continue;
			const role = typeof message.role === "string" ? message.role : "";
			if (role !== "assistant") continue;
			const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
			if (stopReason === "aborted" || stopReason === "error") continue;

			const usageTotal = pickNumber(message, [
				"usage.totalTokens",
				"usage.total_tokens",
				"usage.total",
				"usage.tokens.total",
				"usage.contextTokens",
				"usage.context_tokens",
			]);
			const usageInput = pickNumber(message, ["usage.input", "usage.inputTokens", "usage.input_tokens"]);
			const usageOutput = pickNumber(message, ["usage.output", "usage.outputTokens", "usage.output_tokens"]);
			const usageCacheRead = pickNumber(message, ["usage.cacheRead", "usage.cache_read"]);
			const usageCacheWrite = pickNumber(message, ["usage.cacheWrite", "usage.cache_write"]);
			const components = [usageInput, usageOutput, usageCacheRead, usageCacheWrite].filter(
				(value): value is number => value !== null && Number.isFinite(value) && value >= 0,
			);

			let usageTokens: number | null = null;
			if (usageTotal !== null && usageTotal > 0) {
				usageTokens = usageTotal;
			} else if (components.length > 0) {
				const sum = components.reduce((acc, value) => acc + value, 0);
				if (sum > 0) usageTokens = sum;
			}
			if (usageTokens === null) continue;

			let trailingTokens = 0;
			for (let j = i + 1; j < messages.length; j += 1) {
				const trailing = messages[j];
				if (!trailing || typeof trailing !== "object") continue;
				trailingTokens += estimateMessageTokens(trailing);
			}

			return usageTokens + trailingTokens;
		}
		return null;
	}

	private markContextUsageUnknown(): void {
		this.lastAssistantContextTokens = null;
		this.sessionStats = {
			...this.sessionStats,
			tokens: null,
			usageRatio: null,
			updatedAt: Date.now(),
		};
	}

	private refreshAfterCompaction(): void {
		void (async () => {
			try {
				await this.refreshFromBackend();
			} catch {
				// ignore and still attempt stats refresh
			}
			await this.refreshSessionStats(true);
		})();
	}

	private async refreshSessionStats(force = false): Promise<void> {
		if (this.refreshingSessionStats) return;
		if (!force && Date.now() - this.sessionStats.updatedAt < 1800) return;
		this.refreshingSessionStats = true;
		try {
			const raw = (await rpcBridge.getSessionStats()) as Record<string, unknown>;
			const lifetimeTokens = pickNumber(raw, [
				"totalTokens",
				"tokens.total",
				"tokens",
				"total_tokens",
				"usage.totalTokens",
				"usage.tokens",
				"usage.tokens.total",
				"session.totalTokens",
			]);
			const contextUsageRecord =
				raw.contextUsage && typeof raw.contextUsage === "object" ? (raw.contextUsage as Record<string, unknown>) : null;
			const contextUsageHasTokensKey = Boolean(contextUsageRecord && Object.prototype.hasOwnProperty.call(contextUsageRecord, "tokens"));
			const contextUsageHasPercentKey = Boolean(contextUsageRecord && Object.prototype.hasOwnProperty.call(contextUsageRecord, "percent"));
			const contextUsageTokensExplicitNull = contextUsageHasTokensKey && contextUsageRecord?.tokens === null;
			const contextUsagePercentExplicitNull = contextUsageHasPercentKey && contextUsageRecord?.percent === null;
			const contextTokensFromStats = pickNumber(raw, [
				"contextTokens",
				"context_tokens",
				"context.tokens",
				"contextUsage.tokens",
				"usage.contextTokens",
				"usage.context_tokens",
				"usage.tokens.context",
				"session.contextTokens",
			]);
			const costUsd = pickNumber(raw, [
				"costUsd",
				"estimatedCostUsd",
				"cost.total",
				"usage.cost.total",
				"cost",
			]);
			const stateMessageCount = this.state?.messageCount ?? 0;
			const statePendingCount = this.state?.pendingMessageCount ?? 0;
			const messageCount =
				stateMessageCount ||
				Math.round(
					pickNumber(raw, ["messageCount", "messages", "totalMessages", "usage.messageCount", "session.messageCount"]) ?? 0,
				);
			const pendingCount =
				statePendingCount || Math.round(pickNumber(raw, ["pendingCount", "pendingMessages", "usage.pendingCount"]) ?? 0);
			const contextWindow = this.resolveContextWindow(raw);
			const rawUsageRatio = this.normalizeUsageRatio(
				pickNumber(raw, [
					"usageRatio",
					"usage.ratio",
					"tokenUsageRatio",
					"usagePercent",
					"usage.percent",
					"contextUsage.percent",
					"context.percent",
					"contextUsagePercent",
					"context_usage.percent",
					"context_usage_percent",
				]),
			);
			const contextUsageExplicitlyUnknown =
				(contextUsageTokensExplicitNull || contextUsagePercentExplicitNull) &&
				contextTokensFromStats === null &&
				rawUsageRatio === null;
			const contextTokens = contextTokensFromStats ?? (contextUsageExplicitlyUnknown ? null : this.lastAssistantContextTokens);
			const usageRatio =
				rawUsageRatio ??
				(contextTokens !== null && contextWindow && contextWindow > 0
					? Math.min(1, Math.max(0, contextTokens / contextWindow))
					: null);
			const normalizedContextTokens =
				contextTokens ??
				(usageRatio !== null && contextWindow && contextWindow > 0 ? usageRatio * contextWindow : null);

			this.sessionStats = {
				tokens: normalizedContextTokens,
				lifetimeTokens,
				costUsd,
				messageCount,
				pendingCount,
				contextWindow,
				usageRatio,
				updatedAt: Date.now(),
			};
		} catch {
			const contextWindow = this.resolveContextWindow() ?? this.sessionStats.contextWindow;
			const usageRatio =
				this.sessionStats.tokens !== null && contextWindow && contextWindow > 0
					? Math.min(1, Math.max(0, this.sessionStats.tokens / contextWindow))
					: this.sessionStats.usageRatio;
			this.sessionStats = {
				...this.sessionStats,
				messageCount: this.state?.messageCount ?? this.sessionStats.messageCount,
				pendingCount: this.state?.pendingMessageCount ?? this.sessionStats.pendingCount,
				contextWindow,
				usageRatio,
				updatedAt: Date.now(),
			};
		} finally {
			this.refreshingSessionStats = false;
			this.render();
		}
	}

	private sessionStatsLines(): string[] {
		const parts: string[] = [];
		if (this.sessionStats.tokens !== null) {
			parts.push(`Context tokens: ${Math.round(this.sessionStats.tokens).toLocaleString()}`);
		}
		if (this.sessionStats.contextWindow) {
			parts.push(`Context window: ${Math.round(this.sessionStats.contextWindow).toLocaleString()}`);
		}
		if (this.sessionStats.usageRatio !== null) {
			parts.push(`Usage: ${(this.sessionStats.usageRatio * 100).toFixed(1)}%`);
		}
		if (this.sessionStats.lifetimeTokens !== null) {
			parts.push(`Session tokens total: ${Math.round(this.sessionStats.lifetimeTokens).toLocaleString()}`);
		}
		if (this.sessionStats.costUsd !== null) {
			parts.push(`Cost: ${formatUsd(this.sessionStats.costUsd)}`);
		}
		parts.push(`Messages: ${this.sessionStats.messageCount}`);
		parts.push(`Pending: ${this.sessionStats.pendingCount}`);
		return parts;
	}

	private sessionStatsTooltip(): string {
		const lines = this.sessionStatsLines();
		if (lines.length === 0) return "Session stats";
		return lines.join("\n");
	}

	private parseBashResult(raw: unknown): { stdout: string; stderr: string; exitCode: number } {
		const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		const output = typeof source.output === "string" ? source.output : "";
		const stdout = typeof source.stdout === "string" ? source.stdout : output;
		const stderr = typeof source.stderr === "string" ? source.stderr : "";
		const exit = source.exitCode ?? source.exit_code;
		if (typeof exit === "number" && Number.isFinite(exit)) {
			return { stdout, stderr, exitCode: exit };
		}
		if (typeof exit === "string") {
			const parsed = Number(exit);
			if (Number.isFinite(parsed)) return { stdout, stderr, exitCode: parsed };
		}
		return { stdout, stderr, exitCode: 0 };
	}

	private extractLatestChangelogSections(markdown: string, maxSections = 2): string {
		const lines = markdown.split(/\r?\n/);
		const firstSectionIndex = lines.findIndex((line) => line.startsWith("## "));
		if (firstSectionIndex < 0) return markdown;

		const header = lines.slice(0, firstSectionIndex).join("\n").trim();
		const sections: string[] = [];
		let index = firstSectionIndex;
		while (index < lines.length && sections.length < maxSections) {
			if (!lines[index].startsWith("## ")) {
				index += 1;
				continue;
			}
			let end = index + 1;
			while (end < lines.length && !lines[end].startsWith("## ")) {
				end += 1;
			}
			sections.push(lines.slice(index, end).join("\n").trimEnd());
			index = end;
		}

		const body = sections.join("\n\n").trim();
		return `${header ? `${header}\n\n` : ""}${body}`.trim();
	}

	private async loadPiAgentChangelogMarkdown(force = false): Promise<string> {
		if (this.loadingChangelog) {
			return this.changelogCacheMarkdown ?? "";
		}
		if (!force && this.changelogCacheMarkdown && Date.now() - this.changelogCacheAt < 45_000) {
			return this.changelogCacheMarkdown;
		}
		this.loadingChangelog = true;
		try {
			const result = await rpcBridge.getPiChangelog();
			const markdown = (result.content || "").trim();
			if (!markdown) {
				throw new Error("Pi Coding Agent changelog is empty");
			}
			this.changelogCacheMarkdown = markdown;
			this.changelogCacheAt = Date.now();
			return markdown;
		} finally {
			this.loadingChangelog = false;
		}
	}

	private parseNumstat(output: string): { additions: number; deletions: number } {
		let additions = 0;
		let deletions = 0;
		for (const line of output.split(/\r?\n/)) {
			if (!line.trim()) continue;
			const [rawAdd, rawDel] = line.split(/\t+/);
			const add = Number(rawAdd);
			const del = Number(rawDel);
			if (Number.isFinite(add)) additions += add;
			if (Number.isFinite(del)) deletions += del;
		}
		return { additions, deletions };
	}

	private async runGit(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		if (!this.projectPath) {
			return { stdout: "", stderr: "No active project", exitCode: -1 };
		}
		try {
			const raw = await rpcBridge.runGitCommand(args, { cwd: this.projectPath });
			return this.parseBashResult(raw);
		} catch (err) {
			return {
				stdout: "",
				stderr: err instanceof Error ? err.message : String(err),
				exitCode: -1,
			};
		}
	}

	private knownBranchesForCurrentProject(): string[] {
		if (!this.projectPath) return [];
		return this.gitKnownBranchesByProject.get(this.projectPath) ?? [];
	}

	private rememberGitBranches(branches: string[]): void {
		if (!this.projectPath) return;
		const clean = branches.map((branch) => branch.trim()).filter(Boolean);
		if (clean.length === 0) return;
		const current = this.gitKnownBranchesByProject.get(this.projectPath) ?? [];
		this.gitKnownBranchesByProject.set(this.projectPath, [...new Set([...current, ...clean])]);
	}

	private clearKnownBranchesForCurrentProject(): void {
		if (!this.projectPath) return;
		this.gitKnownBranchesByProject.delete(this.projectPath);
	}

	private async hasGitHeadCommit(): Promise<boolean> {
		const probe = await this.runGit(["rev-parse", "--verify", "HEAD"]);
		return probe.exitCode === 0;
	}

	private async switchUnbornHeadBranch(branch: string): Promise<{ ok: boolean; error: string }> {
		const bySymbolic = await this.runGit(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
		if (bySymbolic.exitCode === 0) {
			return { ok: true, error: "" };
		}
		const orphan = await this.runGit(["checkout", "--orphan", branch]);
		if (orphan.exitCode === 0) {
			return { ok: true, error: "" };
		}
		return {
			ok: false,
			error: orphan.stderr.trim() || bySymbolic.stderr.trim() || orphan.stdout.trim() || bySymbolic.stdout.trim(),
		};
	}

	private async refreshGitSummary(force = false): Promise<void> {
		if (this.refreshingGitSummary) return;
		if (!force && Date.now() - this.gitSummary.updatedAt < 2200) return;
		this.refreshingGitSummary = true;
		this.render();
		try {
			if (!this.projectPath) {
				this.gitSummary = {
					isRepo: false,
					branch: null,
					branches: [],
					branchEntries: [],
					hasRemoteBranches: false,
					dirtyFiles: 0,
					additions: 0,
					deletions: 0,
					updatedAt: Date.now(),
				};
				this.gitMenuOpen = false;
				this.gitBranchQuery = "";
				return;
			}

			const probe = await this.runGit(["rev-parse", "--is-inside-work-tree"]);
			const inRepo = probe.exitCode === 0 && probe.stdout.trim() === "true";
			if (!inRepo) {
				this.clearKnownBranchesForCurrentProject();
				this.gitSummary = {
					isRepo: false,
					branch: null,
					branches: [],
					branchEntries: [],
					hasRemoteBranches: false,
					dirtyFiles: 0,
					additions: 0,
					deletions: 0,
					updatedAt: Date.now(),
				};
				this.gitMenuOpen = false;
				this.gitBranchQuery = "";
				return;
			}

			const [branchPrimary, refsResult, statusResult, diffResult, stagedResult, hasCommit] = await Promise.all([
				this.runGit(["symbolic-ref", "--short", "HEAD"]),
				this.runGit(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]),
				this.runGit(["status", "--porcelain"]),
				this.runGit(["diff", "--numstat"]),
				this.runGit(["diff", "--cached", "--numstat"]),
				this.hasGitHeadCommit(),
			]);

			let branch = branchPrimary.stdout.trim() || null;
			if (!branch || branchPrimary.exitCode !== 0) {
				const fallback = await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
				const fallbackBranch = fallback.stdout.trim();
				branch = fallbackBranch && fallbackBranch !== "HEAD" ? fallbackBranch : null;
			} else if (branch === "HEAD") {
				branch = null;
			}

			const refs = refsResult.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);
			const branchIndex = buildGitBranchIndex(refs, {
				currentBranch: branch,
				knownLocalBranches: hasCommit ? [] : this.knownBranchesForCurrentProject(),
			});
			const branches = branchIndex.localNames;

			this.rememberGitBranches(branches);
			if (branch) this.rememberGitBranches([branch]);

			const dirtyFiles = statusResult.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean).length;

			const unstaged = this.parseNumstat(diffResult.stdout);
			const staged = this.parseNumstat(stagedResult.stdout);

			this.gitSummary = {
				isRepo: true,
				branch,
				branches,
				branchEntries: branchIndex.entries,
				hasRemoteBranches: branchIndex.hasRemoteEntries,
				dirtyFiles,
				additions: unstaged.additions + staged.additions,
				deletions: unstaged.deletions + staged.deletions,
				updatedAt: Date.now(),
			};
		} catch {
			this.gitSummary = {
				isRepo: false,
				branch: null,
				branches: [],
				branchEntries: [],
				hasRemoteBranches: false,
				dirtyFiles: 0,
				additions: 0,
				deletions: 0,
				updatedAt: Date.now(),
			};
			this.gitMenuOpen = false;
			this.gitBranchQuery = "";
		} finally {
			this.refreshingGitSummary = false;
			this.render();
		}
	}

	private resolveGitBranchSelection(query: string): GitBranchEntry | null {
		return findGitBranchEntryByQuery(query, this.gitSummary.branchEntries);
	}

	private async switchGitBranchEntry(entry: GitBranchEntry): Promise<void> {
		if (entry.scope === "remote") {
			await this.switchRemoteTrackingBranch(entry);
			return;
		}
		await this.switchGitBranch(entry.name);
	}

	private async switchRemoteTrackingBranch(entry: GitBranchEntry): Promise<void> {
		if (this.switchingGitBranch) return;
		const localBranch = entry.name.trim();
		const remoteRef = entry.fullName.trim();
		if (!localBranch || !remoteRef) return;
		if (this.gitSummary.branches.includes(localBranch)) {
			await this.switchGitBranch(localBranch);
			return;
		}

		this.switchingGitBranch = true;
		this.render();
		try {
			let result = await this.runGit(["switch", "--track", "-c", localBranch, remoteRef]);
			if (result.exitCode !== 0) {
				result = await this.runGit(["checkout", "--track", "-b", localBranch, remoteRef]);
			}
			if (result.exitCode !== 0) {
				const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
				if (message.includes("already exists")) {
					await this.switchGitBranch(localBranch);
					return;
				}
				let fallback = await this.runGit(["switch", "--track", remoteRef]);
				if (fallback.exitCode !== 0) {
					fallback = await this.runGit(["checkout", "--track", remoteRef]);
				}
				if (fallback.exitCode === 0) {
					this.gitMenuOpen = false;
					this.gitBranchQuery = "";
					this.pushNotice(`Switched to ${localBranch} (tracking ${remoteRef})`, "success");
					await this.refreshGitSummary(true);
					return;
				}
				this.pushNotice(result.stderr.trim() || result.stdout.trim() || `Failed to switch branch: ${remoteRef}`, "error");
				return;
			}
			this.gitMenuOpen = false;
			this.gitBranchQuery = "";
			this.pushNotice(`Switched to ${localBranch} (tracking ${remoteRef})`, "success");
			await this.refreshGitSummary(true);
		} catch (err) {
			console.error("Failed to switch remote branch:", err);
			this.pushNotice("Failed to switch remote branch", "error");
		} finally {
			this.switchingGitBranch = false;
			this.render();
		}
	}

	private async fetchGitRemotes(): Promise<void> {
		if (!this.gitSummary.isRepo || this.fetchingGitRemotes || this.switchingGitBranch) return;
		this.fetchingGitRemotes = true;
		this.render();
		try {
			const result = await this.runGit(["fetch", "--all", "--prune"]);
			if (result.exitCode !== 0) {
				this.pushNotice(result.stderr.trim() || result.stdout.trim() || "Failed to fetch remotes", "error");
				return;
			}
			this.pushNotice("Fetched remote branches", "success");
			await this.refreshGitSummary(true);
		} catch (err) {
			console.error("Failed to fetch remotes:", err);
			this.pushNotice("Failed to fetch remotes", "error");
		} finally {
			this.fetchingGitRemotes = false;
			this.render();
		}
	}

	private async switchGitBranch(branch: string): Promise<void> {
		if (!branch || this.switchingGitBranch) return;
		const currentBranch = this.gitSummary.branch || "";
		if (branch === currentBranch) {
			this.gitMenuOpen = false;
			this.gitBranchQuery = "";
			this.render();
			return;
		}

		this.switchingGitBranch = true;
		this.render();
		try {
			const hasCommit = await this.hasGitHeadCommit();
			if (!hasCommit) {
				const switched = await this.switchUnbornHeadBranch(branch);
				if (!switched.ok) {
					this.pushNotice(switched.error || `Failed to switch branch: ${branch}`, "error");
					return;
				}
				this.gitMenuOpen = false;
				this.gitBranchQuery = "";
				this.pushNotice(`Switched to ${branch}`, "success");
				await this.refreshGitSummary(true);
				return;
			}

			let result = await this.runGit(["switch", branch]);
			if (result.exitCode !== 0) {
				result = await this.runGit(["checkout", branch]);
			}
			if (result.exitCode !== 0) {
				this.pushNotice(result.stderr.trim() || result.stdout.trim() || `Failed to switch branch: ${branch}`, "error");
				return;
			}
			this.gitMenuOpen = false;
			this.gitBranchQuery = "";
			this.pushNotice(`Switched to ${branch}`, "success");
			await this.refreshGitSummary(true);
		} catch (err) {
			console.error("Failed to switch branch:", err);
			this.pushNotice("Failed to switch branch", "error");
		} finally {
			this.switchingGitBranch = false;
			this.render();
		}
	}

	private async createAndCheckoutBranch(rawName = ""): Promise<void> {
		if (this.switchingGitBranch) return;

		let proposed = rawName.trim();
		if (!proposed) {
			const prompted = window.prompt("Branch name", this.gitBranchQuery.trim()) ?? "";
			proposed = prompted.trim();
		}
		if (!proposed) {
			this.pushNotice("Enter a branch name first", "info");
			return;
		}
		const existingBranch = this.resolveGitBranchSelection(proposed);
		if (existingBranch) {
			await this.switchGitBranchEntry(existingBranch);
			return;
		}

		if (!/^[A-Za-z0-9._\/-]+$/.test(proposed)) {
			this.pushNotice("Use letters, numbers, ., _, -, / for branch names", "error");
			return;
		}

		const refCheck = await this.runGit(["check-ref-format", "--branch", proposed]);
		if (refCheck.exitCode !== 0) {
			this.pushNotice(refCheck.stderr.trim() || refCheck.stdout.trim() || "Invalid branch name", "error");
			return;
		}

		this.switchingGitBranch = true;
		this.render();
		try {
			const hasCommit = await this.hasGitHeadCommit();
			if (!hasCommit) {
				const switched = await this.switchUnbornHeadBranch(proposed);
				if (!switched.ok) {
					this.pushNotice(switched.error || "Failed to create branch", "error");
					return;
				}
				this.gitMenuOpen = false;
				this.gitBranchQuery = "";
				this.pushNotice(`Created and switched to ${proposed}`, "success");
				await this.refreshGitSummary(true);
				return;
			}

			let result = await this.runGit(["switch", "-c", proposed]);
			if (result.exitCode !== 0) {
				result = await this.runGit(["checkout", "-b", proposed]);
			}
			if (result.exitCode !== 0) {
				const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
				if (message.includes("already exists")) {
					let switchExisting = await this.runGit(["switch", proposed]);
					if (switchExisting.exitCode !== 0) {
						switchExisting = await this.runGit(["checkout", proposed]);
					}
					if (switchExisting.exitCode === 0) {
						this.gitMenuOpen = false;
						this.gitBranchQuery = "";
						this.pushNotice(`Switched to ${proposed}`, "success");
						await this.refreshGitSummary(true);
						return;
					}
				}

				const branchOnly = await this.runGit(["branch", proposed]);
				if (branchOnly.exitCode === 0) {
					let switchToCreated = await this.runGit(["switch", proposed]);
					if (switchToCreated.exitCode !== 0) {
						switchToCreated = await this.runGit(["checkout", proposed]);
					}
					if (switchToCreated.exitCode === 0) {
						this.gitMenuOpen = false;
						this.gitBranchQuery = "";
						this.pushNotice(`Created and switched to ${proposed}`, "success");
						await this.refreshGitSummary(true);
						return;
					}
				}

				this.pushNotice(result.stderr.trim() || result.stdout.trim() || "Failed to create branch", "error");
				return;
			}
			this.gitMenuOpen = false;
			this.gitBranchQuery = "";
			this.pushNotice(`Created and switched to ${proposed}`, "success");
			await this.refreshGitSummary(true);
		} catch (err) {
			console.error("Failed to create branch:", err);
			this.pushNotice("Failed to create branch", "error");
		} finally {
			this.switchingGitBranch = false;
			this.render();
		}
	}

	private renderGitRepoControl(): TemplateResult {
		if (!this.gitSummary.isRepo) {
			return html`
				<button class="composer-repo-btn" ?disabled=${this.creatingGitRepo || this.refreshingGitSummary} @click=${() => void this.createGitRepository()}>
					${uiIcon("git")}
					<span>${this.creatingGitRepo ? "Creating git repository…" : "Create git repository"}</span>
				</button>
			`;
		}

		const currentBranch = this.gitSummary.branch || "detached";
		const query = this.gitBranchQuery.trim().toLowerCase();
		const branchEntries = this.gitSummary.branchEntries.filter((entry) => {
			if (!query) return true;
			const haystack = `${entry.name} ${entry.fullName} ${entry.remote ?? ""} ${entry.scope}`.toLowerCase();
			return haystack.includes(query);
		});
		const filesLabel = this.gitSummary.dirtyFiles === 1 ? "file" : "files";
		const matchingEntry = this.gitBranchQuery.trim().length > 0 ? this.resolveGitBranchSelection(this.gitBranchQuery) : null;
		const branchActionLabel = matchingEntry
			? matchingEntry.scope === "remote"
				? `Checkout ${matchingEntry.fullName}`
				: `Switch to ${matchingEntry.name}`
			: "Create and checkout new branch…";

		return html`
			<div class="git-branch-wrap">
				<button
					class="git-branch-pill ${this.gitMenuOpen ? "open" : ""}"
					title="Switch branch"
					?disabled=${this.switchingGitBranch || this.refreshingGitSummary || this.fetchingGitRemotes}
					@click=${(e: Event) => {
						e.stopPropagation();
						this.gitMenuOpen = !this.gitMenuOpen;
						if (!this.gitMenuOpen) this.gitBranchQuery = "";
						this.render();
					}}
				>
					${uiIcon("git")}
					<span class="git-branch-pill-name">${currentBranch}</span>
					<span class="git-branch-pill-caret">▾</span>
				</button>

				${this.gitMenuOpen
					? html`
						<div class="git-branch-menu" @click=${(e: Event) => e.stopPropagation()}>
							<label class="git-branch-search">
								<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.2"></circle><path d="M10.2 10.2l3 3"></path></svg>
								<input
									type="text"
									placeholder="Search branches or type a new name"
									.value=${this.gitBranchQuery}
									@input=${(e: Event) => {
										this.gitBranchQuery = (e.target as HTMLInputElement).value;
										this.render();
									}}
									@keydown=${(e: KeyboardEvent) => {
										if (e.key === "Enter") {
											e.preventDefault();
											void this.createAndCheckoutBranch(this.gitBranchQuery);
										}
									}}
								/>
							</label>
							<div class="git-branch-menu-head">
								<div class="git-branch-menu-title">Branches</div>
								<button
									class="git-branch-fetch"
									?disabled=${this.fetchingGitRemotes || this.switchingGitBranch}
									@click=${() => void this.fetchGitRemotes()}
								>
									${this.fetchingGitRemotes ? "Fetching…" : "Fetch"}
								</button>
							</div>
							<div class="git-branch-list">
								${branchEntries.length === 0
									? html`<div class="git-branch-empty">No branches found.</div>`
									: branchEntries.map((entry) => {
											const active = entry.scope === "local" && entry.name === currentBranch;
											const disabled = active || this.switchingGitBranch || this.fetchingGitRemotes;
											const label = entry.scope === "remote" ? entry.fullName : entry.name;
											return html`
												<button
													class="git-branch-item ${active ? "active" : ""}"
													?disabled=${disabled}
													@click=${() => void this.switchGitBranchEntry(entry)}
												>
													<div class="git-branch-item-top">
														<span class="git-branch-item-icon">${uiIcon("git")}</span>
														<span class="git-branch-item-name">${label}</span>
														<span class="git-branch-item-trailing">
															${entry.scope === "remote" ? html`<span class="git-branch-item-badge">remote</span>` : nothing}
															${active ? html`<span class="git-branch-item-check">✓</span>` : nothing}
														</span>
													</div>
													${entry.scope === "remote"
														? html`<div class="git-branch-item-meta">Checkout tracking branch from ${entry.fullName}</div>`
														: active && this.gitSummary.dirtyFiles > 0
															? html`
																<div class="git-branch-item-meta">
																	Uncommitted: ${this.gitSummary.dirtyFiles.toLocaleString()} ${filesLabel}
																	<span class="git-delta plus">+${this.gitSummary.additions.toLocaleString()}</span>
																	<span class="git-delta minus">-${this.gitSummary.deletions.toLocaleString()}</span>
																</div>
															`
															: nothing}
												</button>
											`;
										})}
							</div>
							<button
								class="git-branch-create"
								?disabled=${this.switchingGitBranch || this.fetchingGitRemotes}
								@click=${() => void this.createAndCheckoutBranch(this.gitBranchQuery)}
							>
								<span class="git-branch-create-plus">${matchingEntry ? "↩" : "＋"}</span>
								<span>${branchActionLabel}</span>
							</button>
						</div>
					`
					: nothing}
			</div>
		`;
	}

	private extractRuntimeErrorMessage(event: Record<string, unknown> | null | undefined): string {
		if (!event || typeof event !== "object") return "";
		const direct = pickString(event, [
			"errorMessage",
			"error.message",
			"error",
			"message",
			"reason",
			"details.message",
			"details.error",
			"finalError",
			"providerError.message",
			"providerError.error",
		]);
		if (direct) return direct;
		const nestedError = event.error;
		if (nestedError && typeof nestedError === "object") {
			return pickString(nestedError as Record<string, unknown>, ["message", "error", "detail", "reason"]) ?? "";
		}
		return "";
	}

	private extractAssistantMessageError(message: Record<string, unknown> | null | undefined): string {
		if (!message || typeof message !== "object") return "";
		const stopReason = pickString(message, ["stopReason", "stop_reason", "reason"])
			?.trim()
			.toLowerCase() ?? "";
		const errorMessage = this.extractRuntimeErrorMessage(message).trim();
		if (stopReason === "aborted") {
			if (errorMessage && errorMessage.toLowerCase() !== "request was aborted") {
				return errorMessage;
			}
			return "Operation aborted";
		}
		if (stopReason === "error") {
			return errorMessage || "Unknown error";
		}
		return "";
	}

	private toRuntimeInlineLine(text: string): string {
		const raw = text.trim();
		if (!raw) return "";
		if (/^error\b[:\s-]*/i.test(raw)) return raw;
		const stripped = raw
			.replace(/^runtime error(?:\s*\([^)]*\))?[:\s-]*/i, "")
			.replace(/^extension error(?:\s*\([^)]*\))?[:\s-]*/i, "")
			.replace(/^run failed[:\s-]*/i, "")
			.replace(/^streaming error[:\s-]*/i, "")
			.trim();
		if (/^error\b[:\s-]*/i.test(stripped)) return stripped;
		return `Error: ${stripped || raw}`;
	}

	private appendSystemMessage(
		text: string,
		options: { label?: string; idPrefix?: string; markdown?: boolean; collapsibleTitle?: string; collapsedByDefault?: boolean } = {},
	): void {
		const line = text.trim();
		if (!line) return;
		const isCollapsible = Boolean(options.collapsibleTitle && options.collapsibleTitle.trim().length > 0);
		this.messages.push({
			id: uid(options.idPrefix ?? "system"),
			role: "system",
			text: line,
			label: options.label,
			renderAsMarkdown: options.markdown,
			collapsibleTitle: isCollapsible ? options.collapsibleTitle : undefined,
			collapsibleExpanded: isCollapsible ? !(options.collapsedByDefault ?? true) : undefined,
			toolCalls: [],
		});
		this.render();
		this.scrollToBottom();
	}

	private pushRuntimeNotice(text: string, kind: Notice["kind"] = "error", dedupeMs = 2000): void {
		const normalized = text.trim().toLowerCase();
		if (!normalized) return;
		const now = Date.now();
		if (this.lastRuntimeNoticeSignature === normalized && now - this.lastRuntimeNoticeAt < dedupeMs) {
			return;
		}
		this.lastRuntimeNoticeSignature = normalized;
		this.lastRuntimeNoticeAt = now;
		const inlineLine = this.toRuntimeInlineLine(text);
		if (inlineLine) {
			this.appendSystemMessage(inlineLine, { idPrefix: "runtimeError" });
		}
		this.pushNotice(text, kind);
	}

	private extensionLabelFromPath(pathValue: string | null | undefined): string {
		const value = normalizeText(pathValue);
		if (!value) return "Extension";
		const normalized = value.replace(/\\/g, "/");
		const parts = normalized.split("/").filter((part) => part.length > 0);
		if (parts.length === 0) return value;
		const last = parts[parts.length - 1];
		if (/^index\.(?:ts|js|mjs|cjs)$/i.test(last) && parts.length >= 2) {
			return parts[parts.length - 2];
		}
		return last;
	}

	private maybePushExtensionCompatibilityHint(event: Record<string, unknown>, errorMessage: string): void {
		const normalizedError = errorMessage.trim().toLowerCase();
		if (!normalizedError.includes("modelregistry.getapikey is not a function")) return;
		const extensionPath = pickString(event, ["extensionPath", "extension", "path"]);
		const callbackEvent = pickString(event, ["event", "callback", "method"]);
		const signature = `${(extensionPath ?? "").toLowerCase()}::${(callbackEvent ?? "").toLowerCase()}::modelregistry.getapikey`;
		if (this.extensionCompatibilityHintsShown.has(signature)) return;
		this.extensionCompatibilityHintsShown.add(signature);
		const extensionLabel = this.extensionLabelFromPath(extensionPath);
		const during = callbackEvent ? ` during ${callbackEvent}` : "";
		this.pushRuntimeNotice(
			`${extensionLabel} uses deprecated ctx.modelRegistry.getApiKey()${during}. Update the extension to ctx.modelRegistry.getApiKeyAndHeaders() (or add a compatibility fallback).`,
			"error",
			12000,
		);
	}

	private handleEvent(event: Record<string, unknown>): void {
		const type = event.type as string;
		if (type === "response") return;

		switch (type) {
			case "agent_start": {
				this.pendingDeliveryMode = "steer";
				this.runHasAssistantText = false;
				this.runSawToolActivity = false;
				this.keepWorkflowExpandedUntilAssistantText = true;
				this.collapsedAutoWorkflowIds.clear();
				if (this.state) {
					this.state = { ...this.state, isStreaming: true };
					this.onStateChange?.(this.state);
				}
				this.autoFollowChat = true;
				this.onRunStateChange?.(true);
				this.scheduleStreamingUiReconcile(2400);
				this.render();
				this.scrollToBottom();
				break;
			}

			case "agent_end": {
				this.cancelStreamingUiReconcile();
				if (this.state) {
					this.state = { ...this.state, isStreaming: false };
					this.onStateChange?.(this.state);
				}
				const last = this.messages[this.messages.length - 1];
				if (last && last.role === "assistant") {
					last.isStreaming = false;
					last.isThinkingStreaming = false;
				}
				this.retryStatus = "";
				const runError = this.extractRuntimeErrorMessage(event);
				if (runError && !(last?.role === "assistant" && last.errorText)) {
					this.pushRuntimeNotice(`Run failed: ${truncate(runError, 180)}`, "error", 2600);
				}
				this.runHasAssistantText = false;
				this.runSawToolActivity = false;
				this.keepWorkflowExpandedUntilAssistantText = false;
				this.onRunStateChange?.(false);
				rpcBridge
					.getState()
					.then((s) => {
						this.state = s;
						this.syncComposerQueueFromState(s);
						this.pendingDeliveryMode = s.isStreaming ? "steer" : "prompt";
						this.onStateChange?.(s);
						void this.refreshSessionStats(true);
						void this.refreshGitSummary(true);
						this.render();
					})
					.catch(() => {
						/* ignore */
					});
				this.render();
				break;
			}

			case "message_start": {
				const msg = event.message as Record<string, unknown>;
				const role = typeof msg.role === "string" ? msg.role : "";
				if (role === "user") {
					this.promoteQueuedMessageFromUserEvent(msg);
					break;
				}
				if (role === "assistant") {
					const last = this.messages[this.messages.length - 1];
					if (last?.role === "assistant" && last.isStreaming) {
						break;
					}
					const initialText = this.extractText(msg.content);
					const assistantError = this.extractAssistantMessageError(msg);
					if (initialText.trim().length === 0 && !assistantError) {
						break;
					}
					this.ensureStreamingAssistantMessage({
						text: initialText,
						errorText: assistantError || undefined,
					});
					if (initialText.trim().length > 0) {
						this.runHasAssistantText = true;
						if (this.runSawToolActivity) {
							this.keepWorkflowExpandedUntilAssistantText = false;
						}
					}
					this.render();
					this.scrollToBottom();
					break;
				}

				if (role === "toolResult") {
					this.runSawToolActivity = true;
					this.keepWorkflowExpandedUntilAssistantText = true;
					const toolCallId = typeof msg.toolCallId === "string" ? msg.toolCallId : "";
					const output = this.extractToolOutput(msg.content ?? msg.result ?? msg);
					const isError = Boolean(msg.isError);
					const toolName = typeof msg.toolName === "string" ? msg.toolName : "";
					let tool = toolCallId ? this.findToolCall(toolCallId) : null;
					if (!tool && toolName) {
						tool = this.findMostRecentRunningToolByName(toolName);
					}
					if (tool) {
						tool.result = output || "(no output)";
						tool.isError = isError;
						tool.isRunning = false;
						tool.streamingOutput = undefined;
						tool.isExpanded = false;
						tool.endedAt = Date.now();
						if (!tool.startedAt) tool.startedAt = tool.endedAt;
					} else {
						this.attachOrphanToolResult(toolName, output, isError);
					}
					this.render();
					this.scrollToBottom();
				}
				break;
			}

			case "message_update": {
				const assistantEvent = event.assistantMessageEvent as Record<string, unknown>;
				if (!assistantEvent) break;
				const subtype = typeof assistantEvent.type === "string" ? assistantEvent.type : "";

				if (subtype === "error") {
					const streamError = this.extractRuntimeErrorMessage(assistantEvent) || this.extractRuntimeErrorMessage(event);
					const assistant = this.ensureStreamingAssistantMessage(streamError ? { errorText: streamError } : undefined);
					assistant.isStreaming = false;
					assistant.isThinkingStreaming = false;
					if (streamError) {
						assistant.errorText = streamError;
					}
					this.render();
					break;
				}

				if (subtype === "text_delta") {
					const assistant = this.ensureStreamingAssistantMessage();
					const partialText = this.extractAssistantPartialContent(assistantEvent, "text");
					assistant.text = this.mergeStreamingText(assistant.text, partialText, assistantEvent.delta);
					assistant.isThinkingStreaming = false;
					if (assistant.text.trim().length > 0) {
						this.runHasAssistantText = true;
						if (this.runSawToolActivity) {
							this.keepWorkflowExpandedUntilAssistantText = false;
						}
					}
					this.scheduleStreamingUiReconcile(1800);
					this.render();
					this.scrollToBottom();
				} else if (subtype === "thinking_delta" || subtype === "reasoning_delta" || subtype.includes("thinking") || subtype.includes("reason")) {
					const assistant = this.ensureStreamingAssistantMessage();
					const partialThinking = this.extractAssistantPartialContent(assistantEvent, "thinking");
					const currentThinking = assistant.thinking || "";
					assistant.thinking = this.mergeStreamingText(currentThinking, partialThinking, assistantEvent.delta);
					assistant.isThinkingStreaming = true;
					this.scheduleStreamingUiReconcile(1800);
					if ((assistant.thinking?.length || 0) % 100 === 0) this.render();
				} else if (subtype === "toolcall_end") {
					this.runSawToolActivity = true;
					this.keepWorkflowExpandedUntilAssistantText = true;
					const assistant = this.ensureStreamingAssistantMessage();
					assistant.isThinkingStreaming = false;
					const tc = assistantEvent.toolCall as Record<string, unknown>;
					if (tc) {
						const rawId = typeof tc.id === "string" ? tc.id.trim() : "";
						const id = rawId || uid("tc");
						const existing = assistant.toolCalls.find((entry) => entry.id === id);
						if (existing) {
							existing.name = typeof tc.name === "string" && tc.name.trim().length > 0 ? tc.name : existing.name;
							existing.args = ((tc.arguments ?? existing.args) as Record<string, unknown>) || existing.args;
							existing.isRunning = true;
							existing.isExpanded = false;
							existing.startedAt = existing.startedAt ?? Date.now();
							existing.endedAt = undefined;
						} else {
							assistant.toolCalls.push({
								id,
								name: (tc.name as string) || "tool",
								args: ((tc.arguments ?? {}) as Record<string, unknown>) || {},
								isRunning: true,
								isExpanded: false,
								startedAt: Date.now(),
							});
						}
						this.render();
					}
				}
				break;
			}

			case "turn_end": {
				const turnMessage = event.message as Record<string, unknown> | undefined;
				const turnRole = typeof turnMessage?.role === "string" ? turnMessage.role : "";
				if (turnRole === "assistant") {
					const last = this.messages[this.messages.length - 1];
					if (last?.role === "assistant") {
						last.isStreaming = false;
						last.isThinkingStreaming = false;
						const turnError = this.extractAssistantMessageError(turnMessage);
						if (turnError) {
							last.errorText = turnError;
						}
					}
					this.render();
				}
				break;
			}

			case "message_end": {
				const last = this.messages[this.messages.length - 1];
				if (last?.role === "assistant") {
					last.isStreaming = false;
					last.isThinkingStreaming = false;
					const completed = event.message as Record<string, unknown> | undefined;
					const completedError = this.extractAssistantMessageError(completed);
					if (completedError) {
						last.errorText = completedError;
					}
				}
				this.scheduleStreamingUiReconcile(350);
				this.render();
				break;
			}

			case "tool_execution_start": {
				const id = event.toolCallId as string | undefined;
				if (!id) break;
				const tool = this.findToolCall(id);
				if (tool) {
					tool.isRunning = true;
					tool.isExpanded = false;
					tool.startedAt = tool.startedAt ?? Date.now();
					tool.endedAt = undefined;
					this.render();
				}
				break;
			}

			case "tool_execution_update": {
				const toolCallId = event.toolCallId as string | undefined;
				const partialResult = event.partialResult as Record<string, unknown> | undefined;
				if (!toolCallId || !partialResult) break;
				const tool = this.findToolCall(toolCallId);
				if (!tool) break;
				const partialText = this.extractToolOutput(partialResult);
				if (partialText) {
					const currentOutput = tool.streamingOutput ?? tool.result ?? "";
					tool.streamingOutput = this.mergeStreamingText(currentOutput, partialText, partialResult.delta);
				}
				tool.isRunning = true;
				this.render();
				this.scrollToBottom();
				break;
			}

			case "tool_execution_end": {
				const toolCallId = event.toolCallId as string | undefined;
				if (!toolCallId) break;
				const result = event.result as Record<string, unknown> | string | undefined;
				const isError = Boolean(event.isError);
				const tool = this.findToolCall(toolCallId);
				if (!tool) break;
				tool.isRunning = false;
				tool.streamingOutput = undefined;
				tool.isError = isError;
				if (typeof result === "string") {
					tool.result = result;
				} else if (result && typeof result === "object") {
					const content = this.extractToolOutput(result);
					tool.result = content || "(no output)";
				} else {
					tool.result = tool.result || "(no output)";
				}
				tool.isExpanded = false;
				tool.endedAt = Date.now();
				if (!tool.startedAt) tool.startedAt = tool.endedAt;
				this.render();
				this.scrollToBottom();
				break;
			}

			case "auto_compaction_start": {
				this.compactionInsertIndex = this.messages.length;
				this.compactionCycle = {
					id: uid("compaction"),
					status: "running",
					startedAt: Date.now(),
					endedAt: null,
					summary: "Compacting context…",
					errorMessage: null,
					details: ["Compaction started"],
					expanded: false,
				};
				this.render();
				break;
			}

			case "auto_compaction_update":
			case "auto_compaction_progress": {
				if (!this.compactionCycle) break;
				const detail =
					pickString(event, ["message", "status", "phase", "step", "detail"]) ||
					this.extractToolOutput(event.detail ?? event.payload ?? event).trim();
				if (detail) {
					const cleaned = truncate(detail.replace(/\s+/g, " ").trim(), 220);
					if (cleaned && this.compactionCycle.details[this.compactionCycle.details.length - 1] !== cleaned) {
						this.compactionCycle.details.push(cleaned);
					}
				}
				this.render();
				break;
			}

			case "auto_compaction_end": {
				const aborted = Boolean(event.aborted);
				const errorMessage = this.extractRuntimeErrorMessage(event);
				if (!this.compactionCycle) {
					this.compactionInsertIndex = this.messages.length;
					this.compactionCycle = {
						id: uid("compaction"),
						status: "running",
						startedAt: Date.now(),
						endedAt: null,
						summary: "Compacting context…",
						errorMessage: null,
						details: [],
						expanded: false,
					};
				}
				this.compactionCycle.endedAt = Date.now();
				if (aborted) {
					this.compactionCycle.status = "aborted";
					this.compactionCycle.summary = "Compaction aborted";
					this.compactionCycle.details.push("Compaction was aborted before completion.");
					this.pushNotice("Auto-compaction aborted", "info");
				} else if (errorMessage) {
					this.compactionCycle.status = "error";
					this.compactionCycle.summary = "Compaction failed";
					this.compactionCycle.errorMessage = truncate(errorMessage, 220);
					this.compactionCycle.details.push(`Failure: ${truncate(errorMessage, 220)}`);
					this.pushRuntimeNotice(`Auto-compaction failed: ${truncate(errorMessage, 180)}`, "error", 2600);
				} else {
					this.compactionCycle.status = "done";
					this.compactionCycle.summary = "Compaction complete";
					const tokensBefore = pickNumber(event, ["result.tokensBefore", "tokensBefore", "tokens_before"]);
					if (typeof tokensBefore === "number" && Number.isFinite(tokensBefore)) {
						this.compactionCycle.details.push(`Context before compaction: ${Math.round(tokensBefore).toLocaleString()} tokens`);
					}
					this.compactionCycle.details.push("Compaction completed successfully.");
					this.markContextUsageUnknown();
					this.pushNotice("Auto-compaction complete", "success");
					this.refreshAfterCompaction();
				}
				this.render();
				break;
			}

			case "auto_retry_start": {
				const attempt = typeof event.attempt === "number" ? event.attempt : 1;
				const maxAttempts = typeof event.maxAttempts === "number" ? event.maxAttempts : 1;
				const delayMs = typeof event.delayMs === "number" ? event.delayMs : 0;
				const errorMessage = this.extractRuntimeErrorMessage(event);
				this.retryStatus = `Retry ${attempt}/${maxAttempts} in ${(delayMs / 1000).toFixed(1)}s`;
				const retryLine = errorMessage
					? `Retry ${attempt}/${maxAttempts} in ${(delayMs / 1000).toFixed(1)}s · ${truncate(errorMessage, 150)}`
					: `Retry ${attempt}/${maxAttempts} in ${(delayMs / 1000).toFixed(1)}s`;
				this.appendSystemMessage(retryLine, { idPrefix: "runtime" });
				this.render();
				break;
			}

			case "auto_retry_end": {
				const success = Boolean(event.success);
				const attempt = typeof event.attempt === "number" ? event.attempt : null;
				this.retryStatus = "";
				if (!success) {
					const finalError = this.extractRuntimeErrorMessage(event) || "Unknown retry failure";
					this.pushRuntimeNotice(`Retry failed: ${truncate(finalError, 180)}`, "error", 2600);
				} else {
					this.appendSystemMessage(attempt ? `Retry succeeded on attempt ${attempt}` : "Retry succeeded", { idPrefix: "runtime" });
				}
				this.render();
				break;
			}

			case "error": {
				const errorMessage = this.extractRuntimeErrorMessage(event) || "Unknown runtime error";
				const source = pickString(event, ["source", "phase", "stage", "provider", "code"]);
				if (source === "stderr" || source === "stdout_text") {
					const line = /^error\b[:\s-]*/i.test(errorMessage) ? errorMessage : `Error: ${errorMessage}`;
					this.pushRuntimeNotice(truncate(line, 220), "error", 2600);
				} else {
					const prefix = source ? `Runtime error (${source})` : "Runtime error";
					this.pushRuntimeNotice(`${prefix}: ${truncate(errorMessage, 180)}`, "error", 2600);
				}
				break;
			}

			case "extension_error": {
				const error = this.extractRuntimeErrorMessage(event) || "Unknown extension error";
				const extensionPath = pickString(event, ["extensionPath", "extension"]);
				const extensionLabel = this.extensionLabelFromPath(extensionPath);
				const source = pickString(event, ["event", "source", "callback", "method", "provider"]);
				const prefix = source ? `Extension error (${extensionLabel}:${source})` : `Extension error (${extensionLabel})`;
				this.pushRuntimeNotice(`${prefix}: ${truncate(error, 180)}`, "error", 2600);
				this.maybePushExtensionCompatibilityHint(event, error);
				break;
			}

			case "rpc_connected":
				this.isConnected = true;
				this.bindingStatusText = this.projectPath ? "Loading session…" : null;
				if (this.disconnectNoticeTimer) {
					clearTimeout(this.disconnectNoticeTimer);
					this.disconnectNoticeTimer = null;
				}
				this.render();
				if (this.projectPath) {
					void this.refreshFromBackend();
					if (!this.loadingModels) {
						void this.loadAvailableModels();
					}
				}
				break;

			case "rpc_disconnected":
				this.isConnected = false;
				this.cancelStreamingUiReconcile();
				this.bindingStatusText = this.projectPath ? "Reconnecting session…" : null;
				this.modelLoadRequestSeq += 1;
				this.loadingModels = false;
				if (this.disconnectNoticeTimer) {
					clearTimeout(this.disconnectNoticeTimer);
				}
				this.disconnectNoticeTimer = setTimeout(() => {
					this.disconnectNoticeTimer = null;
					if (!rpcBridge.isConnected) {
						this.pushNotice("Disconnected from pi process", "error");
						this.render();
					}
				}, 900);
				break;
		}
	}

	private findToolCall(id: string): ToolCallBlock | null {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const message = this.messages[i];
			const found = message.toolCalls.find((tc) => tc.id === id);
			if (found) return found;
		}
		return null;
	}

	private findMostRecentRunningToolByName(name: string): ToolCallBlock | null {
		const normalized = name.trim().toLowerCase();
		if (!normalized) return null;
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const message = this.messages[i];
			for (let j = message.toolCalls.length - 1; j >= 0; j--) {
				const tool = message.toolCalls[j];
				if (tool.name.trim().toLowerCase() !== normalized) continue;
				if (!tool.isRunning && tool.result) continue;
				return tool;
			}
		}
		return null;
	}

	private findMostRecentAssistantMessage(): UiMessage | null {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const message = this.messages[i];
			if (message.role === "assistant") return message;
		}
		return null;
	}

	private attachOrphanToolResult(toolName: string, output: string, isError: boolean): void {
		const assistantMessage = this.findMostRecentAssistantMessage();
		if (!assistantMessage) {
			this.messages.push({
				id: uid("toolResult"),
				role: "system",
				text: `Tool result${isError ? " (error)" : ""}:\n${output || "(no output)"}`,
				label: "tool-result",
				toolCalls: [],
			});
			return;
		}
		assistantMessage.toolCalls.push({
			id: uid("tc"),
			name: toolName || "tool",
			args: {},
			result: output || "(no output)",
			isError,
			isRunning: false,
			isExpanded: false,
			startedAt: Date.now(),
			endedAt: Date.now(),
		});
	}

	private pushNotice(text: string, kind: Notice["kind"]): void {
		const id = uid("notice");
		this.notices = [...this.notices, { id, text, kind }];
		this.render();
		setTimeout(() => {
			this.notices = this.notices.filter((n) => n.id !== id);
			this.render();
		}, 4200);
	}

	private isImageName(name: string): boolean {
		return /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(name.toLowerCase());
	}

	private mimeFromFileName(name: string): string {
		const lower = name.toLowerCase();
		if (lower.endsWith(".png")) return "image/png";
		if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
		if (lower.endsWith(".gif")) return "image/gif";
		if (lower.endsWith(".webp")) return "image/webp";
		if (lower.endsWith(".bmp")) return "image/bmp";
		if (lower.endsWith(".svg")) return "image/svg+xml";
		if (lower.endsWith(".avif")) return "image/avif";
		if (lower.endsWith(".heic")) return "image/heic";
		if (lower.endsWith(".heif")) return "image/heif";
		return "image/png";
	}

	private toBase64(bytes: Uint8Array): string {
		let binary = "";
		const chunkSize = 0x8000;
		for (let i = 0; i < bytes.length; i += chunkSize) {
			const chunk = bytes.subarray(i, i + chunkSize);
			binary += String.fromCharCode(...chunk);
		}
		return btoa(binary);
	}

	private isImageFile(file: File): boolean {
		if (file.type.startsWith("image/")) return true;
		return this.isImageName(file.name || "");
	}

	private fileNameFromPath(path: string): string {
		const normalized = path.replace(/\\/g, "/").trim();
		const parts = normalized.split("/");
		return parts[parts.length - 1] || normalized;
	}

	private shouldIgnoreDuplicateDrop(names: string[]): boolean {
		const signature = names
			.map((name) => name.trim().toLowerCase())
			.filter(Boolean)
			.sort()
			.join("|");
		if (!signature) return false;
		const now = Date.now();
		if (this.lastDropSignature === signature && now - this.lastDropAt < 1200) {
			return true;
		}
		this.lastDropSignature = signature;
		this.lastDropAt = now;
		return false;
	}

	private extractFilePathsFromDropPayload(raw: string): string[] {
		const lines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"));
		const paths: string[] = [];
		for (const line of lines) {
			if (line.startsWith("file://")) {
				try {
					const url = new URL(line);
					let path = decodeURIComponent(url.pathname || "");
					if (/^\/[A-Za-z]:\//.test(path)) {
						path = path.slice(1);
					}
					if (path) paths.push(path);
					continue;
				} catch {
					// ignore invalid url
				}
			}
			if (line.startsWith("/") || /^[A-Za-z]:[\\/]/.test(line)) {
				paths.push(line);
			}
		}
		return paths;
	}

	private async prepareImagesFromPaths(paths: string[]): Promise<void> {
		if (paths.length === 0) return;
		try {
			const { readFile } = await import("@tauri-apps/plugin-fs");
			const next: PendingImage[] = [];
			for (const path of paths) {
				const cleanPath = path.trim();
				if (!cleanPath) continue;
				const name = this.fileNameFromPath(cleanPath);
				if (!this.isImageName(name)) continue;
				try {
					const bytes = await readFile(cleanPath);
					const mime = this.mimeFromFileName(name);
					const base64 = this.toBase64(bytes);
					next.push({
						id: uid("img"),
						name,
						mimeType: mime,
						data: base64,
						previewUrl: `data:${mime};base64,${base64}`,
						size: bytes.length,
					});
				} catch {
					// ignore unreadable file
				}
			}
			if (next.length === 0) {
				this.pushNotice("Could not read dropped image files", "info");
				return;
			}
			this.pendingImages = [...this.pendingImages, ...next];
			this.render();
		} catch {
			this.pushNotice("Drag/drop is blocked by file permissions", "error");
		}
	}

	private handleDroppedDataTransfer(dataTransfer: DataTransfer | null): void {
		if (!dataTransfer) return;
		const directFiles = Array.from(dataTransfer.files || []);
		if (directFiles.length > 0) {
			if (this.shouldIgnoreDuplicateDrop(directFiles.map((file) => file.name || ""))) return;
			void this.prepareImages(directFiles);
			return;
		}
		const fromItems = Array.from(dataTransfer.items || [])
			.filter((item) => item.kind === "file")
			.map((item) => item.getAsFile())
			.filter((f): f is File => Boolean(f));
		if (fromItems.length > 0) {
			if (this.shouldIgnoreDuplicateDrop(fromItems.map((file) => file.name || ""))) return;
			void this.prepareImages(fromItems);
			return;
		}
		const uriPayload = dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain") || "";
		const paths = this.extractFilePathsFromDropPayload(uriPayload);
		if (paths.length > 0) {
			if (this.shouldIgnoreDuplicateDrop(paths.map((path) => this.fileNameFromPath(path)))) return;
			void this.prepareImagesFromPaths(paths);
			return;
		}
		this.pushNotice("No readable files found in drop payload", "info");
	}

	private async prepareImages(files: FileList | File[]): Promise<void> {
		const list = Array.from(files).filter((f) => this.isImageFile(f));
		if (list.length === 0) {
			this.pushNotice("Drop an image file (png, jpg, webp, gif…)", "info");
			return;
		}

		const next: PendingImage[] = [];
		let failed = 0;

		for (const file of list) {
			const safeName = file.name || `image-${Date.now()}.png`;
			const mime = file.type || this.mimeFromFileName(safeName);
			let base64 = "";

			try {
				base64 = await this.fileToBase64(file);
			} catch {
				try {
					const dataUrl = await this.fileToDataUrl(file);
					const [head, fromDataUrl = ""] = dataUrl.split(",");
					base64 = fromDataUrl;
					if (!file.type) {
						const parsedMime = head.match(/data:(.*);base64/)?.[1];
						if (parsedMime) {
							next.push({
								id: uid("img"),
								name: safeName,
								mimeType: parsedMime,
								data: base64,
								previewUrl: `data:${parsedMime};base64,${base64}`,
								size: file.size,
							});
							continue;
						}
					}
				} catch {
					failed += 1;
					continue;
				}
			}

			if (!base64) {
				failed += 1;
				continue;
			}

			next.push({
				id: uid("img"),
				name: safeName,
				mimeType: mime,
				data: base64,
				previewUrl: `data:${mime};base64,${base64}`,
				size: file.size,
			});
		}

		if (next.length === 0) {
			this.pushNotice("Could not read dropped image files", "error");
			return;
		}

		this.pendingImages = [...this.pendingImages, ...next];
		this.render();
		if (failed > 0) {
			this.pushNotice(`Attached ${next.length} image${next.length === 1 ? "" : "s"}; ${failed} failed`, "info");
		}
	}

	private async fileToBase64(file: File): Promise<string> {
		const buffer = await file.arrayBuffer();
		return this.toBase64(new Uint8Array(buffer));
	}

	private fileToDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ""));
			reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
			reader.readAsDataURL(file);
		});
	}

	private removePendingImage(id: string): void {
		this.pendingImages = this.pendingImages.filter((img) => img.id !== id);
		this.render();
	}

	private currentIsStreaming(): boolean {
		return Boolean(this.state?.isStreaming) || this.messages.some((m) => m.isStreaming);
	}

	private isComposerInteractionLocked(): boolean {
		if (!this.projectPath) return true;
		if (!this.isConnected) return true;
		return Boolean(this.bindingStatusText);
	}

	private toRpcImages(images: PendingImage[]): RpcImageInput[] {
		return images.map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType }));
	}

	private cloneImages(images?: PendingImage[]): PendingImage[] {
		if (!images || images.length === 0) return [];
		return images.map((img) => ({ ...img, id: uid("img") }));
	}

	private hasRenderableAssistantContent(msg: UiMessage): boolean {
		if (msg.role !== "assistant") return false;
		if (msg.toolCalls.length > 0) return true;
		if (msg.text.trim().length > 0) return true;
		if ((msg.thinking ?? "").trim().length > 0) return true;
		return (msg.errorText ?? "").trim().length > 0;
	}

	private ensureStreamingAssistantMessage(seed?: { text?: string; errorText?: string }): UiMessage {
		const last = this.messages[this.messages.length - 1];
		if (last?.role === "assistant" && last.isStreaming) {
			if (seed?.text && seed.text.trim().length > 0 && last.text.trim().length === 0) {
				last.text = seed.text;
			}
			if (seed?.errorText && !last.errorText) {
				last.errorText = seed.errorText;
			}
			return last;
		}
		const next: UiMessage = {
			id: uid("assistant"),
			role: "assistant",
			text: seed?.text ?? "",
			errorText: seed?.errorText,
			toolCalls: [],
			isStreaming: true,
			isThinkingStreaming: false,
			thinkingExpanded: this.allThinkingExpanded,
		};
		this.messages.push(next);
		return next;
	}

	private messagePreview(msg: UiMessage): string {
		const text = msg.text?.trim();
		if (text) return text;
		if (msg.role === "assistant" && msg.toolCalls.length > 0) {
			return `tool calls: ${msg.toolCalls.map((tc) => tc.name).join(", ")}`;
		}
		if (msg.attachments && msg.attachments.length > 0) {
			return `${msg.attachments.length} image attachment${msg.attachments.length === 1 ? "" : "s"}`;
		}
		return "(empty message)";
	}

	private pushUserEcho(text: string, mode: DeliveryMode, images: PendingImage[]): void {
		this.messages.push({
			id: uid("user"),
			role: "user",
			text,
			toolCalls: [],
			attachments: images,
			deliveryMode: mode,
		});
		this.autoFollowChat = true;
		this.runHasAssistantText = false;
		this.runSawToolActivity = false;
		this.keepWorkflowExpandedUntilAssistantText = false;
		this.collapsedAutoWorkflowIds.clear();
		this.render();
		this.scrollToBottom(true);
	}

	private promoteQueuedMessageFromUserEvent(message: Record<string, unknown>): boolean {
		if (this.queuedComposerMessages.length === 0) return false;
		const normalize = (value: string): string => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
		const eventTextRaw = this.extractText(message.content ?? "");
		const eventText = normalize(eventTextRaw);
		let matchIndex = -1;
		if (eventText.length > 0) {
			matchIndex = this.queuedComposerMessages.findIndex((entry) => normalize(entry.text) === eventText);
		} else {
			matchIndex = this.queuedComposerMessages.findIndex((entry) => normalize(entry.text).length === 0);
			if (matchIndex < 0 && this.queuedComposerMessages.length === 1) {
				matchIndex = 0;
			}
		}
		if (matchIndex < 0) return false;
		const [queued] = this.queuedComposerMessages.splice(matchIndex, 1);
		if (!queued) return false;
		const last = this.messages[this.messages.length - 1];
		if (
			last?.role === "user" &&
			last.deliveryMode === "followUp" &&
			normalize(last.text) === normalize(queued.text) &&
			(last.attachments?.length ?? 0) === queued.attachments.length
		) {
			return true;
		}
		this.pushUserEcho(queued.text, "followUp", this.cloneImages(queued.attachments));
		return true;
	}

	private enqueueComposerQueueMessage(text: string, attachments: PendingImage[]): string {
		const clonedAttachments = this.cloneImages(attachments);
		const entry: QueuedComposerMessage = {
			id: uid("queued"),
			text,
			attachments: clonedAttachments,
			imageCount: clonedAttachments.length,
			createdAt: Date.now(),
		};
		this.queuedComposerMessages = [...this.queuedComposerMessages, entry].slice(-6);
		return entry.id;
	}

	private removeComposerQueueMessage(id: string): void {
		const next = this.queuedComposerMessages.filter((entry) => entry.id !== id);
		if (next.length === this.queuedComposerMessages.length) return;
		this.queuedComposerMessages = next;
	}

	private clearComposerQueueMessages(): void {
		if (this.queuedComposerMessages.length === 0) return;
		this.queuedComposerMessages = [];
	}

	private syncComposerQueueFromState(state: RpcSessionState | null | undefined): void {
		const pendingCount = Math.max(0, state?.pendingMessageCount ?? 0);
		if (pendingCount > 0 && this.queuedComposerMessages.length > pendingCount) {
			this.queuedComposerMessages = this.queuedComposerMessages.slice(this.queuedComposerMessages.length - pendingCount);
		}
	}

	private resetComposerHistoryNavigation(): void {
		this.composerHistoryIndex = -1;
		this.composerHistoryDraft = "";
	}

	private rememberComposerHistoryEntry(rawText: string): void {
		const text = rawText.trim();
		if (!text) return;
		const last = this.composerInputHistory[this.composerInputHistory.length - 1] ?? "";
		if (last !== text) {
			this.composerInputHistory.push(text);
			if (this.composerInputHistory.length > 120) {
				this.composerInputHistory.splice(0, this.composerInputHistory.length - 120);
			}
		}
		this.resetComposerHistoryNavigation();
	}

	private shouldHandleComposerHistoryKey(event: KeyboardEvent, textarea: HTMLTextAreaElement, direction: "up" | "down"): boolean {
		if (event.altKey || event.ctrlKey || event.metaKey) return false;
		if (textarea.selectionStart !== textarea.selectionEnd) return false;
		const caret = textarea.selectionStart;
		if (direction === "up") {
			return textarea.value.slice(0, caret).indexOf("\n") === -1;
		}
		if (this.composerHistoryIndex < 0) return false;
		return textarea.value.indexOf("\n", caret) === -1;
	}

	private applyComposerText(text: string): void {
		this.inputText = text;
		this.updateSlashPaletteStateFromInput();
		this.render();
		requestAnimationFrame(() => {
			const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
			if (!textarea) return;
			textarea.value = text;
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
			const end = text.length;
			textarea.setSelectionRange(end, end);
			textarea.focus();
		});
	}

	private navigateComposerHistory(direction: "up" | "down"): void {
		if (this.composerInputHistory.length === 0) return;
		if (direction === "up") {
			if (this.composerHistoryIndex < 0) {
				this.composerHistoryDraft = this.inputText;
				this.composerHistoryIndex = this.composerInputHistory.length - 1;
			} else if (this.composerHistoryIndex > 0) {
				this.composerHistoryIndex -= 1;
			}
			const entry = this.composerInputHistory[this.composerHistoryIndex] ?? "";
			this.applyComposerText(entry);
			return;
		}
		if (this.composerHistoryIndex < 0) return;
		if (this.composerHistoryIndex < this.composerInputHistory.length - 1) {
			this.composerHistoryIndex += 1;
			const entry = this.composerInputHistory[this.composerHistoryIndex] ?? "";
			this.applyComposerText(entry);
			return;
		}
		const draft = this.composerHistoryDraft;
		this.resetComposerHistoryNavigation();
		this.applyComposerText(draft);
	}

	private clearComposer(): void {
		this.inputText = "";
		this.pendingImages = [];
		this.selectedSkillDraft = null;
		this.resetComposerHistoryNavigation();
		this.closeSlashPalette();
		this.render();
		const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
		if (textarea) {
			textarea.value = "";
			textarea.style.height = "auto";
		}
	}

	async sendMessage(mode: DeliveryMode = this.pendingDeliveryMode): Promise<void> {
		if (this.isComposerInteractionLocked()) {
			this.pushNotice(this.bindingStatusText || "Session is still loading. Try again in a moment.", "info");
			return;
		}
		const promptText = this.inputText.trim();
		const selectedSkillCommand = this.selectedSkillDraft?.commandText?.trim() ?? "";
		const text = selectedSkillCommand
			? (promptText ? `${selectedSkillCommand}\n\n${promptText}` : selectedSkillCommand)
			: promptText;
		const images = [...this.pendingImages];
		if (!selectedSkillCommand && images.length === 0 && this.slashQueryFromInput() !== null) {
			await this.executeSlashCommandFromComposer();
			return;
		}
		if (!text && images.length === 0) return;
		if (text) this.rememberComposerHistoryEntry(text);

		let streaming = this.currentIsStreaming();
		if (streaming) {
			try {
				const backendState = await rpcBridge.getState();
				const backendStreaming = Boolean(backendState.isStreaming);
				this.state = backendState;
				this.syncComposerQueueFromState(backendState);
				this.onStateChange?.(backendState);
				if (!backendStreaming) {
					streaming = false;
					this.clearStreamingUiState();
					this.render();
				}
			} catch {
				// ignore pre-flight run-state check failures
			}
		}

		let actualMode: DeliveryMode = mode;
		if (!streaming) {
			actualMode = "prompt";
		}

		let queuedMessageId: string | null = null;
		if (actualMode === "followUp") {
			queuedMessageId = this.enqueueComposerQueueMessage(text, images);
			this.pushNotice("Queued message", "info");
		} else {
			this.pushUserEcho(text, actualMode, images);
		}
		this.clearComposer();
		this.sendingPrompt = true;
		this.render();

		try {
			const rpcImages = this.toRpcImages(images);
			if (actualMode === "prompt") {
				await rpcBridge.prompt(text, { images: rpcImages });
			} else if (actualMode === "steer") {
				await rpcBridge.steer(text, rpcImages);
			} else {
				await rpcBridge.followUp(text, rpcImages);
				void rpcBridge
					.getState()
					.then((state) => {
						this.state = state;
						this.syncComposerQueueFromState(state);
						this.onStateChange?.(state);
						this.render();
					})
					.catch(() => {
						/* ignore */
					});
			}
			this.onPromptSubmitted?.();
		} catch (err) {
			if (queuedMessageId) {
				this.removeComposerQueueMessage(queuedMessageId);
			}
			console.error("Failed to send message:", err);
			this.pushNotice(err instanceof Error ? err.message : "Failed to send message", "error");
		} finally {
			this.sendingPrompt = false;
			this.render();
		}
	}

	private async copyMessage(msg: UiMessage): Promise<void> {
		const text = this.messagePreview(msg);
		if (!text || text === "(empty message)") {
			this.pushNotice("Nothing to copy for this message", "info");
			return;
		}
		try {
			await navigator.clipboard.writeText(text);
			this.pushNotice("Copied message", "success");
		} catch (err) {
			console.error("Failed to copy message:", err);
			this.pushNotice("Failed to copy message", "error");
		}
	}

	private editUserMessage(msg: UiMessage): void {
		this.pendingImages = this.cloneImages(msg.attachments);
		this.setInputText(msg.text || "");
		this.pushNotice("Loaded message into composer", "info");
	}

	private resendUserMessage(msg: UiMessage): void {
		const text = msg.text || "";
		const images = this.cloneImages(msg.attachments);
		if (!text.trim() && images.length === 0) {
			this.pushNotice("Cannot resend an empty message", "info");
			return;
		}

		this.pendingImages = images;
		this.setInputText(text);
		this.pushNotice("Message loaded. Press send to resend", "info");
	}

	async copyLastMessage(): Promise<boolean> {
		try {
			const text = await rpcBridge.getLastAssistantText();
			if (!text) {
				this.pushNotice("No assistant message to copy", "info");
				return false;
			}
			await navigator.clipboard.writeText(text);
			this.pushNotice("Copied last assistant message", "success");
			return true;
		} catch (err) {
			console.error("Failed to copy:", err);
			this.pushNotice("Failed to copy message", "error");
			return false;
		}
	}

	async exportToHtml(): Promise<void> {
		try {
			const { path } = await rpcBridge.exportHtml();
			this.pushNotice(`Exported session to ${truncate(path, 70)}`, "success");
			const { open } = await import("@tauri-apps/plugin-shell");
			await open(path);
		} catch (err) {
			console.error("Failed to export HTML:", err);
			this.pushNotice("Failed to export session", "error");
		}
	}

	private async createGitRepository(): Promise<void> {
		if (this.creatingGitRepo) return;
		this.creatingGitRepo = true;
		this.render();
		try {
			const init = await this.runGit(["init"]);
			if (init.exitCode !== 0) {
				this.pushNotice(init.stderr.trim() || init.stdout.trim() || "Failed to create git repository", "error");
				return;
			}

			const setMain = await this.runGit(["symbolic-ref", "HEAD", "refs/heads/main"]);
			if (setMain.exitCode !== 0) {
				await this.runGit(["branch", "-M", "main"]);
			}

			this.pushNotice("Git repository ready", "success");
			await this.refreshGitSummary(true);
		} catch (err) {
			console.error("Failed to create git repository:", err);
			this.pushNotice("Failed to create git repository", "error");
		} finally {
			this.creatingGitRepo = false;
			this.render();
		}
	}

	async shareAsGist(): Promise<boolean> {
		try {
			const { tempDir } = await import("@tauri-apps/api/path");
			const tempRoot = (await tempDir()).replace(/\\/g, "/").replace(/\/+$/, "");
			const exportPath = `${tempRoot}/session.html`;
			const { path } = await rpcBridge.exportHtml(exportPath);
			const shared = await rpcBridge.createShareGist(path);
			this.appendSystemMessage(`[Open shared session](${shared.preview_url}) · [Open gist](${shared.gist_url})`, {
				label: "share",
				markdown: true,
			});
			this.pushNotice("Session shared as secret gist", "success");
			return true;
		} catch (err) {
			console.error("Failed to share as gist:", err);
			const message = err instanceof Error ? err.message : String(err);
			this.pushNotice(truncate(message || "Failed to share session", 180), "error");
			return false;
		}
	}

	private clearStreamingUiState(): void {
		this.cancelStreamingUiReconcile();
		this.clearWorkingStatusTimer(true);
		if (this.state) {
			this.state = { ...this.state, isStreaming: false };
			this.onStateChange?.(this.state);
		}
		for (const message of this.messages) {
			if (message.role !== "assistant") continue;
			message.isStreaming = false;
			message.isThinkingStreaming = false;
			for (const toolCall of message.toolCalls) {
				toolCall.isRunning = false;
				toolCall.streamingOutput = undefined;
			}
		}
		this.retryStatus = "";
		if (this.compactionCycle?.status === "running") {
			this.compactionCycle.status = "aborted";
			this.compactionCycle.summary = "Compaction interrupted";
			this.compactionCycle.endedAt = Date.now();
			this.compactionCycle.details.push("Compaction was interrupted before completion.");
		}
		this.pendingDeliveryMode = "prompt";
		this.runHasAssistantText = false;
		this.runSawToolActivity = false;
		this.keepWorkflowExpandedUntilAssistantText = false;
		this.collapsedAutoWorkflowIds.clear();
		this.onRunStateChange?.(false);
	}

	private async reconcileStreamingUiState(): Promise<void> {
		try {
			const state = await rpcBridge.getState();
			this.state = state;
			this.syncComposerQueueFromState(state);
			this.pendingDeliveryMode = state.isStreaming ? "steer" : "prompt";
			this.onStateChange?.(state);
			this.onRunStateChange?.(Boolean(state.isStreaming));
			if (!state.isStreaming) {
				this.clearStreamingUiState();
			} else {
				this.scheduleStreamingUiReconcile(2200);
			}
		} catch {
			this.clearStreamingUiState();
		} finally {
			this.render();
		}
	}

	async abortCurrentRun(): Promise<void> {
		const hadRetry = Boolean(this.retryStatus);
		this.clearStreamingUiState();
		this.render();
		try {
			if (hadRetry) await rpcBridge.abortRetry();
			await rpcBridge.abort();
			this.pushNotice("Aborted current run", "info");
		} catch (err) {
			console.error("Failed to abort:", err);
			this.pushNotice("Failed to abort current run", "error");
		} finally {
			setTimeout(() => {
				void this.reconcileStreamingUiState();
			}, 120);
		}
	}

	async newSession(): Promise<boolean> {
		try {
			await rpcBridge.newSession();
			this.messages = [];
			await this.refreshFromBackend();
			this.pushNotice("Started new session", "success");
			return true;
		} catch (err) {
			console.error("Failed to create session:", err);
			this.pushNotice("Failed to create session", "error");
			return false;
		}
	}

	async compactNow(customInstructions?: string): Promise<boolean> {
		if (this.compactionCycle?.status === "running") {
			this.pushNotice("Compaction already in progress", "info");
			return false;
		}
		const normalizedInstructions = customInstructions?.trim() || undefined;
		this.compactionInsertIndex = this.messages.length;
		this.compactionCycle = {
			id: uid("compaction"),
			status: "running",
			startedAt: Date.now(),
			endedAt: null,
			summary: "Compacting context…",
			errorMessage: null,
			details: normalizedInstructions ? [`Custom instructions: ${truncate(normalizedInstructions, 180)}`] : ["Manual compaction started"],
			expanded: false,
		};
		this.render();
		this.scrollToBottom();
		try {
			const result = await rpcBridge.compact(normalizedInstructions);
			const summary = pickString(result as Record<string, unknown>, ["summary"]) || "Compaction complete";
			const tokensBefore = pickNumber(result as Record<string, unknown>, ["tokensBefore", "tokens_before"]);
			const firstKeptEntry = pickString(result as Record<string, unknown>, ["firstKeptEntryId", "first_kept_entry_id"]);
			if (this.compactionCycle) {
				this.compactionCycle.status = "done";
				this.compactionCycle.endedAt = Date.now();
				this.compactionCycle.summary = summary;
				if (typeof tokensBefore === "number" && Number.isFinite(tokensBefore)) {
					this.compactionCycle.details.push(`Context before compaction: ${Math.round(tokensBefore).toLocaleString()} tokens`);
				}
				if (firstKeptEntry) {
					this.compactionCycle.details.push(`First kept entry: ${truncate(firstKeptEntry, 48)}`);
				}
				this.compactionCycle.details.push("Compaction completed successfully.");
			}
			this.markContextUsageUnknown();
			this.render();
			await this.refreshFromBackend();
			await this.refreshSessionStats(true);
			if (this.compactionCycle && typeof this.sessionStats.tokens === "number" && Number.isFinite(this.sessionStats.tokens)) {
				this.compactionCycle.details.push(`Context after compaction: ${Math.round(this.sessionStats.tokens).toLocaleString()} tokens`);
			}
			this.pushNotice("Compaction complete", "success");
			this.render();
			return true;
		} catch (err) {
			console.error("Failed to compact:", err);
			if (this.compactionCycle) {
				this.compactionCycle.status = "error";
				this.compactionCycle.endedAt = Date.now();
				this.compactionCycle.summary = "Compaction failed";
				this.compactionCycle.errorMessage = err instanceof Error ? truncate(err.message, 220) : "Unknown compaction error";
			}
			this.pushNotice("Compaction failed", "error");
			this.render();
			return false;
		}
	}

	private async renameSessionTo(nextNameRaw: string): Promise<boolean> {
		const nextName = nextNameRaw.trim();
		if (!nextName) return false;
		try {
			if (this.onRenameCurrentSession) {
				const handled = await this.onRenameCurrentSession(nextName);
				if (handled) {
					this.pushNotice("Session renamed", "success");
					return true;
				}
			}
			await rpcBridge.setSessionName(nextName);
			await this.refreshFromBackend();
			this.pushNotice("Session renamed", "success");
			return true;
		} catch (err) {
			this.pushNotice("Failed to rename session", "error");
			return false;
		}
	}

	async renameSession(): Promise<void> {
		const current = this.state?.sessionName || "";
		const next = window.prompt("Session name", current);
		if (!next || !next.trim()) return;
		await this.renameSessionTo(next.trim());
	}

	async openForkPicker(): Promise<void> {
		if (this.openingForkPicker) return;
		this.openingForkPicker = true;
		this.forkPickerOpen = true;
		this.render();
		try {
			this.forkOptions = await rpcBridge.getForkMessages();
		} catch (err) {
			console.error("Failed to load fork points:", err);
			this.pushNotice("Failed to load fork points", "error");
			this.forkOptions = [];
		} finally {
			this.openingForkPicker = false;
			this.render();
		}
	}

	private closeForkPicker(): void {
		this.forkPickerOpen = false;
		this.render();
	}

	private deriveForkSessionName(sourceName: string): string {
		const base = sourceName.trim() || "session";
		return `fork-${base}`;
	}

	private async forkFrom(entryId: string): Promise<void> {
		const sourceSessionName = this.historyViewerSessionLabel.trim() || this.state?.sessionName?.trim() || "";
		const forkSessionName = this.deriveForkSessionName(sourceSessionName);
		try {
			const result = await rpcBridge.fork(entryId);
			if (!result.cancelled) {
				try {
					await rpcBridge.setSessionName(forkSessionName);
				} catch (renameErr) {
					console.warn("Failed to rename fork session:", renameErr);
				}
			}
			if (!result.cancelled && result.text) {
				this.setInputText(result.text);
			}
			await this.refreshFromBackend();
			this.pushNotice(result.cancelled ? "Fork cancelled" : "Fork ready in editor", "success");
			this.closeForkPicker();
			if (this.historyViewerMode === "fork") {
				this.closeHistoryViewer();
			}
		} catch (err) {
			console.error("Failed to fork:", err);
			this.pushNotice("Failed to fork session", "error");
		}
	}

	openHistoryViewer(options?: { query?: string }): void {
		this.historyViewerOpen = true;
		this.historyViewerMode = "browse";
		this.historyViewerLoading = true;
		this.historyViewerSessionLabel = "";
		this.historyTreeRows = [];
		this.historyQuery = options?.query?.trim() ?? "";
		this.historyRoleFilter = "all";
		this.forkExpandedMessageRows.clear();
		this.forkExpandedToolRows.clear();
		this.render();
		void this.loadSessionTreeForHistory();
	}

	openHistoryViewerForFork(options?: { loading?: boolean; sessionName?: string | null; query?: string }): void {
		this.historyViewerOpen = true;
		this.historyViewerMode = "fork";
		this.historyViewerLoading = options?.loading ?? false;
		this.historyViewerSessionLabel = options?.sessionName?.trim() || this.state?.sessionName?.trim() || "";
		this.historyQuery = options?.query?.trim() ?? "";
		this.historyRoleFilter = "all";
		this.forkOptions = [];
		this.forkExpandedMessageRows.clear();
		this.forkExpandedToolRows.clear();
		this.render();
		if (!this.historyViewerLoading) {
			void this.loadForkTargetsForHistory();
		}
	}

	private closeHistoryViewer(): void {
		this.historyViewerOpen = false;
		this.historyViewerMode = "browse";
		this.historyViewerLoading = false;
		this.historyViewerSessionLabel = "";
		this.historyTreeRows = [];
		this.historyTreeRequestSeq += 1;
		this.historyQuery = "";
		this.historyRoleFilter = "all";
		this.forkOptions = [];
		this.forkEntryIdByMessageId.clear();
		this.forkExpandedMessageRows.clear();
		this.forkExpandedToolRows.clear();
		this.render();
	}

	private normalizeForkText(value: string): string {
		return value.replace(/\s+/g, " ").trim();
	}

	private hydrateForkTargetsFromOptions(options: ForkOption[]): void {
		const userMessages = this.messages.filter((msg) => msg.role === "user");
		const byText = new Map<string, string[]>();
		for (const option of options) {
			const key = this.normalizeForkText(option.text);
			if (!key) continue;
			const queue = byText.get(key) ?? [];
			queue.push(option.entryId);
			byText.set(key, queue);
		}

		const map = new Map<string, string>();
		for (const msg of userMessages) {
			const key = this.normalizeForkText(msg.text);
			const queue = byText.get(key);
			if (queue && queue.length > 0) {
				const entryId = queue.shift();
				if (entryId) map.set(msg.id, entryId);
				continue;
			}
			if (msg.sessionEntryId) {
				map.set(msg.id, msg.sessionEntryId);
			}
		}

		this.forkEntryIdByMessageId = map;
	}

	private async loadForkTargetsForHistory(): Promise<void> {
		if (this.historyViewerMode !== "fork") return;
		const requestId = ++this.forkTargetsRequestSeq;
		this.historyViewerLoading = true;
		this.render();
		try {
			const options = await rpcBridge.getForkMessages();
			if (requestId !== this.forkTargetsRequestSeq || this.historyViewerMode !== "fork") return;
			this.forkOptions = options;
			this.hydrateForkTargetsFromOptions(options);
		} catch (err) {
			if (requestId !== this.forkTargetsRequestSeq || this.historyViewerMode !== "fork") return;
			console.error("Failed to load fork points:", err);
			this.pushNotice("Failed to load fork points", "error");
			this.forkOptions = [];
			this.forkEntryIdByMessageId.clear();
		} finally {
			if (requestId !== this.forkTargetsRequestSeq || this.historyViewerMode !== "fork") return;
			this.historyViewerLoading = false;
			this.render();
		}
	}

	private revealMessage(messageId: string): void {
		const escaped = (window as any).CSS?.escape ? (window as any).CSS.escape(messageId) : messageId;
		const target = this.container.querySelector(`[data-message-id="${escaped}"]`) as HTMLElement | null;
		if (!target) return;
		target.scrollIntoView({ behavior: "smooth", block: "center" });
		this.closeHistoryViewer();
	}

	private thinkingContentElement(messageId: string): HTMLElement | null {
		const escaped = (window as any).CSS?.escape ? (window as any).CSS.escape(messageId) : messageId;
		return this.container.querySelector(`[data-thinking-for="${escaped}"]`) as HTMLElement | null;
	}

	toggleThinkingBlocks(): void {
		this.allThinkingExpanded = !this.allThinkingExpanded;
		for (const message of this.messages) {
			if (message.role === "assistant" && message.thinking) {
				message.thinkingExpanded = this.allThinkingExpanded;
			}
		}
		this.render();
	}

	private isNearChatBottom(target: HTMLElement, threshold = 84): boolean {
		return target.scrollHeight - target.scrollTop - target.clientHeight <= threshold;
	}

	private handleChatScroll(event: Event): void {
		const target = event.currentTarget as HTMLElement | null;
		if (!target) return;
		const nextFollow = this.isNearChatBottom(target);
		if (this.autoFollowChat === nextFollow) return;
		this.autoFollowChat = nextFollow;
		this.render();
	}

	private jumpToLatest(): void {
		this.autoFollowChat = true;
		this.scrollToBottom(true);
		this.render();
	}

	private renderJumpToLatest(): TemplateResult | typeof nothing {
		if (this.autoFollowChat) return nothing;
		return html`
			<button class="chat-jump-latest" aria-label="Jump to latest" title="Jump to latest" @click=${() => this.jumpToLatest()}>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2v7.9"></path><path d="M5.2 8.3L8 11.1l2.8-2.8"></path></svg>
			</button>
		`;
	}

	private scrollToBottom(force = false): void {
		const shouldFollow = force || this.autoFollowChat;
		if (!shouldFollow) return;
		requestAnimationFrame(() => {
			if (!this.scrollContainer) return;
			this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
		});
	}

	private updateComposerOffset(): void {
		const chatRoot = this.container.querySelector<HTMLElement>(".chat-root");
		if (!chatRoot) return;
		const composer = this.container.querySelector<HTMLElement>(".composer-shell");
		if (!this.projectPath || !composer) {
			chatRoot.style.setProperty("--composer-offset", "196px");
			this.composerOffsetPx = 196;
			this.composerResizeObserver?.disconnect();
			this.composerResizeObserver = null;
			this.observedComposerElement = null;
			return;
		}

		const apply = () => {
			const measured = Math.max(140, Math.ceil(composer.getBoundingClientRect().height) + 18);
			if (Math.abs(measured - this.composerOffsetPx) < 2) return;
			this.composerOffsetPx = measured;
			chatRoot.style.setProperty("--composer-offset", `${measured}px`);
			if (this.autoFollowChat) this.scrollToBottom();
		};

		apply();
		if (!this.composerResizeObserver) {
			this.composerResizeObserver = new ResizeObserver(() => apply());
		}
		if (this.observedComposerElement !== composer) {
			this.composerResizeObserver.disconnect();
			this.composerResizeObserver.observe(composer);
			this.observedComposerElement = composer;
		}
	}

	private renderNotices(): TemplateResult | typeof nothing {
		if (this.notices.length === 0) return nothing;
		return html`
			<div class="absolute top-4 right-4 z-30 flex flex-col gap-2 max-w-sm pointer-events-none">
				${this.notices.map((notice) => {
					const cls =
						notice.kind === "error"
							? "bg-red-500/95"
							: notice.kind === "success"
								? "bg-emerald-500/95"
								: "bg-zinc-800/95";
					return html`<div class="rounded-xl px-3 py-2 text-xs text-white shadow-xl backdrop-blur ${cls}">${notice.text}</div>`;
				})}
			</div>
		`;
	}

	private currentWorkingPhrase(): string {
		const candidate = this.workingStatusPhrases[this.workingStatusPhraseIndex] ?? "working";
		const normalized = candidate.trim();
		return normalized.length > 0 ? normalized : "working";
	}

	private currentWorkingLabel(): string {
		const phrase = this.currentWorkingPhrase();
		const count = Math.max(1, Math.min(this.workingStatusCharCount, phrase.length));
		return phrase.slice(0, count);
	}

	private clearWorkingStatusTimer(reset = false): void {
		if (this.workingStatusTimer) {
			clearTimeout(this.workingStatusTimer);
		}
		this.workingStatusTimer = null;
		if (!reset) return;
		this.workingStatusPhraseIndex = 0;
		this.workingStatusPhase = "typing";
		this.workingStatusCharCount = 0;
	}

	private scheduleWorkingStatusTick(delayMs: number): void {
		this.clearWorkingStatusTimer(false);
		this.workingStatusTimer = setTimeout(() => {
			this.workingStatusTimer = null;
			this.stepWorkingStatusText();
		}, delayMs);
	}

	private stepWorkingStatusText(): void {
		if (!this.shouldShowWorkingIndicator()) {
			this.clearWorkingStatusTimer(true);
			return;
		}

		const phrase = this.currentWorkingPhrase();
		let nextDelay = 320;
		if (this.workingStatusPhase === "typing") {
			this.workingStatusCharCount = Math.min(phrase.length, this.workingStatusCharCount + 1);
			if (this.workingStatusCharCount >= phrase.length) {
				this.workingStatusPhase = "hold";
				nextDelay = 4600;
			} else {
				nextDelay = 130 + Math.floor(Math.random() * 80);
			}
			this.render();
		} else {
			this.workingStatusPhase = "typing";
			this.workingStatusPhraseIndex = (this.workingStatusPhraseIndex + 1) % this.workingStatusPhrases.length;
			this.workingStatusCharCount = 0;
			nextDelay = 920;
			this.render();
		}

		this.scheduleWorkingStatusTick(nextDelay);
	}

	private syncWorkingStatusAnimation(): void {
		if (this.shouldShowWorkingIndicator()) {
			if (!this.workingStatusTimer) {
				this.scheduleWorkingStatusTick(320);
			}
			return;
		}
		this.clearWorkingStatusTimer(true);
	}

	private renderWorkingChip(): TemplateResult {
		return html`
			<div class="chat-working-indicator" aria-label="Pi is working" title="Pi is working">
				<span class="chat-working-pi" aria-hidden="true">${piGlyphIcon()}</span>
				<span class="chat-working-text">
					<span class="chat-working-label">${this.currentWorkingLabel()}</span>
					<span class="chat-working-dots">...</span>
				</span>
			</div>
		`;
	}

	private hasExpandedWorkflowInTimeline(): boolean {
		for (let index = 0; index < this.messages.length; index += 1) {
			const msg = this.messages[index];
			if (msg.role !== "assistant") continue;
			const workflowCandidate = this.collectAssistantWorkflow(index);
			if (!workflowCandidate) continue;
			const { expanded } = this.resolveWorkflowExpansionState(
				workflowCandidate.workflow.id,
				workflowCandidate.workflow.toolCalls,
				workflowCandidate.workflow.isTerminal,
			);
			if (expanded) return true;
			index = workflowCandidate.nextIndex - 1;
		}
		return false;
	}

	private shouldShowWorkingIndicator(): boolean {
		if (!this.currentIsStreaming()) return false;
		if (this.hasExpandedWorkflowInTimeline()) return false;
		return !this.runHasAssistantText;
	}

	private renderWorkingIndicatorRow(): TemplateResult {
		return html`
			<div class="chat-row assistant-row working-row">
				<div class="message-shell assistant-message-shell">
					<div class="assistant-block">${this.renderWorkingChip()}</div>
				</div>
			</div>
		`;
	}

	private renderUserMessage(msg: UiMessage): TemplateResult {
		return html`
			<div class="chat-row user-row" data-message-id=${msg.id}>
				<div class="message-shell user-message-shell">
					<div class="bubble user-bubble">
						${msg.deliveryMode === "steer" ? html`<div class="bubble-chip">steer</div>` : nothing}
						${msg.text ? html`<div class="bubble-text">${msg.text}</div>` : nothing}
						${msg.attachments && msg.attachments.length > 0
							? html`
								<div class="attachment-grid">
									${msg.attachments.map(
										(img) => html`
											<div class="attachment-item" title=${img.name}>
												<img src=${img.previewUrl} alt=${img.name} />
											</div>
										`,
									)}
								</div>
							`
							: nothing}
					</div>
					<div class="message-actions">
						<button class="message-action-btn icon" title="Resend message" @click=${() => this.resendUserMessage(msg)}>${uiIcon("retry")}</button>
						<button class="message-action-btn icon" title="Copy message" @click=${() => this.copyMessage(msg)}>${uiIcon("copy")}</button>
					</div>
				</div>
			</div>
		`;
	}

	private normalizeThinkingText(value: string): string {
		let text = value.replace(/^\s*thinking\.\.\.\s*/i, "").trim();
		if (!text) return "";
		const paragraphs = text
		.split(/\n{2,}/)
			.map((part) => part.trim())
			.filter(Boolean);
		const deduped: string[] = [];
		const seen = new Set<string>();
		for (const part of paragraphs) {
			if (seen.has(part)) continue;
			seen.add(part);
			deduped.push(part);
		}
		text = deduped.join("\n\n").trim();
		const half = Math.floor(text.length / 2);
		if (text.length > 40 && text.length % 2 === 0 && text.slice(0, half) === text.slice(half)) {
			text = text.slice(0, half).trim();
		}
		return text;
	}

	private isStandaloneCodeBlockMarkdown(value: string): boolean {
		const text = value.trim();
		if (!text) return false;
		if (/^```[^\n`]*\n[\s\S]*\n```$/.test(text)) return true;
		if (/^~~~[^\n~]*\n[\s\S]*\n~~~$/.test(text)) return true;
		return false;
	}

	private renderThinking(msg: UiMessage): TemplateResult | typeof nothing {
		if (!msg.thinking) return nothing;
		const expanded = msg.thinkingExpanded ?? false;
		const label = "Thinking…";
		const toggleClass = `thinking-toggle ${msg.isStreaming ? "animating" : "done"}`;
		const thinkingText = this.normalizeThinkingText(msg.thinking.replace(/^\s+/, ""));
		if (!thinkingText) return nothing;
		return html`
			<div class="thinking-block ${expanded ? "expanded" : ""}">
				<button
					type="button"
					class=${toggleClass}
					aria-expanded=${expanded ? "true" : "false"}
					aria-label="Toggle thinking"
					title="Toggle thinking"
					@click=${() => {
						if (expanded) {
							const content = this.thinkingContentElement(msg.id);
							if (content) msg.thinkingScrollTop = content.scrollTop;
						}
						this.autoFollowChat = false;
						msg.thinkingExpanded = !expanded;
						this.render();
						if (!expanded) {
							requestAnimationFrame(() => {
								const content = this.thinkingContentElement(msg.id);
								if (!content) return;
								content.scrollTop = msg.thinkingScrollTop ?? 0;
							});
						}
					}}
				>
					${label.split("").map((char, index) => html`<span class="thinking-char" style=${`--thinking-char-index:${index};`}>${char}</span>`)}
				</button>
				<div
					class="thinking-content"
					data-thinking-for=${msg.id}
					@scroll=${(event: Event) => {
						msg.thinkingScrollTop = (event.currentTarget as HTMLElement).scrollTop;
					}}
				>${thinkingText}</div>
			</div>
		`;
	}

	private pickToolArg(args: Record<string, unknown>, keys: string[]): string {
		for (const key of keys) {
			const value = args[key];
			if (typeof value === "string" && value.trim().length > 0) return value.trim();
		}
		return "";
	}

	private summarizeToolCall(tc: ToolCallBlock): string {
		const name = tc.name.trim().toLowerCase();
		const command = this.pickToolArg(tc.args, ["command", "cmd", "shell", "script"]);
		const path = this.pickToolArg(tc.args, ["path", "filePath", "targetPath", "from", "to"]);
		const query = this.pickToolArg(tc.args, ["query", "pattern", "glob", "name"]);
		if (name === "bash" && command) return `Ran ${truncate(command, 84)}`;
		if ((name === "read" || name === "readfile") && path) return `Read ${truncate(path, 74)}`;
		if ((name === "write" || name === "writefile") && path) return `Wrote ${truncate(path, 74)}`;
		if (name === "edit" && path) return `Edited ${truncate(path, 74)}`;
		if (name.includes("search") && query) return `Explored ${truncate(query, 74)}`;
		if ((name === "list" || name.includes("ls")) && path) return `Explored ${truncate(path, 74)}`;
		if (path) return `${tc.name} ${truncate(path, 74)}`;
		return `Ran ${tc.name}`;
	}

	private buildToolCallGroups(toolCalls: ToolCallBlock[]): ToolCallGroup[] {
		const groups: ToolCallGroup[] = [];
		for (const tc of toolCalls) {
			const preview = this.summarizeToolCall(tc);
			const previous = groups[groups.length - 1];
			if (previous && previous.toolName === tc.name && previous.preview === preview) {
				previous.calls.push(tc);
				continue;
			}
			groups.push({
				id: `${tc.id}-group`,
				toolName: tc.name,
				preview,
				calls: [tc],
			});
		}
		return groups;
	}

	private isToolWorkflowExpanded(workflowId: string): boolean {
		return this.expandedToolWorkflowIds.has(workflowId);
	}

	private clearWorkflowThinkingExpansion(workflowId: string): void {
		for (const thinkingId of Array.from(this.expandedWorkflowThinkingIds)) {
			if (thinkingId.startsWith(`${workflowId}:thinking:`)) {
				this.expandedWorkflowThinkingIds.delete(thinkingId);
			}
		}
	}

	private toggleToolWorkflowExpanded(workflowId: string, autoExpanded = false, currentlyExpanded = false): void {
		if (currentlyExpanded) {
			this.expandedToolWorkflowIds.delete(workflowId);
			this.expandedToolGroupByWorkflowId.delete(workflowId);
			this.clearWorkflowThinkingExpansion(workflowId);
			if (autoExpanded) {
				this.collapsedAutoWorkflowIds.add(workflowId);
			}
		} else {
			this.expandedToolWorkflowIds.add(workflowId);
			this.collapsedAutoWorkflowIds.delete(workflowId);
		}
		this.render();
	}

	private isWorkflowThinkingExpanded(thinkingId: string): boolean {
		return this.expandedWorkflowThinkingIds.has(thinkingId);
	}

	private toggleWorkflowThinkingExpanded(thinkingId: string): void {
		if (this.expandedWorkflowThinkingIds.has(thinkingId)) {
			this.expandedWorkflowThinkingIds.delete(thinkingId);
		} else {
			this.expandedWorkflowThinkingIds.add(thinkingId);
		}
		this.render();
	}

	private isToolGroupExpanded(workflowId: string, groupId: string): boolean {
		return this.expandedToolGroupByWorkflowId.get(workflowId) === groupId;
	}

	private toggleToolGroupExpanded(workflowId: string, groupId: string): void {
		if (this.expandedToolGroupByWorkflowId.get(workflowId) === groupId) {
			this.expandedToolGroupByWorkflowId.delete(workflowId);
		} else {
			this.expandedToolGroupByWorkflowId.set(workflowId, groupId);
		}
		this.render();
	}

	private renderToolPreview(preview: string): TemplateResult {
		const match = preview.match(/^(Edited|Wrote)\s+(.+)$/);
		if (!match) return html`${preview}`;
		const [, verb, target] = match;
		return html`${verb} <span class="tool-file-target">${target}</span>`;
	}

	private isThinkingOnlyAssistantMessage(message: UiMessage | undefined): boolean {
		if (!message || message.role !== "assistant") return false;
		if (message.toolCalls.length > 0) return false;
		if (message.text.trim().length > 0) return false;
		if ((message.errorText ?? "").trim().length > 0) return false;
		return Boolean((message.thinking ?? "").trim());
	}

	private collectAssistantWorkflow(startIndex: number): {
		workflow: {
			id: string;
			messages: UiMessage[];
			toolCalls: ToolCallBlock[];
			toolGroups: ToolCallGroup[];
			thinkingText: string;
			finalText: string;
			errorText: string;
			isStreaming: boolean;
			startedAt: number;
			endedAt: number;
			isTerminal: boolean;
		};
		nextIndex: number;
	} | null {
		const start = this.messages[startIndex];
		if (!start || start.role !== "assistant") return null;
		const startIsThinkingOnly = this.isThinkingOnlyAssistantMessage(start);
		const startHasTools = start.toolCalls.length > 0;
		if (!startIsThinkingOnly && !startHasTools) return null;

		const grouped: UiMessage[] = [];
		let sawTools = false;
		let consumedFinalMessage = false;
		let cursor = startIndex;

		while (cursor < this.messages.length) {
			const candidate = this.messages[cursor];
			if (candidate.role !== "assistant") break;
			const hasTools = candidate.toolCalls.length > 0;
			const hasText = candidate.text.trim().length > 0;
			const hasThinking = Boolean((candidate.thinking ?? "").trim());
			const hasError = Boolean((candidate.errorText ?? "").trim());

			if (hasTools) {
				grouped.push(candidate);
				sawTools = true;
				cursor += 1;
				continue;
			}

			if (!sawTools) {
				if (hasThinking && !hasText && !hasError) {
					grouped.push(candidate);
					cursor += 1;
					continue;
				}
				break;
			}

			if (!consumedFinalMessage && (hasText || hasError)) {
				grouped.push(candidate);
				consumedFinalMessage = true;
				cursor += 1;
				break;
			}

			if (!consumedFinalMessage && hasThinking) {
				grouped.push(candidate);
				cursor += 1;
				continue;
			}

			break;
		}

		if (grouped.length === 0) return null;
		const toolCalls = grouped.flatMap((entry) => entry.toolCalls);
		const isProvisionalWorkflow =
			toolCalls.length === 0 && this.currentIsStreaming() && this.keepWorkflowExpandedUntilAssistantText && !this.runHasAssistantText;
		if (toolCalls.length === 0 && !isProvisionalWorkflow) return null;

		const startedAt = toolCalls.reduce((min, tc) => {
			if (!tc.startedAt) return min;
			return min === 0 ? tc.startedAt : Math.min(min, tc.startedAt);
		}, 0);
		const endedAt = toolCalls.reduce((max, tc) => {
			if (!tc.endedAt) return max;
			return Math.max(max, tc.endedAt);
		}, 0);
		const thinkingParts = grouped
			.map((entry) => this.normalizeThinkingText((entry.thinking ?? "").replace(/^\s+/, "")))
			.filter(Boolean);
		const dedupedThinkingParts = thinkingParts.filter((part, index) => index === 0 || part !== thinkingParts[index - 1]);
		const thinkingText = dedupedThinkingParts.join("\n\n").trim();
		const finalText = grouped
			.filter((entry) => entry.toolCalls.length === 0)
			.map((entry) => entry.text.trim())
			.filter(Boolean)
			.join("\n\n");
		const errorText = grouped
			.map((entry) => (entry.errorText ?? "").trim())
			.filter(Boolean)
			.join("\n");
		const workflowId = `workflow-${grouped[0]?.id ?? start.id}`;

		const nextIndex = Math.max(startIndex + 1, cursor);
		return {
			workflow: {
				id: workflowId,
				messages: grouped,
				toolCalls,
				toolGroups: this.buildToolCallGroups(toolCalls),
				thinkingText,
				finalText,
				errorText,
				isStreaming: grouped.some((entry) => entry.isStreaming),
				startedAt,
				endedAt,
				isTerminal: nextIndex >= this.messages.length,
			},
			nextIndex,
		};
	}

	private resolveWorkflowExpansionState(
		workflowId: string,
		toolCalls: ToolCallBlock[],
		isTerminal: boolean,
	): {
		total: number;
		running: number;
		autoExpanded: boolean;
		expanded: boolean;
	} {
		const total = toolCalls.length;
		const running = toolCalls.filter((tc) => tc.isRunning).length;
		const manualExpanded = this.isToolWorkflowExpanded(workflowId);
		const autoExpanded = isTerminal && this.keepWorkflowExpandedUntilAssistantText && (running > 0 || this.runSawToolActivity || total === 0);
		const expanded = (autoExpanded && !this.collapsedAutoWorkflowIds.has(workflowId)) || manualExpanded;
		return {
			total,
			running,
			autoExpanded,
			expanded,
		};
	}

	private renderAssistantWorkflow(workflow: {
		id: string;
		messages: UiMessage[];
		toolCalls: ToolCallBlock[];
		toolGroups: ToolCallGroup[];
		thinkingText: string;
		finalText: string;
		errorText: string;
		isStreaming: boolean;
		startedAt: number;
		endedAt: number;
		isTerminal: boolean;
	}): TemplateResult {
		const { total, running, autoExpanded, expanded } = this.resolveWorkflowExpansionState(
			workflow.id,
			workflow.toolCalls,
			workflow.isTerminal,
		);
		const failed = workflow.toolCalls.filter((tc) => tc.isError).length;
		const durationMs =
			workflow.startedAt > 0
				? (running > 0 ? Date.now() : Math.max(workflow.endedAt, workflow.startedAt)) - workflow.startedAt
				: 0;
		const durationLabel = durationMs > 0 ? formatDuration(durationMs) : "0s";
		const summaryPrimary = durationLabel;
		const completed = Math.max(0, total - running - failed);
		const summaryParts: string[] = [];
		if (completed > 0) summaryParts.push(`${completed} complete`);
		if (failed > 0) summaryParts.push(`${failed} failed`);
		if (running > 0) summaryParts.push(`${running} running`);
		if (summaryParts.length === 0 && total > 0) summaryParts.push(`${total} complete`);
		const summarySecondary = summaryParts.join(" · ");
		const hasFinalContent = Boolean(workflow.finalText || workflow.errorText);
		type WorkflowDetailEntry =
			| {
				kind: "thinking";
				id: string;
				text: string;
				animating: boolean;
			}
			| {
				kind: "group";
				group: ToolCallGroup;
			};
		const detailEntries: WorkflowDetailEntry[] = [];
		let lastThinkingFull = "";
		for (const message of workflow.messages) {
			const normalizedThinking = this.normalizeThinkingText((message.thinking ?? "").replace(/^\s+/, ""));
			if (normalizedThinking) {
				let displayThinking = normalizedThinking;
				if (lastThinkingFull) {
					if (normalizedThinking.startsWith(lastThinkingFull)) {
						displayThinking = normalizedThinking.slice(lastThinkingFull.length).replace(/^\s+/, "").trim();
					} else if (lastThinkingFull.startsWith(normalizedThinking)) {
						displayThinking = "";
					}
				}
				lastThinkingFull = normalizedThinking;

				const previous = detailEntries[detailEntries.length - 1];
				if (!displayThinking) {
					if (previous && previous.kind === "thinking") {
						previous.animating = previous.animating || Boolean(message.isThinkingStreaming);
					}
				} else if (previous && previous.kind === "thinking") {
					previous.animating = previous.animating || Boolean(message.isThinkingStreaming);
					if (displayThinking === previous.text || previous.text.startsWith(displayThinking)) {
						// no-op: duplicate or shorter repeat
					} else if (displayThinking.startsWith(previous.text)) {
						previous.text = displayThinking;
					} else {
						detailEntries.push({
							kind: "thinking",
							id: `${workflow.id}:thinking:${message.id}`,
							text: displayThinking,
							animating: Boolean(message.isThinkingStreaming),
						});
					}
				} else {
					detailEntries.push({
						kind: "thinking",
						id: `${workflow.id}:thinking:${message.id}`,
						text: displayThinking,
						animating: Boolean(message.isThinkingStreaming),
					});
				}
			}

			for (const toolCall of message.toolCalls) {
				const preview = this.summarizeToolCall(toolCall);
				const previous = detailEntries[detailEntries.length - 1];
				if (previous && previous.kind === "group" && previous.group.toolName === toolCall.name && previous.group.preview === preview) {
					previous.group.calls.push(toolCall);
					continue;
				}
				detailEntries.push({
					kind: "group",
					group: {
						id: `${toolCall.id}-group`,
						toolName: toolCall.name,
						preview,
						calls: [toolCall],
					},
				});
			}
		}
		if (!expanded) {
			this.expandedToolGroupByWorkflowId.delete(workflow.id);
			this.clearWorkflowThinkingExpansion(workflow.id);
		}

		return html`
			<div class="chat-row assistant-row assistant-workflow-row" data-message-id=${workflow.id}>
				<div class="message-shell assistant-message-shell">
					<div class="assistant-block">
						<button
							class="tool-workflow-summary"
							@click=${() => {
								this.toggleToolWorkflowExpanded(workflow.id, autoExpanded, expanded);
							}}
						>
							<span class="workflow-divider" aria-hidden="true"></span>
							<span class="workflow-summary-center">
								<span class="workflow-summary-label">${summaryPrimary}</span>
								${summarySecondary ? html`<span class="workflow-summary-meta">${summarySecondary}</span>` : nothing}
								<span class="workflow-summary-caret">${expanded ? "▾" : "▸"}</span>
							</span>
							<span class="workflow-divider" aria-hidden="true"></span>
						</button>
						${expanded
							? html`
								<div class="tool-workflow-list">
									${detailEntries.map((entry) => {
										if (entry.kind === "thinking") {
											const thinkingExpanded = this.isWorkflowThinkingExpanded(entry.id);
											const thinkingAnimating = running === 0 && entry.animating;
											return html`
												<div class="tool-workflow-thinking">
													<button class="tool-workflow-thinking-toggle ${thinkingAnimating ? "animating" : "done"}" @click=${() => this.toggleWorkflowThinkingExpanded(entry.id)}>
														${thinkingAnimating ? html`<span class="tool-workflow-inline-pi" aria-hidden="true">${piGlyphIcon()}</span>` : nothing}
														<span class="tool-workflow-thinking-text">Thinking…</span>
													</button>
													${thinkingExpanded ? html`<div class="tool-workflow-thinking-content">${entry.text}</div>` : nothing}
												</div>
											`;
										}
										const group = entry.group;
										const count = group.calls.length;
										const groupRunning = group.calls.some((tc) => tc.isRunning);
										const groupFailed = group.calls.some((tc) => tc.isError);
										const groupExpanded = this.isToolGroupExpanded(workflow.id, group.id);
										const output =
											[...group.calls]
												.reverse()
												.map((call) => (call.streamingOutput ?? call.result ?? "").trim())
												.find((value) => value.length > 0) ?? "";
										const statusLabel = groupRunning ? "running" : groupFailed ? "failed" : "success";
										return html`
											<div class="tool-workflow-item">
												<button
													class="tool-workflow-line ${groupRunning ? "running" : ""}"
													@click=${() => this.toggleToolGroupExpanded(workflow.id, group.id)}
												>
													${groupRunning ? html`<span class="tool-workflow-inline-pi" aria-hidden="true">${piGlyphIcon()}</span>` : nothing}
													<span class="tool-workflow-line-text ${groupRunning ? "running" : ""}">${this.renderToolPreview(group.preview)}</span>
													${count > 1 ? html`<span class="tool-workflow-count">×${count}</span>` : nothing}
												</button>
												${groupExpanded
													? html`
														<div class="tool-workflow-details">
															<pre class="tool-workflow-output">${output || "No output reported."}${groupRunning ? html`<span class="streaming-inline"></span>` : nothing}</pre>
															<div class="tool-workflow-detail-meta"><span class="tool-workflow-detail-status ${groupRunning ? "running" : groupFailed ? "error" : "done"}">${statusLabel}</span></div>
														</div>
													`
													: nothing}
											</div>
										`;
									})}
								</div>
								${hasFinalContent ? html`<div class="assistant-final-divider"><span>Agent</span></div>` : nothing}
								${workflow.finalText
									? html`<div class="assistant-content"><markdown-block .content=${workflow.finalText}></markdown-block></div>`
									: nothing}
								${workflow.errorText ? html`<div class="assistant-error-line">${workflow.errorText}</div>` : nothing}
							`
							: html`
								${workflow.finalText
									? html`<div class="assistant-content workflow-final-collapsed"><markdown-block .content=${workflow.finalText}></markdown-block></div>`
									: nothing}
								${workflow.errorText ? html`<div class="assistant-error-line">${workflow.errorText}</div>` : nothing}
							`}
					</div>
				</div>
			</div>
		`;
	}

	private renderMessageTimeline(): TemplateResult[] {
		const rows: TemplateResult[] = [];
		const compactionInsertAt = this.compactionCycle
			? Math.max(0, Math.min(this.compactionInsertIndex ?? this.messages.length, this.messages.length))
			: null;
		let compactionInserted = false;
		const maybeInsertCompaction = (position: number): void => {
			if (compactionInserted) return;
			if (compactionInsertAt === null) return;
			if (position !== compactionInsertAt) return;
			const row = this.renderCompactionCycle();
			if (row !== nothing) {
				rows.push(row as TemplateResult);
			}
			compactionInserted = true;
		};

		for (let index = 0; index < this.messages.length; index += 1) {
			maybeInsertCompaction(index);
			const msg = this.messages[index];
			if (msg.role === "assistant") {
				const workflowCandidate = this.collectAssistantWorkflow(index);
				if (workflowCandidate) {
					rows.push(this.renderAssistantWorkflow(workflowCandidate.workflow));
					index = workflowCandidate.nextIndex - 1;
					continue;
				}
			}
			if (msg.role === "user") {
				rows.push(this.renderUserMessage(msg));
				continue;
			}
			if (msg.role === "assistant") {
				if (!this.hasRenderableAssistantContent(msg)) {
					continue;
				}
				rows.push(this.renderAssistantMessage(msg));
				continue;
			}
			if (msg.label === "changelog") {
				rows.push(this.renderChangelogMessage(msg));
				continue;
			}
			rows.push(this.renderSystemMessage(msg));
		}
		maybeInsertCompaction(this.messages.length);
		return rows;
	}

	private renderAssistantMessage(msg: UiMessage): TemplateResult {
		const trimmedText = msg.text.trim();
		const errorLine = (msg.errorText ?? "").trim();
		const standaloneCodeBlock = this.isStandaloneCodeBlockMarkdown(trimmedText);
		const canCopy = Boolean(errorLine.length > 0 || (trimmedText.length > 0 && !standaloneCodeBlock));
		const formattedErrorLine = errorLine
			? (/^error\b[:\s-]*/i.test(errorLine) ? errorLine : `Error: ${errorLine}`)
			: "";

		return html`
			<div class="chat-row assistant-row" data-message-id=${msg.id}>
				<div class="message-shell assistant-message-shell">
					<div class="assistant-block">
						${this.renderThinking(msg)}
						${msg.text
							? html`
								<div class="assistant-content">
									<markdown-block .content=${msg.text}></markdown-block>
								</div>
							`
							: nothing}
						${formattedErrorLine ? html`<div class="assistant-error-line">${formattedErrorLine}</div>` : nothing}
					</div>
					<div class="message-actions">
						${canCopy
							? html`<button class="message-action-btn icon" title="Copy message" @click=${() => this.copyMessage(msg)}>${uiIcon("copy")}</button>`
							: nothing}
					</div>
				</div>
			</div>
		`;
	}

	private renderSystemMessage(msg: UiMessage): TemplateResult {
		const isInline = msg.label === "share" || msg.label === "auth" || msg.label === "models";
		return html`
			<div class="chat-row system-row ${isInline ? "system-row-inline" : ""}" data-message-id=${msg.id}>
				<div class="system-message ${isInline ? "system-message-inline" : ""}">
					${msg.label ? html`<div class="system-label ${isInline ? "system-label-inline" : ""}">${msg.label}</div>` : nothing}
					<div class="system-text ${isInline ? "system-text-inline" : ""}">
						${msg.renderAsMarkdown ? html`<markdown-block .content=${msg.text}></markdown-block>` : msg.text}
					</div>
				</div>
			</div>
		`;
	}

	private renderChangelogMessage(msg: UiMessage): TemplateResult {
		const expanded = Boolean(msg.collapsibleExpanded);
		const title = msg.collapsibleTitle?.trim() || "Changelog";
		return html`
			<div class="chat-row assistant-row assistant-workflow-row changelog-row" data-message-id=${msg.id}>
				<div class="message-shell assistant-message-shell">
					<div class="assistant-block">
						<div class="changelog-inline">
							<button
								class="tool-workflow-line changelog-inline-toggle"
								@click=${() => {
									msg.collapsibleExpanded = !expanded;
									this.render();
								}}
							>
								<span class="tool-workflow-line-text">${title}</span>
								<span class="tool-workflow-count">${expanded ? "hide" : "show"}</span>
							</button>
							${expanded
								? html`
									<div class="tool-workflow-details changelog-inline-details">
										<div class="tool-workflow-output changelog-inline-output">
											<markdown-block .content=${msg.text}></markdown-block>
										</div>
									</div>
								`
								: nothing}
						</div>
					</div>
				</div>
			</div>
		`;
	}

	private renderCompactionCycle(): TemplateResult | typeof nothing {
		if (!this.compactionCycle) return nothing;
		const cycle = this.compactionCycle;
		const completed = cycle.endedAt ?? Date.now();
		const elapsedSeconds = Math.max(1, Math.round((completed - cycle.startedAt) / 1000));
		const elapsed = `${elapsedSeconds}s`;
		const title =
			cycle.status === "running"
				? "Compacting context..."
				: cycle.status === "done"
					? "Compaction complete"
					: cycle.status === "error"
						? "Compaction failed"
						: "Compaction aborted";
		const normalizedSummary = cycle.summary.trim().toLowerCase();
		const showSummaryLine =
			cycle.status !== "running" &&
			Boolean(cycle.summary.trim()) &&
			!(["compaction complete", "compaction failed", "compaction aborted", "compacting context…", "compacting context"] as string[]).includes(normalizedSummary);
		return html`
			<div class="chat-row assistant-row assistant-workflow-row compaction-row" data-message-id=${cycle.id}>
				<div class="message-shell assistant-message-shell">
					<div class="assistant-block">
						<div class="compaction-inline">
							<button
								class="tool-workflow-line compaction-inline-toggle"
								@click=${() => {
									cycle.expanded = !cycle.expanded;
									this.render();
								}}
							>
								${cycle.status === "running" ? html`<span class="tool-workflow-inline-pi" aria-hidden="true">${piGlyphIcon()}</span>` : nothing}
								<span class="tool-workflow-line-text ${cycle.status === "running" ? "running" : ""}">${title}</span>
								<span class="tool-workflow-count">${elapsed}</span>
							</button>
							${cycle.expanded
								? html`
									<div class="tool-workflow-details compaction-inline-details">
										${showSummaryLine ? html`<div class="tool-workflow-output compaction-inline-summary">${cycle.summary}</div>` : nothing}
										${cycle.errorMessage ? html`<div class="tool-workflow-output compaction-inline-error">${cycle.errorMessage}</div>` : nothing}
										${cycle.details.map((line) => html`<div class="tool-workflow-output compaction-inline-line">${line}</div>`)}
									</div>
								`
								: nothing}
						</div>
					</div>
				</div>
			</div>
		`;
	}

	private renderBindingState(): TemplateResult {
		return html`
			<div class="chat-row assistant-row intro-row">
				<div class="message-shell assistant-message-shell">
					<div class="assistant-block intro-block">
						<div class="assistant-content intro-text">${this.bindingStatusText ?? "Loading session…"}</div>
					</div>
				</div>
			</div>
		`;
	}

	private renderEmptyState(): TemplateResult {
		return this.renderCenteredWelcome();
	}

	private async openExternalUrl(url: string): Promise<void> {
		try {
			const { open } = await import("@tauri-apps/plugin-shell");
			await open(url);
		} catch {
			window.open(url, "_blank", "noopener,noreferrer");
		}
	}

	private async readDirSafe(path: string): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }>> {
		try {
			const { exists, readDir } = await import("@tauri-apps/plugin-fs");
			if (!(await exists(path))) return [];
			return await readDir(path);
		} catch {
			return [];
		}
	}

	private async collectSkillNames(skillsRoot: string): Promise<string[]> {
		const names = new Set<string>();
		const queue: Array<{ path: string; depth: number }> = [{ path: skillsRoot, depth: 0 }];

		while (queue.length > 0) {
			const next = queue.shift()!;
			if (next.depth > 5) continue;
			const entries = await this.readDirSafe(next.path);
			for (const entry of entries) {
				const fullPath = joinFsPath(next.path, entry.name);
				if (entry.isDirectory) {
					queue.push({ path: fullPath, depth: next.depth + 1 });
					continue;
				}
				if (entry.isFile && entry.name.toLowerCase() === "skill.md") {
					const parts = next.path.replace(/\\/g, "/").split("/");
					names.add(parts[parts.length - 1] || next.path);
				}
			}
		}

		return [...names].sort((a, b) => a.localeCompare(b));
	}

	private async collectExtensionNames(extensionsRoot: string): Promise<string[]> {
		const names = new Set<string>();
		const queue: Array<{ path: string; depth: number }> = [{ path: extensionsRoot, depth: 0 }];

		while (queue.length > 0) {
			const next = queue.shift()!;
			if (next.depth > 2) continue;
			const entries = await this.readDirSafe(next.path);
			for (const entry of entries) {
				const fullPath = joinFsPath(next.path, entry.name);
				if (entry.isDirectory) {
					if (next.depth > 0) names.add(entry.name);
					queue.push({ path: fullPath, depth: next.depth + 1 });
					continue;
				}
				if (entry.isFile && entry.name.toLowerCase().endsWith(".json")) {
					names.add(entry.name.replace(/\.json$/i, ""));
				}
			}
		}

		return [...names].sort((a, b) => a.localeCompare(b));
	}

	private async collectThemeNames(themesRoot: string): Promise<string[]> {
		const entries = await this.readDirSafe(themesRoot);
		const names = entries
			.filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".json"))
			.map((entry) => entry.name.replace(/\.json$/i, ""))
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));
		return names;
	}

	private async refreshWelcomeDashboard(force = false): Promise<void> {
		if (this.projectPath) return;
		if (this.welcomeDashboard.loading) return;
		if (!force && Date.now() - this.welcomeDashboard.updatedAt < 90_000) return;

		this.welcomeDashboard = {
			...this.welcomeDashboard,
			loading: true,
			error: null,
		};
		this.render();

		try {
			const { homeDir } = await import("@tauri-apps/api/path");
			const home = await homeDir();
			const agentRoot = joinFsPath(joinFsPath(home, ".pi"), "agent");
			const skillsRoot = joinFsPath(agentRoot, "skills");
			const extensionsRoot = joinFsPath(agentRoot, "extensions");
			const themesRoot = joinFsPath(agentRoot, "themes");

			const [skills, extensions, themes] = await Promise.all([
				this.collectSkillNames(skillsRoot),
				this.collectExtensionNames(extensionsRoot),
				this.collectThemeNames(themesRoot),
			]);

			let currentCliVersion: string | null = null;
			let latestCliVersion: string | null = null;
			let updateAvailable = false;
			try {
				const cliStatus = await rpcBridge.getCliUpdateStatus();
				currentCliVersion = cliStatus.current_version ?? null;
				latestCliVersion = cliStatus.latest_version ?? null;
				updateAvailable = cliStatus.update_available;
			} catch {
				// Ignore status fetch errors for welcome state.
			}

			this.welcomeDashboard = {
				loading: false,
				skills,
				extensions,
				themes,
				currentCliVersion,
				latestCliVersion,
				updateAvailable,
				error: null,
				updatedAt: Date.now(),
			};
		} catch (err) {
			this.welcomeDashboard = {
				...this.welcomeDashboard,
				loading: false,
				error: err instanceof Error ? err.message : String(err),
				updatedAt: Date.now(),
			};
		}

		if (!this.projectPath) this.render();
	}

	private renderWelcomeDashboard(): TemplateResult {
		return this.renderCenteredWelcome();
	}

	private renderCenteredWelcome(): TemplateResult {
		const snapshot = this.welcomeDashboard;
		const brandIconUrl = new URL("../../assets/branding/pi-desktop-icon.svg", import.meta.url).href;
		const comparableProjectPath = normalizeComparablePath(this.projectPath);
		const activeProject =
			this.welcomeProjects.find((project) => project.id === this.welcomeActiveProjectId) ??
			this.welcomeProjects.find((project) => normalizeComparablePath(project.path) === comparableProjectPath) ??
			null;
		const hasProject = Boolean(activeProject || this.projectPath);
		const projectLabel = activeProject?.name ?? (this.projectPath ? this.fileNameFromPath(this.projectPath) : "Add project");
		const welcomeHeadline = this.welcomeHeadlines[this.welcomeHeadlineIndex] ?? this.welcomeHeadlines[0];

		return html`
			<div class="welcome-dashboard welcome-dashboard-minimal">
				<div class="welcome-brand-lockup" aria-hidden="true">
					<div class="welcome-brand-mark"><img src=${brandIconUrl} alt="Pi Desktop" /></div>
				</div>
				<h2>${welcomeHeadline}</h2>
				<div class="welcome-project-wrap">
					<button
						class="welcome-project-trigger ${hasProject ? "active" : ""}"
						@click=${() => {
							this.welcomeProjectMenuOpen = !this.welcomeProjectMenuOpen;
							this.render();
						}}
					>
						<span>${projectLabel}</span>
						<span class="welcome-project-caret ${this.welcomeProjectMenuOpen ? "open" : ""}">⌄</span>
					</button>
					${this.welcomeProjectMenuOpen
						? html`
							<div class="welcome-project-menu">
								${this.welcomeProjects.map((project) => {
									const isCurrent = project.id === activeProject?.id;
									return html`
										<button class="welcome-project-item ${isCurrent ? "current" : ""}" @click=${() => {
											this.welcomeProjectMenuOpen = false;
											if (!isCurrent) this.onSelectWelcomeProject?.(project.id);
										}}>
											<span>${project.name}</span>
											<span>${isCurrent ? "✓" : ""}</span>
										</button>
									`;
								})}
								${this.welcomeProjects.length > 0 ? html`<div class="welcome-project-sep"></div>` : nothing}
								<button class="welcome-project-item" @click=${() => {
									this.welcomeProjectMenuOpen = false;
									this.onAddProject?.();
								}}>Add new project</button>
								<div class="welcome-project-sep"></div>
								<button class="welcome-project-item" @click=${() => {
									this.welcomeProjectMenuOpen = false;
									this.onOpenPackages?.();
								}}>Packages</button>
								<button class="welcome-project-item" @click=${() => {
									this.welcomeProjectMenuOpen = false;
									this.onOpenSettings?.();
								}}>Settings</button>
							</div>
						`
						: nothing}
				</div>
				<div class="welcome-meta-line muted ${this.welcomeProjectMenuOpen ? "hidden" : ""}">
					${snapshot.loading ? "Refreshing local Pi inventory…" : `${snapshot.skills.length} skills · ${snapshot.extensions.length} extensions · ${snapshot.themes.length} themes`}
				</div>
				${snapshot.error ? html`<div class="welcome-error">${snapshot.error}</div>` : nothing}
			</div>
		`;
	}

	private renderComposerControls(canSend: boolean, isStreaming: boolean, interactionLocked: boolean): TemplateResult {
		const currentProvider = normalizeText(this.state?.model?.provider);
		const currentModelId = normalizeText(this.state?.model?.id);
		const currentModelValue = currentProvider && currentModelId ? `${currentProvider}::${currentModelId}` : "";
		const currentModelDisplay = currentModelId ? formatModelDisplayName(currentModelId) : "Select model";
		const currentProviderDisplay = currentProvider ? formatProviderDisplayName(currentProvider) : "";
		const currentModelTitle = currentProvider && currentModelId ? `${currentProviderDisplay} / ${currentModelId}` : "Select model";
		const thinkingValue = (this.state?.thinkingLevel ?? "off") as ThinkingLevel;
		const thinkingLabel = formatThinkingDisplayName(thinkingValue);

		const availableByKey = new Map<string, ModelOption>();
		for (const model of this.availableModels) {
			availableByKey.set(`${model.provider}::${model.id}`.toLowerCase(), model);
		}

		const catalogSeed = this.modelCatalog.length > 0 ? this.modelCatalog : this.availableModels;
		const combinedByKey = new Map<string, ModelOption>();
		for (const model of catalogSeed) {
			const key = `${model.provider}::${model.id}`.toLowerCase();
			if (!combinedByKey.has(key)) combinedByKey.set(key, model);
		}
		for (const model of this.availableModels) {
			const key = `${model.provider}::${model.id}`.toLowerCase();
			if (!combinedByKey.has(key)) combinedByKey.set(key, model);
		}

		if (currentProvider && currentModelId) {
			const currentKey = `${currentProvider}::${currentModelId}`.toLowerCase();
			if (!combinedByKey.has(currentKey)) {
				combinedByKey.set(currentKey, {
					provider: currentProvider,
					id: currentModelId,
					label: `${currentProvider}/${currentModelId}`,
					reasoning: false,
				});
			}
		}

		const groupedByProvider = new Map<
			string,
			{ providerKey: string; providerLabel: string; models: Array<ModelOption & { selectable: boolean }> }
		>();
		for (const model of combinedByKey.values()) {
			const providerKey = model.provider;
			const modelKey = `${model.provider}::${model.id}`.toLowerCase();
			const selectable = availableByKey.has(modelKey) || (model.provider === currentProvider && model.id === currentModelId);
			const existing = groupedByProvider.get(providerKey);
			if (existing) {
				existing.models.push({ ...model, selectable });
			} else {
				groupedByProvider.set(providerKey, {
					providerKey,
					providerLabel: formatProviderDisplayName(providerKey),
					models: [{ ...model, selectable }],
				});
			}
		}
		for (const provider of this.providerAuthById.keys()) {
			if (groupedByProvider.has(provider)) continue;
			groupedByProvider.set(provider, {
				providerKey: provider,
				providerLabel: formatProviderDisplayName(provider),
				models: [],
			});
		}
		for (const provider of DEFAULT_OAUTH_PROVIDER_IDS) {
			if (groupedByProvider.has(provider)) continue;
			groupedByProvider.set(provider, {
				providerKey: provider,
				providerLabel: formatProviderDisplayName(provider),
				models: [],
			});
		}
		for (const forcedLoggedOutProvider of this.providerAuthForcedLoggedOut) {
			if (groupedByProvider.has(forcedLoggedOutProvider)) continue;
			groupedByProvider.set(forcedLoggedOutProvider, {
				providerKey: forcedLoggedOutProvider,
				providerLabel: formatProviderDisplayName(forcedLoggedOutProvider),
				models: [],
			});
		}

		const providerGroups = Array.from(groupedByProvider.values())
			.map((group) => {
				const authKey = this.providerKey(group.providerKey);
				const hasSelectableModel = group.models.some((model) => model.selectable);
				const authInfo = this.providerAuthById.get(authKey);
				const forcedLoggedOut = this.providerAuthForcedLoggedOut.has(authKey);
				const authConfigured = !forcedLoggedOut && (this.providerAuthConfigured.has(authKey) || hasSelectableModel);
				const authSource = forcedLoggedOut ? "missing" : (authInfo?.source ?? (hasSelectableModel ? "runtime" : "missing"));
				return {
					...group,
					authConfigured,
					authSource,
					authKind: authInfo?.kind ?? "unknown",
					isDefaultOAuthProvider: DEFAULT_OAUTH_PROVIDER_SET.has(authKey),
					models: [...group.models].sort((a, b) =>
						formatModelDisplayName(a.id).localeCompare(formatModelDisplayName(b.id), undefined, { sensitivity: "base" }),
					),
				};
			})
			.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel, undefined, { sensitivity: "base" }));

		const resolvedActiveProvider = providerGroups.some((g) => g.providerKey === this.modelPickerActiveProvider)
			? this.modelPickerActiveProvider
			: providerGroups.some((g) => g.providerKey === currentProvider)
				? currentProvider
				: (providerGroups[0]?.providerKey ?? "");
		const activeProviderGroup = providerGroups.find((group) => group.providerKey === resolvedActiveProvider) ?? null;

		return html`
			<div class="composer-controls">
				<div class="control-group">
					<button
						class="composer-icon-btn"
						title="Attach file"
						?disabled=${interactionLocked}
						@click=${() => {
							if (interactionLocked) return;
							const input = this.container.querySelector("#file-picker") as HTMLInputElement | null;
							input?.click();
						}}
					>
						${uiIcon("attach")}
					</button>

					<div
						class="model-picker-root"
						@keydown=${(event: KeyboardEvent) => {
							if (event.key !== "Escape") return;
							event.preventDefault();
							this.modelPickerOpen = false;
							this.render();
							requestAnimationFrame(() => {
								const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
								textarea?.focus();
							});
						}}
						@focusout=${(event: FocusEvent) => {
							const next = event.relatedTarget as Node | null;
							const root = event.currentTarget as HTMLElement;
							if (next && root.contains(next)) return;
							if (!this.modelPickerOpen) return;
							this.modelPickerOpen = false;
							this.render();
						}}
					>
						<button
							type="button"
							class="model-picker-trigger"
							title=${currentModelTitle}
							?disabled=${interactionLocked || this.settingModel}
							@click=${() => {
								if (interactionLocked || this.settingModel) return;
								if (!this.loadingModels && this.availableModels.length === 0) {
									void this.loadAvailableModels();
								}
								if (!this.loadingProviderAuth) {
									void this.loadProviderAuthStatus();
								}
								if (!this.loadingModelCatalog && this.modelCatalog.length === 0) {
									void this.loadModelCatalog();
								}
								if (this.modelPickerOpen) {
									this.modelPickerOpen = false;
									this.render();
									return;
								}
								if (resolvedActiveProvider) this.modelPickerActiveProvider = resolvedActiveProvider;
								this.modelPickerOpen = true;
								this.render();
							}}
						>
							<span class="model-picker-trigger-label">${currentProviderDisplay ? `${currentModelDisplay} · ${currentProviderDisplay}` : currentModelDisplay}</span>
							<span class="composer-select-caret">▾</span>
						</button>

						${this.modelPickerOpen
							? html`
								<div class="model-picker-popover" role="listbox" aria-label="Available models">
									${providerGroups.length === 0
										? html`<div class="model-picker-empty">${this.loadingModels || this.loadingModelCatalog ? "Loading models…" : "No models available"}</div>`
										: html`
											<div class="model-picker-providers">
												${providerGroups.map((group) => {
													const authKey = this.providerKey(group.providerKey);
													const isActionBusy = this.runningProviderAuthAction?.provider === authKey;
													const canLogout = group.authConfigured && group.authSource !== "environment";
													const action = canLogout ? ("logout" as const) : ("login" as const);
													const actionLabel = group.authConfigured
														? group.authSource === "environment"
															? "Env"
															: "Logout"
														: "Login";
													const actionDisabled =
														interactionLocked ||
														this.settingModel ||
														isActionBusy ||
														(group.authConfigured && group.authSource === "environment");
													const actionTitle = group.authConfigured
														? group.authSource === "environment"
															? "Configured from environment variable"
															: `Logout from ${group.providerLabel}`
														: `Set up ${group.providerLabel}`;
													return html`
														<div class="model-picker-provider-row ${group.providerKey === resolvedActiveProvider ? "active" : ""} ${group.authConfigured ? "" : "unauth"}">
															<button
																type="button"
																class="model-picker-provider ${group.providerKey === resolvedActiveProvider ? "active" : ""} ${group.authConfigured ? "" : "unauth"}"
																title=${group.authConfigured ? `${group.providerLabel} connected` : `${group.providerLabel} needs setup`}
																@mouseenter=${() => {
																	if (this.modelPickerActiveProvider === group.providerKey) return;
																	this.modelPickerActiveProvider = group.providerKey;
																	this.render();
																}}
																@focus=${() => {
																	if (this.modelPickerActiveProvider === group.providerKey) return;
																	this.modelPickerActiveProvider = group.providerKey;
																	this.render();
																}}
																@click=${() => {
																	if (this.modelPickerActiveProvider === group.providerKey) return;
																	this.modelPickerActiveProvider = group.providerKey;
																	this.render();
																}}
															>
																<span class="model-picker-provider-label">${group.providerLabel}</span>
															</button>
															<button
																type="button"
																class="model-picker-provider-auth ${group.authConfigured ? "connected" : ""} ${isActionBusy ? "busy" : ""}"
																title=${actionTitle}
																?disabled=${actionDisabled}
																@click=${(event: MouseEvent) => {
																	event.preventDefault();
																	event.stopPropagation();
																	if (actionDisabled) return;
																	void this.handleProviderAuthAction(group.providerKey, action);
																}}
															>
																${isActionBusy ? "…" : actionLabel}
															</button>
														</div>
													`;
												})}
											</div>
											<div class="model-picker-models">
												${activeProviderGroup
													? html`
														${activeProviderGroup.models.length === 0
															? html`
																<div class="model-picker-auth-hint">
																	${activeProviderGroup.authConfigured
																		? activeProviderGroup.isDefaultOAuthProvider
																			? "Connected, but no models are available right now. Try /reload after login changes."
																			: "Connected, but no models are loaded for this provider. Install/enable its package in Packages, then run /reload."
																		: "Not connected yet. Use Login to set up this provider."}
																</div>
															`
															: html`
																${!activeProviderGroup.authConfigured
																	? html`<div class="model-picker-auth-hint">Not connected yet. Use Login to set up this provider.</div>`
																	: nothing}
																${activeProviderGroup.models.map((model) => {
																	const nextValue = `${model.provider}::${model.id}`;
																	const isActive = model.provider === currentProvider && model.id === currentModelId;
																	const isDisabled = !model.selectable || !activeProviderGroup.authConfigured;
																	return html`
																		<button
																			type="button"
																			class="model-picker-model ${isActive ? "active" : ""} ${isDisabled ? "disabled" : ""}"
																			title=${isDisabled
																				? `${formatProviderDisplayName(model.provider)} / ${model.id} (setup required)`
																				: `${formatProviderDisplayName(model.provider)} / ${model.id}`}
																			?disabled=${interactionLocked || this.settingModel || isDisabled}
																			@click=${() => {
																				if (isDisabled) return;
																				this.modelPickerOpen = false;
																				this.render();
																				if (nextValue === currentModelValue) return;
																				void this.setModel(model.provider, model.id);
																			}}
																		>
																			<span>${formatModelDisplayName(model.id)}</span>
																		</button>
																	`;
																})}
															`}
													`
													: html`<div class="model-picker-empty">No models</div>`}
											</div>
										`}
								</div>
							`
							: nothing}
					</div>

					<div class="thinking-select-wrap" title="Reasoning effort · Shift+Tab to cycle">
						<span class="thinking-select-label">${thinkingLabel}</span>
						<select
							class="thinking-select-native"
							.value=${thinkingValue}
							?disabled=${interactionLocked || this.settingThinking}
							@change=${(e: Event) => void this.setThinkingLevel((e.target as HTMLSelectElement).value as ThinkingLevel)}
						>
							<option value="off">off</option>
							<option value="minimal">minimal</option>
							<option value="low">low</option>
							<option value="medium">medium</option>
							<option value="high">high</option>
							<option value="xhigh">xhigh</option>
						</select>
						<span class="thinking-select-caret">▾</span>
					</div>
				</div>

				<div class="control-group right">
					${isStreaming
						? html`
							<button
								class="send-btn stop-btn"
								title="Stop generation"
								?disabled=${interactionLocked}
								@click=${() => {
									if (interactionLocked) return;
									void this.abortCurrentRun();
								}}
							>
								${uiIcon("stop")}
							</button>
						`
						: this.sendingPrompt
							? html`
								<button class="send-btn pending-send" title="Sending" disabled>
									${uiIcon("spinner")}
								</button>
							`
							: html`
								<button
									class="send-btn primary-send"
									?disabled=${interactionLocked || !canSend}
									title="Send (Enter) · Queue while streaming (Alt+Enter)"
									@click=${() => {
										if (interactionLocked) return;
										void this.sendMessage("prompt");
									}}
								>
									${uiIcon("send")}
								</button>
							`}
				</div>
			</div>
		`;
	}

	private renderQueuedComposerMessages(): TemplateResult | typeof nothing {
		if (this.queuedComposerMessages.length === 0) return nothing;
		const recent = this.queuedComposerMessages.slice(-2);
		return html`
			<div class="composer-queued-row" aria-live="polite">
				${recent.map(
					(entry) => html`
						<div class="composer-queued-pill" title=${entry.text}>
							<span class="composer-queued-label">Queued</span>
							<span class="composer-queued-text">${truncate(entry.text.replace(/\s+/g, " "), 72)}</span>
							${entry.imageCount > 0 ? html`<span class="composer-queued-meta">+${entry.imageCount} image${entry.imageCount === 1 ? "" : "s"}</span>` : nothing}
						</div>
					`,
				)}
			</div>
		`;
	}

	private renderPendingImages(): TemplateResult | typeof nothing {
		if (this.pendingImages.length === 0) return nothing;
		return html`
			<div class="composer-attachments">
				${this.pendingImages.map(
					(img) => html`
						<div class="composer-attachment">
							<img src=${img.previewUrl} alt=${img.name} />
							<div class="composer-attachment-meta">
								<div>${truncate(img.name, 18)}</div>
								<div>${Math.max(1, Math.round(img.size / 1024))} KB</div>
							</div>
							<button @click=${() => this.removePendingImage(img.id)}>✕</button>
						</div>
					`,
				)}
			</div>
		`;
	}

	private renderComposerSkillDraftPill(): TemplateResult | typeof nothing {
		const draft = this.selectedSkillDraft;
		if (!draft) return nothing;
		return html`
			<div class="composer-skill-draft-pill inline">
				<span class="composer-skill-draft-icon" aria-hidden="true">${skillGlyphIcon()}</span>
				<span class="composer-skill-draft-name">${draft.name}</span>
				<button class="composer-skill-draft-remove" title="Remove skill" @click=${() => this.removeComposerSkillDraft()}>✕</button>
			</div>
		`;
	}

	private ensureActiveSlashItemVisible(): void {
		if (!this.slashPaletteOpen || this.slashPaletteNavigationMode !== "keyboard") return;
		requestAnimationFrame(() => {
			const menu = this.container.querySelector<HTMLElement>(".composer-slash-menu");
			const activeItem = this.container.querySelector<HTMLElement>(".composer-slash-item.active");
			if (!menu || !activeItem) return;
			activeItem.scrollIntoView({ block: "nearest" });
			const itemTop = activeItem.offsetTop;
			if (itemTop < menu.scrollTop + 4) {
				menu.scrollTop = Math.max(0, itemTop - 4);
			}
		});
	}

	private renderSlashPalette(items: SlashPaletteItem[]): TemplateResult | typeof nothing {
		if (!this.slashPaletteOpen) return nothing;
		if (this.slashCommandsLoading && items.length === 0) {
			return html`<div class="composer-slash-menu"><div class="composer-slash-empty">Loading commands…</div></div>`;
		}
		if (items.length === 0) {
			return html`<div class="composer-slash-menu"><div class="composer-slash-empty">No commands match “/${this.slashPaletteQuery}”.</div></div>`;
		}
		const activeIndex = Math.max(0, Math.min(this.slashPaletteIndex, items.length - 1));
		let currentSection: SlashPaletteSection | null = null;
		return html`
			<div
				class="composer-slash-menu ${this.slashPaletteNavigationMode === "keyboard" ? "keyboard-nav" : ""}"
				@mousemove=${(event: MouseEvent) => {
					if (this.slashPaletteNavigationMode === "keyboard") {
						const moved = Math.abs(event.movementX) + Math.abs(event.movementY) > 0;
						if (!moved) return;
						this.slashPaletteNavigationMode = "pointer";
					}
					const target = event.target instanceof Element ? event.target.closest(".composer-slash-item") as HTMLElement | null : null;
					if (!target) return;
					const indexRaw = target.dataset.index;
					if (!indexRaw) return;
					const index = Number(indexRaw);
					if (!Number.isFinite(index)) return;
					if (this.slashPaletteIndex !== index) {
						this.slashPaletteIndex = index;
						this.render();
					}
				}}
			>
				${items.map((item, index) => {
					const sectionChanged = item.section !== currentSection;
					currentSection = item.section;
					return html`
						${sectionChanged ? html`<div class="composer-slash-section">${item.section}</div>` : nothing}
						<button
							class="composer-slash-item ${index === activeIndex ? "active" : ""}"
							data-index=${String(index)}
							@click=${() => this.selectSlashPaletteItem(item)}
						>
							<span class="composer-slash-item-main">
								<span class="composer-slash-item-label">${item.label}</span>
								<span class="composer-slash-item-hint">${item.hint}</span>
							</span>
						</button>
					`;
				})}
			</div>
		`;
	}

	private renderComposer(): TemplateResult {
		const isStreaming = this.currentIsStreaming();
		const interactionLocked = this.isComposerInteractionLocked();
		const slashItems = this.getSlashPaletteItems();
		const canSendBase = !interactionLocked && (this.inputText.trim().length > 0 || this.pendingImages.length > 0 || Boolean(this.selectedSkillDraft));
		const canSend = canSendBase;
		if (slashItems.length > 0 && this.slashPaletteIndex >= slashItems.length) {
			this.slashPaletteIndex = slashItems.length - 1;
		}
		const connectivityStatus = this.bindingStatusText || (!this.isConnected && this.projectPath ? "RPC disconnected" : "");
		const ratio = Math.min(1, Math.max(0, this.sessionStats.usageRatio ?? 0));
		const ratioPercent = `${Math.round(ratio * 100)}%`;
		const ringRadius = 9;
		const circumference = 2 * Math.PI * ringRadius;
		const strokeOffset = circumference * (1 - ratio);
		const statsLines = this.sessionStatsLines();

		return html`
			<div class="composer-shell">
				<div class="composer-inner">
					${this.renderQueuedComposerMessages()}
					<div class="composer-panel">
						${this.renderPendingImages()}
						<div class="composer-row">
							${this.renderComposerSkillDraftPill()}
							<textarea
								id="chat-input"
								class="chat-input"
								placeholder=${interactionLocked ? (connectivityStatus || "Session not ready…") : "Describe the next change — type / for commands"}
								rows="1"
								?disabled=${interactionLocked}
								.value=${this.inputText}
								@input=${(e: Event) => {
									if (interactionLocked) return;
									const ta = e.target as HTMLTextAreaElement;
									const hadSlashPalette = this.slashPaletteOpen;
									this.inputText = ta.value;
									this.resetComposerHistoryNavigation();
									this.updateSlashPaletteStateFromInput();
									ta.style.height = "auto";
									ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
									if (this.slashPaletteOpen || hadSlashPalette) {
										this.render();
									}
								}}
								@paste=${(e: ClipboardEvent) => {
									if (interactionLocked) {
										e.preventDefault();
										return;
									}
									const items = Array.from(e.clipboardData?.items || []);
									const files = items
										.filter((item) => item.type.startsWith("image/"))
										.map((item) => item.getAsFile())
										.filter((f): f is File => Boolean(f));
									if (files.length > 0) {
										e.preventDefault();
										void this.prepareImages(files);
									}
								}}
								@dragover=${(e: DragEvent) => {
									e.preventDefault();
									if (e.dataTransfer) e.dataTransfer.dropEffect = interactionLocked ? "none" : "copy";
								}}
								@drop=${(e: DragEvent) => {
									e.preventDefault();
									if (interactionLocked) return;
									this.handleDroppedDataTransfer(e.dataTransfer ?? null);
								}}
								@keydown=${(e: KeyboardEvent) => {
									if (interactionLocked) return;
									if (e.key === "Escape" && this.modelPickerOpen) {
										e.preventDefault();
										this.modelPickerOpen = false;
										this.render();
										return;
									}
									if ((e.key === "Backspace" || e.key === "Delete") && this.inputText.length === 0 && this.selectedSkillDraft) {
										e.preventDefault();
										this.removeComposerSkillDraft();
										return;
									}
									if (e.key === "Tab" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
										e.preventDefault();
										void this.cycleThinkingLevel(1);
										return;
									}
									const textarea = e.currentTarget as HTMLTextAreaElement;
									const canHistoryUp = e.key === "ArrowUp" && this.shouldHandleComposerHistoryKey(e, textarea, "up");
									const canHistoryDown = e.key === "ArrowDown" && this.shouldHandleComposerHistoryKey(e, textarea, "down");
									const historyBrowsing = this.composerHistoryIndex >= 0;
									if (canHistoryUp && (historyBrowsing || !this.slashPaletteOpen)) {
										e.preventDefault();
										this.navigateComposerHistory("up");
										return;
									}
									if (canHistoryDown && historyBrowsing) {
										e.preventDefault();
										this.navigateComposerHistory("down");
										return;
									}
									const liveSlashItems = this.getSlashPaletteItems();
									if (this.slashPaletteOpen && liveSlashItems.length > 0) {
										if (e.key === "ArrowDown") {
											e.preventDefault();
											this.slashPaletteNavigationMode = "keyboard";
											this.slashPaletteIndex = (this.slashPaletteIndex + 1) % liveSlashItems.length;
											const item = liveSlashItems[this.slashPaletteIndex];
											if (item) this.previewSlashPaletteItem(item);
											this.render();
											this.ensureActiveSlashItemVisible();
											return;
										}
										if (e.key === "ArrowUp") {
											e.preventDefault();
											this.slashPaletteNavigationMode = "keyboard";
											this.slashPaletteIndex = (this.slashPaletteIndex - 1 + liveSlashItems.length) % liveSlashItems.length;
											const item = liveSlashItems[this.slashPaletteIndex];
											if (item) this.previewSlashPaletteItem(item);
											this.render();
											this.ensureActiveSlashItemVisible();
											return;
										}
									}
									if (this.slashPaletteOpen && e.key === "Escape") {
										e.preventDefault();
										this.closeSlashPalette();
										this.render();
										return;
									}
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										if (!this.selectedSkillDraft && this.slashQueryFromInput() !== null) {
											void this.executeSlashCommandFromComposer();
											return;
										}
										if (e.altKey) {
											void this.sendMessage("followUp");
										} else {
											const mode = isStreaming ? "steer" : "prompt";
											void this.sendMessage(mode);
										}
									}
								}}
							></textarea>
						</div>
						${this.renderSlashPalette(slashItems)}
						${this.renderComposerControls(canSend, isStreaming, interactionLocked)}
					</div>

					<div class="composer-under-row">
						${this.renderGitRepoControl()}
						<div class="composer-stats-slot">
							<div
								class="session-stats-wrap"
								@mouseenter=${() => {
									this.sessionStatsHover = true;
									this.render();
								}}
								@mouseleave=${() => {
									this.sessionStatsHover = false;
									this.render();
								}}
							>
								<div class="session-stats-inline">
									<button
										type="button"
										class="session-stats-ring ${this.refreshingSessionStats ? "loading" : ""}"
										aria-label=${this.sessionStatsTooltip()}
									>
										<svg viewBox="0 0 24 24" aria-hidden="true">
											<circle class="session-stats-ring-track" cx="12" cy="12" r=${ringRadius}></circle>
											<circle
												class="session-stats-ring-progress"
												cx="12"
												cy="12"
												r=${ringRadius}
												style=${`stroke-dasharray:${circumference};stroke-dashoffset:${strokeOffset};`}
											></circle>
										</svg>
									</button>
									<span class="session-stats-percent">${ratioPercent}</span>
								</div>
								${this.sessionStatsHover
									? html`
										<div class="session-stats-popover">
											${statsLines.length > 0
												? statsLines.map((line) => html`<div>${line}</div>`)
												: html`<div>Session stats unavailable</div>`}
										</div>
									`
									: nothing}
							</div>
						</div>
					</div>

					<input
						id="file-picker"
						type="file"
						accept="image/*"
						multiple
						style="display:none"
						@change=${(e: Event) => {
							if (interactionLocked) {
								(e.target as HTMLInputElement).value = "";
								return;
							}
							const files = (e.target as HTMLInputElement).files;
							if (files?.length) void this.prepareImages(files);
							(e.target as HTMLInputElement).value = "";
						}}
					/>
				</div>
			</div>
		`;
	}

	private renderForkPicker(): TemplateResult | typeof nothing {
		if (!this.forkPickerOpen) return nothing;
		return html`
			<div class="overlay" @click=${(e: Event) => e.target === e.currentTarget && this.closeForkPicker()}>
				<div class="overlay-card">
					<div class="overlay-header">
						<div>Fork from earlier user message</div>
						<button @click=${() => this.closeForkPicker()}>✕</button>
					</div>
					<div class="overlay-body">
						${this.openingForkPicker
							? html`<div class="overlay-empty">Loading…</div>`
							: this.forkOptions.length === 0
								? html`<div class="overlay-empty">No fork points available.</div>`
								: this.forkOptions.map(
									(option) => html`
										<button class="fork-option" @click=${() => this.forkFrom(option.entryId)}>
											${truncate(option.text.replace(/\s+/g, " "), 140)}
										</button>
									`,
								)}
					</div>
				</div>
			</div>
		`;
	}

	private buildForkTimelineRows(source: UiMessage[]): ForkTimelineRow[] {
		const rows: ForkTimelineRow[] = [];
		let latestAssistantRow: ForkTimelineRow | null = null;
		for (let i = 0; i < source.length; i++) {
			const msg = source[i];
			if (!msg) continue;
			if (msg.role === "user") {
				rows.push({ main: msg, sourceIndex: i, thinkingSnippets: [], tools: [] });
				latestAssistantRow = null;
				continue;
			}
			if (msg.role !== "assistant") continue;

			const text = msg.text.trim();
			const thinking = (msg.thinking ?? "").trim();
			const tools = msg.toolCalls ?? [];
			if (text) {
				const row: ForkTimelineRow = {
					main: msg,
					sourceIndex: i,
					thinkingSnippets: thinking ? [thinking] : [],
					tools: [...tools],
				};
				rows.push(row);
				latestAssistantRow = row;
				continue;
			}

			if (!thinking && tools.length === 0) continue;
			if (!latestAssistantRow) {
				latestAssistantRow = {
					main: msg,
					sourceIndex: i,
					thinkingSnippets: [],
					tools: [],
				};
				rows.push(latestAssistantRow);
			}
			if (thinking) latestAssistantRow.thinkingSnippets.push(thinking);
			if (tools.length > 0) latestAssistantRow.tools.push(...tools);
		}
		return rows;
	}

	private forkRowKey(row: ForkTimelineRow): string {
		const base = row.main.sessionEntryId ?? row.main.id;
		return `${base}:${row.sourceIndex}`;
	}

	private toggleForkMessageExpanded(rowKey: string): void {
		if (this.forkExpandedMessageRows.has(rowKey)) {
			this.forkExpandedMessageRows.delete(rowKey);
		} else {
			this.forkExpandedMessageRows.add(rowKey);
		}
		this.render();
	}

	private toggleForkToolsExpanded(rowKey: string): void {
		if (this.forkExpandedToolRows.has(rowKey)) {
			this.forkExpandedToolRows.delete(rowKey);
		} else {
			this.forkExpandedToolRows.add(rowKey);
		}
		this.render();
	}

	private forkRowPreview(row: ForkTimelineRow): string {
		const normalized = this.messagePreview(row.main).replace(/\s+/g, " ").trim();
		if (normalized && normalized !== "(empty message)") return normalized;
		if (row.main.role === "assistant" && (row.thinkingSnippets.length > 0 || row.tools.length > 0)) {
			return "assistant activity";
		}
		return normalized || "(empty message)";
	}

	private resolveForkEntryId(messages: UiMessage[], index: number): string | null {
		const current = messages[index];
		if (!current) return null;
		if (current.role === "user") {
			return this.forkEntryIdByMessageId.get(current.id) ?? current.sessionEntryId ?? null;
		}
		for (let i = index; i >= 0; i--) {
			const candidate = messages[i];
			if (!candidate || candidate.role !== "user") continue;
			const entryId = this.forkEntryIdByMessageId.get(candidate.id) ?? candidate.sessionEntryId;
			if (entryId) return entryId;
		}
		return null;
	}

	private roleFromSessionEntry(roleRaw: string): UiRole {
		const normalized = roleRaw.trim().toLowerCase();
		if (normalized === "user") return "user";
		if (normalized === "assistant") return "assistant";
		if (normalized === "custom" || normalized === "custom_message") return "custom";
		return "system";
	}

	private mapSessionTreeEntry(
		record: Record<string, unknown>,
		index: number,
		labelsByTargetId: Map<string, string>,
	): SessionTreeEntryRecord | null {
		const type = typeof record.type === "string" ? record.type.trim() : "";
		if (!type || type === "session" || type === "label") return null;

		const id = typeof record.id === "string" ? record.id.trim() : "";
		if (!id) return null;

		const parentRaw = record.parentId;
		const parentId = typeof parentRaw === "string" && parentRaw.trim().length > 0 ? parentRaw.trim() : null;
		let role: UiRole = "system";
		let entryLabel = type.replace(/_/g, " ");
		let preview = "";
		let displayText = "";
		let canFork = false;

		switch (type) {
			case "message": {
				const message = record.message;
				const messageRecord = message && typeof message === "object" ? (message as Record<string, unknown>) : null;
				const messageRoleRaw = typeof messageRecord?.role === "string" ? messageRecord.role.trim() : "system";
				const messageRole = messageRoleRaw.toLowerCase();

				if (messageRole === "user") {
					role = "user";
					entryLabel = "user";
					preview = this.extractText(messageRecord?.content).replace(/\s+/g, " ").trim() || "(empty message)";
					displayText = `user: ${preview}`;
					canFork = true;
					break;
				}

				if (messageRole === "assistant") {
					role = "assistant";
					entryLabel = "assistant";
					const contentPreview = this.extractText(messageRecord?.content).replace(/\s+/g, " ").trim();
					const stopReason = pickString(messageRecord ?? {}, ["stopReason", "stop_reason"]) ?? "";
					const errorMessage = pickString(messageRecord ?? {}, ["errorMessage", "error_message"]) ?? "";
					preview = contentPreview || (stopReason === "aborted" ? "(aborted)" : errorMessage || "(no content)");
					displayText = `assistant: ${preview}`;
					break;
				}

				if (messageRole === "toolresult") {
					role = "system";
					entryLabel = "tool";
					const toolName = pickString(messageRecord ?? {}, ["toolName", "tool_name"]) ?? "tool";
					const toolOutputRaw = this.extractToolOutput(messageRecord?.content ?? messageRecord?.result ?? messageRecord ?? {});
					preview = toolOutputRaw.replace(/\s+/g, " ").trim() || "(no output)";
					displayText = `[${toolName}: ${truncate(preview, 120)}]`;
					break;
				}

				if (messageRole === "bashexecution") {
					role = "system";
					entryLabel = "bash";
					const command = pickString(messageRecord ?? {}, ["command"]) ?? "bash";
					preview = command;
					displayText = `[bash: ${truncate(command.replace(/\s+/g, " ").trim(), 120)}]`;
					break;
				}

				role = this.roleFromSessionEntry(messageRoleRaw);
				entryLabel = messageRoleRaw || "message";
				preview = this.extractText(messageRecord?.content).replace(/\s+/g, " ").trim() || `(${entryLabel})`;
				displayText = `[${entryLabel}]: ${preview}`;
				break;
			}
			case "custom_message": {
				role = "custom";
				const customType = pickString(record, ["customType", "custom_type"]) ?? "custom";
				entryLabel = customType;
				preview = this.extractText(record.content).replace(/\s+/g, " ").trim() || "(empty)";
				displayText = `[${customType}]: ${preview}`;
				break;
			}
			case "branch_summary": {
				role = "system";
				entryLabel = "branch summary";
				preview = (pickString(record, ["summary"]) ?? this.extractText(record.content)).replace(/\s+/g, " ").trim() || "(empty)";
				displayText = `[branch summary]: ${truncate(preview, 180)}`;
				break;
			}
			case "compaction": {
				role = "system";
				entryLabel = "compaction";
				const tokensBefore = pickNumber(record, ["tokensBefore", "tokens_before"]);
				preview = (pickString(record, ["summary"]) ?? "compaction entry").replace(/\s+/g, " ").trim();
				const tokensBadge = typeof tokensBefore === "number" && Number.isFinite(tokensBefore) ? `${Math.max(1, Math.round(tokensBefore / 1000))}k tokens` : "summary";
				displayText = `[compaction: ${tokensBadge}] ${truncate(preview, 160)}`;
				break;
			}
			case "thinking_level_change": {
				role = "system";
				entryLabel = "thinking";
				const level = pickString(record, ["thinkingLevel", "thinking_level"]) ?? "updated";
				preview = level;
				displayText = `[thinking: ${level}]`;
				break;
			}
			case "model_change": {
				role = "system";
				entryLabel = "model";
				const provider = pickString(record, ["provider"]) ?? "provider";
				const modelId = pickString(record, ["modelId", "model_id"]) ?? "model";
				preview = `${provider}/${modelId}`;
				displayText = `[model: ${preview}]`;
				break;
			}
			case "session_info": {
				role = "system";
				entryLabel = "title";
				preview = pickString(record, ["name"]) ?? "(untitled)";
				displayText = `[title: ${preview}]`;
				break;
			}
			case "custom": {
				role = "custom";
				const customType = pickString(record, ["customType", "custom_type"]) ?? "custom";
				entryLabel = customType;
				preview = this.extractText(record.data).replace(/\s+/g, " ").trim() || "custom entry";
				displayText = `[custom: ${customType}] ${truncate(preview, 140)}`;
				break;
			}
			default: {
				role = "system";
				preview = this.extractText(record.content).replace(/\s+/g, " ").trim() || entryLabel;
				displayText = `[${entryLabel}]: ${truncate(preview, 160)}`;
				break;
			}
		}

		const resolvedLabel = labelsByTargetId.get(id);
		if (resolvedLabel) {
			entryLabel = `${entryLabel} · ${resolvedLabel}`;
			displayText = `[${resolvedLabel}] ${displayText}`;
		}
		const normalizedPreview = preview.replace(/\s+/g, " ").trim();
		const normalizedDisplayText = displayText.replace(/\s+/g, " ").trim();

		return {
			id,
			parentId,
			type,
			index,
			role,
			entryLabel,
			preview: normalizedPreview || `(${entryLabel})`,
			displayText: normalizedDisplayText || `${entryLabel}: ${normalizedPreview || "(empty)"}`,
			canFork,
		};
	}

	private resolveCurrentTreeLeafId(entriesById: Map<string, SessionTreeEntryRecord>, entries: SessionTreeEntryRecord[]): string | null {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const entryId = this.messages[i]?.sessionEntryId;
			if (entryId && entriesById.has(entryId)) return entryId;
		}
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (!entry) continue;
			if (entriesById.has(entry.id)) return entry.id;
		}
		return null;
	}

	private compactTreeLinePrefix(prefix: string, depth: number): string {
		const normalized = prefix ?? "";
		if (!normalized) return "";
		const maxVisibleDepth = 14;
		if (depth <= maxVisibleDepth) return normalized;
		const charsPerLevel = 3;
		const tail = normalized.slice(Math.max(0, normalized.length - maxVisibleDepth * charsPerLevel));
		return `… ${tail}`;
	}

	private parseSessionTreeRows(sessionContent: string): HistoryTreeRow[] {
		const rawRecords: Array<{ record: Record<string, unknown>; index: number }> = [];
		const lines = sessionContent.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(trimmed);
			} catch {
				continue;
			}
			if (!parsed || typeof parsed !== "object") continue;
			rawRecords.push({
				record: parsed as Record<string, unknown>,
				index: rawRecords.length,
			});
		}

		if (rawRecords.length === 0) return [];

		const labelsByTargetId = new Map<string, string>();
		for (const { record } of rawRecords) {
			if (record.type !== "label") continue;
			const targetId = typeof record.targetId === "string" ? record.targetId.trim() : "";
			if (!targetId) continue;
			const label = typeof record.label === "string" ? record.label.trim() : "";
			if (!label) {
				labelsByTargetId.delete(targetId);
			} else {
				labelsByTargetId.set(targetId, label);
			}
		}

		const entries: SessionTreeEntryRecord[] = rawRecords
			.map(({ record, index }) => this.mapSessionTreeEntry(record, index, labelsByTargetId))
			.filter((entry): entry is SessionTreeEntryRecord => Boolean(entry));

		if (entries.length === 0) return [];

		const entriesById = new Map<string, SessionTreeEntryRecord>();
		for (const entry of entries) {
			entriesById.set(entry.id, entry);
		}

		const childrenByParent = new Map<string, SessionTreeEntryRecord[]>();
		const roots: SessionTreeEntryRecord[] = [];
		for (const entry of entries) {
			const parentId = entry.parentId && entriesById.has(entry.parentId) ? entry.parentId : null;
			if (!parentId) {
				roots.push(entry);
				continue;
			}
			const bucket = childrenByParent.get(parentId) ?? [];
			bucket.push(entry);
			childrenByParent.set(parentId, bucket);
		}
		const byIndex = (a: SessionTreeEntryRecord, b: SessionTreeEntryRecord): number => a.index - b.index;
		roots.sort(byIndex);
		for (const bucket of childrenByParent.values()) {
			bucket.sort(byIndex);
		}

		const currentLeafId = this.resolveCurrentTreeLeafId(entriesById, entries);
		const activePath = new Set<string>();
		let cursor = currentLeafId;
		while (cursor && entriesById.has(cursor)) {
			if (activePath.has(cursor)) break;
			activePath.add(cursor);
			const parentId = entriesById.get(cursor)?.parentId ?? null;
			cursor = parentId && entriesById.has(parentId) ? parentId : null;
		}

		const rows: HistoryTreeRow[] = [];
		const buildPrefix = (ancestorHasNext: boolean[], isLast: boolean, depth: number): string => {
			const parts: string[] = ancestorHasNext.map((hasNext) => (hasNext ? "│  " : "   "));
			if (depth > 0) {
				parts.push(isLast ? "└─ " : "├─ ");
			}
			return parts.join("");
		};
		const visit = (entry: SessionTreeEntryRecord, depth: number, ancestorHasNext: boolean[], isLast: boolean): void => {
			rows.push({
				entryId: entry.id,
				depth,
				role: entry.role,
				entryLabel: entry.entryLabel,
				preview: entry.preview,
				displayText: entry.displayText,
				linePrefix: buildPrefix(ancestorHasNext, isLast, depth),
				onActivePath: activePath.has(entry.id),
				canFork: entry.canFork,
			});
			const children = childrenByParent.get(entry.id) ?? [];
			const nextAncestorHasNext = [...ancestorHasNext, !isLast];
			for (let i = 0; i < children.length; i += 1) {
				const child = children[i];
				if (!child) continue;
				visit(child, depth + 1, nextAncestorHasNext, i === children.length - 1);
			}
		};
		for (let i = 0; i < roots.length; i += 1) {
			const root = roots[i];
			if (!root) continue;
			visit(root, 0, [], i === roots.length - 1);
		}
		return rows;
	}

	private async loadSessionTreeForHistory(): Promise<void> {
		if (this.historyViewerMode !== "browse" || !this.historyViewerOpen) return;
		const requestId = ++this.historyTreeRequestSeq;
		const sessionPath = this.state?.sessionFile?.trim();
		if (!sessionPath) {
			if (requestId !== this.historyTreeRequestSeq || this.historyViewerMode !== "browse") return;
			this.historyTreeRows = [];
			this.historyViewerLoading = false;
			this.render();
			return;
		}

		this.historyViewerLoading = true;
		this.render();
		try {
			const content = await rpcBridge.getSessionContent(sessionPath);
			if (requestId !== this.historyTreeRequestSeq || this.historyViewerMode !== "browse" || !this.historyViewerOpen) return;
			this.historyTreeRows = this.parseSessionTreeRows(content);
		} catch (err) {
			if (requestId !== this.historyTreeRequestSeq || this.historyViewerMode !== "browse" || !this.historyViewerOpen) return;
			console.error("Failed to load session tree:", err);
			this.historyTreeRows = [];
		} finally {
			if (requestId !== this.historyTreeRequestSeq || this.historyViewerMode !== "browse" || !this.historyViewerOpen) return;
			this.historyViewerLoading = false;
			this.render();
		}
	}

	private renderHistoryViewer(): TemplateResult | typeof nothing {
		if (!this.historyViewerOpen) return nothing;

		const forkMode = this.historyViewerMode === "fork";
		const query = this.historyQuery.trim().toLowerCase();
		const sourceMessages: UiMessage[] = this.messages;
		const sessionMessageIdByEntryId = new Map<string, string>();
		for (const message of this.messages) {
			if (!message.sessionEntryId) continue;
			if (sessionMessageIdByEntryId.has(message.sessionEntryId)) continue;
			sessionMessageIdByEntryId.set(message.sessionEntryId, message.id);
		}

		const filteredForkOptions: ForkOption[] = forkMode
			? this.forkOptions.filter((option) => {
				if (!query) return true;
				const haystack = option.text.toLowerCase();
				return haystack.includes(query);
			})
			: [];
		const useTreeRows = !forkMode && this.historyTreeRows.length > 0;
		const filteredTreeRows: HistoryTreeRow[] = forkMode
			? []
			: this.historyTreeRows.filter((row) => {
				if (this.historyRoleFilter !== "all" && row.role !== this.historyRoleFilter) return false;
				if (!query) return true;
				const haystack = `${row.role} ${row.entryLabel} ${row.preview} ${row.displayText} ${row.entryId}`.toLowerCase();
				return haystack.includes(query);
			});
		const filteredBrowseRows: Array<{ msg: UiMessage; sourceIndex: number }> = forkMode || useTreeRows
			? []
			: sourceMessages
				.map((msg, sourceIndex) => ({ msg, sourceIndex }))
				.filter(({ msg }) => {
					if (this.historyRoleFilter !== "all" && msg.role !== this.historyRoleFilter) return false;
					if (!query) return true;
					const haystack = `${msg.role} ${msg.label || ""} ${this.messagePreview(msg)}`.toLowerCase();
					return haystack.includes(query);
				});

		const hasNoRows = forkMode ? filteredForkOptions.length === 0 : useTreeRows ? filteredTreeRows.length === 0 : filteredBrowseRows.length === 0;

		return html`
			<div class="overlay" @click=${(e: Event) => e.target === e.currentTarget && this.closeHistoryViewer()}>
				<div class="overlay-card history-card ${forkMode ? "fork-mode" : ""}">
					<div class="overlay-header">
						<div>
							<div>${forkMode ? "Fork from message" : "Session tree"}</div>
							${forkMode
								? html`<div class="history-subtitle">${this.historyViewerSessionLabel || "Current session"}</div>`
								: nothing}
						</div>
						<button @click=${() => this.closeHistoryViewer()}>✕</button>
					</div>
					<div class="history-controls ${forkMode ? "fork" : ""}">
						<input
							type="text"
							placeholder=${forkMode ? "Search user messages" : "Search tree entries"}
							.value=${this.historyQuery}
							@input=${(e: Event) => {
								this.historyQuery = (e.target as HTMLInputElement).value;
								this.render();
							}}
						/>
						${forkMode
							? nothing
							: html`
								<select
									class="settings-select"
									.value=${this.historyRoleFilter}
									@change=${(e: Event) => {
										this.historyRoleFilter = (e.target as HTMLSelectElement).value as UiRole | "all";
										this.render();
									}}
								>
									<option value="all">all roles</option>
									<option value="user">user</option>
									<option value="assistant">assistant</option>
									<option value="system">system</option>
									<option value="custom">custom</option>
								</select>
							`}
					</div>
					<div class="overlay-body history-list ${forkMode ? "fork-history-list" : ""}">
						${this.historyViewerLoading
							? html`<div class="overlay-empty">Loading session history…</div>`
							: hasNoRows
								? html`<div class="overlay-empty">${forkMode ? "No messages available for forking." : "No session entries match your filters."}</div>`
								: forkMode
									? filteredForkOptions.map((option, idx) => {
											const preview = truncate(option.text.replace(/\s+/g, " ").trim(), 240);
											return html`
												<div class="history-item fork-user-row">
													<div class="history-item-main">
														<button class="history-jump" @click=${() => void this.forkFrom(option.entryId)} title="Fork from this user message">
															<div class="history-meta">
																<span class="history-role role-user">user</span>
																<span>#${idx + 1}</span>
															</div>
															<div class="history-preview">${preview}</div>
														</button>
														<button class="history-fork-btn" @click=${() => void this.forkFrom(option.entryId)} title="Fork from this user message">Fork</button>
													</div>
												</div>
											`;
									  })
									: useTreeRows
										? filteredTreeRows.map((row, idx) => {
												const visibleMessageId = sessionMessageIdByEntryId.get(row.entryId) ?? null;
												const canJump = Boolean(visibleMessageId);
												const title = canJump ? "Jump to this entry" : "Entry is outside the active branch";
												const compactPrefix = this.compactTreeLinePrefix(row.linePrefix, row.depth);
												const rowText = row.displayText.trim() || row.preview || "(entry)";
												const lineText = `${compactPrefix}${row.onActivePath ? "• " : "  "}${truncate(rowText, 320)}`;
												const lineBody = html`<span class="history-tree-line-mono role-${row.role}">${lineText}</span>`;
												return html`
													<div class="history-tree-line-row ${row.onActivePath ? "on-path" : "off-path"}">
														${canJump && visibleMessageId
															? html`<button class="history-tree-line ${row.onActivePath ? "on-path" : ""}" @click=${() => this.revealMessage(visibleMessageId)} title=${title}>${lineBody}</button>`
															: html`<div class="history-tree-line static" title=${title}>${lineBody}</div>`}
														<div class="history-tree-line-actions">
															<span class="history-tree-index">#${idx + 1}</span>
															${row.canFork
																? html`<button class="history-fork-btn" @click=${() => void this.forkFrom(row.entryId)} title="Fork from this user message">Fork</button>`
																: nothing}
														</div>
													</div>
												`;
									  })
										: filteredBrowseRows.map(({ msg, sourceIndex }, idx: number) => {
												const forkEntryId = this.resolveForkEntryId(sourceMessages, sourceIndex);
												const canFork = Boolean(forkEntryId) && (msg.role === "user" || msg.role === "assistant");
												return html`
													<div class="history-item">
														<div class="history-item-main">
															<button class="history-jump" @click=${() => this.revealMessage(msg.id)}>
																<div class="history-meta">
																	<span class="history-role role-${msg.role}">${msg.role}</span>
																	<span>#${idx + 1}</span>
																</div>
																<div class="history-preview">${truncate(this.messagePreview(msg).replace(/\s+/g, " "), 200)}</div>
															</button>
															${canFork && forkEntryId
																? html`<button class="history-fork-btn" @click=${() => void this.forkFrom(forkEntryId)} title=${msg.role === "assistant" ? "Fork from preceding user message" : "Fork from this user message"}>Fork</button>`
																: nothing}
														</div>
													</div>
												`;
									  })}
					</div>
				</div>
			</div>
		`;
	}

	private doRender(): void {
		const hasProject = Boolean(this.projectPath);
		if (!hasProject && !this.welcomeHeadlineTimer) {
			this.welcomeHeadlineTimer = setInterval(() => {
				if (this.projectPath || this.welcomeProjectMenuOpen) return;
				this.welcomeHeadlineIndex = (this.welcomeHeadlineIndex + 1) % this.welcomeHeadlines.length;
				this.render();
			}, 10000);
		} else if (hasProject && this.welcomeHeadlineTimer) {
			clearInterval(this.welcomeHeadlineTimer);
			this.welcomeHeadlineTimer = null;
		}
		const hasMessages = this.messages.length > 0;
		const showWorkingIndicator = hasProject && this.shouldShowWorkingIndicator();
		if (!hasProject && !this.welcomeDashboard.loading && this.welcomeDashboard.updatedAt === 0) {
			void this.refreshWelcomeDashboard();
		}

		const template = html`
			<div
				class="chat-root ${hasProject ? "" : "no-project"}"
				@click=${(e: Event) => {
					const target = e.target as HTMLElement;
					let changed = false;

					if (this.slashPaletteOpen && !target.closest(".composer-slash-menu") && !target.closest("#chat-input")) {
						this.closeSlashPalette();
						changed = true;
					}

					if (this.gitMenuOpen && !target.closest(".git-branch-wrap")) {
						this.gitMenuOpen = false;
						this.gitBranchQuery = "";
						changed = true;
					}

					if (this.welcomeProjectMenuOpen && !target.closest(".welcome-project-wrap")) {
						this.welcomeProjectMenuOpen = false;
						changed = true;
					}

					if (changed) this.render();
				}}
				@dragover=${(e: DragEvent) => {
					e.preventDefault();
					if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
				}}
				@drop=${(e: DragEvent) => {
					e.preventDefault();
					if (!hasProject) return;
					this.handleDroppedDataTransfer(e.dataTransfer ?? null);
				}}
			>
				<div class="chat-scroll ${hasProject ? "" : "welcome-scroll"}" id="chat-scroll" @scroll=${(e: Event) => this.handleChatScroll(e)}>
					${!hasProject
						? this.renderWelcomeDashboard()
						: hasMessages
							? html`${this.renderMessageTimeline()}`
							: this.bindingStatusText
								? this.renderBindingState()
								: this.renderEmptyState()}
					${showWorkingIndicator ? this.renderWorkingIndicatorRow() : nothing}
				</div>
				${hasProject ? this.renderComposer() : nothing}
				${hasProject ? this.renderForkPicker() : nothing}
				${hasProject ? this.renderHistoryViewer() : nothing}
				${hasProject ? this.renderJumpToLatest() : nothing}
				${this.renderNotices()}
			</div>
		`;

		render(template, this.container);
		this.scrollContainer = this.container.querySelector("#chat-scroll");
		this.updateComposerOffset();
	}

	render(): void {
		this.doRender();
		if (this.projectPath) {
			this.scrollToBottom();
		}
		this.syncWorkingStatusAnimation();
		this.ensureActiveSlashItemVisible();
	}

	notify(text: string, kind: "info" | "success" | "error" = "info"): void {
		this.pushNotice(text, kind);
	}

	getDebugInfo(): {
		projectPath: string | null;
		isConnected: boolean;
		loadingModels: boolean;
		availableModelCount: number;
		messageCount: number;
		backendSessionFile: string | null;
		lastBackendRefreshError: string | null;
		lastModelLoadError: string | null;
	} {
		return {
			projectPath: this.projectPath,
			isConnected: this.isConnected,
			loadingModels: this.loadingModels,
			availableModelCount: this.availableModels.length,
			messageCount: this.messages.length,
			backendSessionFile: this.lastBackendSessionFile,
			lastBackendRefreshError: this.lastBackendRefreshError,
			lastModelLoadError: this.lastModelLoadError,
		};
	}

	focusInput(): void {
		const ta = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
		ta?.focus();
	}
}
