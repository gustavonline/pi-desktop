/**
 * Pi Desktop bootstrap (framework-neutral shell orchestration)
 */

import { ChatView } from "./components/chat-view.js";
import { CommandPalette } from "./components/command-palette.js";
import { ExtensionUiHandler } from "./components/extension-ui-handler.js";
import { ExtensionsPanel } from "./components/extensions-panel.js";
import { SessionBrowser } from "./components/session-browser.js";
import { SettingsPanel } from "./components/settings-panel.js";
import { ShortcutsPanel } from "./components/shortcuts-panel.js";
import { Sidebar } from "./components/sidebar.js";
import { TitleBar } from "./components/titlebar.js";
import { type CliUpdateStatus, rpcBridge } from "./rpc/bridge.js";

let titleBar: TitleBar | null = null;
let sidebar: Sidebar | null = null;
let chatView: ChatView | null = null;
let connectionError: string | null = null;

let settingsPanel: SettingsPanel | null = null;
let commandPalette: CommandPalette | null = null;
let sessionBrowser: SessionBrowser | null = null;
let shortcutsPanel: ShortcutsPanel | null = null;
let extensionUiHandler: ExtensionUiHandler | null = null;
let extensionsPanel: ExtensionsPanel | null = null;

let cliUpdateStatus: CliUpdateStatus | null = null;
let cliUpdatePollingTimer: ReturnType<typeof setInterval> | null = null;
let cliUpdateChecking = false;
let cliUpdating = false;

let currentRpcProjectPath: string | null = null;
let projectSwitchTask: Promise<void> = Promise.resolve();
let appHost: HTMLElement | null = null;
let bootstrapped = false;

function findCliPath(): string | null {
	if (import.meta.env.DEV) {
		// Optional local dev path (if running next to pi-mono)
		return null;
	}
	return null;
}

function getCwd(): string {
	try {
		const raw = localStorage.getItem("pi-desktop.projects.v1");
		if (raw) {
			const projects = JSON.parse(raw) as Array<{ path?: string }>;
			if (projects[0]?.path) return projects[0].path;
		}
	} catch {
		// ignore and fallback
	}
	return ".";
}

function normalizeProjectPath(path: string | null | undefined): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

async function ensureRpcForProject(projectPath: string): Promise<void> {
	const sameProject = normalizeProjectPath(projectPath) === normalizeProjectPath(currentRpcProjectPath);
	if (sameProject && rpcBridge.isConnected) return;

	await rpcBridge.stop().catch(() => {
		/* ignore */
	});
	currentRpcProjectPath = null;

	await rpcBridge.start({ cliPath: findCliPath(), cwd: projectPath });
	currentRpcProjectPath = projectPath;
	await refreshCliUpdateStatus();
}

function applyInitialTheme(): void {
	const theme = (localStorage.getItem("pi-theme") as "dark" | "light" | null) ?? "dark";
	document.documentElement.classList.remove("dark", "light");
	document.documentElement.classList.add(theme);
}

