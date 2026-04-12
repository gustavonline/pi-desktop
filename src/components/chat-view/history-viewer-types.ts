export type HistoryViewerRole = "user" | "assistant" | "system" | "custom";

export interface ForkOption {
	entryId: string;
	text: string;
}

export interface HistoryTreeRow {
	entryId: string;
	depth: number;
	role: HistoryViewerRole;
	entryLabel: string;
	preview: string;
	displayText: string;
	linePrefix: string;
	onActivePath: boolean;
	canFork: boolean;
}

export interface HistoryViewerMessage {
	id: string;
	role: HistoryViewerRole;
	text: string;
	label?: string;
	sessionEntryId?: string;
}
