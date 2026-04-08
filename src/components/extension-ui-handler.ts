/**
 * Extension UI Handler - handles dialogs and notifications from pi extensions
 *
 * Extensions can request user interaction via:
 * - select: Choose from a list of options
 * - confirm: Yes/no confirmation
 * - input: Free-form text input
 * - editor: Multi-line text editor
 * - notify: Display a notification (fire-and-forget)
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { type Options as DesktopNotificationOptions, isPermissionGranted, onAction, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { html, render, type TemplateResult } from "lit";
import { rpcBridge } from "../rpc/bridge.js";

/**
 * Explicit desktop capability contract for extension UI requests.
 * Keep this surface small and grow it intentionally.
 */
export const SUPPORTED_EXTENSION_UI_METHODS = [
	"select",
	"confirm",
	"input",
	"editor",
	"notify",
	"setStatus",
	"setWidget",
	"setTitle",
	"set_editor_text",
] as const;

export type UiMethod = (typeof SUPPORTED_EXTENSION_UI_METHODS)[number];

export interface ExtensionUiRequest {
	id: string;
	method: UiMethod;
	title?: string;
	message?: string;
	text?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	timeout?: number;
	notifyType?: "info" | "warning" | "error";
	statusKey?: string;
	statusText?: string;
	widgetKey?: string;
	widgetLines?: string[];
	widgetPlacement?: "aboveEditor" | "belowEditor";
	notifyTargetWorkspaceId?: string;
	notifyTargetTabId?: string;
	notifyTargetSessionPath?: string;
	notifyTargetWorkspaceLabel?: string;
	notifyTargetSessionLabel?: string;
}

export function isSupportedExtensionUiMethod(value: unknown): value is UiMethod {
	return typeof value === "string" && (SUPPORTED_EXTENSION_UI_METHODS as readonly string[]).includes(value);
}

function normalizeExtensionUiMethod(value: unknown): UiMethod | null {
	if (isSupportedExtensionUiMethod(value)) return value;
	if (typeof value !== "string") return null;
	const raw = value.trim();
	if (!raw) return null;
	switch (raw) {
		case "set_status":
			return "setStatus";
		case "set_widget":
			return "setWidget";
		case "set_title":
			return "setTitle";
		case "setEditorText":
			return "set_editor_text";
		default:
			return null;
	}
}

export function normalizeExtensionUiRequest(raw: Record<string, unknown>): ExtensionUiRequest | null {
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	const method = normalizeExtensionUiMethod(raw.method);
	if (!id || !method) {
		return null;
	}
	return {
		...(raw as Partial<ExtensionUiRequest>),
		id,
		method,
	};
}

