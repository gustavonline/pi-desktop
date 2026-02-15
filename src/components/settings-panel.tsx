/**
 * Settings Panel - runtime controls for RPC session + app preferences
 */

import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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
	private root: Root;
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
		this.root = createRoot(container);
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

		await Promise.all([this.refreshAuthStatus(), this.refreshCliStatus(), this.refreshCompatibilityStatus()]);
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
	): ReactElement {
		return (
			<div className="settings-row">
				<div>
					<div className="settings-label">{label}</div>
					<div className="settings-desc">{description}</div>
				</div>
				<button className={`toggle ${checked ? "on" : "off"}`} onClick={() => onChange(!checked)} type="button">
					<span></span>
				</button>
			</div>
		);
	}

	render(): void {
		if (!this.isOpen) {
			this.root.render(<></>);
			return;
		}

		this.root.render(
			<div
				className="overlay"
				onClick={(e) => {
					if (e.target === e.currentTarget) this.close();
				}}
			>
				<div className="settings-card">
					<div className="settings-header">
						<h2>Settings</h2>
						<button onClick={() => this.close()} type="button">
							✕
						</button>
					</div>

					<div className="settings-section">
						<div className="settings-section-title">Appearance</div>
						<div className="theme-grid">
							<button
								className={`theme-btn ${this.state.theme === "dark" ? "active" : ""}`}
								onClick={() => void this.setTheme("dark")}
								type="button"
							>
								Dark
							</button>
							<button
								className={`theme-btn ${this.state.theme === "light" ? "active" : ""}`}
								onClick={() => void this.setTheme("light")}
								type="button"
							>
								Light
							</button>
						</div>
					</div>

					<div className="settings-section">
						<div className="settings-section-title">Agent Behavior</div>
						{this.renderToggle(
							"Auto-compaction",
							"Automatically summarize older context before hitting context limits.",
							this.state.autoCompactionEnabled,
							(v) => void this.setAutoCompaction(v),
						)}
						{this.renderToggle(
							"Auto-retry",
							"Retry transient provider errors with exponential backoff.",
							this.state.autoRetryEnabled,
							(v) => void this.setAutoRetry(v),
						)}
					</div>

					<div className="settings-section">
						<div className="settings-section-title">Queue Modes</div>
						<div className="settings-row">
							<div>
								<div className="settings-label">Steering messages</div>
								<div className="settings-desc">How queued steer messages are delivered while streaming.</div>
							</div>
							<select
								className="settings-select"
								value={this.state.steeringMode}
								onChange={(e) => void this.setSteeringMode(e.target.value as QueueMode)}
							>
								<option value="one-at-a-time">one-at-a-time</option>
								<option value="all">all</option>
							</select>
						</div>
						<div className="settings-row">
							<div>
								<div className="settings-label">Follow-up messages</div>
								<div className="settings-desc">How queued follow-up messages are delivered after runs.</div>
							</div>
							<select
								className="settings-select"
								value={this.state.followUpMode}
								onChange={(e) => void this.setFollowUpMode(e.target.value as QueueMode)}
							>
								<option value="one-at-a-time">one-at-a-time</option>
								<option value="all">all</option>
							</select>
						</div>
					</div>

					<div className="settings-section">
						<div className="settings-section-title">Account &amp; Resources</div>
						{this.authLoading ? <div className="settings-desc">Checking auth status…</div> : null}
						{!this.authLoading ? (
							<>
								<div className="settings-desc">
									{this.authStatus && this.authStatus.configured_providers.length > 0
										? `Configured providers: ${this.authStatus.configured_providers.length}`
										: "No providers configured yet."}
								</div>
								<div className="settings-actions">
									<button className="ghost-btn" onClick={() => void this.refreshAuthStatus()} type="button">
										Refresh auth status
									</button>
								</div>
								{this.authStatus && this.authStatus.configured_providers.length > 0 ? (
									<div className="account-chips">
										{this.authStatus.configured_providers.map((p) => (
											<span className="account-chip" key={`${p.provider}-${p.source}-${p.kind}`}>
												{p.provider} · {p.source === "environment" ? "env" : p.kind}
											</span>
										))}
									</div>
								) : null}
								<div className="settings-desc">
									OAuth <code>/login</code> is interactive-only in TUI mode. Configure auth once in terminal (or set API keys)
									then restart desktop.
								</div>
								{this.authStatus?.auth_file ? (
									<div className="settings-desc">
										Auth file: <code>{this.authStatus.auth_file}</code>
									</div>
								) : null}
							</>
						) : null}
					</div>

					<div className="settings-section">
						<div className="settings-section-title">CLI Runtime</div>
						{this.cliLoading ? <div className="settings-desc">Checking CLI versions…</div> : null}
						{!this.cliLoading ? (
							<>
								<div className="settings-desc">
									Discovery: <code>{this.cliStatus?.discovery || rpcBridge.discoveryInfo || "unknown"}</code>
								</div>
								<div className="settings-desc">
									Current: <code>{this.cliStatus?.current_version || "unknown"}</code> · Latest: <code>{this.cliStatus?.latest_version || "unknown"}</code>
								</div>
								{this.cliStatus?.update_available ? (
									<div className="settings-desc">A newer CLI version is available.</div>
								) : (
									<div className="settings-desc">CLI is up to date or latest version could not be determined.</div>
								)}
								{this.cliStatus?.note ? <div className="settings-desc">{this.cliStatus.note}</div> : null}
							</>
						) : null}

						<div className="settings-actions">
							<button className="ghost-btn" disabled={this.cliLoading} onClick={() => void this.refreshCliStatus()} type="button">
								Refresh CLI status
							</button>
							<button
								className="ghost-btn"
								disabled={
									this.cliUpdating ||
									!this.cliStatus?.can_update_in_app ||
									!this.cliStatus?.npm_available ||
									!this.cliStatus?.update_available
								}
								onClick={() => void this.updateCliNow()}
								type="button"
							>
								{this.cliUpdating ? "Updating…" : "Update CLI"}
							</button>
						</div>
						{this.cliActionMessage ? <div className="settings-desc">{this.cliActionMessage}</div> : null}
						{this.cliStatus?.update_command ? (
							<div className="settings-desc">
								Manual update: <code>{this.cliStatus.update_command}</code>
							</div>
						) : null}

						<div className="settings-actions">
							<button
								className="ghost-btn"
								disabled={this.compatibilityLoading}
								onClick={() => void this.refreshCompatibilityStatus()}
								type="button"
							>
								{this.compatibilityLoading ? "Checking RPC…" : "Run RPC compatibility check"}
							</button>
						</div>

						{this.compatibilityReport ? (
							<>
								<div className="settings-desc">RPC compatibility: {this.compatibilityReport.ok ? "OK" : "Failed"}</div>
								{this.compatibilityReport.checks.length > 0 ? (
									<div className="settings-desc">Required checks passed: {this.compatibilityReport.checks.join(", ")}</div>
								) : null}
								{this.compatibilityReport.failedChecks.length > 0 ? (
									<div className="settings-desc">Required checks failed: {this.compatibilityReport.failedChecks.join(", ")}</div>
								) : null}
								{this.compatibilityReport.optionalWarnings.length > 0 ? (
									<>
										<div className="settings-desc">Optional capability warnings:</div>
										<div className="settings-desc">
											{this.compatibilityReport.optionalWarnings.map((w) => (
												<div key={w}>• {w}</div>
											))}
										</div>
									</>
								) : null}
								{this.compatibilityReport.error ? <div className="settings-desc">{this.compatibilityReport.error}</div> : null}
							</>
						) : null}
					</div>

					{this.statusMessage ? <div className="settings-desc">{this.statusMessage}</div> : null}
				</div>
			</div>,
		);
	}

	destroy(): void {
		this.root.unmount();
	}
}
