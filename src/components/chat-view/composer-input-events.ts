import type { SlashPaletteItem } from "../../commands/slash-command-runtime.js";

type ComposerHistoryDirection = "up" | "down";
type ComposerSendMode = "prompt" | "steer" | "followUp";

interface HandleComposerInputEventParams {
	event: Event;
	interactionLocked: boolean;
	slashPaletteOpenBefore: boolean;
	onSetInputText: (text: string) => void;
	onResetComposerHistoryNavigation: () => void;
	onUpdateSlashPaletteStateFromInput: () => void;
	onIsSlashPaletteOpen: () => boolean;
	onRender: () => void;
}

interface HandleComposerPasteEventParams {
	event: ClipboardEvent;
	interactionLocked: boolean;
	onPrepareImages: (files: File[]) => void | Promise<unknown>;
}

interface HandleComposerDragOverEventParams {
	event: DragEvent;
	interactionLocked: boolean;
}

interface HandleComposerDropEventParams {
	event: DragEvent;
	interactionLocked: boolean;
	onHandleDroppedDataTransfer: (dataTransfer: DataTransfer | null) => void;
}

interface HandleComposerFilePickerChangeEventParams {
	event: Event;
	interactionLocked: boolean;
	onPrepareFiles: (files: FileList | File[]) => void | Promise<unknown>;
}

interface HandleComposerKeyDownEventParams {
	event: KeyboardEvent;
	interactionLocked: boolean;
	isStreaming: boolean;
	modelPickerOpen: boolean;
	inputText: string;
	hasSelectedSkillDraft: boolean;
	slashPaletteOpen: boolean;
	composerHistoryIndex: number;
	onCloseModelPicker: () => void;
	onRemoveSelectedSkillDraft: () => void;
	onCycleThinkingLevel: (step: 1 | -1) => void | Promise<unknown>;
	shouldHandleComposerHistoryKey: (event: KeyboardEvent, textarea: HTMLTextAreaElement, direction: ComposerHistoryDirection) => boolean;
	onNavigateComposerHistory: (direction: ComposerHistoryDirection) => void;
	getSlashPaletteItems: () => SlashPaletteItem[];
	onSetSlashPaletteNavigationMode: (mode: "pointer" | "keyboard") => void;
	getSlashPaletteIndex: () => number;
	onSetSlashPaletteIndex: (index: number) => void;
	onPreviewSlashPaletteItem: (item: SlashPaletteItem) => void;
	onRender: () => void;
	onEnsureActiveSlashItemVisible: () => void;
	onCloseSlashPalette: () => void;
	slashQueryFromInput: () => string | null;
	onExecuteSlashCommandFromComposer: () => void | Promise<unknown>;
	onSendMessage: (mode: ComposerSendMode) => void | Promise<unknown>;
}

export function handleComposerInputEvent({
	event,
	interactionLocked,
	slashPaletteOpenBefore,
	onSetInputText,
	onResetComposerHistoryNavigation,
	onUpdateSlashPaletteStateFromInput,
	onIsSlashPaletteOpen,
	onRender,
}: HandleComposerInputEventParams): void {
	if (interactionLocked) return;
	const textarea = event.target as HTMLTextAreaElement;
	onSetInputText(textarea.value);
	onResetComposerHistoryNavigation();
	onUpdateSlashPaletteStateFromInput();
	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
	if (onIsSlashPaletteOpen() || slashPaletteOpenBefore) {
		onRender();
	}
}

export function handleComposerPasteEvent({
	event,
	interactionLocked,
	onPrepareImages,
}: HandleComposerPasteEventParams): void {
	if (interactionLocked) {
		event.preventDefault();
		return;
	}
	const items = Array.from(event.clipboardData?.items || []);
	const files = items
		.filter((item) => item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => Boolean(file));
	if (files.length > 0) {
		event.preventDefault();
		void onPrepareImages(files);
	}
}

export function handleComposerDragOverEvent({ event, interactionLocked }: HandleComposerDragOverEventParams): void {
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = interactionLocked ? "none" : "copy";
}

