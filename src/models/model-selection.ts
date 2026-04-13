import type { ModelOption } from "./model-options.js";

export function resolveProviderHintFromModelArg(rawArg: string, providerPool: ModelOption[]): string | null {
	const arg = rawArg.trim().replace(/^\/+/, "");
	if (!arg) return null;

	const byDelim = arg.includes("/") ? arg.split("/")[0] : arg.includes("::") ? arg.split("::")[0] : arg;
	const token = byDelim.trim().toLowerCase();
	if (!token) return null;

	const providers = [...new Set(providerPool.map((model) => model.provider))];
	const exact = providers.find((provider) => provider.toLowerCase() === token);
	if (exact) return exact;
	const partial = providers.find((provider) => provider.toLowerCase().includes(token));
	if (partial) return partial;

	const fuzzy = providerPool.filter((model) => `${model.provider}/${model.id}`.toLowerCase().includes(token));
	if (fuzzy.length > 0) {
		const uniqueProviders = [...new Set(fuzzy.map((model) => model.provider))];
		if (uniqueProviders.length === 1) return uniqueProviders[0];
	}

	return null;
}

export function resolvePreferredModelPickerProvider(rawPreferredProvider: string, providerPool: ModelOption[]): string {
	const preferred = rawPreferredProvider.trim().toLowerCase();
	if (!preferred) return "";
	const exact = providerPool.find((model) => model.provider.toLowerCase() === preferred)?.provider;
	if (exact) return exact;
	const partial = providerPool.find((model) => model.provider.toLowerCase().includes(preferred))?.provider;
	return partial ?? "";
}

export function resolveModelCandidateFromArg(rawArg: string, availableModels: ModelOption[]): ModelOption | null {
	const arg = rawArg.trim();
	if (!arg) return null;
	const normalizedArg = arg.replace(/^\/+/, "").trim();
	const viaDoubleColon = normalizedArg.split("::");
	if (viaDoubleColon.length === 2) {
		const provider = viaDoubleColon[0]?.trim().toLowerCase();
		const id = viaDoubleColon[1]?.trim().toLowerCase();
		if (provider && id) {
			return availableModels.find((model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id) ?? null;
		}
	}

	const slashIndex = normalizedArg.indexOf("/");
	if (slashIndex > 0) {
		const provider = normalizedArg.slice(0, slashIndex).trim().toLowerCase();
		const id = normalizedArg.slice(slashIndex + 1).trim().toLowerCase();
		if (provider && id) {
			const exact = availableModels.find((model) => model.provider.toLowerCase() === provider && model.id.toLowerCase() === id);
			if (exact) return exact;
		}
	}

	const lower = normalizedArg.toLowerCase();
	const exactById = availableModels.find((model) => model.id.toLowerCase() === lower);
	if (exactById) return exactById;
	const fuzzy = availableModels.filter((model) => `${model.provider}/${model.id}`.toLowerCase().includes(lower));
	if (fuzzy.length === 1) return fuzzy[0];
	return null;
}
