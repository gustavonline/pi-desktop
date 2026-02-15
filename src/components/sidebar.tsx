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
		<div className="h-full bg-[#171717] border-r border-[#262626] flex flex-col w-64">
			<div className="p-2 border-b border-[#262626] space-y-1">
				<button
					className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#262626] transition-colors text-left"
					onClick={props.onOpenExtensions}
					type="button"
				>
					<span className="text-amber-400">⚡</span>
					<span className="text-sm text-gray-200">Resources</span>
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-2">
				<div className="flex items-center justify-between px-2 mb-2">
					<span className="text-[11px] uppercase tracking-wide text-gray-500">Projects</span>
					<button className="text-gray-500 hover:text-gray-300 text-xs" onClick={props.onOpenFolder} title="Open project" type="button">
						+
					</button>
				</div>

				{props.projects.length === 0 ? (
					<div className="px-2 py-2 text-xs text-gray-500">No projects</div>
				) : (
					props.projects.map((project) => (
						<div className="mb-1" key={project.id}>
							<div className="group flex items-center gap-1">
								<button
									className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
										props.activeId === project.id ? "bg-[#262626]" : "hover:bg-[#222]"
									}`}
									onClick={() => {
										props.onSelectProject(project.id);
										props.onToggleProject(project.id);
									}}
									type="button"
								>
									<span className="w-2 h-2 rounded-full shrink-0" style={{ background: project.color }}></span>
									<span className="text-sm text-gray-200 truncate flex-1 text-left">{project.name}</span>
									<span className="text-gray-500 text-xs">{project.expanded ? "▾" : "▸"}</span>
								</button>
								<button
									className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-blue-400 text-xs px-1.5"
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
									className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-1.5"
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
								<div className="ml-4 mt-1 space-y-0.5">
									{project.loadingSessions ? (
										<div className="px-2 py-1 text-[11px] text-gray-500">Loading sessions...</div>
									) : project.sessions.length === 0 ? (
										<div className="px-2 py-1 text-[11px] text-gray-500">No sessions</div>
									) : (
										project.sessions.map((session) => (
											<button
												className="w-full flex items-center justify-between px-2 py-1 rounded hover:bg-[#222] text-left"
												onClick={() => props.onSelectSession(project.id, session.path)}
												title={session.path}
												type="button"
												key={session.id}
											>
												<div className="min-w-0">
													<div className="text-[11px] text-gray-400 truncate">{session.name}</div>
													<div className="text-[10px] text-gray-600">
														{formatTokens(session.tokens)} · {formatCost(session.cost)}
													</div>
												</div>
												<span className="text-[10px] text-gray-600 ml-2">{formatRelativeDate(session.modifiedAt)}</span>
											</button>
										))
									)}
								</div>
							) : null}
						</div>
					))
				)}
			</div>

			<div className="p-2 border-t border-[#262626] space-y-1">
				<button
					className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#262626] transition-colors text-left"
					onClick={props.onOpenFolder}
					type="button"
				>
					<span className="text-gray-400">📁</span>
					<span className="text-sm text-gray-300">Open Folder</span>
				</button>
				<button
					className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#262626] transition-colors text-left"
					onClick={props.onOpenSettings}
					type="button"
				>
					<span className="text-gray-400">⚙️</span>
					<span className="text-sm text-gray-300">Settings</span>
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
