/**
 * Sidebar - Codex-inspired project navigator
 */

import { type ReactElement } from "react";
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
	expanded: boolean;
	sessions: SidebarSession[];
	loadingSessions: boolean;
}

interface PersistedProject {
	id: string;
	path: string;
	name: string;
	color: string;
}

const STORAGE_KEY = "pi-desktop.projects.v1";

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

interface SidebarViewProps {
	projects: Project[];
	activeId: string | null;
	onOpenExtensions: () => void;
	onOpenSettings: () => void;
	onOpenFolder: () => void;
	onSelectProject: (projectId: string) => void;
	onToggleProject: (projectId: string) => void;
	onNewSessionInProject: (projectId: string) => void;
	onRemoveProject: (projectId: string) => void;
	onSelectSession: (projectId: string, sessionPath: string) => void;
}

function SidebarView(props: SidebarViewProps): ReactElement {
	return (
		<div className="sidebar-root">
			<div className="sidebar-top">
				<button className="sidebar-link-btn" onClick={props.onOpenExtensions} type="button">
					<span className="sidebar-link-icon accent">⚡</span>
					<span className="sidebar-link-label">Resources</span>
				</button>
			</div>

			<div className="sidebar-projects">
				<div className="sidebar-projects-header">
					<span>Projects</span>
					<button className="sidebar-compact-btn" onClick={props.onOpenFolder} title="Open project" type="button">
						+
					</button>
				</div>

				{props.projects.length === 0 ? (
					<div className="sidebar-empty">No projects</div>
				) : (
					props.projects.map((project) => (
						<div className="sidebar-project" key={project.id}>
							<div className="sidebar-project-row-group">
								<button
									className={`sidebar-project-btn ${props.activeId === project.id ? "active" : ""}`}
									onClick={() => {
										props.onSelectProject(project.id);
										props.onToggleProject(project.id);
									}}
									type="button"
								>
									<span className="sidebar-project-dot" style={{ background: project.color }}></span>
									<span className="sidebar-project-name">{project.name}</span>
									<span className="sidebar-project-chevron">{project.expanded ? "▾" : "▸"}</span>
								</button>
								<button
									className="sidebar-project-action"
									onClick={(e) => {
										e.stopPropagation();
										props.onNewSessionInProject(project.id);
									}}
									title="New session in project"
									type="button"
								>
									+
								</button>
								<button
									className="sidebar-project-action danger"
									onClick={(e) => {
										e.stopPropagation();
										props.onRemoveProject(project.id);
									}}
									title="Remove project"
									type="button"
								>
									✕
								</button>
							</div>

							{project.expanded ? (
								<div className="sidebar-session-list">
									{project.loadingSessions ? (
										<div className="sidebar-session-state">Loading sessions...</div>
									) : project.sessions.length === 0 ? (
										<div className="sidebar-session-state">No sessions</div>
									) : (
										project.sessions.map((session) => (
											<button
												className="sidebar-session-btn"
												onClick={() => props.onSelectSession(project.id, session.path)}
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
										))
									)}
								</div>
							) : null}
						</div>
					))
				)}
			</div>

			<div className="sidebar-bottom">
				<button className="sidebar-link-btn" onClick={props.onOpenFolder} type="button">
					<span className="sidebar-link-icon">📁</span>
					<span className="sidebar-link-label">Open Folder</span>
				</button>
				<button className="sidebar-link-btn" onClick={props.onOpenSettings} type="button">
					<span className="sidebar-link-icon">⚙️</span>
					<span className="sidebar-link-label">Settings</span>
				</button>
			</div>
		</div>
	);
}

export class Sidebar {
	private container: HTMLElement;
	private root: Root;
	private projects: Project[] = [];
	private activeProjectId: string | null = null;

	private onOpenSettings: (() => void) | null = null;
	private onOpenExtensions: (() => void) | null = null;
	private onProjectSelect: ((project: { id: string; name: string; path: string }) => void) | null = null;
	private onSessionSelect: ((projectId: string, sessionPath: string) => void) | null = null;
	private onNewSessionInProject: ((project: { id: string; name: string; path: string }) => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
		this.loadPersistedProjects();
		this.render();
	}

	setOnOpenSettings(cb: () => void): void {
		this.onOpenSettings = cb;
	}

