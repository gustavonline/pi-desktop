/**
 * ChatView - rich RPC chat surface for Pi Desktop
 */

import "@mariozechner/mini-lit/dist/CodeBlock.js";
import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import { html, nothing, render, type TemplateResult } from "lit";
import {
	type RpcImageInput,
	type RpcSessionState,
	type ThinkingLevel,
	rpcBridge,
} from "../rpc/bridge.js";

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
	isStreaming?: boolean;
	errorText?: string;
	deliveryMode?: DeliveryMode;
	label?: string;
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

interface SlashPaletteItem {
	id: string;
	section: "Actions" | "Skills";
	label: string;
	hint: string;
	skillName?: string;
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
		case "anthropic":
			return "Anthropic";
		case "google":
		case "googleai":
		case "gemini":
			return "Google";
		case "xai":
			return "xAI";
		case "openrouter":
			return "OpenRouter";
		case "ollama":
			return "Ollama";
		case "lmstudio":
			return "LM Studio";
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

function uiIcon(name: "edit" | "retry" | "copy" | "attach" | "send" | "stop" | "spinner" | "spark" | "terminal" | "git"): TemplateResult {
	switch (name) {
		case "edit":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 11.8l.5-2.5L10.2 2.8a1.2 1.2 0 0 1 1.7 0l1.3 1.3a1.2 1.2 0 0 1 0 1.7l-6.5 6.5z"></path><path d="M3.2 11.8l2.5-.5"></path></svg>`;
		case "retry":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.7 8a4.7 4.7 0 1 1-1.4-3.4"></path><path d="M12.7 4.2v2.4h-2.4"></path></svg>`;
		case "copy":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.4"></rect><rect x="3" y="3" width="8" height="8" rx="1.4"></rect></svg>`;
		case "attach":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.1v9.8"></path><path d="M3.1 8h9.8"></path></svg>`;
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
	private onOpenSettings: (() => void) | null = null;
	private onOpenPackages: (() => void) | null = null;
	private onSelectWelcomeProject: ((projectId: string) => void) | null = null;
	private onPromptSubmitted: (() => void) | null = null;
	private onRunStateChange: ((running: boolean) => void) | null = null;
	private availableModels: ModelOption[] = [];
	private loadingModels = false;
	private modelLoadRequestSeq = 0;
	private lastBackendRefreshError: string | null = null;
	private lastModelLoadError: string | null = null;
	private lastBackendSessionFile: string | null = null;
	private settingModel = false;
	private settingThinking = false;
	private modelPickerOpen = false;
	private modelPickerActiveProvider = "";
	private modelPickerGlobalListenersBound = false;
	private sendingPrompt = false;
	private pendingImages: PendingImage[] = [];
	private notices: Notice[] = [];
	private allThinkingExpanded = false;
	private retryStatus = "";
	private compactionCycle: CompactionCycleState | null = null;
	private lastRuntimeNoticeSignature = "";
	private lastRuntimeNoticeAt = 0;
	private pendingDeliveryMode: DeliveryMode = "prompt";
	private openingForkPicker = false;
	private forkPickerOpen = false;
	private forkOptions: ForkOption[] = [];
	private historyViewerOpen = false;
	private historyViewerMode: "browse" | "fork" = "browse";
	private historyViewerLoading = false;
	private historyViewerSessionLabel = "";
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
	private selectedSkillDraft: ComposerSkillDraft | null = null;
	private slashPaletteOpen = false;
	private slashPaletteQuery = "";
	private slashPaletteIndex = 0;
	private slashPaletteNavigationMode: "pointer" | "keyboard" = "pointer";
	private slashSkills: string[] = [];
	private slashSkillsLoading = false;
	private slashSkillsUpdatedAt = 0;
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
		dirtyFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: 0,
	};
	private refreshingGitSummary = false;
	private gitMenuOpen = false;
	private gitBranchQuery = "";
	private switchingGitBranch = false;
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

	setOnOpenSettings(cb: () => void): void {
		this.onOpenSettings = cb;
	}

	setOnOpenPackages(cb: () => void): void {
		this.onOpenPackages = cb;
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
		this.slashSkillsUpdatedAt = 0;
		this.expandedToolWorkflowIds.clear();
		this.expandedToolGroupByWorkflowId.clear();
		this.expandedWorkflowThinkingIds.clear();
		this.compactionCycle = null;
		this.keepWorkflowExpandedUntilAssistantText = false;
		if (!path) {
			this.bindingStatusText = null;
			this.welcomeHeadlineIndex = (this.welcomeHeadlineIndex + 1) % this.welcomeHeadlines.length;
			this.modelLoadRequestSeq += 1;
			this.loadingModels = false;
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
		this.expandedToolWorkflowIds.clear();
		this.expandedToolGroupByWorkflowId.clear();
		this.expandedWorkflowThinkingIds.clear();
		this.compactionCycle = null;
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
		const normalized = query.toLowerCase();
		if (!this.slashPaletteOpen || normalized !== this.slashPaletteQuery) {
			this.slashPaletteIndex = 0;
			this.slashPaletteNavigationMode = "pointer";
		}
		this.slashPaletteOpen = true;
		this.slashPaletteQuery = normalized;
		void this.ensureSlashSkillsLoaded();
	}

	private closeSlashPalette(clearInput = false): void {
		this.slashPaletteOpen = false;
		this.slashPaletteQuery = "";
		this.slashPaletteIndex = 0;
		this.slashPaletteNavigationMode = "pointer";
		if (clearInput) this.inputText = "";
	}

	private normalizeSkillNameFromCommand(rawName: string): string | null {
		const trimmed = rawName.trim();
		if (!trimmed) return null;
		const fromPrefixed = trimmed.match(/^\/?skill:([a-zA-Z0-9._-]+)\b/i);
		if (fromPrefixed) return fromPrefixed[1] ?? null;
		if (/^[a-zA-Z0-9._-]+$/.test(trimmed)) return trimmed;
		return null;
	}

	private collectRuntimeSkillNames(commands: Array<Record<string, unknown>>): string[] {
		const names = new Set<string>();
		for (const raw of commands) {
			const source = normalizeText((raw as Record<string, unknown>).source).toLowerCase();
			if (source !== "skill") continue;
			const name = this.normalizeSkillNameFromCommand(normalizeText((raw as Record<string, unknown>).name));
			if (name) names.add(name);
		}
		return [...names].sort((a, b) => a.localeCompare(b));
	}

	private async ensureSlashSkillsLoaded(force = false): Promise<void> {
		if (this.slashSkillsLoading) return;
		if (!force && this.slashSkills.length > 0 && Date.now() - this.slashSkillsUpdatedAt < 120_000) return;
		this.slashSkillsLoading = true;
		if (this.slashPaletteOpen) this.render();
		try {
			const runtimeCommands = await rpcBridge.getCommands().catch(() => []);
			const runtimeSkills = this.collectRuntimeSkillNames(runtimeCommands as Array<Record<string, unknown>>);

			const { homeDir } = await import("@tauri-apps/api/path");
			const home = await homeDir();
			const roots = [joinFsPath(joinFsPath(joinFsPath(home, ".pi"), "agent"), "skills")];
			const sets = await Promise.all(roots.map((root) => this.collectSkillNames(root)));
			const merged = new Set<string>(runtimeSkills);
			for (const list of sets) {
				for (const name of list) merged.add(name);
			}
			this.slashSkills = [...merged].sort((a, b) => a.localeCompare(b));
			this.slashSkillsUpdatedAt = Date.now();
		} catch {
			this.slashSkills = this.slashSkills.slice();
			this.slashSkillsUpdatedAt = Date.now();
		} finally {
			this.slashSkillsLoading = false;
			if (this.slashPaletteOpen) this.render();
		}
	}

	private matchesSlashQuery(query: string, ...values: string[]): boolean {
		if (!query) return true;
		const haystack = values.join(" ").toLowerCase();
		return haystack.includes(query);
	}

	private getSlashPaletteItems(): SlashPaletteItem[] {
		if (!this.slashPaletteOpen) return [];
		const query = this.slashPaletteQuery;
		const actions: SlashPaletteItem[] = [
			{ id: "action:new-session", section: "Actions" as const, label: "New session", hint: "Create a fresh session tab" },
			{ id: "action:rename-session", section: "Actions" as const, label: "Rename session", hint: "Rename current session" },
			{ id: "action:open-terminal", section: "Actions" as const, label: "Open terminal", hint: "Switch to terminal pane" },
			{ id: "action:compact", section: "Actions" as const, label: "Compact context", hint: "Run session compaction now" },
			{ id: "action:history", section: "Actions" as const, label: "Open history", hint: "Browse current session history" },
			{ id: "action:copy-last", section: "Actions" as const, label: "Copy last answer", hint: "Copy latest assistant response" },
			{ id: "action:export-html", section: "Actions" as const, label: "Export HTML", hint: "Export conversation to HTML" },
		].filter((item) => this.matchesSlashQuery(query, item.label, item.hint, item.id));

		const skills = this.slashSkills
			.filter((name) => this.matchesSlashQuery(query, name, "skill"))
			.slice(0, 24)
			.map((name) => ({
				id: `skill:${name}`,
				section: "Skills" as const,
				label: name,
				hint: "Use skill in composer",
				skillName: name,
			}));

		if (query && query.startsWith("skill:") && skills.length === 0) {
			const raw = query.slice("skill:".length).trim();
			if (raw) {
				skills.push({
					id: `skill:${raw}`,
					section: "Skills" as const,
					label: raw,
					hint: "Use typed skill name",
					skillName: raw,
				});
			}
		}

		return [...actions, ...skills];
	}

	private selectSlashPaletteItem(item: SlashPaletteItem): void {
		if (item.section === "Skills" && item.skillName) {
			this.selectedSkillDraft = {
				name: item.skillName,
				commandText: `/skill:${item.skillName}`,
				scope: null,
			};
			this.inputText = "";
			this.closeSlashPalette();
			this.render();
			requestAnimationFrame(() => {
				const textarea = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
				textarea?.focus();
			});
			return;
		}

		this.inputText = "";
		this.closeSlashPalette();
		this.render();
		switch (item.id) {
			case "action:new-session":
				void this.newSession();
				return;
			case "action:rename-session":
				void this.renameSession();
				return;
			case "action:open-terminal":
				this.onOpenTerminal?.();
				return;
			case "action:compact":
				void this.compactNow();
				return;
			case "action:history":
				this.openHistoryViewer();
				return;
			case "action:copy-last":
				void this.copyLastMessage();
				return;
			case "action:export-html":
				void this.exportToHtml();
				return;
			default:
				return;
		}
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
			}
			this.lastBackendRefreshError = null;
			this.onStateChange?.(state);
			this.messages = this.mapBackendMessages(backendMessages);
			this.expandedToolWorkflowIds.clear();
			this.expandedToolGroupByWorkflowId.clear();
			this.expandedWorkflowThinkingIds.clear();
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
		await this.loadAvailableModels();
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

					mapped.push({
						id: uid("assistant"),
						sessionEntryId,
						role: "assistant",
						text,
						thinking: thinking || undefined,
						thinkingExpanded: this.allThinkingExpanded,
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
			if (mapped.length > 0) {
				mapped.sort((a, b) => {
					const providerCompare = formatProviderDisplayName(a.provider).localeCompare(formatProviderDisplayName(b.provider), undefined, {
						sensitivity: "base",
					});
					if (providerCompare !== 0) return providerCompare;
					return formatModelDisplayName(a.id).localeCompare(formatModelDisplayName(b.id), undefined, { sensitivity: "base" });
				});
				this.availableModels = mapped;
			}
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

	private async setModel(provider: string, modelId: string): Promise<void> {
		if (this.settingModel) return;
		this.modelPickerOpen = false;
		this.settingModel = true;
		this.render();
		try {
			await rpcBridge.setModel(provider, modelId);
			this.state = await rpcBridge.getState();
			if (this.state) this.onStateChange?.(this.state);
			void this.refreshSessionStats(true);
			this.pushNotice(`Switched to ${provider}/${modelId}`, "success");
		} catch (err) {
			console.error("Failed to set model:", err);
			this.pushNotice("Failed to switch model", "error");
		} finally {
			this.settingModel = false;
			this.render();
		}
	}

	private async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		if (this.settingThinking) return;
		const requestedLevel = level;
		if (this.state) {
			this.state = { ...this.state, thinkingLevel: requestedLevel };
		}
		this.settingThinking = true;
		this.render();
		try {
			await rpcBridge.setThinkingLevel(requestedLevel);
			this.state = await rpcBridge.getState();
			if (this.state) this.onStateChange?.(this.state);
			if (requestedLevel === "xhigh" && this.state?.thinkingLevel !== "xhigh") {
				this.pushNotice(`xhigh is not available for this model (using ${this.state?.thinkingLevel || "high"})`, "info");
			}
			void this.refreshSessionStats(true);
		} catch (err) {
			console.error("Failed to set thinking level:", err);
			this.pushNotice("Failed to set thinking level", "error");
		} finally {
			this.settingThinking = false;
			this.render();
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
			const contextTokensFromStats = pickNumber(raw, [
				"contextTokens",
				"context_tokens",
				"context.tokens",
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
			const contextTokens = contextTokensFromStats ?? this.lastAssistantContextTokens;
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
		const stdout = typeof source.stdout === "string" ? source.stdout : "";
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
					dirtyFiles: 0,
					additions: 0,
					deletions: 0,
					updatedAt: Date.now(),
				};
				this.gitMenuOpen = false;
				this.gitBranchQuery = "";
				return;
			}

			const [branchPrimary, branchesResult, statusResult, diffResult, stagedResult, hasCommit] = await Promise.all([
				this.runGit(["symbolic-ref", "--short", "HEAD"]),
				this.runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
				this.runGit(["status", "--porcelain"]),
				this.runGit(["diff", "--numstat"]),
				this.runGit(["diff", "--cached", "--numstat"]),
				this.hasGitHeadCommit(),
			]);

			let branch = branchPrimary.stdout.trim() || null;
			if (!branch || branchPrimary.exitCode !== 0) {
				const fallback = await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
				branch = fallback.stdout.trim() || null;
			}

			let branches = branchesResult.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);

			if (!hasCommit) {
				branches = [...new Set([...this.knownBranchesForCurrentProject(), ...branches])];
			}

			if (branch && !branches.includes(branch)) {
				branches.unshift(branch);
			}
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
		if (!/^[A-Za-z0-9._\/-]+$/.test(proposed)) {
			this.pushNotice("Use letters, numbers, ., _, -, / for branch names", "error");
			return;
		}

		const refCheck = await this.runGit(["check-ref-format", "--branch", proposed]);
		if (refCheck.exitCode !== 0) {
			this.pushNotice(refCheck.stderr.trim() || refCheck.stdout.trim() || "Invalid branch name", "error");
			return;
		}

		if (this.gitSummary.branches.includes(proposed) || proposed === (this.gitSummary.branch || "")) {
			await this.switchGitBranch(proposed);
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
		const branches = this.gitSummary.branches.filter((branch) => !query || branch.toLowerCase().includes(query));
		const filesLabel = this.gitSummary.dirtyFiles === 1 ? "file" : "files";

		return html`
			<div class="git-branch-wrap">
				<button
					class="git-branch-pill ${this.gitMenuOpen ? "open" : ""}"
					title="Switch branch"
					?disabled=${this.switchingGitBranch || this.refreshingGitSummary}
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
									placeholder="Search branches"
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
							<div class="git-branch-menu-title">Branches</div>
							<div class="git-branch-list">
								${branches.length === 0
									? html`<div class="git-branch-empty">No branches found.</div>`
									: branches.map((branch) => {
											const active = branch === currentBranch;
											return html`
												<button
													class="git-branch-item ${active ? "active" : ""}"
													?disabled=${active || this.switchingGitBranch}
													@click=${() => void this.switchGitBranch(branch)}
												>
													<div class="git-branch-item-top">
														<span class="git-branch-item-icon">${uiIcon("git")}</span>
														<span class="git-branch-item-name">${branch}</span>
														${active ? html`<span class="git-branch-item-check">✓</span>` : nothing}
													</div>
													${active && this.gitSummary.dirtyFiles > 0
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
							<button class="git-branch-create" @click=${() => void this.createAndCheckoutBranch(this.gitBranchQuery)}>
								<span class="git-branch-create-plus">＋</span>
								<span>Create and checkout new branch…</span>
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

	private appendRuntimeSystemLine(text: string): void {
		const line = text.trim();
		if (!line) return;
		this.messages.push({
			id: uid("runtimeError"),
			role: "system",
			text: line,
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
			this.appendRuntimeSystemLine(inlineLine);
		}
		this.pushNotice(text, kind);
	}

	private handleEvent(event: Record<string, unknown>): void {
		const type = event.type as string;
		if (type === "response") return;

		switch (type) {
			case "agent_start":
				this.pendingDeliveryMode = "steer";
				this.runHasAssistantText = false;
				this.runSawToolActivity = false;
				this.keepWorkflowExpandedUntilAssistantText = true;
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

			case "agent_end": {
				this.cancelStreamingUiReconcile();
				if (this.state) {
					this.state = { ...this.state, isStreaming: false };
					this.onStateChange?.(this.state);
				}
				const last = this.messages[this.messages.length - 1];
				if (last && last.role === "assistant") {
					last.isStreaming = false;
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
				if (role === "assistant") {
					const last = this.messages[this.messages.length - 1];
					if (last?.role === "assistant" && last.isStreaming) {
						break;
					}
					const initialText = this.extractText(msg.content);
					const assistantError = this.extractAssistantMessageError(msg);
					this.messages.push({
						id: uid("assistant"),
						role: "assistant",
						text: initialText,
						errorText: assistantError || undefined,
						toolCalls: [],
						isStreaming: true,
						thinkingExpanded: this.allThinkingExpanded,
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
				const last = this.messages[this.messages.length - 1];

				if (subtype === "error") {
					if (last?.role === "assistant") {
						last.isStreaming = false;
						const streamError = this.extractRuntimeErrorMessage(assistantEvent) || this.extractRuntimeErrorMessage(event);
						if (streamError) {
							last.errorText = streamError;
						}
					}
					this.render();
					break;
				}

				if (!last || last.role !== "assistant") break;

				if (subtype === "text_delta") {
					const partialText = this.extractAssistantPartialContent(assistantEvent, "text");
					last.text = this.mergeStreamingText(last.text, partialText, assistantEvent.delta);
					if (last.text.trim().length > 0) {
						this.runHasAssistantText = true;
						if (this.runSawToolActivity) {
							this.keepWorkflowExpandedUntilAssistantText = false;
						}
					}
					this.scheduleStreamingUiReconcile(1800);
					this.render();
					this.scrollToBottom();
				} else if (subtype === "thinking_delta" || subtype === "reasoning_delta" || subtype.includes("thinking") || subtype.includes("reason")) {
					const partialThinking = this.extractAssistantPartialContent(assistantEvent, "thinking");
					const currentThinking = last.thinking || "";
					last.thinking = this.mergeStreamingText(currentThinking, partialThinking, assistantEvent.delta);
					this.scheduleStreamingUiReconcile(1800);
					if ((last.thinking?.length || 0) % 100 === 0) this.render();
				} else if (subtype === "toolcall_end") {
					this.runSawToolActivity = true;
					this.keepWorkflowExpandedUntilAssistantText = true;
					const tc = assistantEvent.toolCall as Record<string, unknown>;
					if (tc) {
						const rawId = typeof tc.id === "string" ? tc.id.trim() : "";
						const id = rawId || uid("tc");
						const existing = last.toolCalls.find((entry) => entry.id === id);
						if (existing) {
							existing.name = typeof tc.name === "string" && tc.name.trim().length > 0 ? tc.name : existing.name;
							existing.args = ((tc.arguments ?? existing.args) as Record<string, unknown>) || existing.args;
							existing.isRunning = true;
							existing.isExpanded = false;
							existing.startedAt = existing.startedAt ?? Date.now();
							existing.endedAt = undefined;
						} else {
							last.toolCalls.push({
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
				this.compactionCycle = {
					id: uid("compaction"),
					status: "running",
					startedAt: Date.now(),
					endedAt: null,
					summary: "Compacting context…",
					errorMessage: null,
					details: ["Compaction started"],
					expanded: true,
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
					this.compactionCycle = {
						id: uid("compaction"),
						status: "running",
						startedAt: Date.now(),
						endedAt: null,
						summary: "Compacting context…",
						errorMessage: null,
						details: [],
						expanded: true,
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
					this.compactionCycle.details.push("Compaction completed successfully.");
					this.pushNotice("Auto-compaction complete", "success");
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
				this.appendRuntimeSystemLine(retryLine);
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
					this.appendRuntimeSystemLine(attempt ? `Retry succeeded on attempt ${attempt}` : "Retry succeeded");
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
				const source = pickString(event, ["source", "callback", "method", "extension", "provider"]);
				const prefix = source ? `Extension error (${source})` : "Extension error";
				this.pushRuntimeNotice(`${prefix}: ${truncate(error, 180)}`, "error", 2600);
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
		this.render();
		this.scrollToBottom(true);
	}

	private clearComposer(): void {
		this.inputText = "";
		this.pendingImages = [];
		this.selectedSkillDraft = null;
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
		if (!text && images.length === 0) return;

		let streaming = this.currentIsStreaming();
		if (streaming) {
			try {
				const backendState = await rpcBridge.getState();
				const backendStreaming = Boolean(backendState.isStreaming);
				this.state = backendState;
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

		this.pushUserEcho(text, actualMode, images);
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
			}
			this.onPromptSubmitted?.();
		} catch (err) {
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

	async copyLastMessage(): Promise<void> {
		try {
			const text = await rpcBridge.getLastAssistantText();
			if (!text) {
				this.pushNotice("No assistant message to copy", "info");
				return;
			}
			await navigator.clipboard.writeText(text);
			this.pushNotice("Copied last assistant message", "success");
		} catch (err) {
			console.error("Failed to copy:", err);
			this.pushNotice("Failed to copy message", "error");
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

	async shareAsGist(): Promise<void> {
		try {
			const { path } = await rpcBridge.exportHtml();
			const { readTextFile } = await import("@tauri-apps/plugin-fs");
			const html = await readTextFile(path);
			await navigator.clipboard.writeText(html);
			this.pushNotice("Copied exported HTML to clipboard", "success");
		} catch (err) {
			console.error("Failed to copy exported HTML:", err);
			this.pushNotice("Failed to copy exported HTML", "error");
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
		this.onRunStateChange?.(false);
	}

	private async reconcileStreamingUiState(): Promise<void> {
		try {
			const state = await rpcBridge.getState();
			this.state = state;
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

	async newSession(): Promise<void> {
		try {
			await rpcBridge.newSession();
			this.messages = [];
			await this.refreshFromBackend();
			this.pushNotice("Started new session", "success");
		} catch (err) {
			console.error("Failed to create session:", err);
			this.pushNotice("Failed to create session", "error");
		}
	}

	async compactNow(): Promise<void> {
		try {
			await rpcBridge.compact();
			await this.refreshFromBackend();
			this.pushNotice("Compaction complete", "success");
		} catch (err) {
			console.error("Failed to compact:", err);
			this.pushNotice("Compaction failed", "error");
		}
	}

	async renameSession(): Promise<void> {
		const current = this.state?.sessionName || "";
		const next = window.prompt("Session name", current);
		if (!next || !next.trim()) return;
		try {
			await rpcBridge.setSessionName(next.trim());
			await this.refreshFromBackend();
			this.pushNotice("Session renamed", "success");
		} catch (err) {
			this.pushNotice("Failed to rename session", "error");
		}
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

	openHistoryViewer(): void {
		this.historyViewerOpen = true;
		this.historyViewerMode = "browse";
		this.historyViewerLoading = false;
		this.historyViewerSessionLabel = "";
		this.forkExpandedMessageRows.clear();
		this.forkExpandedToolRows.clear();
		this.render();
	}

	openHistoryViewerForFork(options?: { loading?: boolean; sessionName?: string | null }): void {
		this.historyViewerOpen = true;
		this.historyViewerMode = "fork";
		this.historyViewerLoading = options?.loading ?? false;
		this.historyViewerSessionLabel = options?.sessionName?.trim() || this.state?.sessionName?.trim() || "";
		this.historyQuery = "";
		this.historyRoleFilter = "all";
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
		this.historyQuery = "";
		this.historyRoleFilter = "all";
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
			this.hydrateForkTargetsFromOptions(options);
		} catch (err) {
			if (requestId !== this.forkTargetsRequestSeq || this.historyViewerMode !== "fork") return;
			console.error("Failed to load fork points:", err);
			this.pushNotice("Failed to load fork points", "error");
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

	private shouldShowWorkingIndicator(): boolean {
		if (!this.currentIsStreaming()) return false;
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
						${msg.deliveryMode && msg.deliveryMode !== "prompt"
							? html`<div class="bubble-chip">${msg.deliveryMode === "steer" ? "steer" : "follow-up"}</div>`
							: nothing}
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
		for (const part of paragraphs) {
			if (deduped[deduped.length - 1] === part) continue;
			deduped.push(part);
		}
		text = deduped.join("\n\n").trim();
		const half = Math.floor(text.length / 2);
		if (text.length > 40 && text.length % 2 === 0 && text.slice(0, half) === text.slice(half)) {
			text = text.slice(0, half).trim();
		}
		return text;
	}

	private renderThinking(msg: UiMessage): TemplateResult | typeof nothing {
		if (!msg.thinking) return nothing;
		const expanded = msg.thinkingExpanded ?? false;
		const label = "thinking…";
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

	private toggleToolWorkflowExpanded(workflowId: string): void {
		if (this.expandedToolWorkflowIds.has(workflowId)) {
			this.expandedToolWorkflowIds.delete(workflowId);
			this.expandedToolGroupByWorkflowId.delete(workflowId);
			this.expandedWorkflowThinkingIds.delete(workflowId);
		} else {
			this.expandedToolWorkflowIds.add(workflowId);
		}
		this.render();
	}

	private isWorkflowThinkingExpanded(workflowId: string): boolean {
		return this.expandedWorkflowThinkingIds.has(workflowId);
	}

	private toggleWorkflowThinkingExpanded(workflowId: string): void {
		if (this.expandedWorkflowThinkingIds.has(workflowId)) {
			this.expandedWorkflowThinkingIds.delete(workflowId);
		} else {
			this.expandedWorkflowThinkingIds.add(workflowId);
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
		if (!start || start.role !== "assistant" || start.toolCalls.length === 0) return null;

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

			if (!sawTools) break;

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

		const toolCalls = grouped.flatMap((entry) => entry.toolCalls);
		if (toolCalls.length === 0) return null;

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
		const firstId = grouped[0]?.id ?? uid("workflow");
		const workflowId = `workflow-${firstId}`;

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
		const total = workflow.toolCalls.length;
		const running = workflow.toolCalls.filter((tc) => tc.isRunning).length;
		const failed = workflow.toolCalls.filter((tc) => tc.isError).length;
		const durationMs =
			workflow.startedAt > 0
				? (running > 0 ? Date.now() : Math.max(workflow.endedAt, workflow.startedAt)) - workflow.startedAt
				: 0;
		const durationLabel = durationMs > 0 ? formatDuration(durationMs) : "0s";
		const summaryPrimary = durationLabel;
		const summarySecondary = running > 0 ? `${total} running` : failed > 0 ? `${failed} failed` : `${total} complete`;
		const hasFinalContent = Boolean(workflow.finalText || workflow.errorText);
		const manualExpanded = this.isToolWorkflowExpanded(workflow.id);
		const autoExpanded = workflow.isTerminal && this.keepWorkflowExpandedUntilAssistantText && (running > 0 || this.runSawToolActivity);
		const expanded = autoExpanded || manualExpanded;
		const thinkingExpanded = this.isWorkflowThinkingExpanded(workflow.id);
		if (!expanded) {
			this.expandedToolGroupByWorkflowId.delete(workflow.id);
			this.expandedWorkflowThinkingIds.delete(workflow.id);
		}

		return html`
			<div class="chat-row assistant-row assistant-workflow-row" data-message-id=${workflow.id}>
				<div class="message-shell assistant-message-shell">
					<div class="assistant-block">
						<button
							class="tool-workflow-summary"
							@click=${() => {
								if (autoExpanded) return;
								this.toggleToolWorkflowExpanded(workflow.id);
							}}
						>
							<span class="workflow-divider" aria-hidden="true"></span>
							<span class="workflow-summary-center">
								<span class="workflow-summary-label">${summaryPrimary}</span>
								<span class="workflow-summary-meta">${summarySecondary}</span>
								<span class="workflow-summary-caret">${expanded ? "▾" : "▸"}</span>
							</span>
							<span class="workflow-divider" aria-hidden="true"></span>
						</button>
						${expanded
							? html`
								${workflow.thinkingText
									? html`
										<div class="tool-workflow-thinking">
											<button class="tool-workflow-thinking-toggle ${autoExpanded ? "animating" : "done"}" @click=${() => this.toggleWorkflowThinkingExpanded(workflow.id)}>
												<span class="tool-workflow-thinking-caret">${thinkingExpanded ? "▾" : "▸"}</span>
												${"thinking…".split("").map((char, index) => html`<span class="thinking-char" style=${`--thinking-char-index:${index};`}>${char}</span>`)}
											</button>
											${thinkingExpanded ? html`<div class="tool-workflow-thinking-content">${workflow.thinkingText}</div>` : nothing}
										</div>
									`
									: nothing}
								<div class="tool-workflow-list">
									${workflow.toolGroups.map((group) => {
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
									? html`<div class="assistant-content ${workflow.isStreaming ? "streaming-cursor" : ""}"><markdown-block .content=${workflow.finalText}></markdown-block></div>`
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
		for (let index = 0; index < this.messages.length; index += 1) {
			const msg = this.messages[index];
			if (msg.role === "assistant" && msg.toolCalls.length > 0) {
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
				rows.push(this.renderAssistantMessage(msg));
				continue;
			}
			rows.push(this.renderSystemMessage(msg));
		}
		return rows;
	}

	private renderAssistantMessage(msg: UiMessage): TemplateResult {
		const canCopy = Boolean(msg.text.trim().length > 0 || (msg.errorText ?? "").trim().length > 0);
		const errorLine = (msg.errorText ?? "").trim();
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
								<div class="assistant-content ${msg.isStreaming ? "streaming-cursor" : ""}">
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
		return html`
			<div class="chat-row system-row" data-message-id=${msg.id}>
				<div class="system-message">
					${msg.label ? html`<div class="system-label">${msg.label}</div>` : nothing}
					<div class="system-text">${msg.text}</div>
				</div>
			</div>
		`;
	}

	private renderCompactionCycle(): TemplateResult | typeof nothing {
		if (!this.compactionCycle) return nothing;
		const cycle = this.compactionCycle;
		const completed = cycle.endedAt ?? Date.now();
		const elapsed = formatDuration(completed - cycle.startedAt);
		const statusText =
			cycle.status === "running"
				? "running"
				: cycle.status === "error"
					? "failed"
					: cycle.status === "aborted"
						? "aborted"
						: "done";
		return html`
			<div class="chat-row system-row compaction-row" data-message-id=${cycle.id}>
				<div class="compaction-card ${cycle.status}">
					<button
						class="compaction-header"
						@click=${() => {
							cycle.expanded = !cycle.expanded;
							this.render();
						}}
					>
						<span class="compaction-title">Context compaction</span>
						<span class="compaction-meta">${elapsed} · ${statusText}</span>
						<span class="compaction-caret">${cycle.expanded ? "▾" : "▸"}</span>
					</button>
					${cycle.expanded
						? html`
							<div class="compaction-details">
								<div class="compaction-summary">${cycle.summary}</div>
								${cycle.errorMessage ? html`<div class="compaction-error">${cycle.errorMessage}</div>` : nothing}
								${cycle.details.map((line) => html`<div class="compaction-line">${line}</div>`)}
							</div>
						`
						: nothing}
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

		const groupedByProvider = new Map<string, { providerKey: string; providerLabel: string; models: ModelOption[] }>();
		for (const model of this.availableModels) {
			const providerKey = model.provider;
			const existing = groupedByProvider.get(providerKey);
			if (existing) {
				existing.models.push(model);
			} else {
				groupedByProvider.set(providerKey, {
					providerKey,
					providerLabel: formatProviderDisplayName(providerKey),
					models: [model],
				});
			}
		}

		if (currentProvider && currentModelId && !this.availableModels.some((m) => m.provider === currentProvider && m.id === currentModelId)) {
			const existing = groupedByProvider.get(currentProvider);
			const fallbackModel: ModelOption = {
				provider: currentProvider,
				id: currentModelId,
				label: `${currentProvider}/${currentModelId}`,
				reasoning: false,
			};
			if (existing) existing.models.unshift(fallbackModel);
			else {
				groupedByProvider.set(currentProvider, {
					providerKey: currentProvider,
					providerLabel: formatProviderDisplayName(currentProvider),
					models: [fallbackModel],
				});
			}
		}

		const providerGroups = Array.from(groupedByProvider.values())
			.map((group) => ({
				...group,
				models: [...group.models].sort((a, b) =>
					formatModelDisplayName(a.id).localeCompare(formatModelDisplayName(b.id), undefined, { sensitivity: "base" }),
				),
			}))
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
						title="Attach image"
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
							?disabled=${interactionLocked || this.loadingModels || this.settingModel}
							@click=${() => {
								if (interactionLocked || this.settingModel) return;
								if (!this.loadingModels && this.availableModels.length === 0) {
									void this.loadAvailableModels();
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
									${this.loadingModels
										? html`<div class="model-picker-empty">Loading models…</div>`
										: providerGroups.length === 0
											? html`<div class="model-picker-empty">No models available</div>`
											: html`
												<div class="model-picker-providers">
													${providerGroups.map(
														(group) => html`
															<button
																type="button"
																class="model-picker-provider ${group.providerKey === resolvedActiveProvider ? "active" : ""}"
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
																<span class="model-picker-provider-caret" aria-hidden="true">›</span>
															</button>
														`,
													)}
												</div>
												<div class="model-picker-models">
													${activeProviderGroup
														? activeProviderGroup.models.map(
															(model) => html`
																<button
																	type="button"
																	class="model-picker-model ${model.provider === currentProvider && model.id === currentModelId ? "active" : ""}"
																	title=${`${formatProviderDisplayName(model.provider)} / ${model.id}`}
																	@click=${() => {
																		const nextValue = `${model.provider}::${model.id}`;
																		this.modelPickerOpen = false;
																		this.render();
																		if (nextValue === currentModelValue) return;
																		void this.setModel(model.provider, model.id);
																	}}
																>
																	<span>${formatModelDisplayName(model.id)}</span>
																</button>
															`,
														)
														: html`<div class="model-picker-empty">No models</div>`}
												</div>
											`}
								</div>
							`
							: nothing}
					</div>

					<div class="thinking-select-wrap" title="Reasoning effort">
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
									title="Send"
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
			const menuTop = menu.scrollTop;
			const menuBottom = menuTop + menu.clientHeight;
			const itemTop = activeItem.offsetTop;
			const itemBottom = itemTop + activeItem.offsetHeight;
			if (itemTop < menuTop) {
				menu.scrollTop = Math.max(0, itemTop - 4);
				return;
			}
			if (itemBottom > menuBottom) {
				menu.scrollTop = itemBottom - menu.clientHeight + 4;
			}
		});
	}

	private renderSlashPalette(items: SlashPaletteItem[]): TemplateResult | typeof nothing {
		if (!this.slashPaletteOpen) return nothing;
		if (this.slashSkillsLoading && items.length === 0) {
			return html`<div class="composer-slash-menu"><div class="composer-slash-empty">Loading commands…</div></div>`;
		}
		if (items.length === 0) {
			return html`<div class="composer-slash-menu"><div class="composer-slash-empty">No commands match “/${this.slashPaletteQuery}”.</div></div>`;
		}
		const activeIndex = Math.max(0, Math.min(this.slashPaletteIndex, items.length - 1));
		let currentSection: "Actions" | "Skills" | null = null;
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
							<span class="composer-slash-item-label">${item.label}</span>
							<span class="composer-slash-item-hint">${item.hint}</span>
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
		const canSend = canSendBase && !(this.slashPaletteOpen && slashItems.length > 0);
		if (slashItems.length > 0 && this.slashPaletteIndex >= slashItems.length) {
			this.slashPaletteIndex = slashItems.length - 1;
		}
		const connectivityStatus = this.bindingStatusText || (!this.isConnected && this.projectPath ? "RPC disconnected" : "");
		const liveCompactionStatus = this.compactionCycle?.status === "running" ? "Compacting context…" : "";
		const statusText = [connectivityStatus, liveCompactionStatus, this.retryStatus].filter(Boolean).join(" · ");
		const ratio = Math.min(1, Math.max(0, this.sessionStats.usageRatio ?? 0));
		const ratioPercent = `${Math.round(ratio * 100)}%`;
		const ringRadius = 9;
		const circumference = 2 * Math.PI * ringRadius;
		const strokeOffset = circumference * (1 - ratio);
		const statsLines = this.sessionStatsLines();

		return html`
			<div class="composer-shell">
				<div class="composer-inner">
					<div class="composer-panel">
						${this.renderPendingImages()}
						<div class="composer-row">
							${this.renderComposerSkillDraftPill()}
							<textarea
								id="chat-input"
								class="chat-input"
								placeholder=${interactionLocked ? (connectivityStatus || "Session not ready…") : "Ask for follow-up changes"}
								rows="1"
								?disabled=${interactionLocked}
								.value=${this.inputText}
								@input=${(e: Event) => {
									if (interactionLocked) return;
									const ta = e.target as HTMLTextAreaElement;
									const hadSlashPalette = this.slashPaletteOpen;
									this.inputText = ta.value;
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
									const liveSlashItems = this.getSlashPaletteItems();
									if (this.slashPaletteOpen && liveSlashItems.length > 0) {
										if (e.key === "ArrowDown") {
											e.preventDefault();
											this.slashPaletteNavigationMode = "keyboard";
											this.slashPaletteIndex = (this.slashPaletteIndex + 1) % liveSlashItems.length;
											this.render();
											this.ensureActiveSlashItemVisible();
											return;
										}
										if (e.key === "ArrowUp") {
											e.preventDefault();
											this.slashPaletteNavigationMode = "keyboard";
											this.slashPaletteIndex = (this.slashPaletteIndex - 1 + liveSlashItems.length) % liveSlashItems.length;
											this.render();
											this.ensureActiveSlashItemVisible();
											return;
										}
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault();
											const picked = liveSlashItems[Math.max(0, Math.min(this.slashPaletteIndex, liveSlashItems.length - 1))];
											if (picked) this.selectSlashPaletteItem(picked);
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
						${statusText ? html`<div class="composer-status-inline">${statusText}</div>` : nothing}
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

	private renderHistoryViewer(): TemplateResult | typeof nothing {
		if (!this.historyViewerOpen) return nothing;

		const forkMode = this.historyViewerMode === "fork";
		const query = this.historyQuery.trim().toLowerCase();
		const sourceMessages: UiMessage[] = forkMode
			? this.messages.filter((msg) => msg.role === "user" || msg.role === "assistant")
			: this.messages;
		const forkTimelineRows: ForkTimelineRow[] = forkMode ? this.buildForkTimelineRows(sourceMessages) : [];
		const filteredRows: ForkTimelineRow[] = forkMode
			? forkTimelineRows.filter((row) => {
				if (!query) return true;
				const toolsText = row.tools
					.map((tc) => `${tc.name} ${(tc.result ?? tc.streamingOutput ?? "").toString()}`)
					.join(" ");
				const thinkingText = row.thinkingSnippets.join(" ");
				const haystack = `${row.main.role} ${row.main.label || ""} ${this.messagePreview(row.main)} ${thinkingText} ${toolsText}`.toLowerCase();
				return haystack.includes(query);
			})
			: [];
		const filteredMessages: UiMessage[] = forkMode
			? []
			: sourceMessages.filter((msg) => {
				if (this.historyRoleFilter !== "all" && msg.role !== this.historyRoleFilter) return false;
				if (!query) return true;
				const haystack = `${msg.role} ${msg.label || ""} ${this.messagePreview(msg)}`.toLowerCase();
				return haystack.includes(query);
			});
		return html`
			<div class="overlay" @click=${(e: Event) => e.target === e.currentTarget && this.closeHistoryViewer()}>
				<div class="overlay-card history-card ${forkMode ? "fork-mode" : ""}">
					<div class="overlay-header">
						<div>
							<div>${forkMode ? "Fork from message" : "Session history"}</div>
							${forkMode
								? html`<div class="history-subtitle">${this.historyViewerSessionLabel || "Current session"}</div>`
								: nothing}
						</div>
						<button @click=${() => this.closeHistoryViewer()}>✕</button>
					</div>
					<div class="history-controls ${forkMode ? "fork" : ""}">
						<input
							type="text"
							placeholder=${forkMode ? "Search visible messages" : "Search messages"}
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
							: (forkMode ? filteredRows.length === 0 : filteredMessages.length === 0)
								? html`<div class="overlay-empty">${forkMode ? "No messages available for forking." : "No messages match your filters."}</div>`
								: forkMode
									? filteredRows.map((row, idx) => {
											const msg = row.main;
											const rowKey = this.forkRowKey(row);
											const forkEntryId = this.resolveForkEntryId(sourceMessages, row.sourceIndex);
											const rowCanFork = Boolean(forkEntryId) && (msg.role === "user" || msg.text.trim().length > 0);
											const fullPreview = this.forkRowPreview(row);
											const messageExpanded = this.forkExpandedMessageRows.has(rowKey);
											const canExpandMessage = fullPreview.length > 220;
											const previewText = messageExpanded ? fullPreview : truncate(fullPreview, 220);
											const thinkingSnippets = row.thinkingSnippets
												.map((snippet: string) => snippet.replace(/\s+/g, " ").trim())
												.filter(Boolean)
												.map((snippet: string) => truncate(snippet, 140));
											const tools = row.tools;
											const toolsExpanded = this.forkExpandedToolRows.has(rowKey);
											const visibleTools = toolsExpanded ? tools : tools.slice(0, 3);
											const hiddenToolCount = Math.max(0, tools.length - visibleTools.length);
											return html`
												<div class="fork-history-item role-${msg.role}">
													<div class="fork-history-rail" aria-hidden="true">
														<span class="fork-history-dot"></span>
														${idx < filteredRows.length - 1 ? html`<span class="fork-history-line"></span>` : nothing}
													</div>
													<div class="fork-history-main">
														<div class="history-meta">
															<span class="history-role role-${msg.role}">${msg.role}</span>
															<span>#${idx + 1}</span>
														</div>
														<div class="history-preview ${messageExpanded ? "expanded" : ""}">${previewText}</div>
														${canExpandMessage
															? html`<button class="fork-inline-toggle" @click=${() => this.toggleForkMessageExpanded(rowKey)}>${messageExpanded ? "Show less" : "Show full message"}</button>`
															: nothing}
														${thinkingSnippets.length > 0 || tools.length > 0
															? html`
																<div class="fork-history-subentries">
																	${thinkingSnippets.map(
																		(snippet: string) => html`<div class="fork-history-subentry thinking"><span class="fork-subentry-label">thinking</span><span class="fork-subentry-preview">${snippet}</span></div>`,
																	)}
																	${visibleTools.map((tc: ToolCallBlock) => {
																		const toolStatus = tc.isError ? "error" : tc.isRunning ? "running" : "done";
																		const rawToolPreview = (tc.result ?? tc.streamingOutput ?? "").replace(/\s+/g, " ").trim();
																		const toolPreview = toolsExpanded ? truncate(rawToolPreview, 240) : truncate(rawToolPreview, 96);
																		return html`<div class="fork-history-subentry tool"><span class="fork-subentry-label">tool</span><span class="fork-subentry-name">${tc.name} · ${toolStatus}</span>${toolPreview ? html`<span class="fork-subentry-preview">${toolPreview}</span>` : nothing}</div>`;
																	})}
																	${tools.length > 3
																		? html`<button class="fork-inline-toggle" @click=${() => this.toggleForkToolsExpanded(rowKey)}>${toolsExpanded ? "Show fewer tools" : `Show ${hiddenToolCount} more tools`}</button>`
																		: nothing}
																</div>
															`
															: nothing}
													</div>
													<div class="fork-history-actions">
														${rowCanFork && forkEntryId
															? html`<button class="message-action-btn" @click=${() => void this.forkFrom(forkEntryId)} title=${msg.role === "assistant" ? "Fork from preceding user message" : "Fork from this user message"}>Fork</button>`
															: nothing}
													</div>
												</div>
											`;
									  })
									: filteredMessages.map(
											(msg: UiMessage, idx: number) => html`
												<div class="history-item">
													<button class="history-jump" @click=${() => this.revealMessage(msg.id)}>
														<div class="history-meta">
															<span class="history-role role-${msg.role}">${msg.role}</span>
															<span>#${idx + 1}</span>
														</div>
														<div class="history-preview">${truncate(this.messagePreview(msg).replace(/\s+/g, " "), 200)}</div>
													</button>
												</div>
											`,
									  )}
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
					${hasProject ? this.renderCompactionCycle() : nothing}
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
