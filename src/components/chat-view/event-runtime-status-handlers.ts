type NoticeKind = "info" | "success" | "error";

interface RuntimeMessageLike {
	role: string;
	errorText?: string;
	isStreaming?: boolean;
	isThinkingStreaming?: boolean;
}

interface HandleRuntimeStatusEventContext {
	projectPath: string | null;
	isLoadingModels: () => boolean;
	isRpcConnected: () => boolean;
	getLastMessage: () => RuntimeMessageLike | null;
	setConnected: (connected: boolean) => void;
	setBindingStatusText: (text: string | null) => void;
	clearDisconnectNoticeTimer: () => void;
	scheduleDisconnectNoticeTimer: (callback: () => void, delayMs: number) => void;
	setLoadingModels: (loading: boolean) => void;
	bumpModelLoadRequestSeq: () => void;
	cancelStreamingUiReconcile: () => void;
	scheduleStreamingUiReconcile: (delayMs?: number) => void;
	setPendingDeliveryMode: (mode: "prompt" | "steer") => void;
	setRunFlags: (flags: { hasAssistantText: boolean; sawToolActivity: boolean; keepWorkflowExpanded: boolean }) => void;
	clearCollapsedAutoWorkflowIds: () => void;
	setStateStreaming: (streaming: boolean) => void;
	setAutoFollowChat: (next: boolean) => void;
	onRunStateChange: (running: boolean) => void;
	setRetryStatus: (status: string) => void;
	pushRuntimeNotice: (text: string, kind?: NoticeKind, dedupeMs?: number) => void;
	pushNotice: (text: string, kind: NoticeKind) => void;
	extractRuntimeErrorMessage: (event: Record<string, unknown> | null | undefined) => string;
	truncate: (value: string, len: number) => string;
	extensionLabelFromPath: (pathValue: string | null | undefined) => string;
	maybePushExtensionCompatibilityHint: (event: Record<string, unknown>, errorMessage: string) => void;
	render: () => void;
	scrollToBottom: () => void;
	refreshFromBackend: () => Promise<void>;
	loadAvailableModels: () => Promise<void>;
	refreshStateAfterAgentEnd: () => void;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = source;
	for (const part of parts) {
		if (!current || typeof current !== "object") return null;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function pickString(source: Record<string, unknown>, paths: string[]): string | null {
	for (const path of paths) {
		const value = readPath(source, path);
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed.length > 0) return trimmed;
	}
	return null;
}

export function handleRuntimeStatusEvent(
	type: string,
	event: Record<string, unknown>,
	context: HandleRuntimeStatusEventContext,
): boolean {
	switch (type) {
		case "agent_start": {
			context.setPendingDeliveryMode("steer");
			context.setRunFlags({
				hasAssistantText: false,
				sawToolActivity: false,
				keepWorkflowExpanded: true,
			});
			context.clearCollapsedAutoWorkflowIds();
			context.setStateStreaming(true);
			context.setAutoFollowChat(true);
			context.onRunStateChange(true);
			context.scheduleStreamingUiReconcile(2400);
			context.render();
			context.scrollToBottom();
			return true;
		}

		case "agent_end": {
			context.cancelStreamingUiReconcile();
			context.setStateStreaming(false);
			const last = context.getLastMessage();
			if (last && last.role === "assistant") {
				last.isStreaming = false;
				last.isThinkingStreaming = false;
			}
			context.setRetryStatus("");
			const runError = context.extractRuntimeErrorMessage(event);
			if (runError && !(last?.role === "assistant" && last.errorText)) {
				context.pushRuntimeNotice(`Run failed: ${context.truncate(runError, 180)}`, "error", 2600);
			}
			context.setRunFlags({
				hasAssistantText: false,
				sawToolActivity: false,
				keepWorkflowExpanded: false,
			});
			context.onRunStateChange(false);
			context.refreshStateAfterAgentEnd();
			context.render();
			return true;
		}

		case "error": {
			const errorMessage = context.extractRuntimeErrorMessage(event) || "Unknown runtime error";
			const source = pickString(event, ["source", "phase", "stage", "provider", "code"]);
			if (source === "stderr" || source === "stdout_text") {
				const line = /^error\b[:\s-]*/i.test(errorMessage) ? errorMessage : `Error: ${errorMessage}`;
				context.pushRuntimeNotice(context.truncate(line, 220), "error", 2600);
			} else {
				const prefix = source ? `Runtime error (${source})` : "Runtime error";
				context.pushRuntimeNotice(`${prefix}: ${context.truncate(errorMessage, 180)}`, "error", 2600);
			}
			return true;
		}

		case "extension_error": {
			const error = context.extractRuntimeErrorMessage(event) || "Unknown extension error";
			const extensionPath = pickString(event, ["extensionPath", "extension"]);
			const extensionLabel = context.extensionLabelFromPath(extensionPath);
			const source = pickString(event, ["event", "source", "callback", "method", "provider"]);
			const prefix = source ? `Extension error (${extensionLabel}:${source})` : `Extension error (${extensionLabel})`;
			context.pushRuntimeNotice(`${prefix}: ${context.truncate(error, 180)}`, "error", 2600);
			context.maybePushExtensionCompatibilityHint(event, error);
			return true;
		}

		case "rpc_connected": {
			context.setConnected(true);
			context.setBindingStatusText(context.projectPath ? "Loading session…" : null);
			context.clearDisconnectNoticeTimer();
			context.render();
			if (context.projectPath) {
				void context.refreshFromBackend();
				if (!context.isLoadingModels()) {
					void context.loadAvailableModels();
				}
			}
			return true;
		}

		case "rpc_disconnected": {
			context.setConnected(false);
			context.cancelStreamingUiReconcile();
			context.setBindingStatusText(context.projectPath ? "Reconnecting session…" : null);
			context.bumpModelLoadRequestSeq();
			context.setLoadingModels(false);
			context.clearDisconnectNoticeTimer();
			context.scheduleDisconnectNoticeTimer(() => {
				if (!context.isRpcConnected()) {
					context.pushNotice("Disconnected from pi process", "error");
					context.render();
				}
			}, 900);
			return true;
		}

		default:
			return false;
	}
}
