/**
 * Command Palette - slash commands + desktop actions
 */

import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rpcBridge } from "../rpc/bridge.js";

interface RpcCommand {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	location?: string;
	path?: string;
}

interface PaletteCommand {
	id: string;
	name: string;
	description: string;
	source: "extension" | "prompt" | "skill" | "builtin";
	commandText?: string;
	action?: () => Promise<void> | void;
}

interface BuiltinAction {
	name: string;
	description: string;
	action: () => Promise<void> | void;
}

export class CommandPalette {
	private container: HTMLElement;
	private root: Root;
	private isOpen = false;
	private commands: PaletteCommand[] = [];
	private filteredCommands: PaletteCommand[] = [];
	private searchQuery = "";
	private selectedIndex = 0;
	private onClose: (() => void) | null = null;
	private builtins: BuiltinAction[] = [];

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
		this.render();
	}

	setBuiltins(actions: BuiltinAction[]): void {
		this.builtins = actions;
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.searchQuery = "";
		this.selectedIndex = 0;
		await this.loadCommands();
		this.filterCommands();
		this.render();
		this.focusInput();
	}

	close(): void {
		this.isOpen = false;
		this.render();
		this.onClose?.();
	}

	private async loadCommands(): Promise<void> {
		let rpcCommands: RpcCommand[] = [];
		try {
			const result = await rpcBridge.getCommands();
			rpcCommands = result as unknown as RpcCommand[];
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

		const slashCommands: PaletteCommand[] = rpcCommands.map((cmd) => ({
			id: `${cmd.source}:${cmd.name}`,
			name: cmd.name,
			description: cmd.description || `Run /${cmd.name}`,
			source: cmd.source,
			commandText: `/${cmd.name}`,
		}));

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
				break;
			case "ArrowUp":
				e.preventDefault();
				this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
				this.render();
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

	private getSourceIcon(source: PaletteCommand["source"]): string {
		switch (source) {
			case "builtin":
				return "⌘";
			case "extension":
				return "∷";
			case "prompt":
				return "✎";
			case "skill":
				return "◇";
			default:
				return "•";
		}
	}

	private renderOpen(): ReactElement {
		return (
			<div
				className="overlay"
				onClick={(e) => {
					if (e.target === e.currentTarget) this.close();
				}}
			>
				<div className="command-palette-card">
					<div className="command-palette-search">
						<input
							type="text"
							placeholder="Search commands, skills, templates…"
							value={this.searchQuery}
							onInput={(e) => {
								this.searchQuery = e.currentTarget.value;
								this.filterCommands();
								this.render();
							}}
							onKeyDown={(e) => this.handleKeydown(e.nativeEvent)}
						/>
					</div>

					<div className="command-palette-list">
						{this.filteredCommands.length === 0 ? (
							<div className="overlay-empty">No command matches your query.</div>
						) : (
							this.filteredCommands.map((command, index) => (
								<button
									className={`command-row ${index === this.selectedIndex ? "selected" : ""}`}
									onClick={() => void this.executeCommand(command)}
									onMouseEnter={() => {
										this.selectedIndex = index;
										this.render();
									}}
									type="button"
									key={command.id}
								>
									<div className="command-row-icon">{this.getSourceIcon(command.source)}</div>
									<div className="command-row-main">
										<div className="command-row-title">{command.source === "builtin" ? command.name : `/${command.name}`}</div>
										<div className="command-row-subtitle">{command.description}</div>
									</div>
									<div className="command-row-source">{command.source}</div>
								</button>
							))
						)}
					</div>

					<div className="command-palette-footer">
						<span>
							<kbd>↑</kbd>
							<kbd>↓</kbd> navigate
						</span>
						<span>
							<kbd>Enter</kbd> run
						</span>
						<span>
							<kbd>Esc</kbd> close
						</span>
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
