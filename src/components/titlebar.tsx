/**
 * TitleBar - minimal native-like frame
 */

import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type CliUpdateStatus, type RpcSessionState } from "../rpc/bridge.js";

interface TitleBarViewProps {
	appVersion: string | null;
	isMaximized: boolean;
	onMinimize: () => void;
	onToggleMaximize: () => void;
	onClose: () => void;
}

function TitleBarView(props: TitleBarViewProps): ReactElement {
	const versionLabel = props.appVersion ? `v${props.appVersion}` : "dev";

	return (
		<div className="titlebar" data-tauri-drag-region>
			<div className="titlebar-left" data-tauri-drag-region>
				<span className="titlebar-build">PI-desktop {versionLabel}</span>
			</div>
			<div className="titlebar-center" data-tauri-drag-region></div>

			<div className="titlebar-right">
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
	private appVersion: string | null = null;

	private onNewSession: (() => void) | null = null;
	private onOpenSessions: (() => void) | null = null;
	private onOpenCommandPalette: (() => void) | null = null;
	private onOpenSettings: (() => void) | null = null;
	private onUpdateCli: (() => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
		void this.checkMaximized();
		void this.loadVersion();
		this.render();
	}

	updateState(state: RpcSessionState): void {
		this.state = state;
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

	setCliUpdateStatus(_status: CliUpdateStatus | null): void {
		// retained for API compatibility
	}

	setCliUpdating(_updating: boolean): void {
		// retained for API compatibility
	}

	private async loadVersion(): Promise<void> {
		try {
			this.appVersion = await getVersion();
		} catch {
			this.appVersion = null;
		}
		this.render();
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

	destroy(): void {
		this.root.unmount();
	}

	render(): void {
		this.root.render(
			<TitleBarView
				appVersion={this.appVersion}
				isMaximized={this.isMaximized}
				onMinimize={() => void this.minimize()}
				onToggleMaximize={() => void this.toggleMaximize()}
				onClose={() => void this.close()}
			/>,
		);
	}
}
