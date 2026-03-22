/**
 * Settings Panel - runtime controls for RPC session + app preferences
 */

import { html, render, type TemplateResult } from "lit";
import { fetchDesktopUpdateStatus, openDesktopUpdate, type DesktopUpdateStatus } from "../desktop-updates.js";
import {
	type CliUpdateStatus,
	type PiAuthStatus,
	type QueueMode,
	type RpcCompatibilityReport,
	rpcBridge,
} from "../rpc/bridge.js";

interface SettingsState {
	theme: "dark" | "light";
	autoCompactionEnabled: boolean;
	autoRetryEnabled: boolean;
	steeringMode: QueueMode;
	followUpMode: QueueMode;
}

interface ModelOption {
	provider: string;
	id: string;
	label: string;
}

export class SettingsPanel {
	private container: HTMLElement;
	private isOpen = false;
	private state: SettingsState = {
		theme: "dark",
		autoCompactionEnabled: true,
		autoRetryEnabled: true,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
	};
	private onClose: (() => void) | null = null;
	private saving = false;
	private authStatus: PiAuthStatus | null = null;
	private authLoading = false;
	private desktopStatus: DesktopUpdateStatus | null = null;
	private desktopLoading = false;
	private desktopOpening = false;
	private desktopActionMessage = "";
	private onDesktopStatusChange: ((status: DesktopUpdateStatus | null) => void) | null = null;
	private cliStatus: CliUpdateStatus | null = null;
	private cliLoading = false;
	private cliUpdating = false;
	private cliActionMessage = "";
	private onCliStatusChange: ((status: CliUpdateStatus | null) => void) | null = null;
	private compatibilityReport: RpcCompatibilityReport | null = null;
	private compatibilityLoading = false;
	private autoRenameModels: ModelOption[] = [];
	private autoRenameLoading = false;
	private autoRenameSaving = false;
	private autoRenameModelValue = "";
	private autoRenamePath: string | null = null;
	private autoRenameStatusMessage = "";

	constructor(container: HTMLElement) {
		this.container = container;
		this.loadTheme();
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	setOnDesktopStatusChange(callback: (status: DesktopUpdateStatus | null) => void): void {
		this.onDesktopStatusChange = callback;
	}

	setOnCliStatusChange(callback: (status: CliUpdateStatus | null) => void): void {
		this.onCliStatusChange = callback;
	}

	isVisible(): boolean {
		return this.isOpen;
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.loadTheme();
		this.render();
		await this.loadState();
		if (!this.isOpen) return;
		this.render();
	}

	close(): void {
		this.isOpen = false;
		this.render();
		this.onClose?.();
	}

	private loadTheme(): void {
		const saved = (localStorage.getItem("pi-theme") as "dark" | "light" | null) ?? "dark";
		this.state.theme = saved;
		this.applyTheme(saved);
	}

	private applyTheme(theme: "dark" | "light"): void {
		document.documentElement.classList.remove("light", "dark");
		document.documentElement.classList.add(theme);
		localStorage.setItem("pi-theme", theme);
	}

	private async loadState(): Promise<void> {
		try {
			const sessionState = await rpcBridge.getState();
			this.state.autoCompactionEnabled = sessionState.autoCompactionEnabled;
			this.state.steeringMode = sessionState.steeringMode;
			this.state.followUpMode = sessionState.followUpMode;
		} catch {
			// ignore
		}

		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const saved = (await invoke("load_settings")) as {
				theme?: string;
				auto_retry?: boolean;
			};
			if (saved.theme === "dark" || saved.theme === "light") {
				this.state.theme = saved.theme;
				this.applyTheme(saved.theme);
			}
			if (typeof saved.auto_retry === "boolean") {
				this.state.autoRetryEnabled = saved.auto_retry;
			}
		} catch {
			// ignore missing persisted settings
		}

		await Promise.all([
			this.refreshAuthStatus(),
			this.refreshDesktopStatus(),
			this.refreshCliStatus(),
			this.refreshCompatibilityStatus(),
			this.refreshAutoRenameSettings(),
		]);
	}

	private async refreshAuthStatus(): Promise<void> {
		this.authLoading = true;
		this.render();
		try {
			this.authStatus = await rpcBridge.getPiAuthStatus();
		} catch {
			this.authStatus = null;
		} finally {
			this.authLoading = false;
			this.render();
		}
	}

	private async refreshDesktopStatus(): Promise<void> {
		this.desktopLoading = true;
		this.render();
		try {
			this.desktopStatus = await fetchDesktopUpdateStatus();
		} catch {
			this.desktopStatus = null;
		} finally {
			this.desktopLoading = false;
			this.render();
			this.onDesktopStatusChange?.(this.desktopStatus);
		}
	}

