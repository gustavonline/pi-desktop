import type { PiAuthProviderStatus } from "../rpc/bridge.js";
import {
	DEFAULT_OAUTH_PROVIDER_IDS,
	isOAuthProviderId,
	normalizeProviderKey,
	type OAuthProviderCatalogEntry,
} from "../auth/provider-auth.js";
import { formatModelDisplayName, type ModelOption } from "./model-options.js";

export type ModelPickerAuthSource = PiAuthProviderStatus["source"] | "runtime" | "missing";

export interface ModelPickerProviderGroup {
	providerKey: string;
	providerLabel: string;
	models: Array<ModelOption & { selectable: boolean }>;
	authConfigured: boolean;
	authSource: ModelPickerAuthSource;
	authKind: PiAuthProviderStatus["kind"];
	isDefaultOAuthProvider: boolean;
}

interface BuildModelPickerProviderGroupsParams {
	availableModels: ModelOption[];
	modelCatalog: ModelOption[];
	currentProvider: string;
	currentModelId: string;
	providerAuthById: Map<string, Pick<PiAuthProviderStatus, "source" | "kind">>;
	providerAuthConfigured: Set<string>;
	providerAuthForcedLoggedOut: Set<string>;
	oauthProviderCatalog: Map<string, OAuthProviderCatalogEntry>;
	getProviderLabel: (provider: string) => string;
}

function modelKey(provider: string, id: string): string {
	return `${provider}::${id}`.toLowerCase();
}

function addMissingProviderGroup(
	groupedByProvider: Map<string, { providerKey: string; providerLabel: string; models: Array<ModelOption & { selectable: boolean }> }>,
	provider: string,
	getProviderLabel: (provider: string) => string,
): void {
	if (groupedByProvider.has(provider)) return;
	groupedByProvider.set(provider, {
		providerKey: provider,
		providerLabel: getProviderLabel(provider),
		models: [],
	});
}

export function buildModelPickerProviderGroups({
	availableModels,
	modelCatalog,
	currentProvider,
	currentModelId,
	providerAuthById,
	providerAuthConfigured,
	providerAuthForcedLoggedOut,
	oauthProviderCatalog,
	getProviderLabel,
}: BuildModelPickerProviderGroupsParams): ModelPickerProviderGroup[] {
	const availableByKey = new Set<string>();
	for (const model of availableModels) {
		availableByKey.add(modelKey(model.provider, model.id));
	}

	const catalogSeed = modelCatalog.length > 0 ? modelCatalog : availableModels;
	const combinedByKey = new Map<string, ModelOption>();
	for (const model of catalogSeed) {
		const key = modelKey(model.provider, model.id);
		if (!combinedByKey.has(key)) combinedByKey.set(key, model);
	}
	for (const model of availableModels) {
		const key = modelKey(model.provider, model.id);
		if (!combinedByKey.has(key)) combinedByKey.set(key, model);
	}

	if (currentProvider && currentModelId) {
		const currentKey = modelKey(currentProvider, currentModelId);
		if (!combinedByKey.has(currentKey)) {
			combinedByKey.set(currentKey, {
				provider: currentProvider,
				id: currentModelId,
				label: `${currentProvider}/${currentModelId}`,
				reasoning: false,
			});
		}
	}

	const groupedByProvider = new Map<
		string,
		{ providerKey: string; providerLabel: string; models: Array<ModelOption & { selectable: boolean }> }
	>();
	for (const model of combinedByKey.values()) {
		const providerKey = model.provider;
		const selectable = availableByKey.has(modelKey(model.provider, model.id)) ||
			(model.provider === currentProvider && model.id === currentModelId);
		const existing = groupedByProvider.get(providerKey);
		if (existing) {
			existing.models.push({ ...model, selectable });
		} else {
			groupedByProvider.set(providerKey, {
				providerKey,
				providerLabel: getProviderLabel(providerKey),
				models: [{ ...model, selectable }],
			});
		}
	}

	for (const provider of providerAuthById.keys()) {
		addMissingProviderGroup(groupedByProvider, provider, getProviderLabel);
	}
	for (const provider of oauthProviderCatalog.keys()) {
		addMissingProviderGroup(groupedByProvider, provider, getProviderLabel);
	}
	for (const provider of DEFAULT_OAUTH_PROVIDER_IDS) {
		addMissingProviderGroup(groupedByProvider, provider, getProviderLabel);
	}
	for (const provider of providerAuthForcedLoggedOut) {
		addMissingProviderGroup(groupedByProvider, provider, getProviderLabel);
	}

	return Array.from(groupedByProvider.values())
		.map((group) => {
			const authKey = normalizeProviderKey(group.providerKey);
			const hasSelectableModel = group.models.some((model) => model.selectable);
			const authInfo = providerAuthById.get(authKey);
			const forcedLoggedOut = providerAuthForcedLoggedOut.has(authKey);
			const isDefaultOAuthProvider = isOAuthProviderId(authKey, oauthProviderCatalog);
			const authConfigured =
				!forcedLoggedOut && (providerAuthConfigured.has(authKey) || (!isDefaultOAuthProvider && hasSelectableModel));
			const authSource: ModelPickerAuthSource = forcedLoggedOut
				? "missing"
				: (authInfo?.source ?? (!isDefaultOAuthProvider && hasSelectableModel ? "runtime" : "missing"));

			return {
				...group,
				authConfigured,
				authSource,
				authKind: authInfo?.kind ?? "unknown",
				isDefaultOAuthProvider,
				models: [...group.models].sort((a, b) =>
					formatModelDisplayName(a.id).localeCompare(formatModelDisplayName(b.id), undefined, { sensitivity: "base" }),
				),
			};
		})
		.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel, undefined, { sensitivity: "base" }));
}

export function resolveActiveModelPickerProvider(
	providerGroups: ModelPickerProviderGroup[],
	modelPickerActiveProvider: string,
	currentProvider: string,
): string {
	if (providerGroups.some((group) => group.providerKey === modelPickerActiveProvider)) {
		return modelPickerActiveProvider;
	}
	if (providerGroups.some((group) => group.providerKey === currentProvider)) {
		return currentProvider;
	}
	return providerGroups[0]?.providerKey ?? "";
}
