export type HistoryUiRole = "user" | "assistant" | "system" | "custom";

interface SessionTreeEntryRecord {
	id: string;
	parentId: string | null;
	type: string;
	index: number;
	role: HistoryUiRole;
	entryLabel: string;
	preview: string;
	displayText: string;
	canFork: boolean;
}

export interface HistoryTreeRowRecord {
	entryId: string;
	depth: number;
	role: HistoryUiRole;
	entryLabel: string;
	preview: string;
	displayText: string;
	linePrefix: string;
	onActivePath: boolean;
	canFork: boolean;
}

interface ParseSessionTreeRowsParams {
	sessionContent: string;
	currentSessionEntryIds: string[];
	extractText: (value: unknown) => string;
	extractToolOutput: (value: unknown) => string;
	truncateText: (value: string, len: number) => string;
	pickString: (source: Record<string, unknown>, paths: string[]) => string | null;
	pickNumber: (source: Record<string, unknown>, paths: string[]) => number | null;
}

function roleFromSessionEntry(roleRaw: string): HistoryUiRole {
	const normalized = roleRaw.trim().toLowerCase();
	if (normalized === "user") return "user";
	if (normalized === "assistant") return "assistant";
	if (normalized === "custom" || normalized === "custom_message") return "custom";
	return "system";
}

