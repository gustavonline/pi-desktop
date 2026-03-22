/**
 * PackagesView - package/config/resource management surface shown in main pane
 */

import { html, nothing, render, type TemplateResult } from "lit";
import { normalizeRecommendedSource, RECOMMENDED_PACKAGES, type RecommendedPackageDefinition } from "../recommended-packages.js";
import { rpcBridge } from "../rpc/bridge.js";

interface CatalogPackageItem {
	name: string;
	description: string;
	version: string;
	npmUrl: string;
	score: number;
}

interface InstalledPackageItem {
	source: string;
	location: string;
	scope: "user" | "project";
}

interface InstalledDisplayItem extends InstalledPackageItem {
	displayName: string;
	openUrl: string | null;
}

interface PackageConfigCommand {
	name: string;
	description: string;
	path: string;
}

interface ModelOption {
	provider: string;
	id: string;
	label: string;
}

type UiIcon =
	| "package"
	| "extension"
	| "skill"
	| "theme"
	| "prompt"
	| "open"
	| "settings"
	| "plus"
	| "remove";

const PACKAGES_CATALOG_URL = "https://shittycodingagent.ai/packages";
const PACKAGES_SEARCH_URL = "https://registry.npmjs.org/-/v1/search?text=keywords:pi-package&size=250";

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of items) {
		const key = getKey(item);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

function parsePiListOutput(output: string): { user: InstalledPackageItem[]; project: InstalledPackageItem[] } {
	const user: InstalledPackageItem[] = [];
	const project: InstalledPackageItem[] = [];
	let section: "user" | "project" | null = null;
	let pending: InstalledPackageItem | null = null;

	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.replace(/\t/g, "    ");
		const trimmed = line.trim();
		if (!trimmed) continue;

		if (/^User packages:/i.test(trimmed)) {
			section = "user";
			pending = null;
			continue;
		}
		if (/^Project packages:/i.test(trimmed)) {
			section = "project";
			pending = null;
			continue;
		}
		if (!section) continue;
		if (/^\(none\)$/i.test(trimmed)) {
			pending = null;
			continue;
		}

		if (/^\s{4}\S/.test(line) && pending) {
			pending.location = trimmed;
			continue;
		}

		if (/^\s{2}\S/.test(line)) {
			pending = {
				source: trimmed,
				location: "",
				scope: section,
			};
			if (section === "user") user.push(pending);
			else project.push(pending);
		}
	}

	return { user, project };
}

function normalizeFsPath(path: string | null | undefined): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isLikelyConfigCommand(name: string, description: string): boolean {
	const haystack = `${name} ${description}`.toLowerCase();
	return /(^|[-_\s])config(?:$|[-_\s])/.test(haystack) ||
		/(^|\b)(configure|settings|setup)(\b|$)/.test(haystack);
}

function npmPackageNameFromSource(source: string): string {
	if (!source) return "";
	if (source.startsWith("npm:")) return source.slice(4).trim().toLowerCase();
	if (/^[@a-z0-9][\w./-]*$/i.test(source) && !source.includes(":")) return source.trim().toLowerCase();
	return "";
}

function pathMatchesNpmPackage(normalizedPath: string, source: string): boolean {
	const packageName = npmPackageNameFromSource(source);
	if (!packageName) return false;
	return normalizedPath.includes(`/node_modules/${packageName}/`) || normalizedPath.endsWith(`/node_modules/${packageName}`);
}

function commandLikelyNeedsModelArg(command: PackageConfigCommand): boolean {
	const haystack = `${command.name} ${command.description}`.toLowerCase();
	return /(^|\b)(model|provider)(\b|$)/.test(haystack) || haystack.includes("provider/model");
}

function modelRef(provider: string, id: string): string {
	return `${provider}/${id}`;
}

function icon(name: UiIcon): TemplateResult {
	switch (name) {
		case "package":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 5.1L8 2.4l5.2 2.7L8 7.8z"></path><path d="M2.8 5.1V11L8 13.7V7.8"></path><path d="M13.2 5.1V11L8 13.7"></path></svg>`;
		case "extension":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.1 3.2a2.1 2.1 0 1 1 3.8 1.2h1a1.8 1.8 0 0 1 1.8 1.8v1.1H9.8"></path><path d="M9.9 12.8a2.1 2.1 0 1 1-3.8-1.2h-1a1.8 1.8 0 0 1-1.8-1.8V8.7h2.9"></path><path d="M7.9 5.6v4.8"></path></svg>`;
		case "skill":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.4l1.7 3.6 3.9.5-2.9 2.8.8 3.9L8 11.3l-3.5 1.9.8-3.9-2.9-2.8 3.9-.5z"></path></svg>`;
		case "theme":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.4a5.6 5.6 0 1 0 0 11.2c1.4 0 1.9-.8 1.9-1.5 0-.5-.2-1 .6-1h1.2a1.9 1.9 0 0 0 1.9-1.9A5.6 5.6 0 0 0 8 2.4z"></path><circle cx="5.3" cy="6.4" r=".8"></circle><circle cx="8" cy="5.4" r=".8"></circle><circle cx="10.6" cy="6.5" r=".8"></circle></svg>`;
		case "prompt":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.1 2.8h5.4l2.4 2.4V13H4.1z"></path><path d="M9.5 2.8v2.4h2.4"></path><path d="M5.8 8h4.4"></path><path d="M5.8 10.2h3.4"></path></svg>`;
		case "open":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7"></path><path d="M13 3L5.4 10.6"></path><path d="M12.5 9v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"></path></svg>`;
		case "settings":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 4h4.5"></path><path d="M9.8 4h3.4"></path><circle cx="8.3" cy="4" r="1.3"></circle><path d="M2.8 8h2.3"></path><path d="M7.2 8h6"></path><circle cx="6" cy="8" r="1.3"></circle><path d="M2.8 12h5.7"></path><path d="M10.5 12h2.7"></path><circle cx="9.1" cy="12" r="1.3"></circle></svg>`;
		case "plus":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.4v9.2"></path><path d="M3.4 8h9.2"></path></svg>`;
		case "remove":
			return html`<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.4 4.4l7.2 7.2"></path><path d="M11.6 4.4l-7.2 7.2"></path></svg>`;
	}
}

