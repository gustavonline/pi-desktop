import { rpcBridge, type RpcImageInput, type RpcSessionState } from "../../rpc/bridge.js";

type NoticeKind = "info" | "success" | "error";

type DeliveryMode = "prompt" | "steer" | "followUp";

interface SendMessageFlowParams<ImageItem> {
	mode: DeliveryMode;
	bindingStatusText: string | null;
	isComposerInteractionLocked: () => boolean;
	inputText: string;
	selectedSkillCommandText: string;
	pendingImages: ImageItem[];
	slashQueryFromInput: () => string | null;
	executeSlashCommandFromComposer: () => Promise<void>;
	rememberComposerHistoryEntry: (text: string) => void;
	currentIsStreaming: () => boolean;
	applyBackendState: (state: RpcSessionState) => void;
	clearStreamingUiState: () => void;
	render: () => void;
	enqueueComposerQueueMessage: (text: string, images: ImageItem[]) => string;
	pushNotice: (text: string, kind: NoticeKind) => void;
	pushUserEcho: (text: string, mode: DeliveryMode, images: ImageItem[]) => void;
	clearComposer: () => void;
	setSendingPrompt: (value: boolean) => void;
	toRpcImages: (images: ImageItem[]) => RpcImageInput[];
	removeComposerQueueMessage: (id: string) => void;
	onPromptSubmitted?: () => void;
}

export async function sendMessageFlow<ImageItem>({
	mode,
	bindingStatusText,
	isComposerInteractionLocked,
	inputText,
	selectedSkillCommandText,
	pendingImages,
	slashQueryFromInput,
	executeSlashCommandFromComposer,
	rememberComposerHistoryEntry,
	currentIsStreaming,
	applyBackendState,
	clearStreamingUiState,
	render,
	enqueueComposerQueueMessage,
	pushNotice,
	pushUserEcho,
	clearComposer,
	setSendingPrompt,
	toRpcImages,
	removeComposerQueueMessage,
	onPromptSubmitted,
}: SendMessageFlowParams<ImageItem>): Promise<void> {
	if (isComposerInteractionLocked()) {
		pushNotice(bindingStatusText || "Session is still loading. Try again in a moment.", "info");
		return;
	}
	const promptText = inputText.trim();
	const selectedSkillCommand = selectedSkillCommandText.trim();
	const text = selectedSkillCommand ? (promptText ? `${selectedSkillCommand}\n\n${promptText}` : selectedSkillCommand) : promptText;
	const images = [...pendingImages];
	if (!selectedSkillCommand && images.length === 0 && slashQueryFromInput() !== null) {
		await executeSlashCommandFromComposer();
		return;
	}
	if (!text && images.length === 0) return;
	if (text) rememberComposerHistoryEntry(text);

	let streaming = currentIsStreaming();
	if (streaming) {
		try {
			const backendState = await rpcBridge.getState();
			const backendStreaming = Boolean(backendState.isStreaming);
			applyBackendState(backendState);
			if (!backendStreaming) {
				streaming = false;
				clearStreamingUiState();
				render();
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
		queuedMessageId = enqueueComposerQueueMessage(text, images);
		pushNotice("Queued message", "info");
	} else {
		pushUserEcho(text, actualMode, images);
	}
	clearComposer();
	setSendingPrompt(true);
	render();

	try {
		const rpcImages = toRpcImages(images);
		if (actualMode === "prompt") {
			await rpcBridge.prompt(text, { images: rpcImages });
		} else if (actualMode === "steer") {
			await rpcBridge.steer(text, rpcImages);
		} else {
			await rpcBridge.followUp(text, rpcImages);
			void rpcBridge
				.getState()
				.then((state) => {
					applyBackendState(state);
					render();
				})
				.catch(() => {
					/* ignore */
				});
		}
		onPromptSubmitted?.();
	} catch (err) {
		if (queuedMessageId) {
			removeComposerQueueMessage(queuedMessageId);
		}
		console.error("Failed to send message:", err);
		pushNotice(err instanceof Error ? err.message : "Failed to send message", "error");
	} finally {
		setSendingPrompt(false);
		render();
	}
}
