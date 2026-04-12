export interface PendingImageLike {
	id: string;
	name: string;
	mimeType: string;
	data: string;
	previewUrl: string;
	size: number;
}

export function extractTextContent(content: unknown): string {
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
			const block = part as Record<string, unknown>;
			const type = block.type as string | undefined;
			if (type === "text" && typeof block.text === "string") parts.push(block.text);
		}
		return parts.join("\n\n").trim();
	}
	if (typeof content === "object") {
		const record = content as Record<string, unknown>;
		if (typeof record.text === "string") return record.text;
	}
	return "";
}

function stringifyUnknownData(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function extractToolOutputText(payload: unknown, depth = 0): string {
	if (depth > 6 || payload === null || typeof payload === "undefined") return "";
	if (typeof payload === "string") return payload;
	if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
	if (Array.isArray(payload)) {
		const parts = payload
			.map((item) => extractToolOutputText(item, depth + 1).trim())
			.filter(Boolean);
		return parts.join("\n").trim();
	}
	if (typeof payload !== "object") return "";

	const source = payload as Record<string, unknown>;
	const textFirst = extractTextContent(source.content ?? payload).trim();
	const chunks: string[] = textFirst ? [textFirst] : [];
	const append = (value: unknown): void => {
		const text = extractToolOutputText(value, depth + 1).trim();
		if (!text) return;
		if (!chunks.includes(text)) chunks.push(text);
	};

	for (const key of ["output", "stdout", "stderr", "result", "message", "error", "text", "delta", "reasoning", "thinking"]) {
		if (key in source) append(source[key]);
	}
	if ("content" in source) append(source.content);
	if ("parts" in source) append(source.parts);
	if ("messages" in source) append(source.messages);

	if (chunks.length > 0) return chunks.join("\n").trim();
	return stringifyUnknownData(source);
}

export function mergeStreamingText(current: string, partial: string | null, deltaCandidate: unknown): string {
	const delta = typeof deltaCandidate === "string" ? deltaCandidate : "";
	if (partial !== null) {
		if (!current) return partial;
		if (partial === current) return current;
		if (partial.startsWith(current)) return partial;
		if (current.startsWith(partial) && delta) return current + delta;
		if (partial.length > current.length + 24) {
			const overlap = current.slice(Math.max(0, current.length - 24));
			if (!overlap || partial.includes(overlap)) return partial;
		}
	}
	if (delta) return current + delta;
	if (partial !== null) {
		if (current.endsWith(partial)) return current;
		return current + partial;
	}
	return current;
}

export function extractImagesFromContent(content: unknown, createId: (prefix?: string) => string): PendingImageLike[] {
	if (!Array.isArray(content)) return [];
	const images: PendingImageLike[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const block = part as Record<string, unknown>;
		if (block.type !== "image" || typeof block.data !== "string" || typeof block.mimeType !== "string") continue;
		images.push({
			id: createId("img"),
			name: "image",
			mimeType: block.mimeType,
			data: block.data,
			previewUrl: `data:${block.mimeType};base64,${block.data}`,
			size: Math.floor((block.data.length * 3) / 4),
		});
	}
	return images;
}

export function extractAssistantPartialContent(
	assistantEvent: Record<string, unknown>,
	mode: "text" | "thinking",
): string | null {
	const partial = assistantEvent.partial;
	if (!partial || typeof partial !== "object") return null;
	const content = (partial as Record<string, unknown>).content;
	if (!Array.isArray(content)) return null;

	const fromPart = (part: unknown): string | null => {
		if (!part || typeof part !== "object") return null;
		const block = part as Record<string, unknown>;
		const type = typeof block.type === "string" ? block.type : "";
		const typeLower = type.toLowerCase();
		if (mode === "text" && typeLower === "text" && typeof block.text === "string") return block.text;
		if (mode === "thinking" && (typeLower.includes("thinking") || typeLower.includes("reason"))) {
			if (typeof block.thinking === "string") return block.thinking;
			if (typeof block.reasoning === "string") return block.reasoning;
			if (typeof block.text === "string") return block.text;
		}
		return null;
	};

	const contentIndex = assistantEvent.contentIndex;
	if (typeof contentIndex === "number" && Number.isInteger(contentIndex) && contentIndex >= 0 && contentIndex < content.length) {
		const indexed = fromPart(content[contentIndex]);
		if (indexed !== null) return indexed;
	}

	for (let i = content.length - 1; i >= 0; i -= 1) {
		const fallback = fromPart(content[i]);
		if (fallback !== null) return fallback;
	}

	return null;
}