function sourceKindLabel(kind: "npm" | "git" | "url" | "local" | "unknown"): string {
	switch (kind) {
		case "npm":
			return "npm";
		case "git":
			return "git";
		case "url":
			return "url";
		case "local":
			return "local";
		default:
			return "source";
	}
}

export class PackagesView {
	private container: HTMLElement;
	private catalogItems: CatalogPackageItem[] = [];
	private installedUser: InstalledPackageItem[] = [];
	private installedProject: InstalledPackageItem[] = [];

	private loadingCatalog = false;
	private loadingConfig = false;
	private runningCommand = false;
	private catalogError = "";
	private configError = "";
	private commandStatus = "";
	private commandOutput = "";
	private packageScope: "global" | "local" = "global";
	private query = "";
	private currentProjectPath: string | null = null;
	private onBack: (() => void) | null = null;
	private packageConfigCommands = new Map<string, PackageConfigCommand[]>();
	private activePackageConfigSource: string | null = null;
	private activePackageConfigLabel = "";
	private runningConfigCommand = false;
	private packageConfigStatus = "";
	private packageConfigCommandArgs = new Map<string, string>();
	private configModels: ModelOption[] = [];
	private configModelsLoading = false;
	private configModelsLoaded = false;
	private configModelsError = "";

	constructor(container: HTMLElement) {
		this.container = container;
		this.render();
	}

	setProjectPath(path: string | null): void {
		this.currentProjectPath = path;
		if (!path && this.packageScope === "local") {
			this.packageScope = "global";
		}
		this.render();
	}

	setOnBack(cb: () => void): void {
		this.onBack = cb;
	}

	setQuery(query: string): void {
		if (this.query === query) return;
		this.query = query;
		this.render();
	}

	getQuery(): string {
		return this.query;
	}

	async open(): Promise<void> {
		await Promise.all([this.loadCatalog(this.catalogItems.length === 0), this.loadConfig()]);
	}

	async openCatalog(): Promise<void> {
		await this.openExternal(PACKAGES_CATALOG_URL);
	}

	async refreshPackages(forceCatalog = false): Promise<void> {
		await Promise.all([this.loadCatalog(forceCatalog), this.loadConfig()]);
	}

	private async openExternal(url: string): Promise<void> {
		try {
			const { open } = await import("@tauri-apps/plugin-shell");
			await open(url);
		} catch {
			window.open(url, "_blank", "noopener,noreferrer");
		}
	}

	private normalizeQuery(): string {
		return this.query.trim().toLowerCase();
	}

	private async loadCatalog(force = false): Promise<void> {
		if (!force && this.catalogItems.length > 0) {
			this.render();
			return;
		}
		if (this.loadingCatalog) return;

		this.loadingCatalog = true;
		this.catalogError = "";
		this.render();

		try {
			const response = await fetch(PACKAGES_SEARCH_URL);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const payload = (await response.json()) as {
				objects?: Array<{
					package?: {
						name?: string;
						description?: string;
						version?: string;
						links?: { npm?: string };
					};
					score?: { final?: number };
				}>;
			};

			this.catalogItems = (payload.objects ?? [])
				.map((entry) => {
					const pkg = entry.package;
					if (!pkg?.name) return null;
					return {
						name: pkg.name,
						description: pkg.description ?? "",
						version: pkg.version ?? "",
						npmUrl: pkg.links?.npm ?? `https://www.npmjs.com/package/${pkg.name}`,
						score: entry.score?.final ?? 0,
					} satisfies CatalogPackageItem;
				})
				.filter((item): item is CatalogPackageItem => item !== null)
				.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
		} catch (err) {
			this.catalogError = err instanceof Error ? err.message : String(err);
		} finally {
			this.loadingCatalog = false;
			this.render();
		}
	}

	private async loadConfig(): Promise<void> {
		if (this.loadingConfig) return;

		this.loadingConfig = true;
		this.configError = "";
		this.render();

		try {
			const [userListResult, projectListResult] = await Promise.all([
				rpcBridge.runPiCliCommand(["list"], { cwd: "/" }),
				this.currentProjectPath
					? rpcBridge.runPiCliCommand(["list"], { cwd: this.currentProjectPath }).catch(() => null)
					: Promise.resolve(null),
			]);

			const parsedUser = parsePiListOutput(userListResult.stdout ?? "");
			const parsedProject = projectListResult ? parsePiListOutput(projectListResult.stdout ?? "") : { user: [], project: [] };

			this.installedUser = uniqueBy([...parsedUser.user, ...parsedProject.user], (item) => item.source);
			this.installedProject = uniqueBy([...parsedUser.project, ...parsedProject.project], (item) => item.source);
			await this.refreshPackageConfigCommands();
			if (this.activePackageConfigSource && !this.isNormalizedSourceInstalled(this.activePackageConfigSource)) {
				this.closeActivePackageConfig();
			}
		} catch (err) {
			this.configError = err instanceof Error ? err.message : String(err);
		} finally {
			this.loadingConfig = false;
			this.render();
		}
	}

