/**
 * RPC Bridge - typed frontend API for pi --mode rpc
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type QueueMode = "all" | "one-at-a-time";
export type StreamingBehavior = "steer" | "followUp";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface RpcStartOptions {
	cliPath: string | null;
	cwd: string;
	provider?: string;
	model?: string;
	env?: Record<string, string>;
}

export interface RpcImageInput {
	type: "image";
	data: string;
	mimeType: string;
}

export interface RpcPromptOptions {
	images?: RpcImageInput[];
	streamingBehavior?: StreamingBehavior;
}

export interface RpcSessionState {
	model?: { provider: string; id: string; contextWindow?: number; reasoning?: boolean };
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: QueueMode;
	followUpMode: QueueMode;
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

export interface PiCliCommandResult {
	stdout: string;
	stderr: string;
	exit_code: number;
	discovery: string;
}

export interface PiAuthProviderStatus {
	provider: string;
	source: "auth_file_api_key" | "auth_file_oauth" | "environment";
	kind: "api_key" | "oauth" | "unknown";
}

export interface PiAuthStatus {
	agent_dir: string | null;
	auth_file: string | null;
	auth_file_exists: boolean;
	configured_providers: PiAuthProviderStatus[];
}

export interface CliUpdateStatus {
	discovery: string;
	current_version: string | null;
	latest_version: string | null;
	update_available: boolean;
	can_update_in_app: boolean;
	npm_available: boolean;
	update_command: string;
	note: string | null;
}

export interface NpmCommandResult {
	stdout: string;
	stderr: string;
	exit_code: number;
}

export interface GitCommandResult {
	stdout: string;
	stderr: string;
	exit_code: number;
}

export interface RpcCompatibilityReport {
	ok: boolean;
	checks: string[];
	error?: string;
	checkedAt: number;
}

export type RpcEventCallback = (event: Record<string, unknown>) => void;

interface RpcLineEventPayload {
	instance_id?: string;
	instanceId?: string;
	generation?: number;
	line?: string;
}

interface RpcClosedEventPayload {
	instance_id?: string;
	instanceId?: string;
	generation?: number;
	reason?: string;
}

interface RpcStartResult {
	discovery: string;
	generation: number;
}

interface PendingRequestEntry {
	resolve: (data: Record<string, unknown>) => void;
	reject: (err: Error) => void;
}

function normalizeInstanceId(value: string | null | undefined): string {
	const raw = (value ?? "").trim();
	return raw.length > 0 ? raw : "default";
}

function payloadInstanceId(payload: RpcLineEventPayload | RpcClosedEventPayload): string {
	return normalizeInstanceId(payload.instance_id ?? payload.instanceId ?? "default");
}

function payloadGeneration(payload: RpcLineEventPayload | RpcClosedEventPayload): number | null {
	return typeof payload.generation === "number" && Number.isFinite(payload.generation) ? payload.generation : null;
}

function traceBridge(message: string): void {
	console.debug(`[rpc-bridge] ${message}`);
	const push = (window as typeof window & {
		__PI_DESKTOP_PUSH_TRACE__?: (message: string) => void;
	}).__PI_DESKTOP_PUSH_TRACE__;
	push?.(message);
}

function sanitizeRpcLine(line: string): string {
	let cleaned = line
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
		.trim();
	if (!cleaned) return "";
	const firstBrace = cleaned.indexOf("{");
	if (firstBrace > 0) {
		cleaned = cleaned.slice(firstBrace);
	}
	return cleaned;
}

const ACTIONABLE_RUNTIME_ERROR_HINTS = [
	"usage limit",
	"rate limit",
	"quota",
	"insufficient_quota",
	"too many requests",
	"provider unavailable",
	"service unavailable",
	"model overloaded",
	"invalid api key",
	"authentication",
	"unauthorized",
	"forbidden",
	"billing",
	"credits",
	"timed out",
	"timeout",
	"connection reset",
	"context window",
	"max tokens",
	"compaction",
] as const;

function sanitizeRuntimeTextLine(line: string): string {
	return line
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
		.trim();
}

function extractRuntimeErrorFromTextLine(line: string): string | null {
	const cleaned = sanitizeRuntimeTextLine(line);
	if (!cleaned) return null;

	const normalized = cleaned.toLowerCase();
	if (/^error\b[:\s-]*/i.test(cleaned)) {
		const withoutPrefix = cleaned.replace(/^error\b[:\s-]*/i, "").trim();
		return withoutPrefix || cleaned;
	}

	const hasErrorWord = /\berror\b/i.test(cleaned);
	const hasFailureWord = /\b(failed|failure|cannot|can't|denied|unavailable)\b/i.test(cleaned);
	const hasActionableHint = ACTIONABLE_RUNTIME_ERROR_HINTS.some((hint) => normalized.includes(hint));

	if (hasErrorWord && hasActionableHint) return cleaned;
	if (hasFailureWord && hasActionableHint) return cleaned;
	if (normalized.includes("429") && (normalized.includes("requests") || normalized.includes("rate limit"))) {
		return cleaned;
	}

	return null;
}

