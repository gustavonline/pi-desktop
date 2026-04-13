interface PendingImageLike {
	id: string;
	name: string;
	mimeType: string;
	data: string;
	previewUrl: string;
	size: number;
}

interface ToolCallBlockLike {
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

interface UiMessageLike {
	id: string;
	sessionEntryId?: string;
	role: "user" | "assistant" | "system" | "custom";
	text: string;
	toolCalls: ToolCallBlockLike[];
	attachments?: PendingImageLike[];
	thinking?: string;
	thinkingExpanded?: boolean;
	isThinkingStreaming?: boolean;
	label?: string;
}

interface MapBackendMessagesParams {
	backendMessages: Array<Record<string, unknown>>;
	allThinkingExpanded: boolean;
	createId: (prefix?: string) => string;
	extractText: (content: unknown) => string;
	extractImages: (content: unknown) => PendingImageLike[];
	extractToolOutput: (payload: unknown) => string;
}

function pickNumber(source: Record<string, unknown>, paths: string[]): number | null {
	for (const key of paths) {
		const value = source[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}

export function mapBackendMessages({
	backendMessages,
	allThinkingExpanded,
	createId,
	extractText,
	extractImages,
	extractToolOutput,
}: MapBackendMessagesParams): UiMessageLike[] {
	const mapped: UiMessageLike[] = [];
	const toolCallMap = new Map<string, ToolCallBlockLike>();

	for (const raw of backendMessages) {
		const role = raw.role as string | undefined;
		if (!role) continue;
		const sessionEntryId = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : undefined;

		switch (role) {
			case "user": {
				const text = extractText(raw.content);
				const attachments = extractImages(raw.content);
				mapped.push({
					id: createId("user"),
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
				const toolCalls: ToolCallBlockLike[] = [];

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
						const id = typeof p.id === "string" && p.id.trim().length > 0 ? p.id.trim() : createId("tc");
						const existing = toolCalls.find((entry) => entry.id === id);
						if (existing) {
							existing.name = typeof p.name === "string" ? p.name : existing.name;
							existing.args = (p.arguments as Record<string, unknown>) ?? existing.args;
							existing.isRunning = false;
							existing.isExpanded = false;
							toolCallMap.set(existing.id, existing);
							continue;
						}
						const toolCall: ToolCallBlockLike = {
							id,
							name: typeof p.name === "string" ? p.name : "tool",
							args: (p.arguments as Record<string, unknown>) ?? {},
							isRunning: false,
							isExpanded: false,
							startedAt: pickNumber(p, ["startedAt", "startTime", "timestamp", "ts"]) ?? undefined,
							endedAt: pickNumber(p, ["endedAt", "endTime"]) ?? undefined,
						};
						toolCalls.push(toolCall);
						toolCallMap.set(toolCall.id, toolCall);
					}
				}

				const normalizedThinking = thinking.trim();
				if (text.trim().length === 0 && normalizedThinking.length === 0 && toolCalls.length === 0) {
					break;
				}
				mapped.push({
					id: createId("assistant"),
					sessionEntryId,
					role: "assistant",
					text,
					thinking: normalizedThinking || undefined,
					thinkingExpanded: allThinkingExpanded,
					isThinkingStreaming: false,
					toolCalls,
				});
				break;
			}
			case "toolResult": {
				const toolCallId = raw.toolCallId as string | undefined;
				const content = extractToolOutput(raw.content ?? raw.result ?? raw);
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
							id: toolCallId || createId("tc"),
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
							id: createId("toolResult"),
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
					id: createId("bash"),
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
				const summary = typeof raw.summary === "string" ? raw.summary : extractText(raw.content);
				mapped.push({
					id: createId(role),
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
				const content = extractText(raw.content);
				mapped.push({
					id: createId("custom"),
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