	setOnOpenExtensions(cb: () => void): void {
		this.onOpenExtensions = cb;
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

	getActiveProject(): { id: string; name: string; path: string } | null {
		const p = this.projects.find((x) => x.id === this.activeProjectId);
		return p ? { id: p.id, name: p.name, path: p.path } : null;
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

			const existing = this.projects.find((p) => p.path === selected);
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
				expanded: true,
				sessions: [],
				loadingSessions: false,
			};

			this.projects.unshift(project);
			this.selectProject(project.id);
			this.persistProjects();
			await this.loadSessionsForProject(project.id);
		} catch (err) {
			console.error("Failed to open folder:", err);
		}
	}

	private selectProject(projectId: string): void {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		const changed = this.activeProjectId !== projectId;
		this.activeProjectId = projectId;
		this.render();
		if (changed) {
			this.onProjectSelect?.({ id: project.id, name: project.name, path: project.path });
		}
	}

	private toggleProject(projectId: string): void {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		project.expanded = !project.expanded;
		if (project.expanded && project.sessions.length === 0) {
			void this.loadSessionsForProject(projectId);
		}
		this.render();
	}

	private async loadSessionsForProject(projectId: string): Promise<void> {
		const project = this.projects.find((p) => p.id === projectId);
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
			const byProject = sessions.filter((s) => {
				const cwdPath = normalizePath(s.cwd);
				if (cwdPath && cwdPath === projectPath) return true;

				// fallback for migrated/legacy sessions without cwd in header
				const sessionPath = normalizePath(s.path);
				return sessionPath.includes(projectPath) || sessionPath.includes(normalizePath(project.name));
			});

			project.sessions = byProject.slice(0, 8).map((s) => ({
				id: s.id,
				name: s.name || "Untitled session",
				path: s.path,
				modifiedAt: s.modified_at,
				tokens: s.tokens ?? 0,
				cost: s.cost ?? 0,
			}));
		} catch (err) {
			console.error("Failed to load sessions:", err);
			project.sessions = [];
		} finally {
			project.loadingSessions = false;
			this.render();
		}
	}

	private selectSession(projectId: string, sessionPath: string): void {
		this.onSessionSelect?.(projectId, sessionPath);
	}

	private newSessionInProject(projectId: string): void {
		const project = this.projects.find((p) => p.id === projectId);
		if (!project) return;
		this.activeProjectId = project.id;
		project.expanded = true;
		this.render();
		this.onNewSessionInProject?.({ id: project.id, name: project.name, path: project.path });
		setTimeout(() => {
			void this.loadSessionsForProject(projectId);
		}, 900);
	}

	private removeProject(projectId: string): void {
		this.projects = this.projects.filter((p) => p.id !== projectId);
		if (this.activeProjectId === projectId) {
			this.activeProjectId = this.projects[0]?.id ?? null;
			if (this.projects[0]) {
				const p = this.projects[0];
				this.onProjectSelect?.({ id: p.id, name: p.name, path: p.path });
			}
		}
		this.persistProjects();
		this.render();
	}

	private persistProjects(): void {
		const data: PersistedProject[] = this.projects.map((p) => ({
			id: p.id,
			path: p.path,
			name: p.name,
			color: p.color,
		}));
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	}

	private loadPersistedProjects(): void {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const data = JSON.parse(raw) as PersistedProject[];
			this.projects = data.map((p) => ({
				...p,
				expanded: false,
				sessions: [],
				loadingSessions: false,
			}));
			this.activeProjectId = this.projects[0]?.id ?? null;
		} catch {
			this.projects = [];
			this.activeProjectId = null;
		}
	}

	render(): void {
		this.root.render(
			<SidebarView
				projects={this.projects}
				activeId={this.activeProjectId}
				onOpenExtensions={() => this.onOpenExtensions?.()}
				onOpenSettings={() => this.onOpenSettings?.()}
				onOpenFolder={() => void this.openFolder()}
				onSelectProject={(projectId) => this.selectProject(projectId)}
				onToggleProject={(projectId) => this.toggleProject(projectId)}
				onNewSessionInProject={(projectId) => this.newSessionInProject(projectId)}
				onRemoveProject={(projectId) => this.removeProject(projectId)}
				onSelectSession={(projectId, sessionPath) => this.selectSession(projectId, sessionPath)}
			/>,
		);
	}

	destroy(): void {
		this.root.unmount();
	}
}