export class RpcBridge {
	private readonly instanceId: string;
	private requestId = 0;
	private pendingRequests = new Map<
		string,
		PendingRequestEntry
	>();
	private eventListeners: RpcEventCallback[] = [];
	private unlistenEvent: UnlistenFn | null = null;
	private unlistenClosed: UnlistenFn | null = null;
	private unlistenStderr: UnlistenFn | null = null;
	private listenersReady = false;
	private listenersReadyPromise: Promise<void> | null = null;
	private _isConnected = false;
	private currentGeneration: number | null = null;
	private pendingGeneration: number | null = null;
	private lastStartOptions: RpcStartOptions | null = null;
	private lastDiscoveryInfo: string | null = null;
	private parseFailureCount = 0;

	constructor(instanceId = "default") {
		this.instanceId = normalizeInstanceId(instanceId);
	}

	getInstanceId(): string {
		return this.instanceId;
	}

	get isConnected(): boolean {
		return this._isConnected;
	}

	get discoveryInfo(): string | null {
		return this.lastDiscoveryInfo;
	}

	async start(options: RpcStartOptions): Promise<string> {
		await this.ensureListeners();
		this.pendingGeneration = (this.currentGeneration ?? 0) + 1;

		try {
			traceBridge(`start instance=${this.instanceId} cwd=${options.cwd}`);
			const result = await invoke<RpcStartResult>("rpc_start", {
				options: {
					cli_path: options.cliPath ?? null,
					cwd: options.cwd,
					provider: options.provider || null,
					model: options.model || null,
					env: options.env || null,
				},
				instanceId: this.instanceId,
			});

			this._isConnected = true;
			this.currentGeneration = typeof result.generation === "number" && Number.isFinite(result.generation)
				? result.generation
				: this.pendingGeneration;
			this.pendingGeneration = null;
			this.lastStartOptions = { ...options };
			this.lastDiscoveryInfo = result.discovery;
			traceBridge(`started instance=${this.instanceId} generation=${this.currentGeneration ?? -1} discovery=${result.discovery}`);
			this.emitToListeners({ type: "rpc_connected", discovery: result.discovery });
			return result.discovery;
		} catch (err) {
			this.pendingGeneration = null;
			traceBridge(`start-failed instance=${this.instanceId}: ${err instanceof Error ? err.message : String(err)}`);
			throw err;
		}
	}

	async stop(): Promise<void> {
		await this.ensureListeners();
		traceBridge(`stop instance=${this.instanceId}`);
		this._isConnected = false;
		this.rejectAllPending("RPC stopped");
		await invoke("rpc_stop", { instanceId: this.instanceId });
	}

	async stopAll(): Promise<void> {
		this._isConnected = false;
		this.rejectAllPending("RPC stopped");
		await invoke("rpc_stop_all");
	}

	async refreshRunningState(): Promise<boolean> {
		const running = await invoke<boolean>("rpc_is_running", { instanceId: this.instanceId });
		this._isConnected = running;
		return running;
	}

