function readNumberPath(source: Record<string, unknown>, path: string): number | null {
	const parts = path.split(".");
	let current: unknown = source;
	for (const part of parts) {
		if (!current || typeof current !== "object") return null;
		current = (current as Record<string, unknown>)[part];
	}
	if (typeof current === "number" && Number.isFinite(current)) return current;
	if (typeof current === "string") {
		const parsed = Number(current);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function pickNumber(source: Record<string, unknown>, paths: string[]): number | null {
	for (const path of paths) {
		const value = readNumberPath(source, path);
		if (value !== null) return value;
	}
	return null;
}

function estimateMessageTokens(message: Record<string, unknown>): number {
	const role = typeof message.role === "string" ? message.role : "";
	let chars = 0;
	const content = (message as Record<string, unknown>).content;
	if (typeof content === "string") {
		chars += content.length;
	} else if (Array.isArray(content)) {
		for (const part of content) {
			if (!part || typeof part !== "object") continue;
			const block = part as Record<string, unknown>;
			const type = typeof block.type === "string" ? block.type : "";
			if (type === "text" && typeof block.text === "string") {
				chars += block.text.length;
			} else if (type === "thinking" || type === "reasoning") {
				if (typeof block.thinking === "string") chars += block.thinking.length;
				else if (typeof block.reasoning === "string") chars += block.reasoning.length;
				else if (typeof block.text === "string") chars += block.text.length;
			} else if (type === "toolCall") {
				const name = typeof block.name === "string" ? block.name : "";
				const args = JSON.stringify(block.arguments ?? {});
				chars += name.length + args.length;
			} else if (type === "image") {
				chars += 4800;
			}
		}
	}
	if (role === "bashExecution") {
		const command = typeof message.command === "string" ? message.command : "";
		const output = typeof message.output === "string" ? message.output : "";
		chars += command.length + output.length;
	}
	return Math.ceil(chars / 4);
}

export function deriveLatestAssistantContextTokens(messages: Array<Record<string, unknown>>): number | null {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message || typeof message !== "object") continue;
		const role = typeof message.role === "string" ? message.role : "";
		if (role !== "assistant") continue;
		const stopReason = typeof message.stopReason === "string" ? message.stopReason : "";
		if (stopReason === "aborted" || stopReason === "error") continue;

		const usageTotal = pickNumber(message, [
			"usage.totalTokens",
			"usage.total_tokens",
			"usage.total",
			"usage.tokens.total",
			"usage.contextTokens",
			"usage.context_tokens",
		]);
		const usageInput = pickNumber(message, ["usage.input", "usage.inputTokens", "usage.input_tokens"]);
		const usageOutput = pickNumber(message, ["usage.output", "usage.outputTokens", "usage.output_tokens"]);
		const usageCacheRead = pickNumber(message, ["usage.cacheRead", "usage.cache_read"]);
		const usageCacheWrite = pickNumber(message, ["usage.cacheWrite", "usage.cache_write"]);
		const components = [usageInput, usageOutput, usageCacheRead, usageCacheWrite].filter(
			(value): value is number => value !== null && Number.isFinite(value) && value >= 0,
		);

		let usageTokens: number | null = null;
		if (usageTotal !== null && usageTotal > 0) {
			usageTokens = usageTotal;
		} else if (components.length > 0) {
			const sum = components.reduce((acc, value) => acc + value, 0);
			if (sum > 0) usageTokens = sum;
		}
		if (usageTokens === null) continue;

		let trailingTokens = 0;
		for (let j = i + 1; j < messages.length; j += 1) {
			const trailing = messages[j];
			if (!trailing || typeof trailing !== "object") continue;
			trailingTokens += estimateMessageTokens(trailing);
		}

		return usageTokens + trailingTokens;
	}
	return null;
}
