/**
 * TitleBar - custom native-like frame with quick controls + live stats
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type CliUpdateStatus, type RpcSessionState, rpcBridge } from "../rpc/bridge.js";

interface SessionStats {
	tokens: { total?: number };
	cost?: number;
}

interface TitleBarViewProps {
	currentProject: string | null;
	modelId: string;
	thinkingLevel: string | undefined;
	tokens: string;
	cost: string;
	pending: number;
	updateAvailable: boolean;
	canUpdateInApp: boolean;
	cliUpdating: boolean;
	updateTitle: string;
	isMaximized: boolean;
	onNewSession: () => void;
	onOpenSessions: () => void;
	onOpenCommandPalette: () => void;
	onOpenSettings: () => void;
	onUpdateCli: () => void;
	onMinimize: () => void;
	onToggleMaximize: () => void;
	onClose: () => void;
}

function TitleBarView(props: TitleBarViewProps): ReactElement {
	return (
		<div className="titlebar" data-tauri-drag-region>
			<div className="titlebar-left" data-tauri-drag-region>
				<span className="titlebar-app">pi</span>
				{props.currentProject ? (
					<>
						<span className="titlebar-sep">/</span>
						<span className="titlebar-project">{props.currentProject}</span>
					</>
				) : null}
			</div>

			<div className="titlebar-center" data-tauri-drag-region>
				<span className="titlebar-model" title={props.modelId}>
					{props.modelId}
				</span>
				{props.thinkingLevel && props.thinkingLevel !== "off" ? (
					<span className="titlebar-pill thinking">{props.thinkingLevel}</span>
				) : null}
				{props.pending > 0 ? <span className="titlebar-pill queue">{props.pending} queued</span> : null}
				<span className="titlebar-meta">
					{props.tokens} tok · {props.cost}
				</span>
			</div>

			<div className="titlebar-right">
				<button className="titlebar-action" onClick={props.onNewSession} title="New session" type="button">
					New
				</button>
				<button className="titlebar-action" onClick={props.onOpenSessions} title="Sessions" type="button">
					Sessions
				</button>
				<button className="titlebar-action" onClick={props.onOpenCommandPalette} title="Commands" type="button">
					⌘K
				</button>
				{props.updateAvailable ? (
					<button
						className="titlebar-action update"
						disabled={props.cliUpdating}
						onClick={() => (props.canUpdateInApp ? props.onUpdateCli() : props.onOpenSettings())}
						title={props.updateTitle}
						type="button"
					>
						{props.cliUpdating ? "Updating…" : props.canUpdateInApp ? "Update CLI" : "CLI Update"}
					</button>
				) : null}
				<button className="titlebar-action" onClick={props.onOpenSettings} title="Settings" type="button">
					⚙
				</button>

				<button className="titlebar-window" onClick={props.onMinimize} title="Minimize" type="button">
					—
				</button>
				<button
					className="titlebar-window"
					onClick={props.onToggleMaximize}
					title={props.isMaximized ? "Restore" : "Maximize"}
					type="button"
				>
					{props.isMaximized ? "❐" : "□"}
				</button>
				<button className="titlebar-window close" onClick={props.onClose} title="Close" type="button">
					✕
				</button>
			</div>
		</div>
	);
}

export class TitleBar {
	private container: HTMLElement;
	private root: Root;
	private state: RpcSessionState | null = null;
	private currentProject: string | null = null;
	private isMaximized = false;
	private stats: SessionStats | null = null;
	private statsTimer: ReturnType<typeof setInterval> | null = null;
	private cliStatus: CliUpdateStatus | null = null;
	private cliUpdating = false;

	private onNewSession: (() => void) | null = null;
	private onOpenSessions: (() => void) | null = null;
	private onOpenCommandPalette: (() => void) | null = null;
	private onOpenSettings: (() => void) | null = null;
	private onUpdateCli: (() => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
		void this.checkMaximized();
		void this.refreshStats();
		this.startStatsRefresh();
		this.render();
	}

	updateState(state: RpcSessionState): void {
		this.state = state;
		void this.refreshStats();
		this.render();
	}

	setProject(project: string | null): void {
		this.currentProject = project;
		this.render();
	}

	setOnNewSession(cb: () => void): void {
		this.onNewSession = cb;
	}

	setOnOpenSessions(cb: () => void): void {
		this.onOpenSessions = cb;
	}

	setOnOpenCommandPalette(cb: () => void): void {
		this.onOpenCommandPalette = cb;
	}

	setOnOpenSettings(cb: () => void): void {
		this.onOpenSettings = cb;
	}

	setOnUpdateCli(cb: () => void): void {
		this.onUpdateCli = cb;
	}

	setCliUpdateStatus(status: CliUpdateStatus | null): void {
		this.cliStatus = status;
		this.render();
	}

	setCliUpdating(updating: boolean): void {
		this.cliUpdating = updating;
		this.render();
	}

	private startStatsRefresh(): void {
		this.stopStatsRefresh();
		this.statsTimer = setInterval(() => {
			void this.refreshStats();
		}, 8000);
	}

	private stopStatsRefresh(): void {
		if (!this.statsTimer) return;
		clearInterval(this.statsTimer);
		this.statsTimer = null;
	}

	private async refreshStats(): Promise<void> {
		try {
			const raw = await rpcBridge.getSessionStats();
			this.stats = {
				tokens: (raw.tokens as SessionStats["tokens"]) ?? {},
				cost: typeof raw.cost === "number" ? raw.cost : 0,
			};
			this.render();
		} catch {
			// not critical
		}
	}

	private async checkMaximized(): Promise<void> {
		try {
			this.isMaximized = await getCurrentWindow().isMaximized();
			this.render();
		} catch {
			// ignore (browser fallback)
		}
	}

	private async minimize(): Promise<void> {
		try {
			await getCurrentWindow().minimize();
		} catch {
			/* noop */
		}
	}

	private async toggleMaximize(): Promise<void> {
		try {
			const win = getCurrentWindow();
			if (this.isMaximized) await win.unmaximize();
			else await win.maximize();
			this.isMaximized = !this.isMaximized;
			this.render();
		} catch {
			/* noop */
		}
	}

	private async close(): Promise<void> {
		try {
			await getCurrentWindow().close();
		} catch {
			/* noop */
		}
	}

	private formatTokens(value: number | undefined): string {
		if (!value || value <= 0) return "0";
		if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
		if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
		return String(value);
	}

	private formatCost(value: number | undefined): string {
		if (!value || value <= 0) return "$0";
		if (value < 0.01) return `$${value.toFixed(4)}`;
		return `$${value.toFixed(2)}`;
	}

	destroy(): void {
		this.stopStatsRefresh();
		this.root.unmount();
	}

	render(): void {
		const modelId = this.state?.model?.id || "No model";
		const thinkingLevel = this.state?.thinkingLevel;
		const tokens = this.formatTokens(this.stats?.tokens?.total);
		const cost = this.formatCost(this.stats?.cost);
		const pending = this.state?.pendingMessageCount ?? 0;
		const updateAvailable = Boolean(this.cliStatus?.update_available);
		const canUpdateInApp = Boolean(this.cliStatus?.can_update_in_app && this.cliStatus?.npm_available);
		const updateTitle = this.cliStatus
			? `CLI ${this.cliStatus.current_version || "unknown"} → ${this.cliStatus.latest_version || "latest"}`
			: "CLI update status";

		this.root.render(
			<TitleBarView
				currentProject={this.currentProject}
				modelId={modelId}
				thinkingLevel={thinkingLevel}
				tokens={tokens}
				cost={cost}
				pending={pending}
				updateAvailable={updateAvailable}
				canUpdateInApp={canUpdateInApp}
				cliUpdating={this.cliUpdating}
				updateTitle={updateTitle}
				isMaximized={this.isMaximized}
				onNewSession={() => this.onNewSession?.()}
				onOpenSessions={() => this.onOpenSessions?.()}
				onOpenCommandPalette={() => this.onOpenCommandPalette?.()}
				onOpenSettings={() => this.onOpenSettings?.()}
				onUpdateCli={() => this.onUpdateCli?.()}
				onMinimize={() => void this.minimize()}
				onToggleMaximize={() => void this.toggleMaximize()}
				onClose={() => void this.close()}
			/>,
		);
	}
}
