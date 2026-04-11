let activeDraggedFilePaths: string[] = [];
let activeDraggedAt = 0;

const ACTIVE_DRAG_TTL_MS = 8_000;

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").trim();
}

export function setActiveDraggedFilePaths(paths: string[]): void {
	const normalized = paths
		.map((path) => normalizePath(path))
		.filter((path) => path.length > 0);
	activeDraggedFilePaths = normalized;
	activeDraggedAt = normalized.length > 0 ? Date.now() : 0;
}

export function peekActiveDraggedFilePaths(): string[] {
	if (activeDraggedFilePaths.length === 0) return [];
	if (!activeDraggedAt || Date.now() - activeDraggedAt > ACTIVE_DRAG_TTL_MS) {
		activeDraggedFilePaths = [];
		activeDraggedAt = 0;
		return [];
	}
	return [...activeDraggedFilePaths];
}

export function clearActiveDraggedFilePaths(): void {
	activeDraggedFilePaths = [];
	activeDraggedAt = 0;
}