	private async openDesktopUpdateNow(): Promise<void> {
		if (this.desktopOpening) return;
		if (!this.desktopStatus?.updateAvailable) return;
		this.desktopOpening = true;
		this.desktopActionMessage = this.desktopStatus.assetUrl ? "Opening desktop installer…" : "Opening release page…";
		this.render();
		try {
			await openDesktopUpdate(this.desktopStatus);
			this.desktopActionMessage = this.desktopStatus.assetName
				? `Opened ${this.desktopStatus.assetName} for download.`
				: "Opened release page.";
		} catch (err) {
			this.desktopActionMessage = err instanceof Error ? err.message : "Failed to open desktop update.";
		} finally {
			this.desktopOpening = false;
			this.render();
		}
	}

	private async refreshCliStatus(): Promise<void> {
		this.cliLoading = true;
		this.render();
		try {
			this.cliStatus = await rpcBridge.getCliUpdateStatus();
		} catch {
			this.cliStatus = null;
		} finally {
			this.cliLoading = false;
			this.render();
			this.onCliStatusChange?.(this.cliStatus);
		}
	}

	private async refreshCompatibilityStatus(): Promise<void> {
		this.compatibilityLoading = true;
		this.render();
		try {
			this.compatibilityReport = await rpcBridge.checkRpcCompatibility();
		} catch (err) {
			this.compatibilityReport = {
				ok: false,
				checks: [],
				error: err instanceof Error ? err.message : String(err),
				checkedAt: Date.now(),
			};
		} finally {
			this.compatibilityLoading = false;
			this.render();
		}
	}

	private joinPath(base: string, child: string): string {
		const sep = base.includes("\\") ? "\\" : "/";
		return `${base.replace(/[\\/]+$/, "")}${sep}${child}`;
	}

	private modelOptionValue(provider: string, id: string): string {
		return `${provider}::${id}`;
	}