function mapSessionTreeEntry(
	record: Record<string, unknown>,
	index: number,
	labelsByTargetId: Map<string, string>,
	params: Pick<ParseSessionTreeRowsParams, "extractText" | "extractToolOutput" | "truncateText" | "pickString" | "pickNumber">,
): SessionTreeEntryRecord | null {
	const { extractText, extractToolOutput, truncateText, pickString, pickNumber } = params;
	const type = typeof record.type === "string" ? record.type.trim() : "";
	if (!type || type === "session" || type === "label") return null;

	const id = typeof record.id === "string" ? record.id.trim() : "";
	if (!id) return null;

	const parentRaw = record.parentId;
	const parentId = typeof parentRaw === "string" && parentRaw.trim().length > 0 ? parentRaw.trim() : null;
	let role: HistoryUiRole = "system";
	let entryLabel = type.replace(/_/g, " ");
	let preview = "";
	let displayText = "";
	let canFork = false;

	switch (type) {
		case "message": {
			const message = record.message;
			const messageRecord = message && typeof message === "object" ? (message as Record<string, unknown>) : null;
			const messageRoleRaw = typeof messageRecord?.role === "string" ? messageRecord.role.trim() : "system";
			const messageRole = messageRoleRaw.toLowerCase();

			if (messageRole === "user") {
				role = "user";
				entryLabel = "user";
				preview = extractText(messageRecord?.content).replace(/\s+/g, " ").trim() || "(empty message)";
				displayText = `user: ${preview}`;
				canFork = true;
				break;
			}

			if (messageRole === "assistant") {
				role = "assistant";
				entryLabel = "assistant";
				const contentPreview = extractText(messageRecord?.content).replace(/\s+/g, " ").trim();
				const stopReason = pickString(messageRecord ?? {}, ["stopReason", "stop_reason"]) ?? "";
				const errorMessage = pickString(messageRecord ?? {}, ["errorMessage", "error_message"]) ?? "";
				preview = contentPreview || (stopReason === "aborted" ? "(aborted)" : errorMessage || "(no content)");
				displayText = `assistant: ${preview}`;
				break;
			}

			if (messageRole === "toolresult") {
				role = "system";
				entryLabel = "tool";
				const toolName = pickString(messageRecord ?? {}, ["toolName", "tool_name"]) ?? "tool";
				const toolOutputRaw = extractToolOutput(messageRecord?.content ?? messageRecord?.result ?? messageRecord ?? {});
				preview = toolOutputRaw.replace(/\s+/g, " ").trim() || "(no output)";
				displayText = `[${toolName}: ${truncateText(preview, 120)}]`;
				break;
			}

			if (messageRole === "bashexecution") {
				role = "system";
				entryLabel = "bash";
				const command = pickString(messageRecord ?? {}, ["command"]) ?? "bash";
				preview = command;
				displayText = `[bash: ${truncateText(command.replace(/\s+/g, " ").trim(), 120)}]`;
				break;
			}

			role = roleFromSessionEntry(messageRoleRaw);
			entryLabel = messageRoleRaw || "message";
			preview = extractText(messageRecord?.content).replace(/\s+/g, " ").trim() || `(${entryLabel})`;
			displayText = `[${entryLabel}]: ${preview}`;
			break;
		}
		case "custom_message": {
			role = "custom";
			const customType = pickString(record, ["customType", "custom_type"]) ?? "custom";
			entryLabel = customType;
			preview = extractText(record.content).replace(/\s+/g, " ").trim() || "(empty)";
			displayText = `[${customType}]: ${preview}`;
			break;
		}
		case "branch_summary": {
			role = "system";
			entryLabel = "branch summary";
			preview = (pickString(record, ["summary"]) ?? extractText(record.content)).replace(/\s+/g, " ").trim() || "(empty)";
			displayText = `[branch summary]: ${truncateText(preview, 180)}`;
			break;
		}
		case "compaction": {
			role = "system";
			entryLabel = "compaction";
			const tokensBefore = pickNumber(record, ["tokensBefore", "tokens_before"]);
			preview = (pickString(record, ["summary"]) ?? "compaction entry").replace(/\s+/g, " ").trim();
			const tokensBadge = typeof tokensBefore === "number" && Number.isFinite(tokensBefore)
				? `${Math.max(1, Math.round(tokensBefore / 1000))}k tokens`
				: "summary";
			displayText = `[compaction: ${tokensBadge}] ${truncateText(preview, 160)}`;
			break;
		}
		case "thinking_level_change": {
			role = "system";
			entryLabel = "thinking";
			const level = pickString(record, ["thinkingLevel", "thinking_level"]) ?? "updated";
			preview = level;
			displayText = `[thinking: ${level}]`;
			break;
		}
		case "model_change": {
			role = "system";
			entryLabel = "model";
			const provider = pickString(record, ["provider"]) ?? "provider";
			const modelId = pickString(record, ["modelId", "model_id"]) ?? "model";
			preview = `${provider}/${modelId}`;
			displayText = `[model: ${preview}]`;
			break;
		}
		case "session_info": {
			role = "system";
			entryLabel = "title";
			preview = pickString(record, ["name"]) ?? "(untitled)";
			displayText = `[title: ${preview}]`;
			break;
		}
		case "custom": {
			role = "custom";
			const customType = pickString(record, ["customType", "custom_type"]) ?? "custom";
			entryLabel = customType;
			preview = extractText(record.data).replace(/\s+/g, " ").trim() || "custom entry";
			displayText = `[custom: ${customType}] ${truncateText(preview, 140)}`;
			break;
		}
		default: {
			role = "system";
			preview = extractText(record.content).replace(/\s+/g, " ").trim() || entryLabel;
			displayText = `[${entryLabel}]: ${truncateText(preview, 160)}`;
			break;
		}
	}

	const resolvedLabel = labelsByTargetId.get(id);
	if (resolvedLabel) {
		entryLabel = `${entryLabel} · ${resolvedLabel}`;
		displayText = `[${resolvedLabel}] ${displayText}`;
	}
	const normalizedPreview = preview.replace(/\s+/g, " ").trim();
	const normalizedDisplayText = displayText.replace(/\s+/g, " ").trim();

	return {
		id,
		parentId,
		type,
		index,
		role,
		entryLabel,
		preview: normalizedPreview || `(${entryLabel})`,
		displayText: normalizedDisplayText || `${entryLabel}: ${normalizedPreview || "(empty)"}`,
		canFork,
	};
}

function resolveCurrentTreeLeafId(
	entriesById: Map<string, SessionTreeEntryRecord>,
	entries: SessionTreeEntryRecord[],
	currentSessionEntryIds: string[],
): string | null {
	for (let i = currentSessionEntryIds.length - 1; i >= 0; i--) {
		const entryId = currentSessionEntryIds[i];
		if (entryId && entriesById.has(entryId)) return entryId;
	}
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!entry) continue;
		if (entriesById.has(entry.id)) return entry.id;
	}
	return null;
}

export function compactTreeLinePrefix(prefix: string, depth: number): string {
	const normalized = prefix ?? "";
	if (!normalized) return "";
	const maxVisibleDepth = 14;
	if (depth <= maxVisibleDepth) return normalized;
	const charsPerLevel = 3;
	const tail = normalized.slice(Math.max(0, normalized.length - maxVisibleDepth * charsPerLevel));
	return `… ${tail}`;
}

