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

export interface RpcCompatibilityCheck {
	name: string;
	optional: boolean;
	supported: boolean;
	message?: string;
}

export interface RpcCompatibilityReport {
	ok: boolean;
	checks: string[];
	failedChecks: string[];
	optionalWarnings: string[];
	details: RpcCompatibilityCheck[];
	error?: string;
	checkedAt: number;
}

export type RpcEventCallback = (event: Record<string, unknown>) => void;

export class RpcBridge {
	private requestId = 0;
	private pendingRequests = new Map<
		string,
		{ resolve: (data: Record<string, unknown>) => void; reject: (err: Error) => void }
	>();
	private eventListeners: RpcEventCallback[] = [];
	private unlistenEvent: UnlistenFn | null = null;
	private unlistenClosed: UnlistenFn | null = null;
	private unlistenStderr: UnlistenFn | null = null;
	private _isConnected = false;
	private lastStartOptions: RpcStartOptions | null = null;
	private lastDiscoveryInfo: string | null = null;

	get isConnected(): boolean {
		return this._isConnected;
	}

	get discoveryInfo(): string | null {
		return this.lastDiscoveryInfo;
	}

	async start(options: RpcStartOptions): Promise<string> {
		await this.teardownListeners();

		this.unlistenEvent = await listen<string>("rpc-event", (event) => {
			this.handleLine(event.payload);
		});

		this.unlistenClosed = await listen<string>("rpc-closed", () => {
			this._isConnected = false;
			this.rejectAllPending("RPC process closed");
			for (const listener of this.eventListeners) {
				listener({ type: "rpc_disconnected" });
			}
		});

		this.unlistenStderr = await listen<string>("rpc-stderr", (event) => {
			console.debug("[pi stderr]", event.payload);
		});

		try {
			const discoveryInfo = await invoke<string>("rpc_start", {
				options: {
					cli_path: options.cliPath ?? null,
					cwd: options.cwd,
					provider: options.provider || null,
					model: options.model || null,
					env: options.env || null,
				},
			});

			this._isConnected = true;
			this.lastStartOptions = { ...options };
			this.lastDiscoveryInfo = discoveryInfo;
			return discoveryInfo;
		} catch (err) {
			await this.teardownListeners();
			throw err;
		}
	}

	async stop(): Promise<void> {
		this._isConnected = false;
		await this.teardownListeners();
		this.rejectAllPending("RPC stopped");
		await invoke("rpc_stop");
	}

	onEvent(callback: RpcEventCallback): () => void {
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
		await invoke("rpc_ui_response", { response: JSON.stringify(response) });
	}

	async runPiCliCommand(
		args: string[],
		options: { cwd?: string; env?: Record<string, string>; cliPath?: string | null } = {},
	): Promise<PiCliCommandResult> {
		const cliPath =
			typeof options.cliPath !== "undefined" ? options.cliPath : (this.lastStartOptions?.cliPath ?? null);

		return invoke<PiCliCommandResult>("run_pi_cli_command", {
			options: {
				args,
				cwd: options.cwd ?? null,
				env: options.env ?? null,
				cli_path: cliPath,
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

	isLikelyCompatibilityError(err: unknown): boolean {
		const message = this.getErrorMessage(err).toLowerCase();
		return (
			message.includes("unknown command") ||
			message.includes("unsupported") ||
			message.includes("not implemented") ||
			message.includes("invalid command") ||
			message.includes("unrecognized") ||
			message.includes("command not found") ||
			message.includes("method not found")
		);
	}

	formatFeatureError(feature: string, err: unknown): string {
		const message = this.getErrorMessage(err);
		if (this.isLikelyCompatibilityError(err)) {
			return `${feature} is unavailable with the current CLI version. Update pi in Settings → CLI Runtime.`;
		}
		if (!this.isConnected) {
			return `Disconnected from pi while running ${feature}. Reconnect by reselecting a project/session.`;
		}
		return `${feature} failed: ${message}`;
	}

	async checkRpcCompatibility(): Promise<RpcCompatibilityReport> {
		const checks: string[] = [];
		const failedChecks: string[] = [];
		const optionalWarnings: string[] = [];
		const details: RpcCompatibilityCheck[] = [];

		const runCheck = async (
			name: string,
			optional: boolean,
			runner: () => Promise<unknown>,
		): Promise<void> => {
			try {
				await runner();
				details.push({ name, optional, supported: true });
				if (!optional) checks.push(name);
			} catch (err) {
				const message = this.getErrorMessage(err);
				details.push({ name, optional, supported: false, message });
				if (optional) {
					optionalWarnings.push(this.formatFeatureError(name, err));
				} else {
					failedChecks.push(name);
				}
			}
		};

		if (!this.isConnected) {
			return {
				ok: false,
				checks,
				failedChecks: ["rpc_connection"],
				optionalWarnings,
				details: [{ name: "rpc_connection", optional: false, supported: false, message: "RPC is not connected" }],
				error: "RPC is not connected.",
				checkedAt: Date.now(),
			};
		}

		await runCheck("get_state", false, () => this.getState());
		await runCheck("get_commands", false, () => this.getCommands());
		await runCheck("get_available_models", false, () => this.getAvailableModels());

		// Optional capabilities in older/newer CLI versions can differ.
		await runCheck("get_messages", true, () => this.getMessages());
		await runCheck("get_session_stats", true, () => this.getSessionStats());
		await runCheck("get_fork_messages", true, () => this.getForkMessages());
		await runCheck("get_last_assistant_text", true, () => this.getLastAssistantText());

		const ok = failedChecks.length === 0;
		const error =
			failedChecks.length > 0
				? `Required RPC capabilities failed: ${failedChecks.join(", ")}. Update pi CLI and retry.`
				: undefined;

		return {
			ok,
			checks,
			failedChecks,
			optionalWarnings,
			details,
			error,
			checkedAt: Date.now(),
		};
	}

	// -------------------------------------------------------------------------
	// Internal
	// -------------------------------------------------------------------------

	private handleLine(line: string): void {
		let data: Record<string, unknown>;
		try {
			data = JSON.parse(line);
		} catch {
			return;
		}

		if (data.type === "response" && typeof data.id === "string" && this.pendingRequests.has(data.id)) {
			const pending = this.pendingRequests.get(data.id)!;
			this.pendingRequests.delete(data.id);
			pending.resolve(data);
			return;
		}

		for (const listener of this.eventListeners) listener(data);
	}

	private async send(command: Record<string, unknown>): Promise<Record<string, unknown>> {
		const id = `req_${++this.requestId}`;
		const fullCommand = { ...command, id };

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
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

			invoke("rpc_send", { command: JSON.stringify(fullCommand) }).catch((err) => {
				clearTimeout(timeout);
				this.pendingRequests.delete(id);
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

	private getErrorMessage(err: unknown): string {
		if (err instanceof Error && err.message) return err.message;
		if (typeof err === "string") return err;
		return String(err);
	}

	private rejectAllPending(reason: string): void {
		for (const [, pending] of this.pendingRequests) {
			pending.reject(new Error(reason));
		}
		this.pendingRequests.clear();
	}

	private async teardownListeners(): Promise<void> {
		this.unlistenEvent?.();
		this.unlistenClosed?.();
		this.unlistenStderr?.();
		this.unlistenEvent = null;
		this.unlistenClosed = null;
		this.unlistenStderr = null;
	}
}

export const rpcBridge = new RpcBridge();