async function runStartupCompatibilityCheck(): Promise<void> {
	try {
		const report = await rpcBridge.checkRpcCompatibility();
		if (!report.ok) {
			chatView?.notify(
				`RPC compatibility check failed${report.error ? `: ${report.error}` : ""}. Open Settings → CLI Runtime for details.`,
				"error",
			);
		} else if (report.optionalWarnings.length > 0) {
			chatView?.notify(
				`Some CLI features may be unavailable with this version. Open Settings → CLI Runtime for compatibility details.`,
				"info",
			);
		}
	} catch (err) {
		chatView?.notify(
			`RPC compatibility check failed: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
	}
}

function applyCliStatusToTitlebar(): void {
	titleBar?.setCliUpdateStatus(cliUpdateStatus);
	titleBar?.setCliUpdating(cliUpdating);
}

async function refreshCliUpdateStatus(): Promise<void> {
	if (cliUpdateChecking || !rpcBridge.isConnected) return;
	cliUpdateChecking = true;
	try {
		cliUpdateStatus = await rpcBridge.getCliUpdateStatus();
	} catch (err) {
		console.warn("Failed to refresh CLI update status:", err);
		cliUpdateStatus = null;
	} finally {
		cliUpdateChecking = false;
		applyCliStatusToTitlebar();
	}
}

function startCliUpdatePolling(): void {
	if (cliUpdatePollingTimer) {
		clearInterval(cliUpdatePollingTimer);
	}
	cliUpdatePollingTimer = setInterval(() => {
		void refreshCliUpdateStatus();
	}, 20 * 60 * 1000);
}

async function updateCliFromTitlebar(): Promise<void> {
	if (cliUpdating) return;
	if (!cliUpdateStatus?.update_available) return;
	if (!(cliUpdateStatus.can_update_in_app && cliUpdateStatus.npm_available)) {
		void settingsPanel?.open();
		return;
	}

	cliUpdating = true;
	applyCliStatusToTitlebar();
	chatView?.notify("Updating CLI…", "info");

	try {
		const result = await rpcBridge.updateCliViaNpm();
		if (result.exit_code === 0) {
			chatView?.notify("CLI updated. Restart desktop to run the new binary.", "success");
		} else {
			const hint = result.stderr?.trim() || result.stdout?.trim() || "npm update failed";
			chatView?.notify(`CLI update failed: ${hint.slice(0, 180)}`, "error");
		}
	} catch (err) {
		chatView?.notify(`CLI update failed: ${err instanceof Error ? err.message : String(err)}`, "error");
	} finally {
		cliUpdating = false;
		await refreshCliUpdateStatus();
		applyCliStatusToTitlebar();
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function mountLoadingView(app: HTMLElement): void {
	app.innerHTML = `
		<div class="app-shell loading">
			<div id="titlebar"></div>
			<div class="loading-view">Starting pi agent…</div>
		</div>
	`;
}

function mountConnectionError(app: HTMLElement): void {
	const safeError = escapeHtml(connectionError ?? "Unknown error");
	app.innerHTML = `
		<div class="error-shell">
			<div class="error-card">
				<h1>Connection failed</h1>
				<p>${safeError}</p>
				<button id="retry-init-btn" type="button">Retry</button>
			</div>
		</div>
	`;
	const retryBtn = app.querySelector("#retry-init-btn") as HTMLButtonElement | null;
	retryBtn?.addEventListener("click", () => {
		connectionError = null;
		void initialize();
	});
}

function mountAppShell(app: HTMLElement): void {
	app.innerHTML = `
		<div class="app-shell">
			<div id="titlebar"></div>
			<div class="content-shell">
				<div id="sidebar-container"></div>
				<div id="chat-container"></div>
			</div>
		</div>
	`;
}

async function initialize(): Promise<void> {
	const app = appHost;
	if (!app) throw new Error("App container not found");

	mountLoadingView(app);

	const titlebarEl = document.getElementById("titlebar");
	if (titlebarEl) titleBar = new TitleBar(titlebarEl);

	initializeComponents();

	try {
		const initialCwd = getCwd();
		const discoveryInfo = await rpcBridge.start({
			cliPath: findCliPath(),
			cwd: initialCwd,
		});
		currentRpcProjectPath = initialCwd;
		console.log("Pi process started via:", discoveryInfo);
		connectionError = null;

		renderApp();

		const chatContainer = document.getElementById("chat-container");
		if (!chatContainer) throw new Error("Chat container missing");
		chatView = new ChatView(chatContainer);
		chatView.setOnStateChange((state) => titleBar?.updateState(state));
		chatView.connect();
		chatView.render();
		chatView.focusInput();

		extensionUiHandler?.setEditorTextHandler((text) => chatView?.setInputText(text));
		wireTitlebarCallbacks();
		wireCommandPaletteBuiltins();

		await chatView.refreshFromBackend();
		await runStartupCompatibilityCheck();
		await refreshCliUpdateStatus();
		startCliUpdatePolling();
	} catch (err) {
		currentRpcProjectPath = null;
		connectionError = err instanceof Error ? err.message : String(err);
		renderApp();
	}
}

function initializeComponents(): void {
	if (settingsPanel || commandPalette || sessionBrowser || shortcutsPanel || extensionsPanel || extensionUiHandler) {
		return;
	}

	const settingsContainer = document.createElement("div");
	settingsContainer.id = "settings-container";
	document.body.appendChild(settingsContainer);
	settingsPanel = new SettingsPanel(settingsContainer);

	const commandPaletteContainer = document.createElement("div");
	commandPaletteContainer.id = "command-palette-container";
	document.body.appendChild(commandPaletteContainer);
	commandPalette = new CommandPalette(commandPaletteContainer);

	const sessionBrowserContainer = document.createElement("div");
	sessionBrowserContainer.id = "session-browser-container";
	document.body.appendChild(sessionBrowserContainer);
	sessionBrowser = new SessionBrowser(sessionBrowserContainer);
	sessionBrowser.setOnSessionSelected(async () => {
		await chatView?.refreshFromBackend();
		chatView?.focusInput();
	});
	sessionBrowser.setOnForkText((text) => {
		chatView?.setInputText(text);
	});

	const shortcutsPanelContainer = document.createElement("div");
	shortcutsPanelContainer.id = "shortcuts-panel-container";
	document.body.appendChild(shortcutsPanelContainer);
	shortcutsPanel = new ShortcutsPanel(shortcutsPanelContainer);

	const extensionsPanelContainer = document.createElement("div");
	extensionsPanelContainer.id = "extensions-panel-container";
	document.body.appendChild(extensionsPanelContainer);
	extensionsPanel = new ExtensionsPanel(extensionsPanelContainer);

	extensionUiHandler = new ExtensionUiHandler();

	rpcBridge.onEvent((event) => {
		if ((event.type as string) === "extension_ui_request") {
			void extensionUiHandler?.handleRequest(event as any);
		}
	});
}

function wireTitlebarCallbacks(): void {
	titleBar?.setOnNewSession(() => {
		void chatView?.newSession();
	});
	titleBar?.setOnOpenSessions(() => {
		void sessionBrowser?.open();
	});
	titleBar?.setOnOpenCommandPalette(() => {
		void commandPalette?.open();
	});
	titleBar?.setOnOpenSettings(() => {
		void settingsPanel?.open();
	});
	titleBar?.setOnUpdateCli(() => {
		void updateCliFromTitlebar();
	});
	applyCliStatusToTitlebar();
}

function wireCommandPaletteBuiltins(): void {
	commandPalette?.setBuiltins([
		{
			name: "new-session",
			description: "Start a fresh session",
			action: async () => chatView?.newSession(),
		},
		{
			name: "sessions",
			description: "Browse and resume sessions",
			action: async () => sessionBrowser?.open(),
		},
		{
			name: "settings",
			description: "Open desktop settings",
			action: async () => settingsPanel?.open(),
		},
		{
			name: "packages",
			description: "Open extensions + package manager",
			action: async () => extensionsPanel?.open(),
		},
		{
			name: "fork",
			description: "Fork from previous user message",
			action: async () => chatView?.openForkPicker(),
		},
		{
			name: "history",
			description: "Open session history viewer",
			action: async () => chatView?.openHistoryViewer(),
		},
		{
			name: "compact",
			description: "Compact current session context",
			action: async () => chatView?.compactNow(),
		},
	]);
}

function openSettings(): void {
	void settingsPanel?.open();
}

function openCommandPalette(): void {
	void commandPalette?.open();
}

function openSessionBrowser(): void {
	void sessionBrowser?.open();
}

function openShortcuts(): void {
	shortcutsPanel?.open();
}

function toggleThemeQuickly(): void {
	const current = (localStorage.getItem("pi-theme") as "dark" | "light" | null) ?? "dark";
	const next = current === "dark" ? "light" : "dark";
	document.documentElement.classList.remove("light", "dark");
	document.documentElement.classList.add(next);
	localStorage.setItem("pi-theme", next);
}

(window as any).openSettings = openSettings;
(window as any).openCommandPalette = openCommandPalette;
(window as any).openSessionBrowser = openSessionBrowser;
(window as any).openShortcuts = openShortcuts;

function setupKeyboardShortcuts(): void {
	document.addEventListener("keydown", (e: KeyboardEvent) => {
		const isCtrlOrMeta = e.ctrlKey || e.metaKey;
		const isShift = e.shiftKey;
		const target = e.target as HTMLElement;
		const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";

		if (isCtrlOrMeta && e.key.toLowerCase() === "n") {
			e.preventDefault();
			void chatView?.newSession();
			return;
		}

		if (isCtrlOrMeta && e.key.toLowerCase() === "l") {
			e.preventDefault();
			chatView?.focusInput();
			return;
		}

		if (isCtrlOrMeta && isShift && e.key.toLowerCase() === "c") {
			e.preventDefault();
			void chatView?.copyLastMessage();
			return;
		}

		if (isCtrlOrMeta && e.key.toLowerCase() === "e" && !isShift) {
			e.preventDefault();
			void chatView?.exportToHtml();
			return;
		}

		if (isCtrlOrMeta && isShift && e.key.toLowerCase() === "e") {
			e.preventDefault();
			void chatView?.shareAsGist();
			return;
		}

		if (isCtrlOrMeta && e.key.toLowerCase() === "k") {
			e.preventDefault();
			void commandPalette?.open();
			return;
		}

		if (isCtrlOrMeta && e.key.toLowerCase() === "p" && !isShift) {
			e.preventDefault();
			void commandPalette?.open();
			return;
		}

		if (isCtrlOrMeta && e.key === ",") {
			e.preventDefault();
			void settingsPanel?.open();
			return;
		}

		if (isCtrlOrMeta && e.key.toLowerCase() === "r" && !isShift) {
			e.preventDefault();
			void sessionBrowser?.open();
			return;
		}

		if (isCtrlOrMeta && isShift && e.key.toLowerCase() === "h") {
			e.preventDefault();
			chatView?.openHistoryViewer();
			return;
		}

		if (isCtrlOrMeta && e.key === "/") {
			e.preventDefault();
			shortcutsPanel?.open();
			return;
		}

		if (isCtrlOrMeta && isShift && e.key.toLowerCase() === "t") {
			e.preventDefault();
			toggleThemeQuickly();
			return;
		}

		if (isCtrlOrMeta && e.key.toLowerCase() === "m" && !isShift) {
			e.preventDefault();
			void rpcBridge
				.cycleModel()
				.then(async () => {
					const state = await rpcBridge.getState();
					titleBar?.updateState(state);
					await chatView?.refreshFromBackend();
				})
				.catch((err) => console.error("Failed to cycle model:", err));
			return;
		}

		if (e.key === "Tab" && isShift && !isInput) {
			e.preventDefault();
			void rpcBridge
				.cycleThinkingLevel()
				.then(async () => {
					const state = await rpcBridge.getState();
					titleBar?.updateState(state);
					await chatView?.refreshFromBackend();
				})
				.catch(() => {
					/* noop */
				});
			return;
		}

		if (isCtrlOrMeta && e.key.toLowerCase() === "t" && !isShift) {
			e.preventDefault();
			chatView?.toggleThinkingBlocks();
			return;
		}

		if (e.key === "Escape") {
			void chatView?.abortCurrentRun();
			return;
		}

		if (e.key === "/" && !isInput) {
			e.preventDefault();
			void commandPalette?.open();
		}
	});
}

function renderApp(): void {
	const app = appHost;
	if (!app) return;

	if (connectionError) {
		mountConnectionError(app);
		return;
	}

	mountAppShell(app);

	const titlebarEl = document.getElementById("titlebar");
	if (titlebarEl) {
		titleBar?.destroy();
		titleBar = new TitleBar(titlebarEl);
		wireTitlebarCallbacks();
	}

	const sidebarContainer = document.getElementById("sidebar-container");
	if (!sidebarContainer) return;
	sidebar = new Sidebar(sidebarContainer);

	sidebar.setOnOpenSettings(() => {
		void settingsPanel?.open();
	});

	sidebar.setOnOpenExtensions(() => {
		void extensionsPanel?.open();
	});

	sidebar.setOnProjectSelect((project) => {
		titleBar?.setProject(project.name);
		projectSwitchTask = projectSwitchTask
			.then(async () => {
				await ensureRpcForProject(project.path);
				await chatView?.refreshFromBackend();
				await chatView?.refreshModels();
				chatView?.focusInput();
			})
			.catch((err) => {
				console.error("Failed to switch project:", err);
				chatView?.notify("Failed to switch project", "error");
			});
	});

	sidebar.setOnNewSessionInProject((project) => {
		titleBar?.setProject(project.name);
		projectSwitchTask = projectSwitchTask
			.then(async () => {
				await ensureRpcForProject(project.path);
				await chatView?.refreshModels();
				await chatView?.newSession();
				chatView?.focusInput();
			})
			.catch((err) => {
				console.error("Failed to create project session:", err);
				chatView?.notify("Failed to create project session", "error");
			});
	});

	sidebar.setOnSessionSelect(async (_projectId, sessionPath) => {
		try {
			await projectSwitchTask;
			const activeProject = sidebar?.getActiveProject();
			if (activeProject?.path) {
				await ensureRpcForProject(activeProject.path);
			}
			const result = await rpcBridge.switchSession(sessionPath);
			if (result.cancelled) return;
			await chatView?.refreshFromBackend();
			chatView?.focusInput();
		} catch (err) {
			console.error("Failed to switch session:", err);
			chatView?.notify("Failed to switch session", "error");
		}
	});

	const activeProject = sidebar.getActiveProject();
	if (activeProject) titleBar?.setProject(activeProject.name);
}

export function bootstrapDesktop(host: HTMLElement): void {
	if (bootstrapped) return;
	bootstrapped = true;
	appHost = host;
	applyInitialTheme();
	setupKeyboardShortcuts();
	void initialize();
}
