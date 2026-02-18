/**
 * Sidebar - active project sessions + files explorer
 */

import { type CSSProperties, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

interface SidebarSession {
	id: string;
	name: string;
	path: string;
	modifiedAt: number;
	tokens: number;
	cost: number;
}

interface Project {
	id: string;
	path: string;
	name: string;
	color: string;
	sessions: SidebarSession[];
	loadingSessions: boolean;
}

interface PersistedProject {
	id: string;
	path: string;
	name: string;
	color: string;
}

type SidebarPanel = "sessions" | "files";

interface ProjectSummary {
	id: string;
	path: string;
	name: string;
}

interface FileTreeNode {
	id: string;
	name: string;
	path: string;
	isDirectory: boolean;
	expanded: boolean;
	loading: boolean;
	loadError: string | null;
	children: FileTreeNode[] | null;
}

interface ProjectFileExplorerState {
	projectPath: string;
	rootLoading: boolean;
	rootError: string | null;
	rootChildren: FileTreeNode[] | null;
	selectedPath: string | null;
	selectedIsDirectory: boolean;
}

const STORAGE_KEY = "pi-desktop.projects.v1";
const ACTIVE_PROJECT_STORAGE_KEY = "pi-desktop.projects.active.v1";
const SIDEBAR_PANEL_STORAGE_KEY = "pi-desktop.sidebar.panel.v1";

function stringToColor(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
	const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"];
	return colors[Math.abs(hash) % colors.length];
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

function normalizePath(path: string | null | undefined): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function joinFsPath(basePath: string, entryName: string): string {
	const base = basePath.replace(/[\\/]+$/, "");
	if (!base) return entryName;
	const separator = base.includes("\\") ? "\\" : "/";
	return `${base}${separator}${entryName}`;
}

function relativePathFromProject(projectPath: string, targetPath: string): string {
	const projectNormalized = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
	const targetNormalized = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");

	const projectLower = projectNormalized.toLowerCase();
	const targetLower = targetNormalized.toLowerCase();

	if (projectLower === targetLower) return ".";
	if (targetLower.startsWith(`${projectLower}/`)) {
		return targetNormalized.slice(projectNormalized.length + 1);
	}

	return targetNormalized;
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

function humanizeError(err: unknown): string {
	if (err instanceof Error && err.message) return err.message;
	if (typeof err === "string") return err;
	return String(err);
}

type SidebarIconName = "newSession" | "resources" | "settings" | "folder" | "folderOpen" | "file";

interface SidebarIconProps {
	name: SidebarIconName;
	className?: string;
}

function SidebarIcon(props: SidebarIconProps): ReactElement {
	const className = props.className ? `sidebar-icon ${props.className}` : "sidebar-icon";

	switch (props.name) {
		case "newSession":
			return (
				<svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
					<rect x="3.2" y="3.2" width="13.6" height="13.6" rx="3" />
					<path d="M10 6.4v7.2" />
					<path d="M6.4 10h7.2" />
				</svg>
			);
		case "resources":
			return (
				<svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
					<path d="m10 3 1.8 4.1L16 9l-4.2 1.9L10 15l-1.8-4.1L4 9l4.2-1.9L10 3Z" />
				</svg>
			);
		case "settings":
			return (
				<svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
					<path d="M4 6.2h12" />
					<path d="M4 10h12" />
					<path d="M4 13.8h12" />
					<circle cx="8" cy="6.2" r="1.2" />
					<circle cx="12" cy="10" r="1.2" />
					<circle cx="9" cy="13.8" r="1.2" />
				</svg>
			);
		case "folderOpen":
			return (
				<svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
					<path d="M2.8 8.4h5.1l1.8 1.8h7.2a1.2 1.2 0 0 1 1.2 1.2V15a1.7 1.7 0 0 1-1.7 1.7H4.5A1.7 1.7 0 0 1 2.8 15V8.4Z" />
				</svg>
			);
		case "folder":
			return (
				<svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
					<path d="M2.8 7.4h5.1l1.8 2h7.2a1.2 1.2 0 0 1 1.2 1.2V15a1.7 1.7 0 0 1-1.7 1.7H4.5A1.7 1.7 0 0 1 2.8 15V7.4Z" />
				</svg>
			);
		case "file":
		default:
			return (
				<svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
					<path d="M6 3.3h5l3 3V16a1.7 1.7 0 0 1-1.7 1.7H7.7A1.7 1.7 0 0 1 6 16V3.3Z" />
					<path d="M11 3.3V7h3" />
				</svg>
			);
	}
}

interface FileTreeProps {
	nodes: FileTreeNode[];
	depth: number;
	selectedPath: string | null;
	onSelectNode: (path: string, isDirectory: boolean) => void;
	onToggleDirectory: (path: string) => void;
	onOpenPath: (path: string) => void;
}

function FileTree(props: FileTreeProps): ReactElement {
	return (
		<>
			{props.nodes.map((node) => {
				const isActive = props.selectedPath === node.path;
				const rowStyle: CSSProperties = {
					paddingLeft: `${props.depth * 12 + 6}px`,
				};
				const childStateStyle: CSSProperties = {
					paddingLeft: `${(props.depth + 1) * 12 + 24}px`,
				};

				return (
					<div className="sidebar-file-item" key={node.id}>
						<div className={`sidebar-file-row ${isActive ? "active" : ""}`} style={rowStyle}>
							{node.isDirectory ? (
								<button
									className="sidebar-file-disclosure"
									onClick={(e) => {
										e.stopPropagation();
										props.onToggleDirectory(node.path);
									}}
									title={node.expanded ? "Collapse" : "Expand"}
									type="button"
								>
									{node.expanded ? "▾" : "▸"}
								</button>
							) : (
								<span className="sidebar-file-disclosure placeholder"></span>
							)}

							<button
								className="sidebar-file-btn"
								onClick={() => props.onSelectNode(node.path, node.isDirectory)}
								onDoubleClick={() => props.onOpenPath(node.path)}
								title={node.path}
								type="button"
							>
								<span className="sidebar-file-icon">
									<SidebarIcon name={node.isDirectory ? (node.expanded ? "folderOpen" : "folder") : "file"} className="file" />
								</span>
								<span className="sidebar-file-name">{node.name}</span>
							</button>
						</div>

						{node.isDirectory && node.expanded ? (
							<div className="sidebar-file-children">
								{node.loading ? (
									<div className="sidebar-file-substate" style={childStateStyle}>
										Loading...
									</div>
								) : node.loadError ? (
									<div className="sidebar-file-substate error" style={childStateStyle}>
										{node.loadError}
									</div>
								) : node.children && node.children.length > 0 ? (
									<FileTree
										nodes={node.children}
										depth={props.depth + 1}
										selectedPath={props.selectedPath}
										onSelectNode={props.onSelectNode}
										onToggleDirectory={props.onToggleDirectory}
										onOpenPath={props.onOpenPath}
									/>
								) : (
									<div className="sidebar-file-substate" style={childStateStyle}>
										Empty folder
									</div>
								)}
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
}

interface SidebarViewProps {
	panel: SidebarPanel;
	activeProject: Project | null;
	fileState: ProjectFileExplorerState | null;
	onSwitchPanel: (panel: SidebarPanel) => void;
	onOpenExtensions: () => void;
	onOpenSettings: () => void;
	onRefreshSessions: () => void;
	onNewSessionInProject: () => void;
	onSelectSession: (sessionPath: string) => void;
	onRefreshFiles: () => void;
	onToggleDirectory: (dirPath: string) => void;
	onSelectFileNode: (path: string, isDirectory: boolean) => void;
	onOpenPath: (path: string) => void;
	onOpenSelectedPath: () => void;
	onCopySelectedRelativePath: () => void;
}

function SidebarView(props: SidebarViewProps): ReactElement {
	const selectedRelativePath =
		props.activeProject && props.fileState?.selectedPath
			? relativePathFromProject(props.activeProject.path, props.fileState.selectedPath)
			: null;

	const utilityActions = (
		<>
			<button className="sidebar-link-btn" disabled={!props.activeProject} onClick={props.onNewSessionInProject} type="button">
				<span className="sidebar-link-icon">
					<SidebarIcon name="newSession" />
				</span>
				<span className="sidebar-link-label">New Session</span>
			</button>
			<button className="sidebar-link-btn" onClick={props.onOpenExtensions} type="button">
				<span className="sidebar-link-icon">
					<SidebarIcon name="resources" />
				</span>
				<span className="sidebar-link-label">Resources</span>
			</button>
			<button className="sidebar-link-btn" onClick={props.onOpenSettings} type="button">
				<span className="sidebar-link-icon">
					<SidebarIcon name="settings" />
				</span>
				<span className="sidebar-link-label">Settings</span>
			</button>
		</>
	);

	const refreshLabel = props.panel === "sessions" ? "Refresh sessions" : "Refresh files";
	const onRefresh = props.panel === "sessions" ? props.onRefreshSessions : props.onRefreshFiles;

	return (
		<div className="sidebar-root">
			<div className="sidebar-panel-header">
				<div className="sidebar-panel-switch" role="tablist" aria-label="Sidebar panel">
					<button
						className={`sidebar-panel-tab ${props.panel === "sessions" ? "active" : ""}`}
						onClick={() => props.onSwitchPanel("sessions")}
						type="button"
					>
						Sessions
					</button>
					<button
						className={`sidebar-panel-tab ${props.panel === "files" ? "active" : ""}`}
						onClick={() => props.onSwitchPanel("files")}
						type="button"
					>
						Files
					</button>
				</div>
				<button className="sidebar-compact-btn" onClick={onRefresh} title={refreshLabel} type="button">
					↻
				</button>
			</div>

			<div className="sidebar-panel">
				{props.panel === "sessions" ? (
					<>
						<div className="sidebar-projects">
							{!props.activeProject ? (
								<div className="sidebar-empty">Open a project tab to view sessions</div>
							) : props.activeProject.loadingSessions ? (
								<div className="sidebar-session-state">Loading sessions...</div>
							) : props.activeProject.sessions.length === 0 ? (
								<div className="sidebar-session-state">No sessions yet in this project</div>
							) : (
								<div className="sidebar-session-list standalone">
									{props.activeProject.sessions.map((session) => (
										<button
											className="sidebar-session-btn"
											onClick={() => props.onSelectSession(session.path)}
											title={session.path}
											type="button"
											key={session.id}
										>
											<div className="sidebar-session-main">
												<div className="sidebar-session-name">{session.name}</div>
												<div className="sidebar-session-meta">
													{formatTokens(session.tokens)} · {formatCost(session.cost)}
												</div>
											</div>
											<span className="sidebar-session-age">{formatRelativeDate(session.modifiedAt)}</span>
										</button>
									))}
								</div>
							)}
						</div>

						<div className="sidebar-panel-footer">{utilityActions}</div>
					</>
				) : (
					<>
						<div className="sidebar-files-tree">
							{!props.activeProject ? (
								<div className="sidebar-empty">Open a project tab to browse files</div>
							) : !props.fileState || props.fileState.rootLoading ? (
								<div className="sidebar-session-state">Loading files...</div>
							) : props.fileState.rootError ? (
								<div className="sidebar-session-state error">{props.fileState.rootError}</div>
							) : !props.fileState.rootChildren || props.fileState.rootChildren.length === 0 ? (
								<div className="sidebar-session-state">No files in this folder</div>
							) : (
								<FileTree
									nodes={props.fileState.rootChildren}
									depth={0}
									selectedPath={props.fileState.selectedPath}
									onSelectNode={props.onSelectFileNode}
									onToggleDirectory={props.onToggleDirectory}
									onOpenPath={props.onOpenPath}
								/>
							)}
						</div>

						<div className="sidebar-files-footer">
							{selectedRelativePath ? (
								<>
									<div className="sidebar-selected-path" title={props.fileState?.selectedPath ?? undefined}>
										{selectedRelativePath}
									</div>
									<div className="sidebar-selected-actions">
										<button className="sidebar-link-btn compact" onClick={props.onCopySelectedRelativePath} type="button">
											Copy path
										</button>
										<button className="sidebar-link-btn compact" onClick={props.onOpenSelectedPath} type="button">
											Open
										</button>
									</div>
								</>
							) : (
								<div className="sidebar-session-state">Select a file or folder</div>
							)}
							<div className="sidebar-utility-actions">{utilityActions}</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

export class Sidebar {
	private container: HTMLElement;
	private root: Root;
	private projects: Project[] = [];
	private activeProjectId: string | null = null;
	private panel: SidebarPanel = "sessions";
	private fileExplorerState = new Map<string, ProjectFileExplorerState>();

	private onOpenSettings: (() => void) | null = null;
	private onOpenExtensions: (() => void) | null = null;
	private onProjectSelect: ((project: { id: string; name: string; path: string }) => void) | null = null;
	private onSessionSelect: ((projectId: string, sessionPath: string) => void) | null = null;
	private onNewSessionInProject: ((project: { id: string; name: string; path: string }) => void) | null = null;
	private onProjectsChanged: ((projects: ProjectSummary[], activeId: string | null) => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
		this.loadPersistedProjects();
		this.loadPersistedPanel();
		this.render();

		const active = this.getActiveProjectRecord();
		if (active) {
			void this.loadSessionsForProject(active.id);
			if (this.panel === "files") {
				void this.ensureFileExplorerForProject(active.id);
			}
		}
	}

	setOnOpenSettings(cb: () => void): void {
		this.onOpenSettings = cb;
	}

	setOnOpenExtensions(cb: () => void): void {
		this.onOpenExtensions = cb;
	}

	setOnProjectsChanged(cb: (projects: ProjectSummary[], activeId: string | null) => void): void {
		this.onProjectsChanged = cb;
		this.emitProjectsChanged();
	}

	setOnProjectSelect(cb: (project: { id: string; name: string; path: string }) => void): void {
		this.onProjectSelect = cb;
	}

	setOnSessionSelect(cb: (projectId: string, sessionPath: string) => void): void {
		this.onSessionSelect = cb;
	}

	setOnNewSessionInProject(cb: (project: { id: string; name: string; path: string }) => void): void {
		this.onNewSessionInProject = cb;
	}

	getProjects(): ProjectSummary[] {
		return this.projects.map((project) => ({
			id: project.id,
			path: project.path,
			name: project.name,
		}));
	}

	getActiveProject(): { id: string; name: string; path: string } | null {
		const project = this.projects.find((x) => x.id === this.activeProjectId);
		return project ? { id: project.id, name: project.name, path: project.path } : null;
	}

	activateProject(projectId: string): void {
		this.selectProject(projectId);
	}

	closeProject(projectId: string): void {
		this.removeProject(projectId);
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

			const selectedNormalized = normalizePath(selected);
			const existing = this.projects.find((project) => normalizePath(project.path) === selectedNormalized);
			if (existing) {
				this.selectProject(existing.id);
				return;
			}

			const parts = selected.replace(/\\/g, "/").split("/");
			const name = parts[parts.length - 1] || selected;
			const project: Project = {
				id: crypto.randomUUID(),
				path: selected,
				name,
				color: stringToColor(name),
				sessions: [],
				loadingSessions: false,
			};

			this.projects.unshift(project);
			this.selectProject(project.id);
			await this.loadSessionsForProject(project.id);
			if (this.panel === "files") {
				await this.ensureFileExplorerForProject(project.id);
			}
		} catch (err) {
			console.error("Failed to open folder:", err);
		}
	}

	private setPanel(panel: SidebarPanel): void {
		if (this.panel === panel) return;
		this.panel = panel;
		localStorage.setItem(SIDEBAR_PANEL_STORAGE_KEY, panel);
		if (panel === "files") {
			const active = this.getActiveProjectRecord();
			if (active) {
				void this.ensureFileExplorerForProject(active.id);
			}
		}
		this.render();
	}

	private emitProjectsChanged(): void {
		this.onProjectsChanged?.(this.getProjects(), this.activeProjectId);
	}

	private selectProject(projectId: string): void {
		const project = this.projects.find((entry) => entry.id === projectId);
		if (!project) return;

		const changed = this.activeProjectId !== projectId;
		this.activeProjectId = projectId;

		if (!project.loadingSessions && project.sessions.length === 0) {
			void this.loadSessionsForProject(projectId);
		}
		if (this.panel === "files") {
			void this.ensureFileExplorerForProject(projectId);
		}

		this.persistProjects();
		this.render();
		this.emitProjectsChanged();

		if (changed) {
			this.onProjectSelect?.({ id: project.id, name: project.name, path: project.path });
		}
	}

	private async loadSessionsForProject(projectId: string): Promise<void> {
		const project = this.projects.find((entry) => entry.id === projectId);
		if (!project) return;

		project.loadingSessions = true;
		this.render();

		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const sessions = await invoke<
				Array<{
					id: string;
					name: string | null;
					path: string;
					cwd: string | null;
					modified_at: number;
					tokens: number;
					cost: number;
				}>
			>("list_sessions");

			const projectPath = normalizePath(project.path);
			const byProject = sessions.filter((session) => {
				const cwdPath = normalizePath(session.cwd);
				if (cwdPath && cwdPath === projectPath) return true;

				// fallback for migrated/legacy sessions without cwd in header
				const sessionPath = normalizePath(session.path);
				return sessionPath.includes(projectPath) || sessionPath.includes(normalizePath(project.name));
			});

			project.sessions = byProject.slice(0, 20).map((session) => ({
				id: session.id,
				name: session.name || "Untitled session",
				path: session.path,
				modifiedAt: session.modified_at,
				tokens: session.tokens ?? 0,
				cost: session.cost ?? 0,
			}));
		} catch (err) {
			console.error("Failed to load sessions:", err);
			project.sessions = [];
		} finally {
			project.loadingSessions = false;
			this.render();
		}
	}

	private async refreshSessions(): Promise<void> {
		const activeProject = this.getActiveProjectRecord();
		if (!activeProject || activeProject.loadingSessions) return;
		await this.loadSessionsForProject(activeProject.id);
	}

	private async ensureFileExplorerForProject(projectId: string): Promise<void> {
		const project = this.projects.find((entry) => entry.id === projectId);
		if (!project) return;

		const fileState = this.getOrCreateFileState(project);
		if (fileState.rootLoading || fileState.rootChildren !== null) return;

		fileState.rootLoading = true;
		fileState.rootError = null;
		this.render();

		try {
			fileState.rootChildren = await this.readDirectoryNodes(project.path);
		} catch (err) {
			console.error("Failed to load project files:", err);
			fileState.rootChildren = [];
			fileState.rootError = humanizeError(err);
		} finally {
			fileState.rootLoading = false;
			this.render();
		}
	}

	private async readDirectoryNodes(dirPath: string): Promise<FileTreeNode[]> {
		const { readDir } = await import("@tauri-apps/plugin-fs");
		const entries = await readDir(dirPath);

		return entries
			.filter((entry) => Boolean(entry.name))
			.map((entry) => {
				const name = entry.name as string;
				const path = joinFsPath(dirPath, name);
				return {
					id: path,
					name,
					path,
					isDirectory: Boolean(entry.isDirectory),
					expanded: false,
					loading: false,
					loadError: null,
					children: null,
				} as FileTreeNode;
			})
			.sort((a, b) => {
				if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
				return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
			});
	}

	private findFileNode(nodes: FileTreeNode[] | null, nodePath: string): FileTreeNode | null {
		if (!nodes) return null;
		for (const node of nodes) {
			if (node.path === nodePath) return node;
			if (node.isDirectory && node.children) {
				const inChildren = this.findFileNode(node.children, nodePath);
				if (inChildren) return inChildren;
			}
		}
		return null;
	}

	private async toggleDirectory(nodePath: string): Promise<void> {
		const activeProject = this.getActiveProjectRecord();
		if (!activeProject) return;

		const fileState = this.getOrCreateFileState(activeProject);
		const node = this.findFileNode(fileState.rootChildren, nodePath);
		if (!node || !node.isDirectory) return;

		node.expanded = !node.expanded;
		this.render();

		if (!node.expanded || node.children !== null || node.loading) return;

		node.loading = true;
		node.loadError = null;
		this.render();

		try {
			node.children = await this.readDirectoryNodes(node.path);
		} catch (err) {
			console.error("Failed to load directory:", err);
			node.children = [];
			node.loadError = humanizeError(err);
		} finally {
			node.loading = false;
			this.render();
		}
	}

	private selectFileNode(path: string, isDirectory: boolean): void {
		const activeProject = this.getActiveProjectRecord();
		if (!activeProject) return;
		const fileState = this.getOrCreateFileState(activeProject);
		fileState.selectedPath = path;
		fileState.selectedIsDirectory = isDirectory;
		this.render();
	}

	private async refreshFiles(): Promise<void> {
		const activeProject = this.getActiveProjectRecord();
		if (!activeProject) return;
		const fileState = this.getOrCreateFileState(activeProject);
		fileState.rootChildren = null;
		fileState.rootLoading = false;
		fileState.rootError = null;
		fileState.selectedPath = null;
		fileState.selectedIsDirectory = false;
		this.render();
		await this.ensureFileExplorerForProject(activeProject.id);
	}

	private async openPath(path: string): Promise<void> {
		try {
			const { open } = await import("@tauri-apps/plugin-shell");
			await open(path);
		} catch (err) {
			console.error("Failed to open path:", err);
		}
	}

	private async openSelectedPath(): Promise<void> {
		const activeProject = this.getActiveProjectRecord();
		if (!activeProject) return;
		const fileState = this.getOrCreateFileState(activeProject);
		const path = fileState.selectedPath || activeProject.path;
		await this.openPath(path);
	}

	private async copySelectedRelativePath(): Promise<void> {
		const activeProject = this.getActiveProjectRecord();
		if (!activeProject) return;
		const fileState = this.getOrCreateFileState(activeProject);
		if (!fileState.selectedPath) return;
		try {
			await navigator.clipboard.writeText(relativePathFromProject(activeProject.path, fileState.selectedPath));
		} catch (err) {
			console.error("Failed to copy path:", err);
		}
	}

	private selectSession(projectId: string, sessionPath: string): void {
		this.onSessionSelect?.(projectId, sessionPath);
	}

	private newSessionInProject(): void {
		const project = this.getActiveProjectRecord();
		if (!project) return;
		this.onNewSessionInProject?.({ id: project.id, name: project.name, path: project.path });
		setTimeout(() => {
			void this.loadSessionsForProject(project.id);
		}, 900);
	}

	private removeProject(projectId: string): void {
		const removedProject = this.projects.find((project) => project.id === projectId);
		if (!removedProject) return;

		const activeBefore = this.activeProjectId;
		this.projects = this.projects.filter((project) => project.id !== projectId);
		this.fileExplorerState.delete(projectId);

		if (this.activeProjectId === projectId) {
			this.activeProjectId = this.projects[0]?.id ?? null;
		}

		this.persistProjects();
		this.render();
		this.emitProjectsChanged();

		const activeAfter = this.getActiveProjectRecord();
		if (activeBefore !== this.activeProjectId && activeAfter) {
			if (!activeAfter.loadingSessions && activeAfter.sessions.length === 0) {
				void this.loadSessionsForProject(activeAfter.id);
			}
			if (this.panel === "files") {
				void this.ensureFileExplorerForProject(activeAfter.id);
			}
			this.onProjectSelect?.({ id: activeAfter.id, name: activeAfter.name, path: activeAfter.path });
		}

		if (this.projects.length === 0) {
			setTimeout(() => {
				void this.openFolder();
			}, 0);
		}
	}

	private persistProjects(): void {
		const data: PersistedProject[] = this.projects.map((project) => ({
			id: project.id,
			path: project.path,
			name: project.name,
			color: project.color,
		}));
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
		if (this.activeProjectId) {
			localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, this.activeProjectId);
		} else {
			localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
		}
	}

	private loadPersistedProjects(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;

			const data = JSON.parse(raw) as PersistedProject[];
			this.projects = data.map((project) => ({
				...project,
				sessions: [],
				loadingSessions: false,
			}));

			const activeId = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
			const activeExists = activeId ? this.projects.some((project) => project.id === activeId) : false;
			this.activeProjectId = activeExists ? activeId : this.projects[0]?.id ?? null;
		} catch {
			this.projects = [];
			this.activeProjectId = null;
		}
	}

	private loadPersistedPanel(): void {
		const stored = localStorage.getItem(SIDEBAR_PANEL_STORAGE_KEY);
		this.panel = stored === "files" ? "files" : "sessions";
	}

	private getActiveProjectRecord(): Project | null {
		return this.projects.find((project) => project.id === this.activeProjectId) ?? null;
	}

	private getOrCreateFileState(project: Project): ProjectFileExplorerState {
		const existing = this.fileExplorerState.get(project.id);
		if (existing && normalizePath(existing.projectPath) === normalizePath(project.path)) {
			return existing;
		}

		const next: ProjectFileExplorerState = {
			projectPath: project.path,
			rootLoading: false,
			rootError: null,
			rootChildren: null,
			selectedPath: null,
			selectedIsDirectory: false,
		};
		this.fileExplorerState.set(project.id, next);
		return next;
	}

	render(): void {
		const activeProject = this.getActiveProjectRecord();
		const fileState = activeProject ? this.getOrCreateFileState(activeProject) : null;

		if (this.panel === "files" && activeProject) {
			void this.ensureFileExplorerForProject(activeProject.id);
		}

		this.root.render(
			<SidebarView
				panel={this.panel}
				activeProject={activeProject}
				fileState={fileState}
				onSwitchPanel={(panel) => this.setPanel(panel)}
				onOpenExtensions={() => this.onOpenExtensions?.()}
				onOpenSettings={() => this.onOpenSettings?.()}
				onRefreshSessions={() => void this.refreshSessions()}
				onNewSessionInProject={() => this.newSessionInProject()}
				onSelectSession={(sessionPath) => {
					if (!activeProject) return;
					this.selectSession(activeProject.id, sessionPath);
				}}
				onRefreshFiles={() => void this.refreshFiles()}
				onToggleDirectory={(dirPath) => void this.toggleDirectory(dirPath)}
				onSelectFileNode={(path, isDirectory) => this.selectFileNode(path, isDirectory)}
				onOpenPath={(path) => void this.openPath(path)}
				onOpenSelectedPath={() => void this.openSelectedPath()}
				onCopySelectedRelativePath={() => void this.copySelectedRelativePath()}
			/>,
		);
	}

	destroy(): void {
		this.root.unmount();
	}
}
