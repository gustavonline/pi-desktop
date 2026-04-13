export const PI_THEME_SCHEMA_URL =
	"https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json";

export const PI_THEME_REQUIRED_COLOR_TOKENS = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"selectedBg",
	"userMessageBg",
	"userMessageText",
	"customMessageBg",
	"customMessageText",
	"customMessageLabel",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"bashMode",
] as const;

type PiThemeVariant = "dark" | "light";

interface BuildPiThemeDocumentOptions {
	name: string;
	variant: PiThemeVariant;
	accent: string;
	surface: string;
	ink: string;
	skill?: string;
	diffAdded?: string;
	diffRemoved?: string;
	success?: string;
	error?: string;
	warning?: string;
	contrast?: number;
	codeThemeId?: string;
	fonts?: {
		ui: string | null;
		code: string | null;
	};
	opaqueWindows?: boolean;
	source?: string;
}

interface PiThemeDocument {
	$schema: string;
	name: string;
	vars: Record<string, string | number>;
	colors: Record<(typeof PI_THEME_REQUIRED_COLOR_TOKENS)[number], string | number>;
	piDesktop: Record<string, unknown>;
}

function variantDefaults(variant: PiThemeVariant): {
	muted: string;
	dim: string;
	borderMuted: string;
	success: string;
	error: string;
	warning: string;
	syntaxComment: string;
	syntaxKeyword: string;
	syntaxFunction: string;
	syntaxVariable: string;
	syntaxString: string;
	syntaxNumber: string;
	syntaxType: string;
	syntaxOperator: string;
	syntaxPunctuation: string;
	thinkingOff: string;
	thinkingMinimal: string;
	thinkingLow: string;
	thinkingMedium: string;
	thinkingHigh: string;
	thinkingXhigh: string;
} {
	if (variant === "light") {
		return {
			muted: "#6c6c6c",
			dim: "#767676",
			borderMuted: "#b0b0b0",
			success: "#008000",
			error: "#a31515",
			warning: "#9a7326",
			syntaxComment: "#008000",
			syntaxKeyword: "#0000FF",
			syntaxFunction: "#795E26",
			syntaxVariable: "#001080",
			syntaxString: "#A31515",
			syntaxNumber: "#098658",
			syntaxType: "#267F99",
			syntaxOperator: "#000000",
			syntaxPunctuation: "#000000",
			thinkingOff: "#b0b0b0",
			thinkingMinimal: "#767676",
			thinkingLow: "#547da7",
			thinkingMedium: "#5a8080",
			thinkingHigh: "#875f87",
			thinkingXhigh: "#8b008b",
		};
	}

	return {
		muted: "#808080",
		dim: "#666666",
		borderMuted: "#505050",
		success: "#4ec9b0",
		error: "#fa423e",
		warning: "#f0c674",
		syntaxComment: "#6A9955",
		syntaxKeyword: "#569CD6",
		syntaxFunction: "#DCDCAA",
		syntaxVariable: "#9CDCFE",
		syntaxString: "#CE9178",
		syntaxNumber: "#B5CEA8",
		syntaxType: "#4EC9B0",
		syntaxOperator: "#D4D4D4",
		syntaxPunctuation: "#D4D4D4",
		thinkingOff: "#505050",
		thinkingMinimal: "#6e6e6e",
		thinkingLow: "#5f87af",
		thinkingMedium: "#81a2be",
		thinkingHigh: "#b294bb",
		thinkingXhigh: "#d183e8",
	};
}

