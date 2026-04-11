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
import {
	createSlashPaletteItems,
	filterSlashPaletteItemsByQuery,
	findSlashPaletteItemByName,
	getSlashQueryFromInput,
	normalizeRuntimeSlashCommands,
	parseSlashInputText,
	type RuntimeSlashCommand,
	type SlashCommandSource,
	type SlashPaletteItem,
} from "../commands/slash-command-runtime.js";
import {
	formatModelDisplayName,
	parseListModelsCatalog,
	type ModelOption,
} from "../models/model-options.js";
import {
	buildModelPickerProviderGroups,
	resolveActiveModelPickerProvider,
} from "../models/model-picker-provider-groups.js";
import {
	resolveModelCandidateFromArg,
	resolvePreferredModelPickerProvider,
	resolveProviderHintFromModelArg,
} from "../models/model-selection.js";
import { isExtensionConfigIntent, normalizeExtensionCommandName } from "../extensions/extension-command-intent.js";
import { renderComposerControlsView } from "./chat-view/composer-controls-view.js";
import {
	renderComposerSkillDraftPillView,
	renderPendingFileReferencesView,
	renderPendingImagesView,
	renderQueuedComposerMessagesView,
} from "./chat-view/composer-fragments-view.js";
import {
	handleComposerDragLeaveEvent,
	handleComposerDragOverEvent,
	handleComposerDropEvent,
	handleComposerFilePickerChangeEvent,
	handleComposerInputEvent,
	handleComposerKeyDownEvent,
	handleComposerPasteEvent,
} from "./chat-view/composer-input-events.js";
import { renderSlashPaletteView } from "./chat-view/composer-slash-palette-view.js";
import { renderComposerStatsView } from "./chat-view/composer-stats-view.js";
import { deriveForkSessionName, buildForkEntryIdByMessageId, resolveForkEntryId } from "./chat-view/history-fork-utils.js";
import { compactTreeLinePrefix, parseSessionTreeRows } from "./chat-view/history-tree-utils.js";
import { renderHistoryViewerView } from "./chat-view/history-viewer-view.js";
import type { ForkOption, HistoryTreeRow, HistoryViewerRole } from "./chat-view/history-viewer-types.js";
import { loadWelcomeDashboardInventory } from "./chat-view/welcome-dashboard-data.js";
import { renderCenteredWelcomeView } from "./chat-view/welcome-dashboard-view.js";
import { renderAssistantWorkflowView } from "./chat-view/assistant-workflow-view.js";
import { mapBackendMessages as mapBackendMessagesView } from "./chat-view/backend-message-mapper.js";
import {
	handleCompactionAndRetryEvent,
	handleMessageStreamEvent,
} from "./chat-view/event-stream-handlers.js";
import { handleRuntimeStatusEvent } from "./chat-view/event-runtime-status-handlers.js";
import {
	createAndCheckoutBranchAction,
	fetchGitRemotesAction,
	switchGitBranchAction,
	switchRemoteTrackingBranchAction,
} from "./chat-view/git-branch-actions.js";
import {
	extractAssistantPartialContent as extractAssistantPartialContentValue,
	extractImagesFromContent,
	extractTextContent,
	extractToolOutputText,
	mergeStreamingText as mergeStreamingTextValue,
} from "./chat-view/message-content-utils.js";
import { renderGitRepoControlView } from "./chat-view/git-repo-control-view.js";
import {
	clearActiveDraggedFilePaths,
	peekActiveDraggedFilePaths,
} from "./file-drag-transfer.js";
import {
	createDropSignature,
	extractFilePathsFromDropPayload as extractFilePathsFromDropPayloadValue,
	fileNameFromPath as fileNameFromPathValue,
	isImageFile as isImageFileValue,
	isImageName as isImageNameValue,
	mimeFromFileName as mimeFromFileNameValue,
	toBase64Bytes,
} from "./chat-view/image-file-utils.js";
import { mapAvailableModelsFromRpc } from "./chat-view/models-load-utils.js";
import {
	computeSessionStatsFallback,
	computeSessionStatsFromRaw,
} from "./chat-view/session-stats-refresh.js";
import { sendMessageFlow } from "./chat-view/send-message-flow.js";
import { deriveLatestAssistantContextTokens as deriveLatestAssistantContextTokensFromMessages } from "./chat-view/session-stats-utils.js";
import {
	renderAssistantMessageRow,
	renderChangelogMessageRow,
	renderCompactionCycleRow,
	renderMessageTimelineRows,
	renderSystemMessageRow,
} from "./chat-view/message-timeline-view.js";
import {
	executeBuiltinSlashCommand as executeBuiltinSlashCommandView,
	formatSessionInfoBlock as formatSessionInfoBlockView,
} from "./chat-view/slash-builtin-command.js";
import {
	collectAssistantWorkflow,
	isStandaloneCodeBlockMarkdown,
	normalizeThinkingText,
	resolveWorkflowExpansionState,
	summarizeToolCall,
	type AssistantWorkflow,
	type AssistantWorkflowCandidate,
} from "./chat-view/workflow-utils.js";
import {
	displayProviderLabel as displayProviderLabelFromCatalog,
	isOAuthProviderId as isOAuthProviderIdInCatalog,
	normalizeAuthProviderArg as normalizeAuthProviderArgValue,
	normalizeConfiguredProviderAuth as normalizeConfiguredProviderAuthEntries,
	normalizeOAuthProviderCatalog as normalizeOAuthProviderCatalogEntries,
	normalizeProviderKey as normalizeProviderKeyValue,
	resolveProviderSetupCommand as resolveProviderSetupCommandForProvider,
	unwrapQuotedValue as unwrapQuotedArgValue,
	type OAuthProviderCatalogEntry,
} from "../auth/provider-auth.js";

type DeliveryMode = "prompt" | "steer" | "followUp";

type UiRole = HistoryViewerRole;

interface PendingImage {
	id: string;
	name: string;
	path?: string;
	mimeType: string;
	data: string;
	previewUrl: string;
	size: number;
	token?: string;
	insertAt?: number;
}

