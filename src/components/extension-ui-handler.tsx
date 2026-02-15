/**
 * Extension UI Handler - handles dialogs and notifications from pi extensions
 */

import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rpcBridge } from "../rpc/bridge.js";

/** Extension UI request types */
type UiMethod =
	| "select"
	| "confirm"
	| "input"
	| "editor"
	| "notify"
	| "setStatus"
	| "setWidget"
	| "setTitle"
	| "set_editor_text";

interface ExtensionUiRequest {
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
}

export class ExtensionUiHandler {
	private overlayContainer: HTMLElement | null = null;
	private statusContainer: HTMLElement | null = null;
	private widgetAboveContainer: HTMLElement | null = null;
	private widgetBelowContainer: HTMLElement | null = null;
	private overlayRoot: Root | null = null;
	private statusRoot: Root | null = null;
	private widgetAboveRoot: Root | null = null;
	private widgetBelowRoot: Root | null = null;
	private onSetEditorText: ((text: string) => void) | null = null;

	constructor() {
		this.createContainers();
	}

	setEditorTextHandler(handler: (text: string) => void): void {
		this.onSetEditorText = handler;
	}

	private createContainers(): void {
		// Overlay for dialogs
		this.overlayContainer = document.createElement("div");
		this.overlayContainer.id = "extension-ui-overlay";
		this.overlayContainer.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/50 hidden";
		document.body.appendChild(this.overlayContainer);
		this.overlayRoot = createRoot(this.overlayContainer);

		// Status bar container (above input)
		this.statusContainer = document.createElement("div");
		this.statusContainer.id = "extension-status-container";
		this.statusContainer.className = "hidden fixed bottom-[92px] left-[278px] right-4 z-40 pointer-events-none";
		document.body.appendChild(this.statusContainer);
		this.statusRoot = createRoot(this.statusContainer);

		// Widget containers
		this.widgetAboveContainer = document.createElement("div");
		this.widgetAboveContainer.id = "widget-above";
		this.widgetAboveContainer.className = "hidden fixed bottom-[132px] left-[278px] right-4 z-30";
		document.body.appendChild(this.widgetAboveContainer);
		this.widgetAboveRoot = createRoot(this.widgetAboveContainer);

		this.widgetBelowContainer = document.createElement("div");
		this.widgetBelowContainer.id = "widget-below";
		this.widgetBelowContainer.className = "hidden fixed bottom-3 left-[278px] right-4 z-30";
		document.body.appendChild(this.widgetBelowContainer);
		this.widgetBelowRoot = createRoot(this.widgetBelowContainer);
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
				this.showNotification(request);
				break;
			case "setStatus":
				this.setStatus(request);
				break;
			case "setWidget":
				this.setWidget(request);
				break;
			case "setTitle":
				this.setTitle(request);
				break;
			case "set_editor_text":
				this.setEditorText(request);
				break;
		}
	}

	private async showSelectDialog(request: ExtensionUiRequest): Promise<void> {
		if (!this.overlayContainer) return;

		return new Promise((resolve) => {
			const options = request.options || [];
			let settled = false;
			const finish = (payload: Record<string, unknown>) => {
				if (settled) return;
				settled = true;
				this.closeOverlay();
				void this.sendResponse(request.id, payload);
				resolve();
			};

			const overlay = (
				<div className="bg-background rounded-lg shadow-xl border border-border w-full max-w-md p-4">
					<h3 className="text-sm font-medium mb-3">{request.title || "Select"}</h3>
					<div className="space-y-1 max-h-60 overflow-y-auto">
						{options.map((opt, i) => (
							<button
								className="w-full text-left px-3 py-2 rounded text-sm hover:bg-secondary transition-colors"
								onClick={() => finish({ value: opt, selectedIndex: i })}
								type="button"
								key={`${opt}-${i}`}
							>
								{opt}
							</button>
						))}
					</div>
					<button
						className="mt-3 w-full px-3 py-2 rounded text-sm border border-border hover:bg-secondary transition-colors"
						onClick={() => finish({ cancelled: true })}
						type="button"
					>
						Cancel
					</button>
				</div>
			);

			this.showOverlay(overlay);

			if (request.timeout) {
				setTimeout(() => finish({ cancelled: true }), request.timeout);
			}
		});
	}

	private async showConfirmDialog(request: ExtensionUiRequest): Promise<void> {
		if (!this.overlayContainer) return;

		return new Promise((resolve) => {
			let settled = false;
			const finish = (payload: Record<string, unknown>) => {
				if (settled) return;
				settled = true;
				this.closeOverlay();
				void this.sendResponse(request.id, payload);
				resolve();
			};

			const overlay = (
				<div className="bg-background rounded-lg shadow-xl border border-border w-full max-w-sm p-4">
					<h3 className="text-sm font-medium mb-2">{request.title || "Confirm"}</h3>
					<p className="text-sm text-muted-foreground mb-4">{request.message || "Are you sure?"}</p>
					<div className="flex gap-2 justify-end">
						<button
							className="px-3 py-1.5 rounded text-sm border border-border hover:bg-secondary transition-colors"
							onClick={() => finish({ confirmed: false })}
							type="button"
						>
							Cancel
						</button>
						<button
							className="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							onClick={() => finish({ confirmed: true })}
							type="button"
						>
							Confirm
						</button>
					</div>
				</div>
			);

			this.showOverlay(overlay);

			if (request.timeout) {
				setTimeout(() => finish({ cancelled: true }), request.timeout);
			}
		});
	}

	private async showInputDialog(request: ExtensionUiRequest): Promise<void> {
		if (!this.overlayContainer) return;

		return new Promise((resolve) => {
			let inputValue = request.prefill || "";
			let settled = false;
			const finish = (payload: Record<string, unknown>) => {
				if (settled) return;
				settled = true;
				this.closeOverlay();
				void this.sendResponse(request.id, payload);
				resolve();
			};

			const overlay = (
				<div className="bg-background rounded-lg shadow-xl border border-border w-full max-w-md p-4">
					<h3 className="text-sm font-medium mb-3">{request.title || "Enter value"}</h3>
					<input
						type="text"
						defaultValue={request.prefill || ""}
						className="w-full px-3 py-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
						placeholder={request.placeholder || ""}
						onInput={(e) => {
							inputValue = e.currentTarget.value;
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								finish({ value: inputValue });
							}
						}}
					/>
					<div className="flex gap-2 justify-end mt-3">
						<button
							className="px-3 py-1.5 rounded text-sm border border-border hover:bg-secondary transition-colors"
							onClick={() => finish({ cancelled: true })}
							type="button"
						>
							Cancel
						</button>
						<button
							className="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							onClick={() => finish({ value: inputValue })}
							type="button"
						>
							Submit
						</button>
					</div>
				</div>
			);

			this.showOverlay(overlay);

			setTimeout(() => {
				const input = this.overlayContainer?.querySelector("input") as HTMLInputElement | null;
				input?.focus();
				input?.select();
			}, 50);

			if (request.timeout) {
				setTimeout(() => finish({ cancelled: true }), request.timeout);
			}
		});
	}

	private async showEditorDialog(request: ExtensionUiRequest): Promise<void> {
		if (!this.overlayContainer) return;

		return new Promise((resolve) => {
			let editorValue = request.prefill || "";
			let settled = false;
			const finish = (payload: Record<string, unknown>) => {
				if (settled) return;
				settled = true;
				this.closeOverlay();
				void this.sendResponse(request.id, payload);
				resolve();
			};

			const overlay = (
				<div className="bg-background rounded-lg shadow-xl border border-border w-full max-w-2xl h-96 p-4 flex flex-col">
					<h3 className="text-sm font-medium mb-3">{request.title || "Edit"}</h3>
					<textarea
						defaultValue={request.prefill || ""}
						className="flex-1 w-full px-3 py-2 rounded border border-border bg-background text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary"
						onInput={(e) => {
							editorValue = e.currentTarget.value;
						}}
					/>
					<div className="flex gap-2 justify-end mt-3">
						<button
							className="px-3 py-1.5 rounded text-sm border border-border hover:bg-secondary transition-colors"
							onClick={() => finish({ cancelled: true })}
							type="button"
						>
							Cancel
						</button>
						<button
							className="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
							onClick={() => finish({ value: editorValue })}
							type="button"
						>
							Save
						</button>
					</div>
				</div>
			);

			this.showOverlay(overlay);

			setTimeout(() => {
				const textarea = this.overlayContainer?.querySelector("textarea") as HTMLTextAreaElement | null;
				textarea?.focus();
			}, 50);

			if (request.timeout) {
				setTimeout(() => finish({ cancelled: true }), request.timeout);
			}
		});
	}

	private showNotification(request: ExtensionUiRequest): void {
		const type = request.notifyType || "info";
		const bgColor = type === "error" ? "bg-red-500" : type === "warning" ? "bg-amber-500" : "bg-primary";

		const notification = document.createElement("div");
		notification.className = `fixed bottom-4 right-4 ${bgColor} text-white px-4 py-3 rounded-lg shadow-lg z-50 text-sm animate-slide-in`;
		notification.textContent = request.message || "";

		document.body.appendChild(notification);

		setTimeout(() => {
			notification.remove();
		}, 5000);
	}

	private setStatus(request: ExtensionUiRequest): void {
		if (!this.statusContainer || !this.statusRoot) return;

		if (request.statusText === undefined) {
			this.statusContainer.classList.add("hidden");
			this.statusRoot.render(<></>);
		} else {
			this.statusContainer.classList.remove("hidden");
			this.statusRoot.render(<div className="text-xs text-muted-foreground px-3 py-1">{request.statusText}</div>);
		}
	}

	private setWidget(request: ExtensionUiRequest): void {
		const below = request.widgetPlacement === "belowEditor";
		const container = below ? this.widgetBelowContainer : this.widgetAboveContainer;
		const root = below ? this.widgetBelowRoot : this.widgetAboveRoot;
		if (!container || !root) return;

		if (!request.widgetLines || request.widgetLines.length === 0) {
			container.classList.add("hidden");
			root.render(<></>);
		} else {
			container.classList.remove("hidden");
			root.render(
				<div className="text-xs text-muted-foreground px-3 py-2 bg-secondary/50 border-t border-b border-border">
					{request.widgetLines.map((line, idx) => (
						<div key={`${request.widgetKey || "widget"}-${idx}`}>{line}</div>
					))}
				</div>,
			);
		}
	}

	private setTitle(request: ExtensionUiRequest): void {
		if (request.title) {
			document.title = request.title;
		}
	}

	private setEditorText(request: ExtensionUiRequest): void {
		if (typeof request.text !== "string") return;
		this.onSetEditorText?.(request.text);
	}

	private showOverlay(content: ReactElement): void {
		if (!this.overlayContainer || !this.overlayRoot) return;
		this.overlayContainer.classList.remove("hidden");
		this.overlayRoot.render(content);
	}

	private closeOverlay(): void {
		if (!this.overlayContainer || !this.overlayRoot) return;
		this.overlayContainer.classList.add("hidden");
		this.overlayRoot.render(<></>);
	}

	private async sendResponse(id: string, data: Record<string, unknown>): Promise<void> {
		await rpcBridge.sendExtensionUiResponse({ type: "extension_ui_response", id, ...data });
	}

	destroy(): void {
		this.overlayRoot?.unmount();
		this.statusRoot?.unmount();
		this.widgetAboveRoot?.unmount();
		this.widgetBelowRoot?.unmount();
		this.overlayContainer?.remove();
		this.statusContainer?.remove();
		this.widgetAboveContainer?.remove();
		this.widgetBelowContainer?.remove();
	}
}
