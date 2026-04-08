/**
 * Login Panel - OAuth authentication with LLM providers
 *
 * Provides UI for:
 * - Login to providers via OAuth
 * - Logout from providers
 * - View authentication status
 */

import { html, render } from "lit";
import { rpcBridge } from "../rpc/bridge.js";

interface Provider {
	id: string;
	name: string;
	status: "logged_in" | "logged_out" | "none";
}

// Available login providers (these would come from pi's configuration)
const PROVIDERS = [
	{ id: "anthropic", name: "Anthropic (Claude)" },
	{ id: "openai", name: "OpenAI (ChatGPT)" },
	{ id: "google", name: "Google (Gemini)" },
	{ id: "github", name: "GitHub (Copilot)" },
];

export class LoginPanel {
	private container: HTMLElement;
	private isOpen = false;
	private loading = false;
	private onClose: (() => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.render();
	}

	async open(): Promise<void> {
		this.isOpen = true;
		this.loading = true;
		this.render();
		// Would load provider status here
		this.loading = false;
		this.render();
	}

	close(): void {
		this.isOpen = false;
		this.render();
		this.onClose?.();
	}

	setOnClose(callback: () => void): void {
		this.onClose = callback;
	}

	private async login(provider: string): Promise<void> {
		this.loading = true;
		this.render();

		try {
			// The /login command will open a browser OAuth flow
			// In a real implementation, we'd handle this differently
			await rpcBridge.prompt(`/login ${provider}`);
			this.close();
		} catch (err) {
			console.error("Login failed:", err);
		}

		this.loading = false;
		this.render();
	}

	private async logout(provider: string): Promise<void> {
		this.loading = true;
		this.render();

		try {
			await rpcBridge.prompt(`/logout ${provider}`);
		} catch (err) {
			console.error("Logout failed:", err);
		}

		this.loading = false;
		this.render();
	}

	render(): void {
		if (!this.isOpen) {
			this.container.innerHTML = "";
			return;
		}

		const template = html`
			<div class="login-panel-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/50" @click=${(e: Event) => {
				if (e.target === e.currentTarget) this.close();
			}}>
				<div class="bg-background rounded-lg shadow-xl border border-border w-full max-w-md p-4">
					<!-- Header -->
					<div class="flex items-center justify-between mb-4">
						<h2 class="text-lg font-medium">Authentication</h2>
						<button
							class="p-1 rounded hover:bg-secondary transition-colors text-muted-foreground"
							@click=${() => this.close()}
						>
							✕
						</button>
					</div>

					${this.loading
						? html`<div class="p-8 text-center text-muted-foreground">Loading...</div>`
						: html`
							<!-- Provider List -->
							<div class="space-y-3">
								${PROVIDERS.map(
									(provider) => html`
										<div class="flex items-center justify-between p-3 rounded border border-border">
											<div>
												<div class="font-medium">${provider.name}</div>
												<div class="text-xs text-muted-foreground">
													Login with your ${provider.name} account
												</div>
											</div>
											<button
												class="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
												@click=${() => this.login(provider.id)}
											>
												Login
											</button>
										</div>
									`,
								)}
							</div>

							<!-- Info -->
							<div class="mt-4 p-3 rounded bg-secondary/50 text-xs text-muted-foreground">
								<p>
									<strong>Note:</strong> Clicking "Login" will open a browser window for OAuth authentication.
									After authenticating, you can use any model from that provider.
								</p>
								<p class="mt-2">
									Alternatively, you can set API keys directly via environment variables:
									<code class="px-1 py-0.5 rounded bg-background">ANTHROPIC_API_KEY</code>,
									<code class="px-1 py-0.5 rounded bg-background">OPENAI_API_KEY</code>, etc.
								</p>
							</div>
						`}
				</div>
			</div>
		`;

		render(template, this.container);
	}

	destroy(): void {
		this.container.innerHTML = "";
	}
}