function sanitizeUiStatusText(text: string): string {
	return text
		.replace(/(?:\u001b|�)\[[0-9;?]*[ -/]*[@-~]/g, "")
		.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
		.replace(/ +/g, " ")
		.trim();
}

function shouldSuppressUiStatusText(text: string): boolean {
	if (!text) return true;
	const normalized = text.toLowerCase();
	if (/^(?:💰|\$|usd|eur|dkk|kr|€|£|¥)?\s*\$?\s*\d+(?:[\.,]\d+)?\s*(?:usd|eur|dkk|kr)?$/i.test(text)) {
		return true;
	}
	if (/(?:↑\s*\d|↓\s*\d|(?:^|\s)r\d|(?:^|\s)w\d|\(sub\)|\(auto\)|\/\d+[km]|\bthinking\b)/i.test(normalized)) {
		return true;
	}
	return false;
}

function shouldSuppressUiStatusKey(key: string): boolean {
	const normalized = key.trim().toLowerCase();
	if (!normalized) return false;
	if (normalized === "oqto_title_changed") return true;
	if (/(^|[_.-])title([_.-])?changed($|[_.-])/.test(normalized)) return true;
	if (normalized.includes("session.title_changed")) return true;
	return false;
}

export interface NotificationActionTarget {
	workspaceId?: string;
	tabId?: string;
	sessionPath?: string;
	workspaceLabel?: string;
	sessionLabel?: string;
}

export class ExtensionUiHandler {
	private overlayContainer: HTMLElement | null = null;
	private statusContainer: HTMLElement | null = null;
	private widgetAboveContainer: HTMLElement | null = null;
	private widgetBelowContainer: HTMLElement | null = null;
	private onSetEditorText: ((text: string) => void) | null = null;
	private onTrace: ((message: string) => void) | null = null;
	private onNotificationActionTarget: ((target: NotificationActionTarget) => void) | null = null;
	private appWindowFocused = typeof document !== "undefined" ? document.hasFocus() : true;
	private notificationPermissionRequested = false;
	private notificationActionListenerRegistered = false;
	private lastNotificationActionTarget: NotificationActionTarget | null = null;
	private lastDesktopNotificationKey = "";
	private lastDesktopNotificationAt = 0;

	constructor() {
		this.createContainers();
		this.ensureAppFocusTracking();
		this.ensureDesktopNotificationActionListener();
	}

	setEditorTextHandler(handler: (text: string) => void): void {
		this.onSetEditorText = handler;
	}

	setTraceHandler(handler: ((message: string) => void) | null): void {
		this.onTrace = handler;
	}

	setNotificationActionHandler(handler: ((target: NotificationActionTarget) => void) | null): void {
		this.onNotificationActionTarget = handler;
	}

	primeNotificationPermission(): void {
		void this.primeDesktopNotificationPermission();
	}

	private trace(message: string): void {
		this.onTrace?.(message);
		console.debug(`[extension-ui] ${message}`);
	}

	private isAppBackgrounded(): boolean {
		if (typeof document === "undefined") return false;
		return document.visibilityState === "hidden" || !this.appWindowFocused || !document.hasFocus();
	}

	private ensureAppFocusTracking(): void {
		if (typeof window === "undefined" || typeof document === "undefined") return;
		if ((window as typeof window & { __PI_DESKTOP_EXTENSION_UI_FOCUS_TRACKING__?: boolean }).__PI_DESKTOP_EXTENSION_UI_FOCUS_TRACKING__) {
			return;
		}
		(window as typeof window & { __PI_DESKTOP_EXTENSION_UI_FOCUS_TRACKING__?: boolean }).__PI_DESKTOP_EXTENSION_UI_FOCUS_TRACKING__ = true;
		window.addEventListener("focus", () => {
			this.appWindowFocused = true;
		});
		window.addEventListener("blur", () => {
			this.appWindowFocused = false;
		});
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") {
				this.appWindowFocused = false;
			} else if (document.hasFocus()) {
				this.appWindowFocused = true;
			}
		});
	}

	private getDesktopNotificationSound(): string | undefined {
		if (typeof navigator === "undefined") return undefined;
		const platform = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
		if (platform.includes("mac")) return "Ping";
		if (platform.includes("linux")) return "message-new-instant";
		return undefined;
	}

	private formatNotificationContextSuffix(request: ExtensionUiRequest): string {
		const workspace = request.notifyTargetWorkspaceLabel?.trim() || "";
		const session = request.notifyTargetSessionLabel?.trim() || "";
		if (!workspace && !session) return "";
		if (!workspace) return `[${session}]`;
		if (!session) return `[${workspace}]`;
		return `[${workspace}] -> [${session}]`;
	}

	private appendNotificationContext(body: string, contextSuffix: string): string {
		if (!contextSuffix) return body;
		const normalizedBody = body.trim();
		if (!normalizedBody) return contextSuffix;
		if (normalizedBody.includes(contextSuffix)) return normalizedBody;
		return `${normalizedBody} ${contextSuffix}`;
	}

	private describeNotificationContext(backgrounded: boolean): string {
		const visibility = typeof document !== "undefined" ? document.visibilityState : "unknown";
		const domFocused = typeof document !== "undefined" ? document.hasFocus() : false;
		return `backgrounded=${backgrounded ? "yes" : "no"} visibility=${visibility} domFocus=${domFocused ? "yes" : "no"} appFocus=${this.appWindowFocused ? "yes" : "no"}`;
	}

	private notificationDedupKey(request: ExtensionUiRequest): string {
		const title = request.title?.trim() || "";
		const body = request.message?.trim() || "";
		const targetSession = request.notifyTargetSessionPath?.trim() || "";
		const targetTab = request.notifyTargetTabId?.trim() || "";
		return `${request.notifyType ?? "info"}|${title}|${body}|${targetSession}|${targetTab}`;
	}

	private shouldThrottleDesktopNotification(request: ExtensionUiRequest): boolean {
		const key = this.notificationDedupKey(request);
		const now = Date.now();
		const timeSinceLast = now - this.lastDesktopNotificationAt;
		if (timeSinceLast < 1200) {
			this.trace(`notify:throttled burst deltaMs=${timeSinceLast}`);
			return true;
		}
		if (key === this.lastDesktopNotificationKey && timeSinceLast < 15_000) {
			this.trace(`notify:throttled duplicate deltaMs=${timeSinceLast}`);
			return true;
		}
		this.lastDesktopNotificationKey = key;
		this.lastDesktopNotificationAt = now;
		return false;
	}

	private buildNotificationActionTarget(request: ExtensionUiRequest): NotificationActionTarget | null {
		const workspaceId = request.notifyTargetWorkspaceId?.trim();
		const tabId = request.notifyTargetTabId?.trim();
		const sessionPath = request.notifyTargetSessionPath?.trim();
		const workspaceLabel = request.notifyTargetWorkspaceLabel?.trim();
		const sessionLabel = request.notifyTargetSessionLabel?.trim();
		if (!workspaceId && !tabId && !sessionPath) return null;
		return {
			workspaceId: workspaceId || undefined,
			tabId: tabId || undefined,
			sessionPath: sessionPath || undefined,
			workspaceLabel: workspaceLabel || undefined,
			sessionLabel: sessionLabel || undefined,
		};
	}

	private extractNotificationActionTarget(notification: DesktopNotificationOptions): NotificationActionTarget | null {
		const extra = notification.extra as Record<string, unknown> | undefined;
		if (!extra) return null;
		const workspaceId = typeof extra.notifyTargetWorkspaceId === "string" ? extra.notifyTargetWorkspaceId.trim() : "";
		const tabId = typeof extra.notifyTargetTabId === "string" ? extra.notifyTargetTabId.trim() : "";
		const sessionPath = typeof extra.notifyTargetSessionPath === "string" ? extra.notifyTargetSessionPath.trim() : "";
		const workspaceLabel = typeof extra.notifyTargetWorkspaceLabel === "string" ? extra.notifyTargetWorkspaceLabel.trim() : "";
		const sessionLabel = typeof extra.notifyTargetSessionLabel === "string" ? extra.notifyTargetSessionLabel.trim() : "";
		if (!workspaceId && !tabId && !sessionPath) return null;
		return {
			workspaceId: workspaceId || undefined,
			tabId: tabId || undefined,
			sessionPath: sessionPath || undefined,
			workspaceLabel: workspaceLabel || undefined,
			sessionLabel: sessionLabel || undefined,
		};
	}

	private async ensureDesktopNotificationPermission(prompt = false): Promise<boolean> {
		try {
			const grantedInitially = await isPermissionGranted();
			this.trace(`notify:permission-check prompt=${prompt ? "yes" : "no"} granted=${grantedInitially ? "yes" : "no"}`);
			if (grantedInitially) {
				return true;
			}
			if (!prompt) {
				return false;
			}
			this.notificationPermissionRequested = true;
			const permission = await requestPermission();
			const granted = permission === "granted";
			this.trace(`notify:permission-request result=${permission}`);
			return granted;
		} catch (err) {
			this.trace(`notify:permission-check-failed ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	private async primeDesktopNotificationPermission(): Promise<void> {
		if (this.notificationPermissionRequested) return;
		if (this.isAppBackgrounded()) {
			this.trace("notify:prime-skipped backgrounded=yes");
			return;
		}
		this.trace("notify:prime-start");
		await this.ensureDesktopNotificationPermission(true);
	}

	private async focusDesktopWindowFromNotification(): Promise<void> {
		window.focus();
		const currentWindow = getCurrentWindow();
		await currentWindow.show().catch(() => {
			/* ignore */
		});
		await currentWindow.setFocus().catch(() => {
			/* ignore */
		});
	}

	private ensureDesktopNotificationActionListener(): void {
		if (this.notificationActionListenerRegistered) return;
		this.notificationActionListenerRegistered = true;
		void onAction(async (notification: DesktopNotificationOptions) => {
			this.trace("notify:action-clicked");
			await this.focusDesktopWindowFromNotification().catch(() => {
				/* ignore */
			});
			const directTarget = this.extractNotificationActionTarget(notification);
			const usedFallback = !directTarget && !!this.lastNotificationActionTarget;
			const target = directTarget ?? this.lastNotificationActionTarget;
			if (!target) {
				this.trace("notify:action-target missing");
				return;
			}
			if (usedFallback) {
				this.trace("notify:action-target fallback=last");
			}
			this.trace(`notify:action-target workspace=${target.workspaceId ?? "-"} tab=${target.tabId ?? "-"} session=${target.sessionPath ?? "-"}`);
			this.onNotificationActionTarget?.(target);
		});
	}

	private createContainers(): void {
		// Overlay for dialogs
		this.overlayContainer = document.createElement("div");
		this.overlayContainer.id = "extension-ui-overlay";
		this.overlayContainer.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/50 hidden";
		document.body.appendChild(this.overlayContainer);

		// Status bar container (above input)
		this.statusContainer = document.createElement("div");
		this.statusContainer.id = "extension-status-container";
		this.statusContainer.className = "hidden fixed bottom-[92px] left-[278px] right-4 z-40 pointer-events-none";
		document.body.appendChild(this.statusContainer);

		// Widget containers
		this.widgetAboveContainer = document.createElement("div");
		this.widgetAboveContainer.id = "widget-above";
		this.widgetAboveContainer.className = "hidden fixed bottom-[132px] left-[278px] right-4 z-30";
		document.body.appendChild(this.widgetAboveContainer);

		this.widgetBelowContainer = document.createElement("div");
		this.widgetBelowContainer.id = "widget-below";
		this.widgetBelowContainer.className = "hidden fixed bottom-3 left-[278px] right-4 z-30";
		document.body.appendChild(this.widgetBelowContainer);
	}

	/**
	 * Handle an extension UI request from the RPC bridge
	 */
	async handleRequest(request: ExtensionUiRequest): Promise<void> {
		switch (request.method) {
			case "select":
				await this.showSelectDialog(request);
				break;
			case "confirm":
				await this.showConfirmDialog(request);
				break;
			case "input":
				await this.showInputDialog(request);
				break;
			case "editor":
				await this.showEditorDialog(request);
				break;
			case "notify":
				void this.showNotification(request);
				break;
			case "setStatus":
				this.setStatus(request);
				break;
			case "setWidget":
				this.setWidget(request);
				break;
			case "setTitle":
				await this.setTitle(request);
				break;
			case "set_editor_text":
				this.setEditorText(request);
				break;
		}
	}

	async respondUnsupportedRequest(id: string, method: string, source: "active" | "background" | "unknown" = "unknown"): Promise<void> {
		this.trace(`unsupported-ui-capability method=${method} source=${source}`);
		await this.sendResponse(id, {
			success: false,
			error: `Unsupported extension UI capability: ${method}`,
		});
	}

	private async showSelectDialog(request: ExtensionUiRequest): Promise<void> {
		if (!this.overlayContainer) return;

		return new Promise((resolve) => {
			const options = request.options || [];
			let selectedIndex = -1;

			const template = html`
				<div class="bg-background rounded-lg shadow-xl border border-border w-full max-w-md p-4">
					<h3 class="text-sm font-medium mb-3">${request.title || "Select"}</h3>
					<div class="space-y-1 max-h-60 overflow-y-auto">
						${options.map(
							(opt, i) => html`
								<button
									class="w-full text-left px-3 py-2 rounded text-sm hover:bg-secondary transition-colors"
									@click=${() => {
										selectedIndex = i;
										this.closeOverlay();
										this.sendResponse(request.id, { value: opt });
										resolve();
									}}
								>
									${opt}
								</button>
							`,
						)}
					</div>
					<button
						class="mt-3 w-full px-3 py-2 rounded text-sm border border-border hover:bg-secondary transition-colors"
						@click=${() => {
							this.closeOverlay();
							this.sendResponse(request.id, { cancelled: true });
							resolve();
						}}
					>
						Cancel
					</button>
				</div>
			`;

			this.showOverlay(template);

			// Handle timeout
			if (request.timeout) {
				setTimeout(() => {
					if (selectedIndex === -1) {
						this.closeOverlay();
						this.sendResponse(request.id, { cancelled: true });
						resolve();
					}
				}, request.timeout);
			}
		});
	}

	private async showConfirmDialog(request: ExtensionUiRequest): Promise<void> {
		if (!this.overlayContainer) return;

		return new Promise((resolve) => {
			const template = html`
				<div class="bg-background rounded-lg shadow-xl border border-border w-full max-w-sm p-4">
					<h3 class="text-sm font-medium mb-2">${request.title || "Confirm"}</h3>
					<p class="text-sm text-muted-foreground mb-4">${request.message || "Are you sure?"}</p>
					<div class="flex gap-2 justify-end">
						<button
							class="px-3 py-1.5 rounded text-sm border border-border hover:bg-secondary transition-colors"
							@click=${() => {
								this.closeOverlay();
								this.sendResponse(request.id, { confirmed: false });
								resolve();
							}}
						>
							Cancel
						</button>
						<button
							class="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							@click=${() => {
								this.closeOverlay();
								this.sendResponse(request.id, { confirmed: true });
								resolve();
							}}
						>
							Confirm
						</button>
					</div>
				</div>
			`;

			this.showOverlay(template);

			// Handle timeout
			if (request.timeout) {
				setTimeout(() => {
					this.closeOverlay();
					this.sendResponse(request.id, { cancelled: true });
					resolve();
				}, request.timeout);
			}
		});
	}

	private async showInputDialog(request: ExtensionUiRequest): Promise<void> {
		if (!this.overlayContainer) return;

		return new Promise((resolve) => {
			let inputValue = "";

			const template = html`
				<div class="bg-background rounded-lg shadow-xl border border-border w-full max-w-md p-4">
					<h3 class="text-sm font-medium mb-3">${request.title || "Enter value"}</h3>
					<input
						type="text"
						class="w-full px-3 py-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
						placeholder="${request.placeholder || ""}"
						@input=${(e: Event) => {
							inputValue = (e.target as HTMLInputElement).value;
						}}
						@keydown=${(e: KeyboardEvent) => {
							if (e.key === "Enter") {
								this.closeOverlay();
								this.sendResponse(request.id, { value: inputValue });
								resolve();
							}
						}}
					/>
					<div class="flex gap-2 justify-end mt-3">
						<button
							class="px-3 py-1.5 rounded text-sm border border-border hover:bg-secondary transition-colors"
							@click=${() => {
								this.closeOverlay();
								this.sendResponse(request.id, { cancelled: true });
								resolve();
							}}
						>
							Cancel
						</button>
						<button
							class="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							@click=${() => {
								this.closeOverlay();
								this.sendResponse(request.id, { value: inputValue });
								resolve();
							}}
						>
							Submit
						</button>
					</div>
				</div>
			`;

			this.showOverlay(template);

			// Focus input after render
			setTimeout(() => {
				const input = this.overlayContainer?.querySelector("input");
				input?.focus();
			}, 50);
		});
	}

	private async showEditorDialog(request: ExtensionUiRequest): Promise<void> {
		if (!this.overlayContainer) return;

		return new Promise((resolve) => {
			let editorValue = request.prefill || "";

			const template = html`
				<div class="bg-background rounded-lg shadow-xl border border-border w-full max-w-2xl h-96 p-4 flex flex-col">
					<h3 class="text-sm font-medium mb-3">${request.title || "Edit"}</h3>
					<textarea
						class="flex-1 w-full px-3 py-2 rounded border border-border bg-background text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary"
						@input=${(e: Event) => {
							editorValue = (e.target as HTMLTextAreaElement).value;
						}}
					>${request.prefill || ""}</textarea>
					<div class="flex gap-2 justify-end mt-3">
						<button
							class="px-3 py-1.5 rounded text-sm border border-border hover:bg-secondary transition-colors"
							@click=${() => {
								this.closeOverlay();
								this.sendResponse(request.id, { cancelled: true });
								resolve();
							}}
						>
							Cancel
						</button>
						<button
							class="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							@click=${() => {
								this.closeOverlay();
								this.sendResponse(request.id, { value: editorValue });
								resolve();
							}}
						>
							Save
						</button>
					</div>
				</div>
			`;

			this.showOverlay(template);

			// Focus textarea after render
			setTimeout(() => {
				const textarea = this.overlayContainer?.querySelector("textarea");
				textarea?.focus();
			}, 50);
		});
	}

	private async showDesktopNotification(request: ExtensionUiRequest): Promise<boolean> {
		const rawTitle = request.title?.trim() || "Pi Desktop";
		const rawBody = request.message?.trim() || "";
		const contextSuffix = this.formatNotificationContextSuffix(request);
		const title = rawBody ? rawTitle : "Pi Desktop";
		const body = this.appendNotificationContext(rawBody || rawTitle, contextSuffix);

		let granted = await this.ensureDesktopNotificationPermission(false);
		if (!granted) {
			granted = await this.ensureDesktopNotificationPermission(true);
		}
		if (!granted) {
			this.trace(`notify:skipped permission-missing message=${request.message ?? ""}`);
			return false;
		}

		const actionTarget = this.buildNotificationActionTarget(request);
		if (actionTarget) {
			this.lastNotificationActionTarget = actionTarget;
		}

		const options: DesktopNotificationOptions = {
			title,
			body,
			autoCancel: true,
			extra: {
				notifyType: request.notifyType ?? "info",
				method: request.method,
				...(actionTarget?.workspaceId ? { notifyTargetWorkspaceId: actionTarget.workspaceId } : {}),
				...(actionTarget?.tabId ? { notifyTargetTabId: actionTarget.tabId } : {}),
				...(actionTarget?.sessionPath ? { notifyTargetSessionPath: actionTarget.sessionPath } : {}),
				...(actionTarget?.workspaceLabel ? { notifyTargetWorkspaceLabel: actionTarget.workspaceLabel } : {}),
				...(actionTarget?.sessionLabel ? { notifyTargetSessionLabel: actionTarget.sessionLabel } : {}),
			},
		};
		const sound = this.getDesktopNotificationSound();
		if (sound) {
			options.sound = sound;
		}
		this.trace(
			`notify:native-attempt type=${request.notifyType ?? "info"} title=${title} body=${body} target=${actionTarget?.tabId ?? "-"}`,
		);
		try {
			sendNotification(options);
			this.trace(`notify:native-dispatched type=${request.notifyType ?? "info"} sound=${sound ?? "none"} delivery=unverified`);
			return true;
		} catch (err) {
			this.trace(`notify:native-failed ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	private async showNotification(request: ExtensionUiRequest): Promise<void> {
		const backgrounded = this.isAppBackgrounded();
		this.trace(`notify:request type=${request.notifyType ?? "info"} ${this.describeNotificationContext(backgrounded)}`);
		if (!backgrounded) {
			this.trace("notify:skipped foreground");
			return;
		}
		if (this.shouldThrottleDesktopNotification(request)) {
			return;
		}
		const desktopShown = await this.showDesktopNotification(request);
		if (!desktopShown) {
			this.trace(`notify:desktop-missed message=${request.message ?? request.title ?? ""}`);
		}
		this.trace(`notify:dispatch backgrounded=${backgrounded ? "yes" : "no"} desktop=${desktopShown ? "yes" : "no"}`);
	}

	private setStatus(request: ExtensionUiRequest): void {
		if (!this.statusContainer) return;

		const statusKey = typeof request.statusKey === "string" ? request.statusKey.trim() : "";
		if (statusKey && shouldSuppressUiStatusKey(statusKey)) {
			this.statusContainer.classList.add("hidden");
			this.statusContainer.innerHTML = "";
			return;
		}

		if (request.statusText === undefined) {
			// Clear status
			this.statusContainer.classList.add("hidden");
			this.statusContainer.innerHTML = "";
		} else {
			const text = sanitizeUiStatusText(request.statusText);
			if (!text || shouldSuppressUiStatusText(text)) {
				this.statusContainer.classList.add("hidden");
				this.statusContainer.innerHTML = "";
				return;
			}
			this.statusContainer.classList.remove("hidden");
			render(
				html`<div class="text-xs text-muted-foreground px-3 py-1">${text}</div>`,
				this.statusContainer,
			);
		}
	}

	private setWidget(request: ExtensionUiRequest): void {
		const container =
			request.widgetPlacement === "belowEditor" ? this.widgetBelowContainer : this.widgetAboveContainer;
		if (!container) return;

		const lines = (request.widgetLines ?? [])
			.map((line) => sanitizeUiStatusText(line))
			.filter((line) => Boolean(line) && !shouldSuppressUiStatusText(line));
		if (lines.length === 0) {
			container.classList.add("hidden");
			container.innerHTML = "";
		} else {
			container.classList.remove("hidden");
			render(
				html`
					<div class="text-xs text-muted-foreground px-3 py-2 bg-secondary/50 border-t border-b border-border">
						${lines.map((line) => html`<div>${line}</div>`)}
					</div>
				`,
				container,
			);
		}
	}

	private async setTitle(request: ExtensionUiRequest): Promise<void> {
		const nextTitle = request.title?.trim();
		if (!nextTitle) return;
		document.title = nextTitle;
		try {
			await rpcBridge.setSessionName(nextTitle);
			this.trace(`setTitle:session-renamed title=${nextTitle}`);
		} catch (err) {
			this.trace(`setTitle:rename-failed ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private setEditorText(request: ExtensionUiRequest): void {
		if (typeof request.text !== "string") return;
		this.onSetEditorText?.(request.text);
	}

	private showOverlay(template: TemplateResult): void {
		if (!this.overlayContainer) return;
		this.overlayContainer.classList.remove("hidden");
		render(template, this.overlayContainer);
	}

	private closeOverlay(): void {
		if (!this.overlayContainer) return;
		this.overlayContainer.classList.add("hidden");
		this.overlayContainer.innerHTML = "";
	}

	private async sendResponse(id: string, data: Record<string, unknown>): Promise<void> {
		await rpcBridge.sendExtensionUiResponse({ type: "extension_ui_response", id, ...data });
	}

	destroy(): void {
		this.overlayContainer?.remove();
		this.statusContainer?.remove();
		this.widgetAboveContainer?.remove();
		this.widgetBelowContainer?.remove();
	}
}

