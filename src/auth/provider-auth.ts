import type { RuntimeSlashCommand } from "../commands/slash-command-runtime.js";
import type { PiAuthProviderStatus } from "../rpc/bridge.js";
import { formatProviderDisplayName } from "../models/model-options.js";

export interface OAuthProviderCatalogEntry {
	name: string;
	source: "built_in" | "package";
}

export const DEFAULT_OAUTH_PROVIDER_IDS = [
	"anthropic",
	"github-copilot",
	"google-gemini-cli",
	"google-antigravity",
	"openai-codex",
] as const;

const DEFAULT_OAUTH_PROVIDER_SET = new Set<string>(DEFAULT_OAUTH_PROVIDER_IDS);
const DEFAULT_OAUTH_PROVIDER_NAME_BY_ID = new Map<string, string>([
	["anthropic", "Anthropic"],
	["github-copilot", "GitHub Copilot"],
	["google-gemini-cli", "Google Gemini CLI"],
	["google-antigravity", "Google Antigravity"],
	["openai-codex", "OpenAI Codex"],
]);

function normalizeText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

export function normalizeProviderKey(provider: unknown): string {
	return normalizeText(provider).toLowerCase();
}

export function unwrapQuotedValue(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

export function normalizeAuthProviderArg(rawArgs: string): string {
	const provider = normalizeProviderKey(unwrapQuotedValue(rawArgs));
	if (!provider) return "";
	if (!/^[a-z0-9._-]+$/.test(provider)) return "";
	return provider;
}

function defaultProviderLabel(provider: string): string {
	const key = normalizeProviderKey(provider);
	if (!key) return "Provider";
	const fromDefaults = DEFAULT_OAUTH_PROVIDER_NAME_BY_ID.get(key);
	if (fromDefaults) return fromDefaults;
	return formatProviderDisplayName(key);
}

export function isOAuthProviderId(provider: string, catalog: Map<string, OAuthProviderCatalogEntry>): boolean {
	const key = normalizeProviderKey(provider);
	return DEFAULT_OAUTH_PROVIDER_SET.has(key) || catalog.has(key);
}

export function displayProviderLabel(provider: string, catalog: Map<string, OAuthProviderCatalogEntry>): string {
	const key = normalizeProviderKey(provider);
	const fromCatalog = catalog.get(key)?.name?.trim();
	if (fromCatalog) return fromCatalog;
	return defaultProviderLabel(key);
}

export function createDefaultOAuthProviderCatalog(): Map<string, OAuthProviderCatalogEntry> {
	const defaults = new Map<string, OAuthProviderCatalogEntry>();
	for (const providerId of DEFAULT_OAUTH_PROVIDER_IDS) {
		defaults.set(providerId, {
			name: defaultProviderLabel(providerId),
			source: "built_in",
		});
	}
	return defaults;
}

export function normalizeOAuthProviderCatalog(rawEntries: unknown): Map<string, OAuthProviderCatalogEntry> {
	const next = new Map<string, OAuthProviderCatalogEntry>();
	const entries = Array.isArray(rawEntries) ? rawEntries : [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		const providerId = normalizeProviderKey(record.id);
		if (!providerId) continue;
		const rawName = normalizeText(record.name);
		const sourceRaw = record.source;
		next.set(providerId, {
			name: rawName || defaultProviderLabel(providerId),
			source: sourceRaw === "package" ? "package" : "built_in",
		});
	}
	for (const providerId of DEFAULT_OAUTH_PROVIDER_IDS) {
		if (next.has(providerId)) continue;
		next.set(providerId, {
			name: defaultProviderLabel(providerId),
			source: "built_in",
		});
	}
	return next;
}

export function collectBuiltInOAuthProviderIds(rawEntries: unknown): Set<string> {
	const ids = new Set<string>(DEFAULT_OAUTH_PROVIDER_IDS);
	const entries = Array.isArray(rawEntries) ? rawEntries : [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		const providerId = normalizeProviderKey(record.id);
		if (!providerId) continue;
		if (record.source === "built_in") {
			ids.add(providerId);
		}
	}
	return ids;
}

export function normalizeConfiguredProviderAuth(
	rawProviders: unknown,
): Map<string, Pick<PiAuthProviderStatus, "source" | "kind">> {
	const next = new Map<string, Pick<PiAuthProviderStatus, "source" | "kind">>();
	const providers = Array.isArray(rawProviders) ? rawProviders : [];
	for (const entry of providers) {
		if (!entry || typeof entry !== "object") continue;
		const record = entry as Record<string, unknown>;
		const provider = normalizeProviderKey(record.provider);
		if (!provider) continue;
		const sourceRaw = record.source;
		const kindRaw = record.kind;
		next.set(provider, {
			source:
				sourceRaw === "environment" || sourceRaw === "auth_file_api_key" || sourceRaw === "auth_file_oauth"
					? sourceRaw
					: "auth_file_api_key",
			kind: kindRaw === "api_key" || kindRaw === "oauth" || kindRaw === "unknown" ? kindRaw : "unknown",
		});
	}
	return next;
}

export function resolveProviderSetupCommand(provider: string, runtimeCommands: RuntimeSlashCommand[]): string | null {
	const providerKey = normalizeProviderKey(provider);
	if (!providerKey) return null;
	const providerTokens = providerKey.split(/[-_.]+/).filter((token) => token.length > 2);
	let best: { name: string; score: number } | null = null;

	for (const command of runtimeCommands) {
		if (command.source !== "extension") continue;
		const name = normalizeText(command.name).toLowerCase().replace(/^\/+/, "");
		if (!name) continue;
		const description = normalizeText(command.description).toLowerCase();
		const haystack = `${name} ${description}`;
		const tokenHits = providerTokens.filter((token) => haystack.includes(token)).length;
		const hasProviderMatch = haystack.includes(providerKey) || tokenHits > 0;
		if (!hasProviderMatch) continue;

		let score = 0;
		if (haystack.includes(providerKey)) score += 8;
		score += tokenHits * 3;
		if (/\b(config|setup|settings|auth|login)\b/.test(haystack)) score += 2;
		if (/config/.test(name)) score += 1;
		if (!best || score > best.score) {
			best = { name, score };
		}
	}

	return best?.name ?? null;
}