export function handleComposerDropEvent({
	event,
	interactionLocked,
	onHandleDroppedDataTransfer,
}: HandleComposerDropEventParams): void {
	event.preventDefault();
	if (interactionLocked) return;
	onHandleDroppedDataTransfer(event.dataTransfer ?? null);
}

export function handleComposerFilePickerChangeEvent({
	event,
	interactionLocked,
	onPrepareFiles,
}: HandleComposerFilePickerChangeEventParams): void {
	const input = event.target as HTMLInputElement;
	if (interactionLocked) {
		input.value = "";
		return;
	}
	const files = input.files;
	if (files?.length) void onPrepareFiles(files);
	input.value = "";
}

export function handleComposerKeyDownEvent({
	event,
	interactionLocked,
	isStreaming,
	modelPickerOpen,
	inputText,
	hasSelectedSkillDraft,
	slashPaletteOpen,
	composerHistoryIndex,
	onCloseModelPicker,
	onRemoveSelectedSkillDraft,
	onCycleThinkingLevel,
	shouldHandleComposerHistoryKey,
	onNavigateComposerHistory,
	getSlashPaletteItems,
	onSetSlashPaletteNavigationMode,
	getSlashPaletteIndex,
	onSetSlashPaletteIndex,
	onPreviewSlashPaletteItem,
	onRender,
	onEnsureActiveSlashItemVisible,
	onCloseSlashPalette,
	slashQueryFromInput,
	onExecuteSlashCommandFromComposer,
	onSendMessage,
}: HandleComposerKeyDownEventParams): void {
	if (interactionLocked) return;
	if (event.key === "Escape" && modelPickerOpen) {
		event.preventDefault();
		onCloseModelPicker();
		return;
	}
	if ((event.key === "Backspace" || event.key === "Delete") && inputText.length === 0 && hasSelectedSkillDraft) {
		event.preventDefault();
		onRemoveSelectedSkillDraft();
		return;
	}
	if (event.key === "Tab" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
		event.preventDefault();
		void onCycleThinkingLevel(1);
		return;
	}
	const textarea = event.currentTarget as HTMLTextAreaElement;
	const canHistoryUp = event.key === "ArrowUp" && shouldHandleComposerHistoryKey(event, textarea, "up");
	const canHistoryDown = event.key === "ArrowDown" && shouldHandleComposerHistoryKey(event, textarea, "down");
	const historyBrowsing = composerHistoryIndex >= 0;
	if (canHistoryUp && (historyBrowsing || !slashPaletteOpen)) {
		event.preventDefault();
		onNavigateComposerHistory("up");
		return;
	}
	if (canHistoryDown && historyBrowsing) {
		event.preventDefault();
		onNavigateComposerHistory("down");
		return;
	}
	const liveSlashItems = getSlashPaletteItems();
	if (slashPaletteOpen && liveSlashItems.length > 0) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			onSetSlashPaletteNavigationMode("keyboard");
			const nextIndex = (getSlashPaletteIndex() + 1) % liveSlashItems.length;
			onSetSlashPaletteIndex(nextIndex);
			const item = liveSlashItems[nextIndex];
			if (item) onPreviewSlashPaletteItem(item);
			onRender();
			onEnsureActiveSlashItemVisible();
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			onSetSlashPaletteNavigationMode("keyboard");
			const nextIndex = (getSlashPaletteIndex() - 1 + liveSlashItems.length) % liveSlashItems.length;
			onSetSlashPaletteIndex(nextIndex);
			const item = liveSlashItems[nextIndex];
			if (item) onPreviewSlashPaletteItem(item);
			onRender();
			onEnsureActiveSlashItemVisible();
			return;
		}
	}
	if (slashPaletteOpen && event.key === "Escape") {
		event.preventDefault();
		onCloseSlashPalette();
		onRender();
		return;
	}
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		if (!hasSelectedSkillDraft && slashQueryFromInput() !== null) {
			void onExecuteSlashCommandFromComposer();
			return;
		}
		if (event.altKey) {
			void onSendMessage("followUp");
		} else {
			const mode: ComposerSendMode = isStreaming ? "steer" : "prompt";
			void onSendMessage(mode);
		}
	}
}
