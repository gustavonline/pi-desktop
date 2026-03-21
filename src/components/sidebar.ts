/**
 * Sidebar - single left pane (projects with sessions, or files)
 */

import { html, nothing, render, type TemplateResult } from "lit";
import { EMOJI_CATALOG } from "./workspace-tabs.js";

export type SidebarMode = "projects" | "files";

export interface SidebarWorkspaceItem {
	id: string;
	title: string;
	emoji?: string | null;
	color?: string | null;
	pinned?: boolean;
	closable?: boolean;
}

interface SidebarSession {
	id: string;
	name: string;
	path: string;
	createdAt: number;
	modifiedAt: number;
	tokens: number;
	cost: number;
	optimistic?: boolean;
	transient?: boolean;
}

interface Project {
	id: string;
	path: string;
	name: string;
	color: string;
	emoji: string;
	pinned: boolean;
	expanded: boolean;
	sessions: SidebarSession[];
	loadingSessions: boolean;
	sessionsLoaded: boolean;
	lastSessionsLoadedAt: number;
	pathExists: boolean | null;
	checkingPath: boolean;
}

interface PersistedProject {
	id: string;
	path: string;
	name: string;
	color: string;
	emoji?: string;
	pinned?: boolean;
}

interface FileNode {
	id: string;
	name: string;
	path: string;
	displayPath: string;
	isDirectory: boolean;
	isSymlink: boolean;
	expanded: boolean;
	loading: boolean;
	loadError: boolean;
	depth: number;
	children?: FileNode[];
}

type SidebarContextTarget =
	| { kind: "session"; projectId: string; sessionPath: string }
	| { kind: "file"; projectId: string; filePath: string }
	| { kind: "workspace"; workspaceId: string };

const LEGACY_STORAGE_KEY = "pi-desktop.projects.v1";
const WORKSPACE_STORAGE_KEY_PREFIX = "pi-desktop.workspace-projects.v1";
const SIDEBAR_COLLAPSED_KEY = "pi-desktop.sidebar.collapsed.v1";
const WORKSPACE_DRAG_THRESHOLD_PX = 5;
const WORKSPACE_SWIPE_THRESHOLD_PX = 34;
const WORKSPACE_SWIPE_IDLE_MS = 420;
const WORKSPACE_SWIPE_COOLDOWN_MS = 180;