export function parseSessionTreeRows({
	sessionContent,
	currentSessionEntryIds,
	extractText,
	extractToolOutput,
	truncateText,
	pickString,
	pickNumber,
}: ParseSessionTreeRowsParams): HistoryTreeRowRecord[] {
	const rawRecords: Array<{ record: Record<string, unknown>; index: number }> = [];
	const lines = sessionContent.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (!parsed || typeof parsed !== "object") continue;
		rawRecords.push({
			record: parsed as Record<string, unknown>,
			index: rawRecords.length,
		});
	}

	if (rawRecords.length === 0) return [];

	const labelsByTargetId = new Map<string, string>();
	for (const { record } of rawRecords) {
		if (record.type !== "label") continue;
		const targetId = typeof record.targetId === "string" ? record.targetId.trim() : "";
		if (!targetId) continue;
		const label = typeof record.label === "string" ? record.label.trim() : "";
		if (!label) {
			labelsByTargetId.delete(targetId);
		} else {
			labelsByTargetId.set(targetId, label);
		}
	}

	const entries: SessionTreeEntryRecord[] = rawRecords
		.map(({ record, index }) =>
			mapSessionTreeEntry(record, index, labelsByTargetId, {
				extractText,
				extractToolOutput,
				truncateText,
				pickString,
				pickNumber,
			}),
		)
		.filter((entry): entry is SessionTreeEntryRecord => Boolean(entry));

	if (entries.length === 0) return [];

	const entriesById = new Map<string, SessionTreeEntryRecord>();
	for (const entry of entries) {
		entriesById.set(entry.id, entry);
	}

	const childrenByParent = new Map<string, SessionTreeEntryRecord[]>();
	const roots: SessionTreeEntryRecord[] = [];
	for (const entry of entries) {
		const parentId = entry.parentId && entriesById.has(entry.parentId) ? entry.parentId : null;
		if (!parentId) {
			roots.push(entry);
			continue;
		}
		const bucket = childrenByParent.get(parentId) ?? [];
		bucket.push(entry);
		childrenByParent.set(parentId, bucket);
	}
	const byIndex = (a: SessionTreeEntryRecord, b: SessionTreeEntryRecord): number => a.index - b.index;
	roots.sort(byIndex);
	for (const bucket of childrenByParent.values()) {
		bucket.sort(byIndex);
	}

	const currentLeafId = resolveCurrentTreeLeafId(entriesById, entries, currentSessionEntryIds);
	const activePath = new Set<string>();
	let cursor = currentLeafId;
	while (cursor && entriesById.has(cursor)) {
		if (activePath.has(cursor)) break;
		activePath.add(cursor);
		const parentId = entriesById.get(cursor)?.parentId ?? null;
		cursor = parentId && entriesById.has(parentId) ? parentId : null;
	}

	const rows: HistoryTreeRowRecord[] = [];
	const buildPrefix = (ancestorHasNext: boolean[], isLast: boolean, depth: number): string => {
		const parts: string[] = ancestorHasNext.map((hasNext) => (hasNext ? "│  " : "   "));
		if (depth > 0) {
			parts.push(isLast ? "└─ " : "├─ ");
		}
		return parts.join("");
	};
	const visit = (entry: SessionTreeEntryRecord, depth: number, ancestorHasNext: boolean[], isLast: boolean): void => {
		rows.push({
			entryId: entry.id,
			depth,
			role: entry.role,
			entryLabel: entry.entryLabel,
			preview: entry.preview,
			displayText: entry.displayText,
			linePrefix: buildPrefix(ancestorHasNext, isLast, depth),
			onActivePath: activePath.has(entry.id),
			canFork: entry.canFork,
		});
		const children = childrenByParent.get(entry.id) ?? [];
		const nextAncestorHasNext = [...ancestorHasNext, !isLast];
		for (let i = 0; i < children.length; i += 1) {
			const child = children[i];
			if (!child) continue;
			visit(child, depth + 1, nextAncestorHasNext, i === children.length - 1);
		}
	};
	for (let i = 0; i < roots.length; i += 1) {
		const root = roots[i];
		if (!root) continue;
		visit(root, 0, [], i === roots.length - 1);
	}
	return rows;
}
