/**
 * Shortcuts Panel
 */

import { html, nothing, render } from "lit";

interface Shortcut {
	keys: string[];
	description: string;
	category: string;
}

const SHORTCUTS: Shortcut[] = [
	{ keys: ["Ctrl/Cmd+N"], description: "New session", category: "Session" },
	{ keys: ["Ctrl/Cmd+Shift+R"], description: "Open sessions browser", category: "Session" },
	{ keys: ["Ctrl/Cmd+Shift+H"], description: "Open session history viewer", category: "Session" },
	{ keys: ["Ctrl/Cmd+K"], description: "Open command palette", category: "Navigation" },
	{ keys: ["/"], description: "Open command palette (when editor not focused)", category: "Navigation" },
	{ keys: ["Ctrl+`", "Cmd+Alt+T"], description: "Toggle terminal dock", category: "Navigation" },
	{ keys: ["Ctrl/Cmd+L"], description: "Focus composer", category: "Input" },
	{ keys: ["Enter"], description: "Send message / steer when streaming", category: "Input" },
	{ keys: ["Alt+Enter"], description: "Queue follow-up message", category: "Input" },
	{ keys: ["Shift+Enter"], description: "Insert newline", category: "Input" },
	{ keys: ["Esc"], description: "Abort current run", category: "Agent" },
	{ keys: ["Ctrl/Cmd+M"], description: "Cycle model", category: "Model" },
	{ keys: ["Shift+Tab"], description: "Cycle thinking level", category: "Model" },
	{ keys: ["Ctrl/Cmd+T"], description: "Toggle thinking blocks", category: "Display" },
	{ keys: ["Ctrl/Cmd+Shift+C"], description: "Copy last assistant message", category: "Utility" },
	{ keys: ["Ctrl/Cmd+E"], description: "Export session as HTML", category: "Utility" },
	{ keys: ["Ctrl/Cmd+Shift+E"], description: "Copy exported HTML to clipboard", category: "Utility" },
	{ keys: ["Ctrl/Cmd+,"], description: "Open settings", category: "Navigation" },
	{ keys: ["Ctrl/Cmd+/"], description: "Open this shortcuts panel", category: "Navigation" },
	{ keys: ["Ctrl/Cmd+Shift+T"], description: "Toggle light/dark theme", category: "Display" },
];

export class ShortcutsPanel {
	private container: HTMLElement;
	private isOpen = false;
	private onClose: (() => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
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

	isVisible(): boolean {
		return this.isOpen;
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	render(): void {
		if (!this.isOpen) {
			this.container.innerHTML = "";
			return;
		}

		const grouped = SHORTCUTS.reduce(
			(acc, shortcut) => {
				if (!acc[shortcut.category]) acc[shortcut.category] = [];
				acc[shortcut.category].push(shortcut);
				return acc;
			},
			{} as Record<string, Shortcut[]>,
		);

		const categories = ["Navigation", "Session", "Input", "Model", "Display", "Utility", "Agent"];

		const template = html`
			<div class="overlay" @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
				<div class="shortcuts-card">
					<div class="shortcuts-header">
						<h2>Keyboard shortcuts</h2>
						<button @click=${() => this.close()}>✕</button>
					</div>
					<div class="shortcuts-body">
						${categories.map((category) => {
							const entries = grouped[category];
							if (!entries || entries.length === 0) return nothing;
							return html`
								<div class="shortcuts-group">
									<div class="shortcuts-group-title">${category}</div>
									${entries.map(
										(entry) => html`
											<div class="shortcut-row">
												<span>${entry.description}</span>
												<div class="shortcut-keys">
													${entry.keys.map((key) => html`<kbd>${key}</kbd>`) }
												</div>
											</div>
										`,
									)}
								</div>
							`;
						})}
					</div>
				</div>
			</div>
		`;

		render(template, this.container);
	}

	destroy(): void {
		this.container.innerHTML = "";
	}
}
