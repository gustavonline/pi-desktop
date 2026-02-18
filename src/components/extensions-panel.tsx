/**
 * Extensions Panel - discovered resources + package management
 */

import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rpcBridge } from "../rpc/bridge.js";

interface CommandInfo {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	location?: string;
	path?: string;
}

function getActiveProjectPath(): string {
	try {
		const raw = localStorage.getItem("pi-desktop.projects.v1");
		if (!raw) return ".";

		const projects = JSON.parse(raw) as Array<{ id?: string; path?: string }>;
		const activeId = localStorage.getItem("pi-desktop.projects.active.v1");
		if (activeId) {
			const activeProject = projects.find((project) => project.id === activeId);
			if (activeProject?.path) return activeProject.path;
		}

		return projects[0]?.path || ".";
	} catch {
		return ".";
	}
}

export class ExtensionsPanel {
	private container: HTMLElement;
	private root: Root;
	private isOpen = false;
	private loading = false;
	private runningCommand = false;
	private commands: CommandInfo[] = [];
	private onClose: (() => void) | null = null;

	private packageSource = "";
	private packageScope: "global" | "local" = "global";
	private commandOutput = "";
	private activeTab: "resources" | "packages" = "resources";

	constructor(container: HTMLElement) {
		this.container = container;
		this.root = createRoot(container);
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.loading = true;
		this.render();
		await this.loadResources();
		this.loading = false;
		this.render();
	}

	close(): void {
		this.isOpen = false;
		this.render();
		this.onClose?.();
	}

	private async loadResources(): Promise<void> {
		try {
			const commands = await rpcBridge.getCommands();
			this.commands = (commands as unknown as CommandInfo[]).sort((a, b) => a.source.localeCompare(b.source));
		} catch (err) {
			console.error("Failed to load extension resources:", err);
			this.commands = [];
		}
	}

	private renderBlock(title: string, entries: CommandInfo[], emptyLabel: string): ReactElement {
		return (
			<div className="resource-block">
				<div className="resource-title">{title}</div>
				{entries.length === 0 ? (
					<div className="resource-empty">{emptyLabel}</div>
				) : (
					entries.map((item) => (
						<div className="resource-row" title={item.path || ""} key={`${item.source}-${item.name}-${item.path || item.location || ""}`}>
							<div className="resource-main">/{item.name}</div>
							<div className="resource-meta">{item.description || item.location || item.path || item.source}</div>
						</div>
					))
				)}
			</div>
		);
	}

	private async runPackageCommand(args: string[]): Promise<void> {
		if (this.runningCommand) return;
		this.runningCommand = true;
		this.commandOutput = `${this.commandOutput ? `${this.commandOutput}\n\n` : ""}$ pi ${args.join(" ")}\n`;
		this.render();

		try {
			const cwd = this.packageScope === "local" ? getActiveProjectPath() : ".";
			const allArgs = this.packageScope === "local" ? [...args, "-l"] : args;
			const result = await rpcBridge.runPiCliCommand(allArgs, { cwd });

			const stdOut = result.stdout?.trim();
			const stdErr = result.stderr?.trim();
			this.commandOutput += [`[exit ${result.exit_code}] via ${result.discovery}`, stdOut, stdErr].filter(Boolean).join("\n") + "\n";

			if (result.exit_code === 0) {
				await this.loadResources();
			}
		} catch (err) {
			this.commandOutput += `Error: ${err instanceof Error ? err.message : String(err)}\n`;
		} finally {
			this.runningCommand = false;
			this.render();
		}
	}

	private async installPackage(): Promise<void> {
		const source = this.packageSource.trim();
		if (!source) return;
		await this.runPackageCommand(["install", source]);
	}

	private async removePackage(): Promise<void> {
		const source = this.packageSource.trim();
		if (!source) return;
		await this.runPackageCommand(["remove", source]);
	}

	private async updatePackages(): Promise<void> {
		const source = this.packageSource.trim();
		if (!source) {
			await this.runPackageCommand(["update"]);
			return;
		}
		await this.runPackageCommand(["update", source]);
	}

	private async listPackages(): Promise<void> {
		await this.runPackageCommand(["list"]);
	}

	private renderOpen(): ReactElement {
		const extensions = this.commands.filter((c) => c.source === "extension");
		const prompts = this.commands.filter((c) => c.source === "prompt");
		const skills = this.commands.filter((c) => c.source === "skill");

		return (
			<div
				className="overlay"
				onClick={(e) => {
					if (e.target === e.currentTarget) this.close();
				}}
			>
				<div className="extensions-card">
					<div className="extensions-header">
						<h2>Extensions, Skills & Packages</h2>
						<button onClick={() => this.close()} type="button">
							✕
						</button>
					</div>

					<div className="extensions-body">
						<div className="resource-tabs">
							<button
								className={`ghost-btn ${this.activeTab === "resources" ? "active-tab" : ""}`}
								onClick={() => {
									this.activeTab = "resources";
									this.render();
								}}
								type="button"
							>
								Discovered resources
							</button>
							<button
								className={`ghost-btn ${this.activeTab === "packages" ? "active-tab" : ""}`}
								onClick={() => {
									this.activeTab = "packages";
									this.render();
								}}
								type="button"
							>
								Package manager
							</button>
						</div>

						{this.activeTab === "resources" ? (
							this.loading ? (
								<div className="overlay-empty">Loading resources…</div>
							) : (
								<>
									{this.renderBlock(`Extensions (${extensions.length})`, extensions, "No extension commands discovered.")}
									{this.renderBlock(`Prompt templates (${prompts.length})`, prompts, "No prompt templates discovered.")}
									{this.renderBlock(`Skills (${skills.length})`, skills, "No skills discovered.")}
								</>
							)
						) : (
							<>
								<div className="package-controls">
									<input
										type="text"
										placeholder="npm:@scope/pkg or git:github.com/user/repo"
										value={this.packageSource}
										onInput={(e) => {
											this.packageSource = e.currentTarget.value;
											this.render();
										}}
									/>
									<select
										className="settings-select"
										value={this.packageScope}
										onChange={(e) => {
											this.packageScope = e.target.value as "global" | "local";
											this.render();
										}}
									>
										<option value="global">global (~/.pi/agent)</option>
										<option value="local">project (.pi)</option>
									</select>
								</div>

								<div className="settings-actions">
									<button
										className="ghost-btn"
										disabled={this.runningCommand || !this.packageSource.trim()}
										onClick={() => void this.installPackage()}
										type="button"
									>
										Install
									</button>
									<button
										className="ghost-btn"
										disabled={this.runningCommand || !this.packageSource.trim()}
										onClick={() => void this.removePackage()}
										type="button"
									>
										Remove
									</button>
									<button className="ghost-btn" disabled={this.runningCommand} onClick={() => void this.updatePackages()} type="button">
										Update
									</button>
									<button className="ghost-btn" disabled={this.runningCommand} onClick={() => void this.listPackages()} type="button">
										List
									</button>
								</div>

								<div className="resource-block">
									<div className="resource-title">Command Output</div>
									<pre className="tool-output" style={{ maxHeight: 280 }}>
										{this.commandOutput || "No command run yet."}
									</pre>
								</div>
							</>
						)}
					</div>

					<div className="extensions-footer">
						<button className="ghost-btn" onClick={() => void this.open()} type="button">
							Refresh
						</button>
						<span className="settings-desc">
							This runs real <code>pi install/remove/update/list</code> commands via the desktop backend.
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