export function buildPiThemeDocument(options: BuildPiThemeDocumentOptions): PiThemeDocument {
	const defaults = variantDefaults(options.variant);
	const skill = options.skill ?? options.accent;
	const success = options.success ?? options.diffAdded ?? defaults.success;
	const error = options.error ?? options.diffRemoved ?? defaults.error;
	const warning = options.warning ?? defaults.warning;
	const diffAdded = options.diffAdded ?? success;
	const diffRemoved = options.diffRemoved ?? error;
	const muted = defaults.muted;
	const dim = defaults.dim;
	const borderMuted = defaults.borderMuted;

	const vars: Record<string, string | number> = {
		accent: options.accent,
		surface: options.surface,
		ink: options.ink,
		skill,
		success,
		error,
		warning,
		muted,
		dim,
		border: options.accent,
		borderAccent: options.accent,
		borderMuted,
		thinkingText: muted,
		mdHeading: warning,
		mdLink: options.accent,
		mdLinkUrl: muted,
		mdCode: options.accent,
		mdCodeBlock: success,
		mdCodeBlockBorder: muted,
		mdQuote: muted,
		mdQuoteBorder: muted,
		mdHr: muted,
		mdListBullet: options.accent,
		toolDiffAdded: diffAdded,
		toolDiffRemoved: diffRemoved,
		toolDiffContext: muted,
		syntaxComment: defaults.syntaxComment,
		syntaxKeyword: defaults.syntaxKeyword,
		syntaxFunction: defaults.syntaxFunction,
		syntaxVariable: defaults.syntaxVariable,
		syntaxString: defaults.syntaxString,
		syntaxNumber: defaults.syntaxNumber,
		syntaxType: defaults.syntaxType,
		syntaxOperator: defaults.syntaxOperator,
		syntaxPunctuation: defaults.syntaxPunctuation,
		thinkingOff: defaults.thinkingOff,
		thinkingMinimal: defaults.thinkingMinimal,
		thinkingLow: defaults.thinkingLow,
		thinkingMedium: defaults.thinkingMedium,
		thinkingHigh: defaults.thinkingHigh,
		thinkingXhigh: defaults.thinkingXhigh,
		bashMode: success,
	};

	return {
		$schema: PI_THEME_SCHEMA_URL,
		name: options.name,
		vars,
		colors: {
			accent: "accent",
			border: "border",
			borderAccent: "borderAccent",
			borderMuted: "borderMuted",
			success: "success",
			error: "error",
			warning: "warning",
			muted: "muted",
			dim: "dim",
			text: "ink",
			thinkingText: "thinkingText",
			selectedBg: "surface",
			userMessageBg: "surface",
			userMessageText: "ink",
			customMessageBg: "surface",
			customMessageText: "ink",
			customMessageLabel: "skill",
			toolPendingBg: "surface",
			toolSuccessBg: "surface",
			toolErrorBg: "surface",
			toolTitle: "skill",
			toolOutput: "ink",
			mdHeading: "mdHeading",
			mdLink: "mdLink",
			mdLinkUrl: "mdLinkUrl",
			mdCode: "mdCode",
			mdCodeBlock: "mdCodeBlock",
			mdCodeBlockBorder: "mdCodeBlockBorder",
			mdQuote: "mdQuote",
			mdQuoteBorder: "mdQuoteBorder",
			mdHr: "mdHr",
			mdListBullet: "mdListBullet",
			toolDiffAdded: "toolDiffAdded",
			toolDiffRemoved: "toolDiffRemoved",
			toolDiffContext: "toolDiffContext",
			syntaxComment: "syntaxComment",
			syntaxKeyword: "syntaxKeyword",
			syntaxFunction: "syntaxFunction",
			syntaxVariable: "syntaxVariable",
			syntaxString: "syntaxString",
			syntaxNumber: "syntaxNumber",
			syntaxType: "syntaxType",
			syntaxOperator: "syntaxOperator",
			syntaxPunctuation: "syntaxPunctuation",
			thinkingOff: "thinkingOff",
			thinkingMinimal: "thinkingMinimal",
			thinkingLow: "thinkingLow",
			thinkingMedium: "thinkingMedium",
			thinkingHigh: "thinkingHigh",
			thinkingXhigh: "thinkingXhigh",
			bashMode: "bashMode",
		},
		piDesktop: {
			source: options.source ?? "pi-desktop-theme-v1",
			variant: options.variant,
			contrast: options.contrast,
			codeThemeId: options.codeThemeId,
			fonts: options.fonts,
			opaqueWindows: options.opaqueWindows,
		},
	};
}

export function isThemeDocumentSchemaCompatible(input: unknown): boolean {
	if (!input || typeof input !== "object" || Array.isArray(input)) return false;
	const doc = input as Record<string, unknown>;
	if (typeof doc.name !== "string" || doc.name.trim().length === 0) return false;
	const colors = doc.colors;
	if (!colors || typeof colors !== "object" || Array.isArray(colors)) return false;
	const colorMap = colors as Record<string, unknown>;

	for (const token of PI_THEME_REQUIRED_COLOR_TOKENS) {
		const value = colorMap[token];
		if (typeof value === "string") continue;
		if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) continue;
		return false;
	}

	return true;
}