	private async refreshPackageConfigCommands(): Promise<void> {
		const installedItems = this.getInstalledItems(false);
		if (installedItems.length === 0) {
			this.packageConfigCommands = new Map();
			return;
		}

		let commands: Array<Record<string, unknown>> = [];
		try {
			commands = await rpcBridge.getCommands();
		} catch {
			this.packageConfigCommands = new Map();
			return;
		}

		const bySource = new Map<string, PackageConfigCommand[]>();
		for (const item of installedItems) {
			const key = normalizeRecommendedSource(item.source);
			if (!bySource.has(key)) bySource.set(key, []);
		}

		for (const raw of commands) {
			const source = typeof raw.source === "string" ? raw.source : "";
			const name = typeof raw.name === "string" ? raw.name.trim() : "";
			const description = typeof raw.description === "string" ? raw.description.trim() : "";
			const path = typeof raw.path === "string" ? raw.path : "";

			if (source !== "extension" || !name || !path) continue;
			if (!isLikelyConfigCommand(name, description)) continue;

			const normalizedPath = normalizeFsPath(path);
			if (!normalizedPath) continue;

			for (const item of installedItems) {
				const normalizedSource = normalizeRecommendedSource(item.source);
				const list = bySource.get(normalizedSource);
				if (!list) continue;

				const normalizedLocation = normalizeFsPath(item.location);
				const locationMatches = normalizedLocation
					? normalizedPath === normalizedLocation || normalizedPath.startsWith(`${normalizedLocation}/`)
					: false;
				const npmFallbackMatches = !locationMatches && pathMatchesNpmPackage(normalizedPath, item.source);
				if (!locationMatches && !npmFallbackMatches) continue;

				if (list.some((command) => command.name === name)) continue;
				list.push({ name, description, path });
			}
		}

		for (const list of bySource.values()) {
			list.sort((a, b) => a.name.localeCompare(b.name));
		}

		this.packageConfigCommands = bySource;
	}

	private packageConfigCommandKey(source: string, commandName: string): string {
		return `${normalizeRecommendedSource(source)}::${commandName.trim().toLowerCase()}`;
	}

	private getPackageConfigCommandArg(source: string, commandName: string): string {
		const key = this.packageConfigCommandKey(source, commandName);
		return this.packageConfigCommandArgs.get(key) ?? "";
	}

	private setPackageConfigCommandArg(source: string, commandName: string, value: string): void {
		const key = this.packageConfigCommandKey(source, commandName);
		if (!value) {
			this.packageConfigCommandArgs.delete(key);
			return;
		}
		this.packageConfigCommandArgs.set(key, value);
	}

	private mapModelOptions(models: Array<Record<string, unknown>>): ModelOption[] {
		const mapped: ModelOption[] = [];
		const seen = new Set<string>();
		for (const raw of models) {
			const provider = typeof raw.provider === "string"
				? raw.provider.trim()
				: typeof raw.providerId === "string"
					? raw.providerId.trim()
					: typeof raw.provider_id === "string"
						? raw.provider_id.trim()
						: "";
			const id = typeof raw.id === "string"
				? raw.id.trim()
				: typeof raw.modelId === "string"
					? raw.modelId.trim()
					: typeof raw.model_id === "string"
						? raw.model_id.trim()
						: typeof raw.model === "string"
							? raw.model.trim()
							: "";
			if (!provider || !id) continue;
			const ref = modelRef(provider, id);
			if (seen.has(ref)) continue;
			seen.add(ref);
			mapped.push({ provider, id, label: ref });
		}
		return mapped.sort((a, b) => a.label.localeCompare(b.label));
	}

	private seedModelArgsForSource(source: string, commands: PackageConfigCommand[]): void {
		if (this.configModels.length === 0) return;
		const fallback = modelRef(this.configModels[0].provider, this.configModels[0].id);
		for (const command of commands) {
			if (!commandLikelyNeedsModelArg(command)) continue;
			const currentArg = this.getPackageConfigCommandArg(source, command.name);
			if (currentArg) continue;
			this.setPackageConfigCommandArg(source, command.name, fallback);
		}
	}

	private async ensureConfigModelsLoaded(force = false): Promise<void> {
		if (this.configModelsLoading) return;
		if (this.configModelsLoaded && !force) return;

		this.configModelsLoading = true;
		this.configModelsError = "";
		this.render();
		try {
			const models = await rpcBridge.getAvailableModels().catch(() => []);
			this.configModels = this.mapModelOptions(models as Array<Record<string, unknown>>);
			this.configModelsLoaded = true;

			if (this.activePackageConfigSource) {
				const commands = this.packageConfigCommands.get(this.activePackageConfigSource) ?? [];
				this.seedModelArgsForSource(this.activePackageConfigSource, commands);
			}
		} catch (err) {
			this.configModels = [];
			this.configModelsLoaded = true;
			this.configModelsError = err instanceof Error ? err.message : String(err);
		} finally {
			this.configModelsLoading = false;
			this.render();
		}
	}

	private getConfigCommandsForItem(item: InstalledDisplayItem): PackageConfigCommand[] {
		const normalizedSource = normalizeRecommendedSource(item.source);
		return this.packageConfigCommands.get(normalizedSource) ?? [];
	}

