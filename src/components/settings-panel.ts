/**
 * Settings Panel - runtime controls for RPC session + app preferences
 */

import { html, render, type TemplateResult } from "lit";
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
	private cliStatus: CliUpdateStatus | null = null;
	private cliLoading = false;
	private cliUpdating = false;
	private cliActionMessage = "";
	private compatibilityReport: RpcCompatibilityReport | null = null;
	private compatibilityLoading = false;
	private statusMessage = "";

	constructor(container: HTMLElement) {
		this.container = container;
		this.loadTheme();
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.loadTheme();
		await this.loadState();
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
			this.refreshCliStatus(),
			this.refreshCompatibilityStatus(),
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
				failedChecks: ["compatibility_check"],
				optionalWarnings: [],
				details: [],
				error: err instanceof Error ? err.message : String(err),
				checkedAt: Date.now(),
			};
		} finally {
			this.compatibilityLoading = false;
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

	private showStatusMessage(message: string): void {
		this.statusMessage = message;
		this.render();
		setTimeout(() => {
			if (this.statusMessage === message) {
				this.statusMessage = "";
				this.render();
			}
		}, 4500);
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
			this.showStatusMessage(rpcBridge.formatFeatureError("Auto-compaction setting", err));
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
			this.showStatusMessage(rpcBridge.formatFeatureError("Auto-retry setting", err));
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
			this.showStatusMessage(rpcBridge.formatFeatureError("Steering mode setting", err));
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
			this.showStatusMessage(rpcBridge.formatFeatureError("Follow-up mode setting", err));
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
			this.showStatusMessage(rpcBridge.formatFeatureError("Settings persistence", err));
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
						<div class="settings-section-title">Agent Behavior</div>
						${this.renderToggle(
							"Auto-compaction",
							"Automatically summarize older context before hitting context limits.",
							this.state.autoCompactionEnabled,
							(v) => this.setAutoCompaction(v),
						)}
						${this.renderToggle(
							"Auto-retry",
							"Retry transient provider errors with exponential backoff.",
							this.state.autoRetryEnabled,
							(v) => this.setAutoRetry(v),
						)}
					</div>

					<div class="settings-section">
						<div class="settings-section-title">Queue Modes</div>
						<div class="settings-row">
							<div>
								<div class="settings-label">Steering messages</div>
								<div class="settings-desc">How queued steer messages are delivered while streaming.</div>
							</div>
							<select class="settings-select" .value=${this.state.steeringMode} @change=${(e: Event) => this.setSteeringMode((e.target as HTMLSelectElement).value as QueueMode)}>
								<option value="one-at-a-time">one-at-a-time</option>
								<option value="all">all</option>
							</select>
						</div>
						<div class="settings-row">
							<div>
								<div class="settings-label">Follow-up messages</div>
								<div class="settings-desc">How queued follow-up messages are delivered after runs.</div>
							</div>
							<select class="settings-select" .value=${this.state.followUpMode} @change=${(e: Event) => this.setFollowUpMode((e.target as HTMLSelectElement).value as QueueMode)}>
								<option value="one-at-a-time">one-at-a-time</option>
								<option value="all">all</option>
							</select>
						</div>
					</div>

					<div class="settings-section">
						<div class="settings-section-title">Account & Resources</div>
						${this.authLoading
							? html`<div class="settings-desc">Checking auth status…</div>`
							: html`
								<div class="settings-desc">
									${this.authStatus && this.authStatus.configured_providers.length > 0
										? `Configured providers: ${this.authStatus.configured_providers.length}`
										: "No providers configured yet."}
								</div>
								<div class="settings-actions">
									<button class="ghost-btn" @click=${() => this.refreshAuthStatus()}>Refresh auth status</button>
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
								<div class="settings-desc">
									OAuth <code>/login</code> is interactive-only in TUI mode. Configure auth once in terminal
									(or set API keys) then restart desktop.
								</div>
								${this.authStatus?.auth_file
									? html`<div class="settings-desc">Auth file: <code>${this.authStatus.auth_file}</code></div>`
									: null}
							`}
					</div>

					<div class="settings-section">
						<div class="settings-section-title">CLI Runtime</div>
						${this.cliLoading
							? html`<div class="settings-desc">Checking CLI versions…</div>`
							: html`
								<div class="settings-desc">
									Discovery: <code>${this.cliStatus?.discovery || rpcBridge.discoveryInfo || "unknown"}</code>
								</div>
								<div class="settings-desc">
									Current: <code>${this.cliStatus?.current_version || "unknown"}</code>
									 · Latest: <code>${this.cliStatus?.latest_version || "unknown"}</code>
								</div>
								${this.cliStatus?.update_available
									? html`<div class="settings-desc">A newer CLI version is available.</div>`
									: html`<div class="settings-desc">CLI is up to date or latest version could not be determined.</div>`}
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
								${this.cliUpdating ? "Updating…" : "Update CLI"}
							</button>
						</div>
						${this.cliActionMessage ? html`<div class="settings-desc">${this.cliActionMessage}</div>` : null}
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
								<div class="settings-desc">RPC compatibility: ${this.compatibilityReport.ok ? "OK" : "Failed"}</div>
								${this.compatibilityReport.checks.length > 0
									? html`<div class="settings-desc">Required checks passed: ${this.compatibilityReport.checks.join(", ")}</div>`
									: null}
								${this.compatibilityReport.failedChecks.length > 0
									? html`<div class="settings-desc">Required checks failed: ${this.compatibilityReport.failedChecks.join(", ")}</div>`
									: null}
								${this.compatibilityReport.optionalWarnings.length > 0
									? html`
										<div class="settings-desc">Optional capability warnings:</div>
										<div class="settings-desc">
											${this.compatibilityReport.optionalWarnings.map((w) => html`<div>• ${w}</div>`)}
										</div>
									`
									: null}
								${this.compatibilityReport.error
									? html`<div class="settings-desc">${this.compatibilityReport.error}</div>`
									: null}
							`
							: null}
					</div>

					${this.statusMessage ? html`<div class="settings-desc">${this.statusMessage}</div>` : null}
				</div>
			</div>
		`;

		render(template, this.container);
	}

	destroy(): void {
		this.container.innerHTML = "";
	}
}
