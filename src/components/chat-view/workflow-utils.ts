export type WorkflowRole = "user" | "assistant" | "system" | "custom";

export interface WorkflowToolCall {
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

export interface WorkflowMessage {
	id: string;
	role: WorkflowRole;
	text: string;
	toolCalls: WorkflowToolCall[];
	thinking?: string;
	errorText?: string;
	isStreaming?: boolean;
	isThinkingStreaming?: boolean;
}

export interface WorkflowToolCallGroup {
	id: string;
	toolName: string;
	preview: string;
	calls: WorkflowToolCall[];
}

export interface AssistantWorkflow {
	id: string;
	messages: WorkflowMessage[];
	toolCalls: WorkflowToolCall[];
	toolGroups: WorkflowToolCallGroup[];
	thinkingText: string;
	finalText: string;
	errorText: string;
	isStreaming: boolean;
	startedAt: number;
	endedAt: number;
	isTerminal: boolean;
}

export interface AssistantWorkflowCandidate {
	workflow: AssistantWorkflow;
	nextIndex: number;
}

interface ResolveWorkflowExpansionStateParams {
	workflowId: string;
	toolCalls: WorkflowToolCall[];
	isTerminal: boolean;
	keepWorkflowExpandedUntilAssistantText: boolean;
	runSawToolActivity: boolean;
	expandedWorkflowIds: ReadonlySet<string>;
	collapsedAutoWorkflowIds: ReadonlySet<string>;
}

interface CollectAssistantWorkflowParams {
	messages: WorkflowMessage[];
	startIndex: number;
	currentIsStreaming: boolean;
	keepWorkflowExpandedUntilAssistantText: boolean;
	runHasAssistantText: boolean;
	truncateText: (value: string, len: number) => string;
}

function pickToolArg(args: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return "";
}

export function normalizeThinkingText(value: string): string {
	let text = value.replace(/^\s*thinking\.\.\.\s*/i, "").trim();
	if (!text) return "";
	const paragraphs = text
		.split(/\n{2,}/)
		.map((part) => part.trim())
		.filter(Boolean);
	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const part of paragraphs) {
		if (seen.has(part)) continue;
		seen.add(part);
		deduped.push(part);
	}
	text = deduped.join("\n\n").trim();
	const half = Math.floor(text.length / 2);
	if (text.length > 40 && text.length % 2 === 0 && text.slice(0, half) === text.slice(half)) {
		text = text.slice(0, half).trim();
	}
	return text;
}