interface PendingFileReference {
	id: string;
	name: string;
	path: string;
	token: string;
	insertAt?: number;
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

const MODEL_PICKER_AUTH_CACHE_MS = 15_000;
const MODEL_PICKER_CATALOG_CACHE_MS = 60_000;

function uid(prefix = "id"): string {
	return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function truncate(value: string, len: number): string {
	if (value.length <= len) return value;
	return `${value.slice(0, len - 1)}…`;
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
	private onOpenTerminal: ((command?: string) => void | Promise<void>) | null = null;
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
	private oauthProviderCatalogLoadedAt = 0;
	private oauthProviderCatalogLoading = false;
	private oauthProviderCatalog = new Map<string, OAuthProviderCatalogEntry>();
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
	private pendingFileReferences: PendingFileReference[] = [];
	private pendingAttachmentInsertIndex: number | null = null;
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
	private forkOptions: ForkOption[] = [];
	private historyViewerOpen = false;
	private historyViewerMode: "browse" | "fork" = "browse";
	private historyViewerLoading = false;
	private historyViewerSessionLabel = "";
	private historyTreeRows: HistoryTreeRow[] = [];
	private historyTreeRequestSeq = 0;
	private forkEntryIdByMessageId = new Map<string, string>();
	private forkTargetsRequestSeq = 0;
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

	setOnOpenTerminal(cb: (command?: string) => void | Promise<void>): void {
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

	private resetSessionUiTransientState(): void {
		this.modelPickerOpen = false;
		this.selectedSkillDraft = null;
		this.pendingFileReferences = [];
		this.pendingAttachmentInsertIndex = null;
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
		this.keepWorkflowExpandedUntilAssistantText = false;
	}

	private resetRunActivityState(): void {
		this.runHasAssistantText = false;
		this.runSawToolActivity = false;
		this.clearWorkingStatusTimer(true);
	}

	private markAssistantTextObserved(): void {
		this.runHasAssistantText = true;
		if (this.runSawToolActivity) {
			this.keepWorkflowExpandedUntilAssistantText = false;
		}
	}

	private markToolActivityObserved(): void {
		this.runSawToolActivity = true;
		this.keepWorkflowExpandedUntilAssistantText = true;
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
		this.resetSessionUiTransientState();
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
			this.resetRunActivityState();
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
		this.resetSessionUiTransientState();
		this.providerAuthForcedLoggedOut.clear();
		this.resetRunActivityState();
		this.bindingStatusText = projectPath ? (statusText ?? "Loading session…") : null;
		this.render();
	}

	getState(): RpcSessionState | null {
		return this.state;
	}

	private getComposerTextarea(): HTMLTextAreaElement | null {
		return this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
	}

	private clampComposerInsertIndex(index: number | null | undefined): number {
		const max = this.inputText.length;
		if (typeof index !== "number" || !Number.isFinite(index)) return max;
		return Math.max(0, Math.min(max, Math.floor(index)));
	}

	private getComposerInsertIndex(): number {
		const textarea = this.getComposerTextarea();
		if (!textarea) return this.inputText.length;
		const selectionStart = typeof textarea.selectionStart === "number" ? textarea.selectionStart : this.inputText.length;
		return this.clampComposerInsertIndex(selectionStart);
	}

	private consumePendingAttachmentInsertIndex(): number {
		const pending = this.pendingAttachmentInsertIndex;
		this.pendingAttachmentInsertIndex = null;
		if (typeof pending === "number" && Number.isFinite(pending)) {
			return this.clampComposerInsertIndex(pending);
		}
		return this.getComposerInsertIndex();
	}

	private clearComposerDropUiState(): void {
		const textarea = this.getComposerTextarea();
		textarea?.classList.remove("is-drop-hover");
		document.documentElement.classList.remove("sidebar-file-drag-active");
	}

	private syncComposerTextarea(
		text: string,
		options: { maxHeight?: number; focus?: boolean; moveCaretToEnd?: boolean } = {},
	): void {
		const textarea = this.getComposerTextarea();
		if (!textarea) return;
		textarea.value = text;
		textarea.style.height = "auto";
		if (typeof options.maxHeight === "number" && options.maxHeight > 0) {
			textarea.style.height = `${Math.min(textarea.scrollHeight, options.maxHeight)}px`;
		}
		if (options.moveCaretToEnd) {
			const end = text.length;
			textarea.setSelectionRange(end, end);
		}
		if (options.focus) textarea.focus();
	}

	private syncComposerTextareaDeferred(
		text: string,
		options: { maxHeight?: number; focus?: boolean; moveCaretToEnd?: boolean } = {},
	): void {
		requestAnimationFrame(() => this.syncComposerTextarea(text, options));
	}

	setInputText(text: string): void {
		this.inputText = text;
		this.resetComposerHistoryNavigation();
		this.updateSlashPaletteStateFromInput();
		this.render();
		this.syncComposerTextareaDeferred(text, { maxHeight: 200, focus: true });
	}

	stageComposerCommand(commandText: string): void {
		const draft = this.parseComposerSkillDraftFromCommand(commandText);
		if (draft) {
			this.selectedSkillDraft = draft;
			this.inputText = "";
			this.resetComposerHistoryNavigation();
			this.updateSlashPaletteStateFromInput();
			this.render();
			this.syncComposerTextareaDeferred(this.inputText, { focus: true });
			return;
		}
		this.selectedSkillDraft = null;
		this.inputText = commandText;
		this.resetComposerHistoryNavigation();
		this.closeSlashPalette();
		this.render();
		this.syncComposerTextareaDeferred(commandText, { maxHeight: 200, focus: true });
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
		this.syncComposerTextareaDeferred(this.inputText, { focus: true });
	}

	private slashQueryFromInput(): string | null {
		return getSlashQueryFromInput(this.inputText);
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
		return parseSlashInputText(value);
	}

	private async ensureSlashCommandsLoaded(force = false): Promise<void> {
		if (this.slashCommandsLoading) return;
		if (!force && this.slashRuntimeCommands.length > 0 && Date.now() - this.slashCommandsUpdatedAt < 15_000) return;
		this.slashCommandsLoading = true;
		if (this.slashPaletteOpen) this.render();
		try {
			const runtimeCommands = await rpcBridge.getCommands().catch(() => []);
			this.slashRuntimeCommands = normalizeRuntimeSlashCommands(runtimeCommands as Array<Record<string, unknown>>);
			this.slashCommandsUpdatedAt = Date.now();
		} catch {
			this.slashRuntimeCommands = this.slashRuntimeCommands.slice();
			this.slashCommandsUpdatedAt = Date.now();
		} finally {
			this.slashCommandsLoading = false;
			if (this.slashPaletteOpen) this.render();
		}
	}

	private buildAllSlashPaletteItems(): SlashPaletteItem[] {
		return createSlashPaletteItems(this.slashRuntimeCommands);
	}

	private getSlashPaletteItems(): SlashPaletteItem[] {
		if (!this.slashPaletteOpen) return [];
		return filterSlashPaletteItemsByQuery(this.buildAllSlashPaletteItems(), this.slashPaletteQuery);
	}

	private findSlashPaletteItemByName(commandName: string): SlashPaletteItem | null {
		return findSlashPaletteItemByName(this.buildAllSlashPaletteItems(), commandName);
	}

	private unwrapQuotedArg(value: string): string {
		return unwrapQuotedArgValue(value);
	}

	private normalizedAuthProviderArg(rawArgs: string): string {
		return normalizeAuthProviderArgValue(rawArgs);
	}

	private providerKey(provider: string): string {
		return normalizeProviderKeyValue(provider);
	}

	private isOAuthProviderId(provider: string): boolean {
		return isOAuthProviderIdInCatalog(provider, this.oauthProviderCatalog);
	}

	private displayProviderLabel(provider: string): string {
		return displayProviderLabelFromCatalog(provider, this.oauthProviderCatalog);
	}

	private async loadOAuthProviderCatalog(force = false): Promise<void> {
		if (this.oauthProviderCatalogLoading) return;
		const stale = Date.now() - this.oauthProviderCatalogLoadedAt > MODEL_PICKER_AUTH_CACHE_MS;
		if (!force && this.oauthProviderCatalogLoadedAt > 0 && !stale) return;
		this.oauthProviderCatalogLoading = true;
		try {
			const raw = await rpcBridge.getPiOAuthProviders();
			this.oauthProviderCatalog = normalizeOAuthProviderCatalogEntries(raw);
			this.oauthProviderCatalogLoadedAt = Date.now();
		} catch (err) {
			console.error("Failed to load OAuth provider catalog:", err);
			if (this.oauthProviderCatalogLoadedAt === 0) {
				this.oauthProviderCatalog = normalizeOAuthProviderCatalogEntries([]);
			}
		} finally {
			this.oauthProviderCatalogLoading = false;
			this.render();
		}
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
			const next = normalizeConfiguredProviderAuthEntries(raw?.configured_providers);
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
		return resolveProviderSetupCommandForProvider(provider, this.slashRuntimeCommands);
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
		const providerLabel = this.displayProviderLabel(providerKey);

		try {
			if (action === "login") {
				if (!this.isOAuthProviderId(providerKey)) {
					await this.loadOAuthProviderCatalog(true);
				}
				if (this.isOAuthProviderId(providerKey)) {
					const loginCommand = `pi login ${providerKey}`;
					if (this.onOpenTerminal) {
						await this.onOpenTerminal(loginCommand);
						this.pushNotice(`Opened terminal and started /login for ${providerLabel}.`, "info");
						return;
					}
					this.pushNotice(`Open terminal and run: ${loginCommand}`, "info");
					return;
				}
				const openedPackageConfig = await this.openProviderSetup(providerKey);
				if (openedPackageConfig) {
					this.pushNotice(`Opened ${providerLabel} setup`, "info");
					return;
				}
				if (this.onOpenSettings) {
					this.onOpenSettings("account");
				}
				this.appendSystemMessage(
					`Open setup for **${providerLabel}** in Packages. If this provider supports OAuth, use \`pi\` in terminal and run \`/login\` to authorize.`,
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
				this.loadOAuthProviderCatalog(true),
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
		if (this.pendingImages.length > 0 || this.pendingFileReferences.length > 0) {
			this.pushNotice("Slash commands cannot be sent with pending attachments", "info");
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
			const adhocRuntimeItem: SlashPaletteItem = {
				id: `adhoc:${parsed.commandName}`,
				section: "Commands",
				label: `/${parsed.commandName}`,
				hint: "Run runtime slash command",
				commandName: parsed.commandName,
				source: "other",
			};
			await this.runSlashCommand(parsed.commandText, adhocRuntimeItem, parsed.args);
			return;
		}
		this.pushNotice("Select a slash command from the menu", "info");
	}

	async runSlashCommandText(commandText: string): Promise<boolean> {
		const parsed = this.parseSlashInput(commandText);
		if (!parsed) return false;
		await this.ensureSlashCommandsLoaded();
		const exact = this.findSlashPaletteItemByName(parsed.commandName);
		if (exact) {
			await this.runSlashCommand(parsed.commandText, exact, parsed.args);
			return true;
		}
		const fallbackItem: SlashPaletteItem = {
			id: `adhoc:${parsed.commandName}`,
			section: "Commands",
			label: `/${parsed.commandName}`,
			hint: "Run runtime slash command",
			commandName: parsed.commandName,
			source: "other",
		};
		await this.runSlashCommand(parsed.commandText, fallbackItem, parsed.args);
		return true;
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
		source: Exclude<SlashCommandSource, "builtin">,
		commandName: string,
		args: string,
	): Promise<void> {
		if (source === "extension" && this.onOpenExtensionConfig) {
			const normalizedName = normalizeExtensionCommandName(commandName);
			if (isExtensionConfigIntent(normalizedName, args)) {
				const handled = await this.onOpenExtensionConfig(normalizedName, args);
				if (handled) return;
			}
		}
		const options = this.currentIsStreaming() ? { streamingBehavior: "steer" as const } : {};
		await rpcBridge.prompt(commandText, options);
		this.onPromptSubmitted?.();
	}

	private ensureModelPickerDataLoaded(): void {
		if (!this.loadingModels && this.availableModels.length === 0) {
			void this.loadAvailableModels();
		}
		if (!this.loadingProviderAuth) {
			void this.loadProviderAuthStatus();
		}
		if (!this.oauthProviderCatalogLoading) {
			void this.loadOAuthProviderCatalog();
		}
		if (!this.loadingModelCatalog && this.modelCatalog.length === 0) {
			void this.loadModelCatalog();
		}
	}

	private setModelPickerActiveProvider(provider: string): void {
		const normalized = normalizeText(provider);
		if (!normalized || this.modelPickerActiveProvider === normalized) return;
		this.modelPickerActiveProvider = normalized;
		this.render();
	}

	private closeModelPicker(options: { focusComposer?: boolean } = {}): void {
		if (!this.modelPickerOpen) return;
		this.modelPickerOpen = false;
		this.render();
		if (options.focusComposer) {
			requestAnimationFrame(() => this.focusInput());
		}
	}

	private openModelPicker(options: { preferredProvider?: string } = {}): void {
		this.ensureModelPickerDataLoaded();
		const providerPool = [...this.availableModels, ...this.modelCatalog];
		const preferred = resolvePreferredModelPickerProvider(normalizeText(options.preferredProvider), providerPool);
		if (preferred) {
			this.modelPickerActiveProvider = preferred;
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

	private toggleModelPicker(preferredProvider = ""): void {
		if (this.modelPickerOpen) {
			this.closeModelPicker();
			return;
		}
		this.openModelPicker({ preferredProvider });
	}

	private resolveProviderHintFromModelArg(rawArg: string): string | null {
		return resolveProviderHintFromModelArg(rawArg, [...this.availableModels, ...this.modelCatalog]);
	}

	private resolveModelCandidateFromArg(rawArg: string): ModelOption | null {
		return resolveModelCandidateFromArg(rawArg, this.availableModels);
	}

	private async executeBuiltinSlashCommand(commandName: string, args: string): Promise<void> {
		await executeBuiltinSlashCommandView({
			commandName,
			args,
			availableModelsCount: this.availableModels.length,
			onOpenSettings: this.onOpenSettings,
			pushNotice: this.pushNotice.bind(this),
			truncate,
			openModelPicker: this.openModelPicker.bind(this),
			loadAvailableModels: this.loadAvailableModels.bind(this),
			resolveModelCandidateFromArg: this.resolveModelCandidateFromArg.bind(this),
			resolveProviderHintFromModelArg: this.resolveProviderHintFromModelArg.bind(this),
			setModel: this.setModel.bind(this),
			unwrapQuotedArg: this.unwrapQuotedArg.bind(this),
			pickSessionExportPathFromDialog: this.pickSessionExportPathFromDialog.bind(this),
			pickSessionImportPathFromDialog: this.pickSessionImportPathFromDialog.bind(this),
			refreshFromBackend: this.refreshFromBackend.bind(this),
			shareAsGist: this.shareAsGist.bind(this),
			copyLastMessage: this.copyLastMessage.bind(this),
			onBeginRenameCurrentSession: this.onBeginRenameCurrentSession,
			renameSession: this.renameSession.bind(this),
			renameSessionTo: this.renameSessionTo.bind(this),
			refreshSessionStats: this.refreshSessionStats.bind(this),
			buildSessionInfoBlock: () =>
				formatSessionInfoBlockView({
					state: this.state,
					sessionStats: this.sessionStats,
					messages: this.messages,
				}),
			appendSystemMessage: this.appendSystemMessage.bind(this),
			loadPiAgentChangelogMarkdown: this.loadPiAgentChangelogMarkdown.bind(this),
			extractLatestChangelogSections: this.extractLatestChangelogSections.bind(this),
			onOpenShortcuts: this.onOpenShortcuts,
			onOpenTerminal: this.onOpenTerminal,
			sessionName: this.state?.sessionName ?? null,
			openHistoryViewerForFork: this.openHistoryViewerForFork.bind(this),
			openHistoryViewer: this.openHistoryViewer.bind(this),
			normalizedAuthProviderArg: this.normalizedAuthProviderArg.bind(this),
			handleProviderAuthAction: this.handleProviderAuthAction.bind(this),
			onCreateFreshSession: this.onCreateFreshSession,
			newSession: this.newSession.bind(this),
			compactNow: this.compactNow.bind(this),
			onOpenSessionBrowser: this.onOpenSessionBrowser,
			onReloadRuntime: this.onReloadRuntime,
			ensureSlashCommandsLoaded: this.ensureSlashCommandsLoaded.bind(this),
			loadProviderAuthStatus: this.loadProviderAuthStatus.bind(this),
			loadOAuthProviderCatalog: this.loadOAuthProviderCatalog.bind(this),
			loadModelCatalog: this.loadModelCatalog.bind(this),
			onQuitApp: this.onQuitApp,
		});
	}

	private previewSlashPaletteItem(item: SlashPaletteItem): void {
		const parsed = this.parseSlashInput(this.inputText);
		const args = parsed && parsed.commandName === item.commandName ? parsed.args : "";
		const commandText = `/${item.commandName}${args ? ` ${args}` : ""}`;
		if (this.inputText === commandText) return;
		this.inputText = commandText;
		this.syncComposerTextareaDeferred(commandText, {
			maxHeight: 220,
			moveCaretToEnd: true,
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
			this.clearComposerDropUiState();

			const nativePaths = Array.isArray(payload.paths) ? payload.paths : [];
			const insertionIndex = this.getComposerInsertIndex();
			if (this.handleDroppedPathCandidates(nativePaths, { quietImageReadFailure: true, insertionIndex })) {
				if (nativePaths.length > 0) {
					clearActiveDraggedFilePaths();
				}
				return;
			}

			const sidebarFallbackPaths = peekActiveDraggedFilePaths();
			if (sidebarFallbackPaths.length > 0) {
				const handledFromSidebarFallback = this.handleDroppedPathCandidates(sidebarFallbackPaths, {
					quietImageReadFailure: true,
					insertionIndex,
				});
				clearActiveDraggedFilePaths();
				if (handledFromSidebarFallback) return;
			}

			if (nativePaths.length > 0) {
				this.pushNotice("No readable files found in drop payload", "info");
			}
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
		this.closeModelPicker();
	};

	private onGlobalEscapeForModelPicker = (event: KeyboardEvent): void => {
		if (!this.modelPickerOpen || event.key !== "Escape") return;
		event.preventDefault();
		this.closeModelPicker();
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
		void this.loadOAuthProviderCatalog();
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
			if (!this.oauthProviderCatalogLoading && this.oauthProviderCatalogLoadedAt === 0) {
				void this.loadOAuthProviderCatalog();
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
			this.loadOAuthProviderCatalog(true),
			this.loadModelCatalog(true),
		]);
	}

	private mapBackendMessages(backendMessages: Array<Record<string, unknown>>): UiMessage[] {
		return mapBackendMessagesView({
			backendMessages,
			allThinkingExpanded: this.allThinkingExpanded,
			createId: uid,
			extractText: this.extractText.bind(this),
			extractImages: this.extractImages.bind(this),
			extractToolOutput: this.extractToolOutput.bind(this),
		}) as UiMessage[];
	}

	private extractText(content: unknown): string {
		return extractTextContent(content);
	}

	private extractToolOutput(payload: unknown, depth = 0): string {
		return extractToolOutputText(payload, depth);
	}

	private mergeStreamingText(current: string, partial: string | null, deltaCandidate: unknown): string {
		return mergeStreamingTextValue(current, partial, deltaCandidate);
	}

	private extractImages(content: unknown): PendingImage[] {
		return extractImagesFromContent(content, uid) as PendingImage[];
	}

	private extractAssistantPartialContent(assistantEvent: Record<string, unknown>, mode: "text" | "thinking"): string | null {
		return extractAssistantPartialContentValue(assistantEvent, mode);
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
			const mapped = mapAvailableModelsFromRpc(models);
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
		return deriveLatestAssistantContextTokensFromMessages(messages);
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
		const stateMessageCount = this.state?.messageCount ?? 0;
		const statePendingCount = this.state?.pendingMessageCount ?? 0;
		try {
			const raw = (await rpcBridge.getSessionStats()) as Record<string, unknown>;
			this.sessionStats = computeSessionStatsFromRaw({
				raw,
				stateMessageCount,
				statePendingCount,
				lastAssistantContextTokens: this.lastAssistantContextTokens,
				resolveContextWindow: (inputRaw) => this.resolveContextWindow(inputRaw),
				normalizeUsageRatio: (value) => this.normalizeUsageRatio(value),
			});
		} catch {
			this.sessionStats = computeSessionStatsFallback({
				stateMessageCount,
				statePendingCount,
				previous: this.sessionStats,
				resolveContextWindow: (inputRaw) => this.resolveContextWindow(inputRaw),
			});
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
		await switchRemoteTrackingBranchAction({
			entry,
			branches: this.gitSummary.branches,
			switchGitBranch: this.switchGitBranch.bind(this),
			isSwitchingGitBranch: () => this.switchingGitBranch,
			setSwitchingGitBranch: (next) => {
				this.switchingGitBranch = next;
			},
			render: this.render.bind(this),
			closeGitMenu: () => {
				this.gitMenuOpen = false;
				this.gitBranchQuery = "";
			},
			pushNotice: this.pushNotice.bind(this),
			runGit: this.runGit.bind(this),
			hasGitHeadCommit: this.hasGitHeadCommit.bind(this),
			switchUnbornHeadBranch: this.switchUnbornHeadBranch.bind(this),
			refreshGitSummary: this.refreshGitSummary.bind(this),
		});
	}

	private async fetchGitRemotes(): Promise<void> {
		await fetchGitRemotesAction({
			isRepo: this.gitSummary.isRepo,
			fetchingGitRemotes: this.fetchingGitRemotes,
			isSwitchingGitBranch: () => this.switchingGitBranch,
			setFetchingGitRemotes: (next) => {
				this.fetchingGitRemotes = next;
			},
			render: this.render.bind(this),
			pushNotice: this.pushNotice.bind(this),
			runGit: this.runGit.bind(this),
			refreshGitSummary: this.refreshGitSummary.bind(this),
		});
	}

	private async switchGitBranch(branch: string): Promise<void> {
		await switchGitBranchAction({
			branch,
			currentBranch: this.gitSummary.branch || "",
			isSwitchingGitBranch: () => this.switchingGitBranch,
			setSwitchingGitBranch: (next) => {
				this.switchingGitBranch = next;
			},
			render: this.render.bind(this),
			closeGitMenu: () => {
				this.gitMenuOpen = false;
				this.gitBranchQuery = "";
			},
			pushNotice: this.pushNotice.bind(this),
			runGit: this.runGit.bind(this),
			hasGitHeadCommit: this.hasGitHeadCommit.bind(this),
			switchUnbornHeadBranch: this.switchUnbornHeadBranch.bind(this),
			refreshGitSummary: this.refreshGitSummary.bind(this),
		});
	}

	private async createAndCheckoutBranch(rawName = ""): Promise<void> {
		await createAndCheckoutBranchAction({
			rawName,
			gitBranchQuery: this.gitBranchQuery,
			resolveGitBranchSelection: this.resolveGitBranchSelection.bind(this),
			switchGitBranchEntry: this.switchGitBranchEntry.bind(this),
			isSwitchingGitBranch: () => this.switchingGitBranch,
			setSwitchingGitBranch: (next) => {
				this.switchingGitBranch = next;
			},
			render: this.render.bind(this),
			closeGitMenu: () => {
				this.gitMenuOpen = false;
				this.gitBranchQuery = "";
			},
			pushNotice: this.pushNotice.bind(this),
			runGit: this.runGit.bind(this),
			hasGitHeadCommit: this.hasGitHeadCommit.bind(this),
			switchUnbornHeadBranch: this.switchUnbornHeadBranch.bind(this),
			refreshGitSummary: this.refreshGitSummary.bind(this),
		});
	}

	private renderGitRepoControl(): TemplateResult {
		return renderGitRepoControlView({
			summary: this.gitSummary,
			creatingGitRepo: this.creatingGitRepo,
			refreshingGitSummary: this.refreshingGitSummary,
			switchingGitBranch: this.switchingGitBranch,
			fetchingGitRemotes: this.fetchingGitRemotes,
			gitMenuOpen: this.gitMenuOpen,
			gitBranchQuery: this.gitBranchQuery,
			resolveGitBranchSelection: this.resolveGitBranchSelection.bind(this),
			gitIcon: () => uiIcon("git"),
			onCreateRepo: this.createGitRepository.bind(this),
			onToggleMenu: () => {
				this.gitMenuOpen = !this.gitMenuOpen;
				if (!this.gitMenuOpen) this.gitBranchQuery = "";
				this.render();
			},
			onSetBranchQuery: (value) => {
				this.gitBranchQuery = value;
				this.render();
			},
			onCreateAndCheckoutBranch: this.createAndCheckoutBranch.bind(this),
			onFetchRemotes: this.fetchGitRemotes.bind(this),
			onSwitchGitBranchEntry: this.switchGitBranchEntry.bind(this),
		});
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

		if (
			handleMessageStreamEvent(type, event, {
				promoteQueuedMessageFromUserEvent: this.promoteQueuedMessageFromUserEvent.bind(this),
				getLastMessage: () => this.messages[this.messages.length - 1] ?? null,
				ensureStreamingAssistantMessage: this.ensureStreamingAssistantMessage.bind(this),
				extractText: this.extractText.bind(this),
				extractAssistantMessageError: this.extractAssistantMessageError.bind(this),
				markAssistantTextObserved: this.markAssistantTextObserved.bind(this),
				markToolActivityObserved: this.markToolActivityObserved.bind(this),
				extractToolOutput: this.extractToolOutput.bind(this),
				findToolCall: this.findToolCall.bind(this),
				findMostRecentRunningToolByName: this.findMostRecentRunningToolByName.bind(this),
				attachOrphanToolResult: this.attachOrphanToolResult.bind(this),
				render: this.render.bind(this),
				scrollToBottom: this.scrollToBottom.bind(this),
				extractRuntimeErrorMessage: this.extractRuntimeErrorMessage.bind(this),
				extractAssistantPartialContent: this.extractAssistantPartialContent.bind(this),
				mergeStreamingText: this.mergeStreamingText.bind(this),
				scheduleStreamingUiReconcile: this.scheduleStreamingUiReconcile.bind(this),
				createId: uid,
			})
		) {
			return;
		}

		if (
			handleCompactionAndRetryEvent(type, event, {
				messagesLength: () => this.messages.length,
				getCompactionCycle: () => this.compactionCycle,
				setCompactionCycle: (cycle) => {
					this.compactionCycle = cycle;
				},
				setCompactionInsertIndex: (index) => {
					this.compactionInsertIndex = index;
				},
				createId: uid,
				extractToolOutput: this.extractToolOutput.bind(this),
				extractRuntimeErrorMessage: this.extractRuntimeErrorMessage.bind(this),
				truncate,
				pushNotice: this.pushNotice.bind(this),
				pushRuntimeNotice: this.pushRuntimeNotice.bind(this),
				markContextUsageUnknown: this.markContextUsageUnknown.bind(this),
				refreshAfterCompaction: this.refreshAfterCompaction.bind(this),
				setRetryStatus: (status) => {
					this.retryStatus = status;
				},
				appendSystemMessage: this.appendSystemMessage.bind(this),
				render: this.render.bind(this),
			})
		) {
			return;
		}

		if (
			handleRuntimeStatusEvent(type, event, {
				projectPath: this.projectPath,
				isLoadingModels: () => this.loadingModels,
				isRpcConnected: () => rpcBridge.isConnected,
				getLastMessage: () => this.messages[this.messages.length - 1] ?? null,
				setConnected: (connected) => {
					this.isConnected = connected;
				},
				setBindingStatusText: (text) => {
					this.bindingStatusText = text;
				},
				clearDisconnectNoticeTimer: () => {
					if (!this.disconnectNoticeTimer) return;
					clearTimeout(this.disconnectNoticeTimer);
					this.disconnectNoticeTimer = null;
				},
				scheduleDisconnectNoticeTimer: (callback, delayMs) => {
					this.disconnectNoticeTimer = setTimeout(() => {
						this.disconnectNoticeTimer = null;
						callback();
					}, delayMs);
				},
				setLoadingModels: (loading) => {
					this.loadingModels = loading;
				},
				bumpModelLoadRequestSeq: () => {
					this.modelLoadRequestSeq += 1;
				},
				cancelStreamingUiReconcile: this.cancelStreamingUiReconcile.bind(this),
				scheduleStreamingUiReconcile: this.scheduleStreamingUiReconcile.bind(this),
				setPendingDeliveryMode: (mode) => {
					this.pendingDeliveryMode = mode;
				},
				setRunFlags: ({ hasAssistantText, sawToolActivity, keepWorkflowExpanded }) => {
					this.runHasAssistantText = hasAssistantText;
					this.runSawToolActivity = sawToolActivity;
					this.keepWorkflowExpandedUntilAssistantText = keepWorkflowExpanded;
				},
				clearCollapsedAutoWorkflowIds: () => this.collapsedAutoWorkflowIds.clear(),
				setStateStreaming: (streaming) => {
					if (!this.state) return;
					this.state = { ...this.state, isStreaming: streaming };
					this.onStateChange?.(this.state);
				},
				setAutoFollowChat: (next) => {
					this.autoFollowChat = next;
				},
				onRunStateChange: (running) => {
					this.onRunStateChange?.(running);
				},
				setRetryStatus: (status) => {
					this.retryStatus = status;
				},
				pushRuntimeNotice: this.pushRuntimeNotice.bind(this),
				pushNotice: this.pushNotice.bind(this),
				extractRuntimeErrorMessage: this.extractRuntimeErrorMessage.bind(this),
				truncate,
				extensionLabelFromPath: this.extensionLabelFromPath.bind(this),
				maybePushExtensionCompatibilityHint: this.maybePushExtensionCompatibilityHint.bind(this),
				render: this.render.bind(this),
				scrollToBottom: this.scrollToBottom.bind(this),
				refreshFromBackend: this.refreshFromBackend.bind(this),
				loadAvailableModels: this.loadAvailableModels.bind(this),
				refreshStateAfterAgentEnd: () => {
					rpcBridge
						.getState()
						.then((state) => {
							this.state = state;
							this.syncComposerQueueFromState(state);
							this.pendingDeliveryMode = state.isStreaming ? "steer" : "prompt";
							this.onStateChange?.(state);
							void this.refreshSessionStats(true);
							void this.refreshGitSummary(true);
							this.render();
						})
						.catch(() => {
							/* ignore */
						});
				},
			})
		) {
			return;
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
		return isImageNameValue(name);
	}

	private mimeFromFileName(name: string): string {
		return mimeFromFileNameValue(name);
	}

	private toBase64(bytes: Uint8Array): string {
		return toBase64Bytes(bytes);
	}

	private isImageFile(file: File): boolean {
		return isImageFileValue(file);
	}

	private fileNameFromPath(path: string): string {
		return fileNameFromPathValue(path);
	}

	private shouldIgnoreDuplicateDrop(names: string[]): boolean {
		const signature = createDropSignature(names);
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
		return extractFilePathsFromDropPayloadValue(raw);
	}

	private normalizeDroppedPath(path: string): string {
		return path.replace(/\\/g, "/").trim();
	}

	private formatDroppedPathToken(path: string): string {
		const normalized = this.normalizeDroppedPath(path);
		if (!normalized) return "";
		const projectRoot = this.projectPath ? this.normalizeDroppedPath(this.projectPath).replace(/\/+$/, "") : "";
		let token = normalized;
		if (projectRoot) {
			const lowerPath = normalized.toLowerCase();
			const lowerRoot = projectRoot.toLowerCase();
			if (lowerPath === lowerRoot) {
				token = ".";
			} else if (lowerPath.startsWith(`${lowerRoot}/`)) {
				token = `./${normalized.slice(projectRoot.length + 1)}`;
			}
		}
		if (/\s/.test(token)) {
			return `"${token.replace(/"/g, '\\"')}"`;
		}
		return token;
	}

	private appendDroppedPathReferences(paths: string[], insertionIndex?: number): void {
		const seen = new Set<string>(this.pendingFileReferences.map((entry) => entry.token.toLowerCase()));
		const next: PendingFileReference[] = [];
		const insertAt = this.clampComposerInsertIndex(insertionIndex);
		for (const rawPath of paths) {
			const normalizedPath = this.normalizeDroppedPath(rawPath);
			if (!normalizedPath) continue;
			const token = this.formatDroppedPathToken(normalizedPath);
			if (!token) continue;
			const key = token.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			next.push({
				id: uid("file"),
				name: this.fileNameFromPath(normalizedPath),
				path: normalizedPath,
				token,
				insertAt,
			});
		}
		if (next.length === 0) return;
		this.pendingFileReferences = [...this.pendingFileReferences, ...next];
		this.render();
	}

	private dedupeDroppedPaths(paths: string[]): string[] {
		const seen = new Set<string>();
		const unique: string[] = [];
		for (const rawPath of paths) {
			const normalized = this.normalizeDroppedPath(rawPath);
			if (!normalized) continue;
			const key = normalized.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			unique.push(normalized);
		}
		return unique;
	}

	private handleDroppedPathCandidates(
		paths: string[],
		options: { quietImageReadFailure?: boolean; insertionIndex?: number } = {},
	): boolean {
		const normalizedPaths = this.dedupeDroppedPaths(paths);
		if (normalizedPaths.length === 0) return false;
		const signatureNames = normalizedPaths.map((path) => this.fileNameFromPath(path));
		if (signatureNames.length > 0 && this.shouldIgnoreDuplicateDrop(signatureNames)) {
			return true;
		}
		const imagePaths = normalizedPaths.filter((path) => this.isImageName(this.fileNameFromPath(path)));
		const filePaths = normalizedPaths.filter((path) => !this.isImageName(this.fileNameFromPath(path)));

		let handled = false;
		if (imagePaths.length > 0) {
			void this.prepareImagesFromPaths(imagePaths, {
				quietIfNone: options.quietImageReadFailure ?? true,
				insertionIndex: options.insertionIndex,
			});
			handled = true;
		}
		if (filePaths.length > 0) {
			this.appendDroppedPathReferences(filePaths, options.insertionIndex);
			handled = true;
		}
		return handled;
	}

	private pathFromDroppedFile(file: File): string {
		const maybePath = file as File & { path?: string; webkitRelativePath?: string };
		const pathValue =
			typeof maybePath.path === "string" && maybePath.path.trim().length > 0
				? maybePath.path
				: typeof maybePath.webkitRelativePath === "string" && maybePath.webkitRelativePath.trim().length > 0
					? maybePath.webkitRelativePath
					: file.name || "";
		return this.normalizeDroppedPath(pathValue);
	}

	private async prepareImagesFromPaths(
		paths: string[],
		options: { quietIfNone?: boolean; insertionIndex?: number } = {},
	): Promise<void> {
		if (paths.length === 0) return;
		try {
			const { readFile } = await import("@tauri-apps/plugin-fs");
			const next: PendingImage[] = [];
			const insertAt = this.clampComposerInsertIndex(options.insertionIndex);
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
						path: cleanPath,
						mimeType: mime,
						data: base64,
						previewUrl: `data:${mime};base64,${base64}`,
						size: bytes.length,
						token: this.formatDroppedPathToken(cleanPath) || undefined,
						insertAt,
					});
				} catch {
					// ignore unreadable file
				}
			}
			if (next.length === 0) {
				if (!options.quietIfNone) {
					this.pushNotice("Could not read dropped image files", "info");
				}
				return;
			}
			this.pendingImages = [...this.pendingImages, ...next];
			this.render();
		} catch {
			this.pushNotice("Drag/drop is blocked by file permissions", "error");
		}
	}

	private handleDroppedDataTransfer(dataTransfer: DataTransfer | null, options: { insertionIndex?: number } = {}): void {
		this.clearComposerDropUiState();
		const activeSidebarPaths = peekActiveDraggedFilePaths();
		if (!dataTransfer) {
			const handledFromSidebarFallback = this.handleDroppedPathCandidates(activeSidebarPaths, {
				quietImageReadFailure: true,
				insertionIndex: options.insertionIndex,
			});
			if (activeSidebarPaths.length > 0) {
				clearActiveDraggedFilePaths();
			}
			if (!handledFromSidebarFallback && activeSidebarPaths.length > 0) {
				this.pushNotice("No readable files found in drop payload", "info");
			}
			return;
		}

		const customPayload = dataTransfer.getData("application/x-pi-file-path") || "";
		const customPaths = customPayload
			.split(/\r?\n/)
			.map((value) => value.trim())
			.filter(Boolean);
		const customJsonPayload = dataTransfer.getData("application/x-pi-file-paths-json") || "";
		let customJsonPaths: string[] = [];
		if (customJsonPayload) {
			try {
				const parsed = JSON.parse(customJsonPayload) as unknown;
				if (Array.isArray(parsed)) {
					customJsonPaths = parsed.filter((value): value is string => typeof value === "string");
				}
			} catch {
				// ignore malformed payload
			}
		}
		const uriPayload = [customPayload, customJsonPaths.join("\n"), dataTransfer.getData("text/uri-list"), dataTransfer.getData("text/plain")]
			.map((value) => value || "")
			.join("\n");
		const uriPaths = this.extractFilePathsFromDropPayload(uriPayload);
		const droppedPathsFromPayload = this.dedupeDroppedPaths([...customPaths, ...customJsonPaths, ...uriPaths]);

		const directFiles = Array.from(dataTransfer.files || []);
		const fromItems = Array.from(dataTransfer.items || [])
			.filter((item) => item.kind === "file")
			.map((item) => item.getAsFile())
			.filter((f): f is File => Boolean(f));
		const fileObjects = directFiles.length > 0 ? directFiles : fromItems;

		const imageFiles = fileObjects.filter((file) => this.isImageFile(file));
		const imagePathsFromPayload = droppedPathsFromPayload.filter((path) => this.isImageName(this.fileNameFromPath(path)));
		const filePathsFromPayload = droppedPathsFromPayload.filter((path) => !this.isImageName(this.fileNameFromPath(path)));
		const filePathsFromObjects = this.dedupeDroppedPaths(
			fileObjects
				.filter((file) => !this.isImageFile(file))
				.map((file) => this.pathFromDroppedFile(file))
				.filter(Boolean),
		);

		const hasPayloadCandidates =
			imageFiles.length > 0 ||
			imagePathsFromPayload.length > 0 ||
			filePathsFromPayload.length > 0 ||
			filePathsFromObjects.length > 0;
		const fallbackSidebarPaths = !hasPayloadCandidates ? this.dedupeDroppedPaths(activeSidebarPaths) : [];
		const fallbackImagePaths = fallbackSidebarPaths.filter((path) => this.isImageName(this.fileNameFromPath(path)));
		const fallbackFilePaths = fallbackSidebarPaths.filter((path) => !this.isImageName(this.fileNameFromPath(path)));

		const imagePaths = imagePathsFromPayload.length > 0 ? imagePathsFromPayload : fallbackImagePaths;
		const filePaths = this.dedupeDroppedPaths(
			filePathsFromPayload.length > 0
				? filePathsFromPayload
				: filePathsFromObjects.length > 0
					? filePathsFromObjects
					: fallbackFilePaths,
		);

		if (customPaths.length > 0 || customJsonPaths.length > 0 || fallbackSidebarPaths.length > 0) {
			clearActiveDraggedFilePaths();
		}

		const signatureNames = [
			...imageFiles.map((file) => file.name || ""),
			...imagePaths.map((path) => this.fileNameFromPath(path)),
			...filePaths.map((path) => this.fileNameFromPath(path)),
		];
		if (signatureNames.length > 0 && this.shouldIgnoreDuplicateDrop(signatureNames)) return;

		let handled = false;
		if (imageFiles.length > 0) {
			void this.prepareImages(imageFiles, { insertionIndex: options.insertionIndex });
			handled = true;
		} else if (imagePaths.length > 0) {
			void this.prepareImagesFromPaths(imagePaths, { quietIfNone: true, insertionIndex: options.insertionIndex });
			handled = true;
		}

		if (filePaths.length > 0) {
			this.appendDroppedPathReferences(filePaths, options.insertionIndex);
			handled = true;
		}

		if (!handled && activeSidebarPaths.length > 0) {
			const handledFromSidebarFallback = this.handleDroppedPathCandidates(activeSidebarPaths, {
				quietImageReadFailure: true,
				insertionIndex: options.insertionIndex,
			});
			clearActiveDraggedFilePaths();
			if (handledFromSidebarFallback) {
				handled = true;
			}
		}

		if (!handled) {
			this.pushNotice("No readable files found in drop payload", "info");
		}
	}

	private async prepareComposerFiles(files: FileList | File[], insertionIndex?: number): Promise<void> {
		const list = Array.from(files || []);
		if (list.length === 0) return;
		const imageFiles = list.filter((file) => this.isImageFile(file));
		const filePaths = this.dedupeDroppedPaths(
			list
				.filter((file) => !this.isImageFile(file))
				.map((file) => this.pathFromDroppedFile(file))
				.filter(Boolean),
		);
		if (imageFiles.length > 0) {
			await this.prepareImages(imageFiles, { insertionIndex });
		}
		if (filePaths.length > 0) {
			this.appendDroppedPathReferences(filePaths, insertionIndex);
		}
		if (imageFiles.length === 0 && filePaths.length === 0) {
			this.pushNotice("No readable files selected", "info");
		}
	}

	private async prepareImages(files: FileList | File[], options: { insertionIndex?: number } = {}): Promise<void> {
		const list = Array.from(files).filter((f) => this.isImageFile(f));
		if (list.length === 0) {
			this.pushNotice("Drop an image file (png, jpg, webp, gif…)", "info");
			return;
		}

		const next: PendingImage[] = [];
		let failed = 0;

		const insertAt = this.clampComposerInsertIndex(options.insertionIndex);
		for (const file of list) {
			const safeName = file.name || `image-${Date.now()}.png`;
			const mime = file.type || this.mimeFromFileName(safeName);
			const rawPathHint = this.pathFromDroppedFile(file);
			const pathHint = rawPathHint && rawPathHint !== safeName ? rawPathHint : undefined;
			const token = pathHint ? this.formatDroppedPathToken(pathHint) : "";
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
								path: pathHint,
								mimeType: parsedMime,
								data: base64,
								previewUrl: `data:${parsedMime};base64,${base64}`,
								size: file.size,
								token: token || undefined,
								insertAt,
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
				path: pathHint,
				mimeType: mime,
				data: base64,
				previewUrl: `data:${mime};base64,${base64}`,
				size: file.size,
				token: token || undefined,
				insertAt,
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

	private removePendingFileReference(id: string): void {
		this.pendingFileReferences = this.pendingFileReferences.filter((entry) => entry.id !== id);
		this.render();
	}

	private composedPromptText(rawText: string): string {
		const baseText = rawText;
		const tokenEntries = [
			...this.pendingFileReferences
				.filter((entry) => entry.token.length > 0)
				.map((entry, idx) => ({ token: entry.token, insertAt: entry.insertAt, order: idx })),
			...this.pendingImages
				.filter((image) => typeof image.token === "string" && image.token.trim().length > 0)
				.map((image, idx) => ({
					token: (image.token || "").trim(),
					insertAt: image.insertAt,
					order: this.pendingFileReferences.length + idx,
				})),
		];
		if (tokenEntries.length === 0) return baseText.trim();

		const sorted = tokenEntries
			.map((entry) => ({
				token: entry.token,
				insertAt: this.clampComposerInsertIndex(entry.insertAt),
				order: entry.order,
			}))
			.sort((a, b) => a.insertAt - b.insertAt || a.order - b.order);

		let cursor = 0;
		let output = "";
		for (const entry of sorted) {
			const index = this.clampComposerInsertIndex(entry.insertAt);
			output += baseText.slice(cursor, index);
			if (output.length > 0 && !/\s$/.test(output)) {
				output += " ";
			}
			output += entry.token;
			const nextChar = baseText.slice(index, index + 1);
			if (nextChar && !/^\s$/.test(nextChar)) {
				output += " ";
			}
			cursor = index;
		}
		output += baseText.slice(cursor);
		return output.trim();
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
		this.syncComposerTextareaDeferred(text, {
			maxHeight: 220,
			moveCaretToEnd: true,
			focus: true,
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
		this.pendingFileReferences = [];
		this.pendingAttachmentInsertIndex = null;
		this.selectedSkillDraft = null;
		this.resetComposerHistoryNavigation();
		this.closeSlashPalette();
		this.render();
		this.syncComposerTextarea("", { maxHeight: 0 });
	}

	async sendMessage(mode: DeliveryMode = this.pendingDeliveryMode): Promise<void> {
		await sendMessageFlow({
			mode,
			bindingStatusText: this.bindingStatusText,
			isComposerInteractionLocked: this.isComposerInteractionLocked.bind(this),
			inputText: this.composedPromptText(this.inputText),
			selectedSkillCommandText: this.selectedSkillDraft?.commandText?.trim() ?? "",
			pendingImages: [...this.pendingImages],
			slashQueryFromInput: () => (this.pendingFileReferences.length > 0 ? null : this.slashQueryFromInput()),
			executeSlashCommandFromComposer: this.executeSlashCommandFromComposer.bind(this),
			rememberComposerHistoryEntry: this.rememberComposerHistoryEntry.bind(this),
			currentIsStreaming: this.currentIsStreaming.bind(this),
			applyBackendState: (state) => {
				this.state = state;
				this.syncComposerQueueFromState(state);
				this.onStateChange?.(state);
			},
			clearStreamingUiState: this.clearStreamingUiState.bind(this),
			render: this.render.bind(this),
			enqueueComposerQueueMessage: this.enqueueComposerQueueMessage.bind(this),
			pushNotice: this.pushNotice.bind(this),
			pushUserEcho: this.pushUserEcho.bind(this),
			clearComposer: this.clearComposer.bind(this),
			setSendingPrompt: (value) => {
				this.sendingPrompt = value;
			},
			toRpcImages: this.toRpcImages.bind(this),
			removeComposerQueueMessage: this.removeComposerQueueMessage.bind(this),
			onPromptSubmitted: this.onPromptSubmitted ?? undefined,
		});
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
		this.pendingFileReferences = [];
		this.pendingAttachmentInsertIndex = null;
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
		this.pendingFileReferences = [];
		this.pendingAttachmentInsertIndex = null;
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
		this.openHistoryViewerForFork({
			loading: false,
			sessionName: this.state?.sessionName ?? null,
		});
	}

	private async forkFrom(entryId: string): Promise<void> {
		const sourceSessionName = this.historyViewerSessionLabel.trim() || this.state?.sessionName?.trim() || "";
		const forkSessionName = deriveForkSessionName(sourceSessionName);
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
		this.render();
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
			this.forkEntryIdByMessageId = buildForkEntryIdByMessageId(this.messages, options);
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
		return normalizeThinkingText(value);
	}

	private isStandaloneCodeBlockMarkdown(value: string): boolean {
		return isStandaloneCodeBlockMarkdown(value);
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

	private summarizeToolCall(tc: ToolCallBlock): string {
		return summarizeToolCall(tc, truncate);
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

	private collectAssistantWorkflow(startIndex: number): AssistantWorkflowCandidate | null {
		return collectAssistantWorkflow({
			messages: this.messages,
			startIndex,
			currentIsStreaming: this.currentIsStreaming(),
			keepWorkflowExpandedUntilAssistantText: this.keepWorkflowExpandedUntilAssistantText,
			runHasAssistantText: this.runHasAssistantText,
			truncateText: truncate,
		});
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
		return resolveWorkflowExpansionState({
			workflowId,
			toolCalls,
			isTerminal,
			keepWorkflowExpandedUntilAssistantText: this.keepWorkflowExpandedUntilAssistantText,
			runSawToolActivity: this.runSawToolActivity,
			expandedWorkflowIds: this.expandedToolWorkflowIds,
			collapsedAutoWorkflowIds: this.collapsedAutoWorkflowIds,
		});
	}

	private renderAssistantWorkflow(workflow: AssistantWorkflow): TemplateResult {
		return renderAssistantWorkflowView({
			workflow,
			resolveWorkflowExpansionState: (workflowId, toolCalls, isTerminal) =>
				this.resolveWorkflowExpansionState(workflowId, toolCalls, isTerminal),
			normalizeThinkingText: (value) => this.normalizeThinkingText(value),
			summarizeToolCall: (toolCall) => this.summarizeToolCall(toolCall),
			renderToolPreview: (preview) => this.renderToolPreview(preview),
			formatDuration,
			isWorkflowThinkingExpanded: (thinkingId) => this.isWorkflowThinkingExpanded(thinkingId),
			toggleWorkflowThinkingExpanded: (thinkingId) => this.toggleWorkflowThinkingExpanded(thinkingId),
			isToolGroupExpanded: (workflowId, groupId) => this.isToolGroupExpanded(workflowId, groupId),
			toggleToolGroupExpanded: (workflowId, groupId) => this.toggleToolGroupExpanded(workflowId, groupId),
			toggleToolWorkflowExpanded: (workflowId, autoExpanded, currentlyExpanded) =>
				this.toggleToolWorkflowExpanded(workflowId, autoExpanded, currentlyExpanded),
			clearCollapsedWorkflowState: (workflowId) => {
				this.expandedToolGroupByWorkflowId.delete(workflowId);
				this.clearWorkflowThinkingExpansion(workflowId);
			},
			piGlyphIcon,
		});
	}

	private renderMessageTimeline(): TemplateResult[] {
		return renderMessageTimelineRows({
			messages: this.messages,
			compactionCycle: this.compactionCycle,
			compactionInsertIndex: this.compactionInsertIndex,
			collectAssistantWorkflow: (index) => this.collectAssistantWorkflow(index),
			renderAssistantWorkflow: (workflow) => this.renderAssistantWorkflow(workflow),
			renderUserMessage: (message) => this.renderUserMessage(message),
			hasRenderableAssistantContent: (message) => this.hasRenderableAssistantContent(message),
			renderAssistantMessage: (message) => this.renderAssistantMessage(message),
			renderChangelogMessage: (message) => this.renderChangelogMessage(message),
			renderSystemMessage: (message) => this.renderSystemMessage(message),
			renderCompactionCycle: () => this.renderCompactionCycle(),
		});
	}

	private renderAssistantMessage(msg: UiMessage): TemplateResult {
		return renderAssistantMessageRow({
			message: msg,
			renderThinking: (message) => this.renderThinking(message),
			isStandaloneCodeBlockMarkdown: (value) => this.isStandaloneCodeBlockMarkdown(value),
			copyIcon: uiIcon("copy"),
			onCopyMessage: (message) => this.copyMessage(message),
		});
	}

	private renderSystemMessage(msg: UiMessage): TemplateResult {
		return renderSystemMessageRow({ message: msg });
	}

	private renderChangelogMessage(msg: UiMessage): TemplateResult {
		return renderChangelogMessageRow({
			message: msg,
			onToggleExpanded: (message, nextExpanded) => {
				message.collapsibleExpanded = nextExpanded;
				this.render();
			},
		});
	}

	private renderCompactionCycle(): TemplateResult | typeof nothing {
		return renderCompactionCycleRow({
			cycle: this.compactionCycle,
			piGlyphIcon,
			onToggleExpanded: (nextExpanded) => {
				if (!this.compactionCycle) return;
				this.compactionCycle.expanded = nextExpanded;
				this.render();
			},
		});
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
			const inventory = await loadWelcomeDashboardInventory(() => rpcBridge.getCliUpdateStatus());
			this.welcomeDashboard = {
				loading: false,
				skills: inventory.skills,
				extensions: inventory.extensions,
				themes: inventory.themes,
				currentCliVersion: inventory.currentCliVersion,
				latestCliVersion: inventory.latestCliVersion,
				updateAvailable: inventory.updateAvailable,
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

		return renderCenteredWelcomeView({
			brandIconUrl,
			welcomeHeadline,
			projectLabel,
			hasProject,
			projectMenuOpen: this.welcomeProjectMenuOpen,
			projects: this.welcomeProjects,
			activeProjectId: activeProject?.id ?? null,
			snapshot,
			onToggleProjectMenu: () => {
				this.welcomeProjectMenuOpen = !this.welcomeProjectMenuOpen;
				this.render();
			},
			onSelectProject: (projectId) => {
				this.welcomeProjectMenuOpen = false;
				if (projectId !== activeProject?.id) this.onSelectWelcomeProject?.(projectId);
			},
			onAddProject: () => {
				this.welcomeProjectMenuOpen = false;
				this.onAddProject?.();
			},
			onOpenPackages: () => {
				this.welcomeProjectMenuOpen = false;
				this.onOpenPackages?.();
			},
			onOpenSettings: () => {
				this.welcomeProjectMenuOpen = false;
				this.onOpenSettings?.();
			},
		});
	}

	private async openComposerFilePicker(): Promise<void> {
		if (this.isComposerInteractionLocked()) return;
		const insertionIndex = this.getComposerInsertIndex();
		this.pendingAttachmentInsertIndex = insertionIndex;
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				multiple: true,
				directory: false,
				title: "Attach files",
			});
			if (selected === null) {
				this.pendingAttachmentInsertIndex = null;
				return;
			}
			const paths = this.dedupeDroppedPaths(
				(Array.isArray(selected) ? selected : [selected])
					.filter((value): value is string => typeof value === "string")
					.map((value) => value.trim())
					.filter(Boolean),
			);
			if (paths.length === 0) {
				this.pendingAttachmentInsertIndex = null;
				return;
			}
			const imagePaths = paths.filter((path) => this.isImageName(this.fileNameFromPath(path)));
			const filePaths = paths.filter((path) => !this.isImageName(this.fileNameFromPath(path)));
			if (imagePaths.length > 0) {
				await this.prepareImagesFromPaths(imagePaths, { quietIfNone: true, insertionIndex });
			}
			if (filePaths.length > 0) {
				this.appendDroppedPathReferences(filePaths, insertionIndex);
			}
			this.pendingAttachmentInsertIndex = null;
			return;
		} catch {
			// fallback to file input
		}
		const input = this.container.querySelector("#file-picker") as HTMLInputElement | null;
		if (!input) {
			this.pendingAttachmentInsertIndex = null;
			return;
		}
		input.click();
	}

	private renderComposerControls(canSend: boolean, isStreaming: boolean, interactionLocked: boolean): TemplateResult {
		const currentProvider = normalizeText(this.state?.model?.provider);
		const currentModelId = normalizeText(this.state?.model?.id);
		const currentModelValue = currentProvider && currentModelId ? `${currentProvider}::${currentModelId}` : "";
		const currentModelDisplay = currentModelId ? formatModelDisplayName(currentModelId) : "Select model";
		const currentProviderDisplay = currentProvider ? this.displayProviderLabel(currentProvider) : "";
		const currentModelTitle = currentProvider && currentModelId ? `${currentProviderDisplay} / ${currentModelId}` : "Select model";
		const thinkingValue = (this.state?.thinkingLevel ?? "off") as ThinkingLevel;
		const thinkingLabel = formatThinkingDisplayName(thinkingValue);

		const providerGroups = buildModelPickerProviderGroups({
			availableModels: this.availableModels,
			modelCatalog: this.modelCatalog,
			currentProvider,
			currentModelId,
			providerAuthById: this.providerAuthById,
			providerAuthConfigured: this.providerAuthConfigured,
			providerAuthForcedLoggedOut: this.providerAuthForcedLoggedOut,
			oauthProviderCatalog: this.oauthProviderCatalog,
			getProviderLabel: (provider) => this.displayProviderLabel(provider),
		});
		const resolvedActiveProvider = resolveActiveModelPickerProvider(
			providerGroups,
			this.modelPickerActiveProvider,
			currentProvider,
		);
		const activeProviderGroup = providerGroups.find((group) => group.providerKey === resolvedActiveProvider) ?? null;

		return renderComposerControlsView({
			canSend,
			isStreaming,
			interactionLocked,
			sendingPrompt: this.sendingPrompt,
			settingModel: this.settingModel,
			settingThinking: this.settingThinking,
			thinkingValue,
			thinkingLabel,
			currentProvider,
			currentModelId,
			currentModelValue,
			currentModelTitle,
			currentModelDisplay,
			currentProviderDisplay,
			modelPickerOpen: this.modelPickerOpen,
			loadingModels: this.loadingModels,
			loadingModelCatalog: this.loadingModelCatalog,
			providerGroups,
			activeProviderGroup,
			resolvedActiveProvider,
			runningProviderAuthActionProvider: this.runningProviderAuthAction?.provider ?? null,
			attachIcon: uiIcon("attach"),
			stopIcon: uiIcon("stop"),
			spinnerIcon: uiIcon("spinner"),
			sendIcon: uiIcon("send"),
			onAttachFile: () => this.openComposerFilePicker(),
			onCloseModelPicker: (options) => this.closeModelPicker(options),
			onToggleModelPicker: (preferredProvider) => this.toggleModelPicker(preferredProvider),
			onSetModelPickerActiveProvider: (provider) => this.setModelPickerActiveProvider(provider),
			onProviderAuthAction: (provider, action) => this.handleProviderAuthAction(provider, action),
			onSelectModel: (provider, modelId) => this.setModel(provider, modelId),
			onSetThinkingLevel: (value) => this.setThinkingLevel(value),
			onAbort: () => this.abortCurrentRun(),
			onSend: () => this.sendMessage("prompt"),
		});
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

	private handleSlashPaletteMouseMove(event: MouseEvent): void {
		if (this.slashPaletteNavigationMode === "keyboard") {
			const moved = Math.abs(event.movementX) + Math.abs(event.movementY) > 0;
			if (!moved) return;
			this.slashPaletteNavigationMode = "pointer";
		}
		const target = event.target instanceof Element ? (event.target.closest(".composer-slash-item") as HTMLElement | null) : null;
		if (!target) return;
		const indexRaw = target.dataset.index;
		if (!indexRaw) return;
		const index = Number(indexRaw);
		if (!Number.isFinite(index)) return;
		if (this.slashPaletteIndex !== index) {
			this.slashPaletteIndex = index;
			this.render();
		}
	}

	private renderSlashPalette(items: SlashPaletteItem[]): TemplateResult | typeof nothing {
		return renderSlashPaletteView({
			open: this.slashPaletteOpen,
			loading: this.slashCommandsLoading,
			query: this.slashPaletteQuery,
			items,
			activeIndex: this.slashPaletteIndex,
			navigationMode: this.slashPaletteNavigationMode,
			onMouseMove: (event) => this.handleSlashPaletteMouseMove(event),
			onSelect: (item) => this.selectSlashPaletteItem(item),
		});
	}

	private setSessionStatsHover(next: boolean): void {
		if (this.sessionStatsHover === next) return;
		this.sessionStatsHover = next;
		this.render();
	}

	private handleComposerInput(event: Event, interactionLocked: boolean): void {
		handleComposerInputEvent({
			event,
			interactionLocked,
			slashPaletteOpenBefore: this.slashPaletteOpen,
			onSetInputText: (text) => {
				this.inputText = text;
			},
			onResetComposerHistoryNavigation: () => this.resetComposerHistoryNavigation(),
			onUpdateSlashPaletteStateFromInput: () => this.updateSlashPaletteStateFromInput(),
			onIsSlashPaletteOpen: () => this.slashPaletteOpen,
			onRender: () => this.render(),
		});
	}

	private handleComposerPaste(event: ClipboardEvent, interactionLocked: boolean): void {
		handleComposerPasteEvent({
			event,
			interactionLocked,
			onPrepareImages: (files) => this.prepareImages(files, { insertionIndex: this.getComposerInsertIndex() }),
		});
	}

	private handleComposerDragOver(event: DragEvent, interactionLocked: boolean): void {
		const target = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget : null;
		if (target && document.activeElement !== target) {
			target.focus({ preventScroll: true });
		}
		handleComposerDragOverEvent({ event, interactionLocked });
	}

	private handleComposerDragLeave(event: DragEvent): void {
		handleComposerDragLeaveEvent({ event });
	}

	private handleComposerDrop(event: DragEvent, interactionLocked: boolean): void {
		const target = event.currentTarget instanceof HTMLTextAreaElement ? event.currentTarget : this.getComposerTextarea();
		const selectionStart = target && typeof target.selectionStart === "number" ? target.selectionStart : this.getComposerInsertIndex();
		const insertionIndex = this.clampComposerInsertIndex(selectionStart);
		handleComposerDropEvent({
			event,
			interactionLocked,
			onHandleDroppedDataTransfer: (dataTransfer) => this.handleDroppedDataTransfer(dataTransfer, { insertionIndex }),
		});
	}

	private handleComposerKeyDown(event: KeyboardEvent, interactionLocked: boolean, isStreaming: boolean): void {
		handleComposerKeyDownEvent({
			event,
			interactionLocked,
			isStreaming,
			modelPickerOpen: this.modelPickerOpen,
			inputText: this.inputText,
			hasSelectedSkillDraft: Boolean(this.selectedSkillDraft),
			slashPaletteOpen: this.slashPaletteOpen,
			composerHistoryIndex: this.composerHistoryIndex,
			onCloseModelPicker: () => this.closeModelPicker(),
			onRemoveSelectedSkillDraft: () => this.removeComposerSkillDraft(),
			onCycleThinkingLevel: (step) => this.cycleThinkingLevel(step),
			shouldHandleComposerHistoryKey: (ev, textarea, direction) => this.shouldHandleComposerHistoryKey(ev, textarea, direction),
			onNavigateComposerHistory: (direction) => this.navigateComposerHistory(direction),
			getSlashPaletteItems: () => this.getSlashPaletteItems(),
			onSetSlashPaletteNavigationMode: (mode) => {
				this.slashPaletteNavigationMode = mode;
			},
			getSlashPaletteIndex: () => this.slashPaletteIndex,
			onSetSlashPaletteIndex: (index) => {
				this.slashPaletteIndex = index;
			},
			onPreviewSlashPaletteItem: (item) => this.previewSlashPaletteItem(item),
			onRender: () => this.render(),
			onEnsureActiveSlashItemVisible: () => this.ensureActiveSlashItemVisible(),
			onCloseSlashPalette: () => this.closeSlashPalette(),
			slashQueryFromInput: () => this.slashQueryFromInput(),
			onExecuteSlashCommandFromComposer: () => this.executeSlashCommandFromComposer(),
			onSendMessage: (mode) => this.sendMessage(mode),
		});
	}

	private handleComposerFilePickerChange(event: Event, interactionLocked: boolean): void {
		handleComposerFilePickerChangeEvent({
			event,
			interactionLocked,
			onPrepareFiles: (files) => this.prepareComposerFiles(files, this.consumePendingAttachmentInsertIndex()),
		});
		if (interactionLocked) {
			this.pendingAttachmentInsertIndex = null;
		}
	}

	private renderComposer(): TemplateResult {
		const isStreaming = this.currentIsStreaming();
		const interactionLocked = this.isComposerInteractionLocked();
		const slashItems = this.getSlashPaletteItems();
		const canSendBase =
			!interactionLocked &&
			(this.inputText.trim().length > 0 || this.pendingImages.length > 0 || this.pendingFileReferences.length > 0 || Boolean(this.selectedSkillDraft));
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
		const pendingImages = [...this.pendingImages].sort((a, b) => (a.insertAt ?? Number.MAX_SAFE_INTEGER) - (b.insertAt ?? Number.MAX_SAFE_INTEGER));
		const pendingFileReferences = [...this.pendingFileReferences].sort(
			(a, b) => (a.insertAt ?? Number.MAX_SAFE_INTEGER) - (b.insertAt ?? Number.MAX_SAFE_INTEGER),
		);

		return html`
			<div class="composer-shell">
				<div class="composer-inner">
					${renderQueuedComposerMessagesView(this.queuedComposerMessages, truncate)}
					<div class="composer-panel">
						<div class="composer-row">
							${renderComposerSkillDraftPillView(this.selectedSkillDraft, skillGlyphIcon(), () => this.removeComposerSkillDraft())}
							<textarea
								id="chat-input"
								class="chat-input"
								draggable="false"
								placeholder=${interactionLocked ? (connectivityStatus || "Session not ready…") : "Describe the next change — type / for commands"}
								rows="1"
								?disabled=${interactionLocked}
								.value=${this.inputText}
								@input=${(event: Event) => this.handleComposerInput(event, interactionLocked)}
								@paste=${(event: ClipboardEvent) => this.handleComposerPaste(event, interactionLocked)}
								@dragstart=${(event: DragEvent) => event.preventDefault()}
								@dragover=${(event: DragEvent) => this.handleComposerDragOver(event, interactionLocked)}
								@dragleave=${(event: DragEvent) => this.handleComposerDragLeave(event)}
								@drop=${(event: DragEvent) => this.handleComposerDrop(event, interactionLocked)}
								@keydown=${(event: KeyboardEvent) => this.handleComposerKeyDown(event, interactionLocked, isStreaming)}
							></textarea>
							${renderPendingImagesView(pendingImages, truncate, (id) => this.removePendingImage(id))}
							${renderPendingFileReferencesView(pendingFileReferences, truncate, (id) => this.removePendingFileReference(id))}
						</div>
						${this.renderSlashPalette(slashItems)}
						${this.renderComposerControls(canSend, isStreaming, interactionLocked)}
					</div>

					<div class="composer-under-row">
						${this.renderGitRepoControl()}
						${renderComposerStatsView({
							hover: this.sessionStatsHover,
							refreshing: this.refreshingSessionStats,
							tooltip: this.sessionStatsTooltip(),
							ratioPercent,
							ringRadius,
							circumference,
							strokeOffset,
							statsLines,
							onMouseEnter: () => this.setSessionStatsHover(true),
							onMouseLeave: () => this.setSessionStatsHover(false),
						})}
					</div>

					<input
						id="file-picker"
						type="file"
						multiple
						style="display:none"
						@change=${(event: Event) => this.handleComposerFilePickerChange(event, interactionLocked)}
					/>
				</div>
			</div>
		`;
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
			this.historyTreeRows = parseSessionTreeRows({
				sessionContent: content,
				currentSessionEntryIds: this.messages.map((message) => message.sessionEntryId ?? "").filter((id) => id.length > 0),
				extractText: (value) => this.extractText(value),
				extractToolOutput: (value) => this.extractToolOutput(value),
				truncateText: truncate,
				pickString,
				pickNumber,
			});
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
		return renderHistoryViewerView<UiMessage>({
			historyViewerOpen: this.historyViewerOpen,
			historyViewerMode: this.historyViewerMode,
			historyViewerLoading: this.historyViewerLoading,
			historyViewerSessionLabel: this.historyViewerSessionLabel,
			historyQuery: this.historyQuery,
			historyRoleFilter: this.historyRoleFilter,
			messages: this.messages,
			historyTreeRows: this.historyTreeRows,
			forkOptions: this.forkOptions,
			messagePreview: (message) => this.messagePreview(message),
			resolveForkEntryId: (messages, index) => resolveForkEntryId(messages, index, this.forkEntryIdByMessageId),
			onClose: () => this.closeHistoryViewer(),
			onQueryChange: (value) => {
				this.historyQuery = value;
				this.render();
			},
			onRoleFilterChange: (role) => {
				this.historyRoleFilter = role;
				this.render();
			},
			onJumpToMessage: (messageId) => this.revealMessage(messageId),
			onForkFromEntry: (entryId) => void this.forkFrom(entryId),
			compactTreeLinePrefix,
			truncateText: truncate,
		});
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
					if (e.defaultPrevented) return;
					e.preventDefault();
					if (!hasProject) return;
					this.handleDroppedDataTransfer(e.dataTransfer ?? null, { insertionIndex: this.getComposerInsertIndex() });
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
		this.getComposerTextarea()?.focus();
	}
}