	onEvent(callback: RpcEventCallback): () => void {
		void this.ensureListeners().catch((err) => {
			traceBridge(`listener-init-failed instance=${this.instanceId}: ${err instanceof Error ? err.message : String(err)}`);
		});
		this.eventListeners.push(callback);
		return () => {
			const idx = this.eventListeners.indexOf(callback);
			if (idx !== -1) this.eventListeners.splice(idx, 1);
		};
	}

	// -------------------------------------------------------------------------
	// Commands
	// -------------------------------------------------------------------------

	async prompt(message: string, options: RpcPromptOptions = {}): Promise<void> {
		await this.send({ type: "prompt", message, images: options.images, streamingBehavior: options.streamingBehavior });
	}

	async steer(message: string, images?: RpcImageInput[]): Promise<void> {
		await this.send({ type: "steer", message, images });
	}

	async followUp(message: string, images?: RpcImageInput[]): Promise<void> {
		await this.send({ type: "follow_up", message, images });
	}

	async abort(): Promise<void> {
		await this.send({ type: "abort" });
	}

	async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
		const response = await this.send({ type: "new_session", parentSession });
		return this.getData(response);
	}

	async getState(): Promise<RpcSessionState> {
		const response = await this.send({ type: "get_state" });
		return this.getData(response);
	}

	async setModel(provider: string, modelId: string): Promise<Record<string, unknown>> {
		const response = await this.send({ type: "set_model", provider, modelId });
		return this.getData(response);
	}

	async cycleModel(): Promise<Record<string, unknown> | null> {
		const response = await this.send({ type: "cycle_model" });
		return this.getData(response);
	}

	async getAvailableModels(): Promise<Array<Record<string, unknown>>> {
		const response = await this.send({ type: "get_available_models" });
		const data = this.getData<{ models: Array<Record<string, unknown>> }>(response);
		return data.models;
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		await this.send({ type: "set_thinking_level", level });
	}

	async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
		const response = await this.send({ type: "cycle_thinking_level" });
		return this.getData(response);
	}

	async setSteeringMode(mode: QueueMode): Promise<void> {
		await this.send({ type: "set_steering_mode", mode });
	}

	async setFollowUpMode(mode: QueueMode): Promise<void> {
		await this.send({ type: "set_follow_up_mode", mode });
	}

	async compact(customInstructions?: string): Promise<Record<string, unknown>> {
		const response = await this.send({ type: "compact", customInstructions });
		return this.getData(response);
	}

	async setAutoCompaction(enabled: boolean): Promise<void> {
		await this.send({ type: "set_auto_compaction", enabled });
	}

	async setAutoRetry(enabled: boolean): Promise<void> {
		await this.send({ type: "set_auto_retry", enabled });
	}

	async abortRetry(): Promise<void> {
		await this.send({ type: "abort_retry" });
	}

	async bash(command: string): Promise<Record<string, unknown>> {
		const response = await this.send({ type: "bash", command });
		return this.getData(response);
	}

	async abortBash(): Promise<void> {
		await this.send({ type: "abort_bash" });
	}

	async getMessages(): Promise<Array<Record<string, unknown>>> {
		const response = await this.send({ type: "get_messages" });
		const data = this.getData<{ messages: Array<Record<string, unknown>> }>(response);
		return data.messages;
	}

	async getSessionStats(): Promise<Record<string, unknown>> {
		const response = await this.send({ type: "get_session_stats" });
		return this.getData(response);
	}

	async getCommands(): Promise<Array<Record<string, unknown>>> {
		const response = await this.send({ type: "get_commands" });
		const data = this.getData<{ commands: Array<Record<string, unknown>> }>(response);
		return data.commands;
	}

	async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		const response = await this.send({ type: "switch_session", sessionPath });
		return this.getData(response);
	}

	async setSessionName(name: string): Promise<void> {
		await this.send({ type: "set_session_name", name });
	}

	async exportHtml(outputPath?: string): Promise<{ path: string }> {
		const response = await this.send({ type: "export_html", outputPath });
		return this.getData(response);
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		const response = await this.send({ type: "get_fork_messages" });
		const data = this.getData<{ messages: Array<{ entryId: string; text: string }> }>(response);
		return data.messages;
	}

	async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		const response = await this.send({ type: "fork", entryId });
		return this.getData(response);
	}

	async getLastAssistantText(): Promise<string | null> {
		const response = await this.send({ type: "get_last_assistant_text" });
		const data = this.getData<{ text: string | null }>(response);
		return data.text;
	}

	async sendExtensionUiResponse(response: Record<string, unknown>): Promise<void> {
		await invoke("rpc_ui_response", {
			response: JSON.stringify(response),
			instanceId: this.instanceId,
		});
	}

	async runPiCliCommand(
		args: string[],
		options: { cwd?: string; env?: Record<string, string>; cliPath?: string | null } = {},
	): Promise<PiCliCommandResult> {
		const cliPath = typeof options.cliPath !== "undefined" ? options.cliPath : (this.lastStartOptions?.cliPath ?? null);

		return invoke<PiCliCommandResult>("run_pi_cli_command", {
			options: {
				args,
				cwd: options.cwd ?? null,
				env: options.env ?? null,
				cli_path: cliPath,
			},
		});
	}

	async runGitCommand(args: string[], options: { cwd?: string } = {}): Promise<GitCommandResult> {
		return invoke<GitCommandResult>("run_git_command", {
			options: {
				args,
				cwd: options.cwd ?? null,
			},
		});
	}

	async getPiAuthStatus(): Promise<PiAuthStatus> {
		return invoke<PiAuthStatus>("get_pi_auth_status");
	}

	async getCliUpdateStatus(): Promise<CliUpdateStatus> {
		return invoke<CliUpdateStatus>("get_cli_update_status", {
			options: {
				cli_path: this.lastStartOptions?.cliPath ?? null,
				cwd: this.lastStartOptions?.cwd ?? null,
				env: this.lastStartOptions?.env ?? null,
			},
		});
	}

	async updateCliViaNpm(): Promise<NpmCommandResult> {
		return invoke<NpmCommandResult>("update_cli_via_npm");
	}

	async checkRpcCompatibility(): Promise<RpcCompatibilityReport> {
		const checks: string[] = [];
		if (!this.isConnected) {
			return {
				ok: false,
				checks,
				error: "No active RPC runtime. Open a project/session before running compatibility checks.",
				checkedAt: Date.now(),
			};
		}
		try {
			await this.getState();
			checks.push("get_state");
			await this.getCommands();
			checks.push("get_commands");
			await this.getAvailableModels();
			checks.push("get_available_models");
			return {
				ok: true,
				checks,
				checkedAt: Date.now(),
			};
		} catch (err) {
			return {
				ok: false,
				checks,
				error: err instanceof Error ? err.message : String(err),
				checkedAt: Date.now(),
			};
		}
	}

	// -------------------------------------------------------------------------
	// Internal
	// -------------------------------------------------------------------------

	private matchesPayloadGeneration(payload: RpcLineEventPayload | RpcClosedEventPayload): boolean {
		const generation = payloadGeneration(payload);
		if (generation === null) return true;
		if (this.pendingGeneration !== null) {
			return generation === this.pendingGeneration;
		}
		if (this.currentGeneration === null) return true;
		return generation === this.currentGeneration;
	}

	private emitToListeners(event: Record<string, unknown>): void {
		for (const listener of this.eventListeners) {
			try {
				listener(event);
			} catch (err) {
				traceBridge(`listener-error instance=${this.instanceId}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
	}

	private async ensureListeners(): Promise<void> {
		if (this.listenersReady) return;
		if (this.listenersReadyPromise) {
			await this.listenersReadyPromise;
			return;
		}

		this.listenersReadyPromise = (async () => {
			let unlistenEventLocal: UnlistenFn | null = null;
			let unlistenClosedLocal: UnlistenFn | null = null;
			let unlistenStderrLocal: UnlistenFn | null = null;
			try {
				unlistenEventLocal = await listen<RpcLineEventPayload>("rpc-event", (event) => {
					const payload = event.payload;
					if (payloadInstanceId(payload) !== this.instanceId) return;
					if (!this.matchesPayloadGeneration(payload)) return;
					const line = typeof payload.line === "string" ? payload.line : "";
					if (!line) return;
					this.handleLine(line);
				});

				unlistenClosedLocal = await listen<RpcClosedEventPayload>("rpc-closed", (event) => {
					const payload = event.payload;
					if (payloadInstanceId(payload) !== this.instanceId) return;
					if (!this.matchesPayloadGeneration(payload)) return;
					this._isConnected = false;
					traceBridge(`closed instance=${this.instanceId} generation=${payload.generation ?? -1} reason=${typeof payload.reason === "string" ? payload.reason : "RPC process closed"}`);
					this.rejectAllPending(typeof payload.reason === "string" ? payload.reason : "RPC process closed");
					this.emitToListeners({ type: "rpc_disconnected" });
				});

				unlistenStderrLocal = await listen<RpcLineEventPayload>("rpc-stderr", (event) => {
					const payload = event.payload;
					if (payloadInstanceId(payload) !== this.instanceId) return;
					if (!this.matchesPayloadGeneration(payload)) return;
					const line = typeof payload.line === "string" ? payload.line : "";
					if (!line) return;
					console.debug(`[pi stderr:${this.instanceId}]`, line);
					const runtimeError = extractRuntimeErrorFromTextLine(line);
					if (!runtimeError) return;
					traceBridge(`stderr-error instance=${this.instanceId} message=${runtimeError.slice(0, 180)}`);
					this.emitToListeners({
						type: "error",
						source: "stderr",
						errorMessage: runtimeError,
						rawLine: sanitizeRuntimeTextLine(line),
					});
				});

				this.unlistenEvent = unlistenEventLocal;
				this.unlistenClosed = unlistenClosedLocal;
				this.unlistenStderr = unlistenStderrLocal;
				this.listenersReady = true;
			} catch (err) {
				unlistenEventLocal?.();
				unlistenClosedLocal?.();
				unlistenStderrLocal?.();
				throw err;
			} finally {
				this.listenersReadyPromise = null;
			}
		})();

		await this.listenersReadyPromise;
	}

	private handleLine(line: string): void {
		const sanitized = sanitizeRpcLine(line);
		if (!sanitized) return;

		let data: Record<string, unknown>;
		try {
			data = JSON.parse(sanitized);
		} catch {
			this.parseFailureCount += 1;
			if (this.parseFailureCount <= 5 || sanitized.includes("extension_ui_request") || sanitized.includes("notify")) {
				traceBridge(`parse-failed instance=${this.instanceId} sample=${sanitized.slice(0, 180)}`);
			}
			const runtimeError = extractRuntimeErrorFromTextLine(line);
			if (runtimeError) {
				traceBridge(`stdout-text-error instance=${this.instanceId} message=${runtimeError.slice(0, 180)}`);
				this.emitToListeners({
					type: "error",
					source: "stdout_text",
					errorMessage: runtimeError,
					rawLine: sanitizeRuntimeTextLine(line),
				});
			}
			return;
		}

		if (data.type === "response" && typeof data.id === "string" && this.pendingRequests.has(data.id)) {
			const pending = this.pendingRequests.get(data.id)!;
			this.pendingRequests.delete(data.id);
			traceBridge(`response instance=${this.instanceId} id=${data.id} command=${String(data.command ?? "-")} success=${data.success === false ? "no" : "yes"}`);
			pending.resolve(data);
			return;
		}

		this.emitToListeners(data);
	}

	private async send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
		await this.ensureListeners();
		const id = `req_${++this.requestId}`;
		const fullCommand = { ...command, id };

		return new Promise((resolve, reject) => {
			traceBridge(`send instance=${this.instanceId} id=${id} command=${String(command.type)}`);
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				traceBridge(`timeout instance=${this.instanceId} id=${id} command=${String(command.type)}`);
				reject(new Error(`Timeout waiting for response to ${String(command.type)}`));
			}, 35000);

			this.pendingRequests.set(id, {
				resolve: (response) => {
					clearTimeout(timeout);
					resolve(response);
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				},
			});

			invoke("rpc_send", {
				command: JSON.stringify(fullCommand),
				instanceId: this.instanceId,
			}).catch((err) => {
				clearTimeout(timeout);
				this.pendingRequests.delete(id);
				traceBridge(`send-failed instance=${this.instanceId} id=${id} command=${String(command.type)}: ${String(err)}`);
				reject(new Error(`Failed to send RPC command: ${err}`));
			});
		});
	}

	private getData<T = Record<string, unknown>>(response: Record<string, unknown>): T {
		if (response.success === false) {
			throw new Error((response.error as string) || "Unknown RPC error");
		}
		return (response.data ?? response) as T;
	}

	private rejectAllPending(reason: string): void {
		for (const [, pending] of this.pendingRequests) {
			pending.reject(new Error(reason));
		}
		this.pendingRequests.clear();
	}

	async teardownListeners(): Promise<void> {
		if (this.listenersReadyPromise) {
			await this.listenersReadyPromise.catch(() => {
				// ignore listener initialization races during teardown
			});
		}
		this.unlistenEvent?.();
		this.unlistenClosed?.();
		this.unlistenStderr?.();
		this.unlistenEvent = null;
		this.unlistenClosed = null;
		this.unlistenStderr = null;
		this.listenersReady = false;
		this.listenersReadyPromise = null;
	}
}

class ActiveRpcBridgeProxy {
	private activeBridge: RpcBridge;
	private listenerUnsubscribers = new Map<RpcEventCallback, () => void>();

	constructor(initialBridge: RpcBridge) {
		this.activeBridge = initialBridge;
	}

	setActiveBridge(bridge: RpcBridge): void {
		if (this.activeBridge === bridge) return;
		const listeners = [...this.listenerUnsubscribers.keys()];
		for (const unlisten of this.listenerUnsubscribers.values()) {
			unlisten();
		}
		this.listenerUnsubscribers.clear();
		this.activeBridge = bridge;
		for (const listener of listeners) {
			this.listenerUnsubscribers.set(listener, this.activeBridge.onEvent(listener));
		}
	}

	getActiveBridge(): RpcBridge {
		return this.activeBridge;
	}

	get isConnected(): boolean {
		return this.activeBridge.isConnected;
	}

	get discoveryInfo(): string | null {
		return this.activeBridge.discoveryInfo;
	}

	getInstanceId(): string {
		return this.activeBridge.getInstanceId();
	}

	onEvent(callback: RpcEventCallback): () => void {
		const existing = this.listenerUnsubscribers.get(callback);
		existing?.();
		this.listenerUnsubscribers.set(callback, this.activeBridge.onEvent(callback));
		return () => {
			const current = this.listenerUnsubscribers.get(callback);
			current?.();
			this.listenerUnsubscribers.delete(callback);
		};
	}

	async start(options: RpcStartOptions): Promise<string> {
		return this.activeBridge.start(options);
	}

	async stop(): Promise<void> {
		return this.activeBridge.stop();
	}

	async stopAll(): Promise<void> {
		return this.activeBridge.stopAll();
	}

	async refreshRunningState(): Promise<boolean> {
		return this.activeBridge.refreshRunningState();
	}

	async prompt(message: string, options: RpcPromptOptions = {}): Promise<void> {
		return this.activeBridge.prompt(message, options);
	}

	async steer(message: string, images?: RpcImageInput[]): Promise<void> {
		return this.activeBridge.steer(message, images);
	}

	async followUp(message: string, images?: RpcImageInput[]): Promise<void> {
		return this.activeBridge.followUp(message, images);
	}

	async abort(): Promise<void> {
		return this.activeBridge.abort();
	}

	async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
		return this.activeBridge.newSession(parentSession);
	}

	async getState(): Promise<RpcSessionState> {
		return this.activeBridge.getState();
	}

	async setModel(provider: string, modelId: string): Promise<Record<string, unknown>> {
		return this.activeBridge.setModel(provider, modelId);
	}

	async cycleModel(): Promise<Record<string, unknown> | null> {
		return this.activeBridge.cycleModel();
	}

	async getAvailableModels(): Promise<Array<Record<string, unknown>>> {
		return this.activeBridge.getAvailableModels();
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		return this.activeBridge.setThinkingLevel(level);
	}

	async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
		return this.activeBridge.cycleThinkingLevel();
	}

	async setSteeringMode(mode: QueueMode): Promise<void> {
		return this.activeBridge.setSteeringMode(mode);
	}

	async setFollowUpMode(mode: QueueMode): Promise<void> {
		return this.activeBridge.setFollowUpMode(mode);
	}

	async compact(customInstructions?: string): Promise<Record<string, unknown>> {
		return this.activeBridge.compact(customInstructions);
	}

	async setAutoCompaction(enabled: boolean): Promise<void> {
		return this.activeBridge.setAutoCompaction(enabled);
	}

	async setAutoRetry(enabled: boolean): Promise<void> {
		return this.activeBridge.setAutoRetry(enabled);
	}

	async abortRetry(): Promise<void> {
		return this.activeBridge.abortRetry();
	}

	async bash(command: string): Promise<Record<string, unknown>> {
		return this.activeBridge.bash(command);
	}

	async abortBash(): Promise<void> {
		return this.activeBridge.abortBash();
	}

	async getMessages(): Promise<Array<Record<string, unknown>>> {
		return this.activeBridge.getMessages();
	}

	async getSessionStats(): Promise<Record<string, unknown>> {
		return this.activeBridge.getSessionStats();
	}

	async getCommands(): Promise<Array<Record<string, unknown>>> {
		return this.activeBridge.getCommands();
	}

	async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		return this.activeBridge.switchSession(sessionPath);
	}

	async setSessionName(name: string): Promise<void> {
		return this.activeBridge.setSessionName(name);
	}

	async exportHtml(outputPath?: string): Promise<{ path: string }> {
		return this.activeBridge.exportHtml(outputPath);
	}

	async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
		return this.activeBridge.getForkMessages();
	}

	async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return this.activeBridge.fork(entryId);
	}

	async getLastAssistantText(): Promise<string | null> {
		return this.activeBridge.getLastAssistantText();
	}

	async sendExtensionUiResponse(response: Record<string, unknown>): Promise<void> {
		return this.activeBridge.sendExtensionUiResponse(response);
	}

	async runPiCliCommand(
		args: string[],
		options: { cwd?: string; env?: Record<string, string>; cliPath?: string | null } = {},
	): Promise<PiCliCommandResult> {
		return this.activeBridge.runPiCliCommand(args, options);
	}

	async runGitCommand(args: string[], options: { cwd?: string } = {}): Promise<GitCommandResult> {
		return this.activeBridge.runGitCommand(args, options);
	}

	async getPiAuthStatus(): Promise<PiAuthStatus> {
		return this.activeBridge.getPiAuthStatus();
	}

	async getCliUpdateStatus(): Promise<CliUpdateStatus> {
		return this.activeBridge.getCliUpdateStatus();
	}

	async updateCliViaNpm(): Promise<NpmCommandResult> {
		return this.activeBridge.updateCliViaNpm();
	}

	async checkRpcCompatibility(): Promise<RpcCompatibilityReport> {
		return this.activeBridge.checkRpcCompatibility();
	}
}

const defaultRpcBridge = new RpcBridge("default");

export const rpcBridge = new ActiveRpcBridgeProxy(defaultRpcBridge);

export function setActiveRpcBridge(bridge: RpcBridge | null): void {
	rpcBridge.setActiveBridge(bridge ?? defaultRpcBridge);
}
