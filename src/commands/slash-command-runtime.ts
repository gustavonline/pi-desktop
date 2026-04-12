import {
	BUILTIN_SLASH_COMMANDS,
	normalizeRuntimeSlashCommandSource,
	normalizeSlashCommandName,
	type RuntimeSlashCommandSource,
	withRuntimeCommandUsageHint,
} from "./slash-command-catalog.js";

export type SlashPaletteSection = "CLI" | "Extensions" | "Prompts" | "Skills" | "Commands";
export type SlashCommandSource = "builtin" | RuntimeSlashCommandSource;

export interface ParsedSlashInput {
	commandText: string;
	commandName: string;
	args: string;
}

export interface RuntimeSlashCommand {
	name: string;
	description: string;
	source: RuntimeSlashCommandSource;
	rawSource: string;
}

export interface SlashPaletteItem {
	id: string;
	section: SlashPaletteSection;
	label: string;
	hint: string;
	commandName: string;
	source: SlashCommandSource;
}

function normalizeText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function getSlashQueryFromInput(inputText: string): string | null {
	const raw = inputText;
	if (!raw.startsWith("/")) return null;
	if (raw.includes("\n")) return null;
	return raw.slice(1).trimStart();
}

export function parseSlashInputText(value: string): ParsedSlashInput | null {
	const raw = value.trim();
	if (!raw.startsWith("/")) return null;
	if (raw.includes("\n")) return null;
	const body = raw.slice(1).trim();
	if (!body) return null;
	const splitIndex = body.search(/\s/);
	if (splitIndex < 0) {
		const commandToken = body.trim();
		const commandName = normalizeSlashCommandName(commandToken);
		if (!commandName) return null;
		return {
			commandName,
			args: "",
			commandText: `/${commandToken}`,
		};
	}
	const commandToken = body.slice(0, splitIndex).trim();
	const commandName = normalizeSlashCommandName(commandToken);
	if (!commandName) return null;
	const args = body.slice(splitIndex + 1).trim();
	return {
		commandName,
		args,
		commandText: `/${commandToken}${args ? ` ${args}` : ""}`,
	};
}

export function normalizeRuntimeSlashCommand(raw: Record<string, unknown>): RuntimeSlashCommand | null {
	const rawSource = normalizeText(raw.source).toLowerCase();
	const source = normalizeRuntimeSlashCommandSource(rawSource);
	const name = normalizeSlashCommandName(normalizeText(raw.name));
	if (!name) return null;
	const description = withRuntimeCommandUsageHint(name, normalizeText(raw.description) || `Run /${name}`);
	return {
		name,
		description,
		source,
		rawSource,
	};
}

export function normalizeRuntimeSlashCommands(rawCommands: Array<Record<string, unknown>>): RuntimeSlashCommand[] {
	const normalized: RuntimeSlashCommand[] = [];
	const seen = new Set<string>();
	for (const raw of rawCommands) {
		const parsed = normalizeRuntimeSlashCommand(raw);
		if (!parsed) continue;
		const sourceKey = parsed.source === "other" ? parsed.rawSource || "other" : parsed.source;
		const key = `${sourceKey}:${parsed.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		normalized.push(parsed);
	}
	const sourceOrder: Record<RuntimeSlashCommand["source"], number> = {
		extension: 0,
		prompt: 1,
		skill: 2,
		other: 3,
	};
	normalized.sort((a, b) => {
		const sourceDiff = sourceOrder[a.source] - sourceOrder[b.source];
		if (sourceDiff !== 0) return sourceDiff;
		return a.name.localeCompare(b.name);
	});
	return normalized;
}

function sectionForSource(source: SlashCommandSource): SlashPaletteSection {
	switch (source) {
		case "builtin":
			return "CLI";
		case "extension":
			return "Extensions";
		case "prompt":
			return "Prompts";
		case "skill":
			return "Skills";
		case "other":
		default:
			return "Commands";
	}
}

export function createSlashPaletteItems(runtimeCommands: RuntimeSlashCommand[]): SlashPaletteItem[] {
	const builtinItems: SlashPaletteItem[] = BUILTIN_SLASH_COMMANDS.map((command) => ({
		id: `builtin:${command.name}`,
		section: "CLI",
		label: `/${command.name}`,
		hint: command.description,
		commandName: command.name,
		source: "builtin",
	}));
	const builtinNames = new Set(builtinItems.map((item) => item.commandName));
	const runtimeItems: SlashPaletteItem[] = runtimeCommands
		.filter((command) => !builtinNames.has(command.name))
		.map((command) => ({
			id: `${command.rawSource || command.source}:${command.name}`,
			section: sectionForSource(command.source),
			label: `/${command.name}`,
			hint: command.description,
			commandName: command.name,
			source: command.source,
		}));
	return [...builtinItems, ...runtimeItems];
}

function slashQueryToken(paletteQuery: string): string {
	const raw = paletteQuery.trim();
	if (!raw) return "";
	const [token] = raw.split(/\s+/, 1);
	return (token || "").toLowerCase();
}

function matchesSlashQuery(query: string, ...values: string[]): boolean {
	if (!query) return true;
	const haystack = values.join(" ").toLowerCase();
	return haystack.includes(query);
}

export function filterSlashPaletteItemsByQuery(items: SlashPaletteItem[], paletteQuery: string): SlashPaletteItem[] {
	const query = slashQueryToken(paletteQuery);
	if (!query) return items;
	const startsWith: SlashPaletteItem[] = [];
	const contains: SlashPaletteItem[] = [];
	for (const item of items) {
		if (!matchesSlashQuery(query, item.commandName, item.label, item.hint, item.section)) continue;
		if (item.commandName.startsWith(query) || item.label.toLowerCase().startsWith(`/${query}`)) {
			startsWith.push(item);
		} else {
			contains.push(item);
		}
	}
	return [...startsWith, ...contains];
}

export function findSlashPaletteItemByName(items: SlashPaletteItem[], commandName: string): SlashPaletteItem | null {
	const normalized = normalizeSlashCommandName(commandName);
	if (!normalized) return null;
	return items.find((item) => item.commandName === normalized) ?? null;
}
