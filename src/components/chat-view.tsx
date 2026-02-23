/**
 * ChatView - rich RPC chat surface for Pi Desktop
 */

import React, { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	type ProjectGitStatus,
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

interface SessionStatusStats {
	tokensTotal: number;
	costTotal: number;
}

interface GitBranchOption {
	name: string;
	current: boolean;
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
	private root: Root;
	private messages: UiMessage[] = [];
	private inputText = "";
	private state: RpcSessionState | null = null;
	private isConnected = false;
	private scrollContainer: HTMLElement | null = null;
	private unsubscribeEvents: (() => void) | null = null;
	private onStateChange: ((state: RpcSessionState) => void) | null = null;
	private onOpenActions: (() => void) | null = null;
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
	private projectPath: string | null = null;
	private gitStatus: ProjectGitStatus | null = null;
	private loadingGitStatus = false;
	private sessionStats: SessionStatusStats | null = null;
	private statusPollTimer: ReturnType<typeof setInterval> | null = null;
	private availableBranches: GitBranchOption[] = [];
	private loadingBranches = false;
	private switchingBranch = false;

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
	}

	setOnStateChange(cb: (state: RpcSessionState) => void): void {
		this.onStateChange = cb;
	}

	setOnOpenActions(cb: () => void): void {
		this.onOpenActions = cb;
	}

	setProjectPath(path: string | null): void {
		const normalized = path && path.trim() ? path : null;
		if (this.projectPath === normalized) return;
		this.projectPath = normalized;
		this.gitStatus = null;
		if (normalized) {
			void this.refreshGitStatus();
		}
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

	connect(): void {
		this.unsubscribeEvents = rpcBridge.onEvent((event) => this.handleEvent(event));
		this.isConnected = rpcBridge.isConnected;
		if (!this.isConnected) return;
		void this.refreshFromBackend();
		void this.loadAvailableModels();
		void this.refreshSessionStats();
		if (this.projectPath) {
			void this.refreshGitStatus();
		}
		this.startStatusPolling();
	}

	disconnect(): void {
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = null;
		this.stopStatusPolling();
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
			void this.refreshSessionStats();
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

	private startStatusPolling(): void {
		this.stopStatusPolling();
		this.statusPollTimer = setInterval(() => {
			void this.refreshSessionStats();
		}, 10_000);
	}

	private stopStatusPolling(): void {
		if (!this.statusPollTimer) return;
		clearInterval(this.statusPollTimer);
		this.statusPollTimer = null;
	}

	private async refreshSessionStats(): Promise<void> {
		try {
			const raw = await rpcBridge.getSessionStats();
			const tokensData = (raw.tokens as Record<string, unknown> | undefined) ?? {};
			const tokensTotal =
				typeof tokensData.total === "number"
					? tokensData.total
					: typeof tokensData.totalTokens === "number"
						? tokensData.totalTokens
						: 0;
			const costTotal =
				typeof raw.cost === "number"
					? raw.cost
					: typeof (raw.cost as Record<string, unknown> | undefined)?.total === "number"
						? ((raw.cost as Record<string, unknown>).total as number)
						: 0;

			this.sessionStats = {
				tokensTotal,
				costTotal,
			};
			this.render();
		} catch {
			// optional status
		}
	}

	private async refreshGitStatus(): Promise<void> {
		if (!this.projectPath) {
			this.gitStatus = null;
			this.availableBranches = [];
			this.loadingGitStatus = false;
			this.loadingBranches = false;
			this.render();
			return;
		}

		this.loadingGitStatus = true;
		this.render();
		try {
			this.gitStatus = await rpcBridge.getProjectGitStatus(this.projectPath);
			if (this.gitStatus?.inside_repo) {
				await this.refreshGitBranches();
			} else {
				this.availableBranches = [];
			}
		} catch {
			this.gitStatus = null;
			this.availableBranches = [];
		} finally {
			this.loadingGitStatus = false;
			this.render();
		}
	}

	private async refreshGitBranches(): Promise<void> {
		if (!this.projectPath || !this.gitStatus?.inside_repo) {
			this.availableBranches = [];
			this.loadingBranches = false;
			return;
		}

		this.loadingBranches = true;
		this.render();
		try {
			this.availableBranches = await rpcBridge.listProjectGitBranches(this.projectPath);
		} catch {
			this.availableBranches = [];
		} finally {
			this.loadingBranches = false;
			this.render();
		}
	}

	private async switchBranch(nextBranch: string): Promise<void> {
		if (!this.projectPath || !nextBranch || this.switchingBranch) return;
		if (nextBranch === this.gitStatus?.branch) return;

		this.switchingBranch = true;
		this.render();
		try {
			await rpcBridge.switchProjectGitBranch(this.projectPath, nextBranch);
			this.pushNotice(`Switched to ${nextBranch}`, "success");
			await this.refreshGitStatus();
			await this.refreshFromBackend();
		} catch (err) {
			this.pushFeatureError("Switch branch", err);
		} finally {
			this.switchingBranch = false;
			this.render();
		}
	}

	private scrollToBottom(): void {
		requestAnimationFrame(() => {
			if (!this.scrollContainer) return;
			this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
		});
	}

	private renderNotices(): ReactElement | null {
		if (this.notices.length === 0) return null;
		return (
			<div className="notice-stack">
				{this.notices.map((notice) => (
					<div key={notice.id} className={`notice-card ${notice.kind}`}>
						{notice.text}
					</div>
				))}
			</div>
		);
	}

	private renderUserMessage(msg: UiMessage): ReactElement {
		return (
			<div className="chat-row user-row" data-message-id={msg.id} key={msg.id}>
				<div className="message-shell user-message-shell">
					<div className="message-actions">
						<button className="message-action-btn" onClick={() => this.editUserMessage(msg)} type="button">
							Edit
						</button>
						<button className="message-action-btn" onClick={() => void this.retryUserMessage(msg)} type="button">
							Retry
						</button>
						<button className="message-action-btn" onClick={() => void this.copyMessage(msg)} type="button">
							Copy
						</button>
					</div>
					<div className="bubble user-bubble">
						{msg.deliveryMode && msg.deliveryMode !== "prompt" ? (
							<div className="bubble-chip">{msg.deliveryMode === "steer" ? "steer" : "follow-up"}</div>
						) : null}
						{msg.text ? <div className="bubble-text">{msg.text}</div> : null}
						{msg.attachments && msg.attachments.length > 0 ? (
							<div className="attachment-grid">
								{msg.attachments.map((img) => (
									<div className="attachment-item" title={img.name} key={img.id}>
										<img src={img.previewUrl} alt={img.name} />
									</div>
								))}
							</div>
						) : null}
					</div>
				</div>
			</div>
		);
	}

	private renderThinking(msg: UiMessage): ReactElement | null {
		if (!msg.thinking) return null;
		const expanded = msg.thinkingExpanded ?? false;
		const preview = truncate(msg.thinking.replace(/\s+/g, " "), 92);
		return (
			<div className="thinking-block">
				<button
					className="thinking-toggle"
					onClick={() => {
						msg.thinkingExpanded = !expanded;
						this.render();
					}}
					type="button"
				>
					{expanded ? "▾" : "▸"} {expanded ? "Thinking" : `Thinking: ${preview}`}
				</button>
				{expanded ? <div className="thinking-content">{msg.thinking}</div> : null}
			</div>
		);
	}

	private renderToolCall(tc: ToolCallBlock): ReactElement {
		const statusClass = tc.isRunning ? "status-running" : tc.isError ? "status-error" : "status-ok";
		const titleHint = tc.name === "bash" && typeof tc.args.command === "string" ? (tc.args.command as string) : "";
		const output = tc.streamingOutput ?? tc.result;
		const hasOutput = Boolean(output && output.length > 0);

		return (
			<div className="tool-card" key={tc.id}>
				<button
					className="tool-header"
					onClick={() => {
						tc.isExpanded = !tc.isExpanded;
						this.render();
					}}
					type="button"
				>
					<span className={`status-dot ${statusClass}`}></span>
					<span className="tool-name">{tc.name}</span>
					{titleHint ? (
						<span className="tool-hint" title={titleHint}>
							{truncate(titleHint, 56)}
						</span>
					) : null}
					<span className="tool-chevron">{tc.isExpanded ? "▾" : "▸"}</span>
				</button>
				{tc.isExpanded && hasOutput ? (
					<pre className="tool-output">
						{output}
						{tc.isRunning ? <span className="streaming-inline"></span> : null}
					</pre>
				) : null}
			</div>
		);
	}

	private renderAssistantMessage(msg: UiMessage): ReactElement {
		return (
			<div className="chat-row assistant-row" data-message-id={msg.id} key={msg.id}>
				<div className="message-shell assistant-message-shell">
					<div className="message-actions">
						<button className="message-action-btn" onClick={() => void this.copyMessage(msg)} type="button">
							Copy
						</button>
					</div>
					<div className="assistant-block">
						{this.renderThinking(msg)}
						{msg.text ? (
							<div className="assistant-content">
								<div className={`markdown-content ${msg.isStreaming ? "streaming-cursor" : ""}`}>
									<ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
								</div>
							</div>
						) : null}
						{msg.toolCalls.map((tc) => this.renderToolCall(tc))}
					</div>
				</div>
			</div>
		);
	}

	private renderSystemMessage(msg: UiMessage): ReactElement {
		return (
			<div className="chat-row system-row" data-message-id={msg.id} key={msg.id}>
				<div className="system-message">
					{msg.label ? <div className="system-label">{msg.label}</div> : null}
					<div className="system-text">{msg.text}</div>
				</div>
			</div>
		);
	}

	private renderEmptyState(): ReactElement {
		return (
			<div className="empty-state">
				<div className="empty-logo">pi</div>
				<div className="empty-subtitle">Minimal desktop harness for the pi coding agent.</div>
				<div className="empty-actions">
					<button className="ghost-btn" onClick={() => this.setInputText("List all TypeScript files in this project")} type="button">
						List files
					</button>
					<button
						className="ghost-btn"
						onClick={() => this.setInputText("Review this codebase and suggest improvements")}
						type="button"
					>
						Review codebase
					</button>
				</div>
			</div>
		);
	}

	private formatTokenValue(value: number): string {
		if (!value || value <= 0) return "0";
		if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
		if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
		return `${Math.round(value)}`;
	}

	private formatCostValue(value: number): string {
		if (!value || value <= 0) return "$0";
		if (value < 0.01) return `$${value.toFixed(4)}`;
		return `$${value.toFixed(2)}`;
	}

	private renderSessionStatusRow(): ReactElement {
		const tokensTotal = this.sessionStats?.tokensTotal ?? 0;
		const costTotal = this.sessionStats?.costTotal ?? 0;
		const contextWindow = this.state?.model?.contextWindow;
		const usagePercent = contextWindow && contextWindow > 0 ? Math.min(999, (tokensTotal / contextWindow) * 100) : null;
		const pending = this.state?.pendingMessageCount ?? 0;
		const messageCount = this.state?.messageCount ?? this.messages.length;
		const projectPath = this.projectPath ?? "No project";

		const branchSelectValue = this.gitStatus?.inside_repo && this.gitStatus.branch ? this.gitStatus.branch : "";
		const canSwitchBranch =
			Boolean(this.projectPath) &&
			Boolean(this.gitStatus?.inside_repo) &&
			!this.loadingGitStatus &&
			!this.loadingBranches &&
			!this.switchingBranch &&
			this.availableBranches.length > 0;

		return (
			<div className="chat-status-row">
				<div className="chat-status-left">
					<span className="chat-status-item path" title={projectPath}>
						{projectPath}
					</span>
					{this.loadingGitStatus ? (
						<span className="chat-status-item branch">branch: …</span>
					) : this.gitStatus?.inside_repo ? (
						<div className="chat-branch-control">
							<span className="chat-status-item branch-label">branch</span>
							<select
								className="chat-branch-select"
								disabled={!canSwitchBranch}
								onChange={(event) => void this.switchBranch(event.target.value)}
								value={branchSelectValue}
							>
								{branchSelectValue && !this.availableBranches.some((branch) => branch.name === branchSelectValue) ? (
									<option value={branchSelectValue}>{branchSelectValue}</option>
								) : null}
								{this.availableBranches.map((branch) => (
									<option value={branch.name} key={branch.name}>
										{branch.name}
									</option>
								))}
							</select>
							{this.gitStatus?.dirty ? <span className="chat-status-item dirty">dirty</span> : null}
						</div>
					) : (
						<span className="chat-status-item branch">branch: n/a</span>
					)}
				</div>
				<div className="chat-status-right">
					<span className="chat-status-item metric tokens">tokens {this.formatTokenValue(tokensTotal)}</span>
					<span className="chat-status-item metric usage">usage {usagePercent === null ? "n/a" : `${usagePercent.toFixed(1)}%`}</span>
					<span className="chat-status-item metric cost">cost {this.formatCostValue(costTotal)}</span>
					<span className="chat-status-item metric msgs">msgs {messageCount}</span>
					{pending > 0 ? <span className="chat-status-item metric queued">queued {pending}</span> : null}
				</div>
			</div>
		);
	}

	private renderComposerControls(): ReactElement {
		const currentProvider = this.state?.model?.provider ?? "";
		const currentModelId = this.state?.model?.id ?? "";
		const currentModelValue = currentProvider && currentModelId ? `${currentProvider}::${currentModelId}` : "";
		const thinking = this.state?.thinkingLevel ?? "off";
		const isStreaming = this.currentIsStreaming();

		const showAdvancedThinking = this.availableModels.some((m) => m.reasoning);

		return (
			<div className="composer-controls">
				<div className="control-group">
					<select
						className="composer-select"
						value={currentModelValue}
						disabled={this.loadingModels || this.settingModel}
						onChange={(e) => {
							const value = e.target.value;
							const [provider, ...rest] = value.split("::");
							const modelId = rest.join("::");
							if (!provider || !modelId || value === currentModelValue) return;
							void this.setModel(provider, modelId);
						}}
					>
						{this.loadingModels ? <option value="">Loading models…</option> : null}
						{!this.loadingModels && currentModelValue && !this.availableModels.some((m) => `${m.provider}::${m.id}` === currentModelValue) ? (
							<option value={currentModelValue}>{`${currentProvider}/${currentModelId}`}</option>
						) : null}
						{this.availableModels.map((m) => (
							<option value={`${m.provider}::${m.id}`} key={`${m.provider}-${m.id}`}>
								{m.label}
							</option>
						))}
					</select>

					<select
						className="composer-select thinking-select"
						value={thinking}
						disabled={this.settingThinking}
						onChange={(e) => void this.setThinkingLevel(e.target.value as ThinkingLevel)}
					>
						<option value="off">thinking: off</option>
						<option value="minimal">thinking: minimal</option>
						<option value="low">thinking: low</option>
						<option value="medium">thinking: medium</option>
						<option value="high">thinking: high</option>
						{showAdvancedThinking ? <option value="xhigh">thinking: xhigh</option> : null}
					</select>
				</div>

				<div className="control-group right">
					<button className="ghost-btn commands-btn" onClick={() => this.onOpenActions?.()} type="button">
						Commands
					</button>
					{this.compactionStatus ? <span className="status-pill compact">{this.compactionStatus}</span> : null}
					{this.retryStatus ? <span className="status-pill retry">{this.retryStatus}</span> : null}
					{isStreaming ? (
						<>
							<span className="status-pill streaming">streaming</span>
							<button className="danger-btn commands-btn" onClick={() => void this.abortCurrentRun()} type="button">
								Stop
							</button>
						</>
					) : null}
				</div>
			</div>
		);
	}

	private renderPendingImages(): ReactElement | null {
		if (this.pendingImages.length === 0) return null;
		return (
			<div className="composer-attachments">
				{this.pendingImages.map((img) => (
					<div className="composer-attachment" key={img.id}>
						<img src={img.previewUrl} alt={img.name} />
						<div className="composer-attachment-meta">
							<div>{truncate(img.name, 18)}</div>
							<div>{Math.max(1, Math.round(img.size / 1024))} KB</div>
						</div>
						<button onClick={() => this.removePendingImage(img.id)} type="button">
							✕
						</button>
					</div>
				))}
			</div>
		);
	}

	private renderComposer(): ReactElement {
		const isStreaming = this.currentIsStreaming();
		const canSend = this.inputText.trim().length > 0 || this.pendingImages.length > 0;

		return (
			<div className="composer-shell">
				<div className="composer-inner">
					{this.renderComposerControls()}
					{this.renderPendingImages()}

					<div className="composer-row">
						<button
							className="icon-btn"
							title="Attach image"
							onClick={() => {
								const input = this.container.querySelector("#file-picker") as HTMLInputElement | null;
								input?.click();
							}}
							type="button"
						>
							＋
						</button>

						<textarea
							id="chat-input"
							className="chat-input"
							placeholder="Message pi…  Enter send · Alt+Enter follow-up · Shift+Enter newline"
							rows={1}
							value={this.inputText}
							onInput={(e) => {
								const ta = e.currentTarget;
								this.inputText = ta.value;
								ta.style.height = "auto";
								ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
								this.render();
							}}
							onPaste={(e) => {
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
							onKeyDown={(e) => {
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

						{isStreaming ? (
							<div className="stream-send-group">
								<button className="send-btn secondary" disabled={!canSend} onClick={() => void this.sendMessage("followUp")} type="button">
									Follow-up
								</button>
								<button className="send-btn" disabled={!canSend} onClick={() => void this.sendMessage("steer")} type="button">
									Steer
								</button>
							</div>
						) : (
							<button className="send-btn" disabled={!canSend} onClick={() => void this.sendMessage("prompt")} type="button">
								Send
							</button>
						)}

						<input
							id="file-picker"
							type="file"
							accept="image/*"
							multiple
							style={{ display: "none" }}
							onChange={(e) => {
								const files = e.target.files;
								if (files?.length) void this.prepareImages(files);
								e.target.value = "";
							}}
						/>
					</div>
					{this.renderSessionStatusRow()}
				</div>
			</div>
		);
	}

	private renderForkPicker(): ReactElement | null {
		if (!this.forkPickerOpen) return null;
		return (
			<div
				className="overlay"
				onClick={(e) => {
					if (e.target === e.currentTarget) this.closeForkPicker();
				}}
			>
				<div className="overlay-card">
					<div className="overlay-header">
						<div>Fork from earlier user message</div>
						<button onClick={() => this.closeForkPicker()} type="button">
							✕
						</button>
					</div>
					<div className="overlay-body">
						{this.openingForkPicker ? (
							<div className="overlay-empty">Loading…</div>
						) : this.forkOptions.length === 0 ? (
							<div className="overlay-empty">No fork points available.</div>
						) : (
							this.forkOptions.map((option) => (
								<button className="fork-option" onClick={() => void this.forkFrom(option.entryId)} type="button" key={option.entryId}>
									{truncate(option.text.replace(/\s+/g, " "), 140)}
								</button>
							))
						)}
					</div>
				</div>
			</div>
		);
	}

	private renderHistoryViewer(): ReactElement | null {
		if (!this.historyViewerOpen) return null;

		const query = this.historyQuery.trim().toLowerCase();
		const filtered = this.messages.filter((msg) => {
			if (this.historyRoleFilter !== "all" && msg.role !== this.historyRoleFilter) return false;
			if (!query) return true;
			const haystack = `${msg.role} ${msg.label || ""} ${this.messagePreview(msg)}`.toLowerCase();
			return haystack.includes(query);
		});

		return (
			<div
				className="overlay"
				onClick={(e) => {
					if (e.target === e.currentTarget) this.closeHistoryViewer();
				}}
			>
				<div className="overlay-card history-card">
					<div className="overlay-header">
						<div>Session history</div>
						<button onClick={() => this.closeHistoryViewer()} type="button">
							✕
						</button>
					</div>
					<div className="history-controls">
						<input
							type="text"
							placeholder="Search messages"
							value={this.historyQuery}
							onInput={(e) => {
								this.historyQuery = e.currentTarget.value;
								this.render();
							}}
						/>
						<select
							className="settings-select"
							value={this.historyRoleFilter}
							onChange={(e) => {
								this.historyRoleFilter = e.target.value as UiRole | "all";
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
					<div className="overlay-body history-list">
						{filtered.length === 0 ? (
							<div className="overlay-empty">No messages match your filters.</div>
						) : (
							filtered.map((msg, idx) => (
								<div className="history-item" key={msg.id}>
									<button className="history-jump" onClick={() => this.revealMessage(msg.id)} type="button">
										<div className="history-meta">
											<span className={`history-role role-${msg.role}`}>{msg.role}</span>
											<span>#{idx + 1}</span>
										</div>
										<div className="history-preview">{truncate(this.messagePreview(msg).replace(/\s+/g, " "), 180)}</div>
									</button>
									<div className="history-item-actions">
										{msg.role === "user" ? (
											<button
												className="message-action-btn"
												onClick={() => {
													this.editUserMessage(msg);
													this.closeHistoryViewer();
												}}
												type="button"
											>
												Edit
											</button>
										) : null}
										<button className="message-action-btn" onClick={() => void this.copyMessage(msg)} type="button">
											Copy
										</button>
									</div>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		);
	}

	private doRender(): void {
		const hasMessages = this.messages.length > 0;

		this.root.render(
			<div
				className="chat-root"
				onDragOver={(e) => {
					e.preventDefault();
				}}
				onDrop={(e) => {
					e.preventDefault();
					if (e.dataTransfer?.files?.length) {
						void this.prepareImages(e.dataTransfer.files);
					}
				}}
			>
				<div className="chat-scroll" id="chat-scroll">
					{hasMessages
						? this.messages.map((m) => {
								if (m.role === "user") return this.renderUserMessage(m);
								if (m.role === "assistant") return this.renderAssistantMessage(m);
								return this.renderSystemMessage(m);
							})
						: this.renderEmptyState()}
				</div>
				{this.renderComposer()}
				{this.renderForkPicker()}
				{this.renderHistoryViewer()}
				{this.renderNotices()}
			</div>,
		);

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
