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
	role: UiRole;
	text: string;
	toolCalls: ToolCallBlock[];
	attachments?: PendingImage[];
	thinking?: string;
	thinkingExpanded?: boolean;
	isStreaming?: boolean;
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

function uid(prefix = "id"): string {
	return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function truncate(value: string, len: number): string {
	if (value.length <= len) return value;
	return `${value.slice(0, len - 1)}…`;
}

export class ChatView {
	private container: HTMLElement;
	private messages: UiMessage[] = [];
	private inputText = "";
	private state: RpcSessionState | null = null;
	private isConnected = false;
	private scrollContainer: HTMLElement | null = null;
	private unsubscribeEvents: (() => void) | null = null;
	private onStateChange: ((state: RpcSessionState) => void) | null = null;
	private availableModels: ModelOption[] = [];
	private loadingModels = false;
	private settingModel = false;
	private settingThinking = false;
	private pendingImages: PendingImage[] = [];
	private notices: Notice[] = [];
	private allThinkingExpanded = false;
	private retryStatus = "";
	private compactionStatus = "";
	private pendingDeliveryMode: DeliveryMode = "prompt";
	private openingForkPicker = false;
	private forkPickerOpen = false;
	private forkOptions: ForkOption[] = [];
	private historyViewerOpen = false;
	private historyQuery = "";
	private historyRoleFilter: UiRole | "all" = "all";
	private disconnectNoticeTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
	}

	setOnStateChange(cb: (state: RpcSessionState) => void): void {
		this.onStateChange = cb;
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

	connect(): void {
		this.unsubscribeEvents = rpcBridge.onEvent((event) => this.handleEvent(event));
		this.isConnected = rpcBridge.isConnected;
		if (!this.isConnected) return;
		void this.refreshFromBackend();
		void this.loadAvailableModels();
	}

	disconnect(): void {
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = null;
	}

	async refreshFromBackend(): Promise<void> {
		try {
			const [state, backendMessages] = await Promise.all([rpcBridge.getState(), rpcBridge.getMessages()]);
			this.isConnected = rpcBridge.isConnected;
			this.state = state;
			this.onStateChange?.(state);
			this.messages = this.mapBackendMessages(backendMessages);
			this.pendingDeliveryMode = state.isStreaming ? "steer" : "prompt";
			this.render();
			this.scrollToBottom();
			if (!this.loadingModels && this.availableModels.length === 0) {
				void this.loadAvailableModels();
			}
		} catch (err) {
			console.error("Failed to refresh chat state:", err);
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

			switch (role) {
				case "user": {
					const text = this.extractText(raw.content);
					const attachments = this.extractImages(raw.content);
					mapped.push({
						id: uid("user"),
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
						if (type === "thinking" && typeof p.thinking === "string") {
							thinking += p.thinking;
						}
						if (type === "toolCall") {
							const id = typeof p.id === "string" ? p.id : uid("tc");
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
					const content = this.extractText(raw.content);
					const isError = Boolean(raw.isError);
					if (toolCallId && toolCallMap.has(toolCallId)) {
						const tool = toolCallMap.get(toolCallId)!;
						tool.result = content || "(no output)";
						tool.isError = isError;
						tool.isRunning = false;
						tool.isExpanded = isError || tool.name === "bash";
					} else {
						mapped.push({
							id: uid("toolResult"),
							role: "system",
							text: `Tool result${isError ? " (error)" : ""}:\n${content}`,
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

	private async loadAvailableModels(): Promise<void> {
		this.loadingModels = true;
		this.render();
		try {
			const models = await rpcBridge.getAvailableModels();
			const mapped: ModelOption[] = [];
			for (const m of models) {
				const provider = typeof m.provider === "string" ? m.provider : "";
				const id = typeof m.id === "string" ? m.id : "";
				if (!provider || !id) continue;
				mapped.push({
					provider,
					id,
					contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
					reasoning: Boolean(m.reasoning),
					label: `${provider} / ${id}`,
				});
			}
			this.availableModels = mapped;
		} catch (err) {
			console.error("Failed to load available models:", err);
			this.availableModels = [];
		} finally {
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
			this.pushNotice(`Switched to ${provider}/${modelId}`, "success");
		} catch (err) {
			console.error("Failed to set model:", err);
			this.pushFeatureError("Model switch", err);
		} finally {
			this.settingModel = false;
			this.render();
		}
	}

	private async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		if (this.settingThinking) return;
		this.settingThinking = true;
		this.render();
		try {
			await rpcBridge.setThinkingLevel(level);
			this.state = await rpcBridge.getState();
			if (this.state) this.onStateChange?.(this.state);
		} catch (err) {
			console.error("Failed to set thinking level:", err);
			this.pushFeatureError("Thinking level update", err);
		} finally {
			this.settingThinking = false;
			this.render();
		}
	}

	private handleEvent(event: Record<string, unknown>): void {
		const type = event.type as string;
		if (type === "response") return;

		switch (type) {
			case "agent_start":
				this.pendingDeliveryMode = "steer";
				this.render();
				break;

			case "agent_end": {
				const last = this.messages[this.messages.length - 1];
				if (last && last.role === "assistant") last.isStreaming = false;
				this.retryStatus = "";
				rpcBridge
					.getState()
					.then((s) => {
						this.state = s;
						this.pendingDeliveryMode = s.isStreaming ? "steer" : "prompt";
						this.onStateChange?.(s);
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
				if ((msg.role as string) === "assistant") {
					this.messages.push({
						id: uid("assistant"),
						role: "assistant",
						text: "",
						toolCalls: [],
						isStreaming: true,
						thinkingExpanded: this.allThinkingExpanded,
					});
					this.render();
				}
				break;
			}

			case "message_update": {
				const assistantEvent = event.assistantMessageEvent as Record<string, unknown>;
				if (!assistantEvent) break;
				const subtype = assistantEvent.type as string;
				const last = this.messages[this.messages.length - 1];
				if (!last || last.role !== "assistant") break;

				if (subtype === "text_delta") {
					last.text += (assistantEvent.delta as string) || "";
					this.render();
					this.scrollToBottom();
				} else if (subtype === "thinking_delta") {
					last.thinking = (last.thinking || "") + ((assistantEvent.delta as string) || "");
					if ((last.thinking.length || 0) % 100 === 0) this.render();
				} else if (subtype === "toolcall_end") {
					const tc = assistantEvent.toolCall as Record<string, unknown>;
					if (tc) {
						last.toolCalls.push({
							id: (tc.id as string) || uid("tc"),
							name: (tc.name as string) || "tool",
							args: ((tc.arguments ?? {}) as Record<string, unknown>) || {},
							isRunning: true,
							isExpanded: true,
						});
						this.render();
					}
				} else if (subtype === "error") {
					last.isStreaming = false;
					this.render();
				}
				break;
			}

			case "message_end": {
				const last = this.messages[this.messages.length - 1];
				if (last?.role === "assistant") {
					last.isStreaming = false;
				}
				this.render();
				break;
			}

			case "tool_execution_start": {
				const id = event.toolCallId as string | undefined;
				if (!id) break;
				const tool = this.findToolCall(id);
				if (tool) {
					tool.isRunning = true;
					tool.isExpanded = true;
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
				const text = this.extractText(partialResult.content);
				tool.streamingOutput = text;
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
					const content = this.extractText((result as Record<string, unknown>).content);
					tool.result = content || JSON.stringify(result, null, 2);
				}
				if (!isError && tool.name !== "bash") tool.isExpanded = false;
				this.render();
				this.scrollToBottom();
				break;
			}

			case "auto_compaction_start": {
				this.compactionStatus = "Compacting context…";
				this.render();
				break;
			}

			case "auto_compaction_end": {
				this.compactionStatus = "";
				const aborted = Boolean(event.aborted);
				const errorMessage = typeof event.errorMessage === "string" ? event.errorMessage : "";
				if (aborted) this.pushNotice("Auto-compaction aborted", "info");
				else if (errorMessage) this.pushNotice(`Auto-compaction failed: ${truncate(errorMessage, 120)}`, "error");
				else this.pushNotice("Auto-compaction complete", "success");
				this.render();
				break;
			}

			case "auto_retry_start": {
				const attempt = typeof event.attempt === "number" ? event.attempt : 1;
				const maxAttempts = typeof event.maxAttempts === "number" ? event.maxAttempts : 1;
				const delayMs = typeof event.delayMs === "number" ? event.delayMs : 0;
				this.retryStatus = `Retry ${attempt}/${maxAttempts} in ${(delayMs / 1000).toFixed(1)}s`;
				this.render();
				break;
			}

			case "auto_retry_end": {
				const success = Boolean(event.success);
				this.retryStatus = "";
				if (!success) {
					const finalError = typeof event.finalError === "string" ? event.finalError : "Unknown retry failure";
					this.pushNotice(`Retry failed: ${truncate(finalError, 120)}`, "error");
				}
				this.render();
				break;
			}

			case "extension_error": {
				const error = typeof event.error === "string" ? event.error : "Unknown extension error";
				this.pushNotice(`Extension error: ${truncate(error, 120)}`, "error");
				break;
			}

			case "rpc_disconnected":
				this.isConnected = false;
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

	private pushNotice(text: string, kind: Notice["kind"]): void {
		const id = uid("notice");
		this.notices = [...this.notices, { id, text, kind }];
		this.render();
		setTimeout(() => {
			this.notices = this.notices.filter((n) => n.id !== id);
			this.render();
		}, 4200);
	}

	private pushFeatureError(feature: string, err: unknown): void {
		this.pushNotice(rpcBridge.formatFeatureError(feature, err), "error");
	}

	private async prepareImages(files: FileList | File[]): Promise<void> {
		const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
		if (list.length === 0) return;

		const next: PendingImage[] = [];
		for (const file of list) {
			const dataUrl = await this.fileToDataUrl(file);
			const [head, base64 = ""] = dataUrl.split(",");
			const mime = head.match(/data:(.*);base64/)?.[1] || file.type || "image/png";
			next.push({
				id: uid("img"),
				name: file.name,
				mimeType: mime,
				data: base64,
				previewUrl: dataUrl,
				size: file.size,
			});
		}

		this.pendingImages = [...this.pendingImages, ...next];
		this.render();
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
		this.render();
		this.scrollToBottom();
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
		const text = this.inputText.trim();
		const images = [...this.pendingImages];
		if (!text && images.length === 0) return;

		const streaming = this.currentIsStreaming();
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
		} catch (err) {
			console.error("Failed to send message:", err);
			this.pushFeatureError("Send message", err);
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

	private async retryUserMessage(msg: UiMessage): Promise<void> {
		const text = (msg.text || "").trim();
		const images = this.cloneImages(msg.attachments);
		if (!text && images.length === 0) {
			this.pushNotice("Cannot resend an empty message", "info");
			return;
		}

		let mode: DeliveryMode = msg.deliveryMode || "prompt";
		if (!this.currentIsStreaming()) mode = "prompt";

		this.pushUserEcho(text, mode, images);

		try {
			const rpcImages = this.toRpcImages(images);
			if (mode === "prompt") {
				await rpcBridge.prompt(text, { images: rpcImages });
			} else if (mode === "steer") {
				await rpcBridge.steer(text, rpcImages);
			} else {
				await rpcBridge.followUp(text, rpcImages);
			}
			this.pushNotice("Message resent", "success");
		} catch (err) {
			console.error("Failed to resend message:", err);
			this.pushFeatureError("Retry message", err);
		}
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
			this.pushFeatureError("Copy last assistant message", err);
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
			this.pushFeatureError("Export session", err);
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
			this.pushFeatureError("Copy exported HTML", err);
		}
	}

	async abortCurrentRun(): Promise<void> {
		try {
			if (this.retryStatus) await rpcBridge.abortRetry();
			await rpcBridge.abort();
			this.pushNotice("Aborted current run", "info");
		} catch (err) {
			console.error("Failed to abort:", err);
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
			this.pushFeatureError("Create session", err);
		}
	}

	async compactNow(): Promise<void> {
		try {
			await rpcBridge.compact();
			await this.refreshFromBackend();
			this.pushNotice("Compaction complete", "success");
		} catch (err) {
			console.error("Failed to compact:", err);
			this.pushFeatureError("Compaction", err);
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
			this.pushFeatureError("Rename session", err);
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
			this.pushFeatureError("Fork message list", err);
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

	private async forkFrom(entryId: string): Promise<void> {
		try {
			const result = await rpcBridge.fork(entryId);
			if (!result.cancelled && result.text) {
				this.setInputText(result.text);
			}
			await this.refreshFromBackend();
			this.pushNotice(result.cancelled ? "Fork cancelled" : "Fork ready in editor", "success");
			this.closeForkPicker();
		} catch (err) {
			console.error("Failed to fork:", err);
			this.pushFeatureError("Fork session", err);
		}
	}

	openHistoryViewer(): void {
		this.historyViewerOpen = true;
		this.render();
	}

	private closeHistoryViewer(): void {
		this.historyViewerOpen = false;
		this.historyQuery = "";
		this.historyRoleFilter = "all";
		this.render();
	}

	private revealMessage(messageId: string): void {
		const escaped = (window as any).CSS?.escape ? (window as any).CSS.escape(messageId) : messageId;
		const target = this.container.querySelector(`[data-message-id="${escaped}"]`) as HTMLElement | null;
		if (!target) return;
		target.scrollIntoView({ behavior: "smooth", block: "center" });
		this.closeHistoryViewer();
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

	private scrollToBottom(): void {
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

	private renderToolbar(): TemplateResult {
		const sessionName = this.state?.sessionName || "Untitled session";
		const count = this.state?.messageCount ?? this.messages.length;
		const pending = this.state?.pendingMessageCount ?? 0;
		const streaming = this.currentIsStreaming();

		return html`
			<div class="chat-toolbar">
				<div class="chat-toolbar-left">
					<div class="chat-session-title" title=${sessionName}>${sessionName}</div>
					<div class="chat-toolbar-meta">${count} msgs${pending > 0 ? html` · ${pending} queued` : nothing}</div>
				</div>
				<div class="chat-toolbar-actions">
					<button class="ghost-btn" @click=${() => this.newSession()}>New</button>
					<button class="ghost-btn" @click=${() => this.renameSession()}>Name</button>
					<button class="ghost-btn" @click=${() => this.compactNow()}>Compact</button>
					<button class="ghost-btn" @click=${() => this.openForkPicker()}>Fork</button>
					<button class="ghost-btn" @click=${() => this.openHistoryViewer()}>History</button>
					<button class="ghost-btn" @click=${() => this.copyLastMessage()}>Copy</button>
					<button class="ghost-btn" @click=${() => this.exportToHtml()}>Export</button>
					${streaming
						? html`<button class="danger-btn" @click=${() => this.abortCurrentRun()}>Stop</button>`
						: nothing}
				</div>
			</div>
		`;
	}

	private renderUserMessage(msg: UiMessage): TemplateResult {
		return html`
			<div class="chat-row user-row" data-message-id=${msg.id}>
				<div class="message-shell user-message-shell">
					<div class="message-actions">
						<button class="message-action-btn" @click=${() => this.editUserMessage(msg)}>Edit</button>
						<button class="message-action-btn" @click=${() => this.retryUserMessage(msg)}>Retry</button>
						<button class="message-action-btn" @click=${() => this.copyMessage(msg)}>Copy</button>
					</div>
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
				</div>
			</div>
		`;
	}

	private renderThinking(msg: UiMessage): TemplateResult | typeof nothing {
		if (!msg.thinking) return nothing;
		const expanded = msg.thinkingExpanded ?? false;
		const preview = truncate(msg.thinking.replace(/\s+/g, " "), 92);
		return html`
			<div class="thinking-block">
				<button
					class="thinking-toggle"
					@click=${() => {
						msg.thinkingExpanded = !expanded;
						this.render();
					}}
				>
					${expanded ? "▾" : "▸"} ${expanded ? "Thinking" : `Thinking: ${preview}`}
				</button>
				${expanded ? html`<div class="thinking-content">${msg.thinking}</div>` : nothing}
			</div>
		`;
	}

	private renderToolCall(tc: ToolCallBlock): TemplateResult {
		const statusClass = tc.isRunning ? "status-running" : tc.isError ? "status-error" : "status-ok";
		const titleHint = tc.name === "bash" && typeof tc.args.command === "string" ? (tc.args.command as string) : "";
		const output = tc.streamingOutput ?? tc.result;
		const hasOutput = Boolean(output && output.length > 0);

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
				${tc.isExpanded && hasOutput
					? html`<pre class="tool-output">${output}${tc.isRunning ? html`<span class="streaming-inline"></span>` : nothing}</pre>`
					: nothing}
			</div>
		`;
	}

	private renderAssistantMessage(msg: UiMessage): TemplateResult {
		return html`
			<div class="chat-row assistant-row" data-message-id=${msg.id}>
				<div class="message-shell assistant-message-shell">
					<div class="message-actions">
						<button class="message-action-btn" @click=${() => this.copyMessage(msg)}>Copy</button>
					</div>
					<div class="assistant-block">
						${this.renderThinking(msg)}
						${msg.text
							? html`
								<div class="assistant-content">
									<markdown-block .content=${msg.text} class=${msg.isStreaming ? "streaming-cursor" : ""}></markdown-block>
								</div>
							`
							: nothing}
						${msg.toolCalls.map((tc) => this.renderToolCall(tc))}
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

	private renderEmptyState(): TemplateResult {
		return html`
			<div class="empty-state">
				<div class="empty-logo">pi</div>
				<div class="empty-subtitle">Minimal desktop harness for the pi coding agent.</div>
				<div class="empty-actions">
					<button class="ghost-btn" @click=${() => this.setInputText("List all TypeScript files in this project")}>List files</button>
					<button class="ghost-btn" @click=${() => this.setInputText("Review this codebase and suggest improvements")}>Review codebase</button>
				</div>
			</div>
		`;
	}

	private renderComposerControls(): TemplateResult {
		const currentProvider = this.state?.model?.provider ?? "";
		const currentModelId = this.state?.model?.id ?? "";
		const currentModelValue = currentProvider && currentModelId ? `${currentProvider}::${currentModelId}` : "";
		const thinking = this.state?.thinkingLevel ?? "off";
		const isStreaming = this.currentIsStreaming();

		const showAdvancedThinking = this.availableModels.some((m) => m.reasoning);

		return html`
			<div class="composer-controls">
				<div class="control-group">
					<select
						class="composer-select"
						.value=${currentModelValue}
						?disabled=${this.loadingModels || this.settingModel}
						@change=${(e: Event) => {
							const value = (e.target as HTMLSelectElement).value;
							const [provider, ...rest] = value.split("::");
							const modelId = rest.join("::");
							if (!provider || !modelId || value === currentModelValue) return;
							void this.setModel(provider, modelId);
						}}
					>
						${this.loadingModels ? html`<option value="">Loading models…</option>` : nothing}
						${!this.loadingModels && currentModelValue && !this.availableModels.some((m) => `${m.provider}::${m.id}` === currentModelValue)
							? html`<option value=${currentModelValue}>${currentProvider}/${currentModelId}</option>`
							: nothing}
						${this.availableModels.map((m) => html`<option value=${`${m.provider}::${m.id}`}>${m.label}</option>`)}
					</select>

					<select
						class="composer-select thinking-select"
						.value=${thinking}
						?disabled=${this.settingThinking}
						@change=${(e: Event) => void this.setThinkingLevel((e.target as HTMLSelectElement).value as ThinkingLevel)}
					>
						<option value="off">thinking: off</option>
						<option value="minimal">thinking: minimal</option>
						<option value="low">thinking: low</option>
						<option value="medium">thinking: medium</option>
						<option value="high">thinking: high</option>
						${showAdvancedThinking ? html`<option value="xhigh">thinking: xhigh</option>` : nothing}
					</select>
				</div>

				<div class="control-group right">
					${this.compactionStatus ? html`<span class="status-pill compact">${this.compactionStatus}</span>` : nothing}
					${this.retryStatus ? html`<span class="status-pill retry">${this.retryStatus}</span>` : nothing}
					${isStreaming ? html`<span class="status-pill streaming">streaming</span>` : nothing}
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
		const canSend = this.inputText.trim().length > 0 || this.pendingImages.length > 0;

		return html`
			<div class="composer-shell">
				<div class="composer-inner">
					${this.renderComposerControls()}
					${this.renderPendingImages()}

					<div class="composer-row">
						<button
							class="icon-btn"
							title="Attach image"
							@click=${() => {
								const input = this.container.querySelector("#file-picker") as HTMLInputElement | null;
								input?.click();
							}}
						>
							📎
						</button>

						<textarea
							id="chat-input"
							class="chat-input"
							placeholder="Message pi…  Enter send · Alt+Enter follow-up · Shift+Enter newline"
							rows="1"
							.value=${this.inputText}
							@input=${(e: Event) => {
								const ta = e.target as HTMLTextAreaElement;
								this.inputText = ta.value;
								ta.style.height = "auto";
								ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
							}}
							@paste=${(e: ClipboardEvent) => {
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
							@keydown=${(e: KeyboardEvent) => {
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

						${isStreaming
							? html`
								<div class="stream-send-group">
									<button class="send-btn secondary" ?disabled=${!canSend} @click=${() => this.sendMessage("followUp")}>Follow-up</button>
									<button class="send-btn" ?disabled=${!canSend} @click=${() => this.sendMessage("steer")}>Steer</button>
								</div>
							`
							: html`<button class="send-btn" ?disabled=${!canSend} @click=${() => this.sendMessage("prompt")}>Send</button>`}

						<input
							id="file-picker"
							type="file"
							accept="image/*"
							multiple
							style="display:none"
							@change=${(e: Event) => {
								const files = (e.target as HTMLInputElement).files;
								if (files?.length) void this.prepareImages(files);
								(e.target as HTMLInputElement).value = "";
							}}
						/>
					</div>
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

	private renderHistoryViewer(): TemplateResult | typeof nothing {
		if (!this.historyViewerOpen) return nothing;

		const query = this.historyQuery.trim().toLowerCase();
		const filtered = this.messages.filter((msg) => {
			if (this.historyRoleFilter !== "all" && msg.role !== this.historyRoleFilter) return false;
			if (!query) return true;
			const haystack = `${msg.role} ${msg.label || ""} ${this.messagePreview(msg)}`.toLowerCase();
			return haystack.includes(query);
		});

		return html`
			<div class="overlay" @click=${(e: Event) => e.target === e.currentTarget && this.closeHistoryViewer()}>
				<div class="overlay-card history-card">
					<div class="overlay-header">
						<div>Session history</div>
						<button @click=${() => this.closeHistoryViewer()}>✕</button>
					</div>
					<div class="history-controls">
						<input
							type="text"
							placeholder="Search messages"
							.value=${this.historyQuery}
							@input=${(e: Event) => {
								this.historyQuery = (e.target as HTMLInputElement).value;
								this.render();
							}}
						/>
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
					</div>
					<div class="overlay-body history-list">
						${filtered.length === 0
							? html`<div class="overlay-empty">No messages match your filters.</div>`
							: filtered.map(
									(msg, idx) => html`
										<div class="history-item">
											<button class="history-jump" @click=${() => this.revealMessage(msg.id)}>
												<div class="history-meta">
													<span class="history-role role-${msg.role}">${msg.role}</span>
													<span>#${idx + 1}</span>
												</div>
												<div class="history-preview">${truncate(this.messagePreview(msg).replace(/\s+/g, " "), 180)}</div>
											</button>
											<div class="history-item-actions">
												${msg.role === "user"
													? html`<button class="message-action-btn" @click=${() => {
														this.editUserMessage(msg);
														this.closeHistoryViewer();
													}}>Edit</button>`
													: nothing}
												<button class="message-action-btn" @click=${() => this.copyMessage(msg)}>Copy</button>
											</div>
										</div>
									`,
								)}
					</div>
				</div>
			</div>
		`;
	}

	private doRender(): void {
		const hasMessages = this.messages.length > 0;

		const template = html`
			<div
				class="chat-root"
				@dragover=${(e: DragEvent) => {
					e.preventDefault();
				}}
				@drop=${(e: DragEvent) => {
					e.preventDefault();
					if (e.dataTransfer?.files?.length) {
						void this.prepareImages(e.dataTransfer.files);
					}
				}}
			>
				${this.renderToolbar()}
				<div class="chat-scroll" id="chat-scroll">
					${hasMessages
						? html`${this.messages.map((m) => {
								if (m.role === "user") return this.renderUserMessage(m);
								if (m.role === "assistant") return this.renderAssistantMessage(m);
								return this.renderSystemMessage(m);
							})}`
						: this.renderEmptyState()}
				</div>
				${this.renderComposer()}
				${this.renderForkPicker()}
				${this.renderHistoryViewer()}
				${this.renderNotices()}
			</div>
		`;

		render(template, this.container);
		this.scrollContainer = this.container.querySelector("#chat-scroll");
	}

	render(): void {
		this.doRender();
	}

	notify(text: string, kind: "info" | "success" | "error" = "info"): void {
		this.pushNotice(text, kind);
	}

	focusInput(): void {
		const ta = this.container.querySelector("#chat-input") as HTMLTextAreaElement | null;
		ta?.focus();
	}
}