	private isNormalizedSourceInstalled(normalizedSource: string): boolean {
		return this.getInstalledItems(false).some((item) => normalizeRecommendedSource(item.source) === normalizedSource);
	}

	private openPackageConfig(item: InstalledDisplayItem): void {
		const source = normalizeRecommendedSource(item.source);
		const commands = this.getConfigCommandsForItem(item);
		this.activePackageConfigSource = source;
		this.activePackageConfigLabel = item.displayName;
		this.packageConfigStatus = "";
		if (this.configModelsLoaded) {
			this.seedModelArgsForSource(source, commands);
		}
		if (commands.some((command) => commandLikelyNeedsModelArg(command))) {
			void this.ensureConfigModelsLoaded();
		}
		this.render();
	}

	private closeActivePackageConfig(): void {
		this.activePackageConfigSource = null;
		this.activePackageConfigLabel = "";
		this.packageConfigStatus = "";
		this.render();
	}

	private async runPackageConfigCommand(command: PackageConfigCommand, args = ""): Promise<void> {
		if (this.runningConfigCommand || this.runningCommand) return;
		this.runningConfigCommand = true;
		const slashCommand = command.name.startsWith("/") ? command.name : `/${command.name}`;
		const trimmedArgs = args.trim();
		const promptText = trimmedArgs ? `${slashCommand} ${trimmedArgs}` : slashCommand;
		const supportsModelPicker = commandLikelyNeedsModelArg(command);
		const actionVerb = supportsModelPicker ? "save" : "apply";
		const actionVerbPast = supportsModelPicker ? "Saved" : "Applied";
		this.packageConfigStatus = `${actionVerb[0].toUpperCase()}${actionVerb.slice(1)} package setting…`;
		this.render();
		try {
			await rpcBridge.prompt(promptText);
			this.packageConfigStatus = `${actionVerbPast} package setting.`;
			this.commandStatus = `${actionVerbPast} package setting for ${this.activePackageConfigLabel || "package"}.`;
			this.commandOutput += `${this.commandOutput ? "\n" : ""}[package-config] ${promptText}\n`;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.packageConfigStatus = `Failed to ${actionVerb} package setting: ${message}`;
			this.commandStatus = `Config command failed: ${message}`;
		}
		this.runningConfigCommand = false;
		this.render();
	}

	private renderPackageConfigCommandEditor(source: string, command: PackageConfigCommand): TemplateResult {
		const currentArgs = this.getPackageConfigCommandArg(source, command.name);
		const supportsModelPicker = commandLikelyNeedsModelArg(command);
		const selectedModel = this.configModels.some((model) => modelRef(model.provider, model.id) === currentArgs) ? currentArgs : "";
		const modelSelectValue = selectedModel || currentArgs || "";
		const title = command.description?.trim() || "Package setting";
		const buttonLabel = supportsModelPicker ? "Save" : "Apply";
		const buttonBusyLabel = supportsModelPicker ? "Saving…" : "Applying…";

		return html`
			<div class="packages-config-command-card">
				<div class="packages-config-command-name">${title}</div>
				<div class="packages-config-command-desc">${supportsModelPicker ? "Choose model and save." : "Apply command arguments."}</div>

				${supportsModelPicker
					? html`
						<div class="packages-config-field">
							<label class="packages-config-field-label">Model</label>
							<select
								class="packages-config-select"
								.value=${modelSelectValue}
								?disabled=${this.configModelsLoading || this.runningConfigCommand || this.runningCommand}
								@change=${(event: Event) => {
									const value = (event.target as HTMLSelectElement).value;
									this.setPackageConfigCommandArg(source, command.name, value);
									this.render();
								}}
							>
								${this.configModelsLoading ? html`<option value="">Loading models…</option>` : nothing}
								${!this.configModelsLoading ? html`<option value="">Use package default</option>` : nothing}
								${!this.configModelsLoading && currentArgs && !selectedModel ? html`<option value=${currentArgs}>${currentArgs}</option>` : nothing}
								${this.configModels.map((model) => {
									const ref = modelRef(model.provider, model.id);
									return html`<option value=${ref}>${model.label}</option>`;
								})}
							</select>
						</div>
					`
					: html`
						<div class="packages-config-field">
							<label class="packages-config-field-label">Arguments</label>
							<input
								class="packages-config-input"
								type="text"
								placeholder="Optional command arguments"
								.value=${currentArgs}
								?disabled=${this.runningConfigCommand || this.runningCommand}
								@input=${(event: Event) => {
									const value = (event.target as HTMLInputElement).value;
									this.setPackageConfigCommandArg(source, command.name, value);
									this.render();
								}}
							/>
						</div>
					`}

				<div class="packages-config-command-actions">
					<button
						class="ghost-btn"
						?disabled=${this.runningConfigCommand || this.runningCommand}
						@click=${() => void this.runPackageConfigCommand(command, this.getPackageConfigCommandArg(source, command.name))}
					>
						${this.runningConfigCommand ? buttonBusyLabel : buttonLabel}
					</button>
				</div>
			</div>
		`;
	}

