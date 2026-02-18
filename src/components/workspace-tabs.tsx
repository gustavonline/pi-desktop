/**
 * Workspace Tabs - project-per-tab navigation (Warp/Chrome style)
 */

import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

export interface WorkspaceProjectTab {
	id: string;
	name: string;
	path: string;
}

interface WorkspaceTabsViewProps {
	tabs: WorkspaceProjectTab[];
	activeId: string | null;
	onOpenProject: () => void;
	onSelectTab: (projectId: string) => void;
	onCloseTab: (projectId: string) => void;
}

function WorkspaceTabsView(props: WorkspaceTabsViewProps): ReactElement {
	return (
		<div className="workspace-tabs-root" data-tauri-drag-region>
			<div className="workspace-tabs-scroll" data-tauri-drag-region>
				{props.tabs.length === 0 ? (
					<div className="workspace-tabs-empty">No project tabs</div>
				) : (
					props.tabs.map((tab) => {
						const isActive = tab.id === props.activeId;

						return (
							<div className={`workspace-tab ${isActive ? "active" : ""}`} key={tab.id}>
								<button
									className="workspace-tab-main"
									onClick={() => props.onSelectTab(tab.id)}
									title={tab.path}
									type="button"
								>
									<span className="workspace-tab-label">{tab.name}</span>
								</button>
								<button
									className="workspace-tab-close"
									onClick={(event) => {
										event.stopPropagation();
										props.onCloseTab(tab.id);
									}}
									title={`Close ${tab.name}`}
									type="button"
								>
									✕
								</button>
							</div>
						);
					})
				)}
			</div>

			<button className="workspace-tab-add" onClick={props.onOpenProject} title="Open project in new tab" type="button">
				+
			</button>
		</div>
	);
}

export class WorkspaceTabs {
	private container: HTMLElement;
	private root: Root;
	private tabs: WorkspaceProjectTab[] = [];
	private activeId: string | null = null;

	private onOpenProject: (() => void) | null = null;
	private onSelectTab: ((projectId: string) => void) | null = null;
	private onCloseTab: ((projectId: string) => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
		this.render();
	}

	setTabs(tabs: WorkspaceProjectTab[], activeId: string | null): void {
		this.tabs = tabs;
		this.activeId = activeId;
		this.render();
	}

	setOnOpenProject(cb: () => void): void {
		this.onOpenProject = cb;
	}

	setOnSelectTab(cb: (projectId: string) => void): void {
		this.onSelectTab = cb;
	}

	setOnCloseTab(cb: (projectId: string) => void): void {
		this.onCloseTab = cb;
	}

	render(): void {
		this.root.render(
			<WorkspaceTabsView
				tabs={this.tabs}
				activeId={this.activeId}
				onOpenProject={() => this.onOpenProject?.()}
				onSelectTab={(projectId) => this.onSelectTab?.(projectId)}
				onCloseTab={(projectId) => this.onCloseTab?.(projectId)}
			/>,
		);
	}

	destroy(): void {
		this.root.unmount();
	}
}
