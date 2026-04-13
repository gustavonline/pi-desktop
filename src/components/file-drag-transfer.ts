let activeDraggedFilePaths: string[] = [];
let activeDraggedAt = 0;

const ACTIVE_DRAG_TTL_MS = 8_000;
const ACTIVE_DRAG_STORAGE_KEY = "pi-desktop.active-dragged-file-paths.v1";

interface StoredDragPayload {
	paths: string[];
	at: number;
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").trim();
}

function readStoredDragPayload(): StoredDragPayload | null {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(ACTIVE_DRAG_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		const paths = Array.isArray((parsed as { paths?: unknown }).paths)
			? ((parsed as { paths: unknown[] }).paths.filter((value): value is string => typeof value === "string"))
			: [];
		const at = typeof (parsed as { at?: unknown }).at === "number" ? (parsed as { at: number }).at : 0;
		if (paths.length === 0 || !at) return null;
		return { paths, at };
	} catch {
		return null;
	}
}

function writeStoredDragPayload(paths: string[], at: number): void {
	if (typeof localStorage === "undefined") return;
	try {
		if (paths.length === 0 || !at) {
			localStorage.removeItem(ACTIVE_DRAG_STORAGE_KEY);
			return;
		}
		localStorage.setItem(ACTIVE_DRAG_STORAGE_KEY, JSON.stringify({ paths, at }));
	} catch {
		// ignore storage failures
	}
}

function isExpired(at: number): boolean {
	return !at || Date.now() - at > ACTIVE_DRAG_TTL_MS;
}

export function setActiveDraggedFilePaths(paths: string[]): void {
	const normalized = paths
		.map((path) => normalizePath(path))
		.filter((path) => path.length > 0);
	activeDraggedFilePaths = normalized;
	activeDraggedAt = normalized.length > 0 ? Date.now() : 0;
	writeStoredDragPayload(activeDraggedFilePaths, activeDraggedAt);
}

export function peekActiveDraggedFilePaths(): string[] {
	if (activeDraggedFilePaths.length === 0) {
		const stored = readStoredDragPayload();
		if (stored) {
			activeDraggedFilePaths = stored.paths.map((path) => normalizePath(path)).filter(Boolean);
			activeDraggedAt = stored.at;
		}
	}
	if (activeDraggedFilePaths.length === 0) return [];
	if (isExpired(activeDraggedAt)) {
		clearActiveDraggedFilePaths();
		return [];
	}
	return [...activeDraggedFilePaths];
}

export function clearActiveDraggedFilePaths(): void {
	activeDraggedFilePaths = [];
	activeDraggedAt = 0;
	writeStoredDragPayload([], 0);
}
