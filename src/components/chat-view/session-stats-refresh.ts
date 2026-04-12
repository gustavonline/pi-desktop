export interface SessionStatsSnapshot {
	tokens: number | null;
	lifetimeTokens: number | null;
	costUsd: number | null;
	messageCount: number;
	pendingCount: number;
	contextWindow: number | null;
	usageRatio: number | null;
	updatedAt: number;
}

interface ComputeSessionStatsFromRawParams {
	raw: Record<string, unknown>;
	stateMessageCount: number;
	statePendingCount: number;
	lastAssistantContextTokens: number | null;
	resolveContextWindow: (raw?: Record<string, unknown>) => number | null;
	normalizeUsageRatio: (rawRatio: number | null) => number | null;
	now?: number;
}

interface ComputeSessionStatsFallbackParams {
	stateMessageCount: number;
	statePendingCount: number;
	previous: SessionStatsSnapshot;
	resolveContextWindow: (raw?: Record<string, unknown>) => number | null;
	now?: number;
}

function readPath(source: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = source;
	for (const part of parts) {
		if (!current || typeof current !== "object") return null;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
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

export function computeSessionStatsFromRaw({
	raw,
	stateMessageCount,
	statePendingCount,
	lastAssistantContextTokens,
	resolveContextWindow,
	normalizeUsageRatio,
	now = Date.now(),
}: ComputeSessionStatsFromRawParams): SessionStatsSnapshot {
	const lifetimeTokens = pickNumber(raw, [
		"totalTokens",
		"tokens.total",
		"tokens",
		"total_tokens",
		"usage.totalTokens",
		"usage.tokens",
		"usage.tokens.total",
		"session.totalTokens",
	]);
	const contextUsageRecord = raw.contextUsage && typeof raw.contextUsage === "object" ? (raw.contextUsage as Record<string, unknown>) : null;
	const contextUsageHasTokensKey = Boolean(contextUsageRecord && Object.prototype.hasOwnProperty.call(contextUsageRecord, "tokens"));
	const contextUsageHasPercentKey = Boolean(contextUsageRecord && Object.prototype.hasOwnProperty.call(contextUsageRecord, "percent"));
	const contextUsageTokensExplicitNull = contextUsageHasTokensKey && contextUsageRecord?.tokens === null;
	const contextUsagePercentExplicitNull = contextUsageHasPercentKey && contextUsageRecord?.percent === null;
	const contextTokensFromStats = pickNumber(raw, [
		"contextTokens",
		"context_tokens",
		"context.tokens",
		"contextUsage.tokens",
		"usage.contextTokens",
		"usage.context_tokens",
		"usage.tokens.context",
		"session.contextTokens",
	]);
	const costUsd = pickNumber(raw, ["costUsd", "estimatedCostUsd", "cost.total", "usage.cost.total", "cost"]);
	const messageCount =
		stateMessageCount || Math.round(pickNumber(raw, ["messageCount", "messages", "totalMessages", "usage.messageCount", "session.messageCount"]) ?? 0);
	const pendingCount =
		statePendingCount || Math.round(pickNumber(raw, ["pendingCount", "pendingMessages", "usage.pendingCount"]) ?? 0);
	const contextWindow = resolveContextWindow(raw);
	const rawUsageRatio = normalizeUsageRatio(
		pickNumber(raw, [
			"usageRatio",
			"usage.ratio",
			"tokenUsageRatio",
			"usagePercent",
			"usage.percent",
			"contextUsage.percent",
			"context.percent",
			"contextUsagePercent",
			"context_usage.percent",
			"context_usage_percent",
		]),
	);
	const contextUsageExplicitlyUnknown =
		(contextUsageTokensExplicitNull || contextUsagePercentExplicitNull) && contextTokensFromStats === null && rawUsageRatio === null;
	const contextTokens = contextTokensFromStats ?? (contextUsageExplicitlyUnknown ? null : lastAssistantContextTokens);
	const usageRatio =
		rawUsageRatio ??
		(contextTokens !== null && contextWindow && contextWindow > 0 ? Math.min(1, Math.max(0, contextTokens / contextWindow)) : null);
	const normalizedContextTokens =
		contextTokens ?? (usageRatio !== null && contextWindow && contextWindow > 0 ? usageRatio * contextWindow : null);

	return {
		tokens: normalizedContextTokens,
		lifetimeTokens,
		costUsd,
		messageCount,
		pendingCount,
		contextWindow,
		usageRatio,
		updatedAt: now,
	};
}

export function computeSessionStatsFallback({
	stateMessageCount,
	statePendingCount,
	previous,
	resolveContextWindow,
	now = Date.now(),
}: ComputeSessionStatsFallbackParams): SessionStatsSnapshot {
	const contextWindow = resolveContextWindow() ?? previous.contextWindow;
	const usageRatio =
		previous.tokens !== null && contextWindow && contextWindow > 0
			? Math.min(1, Math.max(0, previous.tokens / contextWindow))
			: previous.usageRatio;
	return {
		...previous,
		messageCount: stateMessageCount ?? previous.messageCount,
		pendingCount: statePendingCount ?? previous.pendingCount,
		contextWindow,
		usageRatio,
		updatedAt: now,
	};
}
