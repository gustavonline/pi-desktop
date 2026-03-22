/**
 * ChatView - rich RPC chat surface for Pi Desktop
 */

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

function uiIcon(name: "edit" | "retry" | "copy" | "attach" | "send" | "stop" | "spark" | "terminal" | "git"): TemplateResult {
	switch (name) {
		case "edit":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 11.8l.5-2.5L10.2 2.8a1.2 1.2 0 0 1 1.7 0l1.3 1.3a1.2 1.2 0 0 1 0 1.7l-6.5 6.5z"></path><path d="M3.2 11.8l2.5-.5"></path></svg>`;
		case "retry":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.7 8a4.7 4.7 0 1 1-1.4-3.4"></path><path d="M12.7 4.2v2.4h-2.4"></path></svg>`;
		case "copy":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.4"></rect><rect x="3" y="3" width="8" height="8" rx="1.4"></rect></svg>`;
		case "attach":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.7 7.1L7.8 11a2.5 2.5 0 1 1-3.5-3.5L8.8 3a1.9 1.9 0 1 1 2.7 2.7L6.6 10.6"></path></svg>`;
		case "send":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.8v10.4"></path><path d="M4.9 5.9L8 2.8l3.1 3.1"></path></svg>`;
		case "stop":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="6" height="6" rx="1.1"></rect></svg>`;
		case "spark":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l1.3 3.1 3.2 1.3-3.2 1.3L8 11.3l-1.3-3.1-3.2-1.3 3.2-1.3z"></path></svg>`;
		case "terminal":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2h10v9.6H3z"></path><path d="M5.1 6.2l1.9 1.8-1.9 1.8"></path><path d="M8.6 9.8h2.6"></path></svg>`;
		case "git":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="3.6" r="1.2"></circle><circle cx="4" cy="12.4" r="1.2"></circle><circle cx="12" cy="8" r="1.2"></circle><path d="M4 4.8v6.4"></path><path d="M5 4.2l5.8 2.9"></path><path d="M5 11.8l5.8-2.9"></path></svg>`;
	}
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
	private pendingImages: PendingImage[] = [];
	private notices: Notice[] = [];
	private allThinkingExpanded = false;
	private retryStatus = "";
	private compactionStatus = "";
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
	private quickActionsOpen = false;
	private autoFollowChat = true;
	private runHasAssistantText = false;
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
		this.quickActionsOpen = false;
		this.gitMenuOpen = false;
		if (!path) {
			this.bindingStatusText = null;
			this.modelLoadRequestSeq += 1;
			this.loadingModels = false;
			this.runHasAssistantText = false;
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
		this.runHasAssistantText = false;
		this.clearWorkingStatusTimer(true);
		this.bindingStatusText = projectPath ? (statusText ?? "Loading session…") : null;
		this.render();
	}

	getState(): RpcSessionState | null {
		return this.state;
	}

	setInputText(text: string): void {
		this.inputText = text;
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

	connect(): void {
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = rpcBridge.onEvent((event) => this.handleEvent(event));
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
		this.clearWorkingStatusTimer(true);
		for (const unlisten of this.nativeFileDropUnlisteners) {
			unlisten();
		}
		this.nativeFileDropUnlisteners = [];
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
			} else {
				this.runHasAssistantText = false;
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
					if (initialText.trim().length > 0) this.runHasAssistantText = true;
					this.render();
					this.scrollToBottom();
					break;
				}

				if (role === "toolResult") {
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
					} else {
						this.messages.push({
							id: uid("toolResult"),
							role: "system",
							text: `Tool result${isError ? " (error)" : ""}:\n${output || "(no output)"}`,
							label: "tool-result",
							toolCalls: [],
						});
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
					if (last.text.trim().length > 0) this.runHasAssistantText = true;
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
						} else {
							last.toolCalls.push({
								id,
								name: (tc.name as string) || "tool",
								args: ((tc.arguments ?? {}) as Record<string, unknown>) || {},
								isRunning: true,
								isExpanded: false,
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
				this.render();
				this.scrollToBottom();
				break;
			}

			case "auto_compaction_start": {
				this.compactionStatus = "Compacting context…";
				this.appendRuntimeSystemLine("Compacting context…");
				this.render();
				break;
			}

			case "auto_compaction_end": {
				this.compactionStatus = "";
				const aborted = Boolean(event.aborted);
				const errorMessage = this.extractRuntimeErrorMessage(event);
				if (aborted) {
					this.appendRuntimeSystemLine("Auto-compaction aborted");
					this.pushNotice("Auto-compaction aborted", "info");
				} else if (errorMessage) {
					this.pushRuntimeNotice(`Auto-compaction failed: ${truncate(errorMessage, 180)}`, "error", 2600);
				} else {
					this.appendRuntimeSystemLine("Auto-compaction complete");
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
		this.render();
		this.scrollToBottom(true);
	}

	private clearComposer(): void {
		this.inputText = "";
		this.pendingImages = [];
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
		const text = this.inputText.trim();
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
		this.pendingDeliveryMode = "prompt";
		this.runHasAssistantText = false;
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

	private renderThinking(msg: UiMessage): TemplateResult | typeof nothing {
		if (!msg.thinking) return nothing;
		const expanded = msg.thinkingExpanded ?? false;
		const label = "thinking…";
		const toggleClass = `thinking-toggle ${msg.isStreaming ? "animating" : "done"}`;
		const thinkingText = msg.thinking.replace(/^\s+/, "");
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

	private renderToolCall(tc: ToolCallBlock): TemplateResult {
		const statusClass = tc.isRunning ? "status-running" : tc.isError ? "status-error" : "status-ok";
		const titleHint = tc.name === "bash" && typeof tc.args.command === "string" ? (tc.args.command as string) : "";
		const output = (tc.streamingOutput ?? tc.result ?? "").trimEnd();
		const hasOutput = output.length > 0;
		const placeholder = tc.isRunning ? "Waiting for tool output…" : "No output reported.";

		return html`
			<div class="tool-card">
				<button
					class="tool-header"
					@click=${() => {
						tc.isExpanded = !tc.isExpanded;
						this.render();
					}}
				>
					<span class="status-dot ${statusClass}"></span>
					<span class="tool-name">${tc.name}</span>
					${titleHint ? html`<span class="tool-hint" title=${titleHint}>${truncate(titleHint, 56)}</span>` : nothing}
					<span class="tool-chevron">${tc.isExpanded ? "▾" : "▸"}</span>
				</button>
				${tc.isExpanded
					? html`
						<pre class="tool-output ${hasOutput ? "" : "tool-output-empty"}">${hasOutput ? output : placeholder}${tc.isRunning
							? html`<span class="streaming-inline"></span>`
							: nothing}</pre>
					`
					: nothing}
			</div>
		`;
	}

	private renderAssistantMessage(msg: UiMessage): TemplateResult {
		const canCopy = Boolean(
			msg.text.trim().length > 0 ||
				msg.toolCalls.length > 0 ||
				(msg.thinking ?? "").trim().length > 0 ||
				(msg.errorText ?? "").trim().length > 0,
		);
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
						${msg.toolCalls.map((tc) => this.renderToolCall(tc))}
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
		return html`
			<div class="chat-row assistant-row intro-row">
				<div class="message-shell assistant-message-shell">
					<div class="assistant-block intro-block">
						<div class="assistant-content intro-text">Hey! How can I help you today?</div>
					</div>
				</div>
			</div>
			<div class="chat-row intro-actions-row">
				<div class="intro-actions">
					<button class="ghost-btn intro-chip" @click=${() => this.setInputText("Summarize this repository and suggest the top 5 improvements")}>Summarize repository</button>
					<button class="ghost-btn intro-chip" @click=${() => this.setInputText("Find bugs and propose a prioritized fix plan")}>Find bugs</button>
				</div>
			</div>
		`;
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
		const snapshot = this.welcomeDashboard;
		const modelProvider = normalizeText(this.state?.model?.provider);
		const modelId = normalizeText(this.state?.model?.id);
		const modelLabel = modelProvider && modelId ? `${modelProvider}/${modelId}` : "No active model";
		const highlights = [
			...snapshot.skills.slice(0, 4).map((item) => `Skill · ${item}`),
			...snapshot.extensions.slice(0, 4).map((item) => `Extension · ${item}`),
		].slice(0, 8);
		const cliLabel = snapshot.currentCliVersion ? `v${snapshot.currentCliVersion}` : "Unavailable";
		const updateLabel = snapshot.updateAvailable
			? `Update available${snapshot.latestCliVersion ? ` · v${snapshot.latestCliVersion}` : ""}`
			: "CLI up to date";

		return html`
			<div class="welcome-dashboard">
				<div class="welcome-hero">
					<div class="welcome-eyebrow">No project open</div>
					<h2>Open a project to start a Pi workspace</h2>
					<p>Chat, files, terminal, and packages become available as soon as you add a project.</p>
					<div class="welcome-actions">
						<button class="welcome-action primary" @click=${() => this.onAddProject?.()}>Add project</button>
						<button class="welcome-action" @click=${() => this.onOpenPackages?.()}>Open packages</button>
						<button class="welcome-action" @click=${() => this.onOpenSettings?.()}>Settings</button>
					</div>
				</div>

				<div class="welcome-grid minimal">
					<section class="welcome-card compact">
						<div class="welcome-card-title">Local Pi environment</div>
						<div class="welcome-kpis compact">
							<div><span>Skills</span><strong>${snapshot.skills.length}</strong></div>
							<div><span>Extensions</span><strong>${snapshot.extensions.length}</strong></div>
							<div><span>Themes</span><strong>${snapshot.themes.length}</strong></div>
							<div><span>CLI</span><strong>${cliLabel}</strong></div>
						</div>
						${snapshot.loading
							? html`<div class="welcome-empty">Refreshing local Pi inventory…</div>`
							: highlights.length > 0
								? html`<div class="welcome-chip-list">${highlights.map((item) => html`<span class="welcome-chip">${item}</span>`)}</div>`
								: html`<div class="welcome-empty">No extra skills or extensions detected yet.</div>`}
						<div class="welcome-runtime-row"><span>Model</span><strong>${modelLabel}</strong></div>
						<div class="welcome-runtime-row"><span>Status</span><strong>${updateLabel}</strong></div>
						<div class="welcome-actions compact">
							<button class="welcome-action" @click=${() => void this.refreshWelcomeDashboard(true)}>Refresh</button>
							<button class="welcome-action" @click=${() => void this.openExternalUrl("https://github.com/mariozechner/pi-coding-agent")}>Pi docs</button>
						</div>
						${snapshot.error ? html`<div class="welcome-error">${snapshot.error}</div>` : nothing}
						<div class="welcome-updated">Updated ${formatAge(snapshot.updatedAt)}</div>
					</section>
				</div>
			</div>
		`;
	}

	private renderComposerControls(canSend: boolean, isStreaming: boolean, interactionLocked: boolean): TemplateResult {
		const currentProvider = normalizeText(this.state?.model?.provider);
		const currentModelId = normalizeText(this.state?.model?.id);
		const currentModelValue = currentProvider && currentModelId ? `${currentProvider}::${currentModelId}` : "";
		const thinking = this.state?.thinkingLevel ?? "off";
		const thinkingValue = thinking;
		const thinkingLabel = thinkingValue;

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

					<div class="model-select-wrap">
						<select
							class="composer-select model-select"
							.value=${currentModelValue}
							?disabled=${interactionLocked || this.loadingModels || this.settingModel}
							@pointerdown=${() => {
								if (!this.loadingModels && this.availableModels.length === 0) {
									void this.loadAvailableModels();
								}
							}}
							@focus=${() => {
								if (!this.loadingModels && this.availableModels.length === 0) {
									void this.loadAvailableModels();
								}
							}}
							@change=${(e: Event) => {
								const value = (e.target as HTMLSelectElement).value;
								const [provider, ...rest] = value.split("::");
								const modelId = rest.join("::");
								if (!provider || !modelId || value === currentModelValue) return;
								void this.setModel(provider, modelId);
							}}
						>
							${this.loadingModels ? html`<option value="">Loading models…</option>` : nothing}
							${!this.loadingModels && this.availableModels.length === 0
								? html`<option value="">No models loaded</option>`
								: nothing}
							${!this.loadingModels && currentModelValue && !this.availableModels.some((m) => `${m.provider}::${m.id}` === currentModelValue)
								? html`<option value=${currentModelValue}>${currentProvider}/${currentModelId}</option>`
								: nothing}
							${this.availableModels.map((m) => html`<option value=${`${m.provider}::${m.id}`}>${m.provider}/${m.id}</option>`)}
						</select>
						<span class="composer-select-caret">▾</span>
					</div>

					<div class="thinking-select-wrap">
						<span class="thinking-select-label">thinking · ${thinkingLabel}</span>
						<select
							class="thinking-select-native"
							.value=${thinkingValue}
							?disabled=${interactionLocked || this.settingThinking}
							@change=${(e: Event) => void this.setThinkingLevel((e.target as HTMLSelectElement).value as ThinkingLevel)}
						>
							<option value="off">Off</option>
							<option value="minimal">Minimal</option>
							<option value="low">Low</option>
							<option value="medium">Medium</option>
							<option value="high">High</option>
							<option value="xhigh">Xhigh</option>
						</select>
						<span class="thinking-select-caret">▾</span>
					</div>
				</div>

				<div class="control-group right">
					<div class="chat-actions-menu-wrap">
						<button
							class="composer-icon-btn"
							title="Session actions"
							?disabled=${interactionLocked}
							@click=${() => {
								if (interactionLocked) return;
								this.quickActionsOpen = !this.quickActionsOpen;
								this.render();
							}}
						>
							${uiIcon("spark")}
						</button>
						${this.quickActionsOpen
							? html`
								<div class="chat-actions-menu">
									<button @click=${() => {
										this.quickActionsOpen = false;
										this.render();
										void this.newSession();
									}}>New session</button>
									<button @click=${() => {
										this.quickActionsOpen = false;
										this.render();
										void this.renameSession();
									}}>Rename session</button>
									<button @click=${() => {
										this.quickActionsOpen = false;
										this.render();
										this.onOpenTerminal?.();
									}}>Open terminal</button>
									<button @click=${() => {
										this.quickActionsOpen = false;
										this.render();
										void this.compactNow();
									}}>Compact context</button>
									<button @click=${() => {
										this.quickActionsOpen = false;
										this.render();
										this.openHistoryViewerForFork({ loading: false, sessionName: this.state?.sessionName ?? null });
									}}>Fork from message</button>
									<button @click=${() => {
										this.quickActionsOpen = false;
										this.render();
										this.openHistoryViewer();
									}}>Open history</button>
									<button @click=${() => {
										this.quickActionsOpen = false;
										this.render();
										void this.copyLastMessage();
									}}>Copy last answer</button>
									<button @click=${() => {
										this.quickActionsOpen = false;
										this.render();
										void this.exportToHtml();
									}}>Export HTML</button>
								</div>
							`
							: nothing}
					</div>
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

	private renderComposer(): TemplateResult {
		const isStreaming = this.currentIsStreaming();
		const interactionLocked = this.isComposerInteractionLocked();
		const canSend = !interactionLocked && (this.inputText.trim().length > 0 || this.pendingImages.length > 0);
		const connectivityStatus = this.bindingStatusText || (!this.isConnected && this.projectPath ? "RPC disconnected" : "");
		const statusText = [connectivityStatus, this.compactionStatus, this.retryStatus].filter(Boolean).join(" · ");
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
									this.inputText = ta.value;
									ta.style.height = "auto";
									ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
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
						${this.renderComposerControls(canSend, isStreaming, interactionLocked)}
						${statusText ? html`<div class="composer-status-inline">${statusText}</div>` : nothing}
					</div>

					<div class="composer-under-row">
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
						${this.renderGitRepoControl()}
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

					if (this.quickActionsOpen && !target.closest(".chat-actions-menu-wrap")) {
						this.quickActionsOpen = false;
						changed = true;
					}

					if (this.gitMenuOpen && !target.closest(".git-branch-wrap")) {
						this.gitMenuOpen = false;
						this.gitBranchQuery = "";
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
							? html`${this.messages.map((m) => {
									if (m.role === "user") return this.renderUserMessage(m);
									if (m.role === "assistant") return this.renderAssistantMessage(m);
									return this.renderSystemMessage(m);
								})}`
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
	}

	render(): void {
		this.doRender();
		this.scrollToBottom();
		this.syncWorkingStatusAnimation();
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
