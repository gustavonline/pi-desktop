/**
 * Shortcuts Panel
 */

import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

interface Shortcut {
	keys: string[];
	description: string;
	category: string;
}

const SHORTCUTS: Shortcut[] = [
	{ keys: ["Ctrl/Cmd+N"], description: "New session", category: "Session" },
	{ keys: ["Ctrl/Cmd+R"], description: "Open sessions browser", category: "Session" },
	{ keys: ["Ctrl/Cmd+K"], description: "Open command palette", category: "Navigation" },
	{ keys: ["/"], description: "Open command palette (when editor not focused)", category: "Navigation" },
	{ keys: ["Ctrl/Cmd+L"], description: "Focus composer", category: "Input" },
	{ keys: ["Enter"], description: "Send message / steer when streaming", category: "Input" },
	{ keys: ["Alt+Enter"], description: "Queue follow-up message", category: "Input" },
	{ keys: ["Shift+Enter"], description: "Insert newline", category: "Input" },
	{ keys: ["Esc"], description: "Abort current run", category: "Agent" },
	{ keys: ["Ctrl/Cmd+M"], description: "Cycle model", category: "Model" },
	{ keys: ["Shift+Tab"], description: "Cycle thinking level", category: "Model" },
	{ keys: ["Ctrl/Cmd+T"], description: "Toggle thinking blocks", category: "Display" },
	{ keys: ["Ctrl/Cmd+,"], description: "Open settings", category: "Navigation" },
	{ keys: ["Ctrl/Cmd+/"], description: "Open this shortcuts panel", category: "Navigation" },
	{ keys: ["Ctrl/Cmd+Shift+T"], description: "Toggle light/dark theme", category: "Display" },
];

export class ShortcutsPanel {
	private container: HTMLElement;
	private root: Root;
	private isOpen = false;
	private onClose: (() => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
		this.render();
	}

	open(): void {
		this.isOpen = true;
		this.render();
	}

	close(): void {
		this.isOpen = false;
		this.render();
		this.onClose?.();
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	private renderOpen(): ReactElement {
		const grouped = SHORTCUTS.reduce(
			(acc, shortcut) => {
				if (!acc[shortcut.category]) acc[shortcut.category] = [];
				acc[shortcut.category].push(shortcut);
				return acc;
			},
			{} as Record<string, Shortcut[]>,
		);

		const categories = ["Navigation", "Session", "Input", "Model", "Display", "Agent"];

		return (
			<div
				className="overlay"
				onClick={(e) => {
					if (e.target === e.currentTarget) this.close();
				}}
			>
				<div className="shortcuts-card">
					<div className="shortcuts-header">
						<h2>Keyboard shortcuts</h2>
						<button onClick={() => this.close()} type="button">
							✕
						</button>
					</div>
					<div className="shortcuts-body">
						{categories.map((category) => {
							const entries = grouped[category];
							if (!entries || entries.length === 0) return null;
							return (
								<div className="shortcuts-group" key={category}>
									<div className="shortcuts-group-title">{category}</div>
									{entries.map((entry) => (
										<div className="shortcut-row" key={`${category}-${entry.description}`}>
											<span>{entry.description}</span>
											<div className="shortcut-keys">
												{entry.keys.map((key) => (
													<kbd key={`${entry.description}-${key}`}>{key}</kbd>
												))}
											</div>
										</div>
									))}
								</div>
							);
						})}
					</div>
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