	private splitModelOptionValue(value: string): { provider: string; id: string } | null {
		const [provider, ...rest] = value.split("::");
		const id = rest.join("::");
		if (!provider || !id) return null;
		return { provider, id };
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
			const key = `${provider}::${id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			mapped.push({ provider, id, label: `${provider}/${id}` });
		}
		return mapped;
	}

	private async resolveAutoRenamePath(): Promise<string> {
		if (this.autoRenamePath) return this.autoRenamePath;
		const { homeDir } = await import("@tauri-apps/api/path");
		const home = await homeDir();
		const agentRoot = this.joinPath(this.joinPath(home, ".pi"), "agent");
		const extensionsRoot = this.joinPath(agentRoot, "extensions");
		this.autoRenamePath = this.joinPath(extensionsRoot, "pi-session-auto-rename.json");
		return this.autoRenamePath;
	}

	private async refreshAutoRenameSettings(): Promise<void> {
		this.autoRenameLoading = true;
		this.autoRenameStatusMessage = "";
		this.render();
		try {
			const [models, path] = await Promise.all([
				rpcBridge.getAvailableModels().catch(() => []),
				this.resolveAutoRenamePath(),
			]);
			this.autoRenameModels = this.mapModelOptions(models as Array<Record<string, unknown>>);

			const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
			const hasConfig = await exists(path);
			if (hasConfig) {
				const raw = await readTextFile(path);
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				const provider = typeof parsed.provider === "string" ? parsed.provider.trim() : "";
				const id = typeof parsed.id === "string"
					? parsed.id.trim()
					: typeof parsed.model === "string"
						? parsed.model.trim()
						: typeof parsed.modelId === "string"
							? parsed.modelId.trim()
							: "";
				if (provider && id) {
					this.autoRenameModelValue = this.modelOptionValue(provider, id);
				}
			} else if (!this.autoRenameModelValue) {
				const active = await rpcBridge.getState().catch(() => null);
				if (active?.model?.provider && active?.model?.id) {
					this.autoRenameModelValue = this.modelOptionValue(active.model.provider, active.model.id);
				} else if (this.autoRenameModels[0]) {
					const fallback = this.autoRenameModels[0];
					this.autoRenameModelValue = this.modelOptionValue(fallback.provider, fallback.id);
				}
			}
		} catch (err) {
			this.autoRenameStatusMessage = err instanceof Error ? err.message : "Failed to load auto-rename settings.";
		} finally {
			this.autoRenameLoading = false;
			this.render();
		}
	}

	private async setAutoRenameModel(value: string): Promise<void> {
		if (this.autoRenameSaving) return;
		const parsed = this.splitModelOptionValue(value);
		if (!parsed) return;
		this.autoRenameSaving = true;
		this.autoRenameStatusMessage = "Saving auto-rename model…";
		this.render();
		try {
			const path = await this.resolveAutoRenamePath();
			const { writeTextFile } = await import("@tauri-apps/plugin-fs");
			const content = JSON.stringify({ provider: parsed.provider, id: parsed.id }, null, 2);
			await writeTextFile(path, content);
			this.autoRenameModelValue = value;
			this.autoRenameStatusMessage = `Auto-rename model set to ${parsed.provider}/${parsed.id}.`;
		} catch (err) {
			this.autoRenameStatusMessage = err instanceof Error ? err.message : "Failed to save auto-rename model.";
		} finally {
			this.autoRenameSaving = false;
			this.render();
		}
	}

	private async updateCliNow(): Promise<void> {
		if (this.cliUpdating) return;
		this.cliUpdating = true;
		this.cliActionMessage = "Updating CLI via npm…";
		this.render();
		try {
			const result = await rpcBridge.updateCliViaNpm();
			if (result.exit_code === 0) {
				this.cliActionMessage = "CLI updated successfully.";
			} else {
				this.cliActionMessage = `CLI update failed (exit ${result.exit_code}).`;
			}
			await this.refreshCliStatus();
			await this.refreshCompatibilityStatus();
		} catch (err) {
			this.cliActionMessage = err instanceof Error ? err.message : "Failed to update CLI.";
		} finally {
			this.cliUpdating = false;
			this.render();
		}
	}

	private async setTheme(theme: "dark" | "light"): Promise<void> {
		this.state.theme = theme;
		this.applyTheme(theme);
		this.render();
		await this.saveSettings();
	}

	private async setAutoCompaction(enabled: boolean): Promise<void> {
		try {
			await rpcBridge.setAutoCompaction(enabled);
			this.state.autoCompactionEnabled = enabled;
			this.render();
			await this.saveSettings();
		} catch (err) {
			console.error("Failed to set auto-compaction:", err);
		}
	}

	private async setAutoRetry(enabled: boolean): Promise<void> {
		try {
			await rpcBridge.setAutoRetry(enabled);
			this.state.autoRetryEnabled = enabled;
			this.render();
			await this.saveSettings();
		} catch (err) {
			console.error("Failed to set auto-retry:", err);
		}
	}

	private async setSteeringMode(mode: QueueMode): Promise<void> {
		try {
			await rpcBridge.setSteeringMode(mode);
			this.state.steeringMode = mode;
			this.render();
			await this.saveSettings();
		} catch (err) {
			console.error("Failed to set steering mode:", err);
		}
	}

	private async setFollowUpMode(mode: QueueMode): Promise<void> {
		try {
			await rpcBridge.setFollowUpMode(mode);
			this.state.followUpMode = mode;
			this.render();
			await this.saveSettings();
		} catch (err) {
			console.error("Failed to set follow-up mode:", err);
		}
	}

	private async saveSettings(): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("save_settings", {
				settings: {
					theme: this.state.theme,
					thinking_level: "medium",
					auto_compaction: this.state.autoCompactionEnabled,
					auto_retry: this.state.autoRetryEnabled,
					steering_mode: this.state.steeringMode,
					follow_up_mode: this.state.followUpMode,
					model_provider: null,
					model_id: null,
				},
			});
		} catch (err) {
			console.error("Failed to save settings:", err);
		} finally {
			this.saving = false;
		}
	}

	private renderToggle(
		label: string,
		description: string,
		checked: boolean,
		onChange: (checked: boolean) => void,
	): TemplateResult {
		return html`
			<div class="settings-row">
				<div>
					<div class="settings-label">${label}</div>
					<div class="settings-desc">${description}</div>
				</div>
				<button class="toggle ${checked ? "on" : "off"}" @click=${() => onChange(!checked)}>
					<span></span>
				</button>
			</div>
		`;
	}

	render(): void {
		if (!this.isOpen) {
			this.container.innerHTML = "";
			return;
		}

		const template = html`
			<div class="overlay" @click=${(e: Event) => e.target === e.currentTarget && this.close()}>
				<div class="settings-card">
					<div class="settings-header">
						<h2>Settings</h2>
						<button @click=${() => this.close()}>✕</button>
					</div>

					<div class="settings-section">
						<div class="settings-section-title">Appearance</div>
						<div class="theme-grid">
							<button class="theme-btn ${this.state.theme === "dark" ? "active" : ""}" @click=${() => this.setTheme("dark")}>Dark</button>
							<button class="theme-btn ${this.state.theme === "light" ? "active" : ""}" @click=${() => this.setTheme("light")}>Light</button>
						</div>
					</div>

					<div class="settings-section">
						<div class="settings-section-title">Assistant</div>
						${this.renderToggle(
							"Auto-compaction",
							"Summarize older context automatically when conversations get long.",
							this.state.autoCompactionEnabled,
							(v) => this.setAutoCompaction(v),
						)}
						${this.renderToggle(
							"Auto-retry",
							"Retry temporary provider errors automatically.",
							this.state.autoRetryEnabled,
							(v) => this.setAutoRetry(v),
						)}
					</div>

					<div class="settings-section">
						<div class="settings-section-title">Message queue</div>
						<div class="settings-row">
							<div>
								<div class="settings-label">Steering messages</div>
								<div class="settings-desc">How queued steering messages are sent while a response is streaming.</div>
							</div>
							<select class="settings-select" .value=${this.state.steeringMode} @change=${(e: Event) => this.setSteeringMode((e.target as HTMLSelectElement).value as QueueMode)}>
								<option value="one-at-a-time">One at a time</option>
								<option value="all">All queued</option>
							</select>
						</div>
						<div class="settings-row">
							<div>
								<div class="settings-label">Follow-up messages</div>
								<div class="settings-desc">How queued follow-up prompts are sent after each run.</div>
							</div>
							<select class="settings-select" .value=${this.state.followUpMode} @change=${(e: Event) => this.setFollowUpMode((e.target as HTMLSelectElement).value as QueueMode)}>
								<option value="one-at-a-time">One at a time</option>
								<option value="all">All queued</option>
							</select>
						</div>
					</div>

					<div class="settings-section">
						<div class="settings-section-title">Account</div>
						${this.authLoading
							? html`<div class="settings-desc">Checking account status…</div>`
							: html`
								<div class="settings-desc">
									${this.authStatus && this.authStatus.configured_providers.length > 0
										? `Connected providers: ${this.authStatus.configured_providers.length}`
										: "No provider connected yet."}
								</div>
								<div class="settings-actions">
									<button class="ghost-btn" @click=${() => this.refreshAuthStatus()}>Refresh account status</button>
								</div>
								${this.authStatus && this.authStatus.configured_providers.length > 0
									? html`
										<div class="account-chips">
											${this.authStatus.configured_providers.map(
												(p) => html`<span class="account-chip">${p.provider} · ${p.source === "environment" ? "env" : p.kind}</span>`,
											)}
										</div>
									`
									: null}
								<div class="settings-desc">Tip: run <code>/login</code> in terminal once, then restart desktop.</div>
								${this.authStatus?.auth_file
									? html`
										<details class="settings-advanced">
											<summary>Advanced account details</summary>
											<div class="settings-desc">Auth file: <code>${this.authStatus.auth_file}</code></div>
										</details>
									`
									: null}
							`}
					</div>

					<div class="settings-section">
						<div class="settings-section-title">Auto-rename extension</div>
						<div class="settings-row">
							<div>
								<div class="settings-label">Provider/model for auto title generation</div>
								<div class="settings-desc">Pick from your currently available authenticated models.</div>
							</div>
							<select
								class="settings-select"
								.value=${this.autoRenameModelValue}
								?disabled=${this.autoRenameLoading || this.autoRenameSaving || this.autoRenameModels.length === 0}
								@change=${(e: Event) => void this.setAutoRenameModel((e.target as HTMLSelectElement).value)}
							>
								${this.autoRenameLoading ? html`<option value="">Loading models…</option>` : null}
								${!this.autoRenameLoading && this.autoRenameModels.length === 0 ? html`<option value="">No models available</option>` : null}
								${!this.autoRenameLoading && this.autoRenameModelValue && !this.autoRenameModels.some((m) => this.modelOptionValue(m.provider, m.id) === this.autoRenameModelValue)
									? html`<option value=${this.autoRenameModelValue}>${this.autoRenameModelValue.replace("::", "/")}</option>`
									: null}
								${this.autoRenameModels.map((m) => html`<option value=${this.modelOptionValue(m.provider, m.id)}>${m.label}</option>`)}
							</select>
						</div>
						<div class="settings-actions">
							<button class="ghost-btn" ?disabled=${this.autoRenameLoading || this.autoRenameSaving} @click=${() => this.refreshAutoRenameSettings()}>
								${this.autoRenameLoading ? "Refreshing…" : "Refresh models/config"}
							</button>
						</div>
						${this.autoRenamePath ? html`<div class="settings-desc">Config: <code>${this.autoRenamePath}</code></div>` : null}
						${this.autoRenameStatusMessage ? html`<div class="settings-desc">${this.autoRenameStatusMessage}</div>` : null}
					</div>

					<div class="settings-section">
						<div class="settings-section-title">Desktop updates</div>
						${this.desktopLoading
							? html`<div class="settings-desc">Checking desktop release…</div>`
							: html`
								<div class="settings-desc">
									Current: <code>${this.desktopStatus?.currentVersion || "unknown"}</code>
									 · Latest: <code>${this.desktopStatus?.latestVersion || "unknown"}</code>
								</div>
								${this.desktopStatus
									? this.desktopStatus.updateAvailable
										? html`<div class="settings-desc">A newer Pi Desktop release is available.</div>`
										: html`<div class="settings-desc">No desktop update available right now.</div>`
									: html`<div class="settings-desc">Desktop update status unavailable. Check your network and try again.</div>`}
								${this.desktopStatus?.assetName
									? html`<div class="settings-desc">Recommended installer: <code>${this.desktopStatus.assetName}</code></div>`
									: null}
								${this.desktopStatus?.note ? html`<div class="settings-desc">${this.desktopStatus.note}</div>` : null}
							`}
						<div class="settings-actions">
							<button class="ghost-btn" ?disabled=${this.desktopLoading} @click=${() => this.refreshDesktopStatus()}>Refresh desktop status</button>
							<button
								class="ghost-btn"
								?disabled=${this.desktopOpening || !this.desktopStatus?.updateAvailable}
								@click=${() => this.openDesktopUpdateNow()}
							>
								${this.desktopOpening
									? "Opening…"
									: this.desktopStatus?.assetUrl
										? "Download desktop update"
										: "Open release page"}
							</button>
						</div>
						${this.desktopActionMessage ? html`<div class="settings-desc">${this.desktopActionMessage}</div>` : null}
					</div>

					<div class="settings-section">
						<div class="settings-section-title">CLI updates</div>
						${this.cliLoading
							? html`<div class="settings-desc">Checking CLI version…</div>`
							: html`
								<div class="settings-desc">
									Current: <code>${this.cliStatus?.current_version || "unknown"}</code>
									 · Latest: <code>${this.cliStatus?.latest_version || "unknown"}</code>
								</div>
								${this.cliStatus
									? this.cliStatus.update_available
										? html`<div class="settings-desc">A newer Pi CLI is available.</div>`
										: html`<div class="settings-desc">No update available right now.</div>`
									: html`<div class="settings-desc">CLI status unavailable. Install or reconnect CLI, then refresh.</div>`}
								${this.cliStatus?.note ? html`<div class="settings-desc">${this.cliStatus.note}</div>` : null}
							`}
						<div class="settings-actions">
							<button class="ghost-btn" ?disabled=${this.cliLoading} @click=${() => this.refreshCliStatus()}>Refresh CLI status</button>
							<button
								class="ghost-btn"
								?disabled=${
									this.cliUpdating ||
									!this.cliStatus?.can_update_in_app ||
									!this.cliStatus?.npm_available ||
									!this.cliStatus?.update_available
								}
								@click=${() => this.updateCliNow()}
							>
								${this.cliUpdating ? "Updating…" : "Update CLI now"}
							</button>
						</div>
						${this.cliActionMessage ? html`<div class="settings-desc">${this.cliActionMessage}</div>` : null}
						<details class="settings-advanced">
							<summary>Advanced CLI diagnostics</summary>
							<div class="settings-desc">
								Discovery: <code>${this.cliStatus?.discovery || rpcBridge.discoveryInfo || "unknown"}</code>
							</div>
							${this.cliStatus?.update_command
								? html`<div class="settings-desc">Manual update: <code>${this.cliStatus.update_command}</code></div>`
								: null}
							<div class="settings-actions">
								<button class="ghost-btn" ?disabled=${this.compatibilityLoading} @click=${() => this.refreshCompatibilityStatus()}>
									${this.compatibilityLoading ? "Checking RPC…" : "Run RPC compatibility check"}
								</button>
							</div>
							${this.compatibilityReport
								? html`
									<div class="settings-desc">
										RPC compatibility: ${this.compatibilityReport.ok ? "OK" : "Failed"}
										${this.compatibilityReport.checks.length > 0
											? html` (${this.compatibilityReport.checks.join(", ")})`
											: null}
									</div>
									${this.compatibilityReport.error
										? html`<div class="settings-desc">${this.compatibilityReport.error}</div>`
										: null}
								`
								: null}
						</details>
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