function uid(prefix = "id"): string {
	return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function workspaceStorageKey(workspaceId: string): string {
	return `${WORKSPACE_STORAGE_KEY_PREFIX}.${workspaceId}`;
}

const PROJECT_COLOR_PRESETS = ["#8b4a46", "#4f755f", "#846a3f", "#4d6f95", "#7a5891", "#4f8b8b", "#c06c2f", "#a8516e"] as const;

function stringToColor(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
	return PROJECT_COLOR_PRESETS[Math.abs(hash) % PROJECT_COLOR_PRESETS.length];
}

function normalizeProjectEmoji(emoji: string | null | undefined): string {
	const normalized = typeof emoji === "string" ? emoji.trim() : "";
	return normalized.length > 0 ? normalized : "📁";
}

function normalizePath(path: string | null | undefined): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function pathBaseName(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/");
	return parts[parts.length - 1] || normalized || path;
}

function joinFsPath(base: string, name: string): string {
	const sep = base.includes("\\") ? "\\" : "/";
	const normalizedBase = base.replace(/[\\/]+$/, "");
	return `${normalizedBase}${sep}${name}`;
}

function isAbsolutePath(path: string): boolean {
	if (!path) return false;
	return /^([a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(path);
}

function fileExtension(name: string): string {
	const idx = name.lastIndexOf(".");
	if (idx === -1) return "";
	return name.slice(idx + 1).toLowerCase();
}

function fileIconKind(name: string): string {
	const lower = name.toLowerCase();
	const ext = fileExtension(lower);
	if (lower === "package.json" || lower === "tsconfig.json" || lower.endsWith(".config.json") || ext === "json") return "json";
	if (lower === ".gitignore" || lower === ".gitattributes" || lower.startsWith(".git")) return "git";
	if (lower.endsWith(".lock") || lower.includes("lockfile")) return "lock";
	if (ext === "md" || ext === "markdown" || ext === "mdx") return "md";
	if (ext === "ts" || ext === "tsx") return "ts";
	if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "js";
	if (ext === "jsonc" || ext === "yaml" || ext === "yml" || ext === "toml" || ext === "ini" || ext === "conf") return "config";
	if (ext === "html" || ext === "xml" || ext === "svg") return "markup";
	if (ext === "css" || ext === "scss" || ext === "sass" || ext === "less") return "style";
	if (ext === "sh" || ext === "bash" || ext === "zsh" || ext === "fish") return "shell";
	if (ext === "csv" || ext === "tsv") return "table";
	if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico", "heic"].includes(ext)) return "image";
	if (ext === "txt" || ext === "log") return "text";
	return "file";
}

function formatRelativeDate(ts: number): string {
	if (!ts) return "";
	const now = Date.now();
	const diff = Math.max(0, now - ts);
	const hour = 1000 * 60 * 60;
	const day = hour * 24;
	if (diff < hour) return `${Math.max(1, Math.floor(diff / (1000 * 60)))}m`;
	if (diff < day) return `${Math.floor(diff / hour)}h`;
	return `${Math.floor(diff / day)}d`;
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return `${n}`;
}

function formatCost(cost: number): string {
	if (!cost) return "$0";
	if (cost < 0.01) return `$${cost.toFixed(3)}`;
	return `$${cost.toFixed(2)}`;
}

export class Sidebar {
	private container: HTMLElement;
	private projects: Project[] = [];
	private activeProjectId: string | null = null;
	private activeSessionPath: string | null = null;
	private activeFilePath: string | null = null;
	private runningSessionPaths = new Set<string>();
	private attentionSessionMessages = new Map<string, string>();
	private workspaces: SidebarWorkspaceItem[] = [];
	private activeWorkspaceId: string | null = null;
	private workspaceMenuOpen = false;
	private workspaceRenameDraft: { workspaceId: string; value: string } | null = null;
	private workspaceCreateDialogOpen = false;
	private workspaceCreateName = "";
	private workspaceCreateEmoji = "✨";
	private workspaceCreateEmojiPickerOpen = false;
	private workspaceCreateEmojiQuery = "";
	private emojiPickerWorkspaceId: string | null = null;
	private emojiPickerX = 0;
	private emojiPickerY = 0;
	private emojiSearchQuery = "";
	private pendingWorkspaceDragId: string | null = null;
	private draggingWorkspaceId: string | null = null;
	private workspaceDragOverId: string | null = null;
	private workspaceDragPointerId: number | null = null;
	private workspaceDragStartX = 0;
	private workspaceDragStartY = 0;
	private workspaceDragSuppressClickUntil = 0;
	private workspaceSwipeAccumulatorX = 0;
	private workspaceSwipeLastInputAt = 0;
	private workspaceSwipeLastSwitchAt = 0;
	private projectEmojiPickerProjectId: string | null = null;
	private projectEmojiPickerX = 0;
	private projectEmojiPickerY = 0;
	private projectEmojiSearchQuery = "";
	private pendingProjectDragId: string | null = null;
	private draggingProjectId: string | null = null;
	private projectDragOverId: string | null = null;
	private projectDragPointerId: number | null = null;
	private projectDragStartY = 0;
	private projectDragSuppressClickUntil = 0;
	private mode: SidebarMode = "projects";
	private query = "";
	private collapsed = false;
	private storageKey = workspaceStorageKey("workspace_default");

	private fileTrees = new Map<string, FileNode[]>();
	private fileTreeErrors = new Map<string, string>();
	private loadingFileTreeForProject = new Set<string>();
	private sessionLoadsInFlight = new Map<string, Promise<void>>();
	private sessionReloadQueued = new Set<string>();
	private packagesOpen = false;
	private openProjectMenuId: string | null = null;
	private modeFilterMenuOpen = false;
	private desktopUpdateAvailable = false;
	private desktopUpdateLatestVersion: string | null = null;
	private cliUpdateAvailable = false;
	private cliUpdateLatestVersion: string | null = null;
	private sessionOrganize: "byProject" | "chronological" = "byProject";
	private sessionSortBy: "updated" | "created" = "updated";
	private sessionShow: "all" | "relevant" = "all";
	private fileSort: "nameAsc" | "nameDesc" = "nameAsc";
	private fileKind: "all" | "files" | "dirs" = "all";
	private sessionRenameDraft: { projectId: string; sessionPath: string; value: string } | null = null;
	private fileRenameDraft: { projectId: string; filePath: string; value: string } | null = null;
	private contextMenu: { x: number; y: number; target: SidebarContextTarget } | null = null;
	private transientSessionDraft: { projectId: string; path: string | null; name: string; createdAt: number } | null = null;
	private suppressedSessionPaths = new Set<string>();

	private onOpenSettings: (() => void) | null = null;
	private onTogglePackages: (() => void) | null = null;
	private onWorkspaceSelect: ((workspaceId: string) => void) | null = null;
	private onWorkspaceCreate: ((workspace?: { title?: string; emoji?: string | null }) => void) | null = null;
	private onWorkspaceEmoji: ((workspaceId: string, emoji: string | null) => void) | null = null;
	private onWorkspaceReorder: ((orderedIds: string[]) => void) | null = null;
	private onWorkspaceRename: ((workspaceId: string, nextTitle: string) => void) | null = null;
	private onWorkspaceDelete: ((workspaceId: string) => void) | null = null;
	private onProjectSelect: ((project: { id: string; name: string; path: string } | null) => void) | null = null;
	private onSessionSelect: ((projectId: string, sessionPath: string, sessionName?: string) => void) | null = null;
	private onSessionRename: ((projectId: string, sessionPath: string, currentName: string, nextName: string) => void) | null = null;
	private onSessionDelete: ((projectId: string, sessionPath: string) => void) | null = null;
	private onSessionFork: ((projectId: string, sessionPath: string, sessionName?: string) => void) | null = null;
	private onNewSessionInProject: ((project: { id: string; name: string; path: string }) => void) | null = null;
	private onNewFileInProject: ((project: { id: string; name: string; path: string }) => void) | null = null;
	private onFileOpen: ((projectId: string, filePath: string) => void) | null = null;
	private onFileDelete: ((projectId: string, filePath: string) => void) | null = null;
	private onModeChange: ((mode: SidebarMode) => void) | null = null;
	private onCollapsedChange: ((collapsed: boolean) => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.loadSidebarState();
		this.loadPersistedProjects();
		this.render();
		void this.hydrateProjects();
	}

	private loadSidebarState(): void {
		try {
			this.collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
		} catch {
			this.collapsed = false;
		}
	}

	private persistSidebarState(): void {
		try {
			localStorage.setItem(SIDEBAR_COLLAPSED_KEY, this.collapsed ? "1" : "0");
		} catch {
			// ignore
		}
	}

	async setWorkspace(workspaceId: string): Promise<void> {
		const nextKey = workspaceStorageKey(workspaceId);
		if (this.storageKey === nextKey) return;

		this.storageKey = nextKey;
		this.query = "";
		this.projects = [];
		this.activeProjectId = null;
		this.activeSessionPath = null;
		this.activeFilePath = null;
		this.runningSessionPaths.clear();
		this.attentionSessionMessages.clear();
		this.fileTrees.clear();
		this.fileTreeErrors.clear();
		this.loadingFileTreeForProject.clear();
		this.openProjectMenuId = null;
		this.modeFilterMenuOpen = false;
		this.workspaceMenuOpen = false;
		this.workspaceRenameDraft = null;
		this.workspaceCreateDialogOpen = false;
		this.workspaceCreateName = "";
		this.workspaceCreateEmoji = "✨";
		this.workspaceCreateEmojiPickerOpen = false;
		this.workspaceCreateEmojiQuery = "";
		this.cancelWorkspacePointerDrag(false);
		this.cancelProjectPointerDrag(false);
		this.closeWorkspaceEmojiPicker(false);
		this.closeProjectEmojiPicker(false);
		this.transientSessionDraft = null;
		this.suppressedSessionPaths.clear();
		this.clearInlineDrafts();
		this.closeContextMenu(false);

		this.loadPersistedProjects();
		this.render();
		await this.hydrateProjects();
	}

	toggleCollapsed(): void {
		this.setCollapsed(!this.collapsed);
	}

	setCollapsed(collapsed: boolean): void {
		if (this.collapsed === collapsed) return;
		this.collapsed = collapsed;
		this.persistSidebarState();
		this.render();
		this.onCollapsedChange?.(collapsed);
	}

	isCollapsed(): boolean {
		return this.collapsed;
	}

	setOnOpenSettings(cb: () => void): void {
		this.onOpenSettings = cb;
	}

	setOnTogglePackages(cb: () => void): void {
		this.onTogglePackages = cb;
	}

	setOnWorkspaceSelect(cb: (workspaceId: string) => void): void {
		this.onWorkspaceSelect = cb;
	}

	setOnWorkspaceCreate(cb: (workspace?: { title?: string; emoji?: string | null }) => void): void {
		this.onWorkspaceCreate = cb;
	}

	setOnWorkspaceEmoji(cb: (workspaceId: string, emoji: string | null) => void): void {
		this.onWorkspaceEmoji = cb;
	}

	setOnWorkspaceReorder(cb: (orderedIds: string[]) => void): void {
		this.onWorkspaceReorder = cb;
	}

	setOnWorkspaceRename(cb: (workspaceId: string, nextTitle: string) => void): void {
		this.onWorkspaceRename = cb;
	}

	setOnWorkspaceDelete(cb: (workspaceId: string) => void): void {
		this.onWorkspaceDelete = cb;
	}

	setWorkspaces(workspaces: SidebarWorkspaceItem[], activeWorkspaceId: string | null): void {
		const next = workspaces.map((workspace) => ({
			id: workspace.id,
			title: workspace.title,
			emoji: workspace.emoji ?? null,
			color: workspace.color ?? null,
			pinned: Boolean(workspace.pinned),
			closable: Boolean(workspace.closable),
		}));
		const nextActive = activeWorkspaceId && next.some((workspace) => workspace.id === activeWorkspaceId)
			? activeWorkspaceId
			: next[0]?.id ?? null;

		const sameList =
			next.length === this.workspaces.length &&
			next.every((workspace, index) => {
				const current = this.workspaces[index];
				return Boolean(current) &&
					current.id === workspace.id &&
					current.title === workspace.title &&
					(current.emoji ?? null) === (workspace.emoji ?? null) &&
					(current.color ?? null) === (workspace.color ?? null) &&
					Boolean(current.pinned) === Boolean(workspace.pinned) &&
					Boolean(current.closable) === Boolean(workspace.closable);
			});

		if (sameList && this.activeWorkspaceId === nextActive) return;

		this.workspaces = next;
		this.activeWorkspaceId = nextActive;
		if (this.workspaceMenuOpen && !next.some((workspace) => workspace.id === this.activeWorkspaceId)) {
			this.workspaceMenuOpen = false;
		}
		if (
			(this.pendingWorkspaceDragId && !next.some((workspace) => workspace.id === this.pendingWorkspaceDragId)) ||
			(this.draggingWorkspaceId && !next.some((workspace) => workspace.id === this.draggingWorkspaceId)) ||
			(this.workspaceDragOverId && !next.some((workspace) => workspace.id === this.workspaceDragOverId))
		) {
			this.cancelWorkspacePointerDrag(false);
		}
		if (this.emojiPickerWorkspaceId && !next.some((workspace) => workspace.id === this.emojiPickerWorkspaceId)) {
			this.emojiPickerWorkspaceId = null;
			this.emojiSearchQuery = "";
		}
		if (this.workspaceRenameDraft && !next.some((workspace) => workspace.id === this.workspaceRenameDraft?.workspaceId)) {
			this.workspaceRenameDraft = null;
		}
		this.workspaceSwipeAccumulatorX = 0;
		this.workspaceSwipeLastInputAt = 0;
		this.render();
		if (this.workspaceRenameDraft && this.workspaceRenameDraft.workspaceId === this.activeWorkspaceId) {
			this.focusWorkspaceRenameInput(this.workspaceRenameDraft.workspaceId);
		}
	}

	setPackagesOpen(open: boolean): void {
		if (this.packagesOpen === open) return;
		this.packagesOpen = open;
		this.render();
	}

	setDesktopUpdateStatus(updateAvailable: boolean, latestVersion: string | null = null): void {
		const normalizedLatest = latestVersion && latestVersion.trim().length > 0 ? latestVersion.trim() : null;
		if (this.desktopUpdateAvailable === updateAvailable && this.desktopUpdateLatestVersion === normalizedLatest) return;
		this.desktopUpdateAvailable = updateAvailable;
		this.desktopUpdateLatestVersion = normalizedLatest;
		this.render();
	}

	setCliUpdateStatus(updateAvailable: boolean, latestVersion: string | null = null): void {
		const normalizedLatest = latestVersion && latestVersion.trim().length > 0 ? latestVersion.trim() : null;
		if (this.cliUpdateAvailable === updateAvailable && this.cliUpdateLatestVersion === normalizedLatest) return;
		this.cliUpdateAvailable = updateAvailable;
		this.cliUpdateLatestVersion = normalizedLatest;
		this.render();
	}

	setOnProjectSelect(cb: (project: { id: string; name: string; path: string } | null) => void): void {
		this.onProjectSelect = cb;
	}

	setOnSessionSelect(cb: (projectId: string, sessionPath: string, sessionName?: string) => void): void {
		this.onSessionSelect = cb;
	}

	setOnSessionRename(cb: (projectId: string, sessionPath: string, currentName: string, nextName: string) => void): void {
		this.onSessionRename = cb;
	}

	setOnSessionDelete(cb: (projectId: string, sessionPath: string) => void): void {
		this.onSessionDelete = cb;
	}

	setOnSessionFork(cb: (projectId: string, sessionPath: string, sessionName?: string) => void): void {
		this.onSessionFork = cb;
	}

	setOnNewSessionInProject(cb: (project: { id: string; name: string; path: string }) => void): void {
		this.onNewSessionInProject = cb;
	}

	setOnNewFileInProject(cb: (project: { id: string; name: string; path: string }) => void): void {
		this.onNewFileInProject = cb;
	}

	setOnFileOpen(cb: (projectId: string, filePath: string) => void): void {
		this.onFileOpen = cb;
	}

	setOnFileDelete(cb: (projectId: string, filePath: string) => void): void {
		this.onFileDelete = cb;
	}

	setOnModeChange(cb: (mode: SidebarMode) => void): void {
		this.onModeChange = cb;
	}

	setOnCollapsedChange(cb: (collapsed: boolean) => void): void {
		this.onCollapsedChange = cb;
	}

	private clearInlineDrafts(shouldRender = false): void {
		const hadDraft = Boolean(this.sessionRenameDraft || this.fileRenameDraft);
		this.sessionRenameDraft = null;
		this.fileRenameDraft = null;
		if (shouldRender && hadDraft) {
			this.render();
		}
	}

	private closeContextMenu(shouldRender = true): void {
		if (!this.contextMenu) return;
		this.contextMenu = null;
		if (shouldRender) this.render();
	}

	private openContextMenu(e: MouseEvent, target: SidebarContextTarget): void {
		e.preventDefault();
		e.stopPropagation();
		const menuWidth = 170;
		const menuHeight = target.kind === "workspace" ? 92 : target.kind === "session" ? 132 : 92;
		const padding = 8;
		const x = Math.max(padding, Math.min(e.clientX, window.innerWidth - menuWidth - padding));
		const y = Math.max(padding, Math.min(e.clientY, window.innerHeight - menuHeight - padding));
		this.closeWorkspaceEmojiPicker(false);
		this.closeProjectEmojiPicker(false);
		this.contextMenu = { x, y, target };
		this.render();
	}

	private findSession(projectId: string, sessionPath: string): { project: Project; session: SidebarSession } | null {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return null;
		const session = project.sessions.find((entry) => normalizePath(entry.path) === normalizePath(sessionPath));
		if (!session) return null;
		return { project, session };
	}

	private findFileNode(projectId: string, filePath: string): FileNode | null {
		const normalized = normalizePath(filePath);
		const walk = (nodes: FileNode[]): FileNode | null => {
			for (const node of nodes) {
				if (normalizePath(node.path) === normalized) return node;
				if (node.children?.length) {
					const found = walk(node.children);
					if (found) return found;
				}
			}
			return null;
		};
		return walk(this.fileTrees.get(projectId) ?? []);
	}

	setMode(mode: SidebarMode): void {
		if (this.mode === mode) return;
		this.mode = mode;
		this.query = "";
		this.modeFilterMenuOpen = false;
		this.cancelProjectPointerDrag(false);
		this.clearInlineDrafts();
		this.closeContextMenu(false);
		if (mode === "files") {
			const expandedProjects = this.projects.filter((project) => project.expanded);
			if (expandedProjects.length === 0) {
				void this.ensureFileTreeForActiveProject();
			} else {
				expandedProjects.forEach((project) => {
					void this.ensureFileTreeForProject(project.id);
				});
			}
		}
		this.render();
		this.onModeChange?.(mode);
	}

	getMode(): SidebarMode {
		return this.mode;
	}

	getActiveProject(): { id: string; name: string; path: string } | null {
		const p = this.projects.find((x) => x.id === this.activeProjectId);
		return p ? { id: p.id, name: p.name, path: p.path } : null;
	}

	getProjectById(projectId: string | null | undefined): { id: string; name: string; path: string } | null {
		if (!projectId) return null;
		const project = this.projects.find((entry) => entry.id === projectId) ?? null;
		return project ? { id: project.id, name: project.name, path: project.path } : null;
	}

	getProjectByPath(projectPath: string | null | undefined): { id: string; name: string; path: string } | null {
		const normalized = normalizePath(projectPath);
		if (!normalized) return null;
		const project = this.projects.find((entry) => normalizePath(entry.path) === normalized) ?? null;
		return project ? { id: project.id, name: project.name, path: project.path } : null;
	}

	clearActiveProject(emitSelect = false): void {
		const changed = this.activeProjectId !== null;
		this.activeProjectId = null;
		this.activeSessionPath = null;
		this.activeFilePath = null;
		this.clearInlineDrafts();
		this.closeContextMenu(false);
		this.render();
		if (emitSelect && changed) {
			this.onProjectSelect?.(null);
		}
	}

	setActiveProject(projectId: string | null, emitSelect = false): void {
		if (!projectId) {
			this.clearActiveProject(emitSelect);
			return;
		}
		this.selectProject(projectId, emitSelect);
	}

	setActiveSessionPath(sessionPath: string | null): void {
		const normalized = sessionPath ? normalizePath(sessionPath) : null;
		if (this.activeSessionPath === normalized) return;
		this.activeSessionPath = normalized;
		this.render();
	}

	setActiveFilePath(filePath: string | null): void {
		const normalized = filePath ? normalizePath(filePath) : null;
		if (this.activeFilePath === normalized) return;
		this.activeFilePath = normalized;
		this.render();
	}

	setRunningSessionPaths(sessionPaths: string[]): void {
		const next = new Set(
			sessionPaths
				.map((sessionPath) => normalizePath(sessionPath))
				.filter((sessionPath) => Boolean(sessionPath)),
		);

		if (next.size === this.runningSessionPaths.size) {
			let identical = true;
			for (const sessionPath of next) {
				if (!this.runningSessionPaths.has(sessionPath)) {
					identical = false;
					break;
				}
			}
			if (identical) return;
		}

		this.runningSessionPaths = next;
		this.render();
	}

	setRunningSessionPath(sessionPath: string | null): void {
		this.setRunningSessionPaths(sessionPath ? [sessionPath] : []);
	}

	setAttentionSessions(entries: Array<{ path: string; message?: string | null }>): void {
		const next = new Map<string, string>();
		for (const entry of entries) {
			const normalizedPath = normalizePath(entry.path);
			if (!normalizedPath) continue;
			const message = typeof entry.message === "string" && entry.message.trim().length > 0
				? entry.message.trim()
				: "I’m waiting for you — Pi";
			next.set(normalizedPath, message);
		}

		if (next.size === this.attentionSessionMessages.size) {
			let identical = true;
			for (const [path, message] of next) {
				if (this.attentionSessionMessages.get(path) !== message) {
					identical = false;
					break;
				}
			}
			if (identical) return;
		}

		this.attentionSessionMessages = next;
		this.render();
	}

	setSuppressedSessionPaths(sessionPaths: string[]): void {
		const next = new Set(
			sessionPaths
				.map((sessionPath) => normalizePath(sessionPath))
				.filter((sessionPath) => Boolean(sessionPath)),
		);
		if (next.size === this.suppressedSessionPaths.size) {
			let identical = true;
			for (const sessionPath of next) {
				if (!this.suppressedSessionPaths.has(sessionPath)) {
					identical = false;
					break;
				}
			}
			if (identical) return;
		}
		this.suppressedSessionPaths = next;
		this.render();
	}

	setTransientSessionDraft(draft: { projectId: string; path?: string | null; name?: string | null } | null): void {
		const next = draft
			? {
				projectId: draft.projectId,
				path: draft.path ? draft.path : null,
				name: draft.name?.trim() || "New session",
				createdAt: Date.now(),
			}
			: null;
		const same =
			this.transientSessionDraft?.projectId === next?.projectId &&
			normalizePath(this.transientSessionDraft?.path) === normalizePath(next?.path) &&
			this.transientSessionDraft?.name === next?.name;
		if (same) return;
		this.transientSessionDraft = next;
		this.render();
	}

	async ensureSessionsLoadedForProject(projectId: string): Promise<void> {
		const project = this.projects.find((entry) => entry.id === projectId);
		if (!project) return;
		if (project.loadingSessions || project.sessionsLoaded) return;
		await this.loadSessionsForProject(projectId, { silent: true });
	}

	getPreferredSessionForProject(projectId: string): { path: string; name: string } | null {
		const project = this.projects.find((entry) => entry.id === projectId);
		if (!project) return null;
		const sessions = this.sortedSessions(
			project.sessions.filter((session) => {
				const normalizedPath = normalizePath(session.path);
				return Boolean(normalizedPath) && !this.suppressedSessionPaths.has(normalizedPath);
			}),
		);
		const session = sessions[0] ?? null;
		return session ? { path: session.path, name: session.name } : null;
	}

	removeSessionPath(sessionPath: string): void {
		const normalized = normalizePath(sessionPath);
		if (!normalized) return;
		let changed = false;
		for (const project of this.projects) {
			const nextSessions = project.sessions.filter((entry) => normalizePath(entry.path) !== normalized);
			if (nextSessions.length !== project.sessions.length) {
				project.sessions = nextSessions;
				changed = true;
			}
		}
		if (this.activeSessionPath === normalized) {
			this.activeSessionPath = null;
			changed = true;
		}
		if (changed) {
			this.render();
		}
	}

	refreshActiveProjectSessions(): void {
		const active = this.getActiveProject();
		if (!active) return;
		void this.loadSessionsForProject(active.id, { silent: true });
	}

	upsertSession(
		projectId: string,
		session: {
			id?: string | null;
			name?: string | null;
			path: string;
			createdAt?: number | null;
			modifiedAt?: number | null;
			tokens?: number | null;
			cost?: number | null;
			optimistic?: boolean;
		},
	): void {
		const project = this.projects.find((entry) => entry.id === projectId);
		if (!project) return;
		const normalized = normalizePath(session.path);
		if (!normalized) return;
		const now = Date.now();
		const existing = project.sessions.find((entry) => normalizePath(entry.path) === normalized) ?? null;
		const nextName = session.name?.trim() || existing?.name || "Untitled session";
		if (existing) {
			existing.id = session.id?.trim() || existing.id;
			existing.name = nextName;
			existing.createdAt = session.createdAt ?? existing.createdAt ?? now;
			existing.modifiedAt = session.modifiedAt ?? existing.modifiedAt ?? now;
			existing.tokens = session.tokens ?? existing.tokens ?? 0;
			existing.cost = session.cost ?? existing.cost ?? 0;
			existing.optimistic = session.optimistic ?? existing.optimistic ?? false;
		} else {
			project.sessions.unshift({
				id: session.id?.trim() || uid("session"),
				name: nextName,
				path: session.path,
				createdAt: session.createdAt ?? session.modifiedAt ?? now,
				modifiedAt: session.modifiedAt ?? session.createdAt ?? now,
				tokens: session.tokens ?? 0,
				cost: session.cost ?? 0,
				optimistic: session.optimistic ?? false,
			});
		}
		project.sessionsLoaded = true;
		project.lastSessionsLoadedAt = Date.now();
		this.render();
	}

	refreshActiveProjectFiles(forceReload = true): void {
		const active = this.getActiveProject();
		if (!active) return;
		void this.ensureFileTreeForProject(active.id, forceReload);
	}

	// Legacy compatibility for existing keybindings in main.ts
	setActiveView(_view: string): void {
		// no-op
	}

	async openFolder(): Promise<void> {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				directory: true,
				multiple: false,
				title: "Open Project Folder",
			});
			if (!selected || typeof selected !== "string") return;

			const normalized = normalizePath(selected);
			const existing = this.projects.find((p) => normalizePath(p.path) === normalized);
			if (existing) {
				this.selectProject(existing.id, true);
				void this.refreshProjectPathStatus(existing.id);
				return;
			}

			const name = pathBaseName(selected);
			const project: Project = {
				id: crypto.randomUUID(),
				path: selected,
				name,
				color: stringToColor(name),
				emoji: normalizeProjectEmoji(null),
				pinned: false,
				expanded: true,
				sessions: [],
				loadingSessions: false,
				sessionsLoaded: false,
				lastSessionsLoadedAt: 0,
				pathExists: true,
				checkingPath: false,
			};

			this.projects.unshift(project);
			this.sortProjectsInPlace();
			this.persistProjects();
			this.selectProject(project.id, true);
			void this.refreshProjectPathStatus(project.id);
			await this.loadSessionsForProject(project.id);
			if (this.mode === "files") {
				await this.ensureFileTreeForProject(project.id, true);
			}
		} catch (err) {
			console.error("Failed to open folder:", err);
		}
	}

	private async createFileInActiveProject(): Promise<void> {
		const project = this.getActiveProject();
		if (!project) return;

		const input = window.prompt("New file name", "new-file.txt")?.trim();
		if (!input) return;
		if (input.includes("/") || input.includes("\\")) {
			window.alert("Use a file name without folders.");
			return;
		}

		const filePath = joinFsPath(project.path, input);
		try {
			const { exists, writeTextFile } = await import("@tauri-apps/plugin-fs");
			if (await exists(filePath)) {
				window.alert("A file with that name already exists.");
				return;
			}

			await writeTextFile(filePath, "");
			await this.ensureFileTreeForProject(project.id, true);
			this.openFile(project.id, filePath);
		} catch (err) {
			console.error("Failed to create file:", err);
			window.alert(err instanceof Error ? err.message : String(err));
		}
	}

	private startFileRename(projectId: string, node: FileNode): void {
		if (node.isDirectory) return;
		this.sessionRenameDraft = null;
		this.fileRenameDraft = {
			projectId,
			filePath: normalizePath(node.path),
			value: node.name,
		};
		this.render();
	}

	private cancelFileRename(): void {
		if (!this.fileRenameDraft) return;
		this.fileRenameDraft = null;
		this.render();
	}

	private async commitFileRename(projectId: string, node: FileNode): Promise<void> {
		if (node.isDirectory) return;
		const draft = this.fileRenameDraft;
		if (!draft) return;
		if (draft.projectId !== projectId || draft.filePath !== normalizePath(node.path)) return;

		const currentName = node.name;
		const nextName = draft.value.trim();
		if (!nextName || nextName === currentName) {
			this.fileRenameDraft = null;
			this.render();
			return;
		}
		if (nextName.includes("/") || nextName.includes("\\")) {
			window.alert("Use a file name without folders.");
			return;
		}

		const parentPath = node.path.replace(/[\\/][^\\/]+$/, "");
		const nextPath = joinFsPath(parentPath, nextName);
		try {
			const { exists, rename } = await import("@tauri-apps/plugin-fs");
			if (await exists(nextPath)) {
				window.alert("A file with that name already exists.");
				return;
			}
			await rename(node.path, nextPath);
			this.fileRenameDraft = null;
			if (this.activeFilePath === normalizePath(node.path)) {
				this.activeFilePath = normalizePath(nextPath);
			}
			await this.ensureFileTreeForProject(projectId, true);
			this.openFile(projectId, nextPath);
		} catch (err) {
			console.error("Failed to rename file:", err);
			window.alert(err instanceof Error ? err.message : String(err));
		}
	}

	private startSessionRename(project: Project, session: SidebarSession): void {
		this.fileRenameDraft = null;
		this.sessionRenameDraft = {
			projectId: project.id,
			sessionPath: normalizePath(session.path),
			value: session.name,
		};
		this.render();
	}

	private cancelSessionRename(): void {
		if (!this.sessionRenameDraft) return;
		this.sessionRenameDraft = null;
		this.render();
	}

	private commitSessionRename(project: Project, session: SidebarSession): void {
		const draft = this.sessionRenameDraft;
		if (!draft) return;
		if (draft.projectId !== project.id || draft.sessionPath !== normalizePath(session.path)) return;

		const currentName = session.name;
		const nextName = draft.value.trim();
		this.sessionRenameDraft = null;

		if (!nextName || nextName === currentName) {
			this.render();
			return;
		}

		session.name = nextName;
		this.render();
		this.onSessionRename?.(project.id, session.path, currentName, nextName);
	}

	private async deleteSession(project: Project, session: SidebarSession): Promise<void> {
		try {
			const { exists, remove } = await import("@tauri-apps/plugin-fs");
			if (await exists(session.path)) {
				await remove(session.path);
			}
			project.sessions = project.sessions.filter((entry) => normalizePath(entry.path) !== normalizePath(session.path));
			if (this.activeSessionPath === normalizePath(session.path)) {
				this.activeSessionPath = null;
			}
			this.sessionRenameDraft = null;
			this.onSessionDelete?.(project.id, session.path);
			this.render();
		} catch (err) {
			console.error("Failed to delete session:", err);
			window.alert(err instanceof Error ? err.message : String(err));
		}
	}

	private removeFileNodeFromTree(projectId: string, filePath: string): void {
		const normalized = normalizePath(filePath);
		if (!normalized) return;
		const nodes = this.fileTrees.get(projectId);
		if (!nodes) return;

		const prune = (list: FileNode[]): FileNode[] =>
			list
				.filter((entry) => normalizePath(entry.path) !== normalized)
				.map((entry) => {
					if (entry.children?.length) {
						entry.children = prune(entry.children);
					}
					return entry;
				});

		this.fileTrees.set(projectId, prune(nodes));
	}

	private async deleteFileNode(projectId: string, node: FileNode): Promise<void> {
		if (node.isDirectory) return;

		try {
			const { remove } = await import("@tauri-apps/plugin-fs");
			await remove(node.path);
			if (this.activeFilePath === normalizePath(node.path)) {
				this.activeFilePath = null;
			}
			this.fileRenameDraft = null;
			this.removeFileNodeFromTree(projectId, node.path);
			this.onFileDelete?.(projectId, node.path);
			this.render();
		} catch (err) {
			console.error("Failed to delete file:", err);
			window.alert(err instanceof Error ? err.message : String(err));
		}
	}

	private handleSessionContextMenu(e: MouseEvent, project: Project, session: SidebarSession): void {
		this.selectProject(project.id, false);
		this.activeSessionPath = normalizePath(session.path);
		this.activeFilePath = null;
		this.clearInlineDrafts();
		this.openContextMenu(e, { kind: "session", projectId: project.id, sessionPath: session.path });
	}

	private handleFileContextMenu(e: MouseEvent, projectId: string, node: FileNode): void {
		if (node.isDirectory) return;
		this.selectProject(projectId, false);
		this.activeSessionPath = null;
		this.activeFilePath = normalizePath(node.path);
		this.clearInlineDrafts();
		this.openContextMenu(e, { kind: "file", projectId, filePath: node.path });
	}

	private handleWorkspaceContextMenu(e: MouseEvent, workspaceId: string): void {
		this.openContextMenu(e, { kind: "workspace", workspaceId });
	}

	private runSessionContextAction(action: "rename" | "delete" | "fork"): void {
		const target = this.contextMenu?.target;
		if (!target || target.kind !== "session") return;
		this.closeContextMenu(false);
		const found = this.findSession(target.projectId, target.sessionPath);
		if (!found) {
			this.render();
			return;
		}
		if (action === "rename") {
			this.startSessionRename(found.project, found.session);
			return;
		}
		if (action === "fork") {
			this.onSessionFork?.(found.project.id, found.session.path, found.session.name);
			return;
		}
		void this.deleteSession(found.project, found.session);
	}

	private runFileContextAction(action: "rename" | "delete"): void {
		const target = this.contextMenu?.target;
		if (!target || target.kind !== "file") return;
		this.closeContextMenu(false);
		const node = this.findFileNode(target.projectId, target.filePath);
		if (!node) {
			this.render();
			return;
		}
		if (action === "rename") {
			this.startFileRename(target.projectId, node);
			return;
		}
		void this.deleteFileNode(target.projectId, node);
	}

	private runWorkspaceContextAction(action: "rename" | "delete"): void {
		const target = this.contextMenu?.target;
		if (!target || target.kind !== "workspace") return;
		this.closeContextMenu(false);
		const workspace = this.workspaces.find((entry) => entry.id === target.workspaceId) ?? null;
		if (!workspace) {
			this.render();
			return;
		}

		if (action === "rename") {
			this.startWorkspaceRename(workspace.id);
			return;
		}

		if (this.workspaces.length <= 1) {
			this.render();
			return;
		}

		this.onWorkspaceDelete?.(workspace.id);
	}

	private renderContextMenu(): TemplateResult | typeof nothing {
		const menu = this.contextMenu;
		if (!menu) return nothing;

		const target = menu.target;
		let menuContent: TemplateResult;
		if (target.kind === "session") {
			menuContent = html`
				<div class="sidebar-context-menu" style=${`left:${menu.x}px;top:${menu.y}px`} @click=${(e: Event) => e.stopPropagation()}>
					<button @click=${() => this.runSessionContextAction("fork")}>Fork from message…</button>
					<div class="sidebar-context-menu-divider"></div>
					<button @click=${() => this.runSessionContextAction("rename")}>Rename session</button>
					<button class="danger" @click=${() => this.runSessionContextAction("delete")}>Delete session</button>
				</div>
			`;
		} else if (target.kind === "file") {
			menuContent = html`
				<div class="sidebar-context-menu" style=${`left:${menu.x}px;top:${menu.y}px`} @click=${(e: Event) => e.stopPropagation()}>
					<button @click=${() => this.runFileContextAction("rename")}>Rename file</button>
					<button class="danger" @click=${() => this.runFileContextAction("delete")}>Delete file</button>
				</div>
			`;
		} else {
			const canDeleteWorkspace = this.workspaces.length > 1;
			menuContent = html`
				<div class="sidebar-context-menu" style=${`left:${menu.x}px;top:${menu.y}px`} @click=${(e: Event) => e.stopPropagation()}>
					<button @click=${() => this.runWorkspaceContextAction("rename")}>Rename workspace</button>
					<button
						class="danger"
						?disabled=${!canDeleteWorkspace}
						title=${canDeleteWorkspace ? "Delete workspace" : "At least one workspace is required"}
						@click=${() => this.runWorkspaceContextAction("delete")}
					>
						Delete workspace
					</button>
				</div>
			`;
		}

		return html`
			<div class="sidebar-context-menu-backdrop" @click=${() => this.closeContextMenu()}></div>
			${menuContent}
		`;
	}

	private async triggerPrimaryTopAction(): Promise<void> {
		if (this.mode === "files") {
			this.triggerNewFileForActiveProject();
			return;
		}
		this.triggerNewSessionForActiveProject();
	}

	private async handleModeCreateAction(): Promise<void> {
		await this.openFolder();
	}

	private toggleModeFilterMenu(): void {
		this.modeFilterMenuOpen = !this.modeFilterMenuOpen;
		this.render();
	}

	private handleProjectMainClick(projectId: string): void {
		const wasActive = this.activeProjectId === projectId;
		this.selectProject(projectId, true);
		if (wasActive) {
			this.toggleProject(projectId);
		}
	}

	private renderModeFilterMenu(): TemplateResult | typeof nothing {
		if (!this.modeFilterMenuOpen) return nothing;

		if (this.mode === "projects") {
			return html`
				<div class="sidebar-mode-filter-menu sidebar-mode-filter-menu--sessions" @click=${(e: Event) => e.stopPropagation()}>
					<div class="sidebar-mode-filter-section">
						<div class="sidebar-mode-filter-label">Organize</div>
						<button class=${this.sessionOrganize === "byProject" ? "active" : ""} @click=${() => {
							this.sessionOrganize = "byProject";
							this.modeFilterMenuOpen = false;
							this.render();
						}}>
							<span>By project</span>
							${this.sessionOrganize === "byProject" ? html`<span class="sidebar-mode-filter-check">✓</span>` : nothing}
						</button>
						<button class=${this.sessionOrganize === "chronological" ? "active" : ""} @click=${() => {
							this.sessionOrganize = "chronological";
							this.modeFilterMenuOpen = false;
							this.render();
						}}>
							<span>Chronological list</span>
							${this.sessionOrganize === "chronological" ? html`<span class="sidebar-mode-filter-check">✓</span>` : nothing}
						</button>
					</div>
					<div class="sidebar-mode-filter-section">
						<div class="sidebar-mode-filter-label">Sort by</div>
						<button class=${this.sessionSortBy === "created" ? "active" : ""} @click=${() => {
							this.sessionSortBy = "created";
							this.modeFilterMenuOpen = false;
							this.render();
						}}>
							<span>Created</span>
							${this.sessionSortBy === "created" ? html`<span class="sidebar-mode-filter-check">✓</span>` : nothing}
						</button>
						<button class=${this.sessionSortBy === "updated" ? "active" : ""} @click=${() => {
							this.sessionSortBy = "updated";
							this.modeFilterMenuOpen = false;
							this.render();
						}}>
							<span>Updated</span>
							${this.sessionSortBy === "updated" ? html`<span class="sidebar-mode-filter-check">✓</span>` : nothing}
						</button>
					</div>
					<div class="sidebar-mode-filter-section">
						<div class="sidebar-mode-filter-label">Show</div>
						<button class=${this.sessionShow === "all" ? "active" : ""} @click=${() => {
							this.sessionShow = "all";
							this.modeFilterMenuOpen = false;
							this.render();
						}}>
							<span>All threads</span>
							${this.sessionShow === "all" ? html`<span class="sidebar-mode-filter-check">✓</span>` : nothing}
						</button>
						<button class=${this.sessionShow === "relevant" ? "active" : ""} @click=${() => {
							this.sessionShow = "relevant";
							this.modeFilterMenuOpen = false;
							this.render();
						}}>
							<span>Relevant</span>
							${this.sessionShow === "relevant" ? html`<span class="sidebar-mode-filter-check">✓</span>` : nothing}
						</button>
					</div>
				</div>
			`;
		}

		return html`
			<div class="sidebar-mode-filter-menu" @click=${(e: Event) => e.stopPropagation()}>
				<div class="sidebar-mode-filter-section">
					<div class="sidebar-mode-filter-label">Sort files</div>
					<button class=${this.fileSort === "nameAsc" ? "active" : ""} @click=${() => {
						this.fileSort = "nameAsc";
						this.modeFilterMenuOpen = false;
						this.render();
					}}>Name A–Z</button>
					<button class=${this.fileSort === "nameDesc" ? "active" : ""} @click=${() => {
						this.fileSort = "nameDesc";
						this.modeFilterMenuOpen = false;
						this.render();
					}}>Name Z–A</button>
				</div>
				<div class="sidebar-mode-filter-section">
					<div class="sidebar-mode-filter-label">Show</div>
					<button class=${this.fileKind === "all" ? "active" : ""} @click=${() => {
						this.fileKind = "all";
						this.modeFilterMenuOpen = false;
						this.render();
					}}>All</button>
					<button class=${this.fileKind === "files" ? "active" : ""} @click=${() => {
						this.fileKind = "files";
						this.modeFilterMenuOpen = false;
						this.render();
					}}>Files</button>
					<button class=${this.fileKind === "dirs" ? "active" : ""} @click=${() => {
						this.fileKind = "dirs";
						this.modeFilterMenuOpen = false;
						this.render();
					}}>Folders</button>
				</div>
			</div>
		`;
	}

	private async hydrateProjects(): Promise<void> {
		await Promise.all(this.projects.map((project) => this.refreshProjectPathStatus(project.id)));
		if (this.activeProjectId) {
			void this.loadSessionsForProject(this.activeProjectId);
		}
		if (this.mode === "files") {
			void this.ensureFileTreeForActiveProject();
		}
	}

	private selectProject(projectId: string, emitSelect = true): void {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		const changed = this.activeProjectId !== projectId;
		this.activeProjectId = projectId;
		if (changed) {
			this.activeSessionPath = null;
			this.activeFilePath = null;
			this.clearInlineDrafts();
			this.closeContextMenu(false);
		}

		if (this.mode === "files") {
			void this.ensureFileTreeForProject(project.id);
		}
		if (!project.sessionsLoaded && !project.loadingSessions) {
			void this.loadSessionsForProject(project.id);
		}

		this.render();

		if ((changed || emitSelect) && emitSelect) {
			this.onProjectSelect?.({ id: project.id, name: project.name, path: project.path });
		}
	}

	private toggleProject(projectId: string): void {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		project.expanded = !project.expanded;
		if (project.expanded && this.mode === "projects" && !project.sessionsLoaded && !project.loadingSessions) {
			void this.loadSessionsForProject(project.id);
		}
		if (project.expanded && this.mode === "files") {
			void this.ensureFileTreeForProject(project.id);
		}
		this.render();
	}

	private async refreshProjectPathStatus(projectId: string): Promise<void> {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		project.checkingPath = true;
		this.render();

		try {
			const { exists } = await import("@tauri-apps/plugin-fs");
			project.pathExists = await exists(project.path);
		} catch (err) {
			console.warn("Failed to verify project path:", err);
			project.pathExists = null;
		} finally {
			project.checkingPath = false;
			this.render();
		}
	}

	private async relinkProject(projectId: string): Promise<void> {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;

		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const selected = await open({
				directory: true,
				multiple: false,
				title: `Relink “${project.name}”`,
			});
			if (!selected || typeof selected !== "string") return;

			const normalized = normalizePath(selected);
			const duplicate = this.projects.find((p) => p.id !== projectId && normalizePath(p.path) === normalized);
			if (duplicate) {
				this.selectProject(duplicate.id, true);
				return;
			}

			project.path = selected;
			project.name = pathBaseName(selected);
			this.sortProjectsInPlace();
			project.pathExists = true;
			project.sessions = [];
			project.sessionsLoaded = false;
			project.lastSessionsLoadedAt = 0;
			this.fileTrees.delete(project.id);
			this.sortProjectsInPlace();
			this.fileTreeErrors.delete(project.id);
			this.persistProjects();
			this.render();
			this.selectProject(project.id, true);
			await this.loadSessionsForProject(project.id);
			if (this.mode === "files") {
				await this.ensureFileTreeForProject(project.id, true);
			}
		} catch (err) {
			console.error("Failed to relink project:", err);
		}
	}

	private async loadSessionsForProject(projectId: string, options?: { silent?: boolean }): Promise<void> {
		const existingLoad = this.sessionLoadsInFlight.get(projectId);
		if (existingLoad) {
			this.sessionReloadQueued.add(projectId);
			return existingLoad;
		}

		const run = (async () => {
			const project = this.projects.find((p) => p.id === projectId);
			if (!project) return;
			const silent = options?.silent === true;
			const now = Date.now();
			if (silent && project.sessionsLoaded && now - project.lastSessionsLoadedAt < 2200) {
				return;
			}
			const loadingBefore = project.loadingSessions;
			if (!silent) {
				project.loadingSessions = true;
				this.render();
			}

			const hadLoadedSessions = project.sessionsLoaded;
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				const sessions = await invoke<Array<{
					id: string;
					name: string | null;
					path: string;
					cwd: string | null;
					created_at: number;
					modified_at: number;
					tokens: number;
					cost: number;
				}>>("list_sessions");

				const projectPath = normalizePath(project.path);
				const byProject = sessions.filter((s) => {
					const cwdPath = normalizePath(s.cwd);
					if (cwdPath && cwdPath === projectPath) return true;
					const sessionPath = normalizePath(s.path);
					return sessionPath.includes(projectPath) || sessionPath.includes(normalizePath(project.name));
				});

				const visibleProjectSessions = byProject.filter((session) => !this.suppressedSessionPaths.has(normalizePath(session.path)));
				const scannedSessions = visibleProjectSessions.slice(0, 40).map((s) => ({
					id: s.id,
					name: s.name || "Untitled session",
					path: s.path,
					createdAt: s.created_at ?? s.modified_at,
					modifiedAt: s.modified_at,
					tokens: s.tokens ?? 0,
					cost: s.cost ?? 0,
					optimistic: false,
				} satisfies SidebarSession));

				const scannedByPath = new Map<string, SidebarSession>(
					scannedSessions.map((entry) => [normalizePath(entry.path), entry] as const),
				);
				const preserveUntil = Date.now() - 120_000;
				const preservedOptimistic = project.sessions.filter((entry) => {
					if (!entry.optimistic || entry.transient) return false;
					const normalizedPath = normalizePath(entry.path);
					if (!normalizedPath || scannedByPath.has(normalizedPath)) return false;
					if (normalizedPath === this.activeSessionPath) return true;
					return (entry.modifiedAt || entry.createdAt || 0) >= preserveUntil;
				});

				for (const entry of preservedOptimistic) {
					scannedByPath.set(normalizePath(entry.path), entry);
				}

				project.sessions = [...scannedByPath.values()];
				project.sessionsLoaded = true;
				project.lastSessionsLoadedAt = Date.now();
			} catch (err) {
				console.error("Failed to load sessions:", err);
				if (!silent) {
					project.sessions = [];
				}
				if (!hadLoadedSessions) {
					project.sessionsLoaded = false;
					project.lastSessionsLoadedAt = 0;
				}
			} finally {
				project.loadingSessions = silent ? loadingBefore : false;
				this.render();
			}
		})();

		this.sessionLoadsInFlight.set(projectId, run);
		try {
			await run;
		} finally {
			this.sessionLoadsInFlight.delete(projectId);
			if (this.sessionReloadQueued.has(projectId)) {
				this.sessionReloadQueued.delete(projectId);
				queueMicrotask(() => {
					void this.loadSessionsForProject(projectId, { silent: true });
				});
			}
		}
	}

	private async ensureFileTreeForActiveProject(): Promise<void> {
		const active = this.getActiveProject();
		if (!active) return;
		await this.ensureFileTreeForProject(active.id);
	}

	private async resolveGitDirPointer(pointerPath: string, parentReadPath: string): Promise<string | null> {
		try {
			const [{ readTextFile, exists, stat }, { resolve }] = await Promise.all([
				import("@tauri-apps/plugin-fs"),
				import("@tauri-apps/api/path"),
			]);
			const content = await readTextFile(pointerPath);
			const firstLine = content.split(/\r?\n/, 1)[0]?.trim() ?? "";
			const match = /^gitdir:\s*(.+)$/i.exec(firstLine);
			if (!match) return null;
			const rawTarget = match[1].trim();
			const targetPath = isAbsolutePath(rawTarget) ? rawTarget : await resolve(parentReadPath, rawTarget);
			const targetExists = await exists(targetPath);
			if (!targetExists) return null;
			const info = await stat(targetPath);
			return info.isDirectory ? targetPath : null;
		} catch {
			return null;
		}
	}

	private async mapDirectoryEntries(readBasePath: string, displayBasePath: string, depth: number): Promise<FileNode[]> {
		const { readDir, stat } = await import("@tauri-apps/plugin-fs");
		const entries = await readDir(readBasePath);

		const nodes = await Promise.all(
			entries.map(async (entry) => {
				const actualPath = joinFsPath(readBasePath, entry.name);
				const displayPath = joinFsPath(displayBasePath, entry.name);

				let isDirectory = entry.isDirectory;
				if (!isDirectory && entry.isSymlink) {
					try {
						const info = await stat(actualPath);
						isDirectory = info.isDirectory;
					} catch {
						// ignore symlink stat issues
					}
				}

				let resolvedPath = actualPath;
				if (!isDirectory && entry.name === ".git" && entry.isFile) {
					const gitTarget = await this.resolveGitDirPointer(actualPath, readBasePath);
					if (gitTarget) {
						resolvedPath = gitTarget;
						isDirectory = true;
					}
				}

				return {
					id: uid("file"),
					name: entry.name,
					path: resolvedPath,
					displayPath,
					isDirectory,
					isSymlink: Boolean(entry.isSymlink),
					expanded: false,
					loading: false,
					loadError: false,
					depth,
				} satisfies FileNode;
			}),
		);

		return nodes.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	private async ensureFileTreeForProject(projectId: string, forceReload = false): Promise<void> {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		if (!forceReload && this.fileTrees.has(projectId)) return;
		if (this.loadingFileTreeForProject.has(projectId)) return;

		this.loadingFileTreeForProject.add(projectId);
		this.render();

		try {
			const nodes = await this.mapDirectoryEntries(project.path, project.path, 0);
			this.fileTrees.set(projectId, nodes);
			this.fileTreeErrors.delete(projectId);
		} catch (err) {
			console.error("Failed to load file tree:", err);
			this.fileTrees.set(projectId, []);
			this.fileTreeErrors.set(projectId, err instanceof Error ? err.message : String(err));
		} finally {
			this.loadingFileTreeForProject.delete(projectId);
			this.render();
		}
	}

	private async toggleDirectory(projectId: string, node: FileNode): Promise<void> {
		if (!node.isDirectory) return;
		node.expanded = !node.expanded;
		this.render();

		if (!node.expanded) return;
		if (node.children) return;
		node.loading = true;
		node.loadError = false;
		this.render();

		try {
			node.children = await this.mapDirectoryEntries(node.path, node.displayPath, node.depth + 1);
			node.loadError = false;
		} catch (err) {
			console.error("Failed to load folder contents:", err);
			node.children = [];
			node.loadError = true;
		} finally {
			node.loading = false;
			this.render();
		}
	}

	private openFile(projectId: string, filePath: string): void {
		this.onFileOpen?.(projectId, filePath);
	}

	private toggleProjectMenu(projectId: string): void {
		this.closeContextMenu(false);
		this.openProjectMenuId = this.openProjectMenuId === projectId ? null : projectId;
		this.render();
	}

	private setProjectColor(projectId: string, color: string | null): void {
		const project = this.projects.find((entry) => entry.id === projectId);
		if (!project) return;
		project.color = color ?? stringToColor(project.name);
		this.openProjectMenuId = null;
		this.persistProjects();
		this.render();
	}

	private toggleProjectPinned(projectId: string): void {
		const index = this.projects.findIndex((entry) => entry.id === projectId);
		if (index === -1) return;
		const project = this.projects[index];
		const nextPinned = !project.pinned;
		this.projects.splice(index, 1);
		project.pinned = nextPinned;
		if (nextPinned) {
			const pinnedCount = this.projects.filter((entry) => entry.pinned).length;
			this.projects.splice(pinnedCount, 0, project);
		} else {
			const pinnedCount = this.projects.filter((entry) => entry.pinned).length;
			this.projects.splice(pinnedCount, 0, project);
		}
		this.sortProjectsInPlace();
		this.cancelProjectPointerDrag(false);
		this.openProjectMenuId = null;
		this.persistProjects();
		this.render();
	}

	private renameProject(projectId: string): void {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		const nextName = window.prompt("Rename project", project.name)?.trim();
		if (!nextName || nextName === project.name) {
			this.openProjectMenuId = null;
			this.render();
			return;
		}

		project.name = nextName;
		this.persistProjects();
		this.openProjectMenuId = null;
		this.render();

		if (this.activeProjectId === project.id) {
			this.onProjectSelect?.({ id: project.id, name: project.name, path: project.path });
		}
	}

	private removeProject(projectId: string): void {
		this.projects = this.projects.filter((p) => p.id !== projectId);
		this.fileTrees.delete(projectId);
		this.fileTreeErrors.delete(projectId);
		this.openProjectMenuId = this.openProjectMenuId === projectId ? null : this.openProjectMenuId;

		if (this.activeProjectId === projectId) {
			this.activeProjectId = this.projects[0]?.id ?? null;
			const next = this.projects[0];
			if (next) {
				this.onProjectSelect?.({ id: next.id, name: next.name, path: next.path });
			} else {
				this.onProjectSelect?.(null);
			}
		}
		this.persistProjects();
		this.render();
	}

	private triggerNewSessionForActiveProject(): void {
		const project = this.getActiveProject();
		if (!project) return;
		this.onNewSessionInProject?.(project);
		setTimeout(() => {
			void this.loadSessionsForProject(project.id, { silent: true });
		}, 900);
	}

	private triggerNewFileForActiveProject(): void {
		const project = this.getActiveProject();
		if (!project) return;
		this.onNewFileInProject?.(project);
	}

	private persistProjects(): void {
		const data: PersistedProject[] = this.projects.map((p) => ({
			id: p.id,
			path: p.path,
			name: p.name,
			color: p.color,
			emoji: normalizeProjectEmoji(p.emoji),
			pinned: p.pinned,
		}));
		localStorage.setItem(this.storageKey, JSON.stringify(data));
	}

	private loadPersistedProjects(): void {
		try {
			let raw = localStorage.getItem(this.storageKey);

			// one-time migration path for first/default workspace
			if (!raw && this.storageKey === workspaceStorageKey("workspace_default")) {
				raw = localStorage.getItem(LEGACY_STORAGE_KEY);
				if (raw) {
					localStorage.setItem(this.storageKey, raw);
				}
			}

			if (!raw) {
				this.projects = [];
				this.activeProjectId = null;
				this.activeSessionPath = null;
				return;
			}

			const data = JSON.parse(raw) as PersistedProject[];
			const seenPaths = new Set<string>();
			this.projects = data
				.filter((p) => typeof p.path === "string" && p.path.trim().length > 0)
				.filter((p) => {
					const key = normalizePath(p.path);
					if (!key || seenPaths.has(key)) return false;
					seenPaths.add(key);
					return true;
				})
				.map((p, idx) => ({
					id: p.id,
					path: p.path,
					name: p.name,
					color: typeof p.color === "string" && p.color.trim().length > 0 ? p.color : stringToColor(p.name || pathBaseName(p.path)),
					emoji: normalizeProjectEmoji(p.emoji),
					pinned: Boolean(p.pinned),
					expanded: idx === 0,
					sessions: [],
					loadingSessions: false,
					sessionsLoaded: false,
					lastSessionsLoadedAt: 0,
					pathExists: null,
					checkingPath: false,
				}));
			this.sortProjectsInPlace();
			this.activeProjectId = this.projects[0]?.id ?? null;
		} catch {
			this.projects = [];
			this.activeProjectId = null;
			this.activeSessionPath = null;
		}
	}

	private normalizeProjectGrouping(): void {
		const pinned = this.projects.filter((project) => project.pinned);
		const unpinned = this.projects.filter((project) => !project.pinned);
		this.projects = [...pinned, ...unpinned];
	}

	private sortProjectsInPlace(): void {
		this.normalizeProjectGrouping();
	}

	private filteredProjects(includeQuery = true): Project[] {
		const q = this.query.trim().toLowerCase();
		let list = this.projects;

		if (includeQuery && q) {
			list = list.filter((project) => {
				if (`${project.name} ${project.path}`.toLowerCase().includes(q)) return true;
				return project.sessions.some((session) => `${session.name} ${session.path}`.toLowerCase().includes(q));
			});
		}

		return [...list];
	}

	private sortedSessions(sessions: SidebarSession[]): SidebarSession[] {
		const sorted = [...sessions];
		sorted.sort((a, b) => {
			const aTs = this.sessionSortBy === "created" ? a.createdAt || a.modifiedAt : a.modifiedAt || a.createdAt;
			const bTs = this.sessionSortBy === "created" ? b.createdAt || b.modifiedAt : b.modifiedAt || b.createdAt;
			return bTs - aTs || a.name.localeCompare(b.name);
		});
		return sorted;
	}

	private visibleSessions(project: Project): SidebarSession[] {
		const q = this.query.trim().toLowerCase();
		let sessions = project.sessions.filter((session) => !this.suppressedSessionPaths.has(normalizePath(session.path)));
		const transientDraft =
			this.transientSessionDraft && this.transientSessionDraft.projectId === project.id
				? ({
					id: `transient_${project.id}`,
					name: this.transientSessionDraft.name,
					path: this.transientSessionDraft.path ?? "",
					createdAt: this.transientSessionDraft.createdAt,
					modifiedAt: this.transientSessionDraft.createdAt,
					tokens: 0,
					cost: 0,
					optimistic: true,
					transient: true,
				} satisfies SidebarSession)
				: null;
		if (transientDraft) {
			const transientPath = normalizePath(transientDraft.path);
			sessions = [
				transientDraft,
				...sessions.filter((session) => normalizePath(session.path) !== transientPath || !transientPath),
			];
		}
		if (q) {
			sessions = sessions.filter((session) => `${session.name} ${session.path}`.toLowerCase().includes(q));
		}
		sessions = this.sortedSessions(sessions);
		if (this.sessionShow === "all" || q) return sessions;

		const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 14;
		const recent = sessions.filter((session) => session.transient || (session.modifiedAt || session.createdAt || 0) >= cutoff);
		if (recent.length > 0) return recent;
		return sessions.slice(0, 5);
	}

	private chronologicalSessions(projects: Project[]): Array<{ project: Project; session: SidebarSession }> {
		const list: Array<{ project: Project; session: SidebarSession }> = [];
		for (const project of projects) {
			for (const session of this.visibleSessions(project)) {
				list.push({ project, session });
			}
		}
		list.sort((a, b) => {
			const aTs = this.sessionSortBy === "created"
				? a.session.createdAt || a.session.modifiedAt
				: a.session.modifiedAt || a.session.createdAt;
			const bTs = this.sessionSortBy === "created"
				? b.session.createdAt || b.session.modifiedAt
				: b.session.modifiedAt || b.session.createdAt;
			return bTs - aTs || a.project.name.localeCompare(b.project.name);
		});
		return list;
	}

	private compareFileNodes(a: FileNode, b: FileNode): number {
		if (this.fileKind === "all" && a.isDirectory !== b.isDirectory) {
			return a.isDirectory ? -1 : 1;
		}
		const cmp = a.name.localeCompare(b.name);
		return this.fileSort === "nameDesc" ? -cmp : cmp;
	}

	private nodeMatchesQuery(node: FileNode, query: string): boolean {
		const textMatches = !query || node.name.toLowerCase().includes(query);

		const typeMatches =
			this.fileKind === "all" ||
			(this.fileKind === "dirs" && node.isDirectory) ||
			(this.fileKind === "files" && !node.isDirectory);

		if (textMatches && typeMatches) return true;
		if (!node.isDirectory) return false;

		if (!node.children) {
			return this.fileKind === "files" || (this.fileKind === "dirs" && textMatches);
		}

		return node.children.some((child) => this.nodeMatchesQuery(child, query));
	}

	private renderFileIcon(node: FileNode): TemplateResult {
		if (node.isDirectory) {
			return html`
				<span class="sidebar-file-icon folder-icon ${node.expanded ? "open" : ""}">
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path class="folder-tab" d="M1.8 4.8h4l1.2 1.4H14a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5.8a1 1 0 0 1 .8-1z" />
						<path class="folder-body" d="M1.8 5.8h12.3a.9.9 0 0 1 .9.9v5.1a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6.7a.9.9 0 0 1 .8-.9z" />
					</svg>
				</span>
			`;
		}

		const kind = fileIconKind(node.name);
		return html`
			<span class="sidebar-file-icon file-icon kind-${kind} ${node.isSymlink ? "symlink" : ""}">
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path class="file-shell" d="M4 1.7h5.2L13 5.5v8.6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.7a1 1 0 0 1 1-1z" />
					<path class="file-fold" d="M9.2 1.7v3.2a.6.6 0 0 0 .6.6H13" />
					<rect class="file-accent" x="4.9" y="10.7" width="6.2" height="1.5" rx="0.75" />
					${node.isSymlink ? html`<path class="file-link" d="M6.1 8.4h3.8M8.6 7l1.3 1.4L8.6 9.8" />` : nothing}
				</svg>
			</span>
		`;
	}

	private renderFileNode(projectId: string, node: FileNode, query: string): TemplateResult | typeof nothing {
		if (!this.nodeMatchesQuery(node, query)) return nothing;
		const indent = node.depth * 14;
		const activeFile = !node.isDirectory && normalizePath(node.path) === this.activeFilePath;
		const fileRenameActive =
			!node.isDirectory &&
			Boolean(this.fileRenameDraft) &&
			this.fileRenameDraft?.projectId === projectId &&
			this.fileRenameDraft?.filePath === normalizePath(node.path);

		return html`
			<div>
				<div class="sidebar-file-row ${node.isDirectory ? "dir" : "file"}" style=${`--indent:${indent}px`}>
					<button
						class="sidebar-file-main ${activeFile ? "active-file" : ""}"
						@click=${() => {
							if (node.isDirectory) {
								void this.toggleDirectory(projectId, node);
							} else {
								if (fileRenameActive) return;
								this.selectProject(projectId, false);
								this.activeSessionPath = null;
								this.activeFilePath = normalizePath(node.path);
								this.render();
								this.openFile(projectId, node.path);
							}
						}}
						@contextmenu=${(e: MouseEvent) => this.handleFileContextMenu(e, projectId, node)}
						title=${node.displayPath}
					>
						<span class="sidebar-file-caret">${node.isDirectory ? (node.expanded ? "▾" : "▸") : ""}</span>
						${this.renderFileIcon(node)}
						${fileRenameActive
							? html`
								<input
									class="sidebar-inline-input sidebar-file-inline-input"
									.value=${this.fileRenameDraft?.value ?? node.name}
									@click=${(e: Event) => e.stopPropagation()}
									@input=${(e: Event) => {
										const target = e.target as HTMLInputElement;
										if (!this.fileRenameDraft) return;
										this.fileRenameDraft = { ...this.fileRenameDraft, value: target.value };
									}}
									@keydown=${(e: KeyboardEvent) => {
										if (e.key === "Enter") {
											e.preventDefault();
											void this.commitFileRename(projectId, node);
											return;
										}
										if (e.key === "Escape") {
											e.preventDefault();
											this.cancelFileRename();
										}
									}}
									@blur=${() => void this.commitFileRename(projectId, node)}
									autofocus
								/>
							`
							: html`<span class="sidebar-file-name">${node.name}</span>`}
					</button>
				</div>
				${node.loading
					? html`<div class="sidebar-file-loading" style=${`--indent:${indent + 28}px`}>Loading…</div>`
					: nothing}
				${node.expanded && node.loadError
					? html`<div class="sidebar-file-empty" style=${`--indent:${indent + 28}px`}>Cannot read folder</div>`
					: nothing}
				${node.expanded && !node.loadError && node.children && node.children.length === 0
					? html`<div class="sidebar-file-empty" style=${`--indent:${indent + 28}px`}>Empty</div>`
					: nothing}
				${node.expanded && !node.loadError && node.children && node.children.length > 0
					? html`${[...node.children].sort((a, b) => this.compareFileNodes(a, b)).map((child) => this.renderFileNode(projectId, child, query))}`
					: nothing}
			</div>
		`;
	}

	private renderProjectMarker(project: Project): TemplateResult {
		return html`<span class="sidebar-project-leading-emoji">${normalizeProjectEmoji(project.emoji)}</span>`;
	}

	private getProjectAttentionCount(project: Project): number {
		let count = 0;
		for (const session of project.sessions) {
			if (this.attentionSessionMessages.has(normalizePath(session.path))) {
				count += 1;
			}
		}
		return count;
	}

	private openProjectEmojiPicker(projectId: string, event: MouseEvent): void {
		event.stopPropagation();
		if (this.projectEmojiPickerProjectId === projectId) {
			this.closeProjectEmojiPicker();
			return;
		}
		const target = event.currentTarget as HTMLElement | null;
		const rect = target?.getBoundingClientRect();
		const anchorLeft = rect?.left ?? event.clientX;
		const anchorBottom = rect?.bottom ?? event.clientY;
		const pad = 10;
		const pickerWidth = 272;
		const pickerHeight = 332;
		this.openProjectMenuId = null;
		this.projectEmojiPickerProjectId = projectId;
		this.projectEmojiSearchQuery = "";
		this.projectEmojiPickerX = Math.min(Math.max(pad, anchorLeft - 8), Math.max(pad, window.innerWidth - pickerWidth - pad));
		this.projectEmojiPickerY = Math.min(Math.max(pad, anchorBottom + 8), Math.max(pad, window.innerHeight - pickerHeight - pad));
		this.render();
		requestAnimationFrame(() => {
			const input = this.container.querySelector<HTMLInputElement>(`.project-emoji-search[data-project-id="${projectId}"]`);
			input?.focus();
			input?.select();
		});
	}

	private closeProjectEmojiPicker(shouldRender = true): void {
		if (!this.projectEmojiPickerProjectId) return;
		this.projectEmojiPickerProjectId = null;
		this.projectEmojiSearchQuery = "";
		if (shouldRender) this.render();
	}

	private filteredProjectEmojis(): typeof EMOJI_CATALOG {
		const query = this.projectEmojiSearchQuery.trim().toLowerCase();
		if (!query) return EMOJI_CATALOG;
		return EMOJI_CATALOG.filter((entry) => entry.search.includes(query));
	}

	private applyProjectEmoji(projectId: string, emoji: string | null): void {
		const project = this.projects.find((entry) => entry.id === projectId);
		if (!project) return;
		project.emoji = normalizeProjectEmoji(emoji);
		this.persistProjects();
		this.closeProjectEmojiPicker();
	}

	private readonly onProjectDragPointerMove = (event: PointerEvent): void => {
		if (event.pointerId !== this.projectDragPointerId) return;
		if (!this.pendingProjectDragId) return;

		event.preventDefault();

		if (!this.draggingProjectId) {
			if (Math.abs(event.clientY - this.projectDragStartY) < WORKSPACE_DRAG_THRESHOLD_PX) {
				return;
			}
			this.draggingProjectId = this.pendingProjectDragId;
			this.projectDragOverId = this.pendingProjectDragId;
			this.render();
		}

		const draggedProjectId = this.draggingProjectId;
		if (!draggedProjectId) return;
		const hoveredProjectId = this.resolveProjectIdFromPoint(event.clientX, event.clientY, draggedProjectId);
		if (!hoveredProjectId || hoveredProjectId === this.projectDragOverId) return;
		this.projectDragOverId = hoveredProjectId;
		this.render();
	};

	private readonly onProjectDragPointerEnd = (event: PointerEvent): void => {
		if (event.pointerId !== this.projectDragPointerId) return;
		event.preventDefault();
		this.finishProjectPointerDrag(true);
	};

	private beginProjectPointerDrag(event: PointerEvent, projectId: string): void {
		if (event.button !== 0) return;
		this.pendingProjectDragId = projectId;
		this.projectDragPointerId = event.pointerId;
		this.projectDragStartY = event.clientY;
		this.projectDragOverId = projectId;
		window.addEventListener("pointermove", this.onProjectDragPointerMove, true);
		window.addEventListener("pointerup", this.onProjectDragPointerEnd, true);
		window.addEventListener("pointercancel", this.onProjectDragPointerEnd, true);
	}

	private isCompatibleProjectDropTarget(draggedProjectId: string, targetProjectId: string): boolean {
		const dragged = this.projects.find((project) => project.id === draggedProjectId) ?? null;
		const target = this.projects.find((project) => project.id === targetProjectId) ?? null;
		if (!dragged || !target) return false;
		return Boolean(dragged.pinned) === Boolean(target.pinned);
	}

	private resolveProjectIdFromPoint(clientX: number, clientY: number, draggedProjectId: string): string | null {
		const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
		const directRow = target?.closest<HTMLElement>(".sidebar-project-row[data-project-id]");
		if (directRow?.dataset.projectId) {
			return this.isCompatibleProjectDropTarget(draggedProjectId, directRow.dataset.projectId)
				? directRow.dataset.projectId
				: null;
		}

		const list = this.container.querySelector<HTMLElement>(".sidebar-project-list");
		if (!list) return null;
		const rows = [...list.querySelectorAll<HTMLElement>(".sidebar-project-row[data-project-id]")];
		if (rows.length === 0) return null;
		const compatibleRows = rows.filter((row) => {
			const projectId = row.dataset.projectId;
			if (!projectId) return false;
			return this.isCompatibleProjectDropTarget(draggedProjectId, projectId);
		});
		if (compatibleRows.length === 0) return null;
		const listRect = list.getBoundingClientRect();
		if (clientY < listRect.top) {
			return compatibleRows[0]?.dataset.projectId ?? null;
		}
		if (clientY > listRect.bottom) {
			return compatibleRows[compatibleRows.length - 1]?.dataset.projectId ?? null;
		}

		let nearestProjectId: string | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const row of compatibleRows) {
			const rowRect = row.getBoundingClientRect();
			const center = rowRect.top + rowRect.height / 2;
			const distance = Math.abs(clientY - center);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestProjectId = row.dataset.projectId ?? null;
			}
		}
		return nearestProjectId;
	}

	private applyProjectReorderByIds(draggedProjectId: string, targetProjectId: string): void {
		const fromIndex = this.projects.findIndex((project) => project.id === draggedProjectId);
		const toIndex = this.projects.findIndex((project) => project.id === targetProjectId);
		if (
			fromIndex === -1 ||
			toIndex === -1 ||
			fromIndex === toIndex ||
			!this.isCompatibleProjectDropTarget(draggedProjectId, targetProjectId)
		) {
			this.draggingProjectId = null;
			this.projectDragOverId = null;
			this.projectDragSuppressClickUntil = Date.now() + 180;
			this.render();
			return;
		}

		const ordered = [...this.projects];
		const [moved] = ordered.splice(fromIndex, 1);
		if (!moved) {
			this.draggingProjectId = null;
			this.projectDragOverId = null;
			this.projectDragSuppressClickUntil = Date.now() + 180;
			this.render();
			return;
		}
		ordered.splice(toIndex, 0, moved);
		this.projects = ordered;
		this.draggingProjectId = null;
		this.projectDragOverId = null;
		this.projectDragSuppressClickUntil = Date.now() + 220;
		this.persistProjects();
		this.render();
	}

	private finishProjectPointerDrag(commitReorder: boolean): void {
		window.removeEventListener("pointermove", this.onProjectDragPointerMove, true);
		window.removeEventListener("pointerup", this.onProjectDragPointerEnd, true);
		window.removeEventListener("pointercancel", this.onProjectDragPointerEnd, true);

		const draggedProjectId = this.draggingProjectId;
		const targetProjectId = this.projectDragOverId;
		const hadDragState = Boolean(this.pendingProjectDragId || this.draggingProjectId || this.projectDragOverId);

		this.pendingProjectDragId = null;
		this.projectDragPointerId = null;
		this.projectDragStartY = 0;

		if (commitReorder && draggedProjectId && targetProjectId && draggedProjectId !== targetProjectId) {
			this.applyProjectReorderByIds(draggedProjectId, targetProjectId);
			return;
		}

		if (draggedProjectId) {
			this.projectDragSuppressClickUntil = Date.now() + 180;
		}
		this.draggingProjectId = null;
		this.projectDragOverId = null;
		if (hadDragState) {
			this.render();
		}
	}

	private cancelProjectPointerDrag(shouldRender = true): void {
		const hadDragState = Boolean(this.pendingProjectDragId || this.draggingProjectId || this.projectDragOverId || this.projectDragPointerId);
		window.removeEventListener("pointermove", this.onProjectDragPointerMove, true);
		window.removeEventListener("pointerup", this.onProjectDragPointerEnd, true);
		window.removeEventListener("pointercancel", this.onProjectDragPointerEnd, true);
		this.pendingProjectDragId = null;
		this.projectDragPointerId = null;
		this.projectDragStartY = 0;
		this.draggingProjectId = null;
		this.projectDragOverId = null;
		if (hadDragState && shouldRender) {
			this.render();
		}
	}

	private shouldSuppressProjectMainClick(projectId: string): boolean {
		if (this.draggingProjectId === projectId) return true;
		if (Date.now() <= this.projectDragSuppressClickUntil) {
			return true;
		}
		return false;
	}

	private getActiveWorkspaceItem(): SidebarWorkspaceItem | null {
		if (this.workspaces.length === 0) return null;
		if (this.activeWorkspaceId) {
			const match = this.workspaces.find((workspace) => workspace.id === this.activeWorkspaceId) ?? null;
			if (match) return match;
		}
		return this.workspaces[0] ?? null;
	}

	private focusWorkspaceRenameInput(workspaceId: string): void {
		requestAnimationFrame(() => {
			const input = this.container.querySelector<HTMLInputElement>(`.sidebar-workspace-title-input[data-workspace-id="${workspaceId}"]`);
			input?.focus();
			input?.select();
		});
	}

	private startWorkspaceRename(workspaceId: string): void {
		const workspace = this.workspaces.find((entry) => entry.id === workspaceId) ?? null;
		if (!workspace) return;
		this.workspaceCreateDialogOpen = false;
		this.workspaceCreateEmojiPickerOpen = false;
		this.workspaceCreateEmojiQuery = "";
		this.workspaceRenameDraft = { workspaceId, value: workspace.title };
		if (this.activeWorkspaceId !== workspaceId) {
			this.onWorkspaceSelect?.(workspaceId);
		}
		this.workspaceMenuOpen = false;
		this.render();
		this.focusWorkspaceRenameInput(workspaceId);
	}

	private commitWorkspaceRename(): void {
		const draft = this.workspaceRenameDraft;
		if (!draft) return;
		const workspace = this.workspaces.find((entry) => entry.id === draft.workspaceId) ?? null;
		const nextTitle = draft.value.trim();
		this.workspaceRenameDraft = null;
		if (workspace && nextTitle && nextTitle !== workspace.title) {
			this.onWorkspaceRename?.(workspace.id, nextTitle);
			return;
		}
		this.render();
	}

	private cancelWorkspaceRename(): void {
		if (!this.workspaceRenameDraft) return;
		this.workspaceRenameDraft = null;
		this.render();
	}

	private nextWorkspaceDraftName(): string {
		const used = new Set<number>();
		for (const workspace of this.workspaces) {
			const match = /^Workspace\s+(\d+)$/i.exec(workspace.title.trim());
			if (match) {
				used.add(Number(match[1]));
			}
		}
		let idx = 1;
		while (used.has(idx)) idx += 1;
		return `Workspace ${idx}`;
	}

	private openWorkspaceCreateDialog(): void {
		this.workspaceRenameDraft = null;
		this.workspaceCreateDialogOpen = true;
		this.workspaceCreateName = this.nextWorkspaceDraftName();
		this.workspaceCreateEmoji = "✨";
		this.workspaceCreateEmojiPickerOpen = false;
		this.workspaceCreateEmojiQuery = "";
		this.workspaceMenuOpen = false;
		this.closeWorkspaceEmojiPicker(false);
		this.closeContextMenu(false);
		this.render();
		requestAnimationFrame(() => {
			const input = this.container.querySelector<HTMLInputElement>(".sidebar-space-name-input");
			input?.focus();
			input?.select();
		});
	}

	private closeWorkspaceCreateDialog(shouldRender = true): void {
		if (!this.workspaceCreateDialogOpen) return;
		this.workspaceCreateDialogOpen = false;
		this.workspaceCreateEmojiPickerOpen = false;
		this.workspaceCreateEmojiQuery = "";
		if (shouldRender) this.render();
	}

	private filteredWorkspaceCreateEmojis(): typeof EMOJI_CATALOG {
		const query = this.workspaceCreateEmojiQuery.trim().toLowerCase();
		if (!query) return EMOJI_CATALOG;
		return EMOJI_CATALOG.filter((entry) => entry.search.includes(query));
	}

	private createWorkspaceFromDialog(): void {
		const title = this.workspaceCreateName.trim() || this.nextWorkspaceDraftName();
		const emoji = this.workspaceCreateEmoji.trim() || "✨";
		this.closeWorkspaceCreateDialog(false);
		this.onWorkspaceCreate?.({ title, emoji });
		this.render();
	}

	private toggleWorkspaceMenu(nextOpen?: boolean): void {
		const open = typeof nextOpen === "boolean" ? nextOpen : !this.workspaceMenuOpen;
		if (this.workspaceMenuOpen === open) return;
		this.workspaceMenuOpen = open;
		if (!open) {
			this.cancelWorkspacePointerDrag(false);
			this.closeWorkspaceEmojiPicker(false);
		}
		this.render();
	}

	private openWorkspaceEmojiPicker(workspaceId: string, event: MouseEvent): void {
		event.stopPropagation();
		if (this.emojiPickerWorkspaceId === workspaceId) {
			this.closeWorkspaceEmojiPicker();
			return;
		}
		const target = event.currentTarget as HTMLElement | null;
		const rect = target?.getBoundingClientRect();
		const anchorLeft = rect?.left ?? event.clientX;
		const anchorBottom = rect?.bottom ?? event.clientY;
		const pad = 10;
		const pickerWidth = 272;
		const pickerHeight = 332;
		this.emojiPickerWorkspaceId = workspaceId;
		this.emojiSearchQuery = "";
		this.emojiPickerX = Math.min(Math.max(pad, anchorLeft - 8), Math.max(pad, window.innerWidth - pickerWidth - pad));
		this.emojiPickerY = Math.min(Math.max(pad, anchorBottom + 8), Math.max(pad, window.innerHeight - pickerHeight - pad));
		this.render();
		requestAnimationFrame(() => {
			const input = this.container.querySelector<HTMLInputElement>(`.workspace-emoji-search[data-workspace-id="${workspaceId}"]`);
			input?.focus();
			input?.select();
		});
	}

	private closeWorkspaceEmojiPicker(shouldRender = true): void {
		if (!this.emojiPickerWorkspaceId) return;
		this.emojiPickerWorkspaceId = null;
		this.emojiSearchQuery = "";
		if (shouldRender) this.render();
	}

	private filteredWorkspaceEmojis(): typeof EMOJI_CATALOG {
		const query = this.emojiSearchQuery.trim().toLowerCase();
		if (!query) return EMOJI_CATALOG;
		return EMOJI_CATALOG.filter((entry) => entry.search.includes(query));
	}

	private applyWorkspaceEmoji(workspaceId: string, emoji: string | null): void {
		this.onWorkspaceEmoji?.(workspaceId, emoji);
		this.closeWorkspaceEmojiPicker();
	}

	private readonly onWorkspaceDragPointerMove = (event: PointerEvent): void => {
		if (event.pointerId !== this.workspaceDragPointerId) return;
		if (!this.pendingWorkspaceDragId) return;

		let startedDrag = false;
		if (!this.draggingWorkspaceId) {
			const distance = Math.hypot(event.clientX - this.workspaceDragStartX, event.clientY - this.workspaceDragStartY);
			if (distance < WORKSPACE_DRAG_THRESHOLD_PX) {
				return;
			}
			this.draggingWorkspaceId = this.pendingWorkspaceDragId;
			this.workspaceDragOverId = this.pendingWorkspaceDragId;
			startedDrag = true;
		}

		event.preventDefault();
		if (!this.draggingWorkspaceId) return;
		if (this.workspaceCreateDialogOpen) {
			this.workspaceCreateDialogOpen = false;
			this.workspaceCreateEmojiPickerOpen = false;
		}
		if (startedDrag) {
			this.render();
		}

		const draggedWorkspaceId = this.draggingWorkspaceId;
		if (!draggedWorkspaceId) return;
		const hoveredWorkspaceId = this.resolveWorkspaceIdFromPoint(event.clientX, event.clientY, draggedWorkspaceId);
		if (!hoveredWorkspaceId || hoveredWorkspaceId === this.workspaceDragOverId) return;
		this.workspaceDragOverId = hoveredWorkspaceId;
		this.render();
	};

	private readonly onWorkspaceDragPointerEnd = (event: PointerEvent): void => {
		if (event.pointerId !== this.workspaceDragPointerId) return;
		event.preventDefault();
		this.finishWorkspacePointerDrag(true);
	};

	private beginWorkspacePointerDrag(event: PointerEvent, workspaceId: string): void {
		if (event.button !== 0) return;
		this.pendingWorkspaceDragId = workspaceId;
		this.workspaceDragPointerId = event.pointerId;
		this.workspaceDragStartX = event.clientX;
		this.workspaceDragStartY = event.clientY;
		this.workspaceDragOverId = workspaceId;
		window.addEventListener("pointermove", this.onWorkspaceDragPointerMove, true);
		window.addEventListener("pointerup", this.onWorkspaceDragPointerEnd, true);
		window.addEventListener("pointercancel", this.onWorkspaceDragPointerEnd, true);
	}

	private isCompatibleWorkspaceDropTarget(draggedWorkspaceId: string, targetWorkspaceId: string): boolean {
		const dragged = this.workspaces.find((workspace) => workspace.id === draggedWorkspaceId) ?? null;
		const target = this.workspaces.find((workspace) => workspace.id === targetWorkspaceId) ?? null;
		return Boolean(dragged && target);
	}

	private resolveWorkspaceIdFromPoint(clientX: number, clientY: number, draggedWorkspaceId: string): string | null {
		const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
		const directPill = target?.closest<HTMLElement>(".sidebar-workspace-pill[data-workspace-id]");
		if (directPill?.dataset.workspaceId) {
			return this.isCompatibleWorkspaceDropTarget(draggedWorkspaceId, directPill.dataset.workspaceId)
				? directPill.dataset.workspaceId
				: null;
		}

		const list = this.container.querySelector<HTMLElement>(".sidebar-workspace-dock-list");
		if (!list) return null;
		const pills = [...list.querySelectorAll<HTMLElement>(".sidebar-workspace-pill[data-workspace-id]")];
		if (pills.length === 0) return null;
		const compatiblePills = pills.filter((pill) => {
			const workspaceId = pill.dataset.workspaceId;
			if (!workspaceId) return false;
			return this.isCompatibleWorkspaceDropTarget(draggedWorkspaceId, workspaceId);
		});
		if (compatiblePills.length === 0) return null;
		const listRect = list.getBoundingClientRect();
		if (clientX < listRect.left) {
			return compatiblePills[0]?.dataset.workspaceId ?? null;
		}
		if (clientX > listRect.right) {
			return compatiblePills[compatiblePills.length - 1]?.dataset.workspaceId ?? null;
		}

		let nearestWorkspaceId: string | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const pill of compatiblePills) {
			const pillRect = pill.getBoundingClientRect();
			const center = pillRect.left + pillRect.width / 2;
			const distance = Math.abs(clientX - center);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestWorkspaceId = pill.dataset.workspaceId ?? null;
			}
		}
		return nearestWorkspaceId;
	}

	private applyWorkspaceReorderByIds(draggedWorkspaceId: string, targetWorkspaceId: string): void {
		const fromIndex = this.workspaces.findIndex((workspace) => workspace.id === draggedWorkspaceId);
		const toIndex = this.workspaces.findIndex((workspace) => workspace.id === targetWorkspaceId);
		if (
			fromIndex === -1 ||
			toIndex === -1 ||
			fromIndex === toIndex ||
			!this.isCompatibleWorkspaceDropTarget(draggedWorkspaceId, targetWorkspaceId)
		) {
			this.draggingWorkspaceId = null;
			this.workspaceDragOverId = null;
			this.workspaceDragSuppressClickUntil = Date.now() + 180;
			this.render();
			return;
		}

		const ordered = [...this.workspaces];
		const [moved] = ordered.splice(fromIndex, 1);
		if (!moved) {
			this.draggingWorkspaceId = null;
			this.workspaceDragOverId = null;
			this.workspaceDragSuppressClickUntil = Date.now() + 180;
			this.render();
			return;
		}
		ordered.splice(toIndex, 0, moved);
		this.workspaces = ordered;
		this.draggingWorkspaceId = null;
		this.workspaceDragOverId = null;
		this.workspaceDragSuppressClickUntil = Date.now() + 220;
		this.onWorkspaceReorder?.(ordered.map((workspace) => workspace.id));
		this.render();
	}

	private finishWorkspacePointerDrag(commitReorder: boolean): void {
		window.removeEventListener("pointermove", this.onWorkspaceDragPointerMove, true);
		window.removeEventListener("pointerup", this.onWorkspaceDragPointerEnd, true);
		window.removeEventListener("pointercancel", this.onWorkspaceDragPointerEnd, true);

		const draggedWorkspaceId = this.draggingWorkspaceId;
		const targetWorkspaceId = this.workspaceDragOverId;
		const hadDragState = Boolean(this.pendingWorkspaceDragId || this.draggingWorkspaceId || this.workspaceDragOverId);

		this.pendingWorkspaceDragId = null;
		this.workspaceDragPointerId = null;
		this.workspaceDragStartX = 0;
		this.workspaceDragStartY = 0;

		if (commitReorder && draggedWorkspaceId && targetWorkspaceId && draggedWorkspaceId !== targetWorkspaceId) {
			this.applyWorkspaceReorderByIds(draggedWorkspaceId, targetWorkspaceId);
			return;
		}

		if (draggedWorkspaceId) {
			this.workspaceDragSuppressClickUntil = Date.now() + 180;
		}
		this.draggingWorkspaceId = null;
		this.workspaceDragOverId = null;
		if (hadDragState) {
			this.render();
		}
	}

	private cancelWorkspacePointerDrag(shouldRender = true): void {
		const hadDragState = Boolean(this.pendingWorkspaceDragId || this.draggingWorkspaceId || this.workspaceDragOverId || this.workspaceDragPointerId);
		window.removeEventListener("pointermove", this.onWorkspaceDragPointerMove, true);
		window.removeEventListener("pointerup", this.onWorkspaceDragPointerEnd, true);
		window.removeEventListener("pointercancel", this.onWorkspaceDragPointerEnd, true);
		this.pendingWorkspaceDragId = null;
		this.workspaceDragPointerId = null;
		this.workspaceDragStartX = 0;
		this.workspaceDragStartY = 0;
		this.draggingWorkspaceId = null;
		this.workspaceDragOverId = null;
		if (hadDragState && shouldRender) {
			this.render();
		}
	}

	private shouldSuppressWorkspaceRowClick(): boolean {
		if (Date.now() <= this.workspaceDragSuppressClickUntil) {
			return true;
		}
		return false;
	}

	private shouldHandleWorkspaceSwipe(target: HTMLElement | null): boolean {
		if (!target) return false;
		if (this.workspaceCreateDialogOpen || this.contextMenu || this.emojiPickerWorkspaceId || this.projectEmojiPickerProjectId) {
			return false;
		}
		if (target.closest("button, input, textarea, select, a, [contenteditable='true']")) return false;
		if (target.closest(".sidebar-context-menu, .workspace-emoji-picker, .sidebar-space-dialog, .sidebar-mode-filter-menu")) return false;
		return Boolean(target.closest(".sidebar-single"));
	}

	private switchWorkspaceByOffset(offset: 1 | -1): void {
		if (this.workspaces.length <= 1) return;
		const activeIndex = this.workspaces.findIndex((workspace) => workspace.id === this.activeWorkspaceId);
		if (activeIndex === -1) return;
		const nextIndex = (activeIndex + offset + this.workspaces.length) % this.workspaces.length;
		const nextWorkspace = this.workspaces[nextIndex] ?? null;
		if (!nextWorkspace || nextWorkspace.id === this.activeWorkspaceId) return;
		this.onWorkspaceSelect?.(nextWorkspace.id);
	}

	private handleSidebarWheel(event: WheelEvent): void {
		if (event.defaultPrevented) return;
		if (this.workspaces.length <= 1) return;
		if (this.pendingWorkspaceDragId || this.draggingWorkspaceId) return;
		if (!this.shouldHandleWorkspaceSwipe(event.target as HTMLElement | null)) {
			this.workspaceSwipeAccumulatorX = 0;
			return;
		}

		const deltaX = event.deltaX;
		const deltaY = event.deltaY;
		if (Math.abs(deltaX) < Math.max(10, Math.abs(deltaY) * 1.1)) {
			return;
		}

		const now = Date.now();
		if (now - this.workspaceSwipeLastInputAt > WORKSPACE_SWIPE_IDLE_MS) {
			this.workspaceSwipeAccumulatorX = 0;
		}
		this.workspaceSwipeLastInputAt = now;
		this.workspaceSwipeAccumulatorX += deltaX;

		if (Math.abs(this.workspaceSwipeAccumulatorX) < WORKSPACE_SWIPE_THRESHOLD_PX) {
			return;
		}
		if (now - this.workspaceSwipeLastSwitchAt < WORKSPACE_SWIPE_COOLDOWN_MS) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();

		const direction: 1 | -1 = this.workspaceSwipeAccumulatorX > 0 ? 1 : -1;
		this.workspaceSwipeAccumulatorX = 0;
		this.workspaceSwipeLastSwitchAt = now;
		this.switchWorkspaceByOffset(direction);
	}

	private async invokeWindowControl(action: "close" | "minimize" | "maximize"): Promise<void> {
		try {
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			const currentWindow = getCurrentWindow();
			if (action === "close") {
				await currentWindow.close();
				return;
			}
			if (action === "minimize") {
				await currentWindow.minimize();
				return;
			}
			await currentWindow.toggleMaximize();
		} catch {
			// no-op outside Tauri runtime
		}
	}

	private renderWorkspaceSwitcher(): TemplateResult | typeof nothing {
		const activeWorkspace = this.getActiveWorkspaceItem();
		if (!activeWorkspace) return nothing;
		const emojiPickerWorkspace = this.emojiPickerWorkspaceId
			? this.workspaces.find((workspace) => workspace.id === this.emojiPickerWorkspaceId) ?? null
			: null;
		const filteredEmojis = this.filteredWorkspaceEmojis();

		return html`
			<div class="sidebar-workspace-switcher" data-tauri-drag-region>
				<div class="sidebar-workspace-switcher-row" data-tauri-drag-region>
					<div class="sidebar-window-controls" @click=${(e: Event) => e.stopPropagation()}>
						<button class="sidebar-window-dot red" title="Close" @click=${(e: Event) => {
							e.stopPropagation();
							void this.invokeWindowControl("close");
						}}></button>
						<button class="sidebar-window-dot yellow" title="Minimize" @click=${(e: Event) => {
							e.stopPropagation();
							void this.invokeWindowControl("minimize");
						}}></button>
						<button class="sidebar-window-dot green" title="Maximize" @click=${(e: Event) => {
							e.stopPropagation();
							void this.invokeWindowControl("maximize");
						}}></button>
					</div>
					<div
						class="sidebar-workspace-trigger ${this.workspaceMenuOpen ? "open" : ""}"
						title="Switch workspace"
						@contextmenu=${(e: MouseEvent) => this.handleWorkspaceContextMenu(e, activeWorkspace.id)}
					>
						<button
							class="sidebar-workspace-trigger-emoji"
							title="Change workspace emoji"
							@click=${(e: MouseEvent) => this.openWorkspaceEmojiPicker(activeWorkspace.id, e)}
						>
							<span class="sidebar-workspace-avatar">${activeWorkspace.emoji || "💼"}</span>
						</button>
						<button
							class="sidebar-workspace-trigger-main"
							@click=${(e: Event) => {
								e.stopPropagation();
								this.toggleWorkspaceMenu();
							}}
						>
							<span class="sidebar-workspace-trigger-title">${activeWorkspace.title}</span>
						</button>
						<span class="sidebar-workspace-chevron" aria-hidden="true">${this.workspaceMenuOpen ? "▴" : "▾"}</span>
					</div>
					<button
						class="workspace-sidebar-toggle"
						title="Collapse sidebar"
						@click=${(e: Event) => {
							e.stopPropagation();
							this.toggleCollapsed();
						}}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<path d="M3 3.5h10v9H3z" />
							<path d="M6 3.5v9" />
						</svg>
					</button>
				</div>
				${this.workspaceMenuOpen
					? html`
						<div class="sidebar-workspace-menu" @click=${(e: Event) => e.stopPropagation()}>
							<div class="sidebar-workspace-list">
								${this.workspaces.map((workspace, index) => {
									const active = workspace.id === this.activeWorkspaceId;
									const dragOver = workspace.id === this.workspaceDragOverId && this.draggingWorkspaceId !== workspace.id;
									const prevWorkspace = this.workspaces[index - 1] ?? null;
									const showPinnedDivider = Boolean(prevWorkspace?.pinned) && !Boolean(workspace.pinned);
									return html`
										${showPinnedDivider ? html`<div class="sidebar-workspace-pin-divider" role="separator" aria-hidden="true"></div>` : nothing}
										<div
											class="sidebar-workspace-row ${active ? "active" : ""} ${dragOver ? "drag-over" : ""} ${workspace.id === this.draggingWorkspaceId ? "dragging" : ""}"
											data-workspace-id=${workspace.id}
											@contextmenu=${(e: MouseEvent) => this.handleWorkspaceContextMenu(e, workspace.id)}
										>
											<span
												class="sidebar-workspace-grip"
												aria-hidden="true"
												title="Drag to reorder"
												@pointerdown=${(e: PointerEvent) => this.beginWorkspacePointerDrag(e, workspace.id)}
											>⋮⋮</span>
											<button
												class="sidebar-workspace-avatar-btn row"
												title="Change workspace emoji"
												@click=${(e: MouseEvent) => this.openWorkspaceEmojiPicker(workspace.id, e)}
											>
												<span class="sidebar-workspace-avatar">${workspace.emoji || "💼"}</span>
											</button>
											<button
												class="sidebar-workspace-row-main"
												@click=${() => {
													if (this.shouldSuppressWorkspaceRowClick()) return;
													this.toggleWorkspaceMenu(false);
													if (!active) this.onWorkspaceSelect?.(workspace.id);
												}}
											>
												<span class="sidebar-workspace-row-title">${workspace.title}</span>
											</button>
										</div>
									`;
								})}
							</div>
							<div class="sidebar-workspace-menu-divider"></div>
							<button
								class="sidebar-workspace-new"
								@click=${() => {
									this.toggleWorkspaceMenu(false);
									this.onWorkspaceCreate?.();
								}}
							>
								<span class="sidebar-workspace-new-plus" aria-hidden="true">＋</span>
								<span>New workspace</span>
							</button>
						</div>
					`
					: nothing}
				${this.emojiPickerWorkspaceId
					? html`
						<div class="workspace-emoji-picker" style=${`left:${this.emojiPickerX}px;top:${this.emojiPickerY}px`} @click=${(event: Event) => event.stopPropagation()}>
							<input
								class="workspace-emoji-search"
								data-workspace-id=${this.emojiPickerWorkspaceId}
								type="text"
								placeholder="Search emojis"
								.value=${this.emojiSearchQuery}
								@input=${(event: Event) => {
									this.emojiSearchQuery = (event.target as HTMLInputElement).value;
									this.render();
								}}
								@keydown=${(event: KeyboardEvent) => {
									if (event.key === "Escape") {
										event.preventDefault();
										this.closeWorkspaceEmojiPicker();
									}
								}}
							/>
							<div class="workspace-emoji-scroll">
								<div class="workspace-emoji-grid">
									${filteredEmojis.length > 0
										? filteredEmojis.map((entry) => html`
											<button
												class="workspace-emoji-swatch ${emojiPickerWorkspace?.emoji === entry.emoji ? "selected" : ""}"
												title=${entry.name}
												@click=${() => this.applyWorkspaceEmoji(this.emojiPickerWorkspaceId!, entry.emoji)}
											>${entry.emoji}</button>
										`)
										: html`<div class="workspace-emoji-empty">No emojis found</div>`}
								</div>
							</div>
						</div>
					`
					: nothing}
			</div>
		`;
	}

	private renderWorkspaceWindowRow(): TemplateResult {
		return html`
			<div class="sidebar-window-row" data-tauri-drag-region>
				<div class="sidebar-window-controls" @click=${(e: Event) => e.stopPropagation()}>
					<button class="sidebar-window-dot red" title="Close" @click=${(e: Event) => {
						e.stopPropagation();
						void this.invokeWindowControl("close");
					}}></button>
					<button class="sidebar-window-dot yellow" title="Minimize" @click=${(e: Event) => {
						e.stopPropagation();
						void this.invokeWindowControl("minimize");
					}}></button>
					<button class="sidebar-window-dot green" title="Maximize" @click=${(e: Event) => {
						e.stopPropagation();
						void this.invokeWindowControl("maximize");
					}}></button>
				</div>
				<button
					class="workspace-sidebar-toggle"
					title="Collapse sidebar"
					@click=${(e: Event) => {
						e.stopPropagation();
						this.toggleCollapsed();
					}}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<path d="M3 3.5h10v9H3z" />
						<path d="M6 3.5v9" />
					</svg>
				</button>
			</div>
		`;
	}

	private renderWorkspaceHeader(): TemplateResult | typeof nothing {
		const activeWorkspace = this.getActiveWorkspaceItem();
		if (!activeWorkspace) return nothing;
		const isRenaming = this.workspaceRenameDraft?.workspaceId === activeWorkspace.id;
		return html`
			<div
				class="sidebar-workspace-header"
				@contextmenu=${(e: MouseEvent) => this.handleWorkspaceContextMenu(e, activeWorkspace.id)}
			>
				<button
					class="sidebar-workspace-header-emoji"
					title="Change workspace emoji"
					@click=${(e: MouseEvent) => this.openWorkspaceEmojiPicker(activeWorkspace.id, e)}
				>
					<span class="sidebar-workspace-avatar">${activeWorkspace.emoji || "💼"}</span>
				</button>
				<div class="sidebar-workspace-header-main">
					${isRenaming
						? html`
							<input
								class="sidebar-workspace-title-input"
								data-workspace-id=${activeWorkspace.id}
								.value=${this.workspaceRenameDraft?.value ?? activeWorkspace.title}
								@input=${(event: Event) => {
									if (!this.workspaceRenameDraft) return;
									this.workspaceRenameDraft = {
										...this.workspaceRenameDraft,
										value: (event.target as HTMLInputElement).value,
									};
								}}
								@keydown=${(event: KeyboardEvent) => {
									if (event.key === "Enter") {
										event.preventDefault();
										this.commitWorkspaceRename();
										return;
									}
									if (event.key === "Escape") {
										event.preventDefault();
										this.cancelWorkspaceRename();
									}
								}}
								@blur=${() => this.commitWorkspaceRename()}
							/>
						`
						: html`<div class="sidebar-workspace-header-title">${activeWorkspace.title}</div>`}
				</div>
			</div>
		`;
	}

	private renderWorkspaceDock(): TemplateResult {
		return html`
			<div class="sidebar-workspace-dock" data-tauri-drag-region>
				<button
					class="sidebar-settings-icon-btn"
					title="Settings"
					@click=${(e: Event) => {
						e.preventDefault();
						e.stopPropagation();
						this.onOpenSettings?.();
					}}
				>
					<svg class="sidebar-icon-svg" viewBox="0 0 16 16" aria-hidden="true">
						<path d="M2.8 4h10.4" />
						<path d="M2.8 8h10.4" />
						<path d="M2.8 12h10.4" />
						<circle cx="6" cy="4" r="1.1" />
						<circle cx="10" cy="8" r="1.1" />
						<circle cx="7" cy="12" r="1.1" />
					</svg>
				</button>
				<div class="sidebar-workspace-dock-list" @click=${(e: Event) => e.stopPropagation()}>
					${this.workspaces.map((workspace) => {
						const active = workspace.id === this.activeWorkspaceId;
						const dragOver = workspace.id === this.workspaceDragOverId && this.draggingWorkspaceId !== workspace.id;
						return html`
							<button
								class="sidebar-workspace-pill ${active ? "active" : ""} ${dragOver ? "drag-over" : ""} ${workspace.id === this.draggingWorkspaceId ? "dragging" : ""}"
								data-workspace-id=${workspace.id}
								title=${workspace.title}
								@contextmenu=${(e: MouseEvent) => this.handleWorkspaceContextMenu(e, workspace.id)}
								@pointerdown=${(e: PointerEvent) => this.beginWorkspacePointerDrag(e, workspace.id)}
								@click=${() => {
									if (this.shouldSuppressWorkspaceRowClick()) return;
									if (!active) this.onWorkspaceSelect?.(workspace.id);
								}}
							>
								<span class="sidebar-workspace-pill-emoji">${workspace.emoji || "💼"}</span>
							</button>
						`;
					})}
				</div>
				<button
					class="sidebar-workspace-dock-add"
					title="Create space"
					@click=${(e: Event) => {
						e.stopPropagation();
						this.openWorkspaceCreateDialog();
					}}
				>
					＋
				</button>
			</div>
		`;
	}

	private renderWorkspaceEmojiPicker(): TemplateResult | typeof nothing {
		if (!this.emojiPickerWorkspaceId) return nothing;
		const emojiPickerWorkspace = this.workspaces.find((workspace) => workspace.id === this.emojiPickerWorkspaceId) ?? null;
		const filteredEmojis = this.filteredWorkspaceEmojis();
		return html`
			<div class="workspace-emoji-picker" style=${`left:${this.emojiPickerX}px;top:${this.emojiPickerY}px`} @click=${(event: Event) => event.stopPropagation()}>
				<input
					class="workspace-emoji-search"
					data-workspace-id=${this.emojiPickerWorkspaceId}
					type="text"
					placeholder="Search emojis"
					.value=${this.emojiSearchQuery}
					@input=${(event: Event) => {
						this.emojiSearchQuery = (event.target as HTMLInputElement).value;
						this.render();
					}}
					@keydown=${(event: KeyboardEvent) => {
						if (event.key === "Escape") {
							event.preventDefault();
							this.closeWorkspaceEmojiPicker();
						}
					}}
				/>
				<div class="workspace-emoji-scroll">
					<div class="workspace-emoji-grid">
						${filteredEmojis.length > 0
							? filteredEmojis.map((entry) => html`
								<button
									class="workspace-emoji-swatch ${emojiPickerWorkspace?.emoji === entry.emoji ? "selected" : ""}"
									title=${entry.name}
									@click=${() => this.applyWorkspaceEmoji(this.emojiPickerWorkspaceId!, entry.emoji)}
								>${entry.emoji}</button>
							`)
							: html`<div class="workspace-emoji-empty">No emojis found</div>`}
					</div>
				</div>
			</div>
		`;
	}

	private renderWorkspaceCreateDialog(): TemplateResult | typeof nothing {
		if (!this.workspaceCreateDialogOpen) return nothing;
		const filteredEmojis = this.filteredWorkspaceCreateEmojis();
		return html`
			<div class="sidebar-space-dialog-backdrop" @click=${() => this.closeWorkspaceCreateDialog()}>
				<div class="sidebar-space-dialog" @click=${(event: Event) => event.stopPropagation()}>
					<div class="sidebar-space-dialog-title">Create a Space</div>
					<div class="sidebar-space-dialog-copy">Spaces are used to organize your tabs and sessions.</div>
					<div class="sidebar-space-name-row">
						<button
							class="sidebar-space-emoji-trigger"
							title="Choose emoji"
							@click=${(event: Event) => {
								event.stopPropagation();
								this.workspaceCreateEmojiPickerOpen = !this.workspaceCreateEmojiPickerOpen;
								this.render();
							}}
						>
							${this.workspaceCreateEmoji || "✨"}
						</button>
						<input
							class="sidebar-space-name-input"
							type="text"
							placeholder="Space Name"
							.value=${this.workspaceCreateName}
							@input=${(event: Event) => {
								this.workspaceCreateName = (event.target as HTMLInputElement).value;
							}}
							@keydown=${(event: KeyboardEvent) => {
								if (event.key === "Enter") {
									event.preventDefault();
									this.createWorkspaceFromDialog();
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									this.closeWorkspaceCreateDialog();
								}
							}}
						/>
					</div>
					${this.workspaceCreateEmojiPickerOpen
						? html`
							<div class="sidebar-space-emoji-picker">
								<input
									class="sidebar-space-emoji-search"
									type="text"
									placeholder="Search emojis"
									.value=${this.workspaceCreateEmojiQuery}
									@input=${(event: Event) => {
										this.workspaceCreateEmojiQuery = (event.target as HTMLInputElement).value;
										this.render();
									}}
								/>
								<div class="sidebar-space-emoji-grid">
									${filteredEmojis.length > 0
										? filteredEmojis.slice(0, 120).map((entry) => html`
											<button
												class="sidebar-space-emoji-option ${this.workspaceCreateEmoji === entry.emoji ? "selected" : ""}"
												title=${entry.name}
												@click=${() => {
													this.workspaceCreateEmoji = entry.emoji;
													this.workspaceCreateEmojiPickerOpen = false;
													this.workspaceCreateEmojiQuery = "";
													this.render();
												}}
											>${entry.emoji}</button>
										`)
										: html`<div class="workspace-emoji-empty">No emojis found</div>`}
								</div>
							</div>
						`
						: nothing}
					<div class="sidebar-space-dialog-actions">
						<button class="sidebar-space-create-btn" @click=${() => this.createWorkspaceFromDialog()}>Create Space</button>
						<button class="sidebar-space-cancel-btn" @click=${() => this.closeWorkspaceCreateDialog()}>Cancel</button>
					</div>
				</div>
			</div>
		`;
	}

	private renderProjectEmojiPicker(): TemplateResult | typeof nothing {
		if (!this.projectEmojiPickerProjectId) return nothing;
		const project = this.projects.find((entry) => entry.id === this.projectEmojiPickerProjectId) ?? null;
		const filteredEmojis = this.filteredProjectEmojis();
		return html`
			<div class="workspace-emoji-picker project-emoji-picker" style=${`left:${this.projectEmojiPickerX}px;top:${this.projectEmojiPickerY}px`} @click=${(event: Event) => event.stopPropagation()}>
				<input
					class="workspace-emoji-search project-emoji-search"
					data-project-id=${this.projectEmojiPickerProjectId}
					type="text"
					placeholder="Search emojis"
					.value=${this.projectEmojiSearchQuery}
					@input=${(event: Event) => {
						this.projectEmojiSearchQuery = (event.target as HTMLInputElement).value;
						this.render();
					}}
					@keydown=${(event: KeyboardEvent) => {
						if (event.key === "Escape") {
							event.preventDefault();
							this.closeProjectEmojiPicker();
						}
					}}
				/>
				<div class="workspace-emoji-scroll">
					<div class="workspace-emoji-grid">
						${filteredEmojis.length > 0
							? filteredEmojis.map((entry) => html`
								<button
									class="workspace-emoji-swatch ${project?.emoji === entry.emoji ? "selected" : ""}"
									title=${entry.name}
									@click=${() => this.applyProjectEmoji(this.projectEmojiPickerProjectId!, entry.emoji)}
								>${entry.emoji}</button>
							`)
							: html`<div class="workspace-emoji-empty">No emojis found</div>`}
					</div>
				</div>
			</div>
		`;
	}

	private renderSessionPiIcon(running = false): TemplateResult | typeof nothing {
		if (!running) return nothing;
		return html`
			<span class="sidebar-session-pi running" title="Session running" aria-hidden="true">
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3.3 3.3H10.3V8H8V10.3H5.7V12.7H3.3Z"></path>
					<path d="M10.3 8H12.7V12.7H10.3Z"></path>
				</svg>
			</span>
		`;
	}

	private renderProjectMenu(project: Project): TemplateResult {
		return html`
			<div class="sidebar-project-menu" @click=${(e: Event) => e.stopPropagation()}>
				<button @click=${() => this.renameProject(project.id)}>Rename project</button>
				<button @click=${() => this.toggleProjectPinned(project.id)}>${project.pinned ? "Unpin project" : "Pin project"}</button>
				<button @click=${(event: MouseEvent) => this.openProjectEmojiPicker(project.id, event)}>Change emoji</button>
				<div class="sidebar-project-menu-divider"></div>
				<button @click=${() => this.removeProject(project.id)}>Remove project</button>
			</div>
		`;
	}

	private renderChronologicalProjectsMode(projects: Project[]): TemplateResult {
		const rows = this.chronologicalSessions(projects);
		if (rows.length === 0) {
			if (this.query.trim()) {
				return html`<div class="sidebar-empty">No sessions match your filter.</div>`;
			}
			return html`<div class="sidebar-empty">${this.sessionShow === "relevant" ? "No relevant sessions yet." : "No sessions yet."}</div>`;
		}

		return html`
			<div class="sidebar-chrono-list">
				${rows.map(({ project, session }) => {
					const ts = this.sessionSortBy === "created" ? session.createdAt || session.modifiedAt : session.modifiedAt || session.createdAt;
					const normalizedSessionPath = normalizePath(session.path);
					const activeSession = normalizedSessionPath
						? normalizedSessionPath === this.activeSessionPath
						: Boolean(session.transient && this.activeProjectId === project.id && !this.activeSessionPath);
					const runningSession = this.runningSessionPaths.has(normalizedSessionPath);
					const attentionMessage = this.attentionSessionMessages.get(normalizedSessionPath) ?? null;
					return html`
						<button
							class="sidebar-chrono-row ${activeSession ? "active-session" : ""}"
							@click=${() => {
								if (session.transient && !session.path) return;
								this.selectProject(project.id, false);
								this.activeSessionPath = normalizePath(session.path);
								this.activeFilePath = null;
								this.render();
								this.onSessionSelect?.(project.id, session.path, session.name);
							}}
							@contextmenu=${(e: MouseEvent) => this.handleSessionContextMenu(e, project, session)}
							title=${session.path}
						>
							<span class="sidebar-project-emoji-inline">${normalizeProjectEmoji(project.emoji)}</span>
							<span class="sidebar-session-leading">
								${this.renderSessionPiIcon(runningSession)}
							</span>
							<span class="sidebar-chrono-main">
								<span class="sidebar-chrono-name sidebar-session-name ${attentionMessage ? "needs-attention" : ""}">${session.name}</span>
								<span class="sidebar-chrono-project">${project.name}</span>
							</span>
							<span class="sidebar-chrono-time">${formatRelativeDate(ts)}</span>
						</button>
					`;
				})}
			</div>
		`;
	}

	private renderProjectsMode(): TemplateResult {
		const projects = this.filteredProjects();
		if (this.projects.length === 0) {
			return html`<div class="sidebar-empty">No projects yet. Open a folder to get started.</div>`;
		}
		if (projects.length === 0) {
			return html`<div class="sidebar-empty">No projects or sessions match your filter.</div>`;
		}
		if (this.sessionOrganize === "chronological") {
			return this.renderChronologicalProjectsMode(projects);
		}

		return html`
			<div class="sidebar-project-list">
				${projects.map((project, index) => {
					const active = this.activeProjectId === project.id;
					const menuOpen = this.openProjectMenuId === project.id;
					const sessions = this.visibleSessions(project);
					const unreadCount = this.getProjectAttentionCount(project);
					const showBlockingSessionLoad = project.loadingSessions && sessions.length === 0;
					const showInlineSessionRefresh = project.loadingSessions && sessions.length > 0;
					const previousProject = projects[index - 1] ?? null;
					const showPinnedDivider = Boolean(previousProject?.pinned) && !Boolean(project.pinned);
					const dragOver = project.id === this.projectDragOverId && this.draggingProjectId !== project.id;
					return html`
						${showPinnedDivider ? html`<div class="sidebar-project-pin-divider" role="separator" aria-hidden="true"></div>` : nothing}
						<div class="sidebar-project-row ${active ? "active" : ""} ${menuOpen ? "menu-open" : ""} ${dragOver ? "drag-over" : ""} ${project.id === this.draggingProjectId ? "dragging" : ""}" data-project-id=${project.id}>
							<div class="sidebar-project-head">
								<div class="sidebar-project-main-wrap">
									<button
										class="sidebar-project-indicator-btn"
										title=${project.expanded ? "Collapse" : "Expand"}
										@click=${(e: Event) => {
											e.stopPropagation();
											this.toggleProject(project.id);
										}}
									>
										${this.renderProjectMarker(project)}
										<span class="sidebar-project-toggle-icon">${project.expanded ? "▾" : "▸"}</span>
									</button>
									<button
										class="sidebar-project-main"
										@pointerdown=${(e: PointerEvent) => this.beginProjectPointerDrag(e, project.id)}
										@click=${() => {
											if (this.shouldSuppressProjectMainClick(project.id)) return;
											this.handleProjectMainClick(project.id);
										}}
										title=${project.path}
									>
										<span class="sidebar-project-title-wrap">
											<span class="sidebar-project-title">${project.name}</span>
											${unreadCount > 0
												? html`<span class="sidebar-project-unread-count" title=${`${unreadCount} unread session${unreadCount === 1 ? "" : "s"}`}>${unreadCount}</span>`
												: nothing}
										</span>
									</button>
								</div>
								<div class="sidebar-project-row-actions ${menuOpen ? "open" : ""}">
									<button
										class="sidebar-project-action"
										title="New session"
										@click=${(e: Event) => {
											e.stopPropagation();
											this.selectProject(project.id, false);
											this.onNewSessionInProject?.({ id: project.id, name: project.name, path: project.path });
										}}
									>
										<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5h10v9h-10z"/><path d="M6.2 8h3.6"/><path d="M8 6.2v3.6"/></svg>
									</button>
									<button
										class="sidebar-project-action menu"
										title="Project actions"
										@click=${(e: Event) => {
											e.stopPropagation();
											this.toggleProjectMenu(project.id);
										}}
									>
										<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12" cy="8" r="1.1"/></svg>
									</button>
									${showInlineSessionRefresh ? html`<span class="sidebar-project-inline-status">Refreshing…</span>` : nothing}
									${menuOpen ? this.renderProjectMenu(project) : nothing}
								</div>
							</div>

							${project.expanded
								? html`
									<div class="sidebar-project-sessions">
										${project.pathExists === false
											? html`
												<div class="sidebar-warning">
													Project path is missing on this machine.
													<button @click=${() => this.relinkProject(project.id)}>Relink folder</button>
												</div>
											`
											: nothing}
										${showBlockingSessionLoad
											? html`<div class="sidebar-empty">Loading sessions…</div>`
											: sessions.length === 0
												? html`<div class="sidebar-empty">${this.sessionShow === "relevant" ? "No relevant sessions." : "No sessions yet."}</div>`
												: sessions.map(
                                                    (session) => {
                                                        const normalizedSessionPath = normalizePath(session.path);
                                                        const activeSession = normalizedSessionPath
                                                            ? normalizedSessionPath === this.activeSessionPath
                                                            : Boolean(session.transient && this.activeProjectId === project.id && !this.activeSessionPath);
                                                        const runningSession = this.runningSessionPaths.has(normalizedSessionPath);
                                                        const attentionMessage = this.attentionSessionMessages.get(normalizedSessionPath) ?? null;
                                                        const sessionRenameActive =
                                                            Boolean(this.sessionRenameDraft) &&
                                                            this.sessionRenameDraft?.projectId === project.id &&
                                                            this.sessionRenameDraft?.sessionPath === normalizePath(session.path);
                                                        return html`
                                                            <div class="sidebar-session-row ${activeSession ? "active" : ""}">
                                                                <span class="sidebar-session-leading">
                                                                    ${this.renderSessionPiIcon(runningSession)}
                                                                </span>
                                                                <button
                                                                    class="sidebar-session ${activeSession ? "active-session" : ""}"
                                                                    @click=${() => {
                                                                        if (sessionRenameActive) return;
                                                                        if (session.transient && !session.path) return;
                                                                        this.selectProject(project.id, false);
                                                                        this.activeSessionPath = normalizePath(session.path);
                                                                        this.activeFilePath = null;
                                                                        this.render();
                                                                        this.onSessionSelect?.(project.id, session.path, session.name);
                                                                    }}
                                                                    @contextmenu=${(e: MouseEvent) => this.handleSessionContextMenu(e, project, session)}
                                                                    title=${session.path}
                                                                >
                                                                    ${sessionRenameActive
                                                                        ? html`
                                                                            <input
                                                                                class="sidebar-inline-input sidebar-session-inline-input"
                                                                                .value=${this.sessionRenameDraft?.value ?? session.name}
                                                                                @click=${(e: Event) => e.stopPropagation()}
                                                                                @input=${(e: Event) => {
                                                                                    const target = e.target as HTMLInputElement;
                                                                                    if (!this.sessionRenameDraft) return;
                                                                                    this.sessionRenameDraft = { ...this.sessionRenameDraft, value: target.value };
                                                                                }}
                                                                                @keydown=${(e: KeyboardEvent) => {
                                                                                    if (e.key === "Enter") {
                                                                                        e.preventDefault();
                                                                                        this.commitSessionRename(project, session);
                                                                                        return;
                                                                                    }
                                                                                    if (e.key === "Escape") {
                                                                                        e.preventDefault();
                                                                                        this.cancelSessionRename();
                                                                                    }
                                                                                }}
                                                                                @blur=${() => this.commitSessionRename(project, session)}
                                                                                autofocus
                                                                            />
                                                                        `
                                                                        : html`<span class="sidebar-session-name ${attentionMessage ? "needs-attention" : ""}">${session.name}</span>`}
                                                                </button>
                                                            </div>
                                                        `;
                                                    },
                                                  )}
									</div>
								`
								: nothing}
						</div>
					`;
				})}
			</div>
		`;
	}

	private renderFilesMode(): TemplateResult {
		if (this.projects.length === 0) {
			return html`<div class="sidebar-empty">No projects yet. Open a folder to get started.</div>`;
		}

		const projects = this.filteredProjects(false);
		if (projects.length === 0) {
			return html`<div class="sidebar-empty">No projects match current filters.</div>`;
		}

		const query = this.query.trim().toLowerCase();

		return html`
			<div class="sidebar-project-list">
				${projects.map((project, index) => {
					const active = this.activeProjectId === project.id;
					const menuOpen = this.openProjectMenuId === project.id;
					const unreadCount = this.getProjectAttentionCount(project);
					const loading = this.loadingFileTreeForProject.has(project.id);
					const showInlineSessionRefresh = project.loadingSessions && project.sessions.length > 0;
					const nodes = this.fileTrees.get(project.id) ?? [];
					const fileTreeError = this.fileTreeErrors.get(project.id) ?? null;
					const hasMatchingNode = nodes.some((node) => this.nodeMatchesQuery(node, query));
					const previousProject = projects[index - 1] ?? null;
					const showPinnedDivider = Boolean(previousProject?.pinned) && !Boolean(project.pinned);
					const dragOver = project.id === this.projectDragOverId && this.draggingProjectId !== project.id;

					return html`
						${showPinnedDivider ? html`<div class="sidebar-project-pin-divider" role="separator" aria-hidden="true"></div>` : nothing}
						<div class="sidebar-project-row ${active ? "active" : ""} ${menuOpen ? "menu-open" : ""} ${dragOver ? "drag-over" : ""} ${project.id === this.draggingProjectId ? "dragging" : ""}" data-project-id=${project.id}>
							<div class="sidebar-project-head">
								<div class="sidebar-project-main-wrap">
									<button
										class="sidebar-project-indicator-btn"
										title=${project.expanded ? "Collapse" : "Expand"}
										@click=${(e: Event) => {
											e.stopPropagation();
											this.toggleProject(project.id);
										}}
									>
										${this.renderProjectMarker(project)}
										<span class="sidebar-project-toggle-icon">${project.expanded ? "▾" : "▸"}</span>
									</button>
									<button
										class="sidebar-project-main"
										@pointerdown=${(e: PointerEvent) => this.beginProjectPointerDrag(e, project.id)}
										@click=${() => {
											if (this.shouldSuppressProjectMainClick(project.id)) return;
											this.handleProjectMainClick(project.id);
										}}
										title=${project.path}
									>
										<span class="sidebar-project-title-wrap">
											<span class="sidebar-project-title">${project.name}</span>
											${unreadCount > 0
												? html`<span class="sidebar-project-unread-count" title=${`${unreadCount} unread session${unreadCount === 1 ? "" : "s"}`}>${unreadCount}</span>`
												: nothing}
										</span>
									</button>
								</div>
								<div class="sidebar-project-row-actions ${menuOpen ? "open" : ""}">
									<button
										class="sidebar-project-action"
										title="New file"
										@click=${(e: Event) => {
											e.stopPropagation();
											this.selectProject(project.id, false);
											this.onNewFileInProject?.({ id: project.id, name: project.name, path: project.path });
										}}
									>
										<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h6l2 2v8.3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9.3a1 1 0 0 1 1-1z"/><path d="M10 2.5v2.2h2"/><path d="M8 6.2v3.6"/><path d="M6.2 8h3.6"/></svg>
									</button>
									<button
										class="sidebar-project-action menu"
										title="Project actions"
										@click=${(e: Event) => {
											e.stopPropagation();
											this.toggleProjectMenu(project.id);
										}}
									>
										<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12" cy="8" r="1.1"/></svg>
									</button>
									${showInlineSessionRefresh ? html`<span class="sidebar-project-inline-status">Refreshing…</span>` : nothing}
									${menuOpen ? this.renderProjectMenu(project) : nothing}
								</div>
							</div>

							${project.expanded
								? html`
									<div class="sidebar-project-files">
										${project.pathExists === false
											? html`
												<div class="sidebar-warning">
													Project path is missing on this machine.
													<button @click=${() => this.relinkProject(project.id)}>Relink folder</button>
												</div>
											`
											 : loading
												? html`<div class="sidebar-file-group-empty">Loading files…</div>`
												: fileTreeError
													? html`<div class="sidebar-file-group-empty">Could not read files.</div>`
													: nodes.length === 0
														? html`<div class="sidebar-file-group-empty">Empty project folder.</div>`
														: !hasMatchingNode
														? html`<div class="sidebar-file-group-empty">No files match this filter.</div>`
														: html`
															<div class="sidebar-files-tree">
																${[...nodes]
																	.sort((a, b) => this.compareFileNodes(a, b))
																	.map((node) => this.renderFileNode(project.id, node, query))}
															</div>
														`}
									</div>
								`
								: nothing}
						</div>
					`;
				})}
			</div>
		`;
	}

	private renderModeBody(): TemplateResult {
		if (this.mode === "files") return this.renderFilesMode();
		return this.renderProjectsMode();
	}

	private handleRefreshActive(): void {
		const active = this.getActiveProject();
		if (!active) return;
		const activeProject = this.projects.find((project) => project.id === active.id) ?? null;
		void this.refreshProjectPathStatus(active.id);
		void this.loadSessionsForProject(active.id, { silent: Boolean(activeProject?.sessions.length) });
		if (this.mode === "files") void this.ensureFileTreeForProject(active.id, true);
	}


	private renderModeIcon(mode: SidebarMode): TemplateResult {
		if (mode === "projects") {
			return html`
				<svg class="sidebar-mode-svg" viewBox="0 0 16 16" aria-hidden="true">
					<path d="M3 3.5h7v7h-7z" />
					<path d="M6 6.5h7v7h-7z" />
				</svg>
			`;
		}

		return html`
			<svg class="sidebar-mode-svg" viewBox="0 0 16 16" aria-hidden="true">
				<path d="M4 2.8h6l2 2v8.4a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.4a1 1 0 0 1 1-1z" />
				<path d="M10 2.8v2.4h2" />
				<path d="M5.8 8h4.4" />
				<path d="M5.8 10.2h4.4" />
			</svg>
		`;
	}

	private renderModeSwitch(): TemplateResult {
		const modes: Array<{ id: SidebarMode; label: string }> = [
			{ id: "projects", label: "Sessions" },
			{ id: "files", label: "Files" },
		];

		return html`${modes.map(
			(mode) => html`
				<button class="sidebar-mode-btn ${this.mode === mode.id ? "active" : ""}" title=${mode.label} @click=${() => this.setMode(mode.id)}>
					${this.renderModeIcon(mode.id)}
				</button>
			`,
		)}`;
	}

	render(): void {
		this.container.classList.toggle("collapsed", this.collapsed);
		const hasActiveProject = Boolean(this.getActiveProject());

		const template = html`
			<div
				class="sidebar-single"
				@wheel=${(e: WheelEvent) => this.handleSidebarWheel(e)}
				@click=${(e: Event) => {
					const target = e.target as HTMLElement;
					let changed = false;

					if (this.openProjectMenuId && !target.closest(".sidebar-project-menu") && !target.closest(".sidebar-project-action.menu")) {
						this.openProjectMenuId = null;
						changed = true;
					}

					if (this.modeFilterMenuOpen && !target.closest(".sidebar-mode-filter-menu") && !target.closest(".sidebar-mode-filter-btn")) {
						this.modeFilterMenuOpen = false;
						changed = true;
					}

					if ((this.pendingProjectDragId || this.draggingProjectId) && !target.closest(".sidebar-project-list")) {
						this.cancelProjectPointerDrag(false);
						changed = true;
					}

					if ((this.pendingWorkspaceDragId || this.draggingWorkspaceId) && !target.closest(".sidebar-workspace-dock")) {
						this.cancelWorkspacePointerDrag(false);
						changed = true;
					}

					if (
						this.workspaceRenameDraft &&
						!target.closest(".sidebar-workspace-title-input")
					) {
						this.commitWorkspaceRename();
						return;
					}

					if (
						this.workspaceCreateDialogOpen &&
						!target.closest(".sidebar-space-dialog") &&
						!target.closest(".sidebar-workspace-dock-add")
					) {
						this.closeWorkspaceCreateDialog(false);
						changed = true;
					}

					if (
						this.workspaceCreateEmojiPickerOpen &&
						!target.closest(".sidebar-space-emoji-picker") &&
						!target.closest(".sidebar-space-emoji-trigger")
					) {
						this.workspaceCreateEmojiPickerOpen = false;
						this.workspaceCreateEmojiQuery = "";
						changed = true;
					}

					if (
						this.emojiPickerWorkspaceId &&
						!target.closest(".workspace-emoji-picker") &&
						!target.closest(".sidebar-workspace-header-emoji")
					) {
						this.closeWorkspaceEmojiPicker(false);
						changed = true;
					}

					if (
						this.projectEmojiPickerProjectId &&
						!target.closest(".project-emoji-picker")
					) {
						this.closeProjectEmojiPicker(false);
						changed = true;
					}

					if (this.contextMenu && !target.closest(".sidebar-context-menu")) {
						this.contextMenu = null;
						changed = true;
					}

					if (changed) this.render();
				}}
			>
				${this.renderWorkspaceWindowRow()}

				<div class="sidebar-topbar" data-tauri-drag-region>
					${this.renderWorkspaceHeader()}
					${this.desktopUpdateAvailable
						? html`
							<button class="sidebar-cli-update-banner sidebar-desktop-update-banner" @click=${() => this.onOpenSettings?.()}>
								<span>
									Desktop update available${this.desktopUpdateLatestVersion ? ` · v${this.desktopUpdateLatestVersion}` : ""}
								</span>
								<span class="sidebar-cli-update-cta">Open settings</span>
							</button>
						`
						: nothing}
					${this.cliUpdateAvailable
						? html`
							<button class="sidebar-cli-update-banner" @click=${() => this.onOpenSettings?.()}>
								<span>
									CLI update available${this.cliUpdateLatestVersion ? ` · v${this.cliUpdateLatestVersion}` : ""}
								</span>
								<span class="sidebar-cli-update-cta">Open settings</span>
							</button>
						`
						: nothing}
					<div class="sidebar-top-actions sidebar-top-actions-primary">
						<button
							class="sidebar-top-action-btn"
							title=${this.mode === "files" ? "New file" : "New session"}
							?disabled=${!hasActiveProject}
							@click=${() => void this.triggerPrimaryTopAction()}
						>
							<span>${this.mode === "files" ? "New file" : "New session"}</span>
						</button>
						<button class="sidebar-top-action-btn ${this.packagesOpen ? "active" : ""}" title="Packages" @click=${() => this.onTogglePackages?.()}>
							<span>Packages</span>
						</button>
					</div>
				</div>

				<div class="sidebar-section-divider" aria-hidden="true"></div>

				<div class="sidebar-mode-row">
					<div class="sidebar-mode-meta">
						<div class="sidebar-mode-current">${this.mode === "projects" ? "Sessions" : "Files"}</div>
						<div class="sidebar-mode-switch">
							${this.renderModeSwitch()}
						</div>
					</div>
					<div class="sidebar-mode-actions">
						<button class="sidebar-mode-create-btn" title="Add project" @click=${() => void this.handleModeCreateAction()}>
							<svg class="sidebar-icon-svg" viewBox="0 0 16 16" aria-hidden="true">
								<path d="M2.5 4.5h4l1.3 1.5h5.7v5a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" />
								<path d="M8 7.2v3.6" />
								<path d="M6.2 9h3.6" />
							</svg>
						</button>
						<button class="sidebar-mode-filter-btn" title=${this.mode === "projects" ? "Organize sessions" : "Filter files"} @click=${() => this.toggleModeFilterMenu()}>
							<svg class="sidebar-icon-svg" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10"/><path d="M5 8h6"/><path d="M7 12h2"/></svg>
						</button>
						${this.renderModeFilterMenu()}
					</div>
				</div>

				<div class="sidebar-panel-body">
					${this.renderModeBody()}
				</div>

				<div class="sidebar-footer">
					${this.renderWorkspaceDock()}
				</div>

				${this.renderWorkspaceCreateDialog()}
				${this.renderWorkspaceEmojiPicker()}
				${this.renderProjectEmojiPicker()}
				${this.renderContextMenu()}
			</div>
		`;

		render(template, this.container);
	}
}
