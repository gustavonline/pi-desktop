import type { ForkOption, HistoryViewerMessage } from "./history-viewer-types.js";

function normalizeForkText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function deriveForkSessionName(sourceName: string): string {
	const base = sourceName.trim() || "session";
	return `fork-${base}`;
}

export function buildForkEntryIdByMessageId(
	messages: HistoryViewerMessage[],
	options: ForkOption[],
): Map<string, string> {
	const userMessages = messages.filter((message) => message.role === "user");
	const byText = new Map<string, string[]>();
	for (const option of options) {
		const key = normalizeForkText(option.text);
		if (!key) continue;
		const queue = byText.get(key) ?? [];
		queue.push(option.entryId);
		byText.set(key, queue);
	}

	const map = new Map<string, string>();
	for (const message of userMessages) {
		const key = normalizeForkText(message.text);
		const queue = byText.get(key);
		if (queue && queue.length > 0) {
			const entryId = queue.shift();
			if (entryId) map.set(message.id, entryId);
			continue;
		}
		if (message.sessionEntryId) {
			map.set(message.id, message.sessionEntryId);
		}
	}

	return map;
}

export function resolveForkEntryId(
	messages: HistoryViewerMessage[],
	index: number,
	forkEntryIdByMessageId: Map<string, string>,
): string | null {
	const current = messages[index];
	if (!current) return null;
	if (current.role === "user") {
		return forkEntryIdByMessageId.get(current.id) ?? current.sessionEntryId ?? null;
	}
	for (let i = index; i >= 0; i -= 1) {
		const candidate = messages[i];
		if (!candidate || candidate.role !== "user") continue;
		const entryId = forkEntryIdByMessageId.get(candidate.id) ?? candidate.sessionEntryId;
		if (entryId) return entryId;
	}
	return null;
}