	private renderPackageConfigModal(): TemplateResult | typeof nothing {
		if (!this.activePackageConfigSource) return nothing;
		const source = this.activePackageConfigSource;
		const commands = this.packageConfigCommands.get(source) ?? [];
		const hasModelCommand = commands.some((command) => commandLikelyNeedsModelArg(command));

		return html`
			<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && this.closeActivePackageConfig()}>
				<div class="overlay-card packages-config-modal">
					<div class="overlay-header">
						<div>
							<div class="packages-config-modal-title">Package settings · ${this.activePackageConfigLabel}</div>
							<div class="packages-config-modal-sub">Configure package capabilities directly from Packages.</div>
						</div>
						<button @click=${() => this.closeActivePackageConfig()}>✕</button>
					</div>
					<div class="overlay-body packages-config-modal-body">
						${commands.length === 0
							? html`
								<div class="packages-empty">
									No package config commands were discovered. This package appears to only add runtime capabilities.
								</div>
							`
							: commands.map((command) => this.renderPackageConfigCommandEditor(source, command))}

						<div class="packages-config-modal-actions">
							<button class="ghost-btn" ?disabled=${this.loadingConfig || this.runningCommand} @click=${() => void this.refreshPackages(false)}>
								Refresh package commands
							</button>
							${hasModelCommand
								? html`
									<button class="ghost-btn" ?disabled=${this.configModelsLoading || this.runningConfigCommand} @click=${() => void this.ensureConfigModelsLoaded(true)}>
										${this.configModelsLoading ? "Refreshing models…" : "Refresh models"}
									</button>
								`
								: nothing}
							<button class="ghost-btn" @click=${() => this.closeActivePackageConfig()}>Close</button>
						</div>

						${this.configModelsError ? html`<div class="packages-config-inline-error">Model lookup failed: ${this.configModelsError}</div>` : nothing}
						${this.packageConfigStatus ? html`<div class="packages-section-submeta">${this.packageConfigStatus}</div>` : nothing}
					</div>
				</div>
			</div>
		`;
	}

	private getDisplayName(source: string): string {
		if (source.startsWith("npm:")) return source.slice(4);
		if (source.startsWith("git:")) return source.slice(4);
		if (source.startsWith("github:")) return source.slice(7);
		if (source.startsWith("file:")) return source.slice(5);
		return source;
	}