export function isStandaloneCodeBlockMarkdown(value: string): boolean {
	const text = value.trim();
	if (!text) return false;
	if (/^```[^\n`]*\n[\s\S]*\n```$/.test(text)) return true;
	if (/^~~~[^\n~]*\n[\s\S]*\n~~~$/.test(text)) return true;
	return false;
}

export function summarizeToolCall(
	toolCall: WorkflowToolCall,
	truncateText: (value: string, len: number) => string,
): string {
	const name = toolCall.name.trim().toLowerCase();
	const command = pickToolArg(toolCall.args, ["command", "cmd", "shell", "script"]);
	const path = pickToolArg(toolCall.args, ["path", "filePath", "targetPath", "from", "to"]);
	const query = pickToolArg(toolCall.args, ["query", "pattern", "glob", "name"]);
	if (name === "bash" && command) return `Ran ${truncateText(command, 84)}`;
	if ((name === "read" || name === "readfile") && path) return `Read ${truncateText(path, 74)}`;
	if ((name === "write" || name === "writefile") && path) return `Wrote ${truncateText(path, 74)}`;
	if (name === "edit" && path) return `Edited ${truncateText(path, 74)}`;
	if (name.includes("search") && query) return `Explored ${truncateText(query, 74)}`;
	if ((name === "list" || name.includes("ls")) && path) return `Explored ${truncateText(path, 74)}`;
	if (path) return `${toolCall.name} ${truncateText(path, 74)}`;
	return `Ran ${toolCall.name}`;
}

function buildToolCallGroups(
	toolCalls: WorkflowToolCall[],
	truncateText: (value: string, len: number) => string,
): WorkflowToolCallGroup[] {
	const groups: WorkflowToolCallGroup[] = [];
	for (const toolCall of toolCalls) {
		const preview = summarizeToolCall(toolCall, truncateText);
		const previous = groups[groups.length - 1];
		if (previous && previous.toolName === toolCall.name && previous.preview === preview) {
			previous.calls.push(toolCall);
			continue;
		}
		groups.push({
			id: `${toolCall.id}-group`,
			toolName: toolCall.name,
			preview,
			calls: [toolCall],
		});
	}
	return groups;
}

function isThinkingOnlyAssistantMessage(message: WorkflowMessage | undefined): boolean {
	if (!message || message.role !== "assistant") return false;
	if (message.toolCalls.length > 0) return false;
	if (message.text.trim().length > 0) return false;
	if ((message.errorText ?? "").trim().length > 0) return false;
	return Boolean((message.thinking ?? "").trim());
}

export function collectAssistantWorkflow({
	messages,
	startIndex,
	currentIsStreaming,
	keepWorkflowExpandedUntilAssistantText,
	runHasAssistantText,
	truncateText,
}: CollectAssistantWorkflowParams): AssistantWorkflowCandidate | null {
	const start = messages[startIndex];
	if (!start || start.role !== "assistant") return null;
	const startIsThinkingOnly = isThinkingOnlyAssistantMessage(start);
	const startHasTools = start.toolCalls.length > 0;
	if (!startIsThinkingOnly && !startHasTools) return null;

	const grouped: WorkflowMessage[] = [];
	let sawTools = false;
	let consumedFinalMessage = false;
	let cursor = startIndex;

	while (cursor < messages.length) {
		const candidate = messages[cursor];
		if (!candidate || candidate.role !== "assistant") break;
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

		if (!sawTools) {
			if (hasThinking && !hasText && !hasError) {
				grouped.push(candidate);
				cursor += 1;
				continue;
			}
			break;
		}

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

	if (grouped.length === 0) return null;
	const toolCalls = grouped.flatMap((entry) => entry.toolCalls);
	const isProvisionalWorkflow =
		toolCalls.length === 0 && currentIsStreaming && keepWorkflowExpandedUntilAssistantText && !runHasAssistantText;
	if (toolCalls.length === 0 && !isProvisionalWorkflow) return null;

	const startedAt = toolCalls.reduce((min, toolCall) => {
		if (!toolCall.startedAt) return min;
		return min === 0 ? toolCall.startedAt : Math.min(min, toolCall.startedAt);
	}, 0);
	const endedAt = toolCalls.reduce((max, toolCall) => {
		if (!toolCall.endedAt) return max;
		return Math.max(max, toolCall.endedAt);
	}, 0);
	const thinkingParts = grouped
		.map((entry) => normalizeThinkingText((entry.thinking ?? "").replace(/^\s+/, "")))
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
	const workflowId = `workflow-${grouped[0]?.id ?? start.id}`;

	const nextIndex = Math.max(startIndex + 1, cursor);
	return {
		workflow: {
			id: workflowId,
			messages: grouped,
			toolCalls,
			toolGroups: buildToolCallGroups(toolCalls, truncateText),
			thinkingText,
			finalText,
			errorText,
			isStreaming: grouped.some((entry) => entry.isStreaming),
			startedAt,
			endedAt,
			isTerminal: nextIndex >= messages.length,
		},
		nextIndex,
	};
}

export function resolveWorkflowExpansionState({
	workflowId,
	toolCalls,
	isTerminal,
	keepWorkflowExpandedUntilAssistantText,
	runSawToolActivity,
	expandedWorkflowIds,
	collapsedAutoWorkflowIds,
}: ResolveWorkflowExpansionStateParams): {
	total: number;
	running: number;
	autoExpanded: boolean;
	expanded: boolean;
} {
	const total = toolCalls.length;
	const running = toolCalls.filter((toolCall) => toolCall.isRunning).length;
	const manualExpanded = expandedWorkflowIds.has(workflowId);
	const autoExpanded =
		isTerminal && keepWorkflowExpandedUntilAssistantText && (running > 0 || runSawToolActivity || total === 0);
	const expanded = (autoExpanded && !collapsedAutoWorkflowIds.has(workflowId)) || manualExpanded;
	return {
		total,
		running,
		autoExpanded,
		expanded,
	};
}
