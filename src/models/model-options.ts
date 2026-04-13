export interface ModelOption {
	provider: string;
	id: string;
	label: string;
	reasoning: boolean;
	contextWindow?: number;
}

function normalizeText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value && typeof value === "object") {
		const nested = value as Record<string, unknown>;
		for (const key of ["name", "label", "id", "model", "provider"]) {
			const candidate = nested[key];
			if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
		}
	}
	return "";
}

export function formatProviderDisplayName(provider: string): string {
	const normalized = normalizeText(provider).toLowerCase();
	switch (normalized) {
		case "openai":
			return "OpenAI";
		case "openai-codex":
			return "OpenAI Codex";
		case "anthropic":
			return "Anthropic";
		case "google":
		case "googleai":
		case "gemini":
			return "Google";
		case "google-gemini-cli":
			return "Google Gemini CLI";
		case "google-antigravity":
			return "Google Antigravity";
		case "github-copilot":
			return "GitHub Copilot";
		case "xai":
			return "xAI";
		case "openrouter":
			return "OpenRouter";
		case "ollama":
			return "Ollama";
		case "lmstudio":
			return "LM Studio";
		case "cursor-agent":
		case "cursor":
			return "Cursor";
		case "kilo":
		case "kilocode":
			return "Kilo Code";
		default:
			return normalized
				.split(/[-_\s]+/)
				.filter(Boolean)
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(" ");
	}
}

export function formatModelDisplayName(modelId: string): string {
	const raw = normalizeText(modelId);
	if (!raw) return "Model";
	let value = raw.replace(/^models\//i, "").trim();
	value = value.replace(/^(openai|anthropic|google|xai|openrouter|ollama|lmstudio)[:/]/i, "");
	if (!value) return "Model";
	if (/^gpt/i.test(value)) return value.replace(/^gpt/i, "GPT");
	if (/^claude/i.test(value)) {
		const tail = value.slice("claude".length).replace(/^[-_\s]+/, "");
		if (!tail) return "Claude";
		const humanTail = tail
			.replace(/[-_]+/g, " ")
			.split(/\s+/)
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
		return `Claude ${humanTail}`;
	}
	if (/^gemini/i.test(value)) return value.replace(/^gemini/i, "Gemini");
	return value
		.replace(/[-_]+/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function parseListModelsContextWindow(raw: string): number | undefined {
	const token = normalizeText(raw).toLowerCase();
	if (!token) return undefined;
	const match = token.match(/^(\d+(?:\.\d+)?)([km])?$/i);
	if (!match) return undefined;
	const base = Number(match[1]);
	if (!Number.isFinite(base) || base <= 0) return undefined;
	const unit = match[2]?.toLowerCase();
	if (unit === "k") return Math.round(base * 1_000);
	if (unit === "m") return Math.round(base * 1_000_000);
	return Math.round(base);
}

export function parseListModelsCatalog(output: string): ModelOption[] {
	const mapped: ModelOption[] = [];
	const seen = new Set<string>();
	for (const rawLine of output.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;
		if (/^provider\s+/i.test(trimmed)) continue;
		if (/^[\-=]{3,}/.test(trimmed)) continue;
		const cols = trimmed.split(/\s+/);
		if (cols.length < 2) continue;
		const provider = cols[0]?.trim();
		const id = cols[1]?.trim();
		if (!provider || !id) continue;
		const key = `${provider.toLowerCase()}::${id.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		mapped.push({
			provider,
			id,
			label: `${provider}/${id}`,
			reasoning: (cols[4] || "").toLowerCase() === "yes",
			contextWindow: parseListModelsContextWindow(cols[2] || ""),
		});
	}
	mapped.sort((a, b) => {
		const providerCompare = formatProviderDisplayName(a.provider).localeCompare(formatProviderDisplayName(b.provider), undefined, {
			sensitivity: "base",
		});
		if (providerCompare !== 0) return providerCompare;
		return formatModelDisplayName(a.id).localeCompare(formatModelDisplayName(b.id), undefined, { sensitivity: "base" });
	});
	return mapped;
}
