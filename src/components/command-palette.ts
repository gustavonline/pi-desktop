/**
 * Command Palette - slash commands + desktop actions
 */

import { html, nothing, render } from "lit";
import { normalizeRuntimeSlashCommands } from "../commands/slash-command-runtime.js";
import { rpcBridge } from "../rpc/bridge.js";

interface PaletteCommand {
	id: string;
	name: string;
	description: string;
	source: string | "builtin";
	commandText?: string;
	action?: () => Promise<void> | void;
}

interface BuiltinAction {
	name: string;
	description: string;
	action: () => Promise<void> | void;
}

function normalizeCommandName(name: string): string {
	return name.trim().toLowerCase().replace(/^\/+/, "");
}

export class CommandPalette {
	private container: HTMLElement;
	private isOpen = false;
	private commands: PaletteCommand[] = [];
	private filteredCommands: PaletteCommand[] = [];
	private searchQuery = "";
	private selectedIndex = 0;
	private onClose: (() => void) | null = null;
	private onRunSlashCommand: ((commandText: string) => boolean | Promise<boolean>) | null = null;
	private builtins: BuiltinAction[] = [];

	constructor(container: HTMLElement) {
		this.container = container;
		this.render();
	}

	setBuiltins(actions: BuiltinAction[]): void {
		this.builtins = actions;
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	setOnRunSlashCommand(callback: ((commandText: string) => boolean | Promise<boolean>) | null): void {
		this.onRunSlashCommand = callback;
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.searchQuery = "";
		this.selectedIndex = 0;
		await this.loadCommands();
		this.filterCommands();
		this.render();
		this.focusInput();
		this.ensureSelectedCommandVisible();
	}

	close(): void {
		this.isOpen = false;
		this.render();
		this.onClose?.();
	}

	isVisible(): boolean {
		return this.isOpen;
	}

	private async loadCommands(): Promise<void> {
		let rpcCommands: Array<Record<string, unknown>> = [];
		try {
			const result = await rpcBridge.getCommands();
			rpcCommands = Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
		} catch (err) {
			console.error("Failed to load commands:", err);
		}

		const builtinCommands: PaletteCommand[] = this.builtins.map((action) => ({
			id: `builtin:${action.name}`,
			name: action.name,
			description: action.description,
			source: "builtin",
			action: action.action,
		}));

		const slashCommands: PaletteCommand[] = normalizeRuntimeSlashCommands(rpcCommands).map((command) => {
			const source = command.rawSource || command.source || "runtime";
			const name = normalizeCommandName(command.name);
			return {
				id: `${source}:${name}`,
				name,
				description: command.description,
				source,
				commandText: `/${name}`,
			};
		});

		this.commands = [...builtinCommands, ...slashCommands];
	}

	private filterCommands(): void {
		const query = this.searchQuery.toLowerCase().trim();
		if (!query) {
			this.filteredCommands = [...this.commands].slice(0, 30);
			this.selectedIndex = 0;
			return;
		}

		this.filteredCommands = this.commands
			.filter((cmd) => `${cmd.name} ${cmd.description}`.toLowerCase().includes(query))
			.slice(0, 30);
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredCommands.length - 1));
	}

	private async executeCommand(command: PaletteCommand): Promise<void> {
		try {
			if (command.source === "builtin" && command.action) {
				await command.action();
				this.close();
				return;
			}
			const text = command.commandText || `/${command.name}`;
			if (this.onRunSlashCommand) {
				const handled = await this.onRunSlashCommand(text);
				if (handled) {
					this.close();
					return;
				}
			}
			await rpcBridge.prompt(text);
			this.close();
		} catch (err) {
			console.error("Failed to execute command:", err);
		}
	}

	private handleKeydown(e: KeyboardEvent): void {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCommands.length - 1);
				this.render();
				this.ensureSelectedCommandVisible();
				break;
			case "ArrowUp":
				e.preventDefault();
				this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
				this.render();
				this.ensureSelectedCommandVisible();
				break;
			case "Enter":
				e.preventDefault();
				if (this.filteredCommands[this.selectedIndex]) {
					void this.executeCommand(this.filteredCommands[this.selectedIndex]);
				}
				break;
			case "Escape":
				e.preventDefault();
				this.close();
				break;
		}
	}

	private focusInput(): void {
		setTimeout(() => {
			const input = this.container.querySelector("input");
			input?.focus();
		}, 50);
	}

	private ensureSelectedCommandVisible(): void {
		requestAnimationFrame(() => {
			const list = this.container.querySelector<HTMLElement>(".command-palette-list");
			const selected = this.container.querySelector<HTMLElement>(".command-row.selected");
			if (!list || !selected) return;
			selected.scrollIntoView({ block: "nearest" });
		});
	}

	private getSourceIcon(source: PaletteCommand["source"]): string {
		switch (source) {
			case "builtin":
				return "⌘";
			case "extension":
				return "⚡";
			case "prompt":
				return "📝";
			case "skill":
				return "🎯";
			default:
				return "•";
		}
	}

	render(): void {
		if (!this.isOpen) {
			this.container.innerHTML = "";
			return;
		}

		const template = html`
			<div class="overlay" @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
				<div class="command-palette-card">
					<div class="command-palette-search">
						<input
							type="text"
							placeholder="Search commands, skills, templates…"
							.value=${this.searchQuery}
							@input=${(e: Event) => {
								this.searchQuery = (e.target as HTMLInputElement).value;
								this.filterCommands();
								this.render();
							}}
							@keydown=${(e: KeyboardEvent) => this.handleKeydown(e)}
						/>
					</div>

					<div class="command-palette-list">
						${this.filteredCommands.length === 0
							? html`<div class="overlay-empty">No command matches your query.</div>`
							: this.filteredCommands.map(
									(command, index) => html`
										<button
											class="command-row ${index === this.selectedIndex ? "selected" : ""}"
											@click=${() => this.executeCommand(command)}
											@mouseenter=${() => {
												this.selectedIndex = index;
												this.render();
											}}
										>
											<div class="command-row-icon">${this.getSourceIcon(command.source)}</div>
											<div class="command-row-main">
												<div class="command-row-title">${command.source === "builtin" ? command.name : `/${command.name}`}</div>
												<div class="command-row-subtitle">${command.description}</div>
											</div>
											<div class="command-row-source">${command.source}</div>
										</button>
									`,
							  )}
					</div>

					<div class="command-palette-footer">
						<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
						<span><kbd>Enter</kbd> run</span>
						<span><kbd>Esc</kbd> close</span>
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
