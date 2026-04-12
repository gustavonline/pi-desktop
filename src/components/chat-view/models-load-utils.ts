import {
	formatModelDisplayName,
	formatProviderDisplayName,
	type ModelOption,
} from "../../models/model-options.js";

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

function pickNumber(source: Record<string, unknown>, paths: string[]): number | null {
	for (const path of paths) {
		const value = readPath(source, path);
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}

export function mapAvailableModelsFromRpc(models: Array<Record<string, unknown>>): ModelOption[] {
	const mapped: ModelOption[] = [];
	const seen = new Set<string>();
	for (const model of models) {
		const provider = pickString(model, ["provider", "providerId", "provider_id", "vendor", "source.provider"]) ?? "";
		const id = pickString(model, ["id", "modelId", "model_id", "model", "target.id", "target.modelId"]) ?? "";
		if (!provider || !id) continue;
		const key = `${provider}::${id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const contextWindow = pickNumber(model, [
			"contextWindow",
			"context_window",
			"maxInputTokens",
			"max_input_tokens",
			"limits.contextWindow",
			"limits.context_window",
		]);
		mapped.push({
			provider,
			id,
			contextWindow: typeof contextWindow === "number" ? contextWindow : undefined,
			reasoning: Boolean((model as Record<string, unknown>).reasoning),
			label: `${provider}/${id}`,
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