	private resolveSourceUrl(source: string): string | null {
		if (!source) return null;
		if (/^https?:\/\//i.test(source)) return source;
		if (source.startsWith("npm:")) return `https://www.npmjs.com/package/${source.slice(4)}`;
		if (source.startsWith("github:")) return `https://github.com/${source.slice(7).replace(/^\/+/, "")}`;
		if (source.startsWith("git:")) {
			const rest = source.slice(4).replace(/^\/+/, "");
			if (/^https?:\/\//i.test(rest)) return rest;
			if (/^[\w.-]+\/[\w./-]+(@.+)?$/i.test(rest)) return `https://${rest.replace(/@.+$/, "")}`;
			return `https://${rest}`;
		}
		if (/^[@a-z0-9][\w./-]*$/i.test(source)) return `https://www.npmjs.com/package/${source}`;
		return null;
	}

	private matchesRecommendedSource(installedSource: string, definition: RecommendedPackageDefinition): boolean {
		const normalizedInstalledSource = normalizeRecommendedSource(installedSource);
		const candidates = [definition.source, ...(definition.aliases ?? [])].map((value) => normalizeRecommendedSource(value));
		return candidates.includes(normalizedInstalledSource);
	}

	private getRecommendedInstallState(definition: RecommendedPackageDefinition): { global: boolean; project: boolean } {
		return {
			global: this.installedUser.some((item) => this.matchesRecommendedSource(item.source, definition)),
			project: this.installedProject.some((item) => this.matchesRecommendedSource(item.source, definition)),
		};
	}

	private getInstalledItems(applyQuery = true): InstalledDisplayItem[] {
		const combined = [
			...this.installedProject.map((item) => ({ ...item, scope: "project" as const })),
			...this.installedUser.map((item) => ({ ...item, scope: "user" as const })),
		];

		const unique = uniqueBy(combined, (item) => `${item.scope}:${item.source}`)
			.map(
				(item) =>
					({
						...item,
						displayName: this.getDisplayName(item.source),
						openUrl: this.resolveSourceUrl(item.source),
					} satisfies InstalledDisplayItem),
			)
			.sort((a, b) => a.displayName.localeCompare(b.displayName));

		if (!applyQuery) return unique;
		const q = this.normalizeQuery();
		if (!q) return unique;
		return unique.filter((item) => `${item.displayName} ${item.source} ${item.location}`.toLowerCase().includes(q));
	}

	private filteredCatalogItems(): CatalogPackageItem[] {
		const q = this.normalizeQuery();
		if (!q) return this.catalogItems;
		return this.catalogItems.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(q));
	}

	private getEffectiveScope(scope: "global" | "local"): "global" | "local" {
		if (scope === "local" && !this.currentProjectPath) {
			return "global";
		}
		return scope;
	}

	private async executePackageCommand(
		args: string[],
		options: {
			scope: "global" | "local";
			appendLocalFlag: boolean;
			statusText: string;
			refreshOnSuccess?: boolean;
		},
	): Promise<boolean> {
		if (this.runningCommand) return false;

		const scope = this.getEffectiveScope(options.scope);
		if (scope === "local" && !this.currentProjectPath) {
			this.commandStatus = "Project actions need an active project in this workspace.";
			this.render();
			return false;
		}

		this.runningCommand = true;
		this.commandStatus = options.statusText;
		const finalArgs = options.appendLocalFlag && scope === "local" ? [...args, "-l"] : args;
		const cwd = scope === "local" ? this.currentProjectPath ?? "." : "/";
		this.commandOutput = `${this.commandOutput ? `${this.commandOutput}\n\n` : ""}$ pi ${finalArgs.join(" ")}\n`;
		this.render();

		try {
			const result = await rpcBridge.runPiCliCommand(finalArgs, { cwd });
			const stdOut = result.stdout?.trim();
			const stdErr = result.stderr?.trim();
			this.commandOutput += [
				`[exit ${result.exit_code}] via ${result.discovery}`,
				stdOut,
				stdErr,
			]
				.filter(Boolean)
				.join("\n") + "\n";

			if (result.exit_code !== 0) {
				this.commandStatus = (stdErr || stdOut || `Command failed (exit ${result.exit_code})`).trim();
				return false;
			}

			if (options.refreshOnSuccess) {
				await this.refreshPackages(true);
			}
			return true;
		} catch (err) {
			this.commandStatus = `Command failed: ${err instanceof Error ? err.message : String(err)}`;
			return false;
		} finally {
			this.runningCommand = false;
			this.render();
		}
	}

	private async installPackage(source: string, scope: "global" | "local"): Promise<void> {
		const trimmed = source.trim();
		if (!trimmed) return;
		const effectiveScope = this.getEffectiveScope(scope);
		const success = await this.executePackageCommand(["install", trimmed], {
			scope: effectiveScope,
			appendLocalFlag: true,
			statusText: `Installing ${trimmed} (${effectiveScope === "local" ? "project" : "global"})…`,
			refreshOnSuccess: true,
		});
		if (success) {
			this.commandStatus = effectiveScope === "local"
				? `Installed in project settings: ${trimmed}`
				: `Installed globally: ${trimmed}`;
		}
	}

	private async removePackage(source: string, scope: "global" | "local"): Promise<void> {
		const trimmed = source.trim();
		if (!trimmed) return;
		const effectiveScope = this.getEffectiveScope(scope);
		const success = await this.executePackageCommand(["remove", trimmed], {
			scope: effectiveScope,
			appendLocalFlag: true,
			statusText: `Removing ${trimmed} (${effectiveScope === "local" ? "project" : "global"})…`,
			refreshOnSuccess: true,
		});
		if (success) {
			this.commandStatus = effectiveScope === "local"
				? `Removed from project settings: ${trimmed}`
				: `Removed from global settings: ${trimmed}`;
		}
	}

	private async updatePackages(): Promise<void> {
		const effectiveScope = this.getEffectiveScope(this.packageScope);
		const success = await this.executePackageCommand(["update"], {
			scope: effectiveScope,
			appendLocalFlag: false,
			statusText: "Updating installed packages…",
			refreshOnSuccess: true,
		});
		if (success) {
			this.commandStatus = `Updated ${effectiveScope === "local" ? "project" : "global"} packages.`;
		}
	}

	private async listPackages(): Promise<void> {
		const effectiveScope = this.getEffectiveScope(this.packageScope);
		const success = await this.executePackageCommand(["list"], {
			scope: effectiveScope,
			appendLocalFlag: false,
			statusText: "Refreshing installed package list…",
			refreshOnSuccess: true,
		});
		if (success) {
			this.commandStatus = `Refreshed ${effectiveScope === "local" ? "project" : "global"} package list.`;
		}
	}

	private async installRecommendedPackage(definition: RecommendedPackageDefinition, scope: "global" | "local"): Promise<void> {
		await this.installPackage(definition.source, scope);
	}

	private async addCatalogItem(item: CatalogPackageItem): Promise<void> {
		await this.installPackage(`npm:${item.name}`, this.packageScope);
	}

	private async openInstalledItem(item: InstalledDisplayItem): Promise<void> {
		if (!item.openUrl) return;
		await this.openExternal(item.openUrl);
	}

	private statusTone(): "info" | "success" | "error" {
		const text = this.commandStatus.toLowerCase();
		if (!text) return "info";
		if (text.includes("failed") || text.includes("error")) return "error";
		if (text.startsWith("installed") || text.startsWith("removed") || text.startsWith("updated") || text.startsWith("refreshed")) {
			return "success";
		}
		return "info";
	}

	private getNotifyDebugLines(): string[] {
		const getter = (window as typeof window & {
			__PI_DESKTOP_GET_TRACE__?: () => string[];
		}).__PI_DESKTOP_GET_TRACE__;
		if (typeof getter !== "function") return [];
		try {
			const lines = getter();
			return lines
				.filter((line) => {
					const lower = line.toLowerCase();
					return lower.includes("notify:") || lower.includes("notify-action") || lower.includes("notify-target") || lower.includes("extension_ui_request") || lower.includes("rpc:event") || lower.includes("parse-failed");
				})
				.slice(-24);
		} catch {
			return [];
		}
	}

	private async runDesktopNotificationSmokeTest(): Promise<void> {
		if (this.runningCommand) return;
		this.runningCommand = true;
		this.commandStatus = "Testing desktop notification…";
		this.render();
		try {
			const { isPermissionGranted, requestPermission, sendNotification } = await import("@tauri-apps/plugin-notification");
			let granted = await isPermissionGranted();
			if (!granted) {
				const permission = await requestPermission();
				granted = permission === "granted";
				this.commandOutput += `${this.commandOutput ? "\n" : ""}[notify-test] permission=${permission}\n`;
			}
			if (!granted) {
				this.commandStatus = "Notification permission denied by OS.";
				return;
			}
			sendNotification({
				title: "Pi Desktop",
				body: "Desktop notification smoke test",
				autoCancel: true,
				sound: "Ping",
				extra: { source: "packages-notify-smoke" },
			});
			this.commandOutput += `${this.commandOutput ? "\n" : ""}[notify-test] sent via tauri notification plugin\n`;
			this.commandStatus = "Desktop notification test sent.";
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.commandOutput += `${this.commandOutput ? "\n" : ""}[notify-test] failed: ${message}\n`;
			this.commandStatus = `Notification test failed: ${message}`;
		} finally {
			this.runningCommand = false;
			this.render();
		}
	}

	private isRecommendedPackageInstalledForScope(scope: "global" | "local", state: { global: boolean; project: boolean }): boolean {
		return scope === "local" ? state.project : state.global;
	}

	private isSourceInstalledForScope(source: string, scope: "global" | "local"): boolean {
		const normalizedSource = normalizeRecommendedSource(source);
		const installedPool = scope === "local" ? this.installedProject : this.installedUser;
		return installedPool.some((item) => normalizeRecommendedSource(item.source) === normalizedSource);
	}

	private resolveInstalledRemoveSource(item: InstalledDisplayItem): string {
		const source = item.source.trim();
		const location = item.location.trim();
		const localLike =
			source.startsWith("./") ||
			source.startsWith("../") ||
			source.startsWith("/") ||
			source.startsWith("~/") ||
			source.startsWith("file:") ||
			/^[a-zA-Z]:[\\/]/.test(source);
		if (localLike && location) return location;
		return source;
	}

	private renderPackageRow(options: {
		title: string;
		description: string;
		note?: string | null;
		badges?: TemplateResult[];
		iconName?: UiIcon;
		actions?: TemplateResult | typeof nothing;
		titleAttr?: string;
	}): TemplateResult {
		return html`
			<div class="packages-list-row" title=${options.titleAttr ?? ""}>
				<div class="packages-list-row-icon ${options.iconName === "extension" ? "extension" : ""}">
					<span class="packages-inline-icon">${icon(options.iconName ?? "package")}</span>
				</div>
				<div class="packages-list-row-main">
					<div class="packages-list-row-top">
						<div class="packages-list-row-title">${options.title}</div>
						${options.badges && options.badges.length > 0
							? html`<div class="packages-list-row-badges">${options.badges}</div>`
							: nothing}
					</div>
					<div class="packages-list-row-sub">${options.description}</div>
					${options.note ? html`<div class="packages-list-row-note">${options.note}</div>` : nothing}
				</div>
				${options.actions ? html`<div class="packages-list-row-actions">${options.actions}</div>` : nothing}
			</div>
		`;
	}

	render(): void {
		const installedItems = this.getInstalledItems();
		const catalogItems = this.filteredCatalogItems();
		const recommendedPackages = RECOMMENDED_PACKAGES.filter((item) => {
			const q = this.normalizeQuery();
			if (!q) return true;
			return `${item.name} ${item.description} ${item.installSourceHint}`.toLowerCase().includes(q);
		});
		const effectiveScope = this.getEffectiveScope(this.packageScope);
		const installTarget = effectiveScope === "local" ? "Project" : "Global";
		const discoverItems = catalogItems;
		const notifyDebugLines = this.getNotifyDebugLines();
		const hasDiagnostics = true;
		const diagnosticsOpen = this.runningCommand || this.statusTone() === "error";

		const template = html`
			<div class="packages-view-root">
				<div class="packages-view-header">
					<div class="packages-view-title-wrap">
						<div class="packages-view-title">Packages</div>
						<div class="packages-view-meta">
							${this.loadingConfig
								? "Refreshing package state…"
								: `${installedItems.length} installed · ${recommendedPackages.length} recommended`}
						</div>
					</div>
					<div class="packages-view-header-actions">
						<button class="packages-back-btn" ?disabled=${this.runningCommand} @click=${() => void this.refreshPackages(true)}>Refresh</button>
						<button class="packages-back-btn" @click=${() => void this.openCatalog()}>Gallery</button>
						${this.onBack
							? html`<button class="packages-back-btn" @click=${() => this.onBack?.()}>← Back</button>`
							: nothing}
					</div>
				</div>

				<div class="packages-view-body minimal">
					${this.commandStatus ? html`<div class="packages-banner ${this.statusTone()}">${this.commandStatus}</div>` : nothing}
					${this.configError ? html`<div class="packages-banner error">Config error: ${this.configError}</div>` : nothing}
					${this.catalogError ? html`<div class="packages-banner error">Catalog error: ${this.catalogError}</div>` : nothing}

					<section class="packages-section packages-top-strip">
						<div class="packages-scope-toggle" role="tablist" aria-label="Install target scope">
							<button
								class="packages-scope-btn ${effectiveScope === "global" ? "active" : ""}"
								?disabled=${this.runningCommand}
								@click=${() => {
									this.packageScope = "global";
									this.render();
								}}
							>
								Global
							</button>
							<button
								class="packages-scope-btn ${effectiveScope === "local" ? "active" : ""}"
								?disabled=${this.runningCommand || !this.currentProjectPath}
								@click=${() => {
									this.packageScope = "local";
									this.render();
								}}
							>
								Project
							</button>
						</div>
						<div class="packages-scope-note">
							${effectiveScope === "local"
								? this.currentProjectPath
									? `Installing into project: ${this.currentProjectPath}`
									: "Open a project to install project-local packages"
								: "Global is default and available across projects"}
						</div>
					</section>

					<section class="packages-section">
						<div class="packages-section-head">
							<div>
								<div class="packages-section-title">Installed</div>
								<div class="packages-section-submeta">Scope is shown per package.</div>
							</div>
							<div class="packages-section-meta">${installedItems.length}</div>
						</div>
						${installedItems.length === 0
							? html`<div class="packages-empty">No packages installed yet.</div>`
							: html`
								<div class="packages-list packages-list-grid">
									${installedItems.map((item) =>
										this.renderPackageRow({
											title: item.displayName,
											description: item.source,
											badges: [
												html`<span class="packages-card-scope ${item.scope === "project" ? "project" : "global-installed"}">${item.scope === "project" ? "Project" : "Global"}</span>`,
											],
											actions: html`
												${item.openUrl
													? html`<button class="packages-card-action" title="Open package page" @click=${() => void this.openInstalledItem(item)}>${icon("open")}</button>`
													: nothing}
												<button
													class="packages-card-action"
													?disabled=${this.runningCommand || this.runningConfigCommand}
													title="Package settings"
													@click=${() => this.openPackageConfig(item)}
												>
													${icon("settings")}
												</button>
												<button
													class="packages-card-action danger"
													?disabled=${this.runningCommand}
													title="Uninstall"
													@click=${() => void this.removePackage(this.resolveInstalledRemoveSource(item), item.scope === "project" ? "local" : "global")}
												>
													${icon("remove")}
												</button>
											`,
											titleAttr: item.location || item.source,
										}),
									)}
								</div>
							`}
					</section>

					<section class="packages-section">
						<div class="packages-section-head">
							<div>
								<div class="packages-section-title">Recommended</div>
								<div class="packages-section-submeta">Curated desktop packages. Install target: ${installTarget}.</div>
							</div>
							<div class="packages-section-meta">${recommendedPackages.length}</div>
						</div>
						${recommendedPackages.length === 0
							? html`<div class="packages-empty">No recommended packages match the current search.</div>`
							: html`
								<div class="packages-list packages-list-grid">
									${recommendedPackages.map((item) => {
										const installState = this.getRecommendedInstallState(item);
										const selectedScopeInstalled = this.isRecommendedPackageInstalledForScope(effectiveScope, installState);
										return this.renderPackageRow({
											title: item.name,
											description: item.description,
											iconName: "extension",
											badges: [
												html`<span class="packages-card-scope">${sourceKindLabel(item.sourceKind)}</span>`,
												...(installState.global ? [html`<span class="packages-card-scope global-installed">Global</span>`] : []),
												...(installState.project ? [html`<span class="packages-card-scope project">Project</span>`] : []),
											],
											actions: html`
												<button
													class="packages-row-install ${selectedScopeInstalled ? "remove" : "add"}"
													?disabled=${this.runningCommand}
													title=${selectedScopeInstalled ? `Remove from ${installTarget.toLowerCase()} target` : `Install to ${installTarget.toLowerCase()} target`}
													@click=${() =>
														void (selectedScopeInstalled
															? this.removePackage(item.source, this.packageScope)
															: this.installRecommendedPackage(item, this.packageScope))}
												>
													${selectedScopeInstalled ? "×" : "+"}
												</button>
											`,
											titleAttr: item.installSourceHint,
										});
									})}
								</div>
							`}
					</section>

					<section class="packages-section">
						<div class="packages-section-head">
							<div>
								<div class="packages-section-title">Discover</div>
								<div class="packages-section-submeta">Browse and install community packages directly here.</div>
							</div>
							<div class="packages-section-meta">${catalogItems.length}</div>
						</div>
						${this.loadingCatalog
							? html`<div class="packages-empty">Loading catalog…</div>`
							: discoverItems.length === 0
								? html`<div class="packages-empty">No packages match the current search.</div>`
								: html`
									<div class="packages-list packages-list-grid">
										${discoverItems.map((item) => {
											const discoverSource = `npm:${item.name}`;
											const selectedScopeInstalled = this.isSourceInstalledForScope(discoverSource, effectiveScope);
											return this.renderPackageRow({
												title: item.name,
												description: item.description || "No description",
												note: `v${item.version}`,
												badges: [html`<span class="packages-card-scope">npm</span>`],
												actions: html`
													<button
														class="packages-row-install ${selectedScopeInstalled ? "remove" : "add"}"
														?disabled=${this.runningCommand}
														title=${selectedScopeInstalled ? `Remove from ${installTarget.toLowerCase()} target` : `Install to ${installTarget.toLowerCase()} target`}
														@click=${() => void (selectedScopeInstalled ? this.removePackage(discoverSource, this.packageScope) : this.addCatalogItem(item))}
													>
														${selectedScopeInstalled ? "×" : "+"}
													</button>
												`,
												titleAttr: item.npmUrl,
											});
										})}
									</div>
								`}
					</section>

					${hasDiagnostics
						? html`
							<details class="packages-diagnostics" ?open=${diagnosticsOpen}>
								<summary>Diagnostics</summary>
								<div class="packages-diagnostics-actions">
									<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => void this.updatePackages()}>Update target</button>
									<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => void this.listPackages()}>List target</button>
									<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => void this.runDesktopNotificationSmokeTest()}>Test desktop notifications</button>
									<button class="ghost-btn" ?disabled=${this.runningCommand} @click=${() => this.render()}>Refresh logs</button>
								</div>
								<pre class="tool-output packages-command-log">${this.commandOutput || "No package command run yet."}</pre>
								<pre class="tool-output packages-command-log">${notifyDebugLines.length > 0 ? notifyDebugLines.join("\n") : "No notify trace lines yet."}</pre>
							</details>
						`
						: nothing}
				</div>
			</div>
			${this.renderPackageConfigModal()}
		`;

		render(template, this.container);
	}
}
