/**
 * Session Browser - resume, search, and fork sessions
 */

import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rpcBridge } from "../rpc/bridge.js";

interface SessionInfo {
	id: string;
	name?: string;
	path: string;
	cwd?: string;
	modifiedAt: number;
	tokens: number;
	cost: number;
}

interface ForkOption {
	entryId: string;
	text: string;
}

function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value || 0);
}

function formatCost(cost: number): string {
	if (!cost) return "$0";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

export class SessionBrowser {
	private container: HTMLElement;
	private root: Root;
	private isOpen = false;
	private sessions: SessionInfo[] = [];
	private filteredSessions: SessionInfo[] = [];
	private loading = false;
	private query = "";
	private onClose: (() => void) | null = null;
	private onSessionSelected: ((sessionPath: string) => void) | null = null;
	private onForkText: ((text: string) => void) | null = null;

	private forkMode = false;
	private forkOptions: ForkOption[] = [];
	private loadingForks = false;

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
		this.render();
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.loading = true;
		this.query = "";
		this.forkMode = false;
		this.forkOptions = [];
		this.render();
		await this.loadSessions();
		this.loading = false;
		this.applyFilter();
		this.render();
		this.focusSearch();
	}

	close(): void {
		this.isOpen = false;
		this.render();
		this.onClose?.();
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	setOnSessionSelected(callback: (sessionPath: string) => void): void {
		this.onSessionSelected = callback;
	}

	setOnForkText(callback: (text: string) => void): void {
		this.onForkText = callback;
	}

	private focusSearch(): void {
		setTimeout(() => {
			const input = this.container.querySelector("#session-search") as HTMLInputElement | null;
			input?.focus();
		}, 40);
	}

	private async loadSessions(): Promise<void> {
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

			this.sessions = sessions.map((s) => ({
				id: s.id,
				name: s.name ?? undefined,
				path: s.path,
				cwd: s.cwd ?? undefined,
				modifiedAt: s.modified_at,
				tokens: s.tokens,
				cost: s.cost,
			}));
		} catch (err) {
			console.error("Failed to load sessions:", err);
			this.sessions = [];
		}
	}

	private applyFilter(): void {
		const q = this.query.trim().toLowerCase();
		if (!q) {
			this.filteredSessions = [...this.sessions];
			return;
		}
		this.filteredSessions = this.sessions.filter((session) => {
			const haystack = `${session.name || ""} ${session.path} ${session.cwd || ""}`.toLowerCase();
			return haystack.includes(q);
		});
	}

	private async selectSession(session: SessionInfo): Promise<void> {
		try {
			const result = await rpcBridge.switchSession(session.path);
			if (result.cancelled) return;
			this.close();
			this.onSessionSelected?.(session.path);
		} catch (err) {
			console.error("Failed to switch session:", err);
		}
	}

	private async newSession(): Promise<void> {
		try {
			const result = await rpcBridge.newSession();
			if (!result.cancelled) {
				this.close();
				this.onSessionSelected?.("");
			}
		} catch (err) {
			console.error("Failed to create new session:", err);
		}
	}

	private async openForkMode(): Promise<void> {
		this.forkMode = true;
		this.loadingForks = true;
		this.render();
		try {
			this.forkOptions = await rpcBridge.getForkMessages();
		} catch (err) {
			console.error("Failed to load fork options:", err);
			this.forkOptions = [];
		} finally {
			this.loadingForks = false;
			this.render();
		}
	}

	private closeForkMode(): void {
		this.forkMode = false;
		this.forkOptions = [];
		this.render();
	}

	private async forkFrom(option: ForkOption): Promise<void> {
		try {
			const result = await rpcBridge.fork(option.entryId);
			if (!result.cancelled && result.text) {
				this.onForkText?.(result.text);
			}
			this.close();
			this.onSessionSelected?.("");
		} catch (err) {
			console.error("Failed to fork session:", err);
		}
	}

	private formatDate(timestamp: number): string {
		if (!timestamp) return "Unknown";
		const date = new Date(timestamp);
		const now = Date.now();
		const diff = now - date.getTime();
		const hours = Math.floor(diff / (1000 * 60 * 60));
		if (hours < 1) return "just now";
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString();
	}

	private renderOpen(): ReactElement {
		const list = this.filteredSessions;

		return (
			<div
				className="overlay"
				onClick={(e) => {
					if (e.target === e.currentTarget) this.close();
				}}
			>
				<div className="session-browser-card">
					<div className="session-browser-header">
						<div>
							<h2>{this.forkMode ? "Fork from Message" : "Sessions"}</h2>
							<p>{this.forkMode ? "Select a user message to fork from." : "Resume existing sessions across projects."}</p>
						</div>
						<div className="session-browser-actions">
							{this.forkMode ? (
								<button className="ghost-btn" onClick={() => this.closeForkMode()} type="button">
									Back
								</button>
							) : (
								<button className="ghost-btn" onClick={() => void this.newSession()} type="button">
									New Session
								</button>
							)}
							<button className="ghost-btn" onClick={() => this.close()} type="button">
								Close
							</button>
						</div>
					</div>

					{!this.forkMode ? (
						<div className="session-browser-search">
							<input
								id="session-search"
								type="text"
								placeholder="Search name, folder, or path..."
								value={this.query}
								onInput={(e) => {
									this.query = e.currentTarget.value;
									this.applyFilter();
									this.render();
								}}
							/>
						</div>
					) : null}

					<div className="session-browser-list">
						{this.forkMode ? (
							this.loadingForks ? (
								<div className="overlay-empty">Loading fork points...</div>
							) : this.forkOptions.length === 0 ? (
								<div className="overlay-empty">No fork points found.</div>
							) : (
								this.forkOptions.map((option) => (
									<button className="session-row" onClick={() => void this.forkFrom(option)} type="button" key={option.entryId}>
										<div className="session-row-main">{option.text.slice(0, 180)}</div>
										<div className="session-row-meta">fork here</div>
									</button>
								))
							)
						) : this.loading ? (
							<div className="overlay-empty">Loading sessions...</div>
						) : list.length === 0 ? (
							<div className="overlay-empty">No sessions found.</div>
						) : (
							list.map((session) => (
								<button className="session-row" onClick={() => void this.selectSession(session)} title={session.path} type="button" key={session.id}>
									<div className="session-row-main">
										<div className="session-row-title">{session.name || "Untitled Session"}</div>
										<div className="session-row-subtitle">{session.cwd || session.path}</div>
									</div>
									<div className="session-row-meta">
										<div>{this.formatDate(session.modifiedAt)}</div>
										<div>
											{formatTokens(session.tokens)} tok · {formatCost(session.cost)}
										</div>
									</div>
								</button>
							))
						)}
					</div>

					{!this.forkMode ? (
						<div className="session-browser-footer">
							<button className="ghost-btn" onClick={() => void this.openForkMode()} type="button">
								Fork current session
							</button>
							<button className="ghost-btn" onClick={() => void this.open()} type="button">
								Refresh
							</button>
						</div>
					) : null}
				</div>
			</div>
		);
	}

	render(): void {
		if (!this.isOpen) {
			this.root.render(<></>);
			return;
		}
		this.root.render(this.renderOpen());
	}

	destroy(): void {
		this.root.unmount();
	}
}
