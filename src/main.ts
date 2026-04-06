/**
 * Pi Desktop - app bootstrap
 */

import { html, render } from "lit";
import { ChatView } from "./components/chat-view.js";
import { CommandPalette } from "./components/command-palette.js";
import { ContentTabs } from "./components/content-tabs.js";
import { ExtensionUiHandler, normalizeExtensionUiRequest, type NotificationActionTarget } from "./components/extension-ui-handler.js";
import { FileViewer } from "./components/file-viewer.js";
import { PackagesView } from "./components/packages-view.js";
import { SessionBrowser } from "./components/session-browser.js";
import { SettingsPanel, type SettingsSectionId } from "./components/settings-panel.js";
import { ShortcutsPanel } from "./components/shortcuts-panel.js";
import { Sidebar, type SidebarMode, type SidebarWorkspaceItem } from "./components/sidebar.js";
import { TerminalPanel } from "./components/terminal-panel.js";
import type { WorkspaceTabs } from "./components/workspace-tabs.js";
import { fetchDesktopUpdateStatus, type DesktopUpdateStatus } from "./desktop-updates.js";
import { type CliUpdateStatus, RpcBridge, type RpcSessionState, rpcBridge, setActiveRpcBridge } from "./rpc/bridge.js";
import {
	applyDesktopAppearanceProfileToRoot,
	DESKTOP_APPEARANCE_PROFILE_CHANGED_EVENT,
	loadDesktopAppearanceProfiles,
} from "./theme/appearance-profiles.js";
import { syncDesktopThemeWithPiTheme } from "./theme/pi-theme-bridge.js";
import { DESKTOP_THEME_CHANGED_EVENT, getResolvedDesktopTheme, initializeDesktopTheme, toggleDesktopTheme } from "./theme/theme-manager.js";
import { ensureBundledThemesInstalled } from "./theme/bundled-themes.js";
import "./styles/app.css";

interface WorkspaceSessionTab {
	id: string;
	projectId: string | null;
	projectPath: string | null;
	sessionPath: string | null;
	title: string;
	messageCount: number | null;
	ephemeral: boolean;
	needsAttention: boolean;
	attentionMessage: string | null;
}

interface WorkspaceFileTab {
	id: string;
	projectId: string | null;
	projectPath: string | null;
	path: string | null;
	title: string;
	draftDirectoryPath: string | null;
	draftAnchorPath: string | null;
}

interface WorkspaceState {
	id: string;
	title: string;
	color: string | null;
	emoji: string | null;
	pinned: boolean;
	leftMode: SidebarMode;
	pane: "chat" | "file" | "packages" | "settings" | "terminal";
	activeProjectId: string | null;
	activeProjectPath: string | null;
	filePath: string | null;
	terminalOpen: boolean;
	sessionTitle: string;
	sessionTabs: WorkspaceSessionTab[];
	activeSessionTabId: string | null;
	fileTabs: WorkspaceFileTab[];
	activeFileTabId: string | null;
}

interface SessionRuntime {
	key: string;
	instanceId: string;
	bridge: RpcBridge;
	workspaceId: string;
	tabId: string;
	projectPath: string;
	lastKnownSessionPath: string | null;
	running: boolean;
	draftInitialized: boolean;
	phase: "idle" | "starting" | "switching_session" | "creating_session" | "ready" | "failed";
	lastError: string | null;
	eventUnlisten: (() => void) | null;
}

const WORKSPACES_STORAGE_KEY = "pi-desktop.workspaces.v1";
const WORKSPACES_ACTIVE_STORAGE_KEY = "pi-desktop.workspaces.active.v1";
const LEGACY_PROJECTS_STORAGE_KEY = "pi-desktop.projects.v1";
const WORKSPACE_DEFAULT_ID = "workspace_default";
const WORKSPACE_PROJECTS_KEY_PREFIX = "pi-desktop.workspace-projects.v1";
const SIDEBAR_WIDTH_KEY = "pi-desktop.sidebar.width.v1";
const SIDEBAR_COLLAPSED_STATE_KEY = "pi-desktop.sidebar.collapsed.v1";
const SIDEBAR_WIDTH_MIN = 240;
const SIDEBAR_WIDTH_MAX = 540;
const NEW_SESSION_TAB_TITLE = "New session";
const NEW_FILE_TAB_TITLE = "New file";
const DEBUG_OVERLAY_STORAGE_KEY = "pi-desktop.debug-overlay.v1";
const CLI_UPDATE_NOTICE_STORAGE_KEY = "pi-desktop.cli-update-notice-at.v1";
const DESKTOP_UPDATE_NOTICE_STORAGE_KEY = "pi-desktop.desktop-update-notice-at.v1";
const UPDATE_NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLI_INSTALL_COMMAND = "npm install -g @mariozechner/pi-coding-agent";
const SESSION_ATTENTION_MESSAGES = [
	"I’m waiting for you — Pi",
	"Ready when you are — Pi",
	"Your move when you’re back — Pi",
	"Come back when you want, I’m here — Pi",
] as const;

let sidebar: Sidebar | null = null;
let chatView: ChatView | null = null;
let workspaceTabsBar: WorkspaceTabs | null = null;
let contentTabsBar: ContentTabs | null = null;
let fileViewer: FileViewer | null = null;
let terminalPanel: TerminalPanel | null = null;
let packagesView: PackagesView | null = null;
let connectionError: string | null = null;

let settingsPanel: SettingsPanel | null = null;
let commandPalette: CommandPalette | null = null;
let sessionBrowser: SessionBrowser | null = null;
let shortcutsPanel: ShortcutsPanel | null = null;
let extensionUiHandler: ExtensionUiHandler | null = null;

let cliUpdateStatus: CliUpdateStatus | null = null;
let desktopUpdateStatus: DesktopUpdateStatus | null = null;
let cliUpdatePollingTimer: ReturnType<typeof setInterval> | null = null;
let desktopUpdatePollingTimer: ReturnType<typeof setInterval> | null = null;
let cliUpdateChecking = false;
let desktopUpdateChecking = false;

let projectSwitchTask: Promise<void> = Promise.resolve();
let projectSwitchVersion = 0;
let workspacePaneApplyVersion = 0;
let settingsPaneRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

class StaleProjectTaskError extends Error {
	constructor() {
		super("Stale project task");
	}
}

let workspaces: WorkspaceState[] = [];
let activeWorkspaceId: string | null = null;
let sidebarWidth = 320;
let removeSidebarResizeHandlers: (() => void) | null = null;
let sidebarSessionsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let sidebarSessionsWarmInterval: ReturnType<typeof setInterval> | null = null;
let sidebarSessionsWarmStopTimer: ReturnType<typeof setTimeout> | null = null;
let sessionRuntimes = new Map<string, SessionRuntime>();
let activeSessionRuntimeKey: string | null = null;
let runningSessionPollInterval: ReturnType<typeof setInterval> | null = null;
let runningSessionPollInFlight = false;
let debugOverlayInterval: ReturnType<typeof setInterval> | null = null;
let debugTraceLines: string[] = [];
let notificationAttentionListenersBound = false;

function recordDebugTrace(message: string): void {
	const stamp = new Date().toISOString().slice(11, 23);
	const line = `${stamp} ${message}`;
	debugTraceLines = [...debugTraceLines.slice(-79), line];
	console.debug(`[pi-desktop] ${line}`);
	syncDebugOverlay();
}

(window as typeof window & {
	__PI_DESKTOP_PUSH_TRACE__?: (message: string) => void;
	__PI_DESKTOP_GET_TRACE__?: () => string[];
}).__PI_DESKTOP_PUSH_TRACE__ = (message: string) => {
	recordDebugTrace(message);
};

(window as typeof window & {
	__PI_DESKTOP_PUSH_TRACE__?: (message: string) => void;
	__PI_DESKTOP_GET_TRACE__?: () => string[];
}).__PI_DESKTOP_GET_TRACE__ = () => [...debugTraceLines];

function uid(prefix = "id"): string {
	return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function pickSessionAttentionMessage(current?: string | null): string {
	const options = SESSION_ATTENTION_MESSAGES as readonly string[];
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const candidate = options[Math.floor(Math.random() * options.length)] || options[0] || "I’m waiting for you — Pi";
		if (!current || candidate !== current) return candidate;
	}
	return options[0] || "I’m waiting for you — Pi";
}

function shouldShowDebugOverlay(): boolean {
	try {
		return localStorage.getItem(DEBUG_OVERLAY_STORAGE_KEY) === "1";
	} catch {
		return false;
	}
}

function isCliMissingError(message: string | null | undefined): boolean {
	const text = (message ?? "").toLowerCase();
	if (!text) return false;
	if (text.includes("could not find the pi cli") || text.includes("npm install -g @mariozechner/pi-coding-agent")) {
		return true;
	}
	if (text.includes("'pi' is not recognized as an internal or external command")) {
		return true;
	}
	return text.includes("enoent") && text.includes("pi");
}

async function copyCliInstallCommand(): Promise<void> {
	try {
		await navigator.clipboard.writeText(CLI_INSTALL_COMMAND);
	} catch {
		window.prompt("Copy and run this command in Terminal", CLI_INSTALL_COMMAND);
	}
}

function readLastUpdateNoticeAt(storageKey: string): number {
	try {
		const raw = localStorage.getItem(storageKey);
		const parsed = raw ? Number(raw) : 0;
		return Number.isFinite(parsed) ? parsed : 0;
	} catch {
		return 0;
	}
}

function shouldNotifyUpdate(storageKey: string, now = Date.now()): boolean {
	return now - readLastUpdateNoticeAt(storageKey) >= UPDATE_NOTICE_INTERVAL_MS;
}

function markUpdateNotified(storageKey: string, now = Date.now()): void {
	try {
		localStorage.setItem(storageKey, String(now));
	} catch {
		// ignore
	}
}

function shouldNotifyCliUpdate(now = Date.now()): boolean {
	return shouldNotifyUpdate(CLI_UPDATE_NOTICE_STORAGE_KEY, now);
}

function markCliUpdateNotified(now = Date.now()): void {
	markUpdateNotified(CLI_UPDATE_NOTICE_STORAGE_KEY, now);
}

function shouldNotifyDesktopUpdate(now = Date.now()): boolean {
	return shouldNotifyUpdate(DESKTOP_UPDATE_NOTICE_STORAGE_KEY, now);
}

function markDesktopUpdateNotified(now = Date.now()): void {
	markUpdateNotified(DESKTOP_UPDATE_NOTICE_STORAGE_KEY, now);
}

function normalizeProjectPath(path: string | null | undefined): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function baseName(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const parts = normalized.split("/");
	return parts[parts.length - 1] || path;
}

function normalizeSessionPath(path: string | null | undefined): string {
	if (!path) return "";
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function sessionRuntimeKey(workspaceId: string, tabId: string): string {
	return `${workspaceId}::${tabId}`;
}

function sessionRuntimeInstanceId(runtimeKey: string): string {
	return `session_${runtimeKey.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function getRuntimeForTab(workspaceId: string, tabId: string): SessionRuntime | null {
	return sessionRuntimes.get(sessionRuntimeKey(workspaceId, tabId)) ?? null;
}

function getOrCreateRuntimeForTab(workspaceId: string, tabId: string, projectPath: string): SessionRuntime {
	const key = sessionRuntimeKey(workspaceId, tabId);
	const existing = sessionRuntimes.get(key);
	if (existing) {
		return existing;
	}
	const instanceId = sessionRuntimeInstanceId(key);
	const runtime: SessionRuntime = {
		key,
		instanceId,
		bridge: new RpcBridge(instanceId),
		workspaceId,
		tabId,
		projectPath,
		lastKnownSessionPath: null,
		running: false,
		draftInitialized: false,
		phase: "idle",
		lastError: null,
		eventUnlisten: null,
	};
	runtime.eventUnlisten = runtime.bridge.onEvent((event) => {
		handleBackgroundRuntimeNotifyEvent(runtime.key, event);
	});
	sessionRuntimes.set(key, runtime);
	return runtime;
}

function setActiveRuntime(runtime: SessionRuntime | null): void {
	activeSessionRuntimeKey = runtime?.key ?? null;
	setActiveRpcBridge(runtime?.bridge ?? null);
	syncDebugOverlay();
}

function getActiveRuntime(): SessionRuntime | null {
	if (!activeSessionRuntimeKey) return null;
	return sessionRuntimes.get(activeSessionRuntimeKey) ?? null;
}

function resolveRuntimeNotifyTarget(runtime: SessionRuntime): {
	workspaceId?: string;
	tabId?: string;
	sessionPath?: string;
} {
	const workspace = workspaces.find((entry) => entry.id === runtime.workspaceId) ?? null;
	const tab = workspace ? workspace.sessionTabs.find((entry) => entry.id === runtime.tabId) ?? null : null;
	const sessionPath = runtime.lastKnownSessionPath ?? tab?.sessionPath ?? undefined;
	return {
		workspaceId: runtime.workspaceId || workspace?.id || undefined,
		tabId: runtime.tabId || tab?.id || undefined,
		sessionPath: sessionPath ?? undefined,
	};
}

function handleBackgroundRuntimeNotifyEvent(runtimeKey: string, event: Record<string, unknown>): void {
	const runtime = sessionRuntimes.get(runtimeKey);
	if (!runtime) return;
	if (runtime.key === activeSessionRuntimeKey) return;

	const type = typeof event.type === "string" ? event.type : "unknown";
	if (type !== "extension_ui_request") return;
	const method = typeof event.method === "string" ? event.method : "unknown";
	if (method !== "notify") return;

	const message = typeof event.message === "string" ? event.message : "";
	recordDebugTrace(`rpc:event type=${type} source=background runtime=${runtime.instanceId}`);
	recordDebugTrace(`extension_ui_request method=${method} message=${message.slice(0, 80)} source=background runtime=${runtime.instanceId}`);

	const request = { ...(event as Record<string, unknown>) };
	const target = resolveRuntimeNotifyTarget(runtime);
	if (target.workspaceId || target.tabId || target.sessionPath) {
		request.notifyTargetWorkspaceId = target.workspaceId;
		request.notifyTargetTabId = target.tabId;
		request.notifyTargetSessionPath = target.sessionPath;
		recordDebugTrace(
			`notify-target workspace=${target.workspaceId ?? "-"} tab=${target.tabId ?? "-"} session=${target.sessionPath ?? "-"} source=background`,
		);
		markSessionAttentionTarget(target);
	}

	const normalizedRequest = normalizeExtensionUiRequest(request);
	if (!normalizedRequest) {
		const requestId = typeof request.id === "string" ? request.id.trim() : "";
		const unsupportedMethod = typeof request.method === "string" ? request.method : "unknown";
		recordDebugTrace(`extension_ui_request unsupported method=${unsupportedMethod} source=background runtime=${runtime.instanceId}`);
		if (requestId) {
			void runtime.bridge.sendExtensionUiResponse({
				type: "extension_ui_response",
				id: requestId,
				success: false,
				error: `Unsupported extension UI capability: ${unsupportedMethod}`,
			});
		}
		return;
	}

	void extensionUiHandler?.handleRequest(normalizedRequest);
}

function setRuntimeRunning(runtime: SessionRuntime | null, running: boolean, _options: { suppressNotify?: boolean } = {}): void {
	if (!runtime) return;
	const wasRunning = runtime.running;
	if (wasRunning === running) return;
	runtime.running = running;
	if (running) {
		extensionUiHandler?.primeNotificationPermission();
	}
	syncRunningSessionIndicators();
	ensureRunningSessionPoller();
}

function syncRunningSessionIndicators(): void {
	const runningPaths: string[] = [];
	for (const runtime of sessionRuntimes.values()) {
		if (!runtime.running) continue;
		if (!runtime.lastKnownSessionPath) continue;
		runningPaths.push(runtime.lastKnownSessionPath);
	}
	sidebar?.setRunningSessionPaths(runningPaths);
}

function ensureRunningSessionPoller(): void {
	const hasRunning = [...sessionRuntimes.values()].some((runtime) => runtime.running);
	if (!hasRunning) {
		if (runningSessionPollInterval) {
			clearInterval(runningSessionPollInterval);
			runningSessionPollInterval = null;
		}
		return;
	}

	if (runningSessionPollInterval) return;
	runningSessionPollInterval = setInterval(() => {
		void pollBackgroundRuntimeState();
	}, 1200);
}

async function pollBackgroundRuntimeState(): Promise<void> {
	if (runningSessionPollInFlight) return;
	runningSessionPollInFlight = true;
	try {
		const runtimes = [...sessionRuntimes.values()].filter((runtime) => runtime.running && runtime.key !== activeSessionRuntimeKey);
		if (runtimes.length === 0) return;

		let changed = false;
		for (const runtime of runtimes) {
			try {
				const state = await runtime.bridge.getState();
				if (state.sessionFile) {
					runtime.lastKnownSessionPath = state.sessionFile;
				}
				const running = Boolean(state.isStreaming);
				if (running !== runtime.running) {
					setRuntimeRunning(runtime, running);
					changed = true;
				}
			} catch {
				try {
					const alive = await runtime.bridge.refreshRunningState();
					if (!alive && runtime.running) {
						setRuntimeRunning(runtime, false, { suppressNotify: true });
						changed = true;
					}
				} catch {
					// ignore polling errors; next tick may recover
				}
			}
		}

		if (changed) {
			syncRunningSessionIndicators();
			ensureRunningSessionPoller();
		}
	} finally {
		runningSessionPollInFlight = false;
	}
}

function updateRuntimeFromState(runtime: SessionRuntime | null, state: RpcSessionState): void {
	if (!runtime) return;
	if (state.sessionFile) {
		runtime.lastKnownSessionPath = state.sessionFile;
	}
	setRuntimeRunning(runtime, Boolean(state.isStreaming));
}

async function stopRuntimeInstance(runtime: SessionRuntime): Promise<void> {
	try {
		await runtime.bridge.stop();
	} catch {
		// ignore
	}
	await runtime.bridge.teardownListeners().catch(() => {
		/* ignore */
	});
}

function removeRuntimeByKey(runtimeKey: string): void {
	const runtime = sessionRuntimes.get(runtimeKey);
	if (!runtime) return;
	runtime.eventUnlisten?.();
	runtime.eventUnlisten = null;
	sessionRuntimes.delete(runtimeKey);
	if (activeSessionRuntimeKey === runtimeKey) {
		setActiveRuntime(null);
	}
	setRuntimeRunning(runtime, false, { suppressNotify: true });
	runtime.phase = "idle";
	syncDebugOverlay();
	void stopRuntimeInstance(runtime);
}

function removeRuntimeForTab(workspaceId: string, tabId: string): void {
	removeRuntimeByKey(sessionRuntimeKey(workspaceId, tabId));
}

function listRuntimeKeysForWorkspace(workspaceId: string): string[] {
	return [...sessionRuntimes.keys()].filter((key) => key.startsWith(`${workspaceId}::`));
}

function removeRuntimeKeys(keys: string[]): void {
	keys.forEach((key) => removeRuntimeByKey(key));
}

function removeRuntimesForWorkspace(workspaceId: string): void {
	removeRuntimeKeys(listRuntimeKeysForWorkspace(workspaceId));
}

function normalizeStoredId(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStoredPath(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function setWorkspaceActiveProject(
	workspace: WorkspaceState,
	project: { id?: string | null; path?: string | null } | null,
): void {
	workspace.activeProjectId = normalizeStoredId(project?.id ?? null);
	workspace.activeProjectPath = normalizeStoredPath(project?.path ?? null);
}

function setSessionTabProject(tab: WorkspaceSessionTab, projectId: string | null, projectPath: string | null): void {
	tab.projectId = normalizeStoredId(projectId);
	tab.projectPath = normalizeStoredPath(projectPath);
}

function setFileTabProject(tab: WorkspaceFileTab, projectId: string | null, projectPath: string | null): void {
	tab.projectId = normalizeStoredId(projectId);
	tab.projectPath = normalizeStoredPath(projectPath);
}

function getSessionTabProjectPath(tab: WorkspaceSessionTab | null | undefined): string | null {
	return normalizeStoredPath(tab?.projectPath ?? null);
}

function getFileTabProjectPath(tab: WorkspaceFileTab | null | undefined): string | null {
	return normalizeStoredPath(tab?.projectPath ?? null);
}

function getSessionTabProjectId(tab: WorkspaceSessionTab | null | undefined): string | null {
	return normalizeStoredId(tab?.projectId ?? null);
}

function getFileTabProjectId(tab: WorkspaceFileTab | null | undefined): string | null {
	return normalizeStoredId(tab?.projectId ?? null);
}

function getWorkspaceActiveProjectPath(workspace: WorkspaceState): string | null {
	const activeFile = workspace.fileTabs.find((tab) => tab.id === workspace.activeFileTabId) ?? null;
	const activeSession = workspace.sessionTabs.find((tab) => tab.id === workspace.activeSessionTabId) ?? workspace.sessionTabs[0] ?? null;
	return workspace.pane === "file"
		? getFileTabProjectPath(activeFile) ?? getSessionTabProjectPath(activeSession) ?? normalizeStoredPath(workspace.activeProjectPath)
		: getSessionTabProjectPath(activeSession) ?? getFileTabProjectPath(activeFile) ?? normalizeStoredPath(workspace.activeProjectPath);
}

function getWorkspaceActiveProjectId(workspace: WorkspaceState): string | null {
	const activeFile = workspace.fileTabs.find((tab) => tab.id === workspace.activeFileTabId) ?? null;
	const activeSession = workspace.sessionTabs.find((tab) => tab.id === workspace.activeSessionTabId) ?? workspace.sessionTabs[0] ?? null;
	return workspace.pane === "file"
		? getFileTabProjectId(activeFile) ?? getSessionTabProjectId(activeSession) ?? normalizeStoredId(workspace.activeProjectId)
		: getSessionTabProjectId(activeSession) ?? getFileTabProjectId(activeFile) ?? normalizeStoredId(workspace.activeProjectId);
}

function createSessionTab(
	title = NEW_SESSION_TAB_TITLE,
	sessionPath: string | null = null,
	projectId: string | null = null,
	projectPath: string | null = null,
): WorkspaceSessionTab {
	const normalizedSessionPath = normalizeStoredPath(sessionPath);
	return {
		id: uid("sessiontab"),
		projectId: normalizeStoredId(projectId),
		projectPath: normalizeStoredPath(projectPath),
		sessionPath: normalizedSessionPath,
		title: title.trim() || NEW_SESSION_TAB_TITLE,
		messageCount: normalizedSessionPath ? null : 0,
		ephemeral: !normalizedSessionPath,
		needsAttention: false,
		attentionMessage: null,
	};
}

function isDraftSessionTab(tab: WorkspaceSessionTab): boolean {
	return !tab.sessionPath;
}

function isEphemeralSessionTab(tab: WorkspaceSessionTab | null | undefined): boolean {
	return Boolean(tab?.ephemeral);
}

function isDraftFileTab(tab: WorkspaceFileTab): boolean {
	return !tab.path;
}

function ensureWorkspaceContentState(workspace: WorkspaceState): void {
	workspace.activeProjectId = normalizeStoredId(workspace.activeProjectId);
	workspace.activeProjectPath = normalizeStoredPath(workspace.activeProjectPath);

	const incomingSessionTabs = Array.isArray(workspace.sessionTabs) ? workspace.sessionTabs : [];
	workspace.sessionTabs = incomingSessionTabs
		.filter((tab) => tab && typeof tab.id === "string" && tab.id.length > 0)
		.map((tab) => {
			const sessionPath = normalizeStoredPath(tab.sessionPath);
			const storedMessageCount = (tab as Partial<WorkspaceSessionTab>).messageCount;
			const needsAttentionRaw = (tab as Partial<WorkspaceSessionTab>).needsAttention;
			const attentionMessageRaw = (tab as Partial<WorkspaceSessionTab>).attentionMessage;
			return {
				id: tab.id,
				projectId: normalizeStoredId((tab as Partial<WorkspaceSessionTab>).projectId),
				projectPath: normalizeStoredPath((tab as Partial<WorkspaceSessionTab>).projectPath),
				sessionPath,
				title: typeof tab.title === "string" && tab.title.trim().length > 0 ? tab.title.trim() : NEW_SESSION_TAB_TITLE,
				messageCount: typeof storedMessageCount === "number" && Number.isFinite(storedMessageCount) ? storedMessageCount : sessionPath ? null : 0,
				ephemeral: typeof (tab as Partial<WorkspaceSessionTab>).ephemeral === "boolean" ? Boolean((tab as Partial<WorkspaceSessionTab>).ephemeral) : !sessionPath,
				needsAttention: typeof needsAttentionRaw === "boolean" ? needsAttentionRaw : false,
				attentionMessage:
					typeof attentionMessageRaw === "string" && attentionMessageRaw.trim().length > 0
						? attentionMessageRaw.trim()
						: null,
			};
		});

	if (workspace.sessionTabs.length === 0) {
		const fallbackTitle =
			typeof workspace.sessionTitle === "string" && workspace.sessionTitle.trim().length > 0
				? workspace.sessionTitle
				: NEW_SESSION_TAB_TITLE;
		workspace.sessionTabs = [createSessionTab(fallbackTitle, null, workspace.activeProjectId, workspace.activeProjectPath)];
	}

	if (workspace.sessionTabs.length > 1) {
		workspace.sessionTabs = workspace.sessionTabs.filter((tab) => {
			if (tab.sessionPath) return true;
			return tab.title.trim().toLowerCase() !== "chat";
		});
		if (workspace.sessionTabs.length === 0) {
			workspace.sessionTabs = [createSessionTab(NEW_SESSION_TAB_TITLE, null, workspace.activeProjectId, workspace.activeProjectPath)];
		}
	}

	if (!workspace.activeSessionTabId || !workspace.sessionTabs.some((tab) => tab.id === workspace.activeSessionTabId)) {
		workspace.activeSessionTabId = workspace.sessionTabs[0]?.id ?? null;
	}

	const incomingFileTabs = Array.isArray(workspace.fileTabs) ? workspace.fileTabs : [];
	workspace.fileTabs = incomingFileTabs
		.filter((tab) => tab && typeof tab.id === "string" && tab.id.length > 0)
		.map((tab) => {
			const path = normalizeStoredPath(tab.path);
			const fallbackTitle = path ? baseName(path) : NEW_FILE_TAB_TITLE;
			const projectPath = normalizeStoredPath((tab as Partial<WorkspaceFileTab>).projectPath);
			const draftDirectoryPath = path
				? null
				: normalizeStoredPath((tab as Partial<WorkspaceFileTab>).draftDirectoryPath) ?? projectPath;
			const draftAnchorPath = path ? null : normalizeStoredPath((tab as Partial<WorkspaceFileTab>).draftAnchorPath);
			return {
				id: tab.id,
				projectId: normalizeStoredId((tab as Partial<WorkspaceFileTab>).projectId),
				projectPath,
				path,
				title: typeof tab.title === "string" && tab.title.trim().length > 0 ? tab.title.trim() : fallbackTitle,
				draftDirectoryPath,
				draftAnchorPath,
			};
		});

	if (!workspace.activeFileTabId || !workspace.fileTabs.some((tab) => tab.id === workspace.activeFileTabId)) {
		workspace.activeFileTabId = workspace.fileTabs[0]?.id ?? null;
	}

	const activeSession = workspace.sessionTabs.find((tab) => tab.id === workspace.activeSessionTabId) ?? workspace.sessionTabs[0] ?? null;
	const activeFile = workspace.fileTabs.find((tab) => tab.id === workspace.activeFileTabId) ?? null;

	if (activeSession && isDraftSessionTab(activeSession) && !activeSession.projectPath && workspace.activeProjectPath) {
		setSessionTabProject(activeSession, workspace.activeProjectId, workspace.activeProjectPath);
	}
	if (activeFile && isDraftFileTab(activeFile) && !activeFile.projectPath && workspace.activeProjectPath) {
		setFileTabProject(activeFile, workspace.activeProjectId, workspace.activeProjectPath);
	}
	if (activeFile && isDraftFileTab(activeFile) && !activeFile.draftDirectoryPath) {
		activeFile.draftDirectoryPath = activeFile.projectPath ?? workspace.activeProjectPath;
	}
	if (activeFile && !isDraftFileTab(activeFile)) {
		activeFile.draftDirectoryPath = null;
		activeFile.draftAnchorPath = null;
	}

	workspace.activeProjectId = getWorkspaceActiveProjectId(workspace);
	workspace.activeProjectPath = getWorkspaceActiveProjectPath(workspace);
	workspace.sessionTitle = activeSession?.title ?? NEW_SESSION_TAB_TITLE;
	workspace.filePath = activeFile?.path ?? null;
}

function getActiveSessionTab(workspace: WorkspaceState): WorkspaceSessionTab {
	ensureWorkspaceContentState(workspace);
	return workspace.sessionTabs.find((tab) => tab.id === workspace.activeSessionTabId) ?? workspace.sessionTabs[0];
}

function clearSessionAttention(tab: WorkspaceSessionTab | null | undefined): boolean {
	if (!tab) return false;
	if (!tab.needsAttention && !tab.attentionMessage) return false;
	tab.needsAttention = false;
	tab.attentionMessage = null;
	return true;
}

function markSessionAttentionTarget(target: {
	workspaceId?: string;
	tabId?: string;
	sessionPath?: string;
}): void {
	const workspace = target.workspaceId
		? workspaces.find((entry) => entry.id === target.workspaceId) ?? null
		: getActiveWorkspace();
	if (!workspace) return;
	ensureWorkspaceContentState(workspace);

	let tab: WorkspaceSessionTab | null = null;
	if (target.tabId) {
		tab = workspace.sessionTabs.find((entry) => entry.id === target.tabId) ?? null;
	}
	if (!tab && target.sessionPath) {
		const normalizedPath = normalizeSessionPath(target.sessionPath);
		tab = workspace.sessionTabs.find((entry) => normalizeSessionPath(entry.sessionPath) === normalizedPath) ?? null;
	}
	if (!tab && !target.tabId && !target.sessionPath) {
		tab = getActiveSessionTab(workspace);
	}
	if (!tab) return;

	const windowVisible = typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
	const sameActiveSession = activeWorkspaceId === workspace.id && workspace.activeSessionTabId === tab.id && workspace.pane === "chat";
	if (windowVisible && sameActiveSession) {
		if (clearSessionAttention(tab)) {
			persistWorkspaces();
			syncContentTabsBar(workspace);
		}
		return;
	}

	tab.needsAttention = true;
	tab.attentionMessage = pickSessionAttentionMessage(tab.attentionMessage);
	recordDebugTrace(`notify-attention:set workspace=${workspace.id} tab=${tab.id} message=${tab.attentionMessage}`);
	persistWorkspaces();
	if (activeWorkspaceId === workspace.id) {
		syncContentTabsBar(workspace);
		syncSidebarSelectionFromWorkspace(workspace);
	}
}

function clearVisibleActiveSessionAttention(): void {
	if (typeof document === "undefined") return;
	if (document.visibilityState !== "visible" || !document.hasFocus()) return;
	const workspace = getActiveWorkspace();
	if (!workspace || workspace.pane !== "chat") return;
	const tab = getActiveSessionTab(workspace);
	if (!clearSessionAttention(tab)) return;
	recordDebugTrace(`notify-attention:cleared workspace=${workspace.id} tab=${tab.id}`);
	persistWorkspaces();
	syncContentTabsBar(workspace);
	syncSidebarSelectionFromWorkspace(workspace);
}

function ensureNotificationAttentionListeners(): void {
	if (notificationAttentionListenersBound) return;
	notificationAttentionListenersBound = true;
	window.addEventListener("focus", () => {
		clearVisibleActiveSessionAttention();
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") {
			clearVisibleActiveSessionAttention();
		}
	});
}

function setActiveSessionTab(workspace: WorkspaceState, tabId: string): WorkspaceSessionTab | null {
	ensureWorkspaceContentState(workspace);
	const tab = workspace.sessionTabs.find((entry) => entry.id === tabId);
	if (!tab) return null;
	clearSessionAttention(tab);
	workspace.activeSessionTabId = tab.id;
	workspace.sessionTitle = tab.title;
	setWorkspaceActiveProject(workspace, { id: tab.projectId, path: tab.projectPath });
	workspace.pane = "chat";
	return tab;
}

function openOrActivateSessionTab(
	workspace: WorkspaceState,
	sessionPath: string,
	projectId: string | null,
	projectPath: string | null,
	preferredTitle?: string,
): WorkspaceSessionTab {
	ensureWorkspaceContentState(workspace);
	const normalized = normalizeSessionPath(sessionPath);
	let tab = workspace.sessionTabs.find((entry) => normalizeSessionPath(entry.sessionPath) === normalized);
	const nextTitle = (preferredTitle || baseName(sessionPath)).trim() || "Chat";
	if (!tab) {
		const activeDraft = workspace.sessionTabs.find((entry) => entry.id === workspace.activeSessionTabId && isDraftSessionTab(entry));
		const anyDraft = workspace.sessionTabs.find((entry) => isDraftSessionTab(entry));
		const onlyTab = workspace.sessionTabs.length === 1 ? workspace.sessionTabs[0] : null;
		const onlyTabLooksLikeSeed =
			Boolean(onlyTab) &&
			["chat", "new session", ""].includes(((onlyTab?.title || "").trim().toLowerCase()));
		const reusableTab = activeDraft ?? anyDraft ?? (onlyTabLooksLikeSeed ? onlyTab : null);
		if (reusableTab) {
			reusableTab.sessionPath = sessionPath;
			reusableTab.title = nextTitle;
			reusableTab.messageCount = null;
			reusableTab.ephemeral = false;
			setSessionTabProject(reusableTab, projectId, projectPath);
			tab = reusableTab;
		} else {
			tab = createSessionTab(nextTitle, sessionPath, projectId, projectPath);
			workspace.sessionTabs.push(tab);
		}
	} else {
		setSessionTabProject(tab, projectId, projectPath);
		tab.messageCount = tab.messageCount ?? null;
		tab.ephemeral = false;
		if (preferredTitle && preferredTitle.trim().length > 0) {
			tab.title = preferredTitle.trim();
		}
	}
	clearSessionAttention(tab);
	workspace.activeSessionTabId = tab.id;
	workspace.sessionTitle = tab.title;
	setWorkspaceActiveProject(workspace, { id: tab.projectId, path: tab.projectPath });
	workspace.pane = "chat";
	return tab;
}

function openOrActivateFileTab(
	workspace: WorkspaceState,
	filePath: string,
	projectId: string | null,
	projectPath: string | null,
): WorkspaceFileTab {
	ensureWorkspaceContentState(workspace);
	const normalized = normalizeProjectPath(filePath);
	let tab = workspace.fileTabs.find((entry) => normalizeProjectPath(entry.path) === normalized);
	if (!tab) {
		tab = {
			id: uid("filetab"),
			projectId: normalizeStoredId(projectId),
			projectPath: normalizeStoredPath(projectPath),
			path: filePath,
			title: baseName(filePath),
			draftDirectoryPath: null,
			draftAnchorPath: null,
		};
		workspace.fileTabs.push(tab);
	} else {
		setFileTabProject(tab, projectId, projectPath);
		tab.draftDirectoryPath = null;
		tab.draftAnchorPath = null;
	}
	workspace.activeFileTabId = tab.id;
	workspace.filePath = tab.path;
	setWorkspaceActiveProject(workspace, { id: tab.projectId, path: tab.projectPath });
	workspace.pane = "file";
	return tab;
}

function createAndActivateEmptyFileTab(
	workspace: WorkspaceState,
	title = NEW_FILE_TAB_TITLE,
	projectId: string | null = workspace.activeProjectId,
	projectPath: string | null = workspace.activeProjectPath,
	draftDirectoryPath: string | null = projectPath,
	draftAnchorPath: string | null = null,
): WorkspaceFileTab {
	ensureWorkspaceContentState(workspace);
	const normalizedDraftDirectoryPath = normalizeStoredPath(draftDirectoryPath) ?? normalizeStoredPath(projectPath);
	const normalizedDraftAnchorPath = normalizeStoredPath(draftAnchorPath);
	const activeDraft = workspace.fileTabs.find((entry) => entry.id === workspace.activeFileTabId && isDraftFileTab(entry));
	if (activeDraft) {
		activeDraft.title = title.trim() || NEW_FILE_TAB_TITLE;
		setFileTabProject(activeDraft, projectId, projectPath);
		activeDraft.draftDirectoryPath = normalizedDraftDirectoryPath;
		activeDraft.draftAnchorPath = normalizedDraftAnchorPath;
		workspace.activeFileTabId = activeDraft.id;
		workspace.filePath = null;
		setWorkspaceActiveProject(workspace, { id: activeDraft.projectId, path: activeDraft.projectPath });
		workspace.pane = "file";
		return activeDraft;
	}
	const tab: WorkspaceFileTab = {
		id: uid("filetab"),
		projectId: normalizeStoredId(projectId),
		projectPath: normalizeStoredPath(projectPath),
		path: null,
		title: title.trim() || NEW_FILE_TAB_TITLE,
		draftDirectoryPath: normalizedDraftDirectoryPath,
		draftAnchorPath: normalizedDraftAnchorPath,
	};
	workspace.fileTabs.push(tab);
	workspace.activeFileTabId = tab.id;
	workspace.filePath = null;
	setWorkspaceActiveProject(workspace, { id: tab.projectId, path: tab.projectPath });
	workspace.pane = "file";
	return tab;
}

function getActiveFileTab(workspace: WorkspaceState): WorkspaceFileTab | null {
	ensureWorkspaceContentState(workspace);
	return workspace.fileTabs.find((tab) => tab.id === workspace.activeFileTabId) ?? workspace.fileTabs[0] ?? null;
}

function resetWorkspaceContentTabs(
	workspace: WorkspaceState,
	project: { id?: string | null; path?: string | null } | null = { id: workspace.activeProjectId, path: workspace.activeProjectPath },
): void {
	const previousPane = workspace.pane;
	setWorkspaceActiveProject(workspace, project);
	workspace.sessionTabs = [createSessionTab(NEW_SESSION_TAB_TITLE, null, workspace.activeProjectId, workspace.activeProjectPath)];
	workspace.activeSessionTabId = workspace.sessionTabs[0].id;
	workspace.fileTabs = [];
	workspace.activeFileTabId = null;
	workspace.filePath = null;
	workspace.sessionTitle = NEW_SESSION_TAB_TITLE;
	workspace.pane = previousPane === "settings" || previousPane === "packages" ? previousPane : "chat";
}

function createAndActivateEmptySessionTab(
	workspace: WorkspaceState,
	title = NEW_SESSION_TAB_TITLE,
	projectId: string | null = workspace.activeProjectId,
	projectPath: string | null = workspace.activeProjectPath,
): WorkspaceSessionTab {
	ensureWorkspaceContentState(workspace);
	if (workspace.sessionTabs.length === 1 && isDraftSessionTab(workspace.sessionTabs[0])) {
		const seed = workspace.sessionTabs[0];
		seed.title = title.trim() || NEW_SESSION_TAB_TITLE;
		seed.messageCount = 0;
		seed.ephemeral = true;
		clearSessionAttention(seed);
		setSessionTabProject(seed, projectId, projectPath);
		workspace.activeSessionTabId = seed.id;
		workspace.sessionTitle = seed.title;
		setWorkspaceActiveProject(workspace, { id: seed.projectId, path: seed.projectPath });
		workspace.pane = "chat";
		return seed;
	}
	const tab = createSessionTab(title, null, projectId, projectPath);
	tab.messageCount = 0;
	tab.ephemeral = true;
	workspace.sessionTabs.push(tab);
	workspace.activeSessionTabId = tab.id;
	workspace.sessionTitle = tab.title;
	setWorkspaceActiveProject(workspace, { id: tab.projectId, path: tab.projectPath });
	workspace.pane = "chat";
	return tab;
}

function collectEphemeralSessionPaths(tabs: Array<WorkspaceSessionTab | null | undefined>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const tab of tabs) {
		if (!isEphemeralSessionTab(tab) || !tab?.sessionPath) continue;
		const normalized = normalizeSessionPath(tab.sessionPath);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(tab.sessionPath);
	}
	return result;
}

async function discardEphemeralSessionPaths(sessionPaths: string[]): Promise<void> {
	if (sessionPaths.length === 0) return;
	const { remove } = await import("@tauri-apps/plugin-fs");
	await Promise.all(
		sessionPaths.map(async (sessionPath) => {
			sidebar?.removeSessionPath(sessionPath);
			try {
				await remove(sessionPath);
			} catch (err) {
				console.warn("Failed to discard empty draft session:", sessionPath, err);
			}
		}),
	);
	scheduleSidebarSessionsRefresh(0);
}

function scheduleDiscardEphemeralSessionTabs(tabs: Array<WorkspaceSessionTab | null | undefined>): void {
	const sessionPaths = collectEphemeralSessionPaths(tabs);
	if (sessionPaths.length === 0) return;
	void discardEphemeralSessionPaths(sessionPaths);
}

function pruneInactiveEphemeralSessionTabs(workspace: WorkspaceState, keepTabIds: string[] = []): boolean {
	ensureWorkspaceContentState(workspace);
	const keep = new Set(keepTabIds);
	const removedTabs = workspace.sessionTabs.filter(
		(tab) => isEphemeralSessionTab(tab) && (tab.messageCount ?? 0) <= 0 && !keep.has(tab.id),
	);
	if (removedTabs.length === 0) return false;

	const removedIds = new Set(removedTabs.map((tab) => tab.id));
	workspace.sessionTabs = workspace.sessionTabs.filter((tab) => !removedIds.has(tab.id));

	if (removedIds.has(workspace.activeSessionTabId ?? "")) {
		const nextSession = workspace.sessionTabs[0] ?? null;
		workspace.activeSessionTabId = nextSession?.id ?? null;
		workspace.sessionTitle = nextSession?.title ?? NEW_SESSION_TAB_TITLE;
	}

	scheduleDiscardEphemeralSessionTabs(removedTabs);
	ensureWorkspaceContentState(workspace);
	return true;
}

function pruneEphemeralTabsWhenLeavingDraft(workspace: WorkspaceState, keepTabIds: string[] = []): boolean {
	if (!workspace.sessionTabs.some((tab) => !isEphemeralSessionTab(tab) || keepTabIds.includes(tab.id))) {
		return false;
	}
	return pruneInactiveEphemeralSessionTabs(workspace, keepTabIds);
}

function workspaceProjectsStorageKey(workspaceId: string): string {
	return `${WORKSPACE_PROJECTS_KEY_PREFIX}.${workspaceId}`;
}

function clampSidebarWidth(value: number): number {
	return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, value));
}

function loadSidebarWidth(): void {
	try {
		const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
		if (!raw) {
			sidebarWidth = 320;
			return;
		}
		const parsed = Number(raw);
		sidebarWidth = Number.isFinite(parsed) ? clampSidebarWidth(parsed) : 320;
	} catch {
		sidebarWidth = 320;
	}
}

function persistSidebarWidth(): void {
	try {
		localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarWidth)));
	} catch {
		// ignore
	}
}

function isSidebarCollapsedState(): boolean {
	if (sidebar) return sidebar.isCollapsed();
	try {
		return localStorage.getItem(SIDEBAR_COLLAPSED_STATE_KEY) === "1";
	} catch {
		return false;
	}
}

function applyWorkspaceTopbarOffset(): void {
	const root = document.documentElement;
	const collapsed = isSidebarCollapsedState();
	const offset = collapsed ? 0 : Math.round(sidebarWidth) + 6;
	root.style.setProperty("--workspace-topbar-offset", `${offset}px`);
}

function syncSidebarCollapseToggleButton(): void {
	const button = document.getElementById("sidebar-collapse-toggle");
	if (!button) return;
	const collapsed = isSidebarCollapsedState();
	button.classList.toggle("hidden", !collapsed);
	button.classList.toggle("collapsed", collapsed);
}

function applySidebarWidth(): void {
	const root = document.documentElement;
	root.style.setProperty("--sidebar-width", `${Math.round(sidebarWidth)}px`);
	applyWorkspaceTopbarOffset();
}

function assertProjectTaskCurrent(version: number): void {
	if (version !== projectSwitchVersion) {
		throw new StaleProjectTaskError();
	}
}

function queueProjectTask(
	task: (version: number) => Promise<void>,
	onError?: (err: unknown) => void,
	options: { invalidatePending?: boolean; label?: string } = {},
): Promise<void> {
	const invalidatePending = options.invalidatePending ?? true;
	const label = options.label ?? "project-task";
	const version = invalidatePending ? ++projectSwitchVersion : projectSwitchVersion;
	recordDebugTrace(`queue ${label} v=${version}${invalidatePending ? "" : " (keep-version)"}`);
	projectSwitchTask = projectSwitchTask
		.then(async () => {
			recordDebugTrace(`run ${label} v=${version}`);
			assertProjectTaskCurrent(version);
			await task(version);
			recordDebugTrace(`done ${label} v=${version}`);
		})
		.catch((err) => {
			if (err instanceof StaleProjectTaskError) {
				recordDebugTrace(`stale ${label} v=${version}`);
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			if (version !== projectSwitchVersion) {
				recordDebugTrace(`ignored-error ${label} v=${version}: ${message}`);
				return;
			}
			if (isCliMissingError(message)) {
				recordDebugTrace(`missing-cli ${label} v=${version}: ${message}`);
				connectionError = message;
				renderApp();
				return;
			}
			recordDebugTrace(`error ${label} v=${version}: ${message}`);
			onError?.(err);
		});
	return projectSwitchTask;
}

function isRpcTimeoutError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /timeout waiting for response/i.test(message) || /timed out/i.test(message);
}

async function withRpcRetry<T>(label: string, run: () => Promise<T>, attempts = 2, delayMs = 250): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			recordDebugTrace(`rpc ${label} attempt=${attempt}`);
			return await run();
		} catch (err) {
			lastError = err;
			recordDebugTrace(`rpc ${label} failed attempt=${attempt}: ${err instanceof Error ? err.message : String(err)}`);
			if (attempt >= attempts || !isRpcTimeoutError(err)) {
				throw err;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function renameSessionFromWorkspace(projectId: string, sessionPath: string, nextName: string): Promise<boolean> {
	const workspace = getActiveWorkspace();
	const project = sidebar?.getProjectById(projectId);
	const trimmedName = nextName.trim();
	if (!workspace || !project || !trimmedName) return false;

	ensureWorkspaceContentState(workspace);
	const targetTab = workspace.sessionTabs.find((tab) => normalizeSessionPath(tab.sessionPath) === normalizeSessionPath(sessionPath));
	if (targetTab) {
		setSessionTabProject(targetTab, project.id, project.path);
		targetTab.title = trimmedName;
		if (workspace.activeSessionTabId === targetTab.id) {
			workspace.sessionTitle = trimmedName;
		}
		persistWorkspaces();
		syncContentTabsBar(workspace);
	}

	let failed = false;
	await queueProjectTask(
		async () => {
			const normalizedTarget = normalizeSessionPath(sessionPath);
			const openTargetTab = workspace.sessionTabs.find((tab) => normalizeSessionPath(tab.sessionPath) === normalizedTarget) ?? null;
			const activeTarget = Boolean(openTargetTab && workspace.activeSessionTabId === openTargetTab.id);

			if (openTargetTab) {
				const targetRuntime = await ensureRuntimeForSessionTab(workspace, openTargetTab, project.path, activeTarget);
				await targetRuntime.bridge.setSessionName(trimmedName);
				if (activeTarget) {
					await chatView?.refreshFromBackend({ throwOnError: true });
				}
			} else {
				const maintenanceBridge = new RpcBridge(uid("rename_rpc"));
				try {
					await maintenanceBridge.start({ cliPath: findCliPath(), cwd: project.path });
					const switched = await maintenanceBridge.switchSession(sessionPath);
					if (switched.cancelled) return;
					await maintenanceBridge.setSessionName(trimmedName);
				} finally {
					await maintenanceBridge.stop().catch(() => {
						/* ignore */
					});
					await maintenanceBridge.teardownListeners().catch(() => {
						/* ignore */
					});
				}
			}

			scheduleSidebarSessionsRefresh(0);
			syncContentTabsBar(workspace);
			await applyWorkspacePane(workspace);
		},
		(err) => {
			failed = true;
			console.error("Failed to rename session:", err);
			chatView?.notify("Failed to rename session", "error");
		},
		{ label: "sidebar-session-rename" },
	);

	return !failed;
}

async function reloadActiveWorkspaceRuntime(): Promise<boolean> {
	const workspace = getActiveWorkspace();
	if (!workspace) return false;

	ensureWorkspaceContentState(workspace);
	const activeSession = getActiveSessionTab(workspace);
	if (!activeSession) return false;
	const projectPath = getSessionTabProjectPath(activeSession) ?? getWorkspaceActiveProjectPath(workspace);
	if (!projectPath) return false;

	syncActiveChatRuntimeBinding(workspace, { forceReset: true, statusText: "Reloading runtime…" });

	let failed = false;
	await queueProjectTask(
		async (version) => {
			assertProjectTaskCurrent(version);
			const runtime = getRuntimeForTab(workspace.id, activeSession.id);
			if (runtime?.bridge.isConnected) {
				runtime.phase = "starting";
				await runtime.bridge.stop().catch(() => {
					/* ignore */
				});
				runtime.draftInitialized = false;
				runtime.lastKnownSessionPath = null;
				setRuntimeRunning(runtime, false, { suppressNotify: true });
			}

			assertProjectTaskCurrent(version);
			await ensureRuntimeForSessionTab(workspace, activeSession, projectPath, true, version);
			assertProjectTaskCurrent(version);
			await chatView?.refreshFromBackend({ throwOnError: true });
			assertProjectTaskCurrent(version);
			await chatView?.refreshModels();
			await packagesView?.refreshPackages(true).catch(() => {
				/* ignore package refresh errors during reload */
			});
			scheduleSidebarSessionsRefresh(0);
			syncContentTabsBar(workspace);
			await applyWorkspacePane(workspace);
		},
		(err) => {
			failed = true;
			console.error("Failed to reload runtime:", err);
			chatView?.notify("Failed to reload runtime", "error");
		},
		{ label: "slash-reload-runtime" },
	);

	return !failed;
}

function scheduleSidebarSessionsRefresh(delayMs = 180): void {
	if (sidebarSessionsRefreshTimer) {
		clearTimeout(sidebarSessionsRefreshTimer);
	}
	sidebarSessionsRefreshTimer = setTimeout(() => {
		sidebarSessionsRefreshTimer = null;
		sidebar?.refreshActiveProjectSessions();
	}, delayMs);
}

function stopSidebarSessionsWarmRefresh(): void {
	if (sidebarSessionsWarmInterval) {
		clearInterval(sidebarSessionsWarmInterval);
		sidebarSessionsWarmInterval = null;
	}
	if (sidebarSessionsWarmStopTimer) {
		clearTimeout(sidebarSessionsWarmStopTimer);
		sidebarSessionsWarmStopTimer = null;
	}
}

function startSidebarSessionsWarmRefresh(durationMs = 90_000, intervalMs = 1_200): void {
	scheduleSidebarSessionsRefresh(0);
	if (!sidebarSessionsWarmInterval) {
		sidebarSessionsWarmInterval = setInterval(() => {
			sidebar?.refreshActiveProjectSessions();
		}, intervalMs);
	}
	if (sidebarSessionsWarmStopTimer) {
		clearTimeout(sidebarSessionsWarmStopTimer);
	}
	sidebarSessionsWarmStopTimer = setTimeout(() => {
		stopSidebarSessionsWarmRefresh();
	}, durationMs);
}

function setupSidebarResize(): void {
	removeSidebarResizeHandlers?.();
	removeSidebarResizeHandlers = null;

	const sidebarEl = document.getElementById("sidebar-container");
	const handle = document.getElementById("sidebar-resize-handle");
	if (!sidebarEl || !handle) return;

	const onPointerDown = (event: PointerEvent) => {
		if (sidebarEl.classList.contains("collapsed")) return;
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = sidebarWidth;

		handle.classList.add("dragging");
		document.body.classList.add("sidebar-resizing");

		const onMove = (moveEvent: PointerEvent) => {
			const delta = moveEvent.clientX - startX;
			sidebarWidth = clampSidebarWidth(startWidth + delta);
			applySidebarWidth();
		};

		const onUp = () => {
			handle.classList.remove("dragging");
			document.body.classList.remove("sidebar-resizing");
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			persistSidebarWidth();
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	handle.addEventListener("pointerdown", onPointerDown);
	removeSidebarResizeHandlers = () => {
		handle.removeEventListener("pointerdown", onPointerDown);
	};
}

function findCliPath(): string | null {
	if (import.meta.env.DEV) {
		// Optional local dev path (if running next to pi-mono)
		return null;
	}
	return null;
}

function getCwd(): string {
	try {
		const defaultWorkspaceRaw = localStorage.getItem(workspaceProjectsStorageKey(WORKSPACE_DEFAULT_ID));
		if (defaultWorkspaceRaw) {
			const projects = JSON.parse(defaultWorkspaceRaw) as Array<{ path?: string }>;
			if (projects[0]?.path) return projects[0].path;
		}

		const legacyRaw = localStorage.getItem(LEGACY_PROJECTS_STORAGE_KEY);
		if (legacyRaw) {
			const projects = JSON.parse(legacyRaw) as Array<{ path?: string }>;
			if (projects[0]?.path) return projects[0].path;
		}
	} catch {
		// ignore and fallback
	}
	return ".";
}

const WORKSPACE_DEFAULT_EMOJIS = ["💻", "🧠", "🚀", "📝", "📦", "🔧", "⚡️", "🌙", "🔥", "🧪", "📁", "💬", "🎯", "🎨", "🏔️", "🌊", "☕", "🛰️"] as const;

function nextWorkspaceIndex(): number {
	const used = new Set<number>();
	for (const workspace of workspaces) {
		const match = /^Workspace\s+(\d+)$/i.exec(workspace.title.trim());
		if (match) used.add(Number(match[1]));
	}
	let idx = 1;
	while (used.has(idx)) idx += 1;
	return idx;
}

function pickWorkspaceDefaultEmoji(seed: string): string {
	let hash = 0;
	for (const char of seed) {
		hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
	}
	return WORKSPACE_DEFAULT_EMOJIS[hash % WORKSPACE_DEFAULT_EMOJIS.length];
}

function ensureWorkspaceEmoji(workspace: WorkspaceState): boolean {
	const normalized = typeof workspace.emoji === "string" ? workspace.emoji.trim() : "";
	if (normalized.length > 0) {
		workspace.emoji = normalized;
		return false;
	}
	workspace.emoji = pickWorkspaceDefaultEmoji(`${workspace.id}:${workspace.title}`);
	return true;
}

function defaultWorkspace(): WorkspaceState {
	const seedSessionTab = createSessionTab(NEW_SESSION_TAB_TITLE, null);
	return {
		id: WORKSPACE_DEFAULT_ID,
		title: "Workspace 1",
		color: null,
		emoji: pickWorkspaceDefaultEmoji(WORKSPACE_DEFAULT_ID),
		pinned: false,
		leftMode: "projects",
		pane: "chat",
		activeProjectId: null,
		activeProjectPath: null,
		filePath: null,
		terminalOpen: false,
		sessionTitle: NEW_SESSION_TAB_TITLE,
		sessionTabs: [seedSessionTab],
		activeSessionTabId: seedSessionTab.id,
		fileTabs: [],
		activeFileTabId: null,
	};
}

function createWorkspace(title?: string, emoji?: string | null): WorkspaceState {
	const seedSessionTab = createSessionTab(NEW_SESSION_TAB_TITLE, null);
	const id = uid("workspace");
	const normalizedEmoji = typeof emoji === "string" && emoji.trim().length > 0 ? emoji.trim() : pickWorkspaceDefaultEmoji(id);
	return {
		id,
		title: title || `Workspace ${nextWorkspaceIndex()}`,
		color: null,
		emoji: normalizedEmoji,
		pinned: false,
		leftMode: "projects",
		pane: "chat",
		activeProjectId: null,
		activeProjectPath: null,
		filePath: null,
		terminalOpen: false,
		sessionTitle: NEW_SESSION_TAB_TITLE,
		sessionTabs: [seedSessionTab],
		activeSessionTabId: seedSessionTab.id,
		fileTabs: [],
		activeFileTabId: null,
	};
}

function normalizeWorkspaceOrder(): boolean {
	let changed = false;
	for (const workspace of workspaces) {
		if (workspace.pinned) {
			workspace.pinned = false;
			changed = true;
		}
	}
	return changed;
}

function applyWorkspaceTabOrder(orderedIds: string[]): boolean {
	if (orderedIds.length !== workspaces.length) return false;
	const order = new Map<string, number>();
	orderedIds.forEach((id, index) => order.set(id, index));
	if (order.size !== workspaces.length) return false;
	const before = workspaces.map((workspace) => workspace.id).join("|");
	workspaces.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
	normalizeWorkspaceOrder();
	return before !== workspaces.map((workspace) => workspace.id).join("|");
}

function setWorkspacePinned(_workspaceId: string, _pinned: boolean): boolean {
	return false;
}

function persistWorkspaces(): void {
	try {
		localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces));
		if (activeWorkspaceId) {
			localStorage.setItem(WORKSPACES_ACTIVE_STORAGE_KEY, activeWorkspaceId);
		} else {
			localStorage.removeItem(WORKSPACES_ACTIVE_STORAGE_KEY);
		}
	} catch {
		// ignore
	}
}

function loadWorkspaces(): void {
	try {
		const raw = localStorage.getItem(WORKSPACES_STORAGE_KEY);
		const active = localStorage.getItem(WORKSPACES_ACTIVE_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Array<Partial<WorkspaceState>>;
			workspaces = parsed
				.filter((w) => typeof w.id === "string" && w.id.length > 0)
				.map((w, idx) => {
					const fallbackSessionTitle =
						typeof w.sessionTitle === "string" && w.sessionTitle.trim().length > 0
							? w.sessionTitle.trim()
							: NEW_SESSION_TAB_TITLE;
					const rawSessionTabs = Array.isArray(w.sessionTabs) ? (w.sessionTabs as Array<Partial<WorkspaceSessionTab>>) : [];
					const rawFileTabs = Array.isArray(w.fileTabs) ? (w.fileTabs as Array<Partial<WorkspaceFileTab>>) : [];

					const sessionTabs = rawSessionTabs
						.filter((tab) => typeof tab.id === "string" && tab.id.length > 0)
						.map((tab) => {
							const sessionPath = normalizeStoredPath(tab.sessionPath);
							const storedMessageCount = tab.messageCount;
							const needsAttentionRaw = tab.needsAttention;
							const attentionMessageRaw = tab.attentionMessage;
							return {
								id: tab.id!,
								projectId: normalizeStoredId(tab.projectId),
								projectPath: normalizeStoredPath(tab.projectPath),
								sessionPath,
								title: typeof tab.title === "string" && tab.title.trim().length > 0 ? tab.title.trim() : fallbackSessionTitle,
								messageCount: typeof storedMessageCount === "number" && Number.isFinite(storedMessageCount) ? storedMessageCount : sessionPath ? null : 0,
								ephemeral: typeof tab.ephemeral === "boolean" ? Boolean(tab.ephemeral) : !sessionPath,
								needsAttention: typeof needsAttentionRaw === "boolean" ? needsAttentionRaw : false,
								attentionMessage:
									typeof attentionMessageRaw === "string" && attentionMessageRaw.trim().length > 0
										? attentionMessageRaw.trim()
										: null,
							};
						});

					if (sessionTabs.length === 0) {
						sessionTabs.push(
							createSessionTab(
								fallbackSessionTitle,
								null,
								normalizeStoredId(w.activeProjectId),
								normalizeStoredPath(w.activeProjectPath),
							),
						);
					}

					const fileTabs = rawFileTabs
						.filter((tab) => typeof tab.id === "string" && tab.id.length > 0)
						.map((tab) => {
							const path = normalizeStoredPath(tab.path);
							const projectPath = normalizeStoredPath(tab.projectPath);
							return {
								id: tab.id!,
								projectId: normalizeStoredId(tab.projectId),
								projectPath,
								path,
								title:
									typeof tab.title === "string" && tab.title.trim().length > 0
										? tab.title.trim()
										: path
											? baseName(path)
											: NEW_FILE_TAB_TITLE,
								draftDirectoryPath: path ? null : normalizeStoredPath(tab.draftDirectoryPath) ?? projectPath,
								draftAnchorPath: path ? null : normalizeStoredPath(tab.draftAnchorPath),
							};
						});

					if (fileTabs.length === 0 && typeof w.filePath === "string" && w.filePath.trim().length > 0) {
						fileTabs.push({
							id: uid("filetab"),
							projectId: normalizeStoredId(w.activeProjectId),
							projectPath: normalizeStoredPath(w.activeProjectPath),
							path: w.filePath,
							title: baseName(w.filePath),
							draftDirectoryPath: null,
							draftAnchorPath: null,
						});
					}

					const workspace: WorkspaceState = {
						id: w.id!,
						title: typeof w.title === "string" && w.title.trim().length > 0 ? w.title : `Workspace ${idx + 1}`,
						color: typeof w.color === "string" && w.color.trim().length > 0 ? w.color : null,
						emoji: typeof w.emoji === "string" && w.emoji.trim().length > 0 ? w.emoji.trim() : null,
						pinned: false,
						leftMode: w.leftMode === "files" ? "files" : "projects",
						pane: w.pane === "file" || w.pane === "packages" || w.pane === "settings" || w.pane === "terminal" ? w.pane : "chat",
						activeProjectId: normalizeStoredId(w.activeProjectId),
						activeProjectPath: normalizeStoredPath(w.activeProjectPath),
						filePath: typeof w.filePath === "string" ? w.filePath : null,
						terminalOpen: Boolean(w.terminalOpen),
						sessionTitle: fallbackSessionTitle,
						sessionTabs,
						activeSessionTabId:
							typeof w.activeSessionTabId === "string" && sessionTabs.some((tab) => tab.id === w.activeSessionTabId)
								? w.activeSessionTabId
								: sessionTabs[0]?.id ?? null,
						fileTabs,
						activeFileTabId:
							typeof w.activeFileTabId === "string" && fileTabs.some((tab) => tab.id === w.activeFileTabId)
								? w.activeFileTabId
								: fileTabs[0]?.id ?? null,
					};

					ensureWorkspaceContentState(workspace);
					return workspace;
				});
			activeWorkspaceId = active && workspaces.some((w) => w.id === active) ? active : workspaces[0]?.id ?? null;
		}
	} catch {
		workspaces = [];
		activeWorkspaceId = null;
	}

	if (workspaces.length === 0) {
		workspaces = [defaultWorkspace()];
		activeWorkspaceId = workspaces[0].id;
		persistWorkspaces();
	}

	let mutatedWorkspaceMetadata = false;
	for (const workspace of workspaces) {
		ensureWorkspaceContentState(workspace);
		mutatedWorkspaceMetadata = ensureWorkspaceEmoji(workspace) || mutatedWorkspaceMetadata;
	}

	const normalizedWorkspaceOrder = normalizeWorkspaceOrder();
	if (normalizedWorkspaceOrder || mutatedWorkspaceMetadata) {
		persistWorkspaces();
	}

	if (!activeWorkspaceId || !workspaces.some((w) => w.id === activeWorkspaceId)) {
		activeWorkspaceId = workspaces[0].id;
		persistWorkspaces();
	}
}

function getActiveWorkspace(): WorkspaceState | null {
	if (!activeWorkspaceId) return null;
	return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
}

function syncWorkspaceTabsBar(): void {
	const workspaceItems: SidebarWorkspaceItem[] = workspaces.map((workspace) => ({
		id: workspace.id,
		title: workspace.title,
		color: workspace.color,
		emoji: workspace.emoji,
		pinned: false,
		closable: true,
	}));
	workspaceTabsBar?.setTabs(workspaceItems, activeWorkspaceId);
	sidebar?.setWorkspaces(workspaceItems, activeWorkspaceId);
}

function syncSidebarSettingsNavigation(): void {
	if (!sidebar) return;
	if (!settingsPanel) {
		sidebar.setSettingsNavigation([], null);
		return;
	}
	const navigation = settingsPanel.getNavigationState();
	sidebar.setSettingsNavigation(
		navigation.items.map((item) => ({
			id: item.id,
			label: item.label,
			description: item.description,
			disabled: item.disabled,
		})),
		navigation.activeSection,
	);
}

function syncWorkspaceContextChrome(workspace: WorkspaceState | null = getActiveWorkspace()): void {
	const packagesOpen = workspace?.pane === "packages";
	const settingsOpen = workspace?.pane === "settings";
	workspaceTabsBar?.setPackagesToolbarVisible(packagesOpen);
	sidebar?.setPackagesOpen(packagesOpen);
	sidebar?.setSettingsShellActive(Boolean(settingsOpen));
	if (settingsOpen) syncSidebarSettingsNavigation();
}

function syncCliUpdateUiHint(): void {
	sidebar?.setCliUpdateStatus(Boolean(cliUpdateStatus?.update_available), cliUpdateStatus?.latest_version ?? null);
}

function syncDesktopUpdateUiHint(): void {
	sidebar?.setDesktopUpdateStatus(Boolean(desktopUpdateStatus?.updateAvailable), desktopUpdateStatus?.latestVersion ?? null);
}

function syncDebugOverlay(): void {
	const el = document.getElementById("runtime-debug-overlay");
	if (!el) return;

	const workspace = getActiveWorkspace();
	const runtime = getActiveRuntime();
	const sessionTab = workspace ? getActiveSessionTab(workspace) : null;
	const fileTab = workspace ? getActiveFileTab(workspace) : null;
	const sidebarProject = sidebar?.getActiveProject() ?? null;
	const chatDebug = chatView?.getDebugInfo() ?? null;

	const traceLines = debugTraceLines.slice(-12);
	const lines = [
		`workspace=${workspace?.id ?? "-"}`,
		`workspaceProjectId=${workspace?.activeProjectId ?? "-"}`,
		`workspaceProjectPath=${workspace?.activeProjectPath ?? "-"}`,
		`sidebarProjectId=${sidebarProject?.id ?? "-"}`,
		`sidebarProjectPath=${sidebarProject?.path ?? "-"}`,
		`activeSessionTab=${sessionTab?.id ?? "-"}`,
		`sessionTabProjectPath=${sessionTab?.projectPath ?? "-"}`,
		`sessionTabSessionPath=${sessionTab?.sessionPath ?? "-"}`,
		`activeFileTab=${fileTab?.id ?? "-"}`,
		`fileTabProjectPath=${fileTab?.projectPath ?? "-"}`,
		`fileTabPath=${fileTab?.path ?? "-"}`,
		`runtimeKey=${runtime?.key ?? "-"}`,
		`runtimeInstance=${runtime?.instanceId ?? rpcBridge.getInstanceId()}`,
		`runtimeProjectPath=${runtime?.projectPath ?? "-"}`,
		`runtimePhase=${runtime?.phase ?? "-"}`,
		`runtimeLastError=${runtime?.lastError ?? "-"}`,
		`runtimeLastKnownSessionPath=${runtime?.lastKnownSessionPath ?? "-"}`,
		`runtimeRunning=${runtime?.running ? "yes" : "no"}`,
		`bridgeConnected=${rpcBridge.isConnected ? "yes" : "no"}`,
		`bridgeDiscovery=${rpcBridge.discoveryInfo ?? "-"}`,
		`chatProjectPath=${chatDebug?.projectPath ?? "-"}`,
		`chatConnected=${chatDebug?.isConnected ? "yes" : "no"}`,
		`chatMessages=${chatDebug?.messageCount ?? 0}`,
		`chatBackendSessionFile=${chatDebug?.backendSessionFile ?? "-"}`,
		`chatRefreshError=${chatDebug?.lastBackendRefreshError ?? "-"}`,
		`modelsLoading=${chatDebug?.loadingModels ? "yes" : "no"}`,
		`modelCount=${chatDebug?.availableModelCount ?? 0}`,
		`modelLoadError=${chatDebug?.lastModelLoadError ?? "-"}`,
		"",
		"trace:",
		...traceLines,
	];

	el.textContent = lines.join("\n");
}

function ensureDebugOverlayPolling(): void {
	if (debugOverlayInterval) return;
	debugOverlayInterval = setInterval(() => {
		syncDebugOverlay();
	}, 250);
}

function syncSidebarSelectionFromWorkspace(workspace: WorkspaceState | null = getActiveWorkspace()): void {
	if (!sidebar) {
		chatView?.setWelcomeProjects([], workspace?.activeProjectId ?? null);
		return;
	}
	if (!workspace) {
		sidebar.clearActiveProject();
		sidebar.setActiveSessionPath(null);
		sidebar.setActiveFilePath(null);
		sidebar.setSuppressedSessionPaths([]);
		sidebar.setAttentionSessions([]);
		sidebar.setTransientSessionDraft(null);
		chatView?.setWelcomeProjects(sidebar.listProjects(), null);
		return;
	}

	ensureWorkspaceContentState(workspace);
	if (!workspace.activeProjectId && workspace.activeProjectPath) {
		const project = sidebar.getProjectByPath(workspace.activeProjectPath);
		if (project) {
			setWorkspaceActiveProject(workspace, project);
		}
	}
	if (workspace.activeProjectId) {
		sidebar.setActiveProject(workspace.activeProjectId, false);
	} else {
		sidebar.clearActiveProject();
	}
	chatView?.setWelcomeProjects(sidebar.listProjects(), getWorkspaceActiveProjectId(workspace));

	const suppressedDraftSessionPaths = workspace.sessionTabs
		.filter((tab) => isEphemeralSessionTab(tab) && Boolean(tab.sessionPath))
		.map((tab) => tab.sessionPath as string);
	sidebar.setSuppressedSessionPaths(suppressedDraftSessionPaths);
	const attentionEntries = workspace.sessionTabs
		.filter((tab) => Boolean(tab.needsAttention) && Boolean(tab.sessionPath))
		.map((tab) => ({ path: tab.sessionPath as string, message: tab.attentionMessage }));
	sidebar.setAttentionSessions(attentionEntries);

	if (workspace.pane === "file") {
		sidebar.setActiveSessionPath(null);
		sidebar.setActiveFilePath(getActiveFileTab(workspace)?.path ?? null);
		sidebar.setTransientSessionDraft(null);
		return;
	}

	sidebar.setActiveFilePath(null);
	const activeSession = getActiveSessionTab(workspace) ?? null;
	sidebar.setActiveSessionPath(activeSession?.sessionPath ?? null);
	if (activeSession && isEphemeralSessionTab(activeSession)) {
		const projectId = getSessionTabProjectId(activeSession) ?? getWorkspaceActiveProjectId(workspace);
		if (projectId) {
			sidebar.setTransientSessionDraft({
				projectId,
				path: activeSession.sessionPath,
				name: activeSession.title || NEW_SESSION_TAB_TITLE,
			});
			return;
		}
	}
	sidebar.setTransientSessionDraft(null);
}

function syncActiveChatRuntimeBinding(
	workspace: WorkspaceState | null = getActiveWorkspace(),
	options: { forceReset?: boolean; statusText?: string } = {},
): void {
	if (!workspace || !chatView) {
		if (!workspace) {
			setActiveRuntime(null);
			chatView?.prepareForSessionSwitch(null);
		}
		return;
	}
	ensureWorkspaceContentState(workspace);
	const activeSessionTab = getActiveSessionTab(workspace);
	const projectPath = getSessionTabProjectPath(activeSessionTab) ?? getWorkspaceActiveProjectPath(workspace);
	const expectedRuntime = getRuntimeForTab(workspace.id, activeSessionTab.id);
	const expectedRuntimeKey = expectedRuntime?.key ?? null;
	const runtimeChanged = expectedRuntimeKey !== activeSessionRuntimeKey;
	if (runtimeChanged) {
		recordDebugTrace(`syncActiveChatRuntimeBinding runtime=${expectedRuntimeKey ?? "-"} tab=${activeSessionTab.id}`);
		setActiveRuntime(expectedRuntime);
	}
	if (options.forceReset || runtimeChanged || !expectedRuntime) {
		chatView.prepareForSessionSwitch(
			projectPath,
			options.statusText ?? (activeSessionTab.sessionPath ? "Loading session…" : "Starting new session…"),
		);
	}
}

function syncContentTabsBar(workspace: WorkspaceState | null = getActiveWorkspace()): void {
	if (workspace) {
		ensureWorkspaceContentState(workspace);
	}
	const hasProject = Boolean(workspace && getWorkspaceActiveProjectPath(workspace));
	const tabsContainer = document.getElementById("content-tabs-container");
	if (tabsContainer) {
		tabsContainer.classList.toggle("hidden", workspace?.pane === "packages" || workspace?.pane === "settings" || !hasProject);
	}

	if (!contentTabsBar || !workspace || workspace.pane === "packages" || workspace.pane === "settings" || !hasProject) {
		contentTabsBar?.setTerminalActive(false);
		contentTabsBar?.setTabs([], null);
		return;
	}

	ensureWorkspaceContentState(workspace);

	const visibleSessionTabs = workspace.sessionTabs.filter((tab) => !isEphemeralSessionTab(tab) || tab.id === workspace.activeSessionTabId);
	const tabs = [
		...visibleSessionTabs.map((tab) => ({
			id: tab.id,
			type: "session" as const,
			title: tab.title || NEW_SESSION_TAB_TITLE,
			needsAttention: Boolean(tab.needsAttention),
			attentionLabel: tab.attentionMessage ?? undefined,
			closable: visibleSessionTabs.length > 1 || Boolean(tab.sessionPath),
		})),
		...workspace.fileTabs.map((tab) => ({
			id: tab.id,
			type: "file" as const,
			title: tab.title || (tab.path ? baseName(tab.path) : NEW_FILE_TAB_TITLE),
			path: tab.path ?? undefined,
			closable: true,
		})),
		...(workspace.terminalOpen
			? [
				{
					id: "terminal",
					type: "terminal" as const,
					title: "Terminal",
					closable: true,
				},
			]
			: []),
	];

	const activeTabId =
		workspace.pane === "file" && workspace.activeFileTabId
			? workspace.activeFileTabId
			: workspace.pane === "terminal" && workspace.terminalOpen
				? "terminal"
				: workspace.activeSessionTabId;

	contentTabsBar.setTerminalActive(workspace.pane === "terminal");
	contentTabsBar.setTabs(tabs, activeTabId);
}

function setPaneVisibility(pane: WorkspaceState["pane"]): void {
	const sessionPane = document.getElementById("session-pane");
	const filePane = document.getElementById("file-pane");
	const terminalPane = document.getElementById("terminal-pane");
	const packagesPane = document.getElementById("packages-pane");
	const settingsPane = document.getElementById("settings-pane");
	if (!sessionPane || !filePane || !terminalPane || !packagesPane || !settingsPane) return;

	sessionPane.classList.toggle("hidden-pane", pane !== "chat");
	filePane.classList.toggle("hidden-pane", pane !== "file");
	terminalPane.classList.toggle("hidden-pane", pane !== "terminal");
	packagesPane.classList.toggle("hidden-pane", pane !== "packages");
	settingsPane.classList.toggle("hidden-pane", pane !== "settings");
}

function resolveSettingsRuntimeProjectPath(workspace: WorkspaceState | null): string | null {
	if (!workspace) return null;
	return getWorkspaceActiveProjectPath(workspace);
}

async function applyWorkspacePane(workspace: WorkspaceState | null = getActiveWorkspace()): Promise<void> {
	const applyVersion = ++workspacePaneApplyVersion;
	const isStale = (): boolean => applyVersion !== workspacePaneApplyVersion;

	syncWorkspaceContextChrome(workspace);
	syncSidebarSelectionFromWorkspace(workspace);
	syncContentTabsBar(workspace);
	if (isStale()) return;

	if (!workspace) {
		const resolved = getResolvedDesktopTheme();
		const profiles = loadDesktopAppearanceProfiles();
		void syncDesktopThemeWithPiTheme(null).finally(() => {
			applyDesktopAppearanceProfileToRoot(resolved, profiles);
		});
		if (isStale()) return;
		settingsPanel?.hideWithoutClearing();
		syncRunningSessionIndicators();
		setPaneVisibility("chat");
		return;
	}

	ensureWorkspaceContentState(workspace);
	const workspaceProjectPath = getWorkspaceActiveProjectPath(workspace);
	const resolved = getResolvedDesktopTheme();
	const profiles = loadDesktopAppearanceProfiles();
	void syncDesktopThemeWithPiTheme(workspaceProjectPath).finally(() => {
		applyDesktopAppearanceProfileToRoot(resolved, profiles);
	});
	if (isStale()) return;

	chatView?.setProjectPath(workspaceProjectPath);
	packagesView?.setProjectPath(workspaceProjectPath);
	terminalPanel?.setProjectPath(workspaceProjectPath);
	if (workspace.pane !== "settings") {
		settingsPanel?.hideWithoutClearing();
	}
	if (workspace.pane !== "file") {
		fileViewer?.setProjectPath(workspaceProjectPath);
	}
	if (isStale()) return;

	if (workspace.pane === "file") {
		const activeFileTab = getActiveFileTab(workspace);
		const draftBasePath = activeFileTab && isDraftFileTab(activeFileTab) ? normalizeStoredPath(activeFileTab.draftDirectoryPath) : null;
		fileViewer?.setProjectPath(draftBasePath ?? getFileTabProjectPath(activeFileTab) ?? getWorkspaceActiveProjectPath(workspace));
		setPaneVisibility("file");
		if (activeFileTab?.path) {
			await fileViewer?.openFile(activeFileTab.path);
			if (isStale()) return;
		} else {
			const draftId = activeFileTab?.id ?? "draft";
			const draftTitle = activeFileTab?.title || NEW_FILE_TAB_TITLE;
			fileViewer?.openDraft(draftId, draftTitle);
		}
		return;
	}

	if (workspace.pane === "terminal" && workspace.terminalOpen) {
		terminalPanel?.setProjectPath(getWorkspaceActiveProjectPath(workspace));
		if (isStale()) return;
		setPaneVisibility("terminal");
		terminalPanel?.focusInput();
		return;
	}

	if (workspace.pane === "packages") {
		settingsPanel?.hideWithoutClearing();
		packagesView?.setProjectPath(getWorkspaceActiveProjectPath(workspace));
		if (isStale()) return;
		setPaneVisibility("packages");
		await packagesView?.open();
		if (isStale()) return;
		workspaceTabsBar?.setPackagesSearchQuery(packagesView?.getQuery() ?? "");
		syncDebugOverlay();
		return;
	}

	if (workspace.pane === "settings") {
		if (isStale()) return;
		setPaneVisibility("settings");
		try {
			const panel = mountSettingsPanel();
			panel.setRuntimeProjectPath(resolveSettingsRuntimeProjectPath(workspace));
			await panel.open();
			if (isStale()) return;
		} catch (err) {
			console.error("Failed to render settings pane:", err);
			settingsPanel = null;
			const panel = mountSettingsPanel();
			panel.setRuntimeProjectPath(resolveSettingsRuntimeProjectPath(workspace));
			await panel.open();
			if (isStale()) return;
		}
		scheduleSettingsPaneRecovery("apply-settings");
		syncDebugOverlay();
		return;
	}

	if (isStale()) return;
	settingsPanel?.hideWithoutClearing();
	syncActiveChatRuntimeBinding(workspace);
	setPaneVisibility("chat");
	chatView?.focusInput();
	syncDebugOverlay();
}

async function ensureRuntimeForSessionTab(
	workspace: WorkspaceState,
	sessionTab: WorkspaceSessionTab,
	projectPath: string,
	makeActive = true,
	taskVersion?: number,
): Promise<SessionRuntime> {
	if (typeof taskVersion === "number") {
		assertProjectTaskCurrent(taskVersion);
	}
	setSessionTabProject(sessionTab, sessionTab.projectId ?? workspace.activeProjectId, projectPath);
	if (makeActive) {
		setWorkspaceActiveProject(workspace, { id: sessionTab.projectId, path: projectPath });
		chatView?.setProjectPath(projectPath);
		packagesView?.setProjectPath(projectPath);
		terminalPanel?.setProjectPath(projectPath);
		fileViewer?.setProjectPath(projectPath);
	}

	const runtime = getOrCreateRuntimeForTab(workspace.id, sessionTab.id, projectPath);
	const bridge = runtime.bridge;

	const projectChanged = normalizeProjectPath(runtime.projectPath) !== normalizeProjectPath(projectPath);
	runtime.projectPath = projectPath;
	runtime.lastError = null;
	recordDebugTrace(
		`ensureRuntime:start workspace=${workspace.id} tab=${sessionTab.id} project=${projectPath} session=${sessionTab.sessionPath ?? "draft"}`,
	);

	try {
		if (projectChanged && bridge.isConnected) {
			runtime.phase = "starting";
			await bridge.stop().catch(() => {
				/* ignore */
			});
			if (typeof taskVersion === "number") {
				assertProjectTaskCurrent(taskVersion);
			}
			runtime.draftInitialized = false;
			runtime.lastKnownSessionPath = null;
			setRuntimeRunning(runtime, false, { suppressNotify: true });
		}

		if (!bridge.isConnected) {
			runtime.phase = "starting";
			recordDebugTrace(`ensureRuntime:start-bridge instance=${runtime.instanceId}`);
			await bridge.start({ cliPath: findCliPath(), cwd: projectPath });
			recordDebugTrace(`ensureRuntime:bridge-started instance=${runtime.instanceId} discovery=${bridge.discoveryInfo ?? "-"}`);
			if (typeof taskVersion === "number") {
				assertProjectTaskCurrent(taskVersion);
			}
			runtime.draftInitialized = true;
		}

		if (sessionTab.sessionPath) {
			const targetSessionPath = sessionTab.sessionPath;
			if (normalizeSessionPath(targetSessionPath) !== normalizeSessionPath(runtime.lastKnownSessionPath)) {
				runtime.phase = "switching_session";
				const switched = await withRpcRetry(
					`switch_session ${runtime.instanceId}`,
					() => bridge.switchSession(targetSessionPath),
				);
				if (typeof taskVersion === "number") {
					assertProjectTaskCurrent(taskVersion);
				}
				if (!switched.cancelled) {
					runtime.lastKnownSessionPath = targetSessionPath;
					runtime.draftInitialized = true;
				}
			}
		} else {
			runtime.draftInitialized = true;
		}

		const state = await withRpcRetry(`get_state ${runtime.instanceId}`, () => bridge.getState());
		if (typeof taskVersion === "number") {
			assertProjectTaskCurrent(taskVersion);
		}
		if (state.sessionFile) {
			runtime.lastKnownSessionPath = state.sessionFile;
		}
		if (sessionTab.sessionPath && normalizeSessionPath(state.sessionFile) !== normalizeSessionPath(sessionTab.sessionPath)) {
			throw new Error(
				`Activated wrong session for ${runtime.instanceId}: expected ${sessionTab.sessionPath}, got ${state.sessionFile ?? "-"}`,
			);
		}

		setRuntimeRunning(runtime, Boolean(state.isStreaming));
		runtime.phase = "ready";
		recordDebugTrace(`ensureRuntime:ready instance=${runtime.instanceId} session=${runtime.lastKnownSessionPath ?? "-"}`);
		if (
			makeActive &&
			workspace.activeSessionTabId === sessionTab.id &&
			normalizeProjectPath(getSessionTabProjectPath(sessionTab) ?? getWorkspaceActiveProjectPath(workspace)) === normalizeProjectPath(projectPath)
		) {
			setActiveRuntime(runtime);
			await refreshCliUpdateStatus();
		}
		return runtime;
	} catch (err) {
		runtime.phase = "failed";
		runtime.lastError = err instanceof Error ? err.message : String(err);
		recordDebugTrace(`ensureRuntime:failed instance=${runtime.instanceId}: ${runtime.lastError}`);
		if (activeSessionRuntimeKey === runtime.key) {
			setActiveRuntime(null);
		}
		syncRunningSessionIndicators();
		ensureRunningSessionPoller();
		throw err;
	} finally {
		syncDebugOverlay();
	}
}

async function ensureRpcForProject(projectPath: string, taskVersion?: number): Promise<SessionRuntime | null> {
	if (typeof taskVersion === "number") {
		assertProjectTaskCurrent(taskVersion);
	}
	const workspace = getActiveWorkspace();
	if (!workspace) return null;
	ensureWorkspaceContentState(workspace);
	const activeSessionTab = getActiveSessionTab(workspace);
	setSessionTabProject(activeSessionTab, activeSessionTab.projectId ?? workspace.activeProjectId, projectPath);
	setWorkspaceActiveProject(workspace, { id: activeSessionTab.projectId, path: projectPath });
	return ensureRuntimeForSessionTab(workspace, activeSessionTab, projectPath, true, taskVersion);
}

async function activateWorkspace(workspaceId: string, taskVersion?: number): Promise<void> {
	const workspace = workspaces.find((w) => w.id === workspaceId);
	if (!workspace || !sidebar) return;
	if (typeof taskVersion === "number") {
		assertProjectTaskCurrent(taskVersion);
	}

	recordDebugTrace(`activateWorkspace:start id=${workspaceId}`);
	activeWorkspaceId = workspace.id;
	ensureWorkspaceContentState(workspace);
	persistWorkspaces();
	syncWorkspaceTabsBar();

	await sidebar.setWorkspace(workspace.id);
	if (typeof taskVersion === "number") {
		assertProjectTaskCurrent(taskVersion);
	}
	sidebar.setMode(workspace.leftMode);
	if (workspace.activeProjectId && !workspace.activeProjectPath) {
		const persistedProject = sidebar.getProjectById(workspace.activeProjectId);
		if (persistedProject?.path) {
			setWorkspaceActiveProject(workspace, persistedProject);
		}
	}
	syncSidebarSelectionFromWorkspace(workspace);
	await applyWorkspacePane(workspace);
	if (typeof taskVersion === "number") {
		assertProjectTaskCurrent(taskVersion);
	}

	const activeProjectPath = getWorkspaceActiveProjectPath(workspace);
	recordDebugTrace(`activateWorkspace:project id=${workspaceId} path=${activeProjectPath ?? "-"}`);
	if (activeProjectPath) {
		await ensureRpcForProject(activeProjectPath, taskVersion);
		if (typeof taskVersion === "number") {
			assertProjectTaskCurrent(taskVersion);
		}
		await chatView?.refreshFromBackend({ throwOnError: true });
		if (typeof taskVersion === "number") {
			assertProjectTaskCurrent(taskVersion);
		}
		await chatView?.refreshModels();
	} else {
		setActiveRuntime(null);
		chatView?.setProjectPath(null);
		packagesView?.setProjectPath(null);
		terminalPanel?.setProjectPath(null);
		fileViewer?.setProjectPath(null);
		syncSidebarSelectionFromWorkspace(workspace);
		syncRunningSessionIndicators();
	}

	if (typeof taskVersion === "number") {
		assertProjectTaskCurrent(taskVersion);
	}
	await applyWorkspacePane(workspace);
	clearVisibleActiveSessionAttention();
	recordDebugTrace(`activateWorkspace:done id=${workspaceId}`);
}

async function focusNotificationTarget(target: NotificationActionTarget, taskVersion?: number): Promise<void> {
	if (typeof taskVersion === "number") {
		assertProjectTaskCurrent(taskVersion);
	}
	const targetWorkspace = target.workspaceId
		? workspaces.find((workspace) => workspace.id === target.workspaceId) ?? null
		: getActiveWorkspace();
	if (!targetWorkspace) {
		recordDebugTrace("notify-action:workspace-missing");
		return;
	}

	if (activeWorkspaceId !== targetWorkspace.id) {
		await activateWorkspace(targetWorkspace.id, taskVersion);
		if (typeof taskVersion === "number") {
			assertProjectTaskCurrent(taskVersion);
		}
	}

	const workspace = workspaces.find((entry) => entry.id === targetWorkspace.id) ?? targetWorkspace;
	ensureWorkspaceContentState(workspace);

	let focusedTab = target.tabId ? setActiveSessionTab(workspace, target.tabId) : null;
	if (!focusedTab && target.sessionPath) {
		const normalizedSessionPath = normalizeSessionPath(target.sessionPath);
		const existingTab = workspace.sessionTabs.find((tab) => normalizeSessionPath(tab.sessionPath) === normalizedSessionPath) ?? null;
		if (existingTab) {
			focusedTab = setActiveSessionTab(workspace, existingTab.id);
		}
	}

	if (!focusedTab && target.sessionPath) {
		focusedTab = openOrActivateSessionTab(
			workspace,
			target.sessionPath,
			workspace.activeProjectId,
			workspace.activeProjectPath,
		);
	}

	recordDebugTrace(
		`notify-action:focus workspace=${workspace.id} tab=${focusedTab?.id ?? "-"} session=${focusedTab?.sessionPath ?? target.sessionPath ?? "-"}`,
	);

	persistWorkspaces();
	syncWorkspaceTabsBar();
	syncContentTabsBar(workspace);
	syncSidebarSelectionFromWorkspace(workspace);
	syncActiveChatRuntimeBinding(workspace, { forceReset: false });
	await applyWorkspacePane(workspace);
}

function closeWorkspace(workspaceId: string): void {
	if (workspaces.length <= 1) return;
	const index = workspaces.findIndex((workspace) => workspace.id === workspaceId);
	if (index === -1) return;

	const removedWorkspace = workspaces[index];
	const wasActive = activeWorkspaceId === workspaceId;
	scheduleDiscardEphemeralSessionTabs(removedWorkspace?.sessionTabs ?? []);
	removeRuntimesForWorkspace(workspaceId);
	workspaces.splice(index, 1);

	if (wasActive) {
		const next = workspaces[index] ?? workspaces[index - 1] ?? workspaces[0];
		activeWorkspaceId = next?.id ?? null;
	}

	persistWorkspaces();
	syncWorkspaceTabsBar();

	if (wasActive && activeWorkspaceId) {
		void queueProjectTask(
			async (version) => {
				await activateWorkspace(activeWorkspaceId!, version);
			},
			(err) => {
				console.error("Failed to activate workspace:", err);
			},
			{ label: "close-workspace-activate" },
		);
	}
}

function applyInitialTheme(): void {
	initializeDesktopTheme();
	const resolved = getResolvedDesktopTheme();
	const profiles = loadDesktopAppearanceProfiles();
	void syncDesktopThemeWithPiTheme(null).finally(() => {
		applyDesktopAppearanceProfileToRoot(resolved, profiles);
	});
}

async function applyNativeWindowVisualFixes(): Promise<void> {
	try {
		const { getCurrentWindow } = await import("@tauri-apps/api/window");
		const win = getCurrentWindow();
		await win.setBackgroundColor({ red: 0, green: 0, blue: 0, alpha: 0 });
	} catch {
		// Ignore in web / non-tauri runtimes
	}
}

async function runStartupCompatibilityCheck(): Promise<void> {
	if (!rpcBridge.isConnected) return;
	try {
		const report = await rpcBridge.checkRpcCompatibility();
		if (!report.ok) {
			chatView?.notify(
				`RPC compatibility check failed${report.error ? `: ${report.error}` : ""}. Open Settings → CLI updates for details.`,
				"error",
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
	// top titlebar removed; keep runtime polling state only
}

async function refreshCliUpdateStatus(): Promise<void> {
	if (cliUpdateChecking) return;
	cliUpdateChecking = true;
	try {
		cliUpdateStatus = await rpcBridge.getCliUpdateStatus();
		if (cliUpdateStatus?.update_available && shouldNotifyCliUpdate()) {
			chatView?.notify(
				`A Pi CLI update is available${cliUpdateStatus.latest_version ? ` (v${cliUpdateStatus.latest_version})` : ""}. Open Settings → CLI updates to install it.`,
				"info",
			);
			markCliUpdateNotified();
		}
	} catch (err) {
		console.warn("Failed to refresh CLI update status:", err);
		cliUpdateStatus = null;
	} finally {
		cliUpdateChecking = false;
		syncCliUpdateUiHint();
		applyCliStatusToTitlebar();
	}
}

async function refreshDesktopUpdateStatus(): Promise<void> {
	if (desktopUpdateChecking) return;
	desktopUpdateChecking = true;
	try {
		desktopUpdateStatus = await fetchDesktopUpdateStatus();
		if (desktopUpdateStatus.updateAvailable && shouldNotifyDesktopUpdate()) {
			chatView?.notify(
				`A Pi Desktop update is available${desktopUpdateStatus.latestVersion ? ` (v${desktopUpdateStatus.latestVersion})` : ""}. Open Settings → Desktop updates to install it.`,
				"info",
			);
			markDesktopUpdateNotified();
		}
	} catch (err) {
		console.warn("Failed to refresh desktop update status:", err);
		desktopUpdateStatus = null;
	} finally {
		desktopUpdateChecking = false;
		syncDesktopUpdateUiHint();
	}
}

function startCliUpdatePolling(): void {
	if (cliUpdatePollingTimer) {
		clearInterval(cliUpdatePollingTimer);
	}
	cliUpdatePollingTimer = setInterval(() => {
		void refreshCliUpdateStatus();
	}, UPDATE_NOTICE_INTERVAL_MS);
}

function startDesktopUpdatePolling(): void {
	if (desktopUpdatePollingTimer) {
		clearInterval(desktopUpdatePollingTimer);
	}
	desktopUpdatePollingTimer = setInterval(() => {
		void refreshDesktopUpdateStatus();
	}, UPDATE_NOTICE_INTERVAL_MS);
}

async function initialize(): Promise<void> {
	chatView?.disconnect();
	chatView = null;
	if (debugOverlayInterval) {
		clearInterval(debugOverlayInterval);
		debugOverlayInterval = null;
	}

	const app = document.getElementById("app");
	if (!app) throw new Error("App container not found");

	render(
		html`
			<div class="app-shell loading">
				<div class="loading-view">Starting pi agent…</div>
			</div>
		`,
		app,
	);

	initializeComponents();
	loadWorkspaces();
	loadSidebarWidth();
	applySidebarWidth();
	await ensureBundledThemesInstalled();

	try {
		connectionError = null;
		renderApp();
		mountSettingsPanel();
		// Ensure creatorskill exists on first run (copied from packaged assets if available)
		await packagesView?.ensureCreatorSkillInstalled();
		// Refresh discovered resources so Packages view shows the new skill immediately
		try {
			await packagesView?.refreshPackages(true);
		} catch {
			// ignore
		}

		const chatContainer = document.getElementById("chat-container");
		if (!chatContainer) throw new Error("Chat container missing");
		chatView = new ChatView(chatContainer);
		chatView.setProjectPath(null);
		chatView.connect();
		chatView.setOnStateChange((state) => {
			const runtime = getActiveRuntime();
			if (!runtime) {
				recordDebugTrace(`state-change ignored: no active runtime session=${state.sessionFile ?? "-"}`);
				return;
			}
			sidebar?.setActiveSessionPath(state.sessionFile ?? null);
			updateRuntimeFromState(runtime, state);
			if (state.sessionFile) {
				runtime.lastKnownSessionPath = state.sessionFile;
				runtime.draftInitialized = true;
			}
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			if (workspace.activeSessionTabId !== runtime.tabId) {
				recordDebugTrace(
					`state-change ignored: runtime-tab=${runtime.tabId} active-tab=${workspace.activeSessionTabId ?? "-"} session=${state.sessionFile ?? "-"}`,
				);
				return;
			}
			ensureWorkspaceContentState(workspace);
			const incomingName = (state.sessionName || "").trim();
			const nextTitle = incomingName || "Chat";
			const activeSession = getActiveSessionTab(workspace);
			if (state.sessionFile) {
				activeSession.sessionPath = state.sessionFile;
				const currentTitle = (activeSession.title || "").trim().toLowerCase();
				const keepNewSessionLabel =
					(incomingName.length === 0 || incomingName.toLowerCase() === "chat") &&
					["chat", "new session", ""].includes(currentTitle);
				activeSession.title = keepNewSessionLabel ? NEW_SESSION_TAB_TITLE : nextTitle;
			} else if (incomingName && activeSession.sessionPath) {
				activeSession.title = nextTitle;
			} else if (!activeSession.sessionPath && !activeSession.title.trim()) {
				activeSession.title = NEW_SESSION_TAB_TITLE;
			}
			activeSession.messageCount = typeof state.messageCount === "number" ? state.messageCount : activeSession.messageCount;
			if ((state.messageCount ?? 0) > 0) {
				activeSession.ephemeral = false;
			}
			workspace.sessionTitle = activeSession.title || NEW_SESSION_TAB_TITLE;
			workspace.activeSessionTabId = activeSession.id;
			syncSidebarSelectionFromWorkspace(workspace);
			if (state.sessionFile && (state.messageCount ?? 0) > 0) {
				const projectId = getSessionTabProjectId(activeSession) ?? getWorkspaceActiveProjectId(workspace);
				if (projectId) {
					sidebar?.upsertSession(projectId, {
						id: state.sessionId,
						name: incomingName || activeSession.title || "Untitled session",
						path: state.sessionFile,
						optimistic: true,
					});
				}
			}
			persistWorkspaces();
			syncContentTabsBar(workspace);
			if (state.sessionFile) {
				scheduleSidebarSessionsRefresh();
			}
		});
		chatView.setOnOpenTerminal(() => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			workspace.terminalOpen = true;
			workspace.pane = "terminal";
			persistWorkspaces();
			syncWorkspaceTabsBar();
			void applyWorkspacePane(workspace);
		});
		chatView.setOnAddProject(() => {
			void sidebar?.openFolder();
		});
		chatView.setOnOpenSettings((sectionId) => {
			requestOpenSettingsPanel(sectionId);
		});
		chatView.setOnOpenPackages(() => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			workspace.pane = workspace.pane === "packages" ? "chat" : "packages";
			persistWorkspaces();
			syncWorkspaceTabsBar();
			void applyWorkspacePane(workspace);
		});
		chatView.setOnOpenExtensionConfig(async (commandName) => {
			if (commandName !== "name-ai-config") return false;
			openPackagesPane();
			return await (packagesView?.openExtensionConfigBySource("npm:pi-session-auto-rename") ?? false);
		});
		chatView.setOnBeginRenameCurrentSession(() => {
			const workspace = getActiveWorkspace();
			if (!workspace) return false;
			const activeSession = getActiveSessionTab(workspace);
			const projectId = getSessionTabProjectId(activeSession) ?? getWorkspaceActiveProjectId(workspace);
			const sessionPath = normalizeSessionPath(chatView?.getState()?.sessionFile ?? activeSession.sessionPath ?? "");
			if (!projectId || !sessionPath) return false;
			return sidebar?.beginSessionRename(projectId, sessionPath) ?? false;
		});
		chatView.setOnRenameCurrentSession(async (nextName) => {
			const workspace = getActiveWorkspace();
			if (!workspace) return false;
			const activeSession = getActiveSessionTab(workspace);
			const projectId = getSessionTabProjectId(activeSession) ?? getWorkspaceActiveProjectId(workspace);
			const sessionPath = normalizeSessionPath(chatView?.getState()?.sessionFile ?? activeSession.sessionPath ?? "");
			if (projectId && sessionPath) {
				return await renameSessionFromWorkspace(projectId, sessionPath, nextName);
			}
			try {
				await rpcBridge.setSessionName(nextName);
				activeSession.title = nextName;
				if (workspace.activeSessionTabId === activeSession.id) {
					workspace.sessionTitle = nextName;
				}
				persistWorkspaces();
				syncContentTabsBar(workspace);
				await chatView?.refreshFromBackend({ throwOnError: true });
				return true;
			} catch (err) {
				console.error("Failed to rename current session:", err);
				chatView?.notify("Failed to rename session", "error");
				return false;
			}
		});
		chatView.setOnCreateFreshSession(async () => {
			const workspace = getActiveWorkspace();
			if (!workspace) return false;
			if (!getWorkspaceActiveProjectPath(workspace)) {
				chatView?.notify("Add/select a project before creating a new session", "info");
				return false;
			}
			await startFreshSessionTab();
			return true;
		});
		chatView.setOnReloadRuntime(async () => {
			const workspace = getActiveWorkspace();
			if (!workspace || !getWorkspaceActiveProjectPath(workspace)) {
				chatView?.notify("Add/select a project before reloading runtime", "info");
				return false;
			}
			return await reloadActiveWorkspaceRuntime();
		});
		chatView.setOnOpenSessionBrowser((query) => {
			void sessionBrowser?.open({ query });
		});
		chatView.setOnOpenShortcuts(() => {
			shortcutsPanel?.open();
		});
		chatView.setOnQuitApp(() => {
			void (async () => {
				try {
					const { getCurrentWindow } = await import("@tauri-apps/api/window");
					await getCurrentWindow().close();
				} catch {
					window.close();
				}
			})();
		});
		chatView.setOnSelectWelcomeProject((projectId) => {
			sidebar?.setActiveProject(projectId, true);
		});
		chatView.setOnPromptSubmitted(() => {
			startSidebarSessionsWarmRefresh();
		});
		chatView.setOnRunStateChange((running) => {
			const runtime = getActiveRuntime();
			if (runtime) {
				setRuntimeRunning(runtime, running);
				const currentSessionPath = chatView?.getState()?.sessionFile ?? runtime.lastKnownSessionPath;
				if (currentSessionPath) {
					runtime.lastKnownSessionPath = currentSessionPath;
				}
			}
			if (running) {
				startSidebarSessionsWarmRefresh();
			} else {
				stopSidebarSessionsWarmRefresh();
				scheduleSidebarSessionsRefresh(0);
			}
		});
		chatView.render();
		ensureDebugOverlayPolling();
		syncDebugOverlay();

		extensionUiHandler?.setEditorTextHandler((text) => chatView?.setInputText(text));
		wireCommandPaletteBuiltins();

		const startupWorkspace = getActiveWorkspace();
		if (startupWorkspace) {
			await applyWorkspacePane(startupWorkspace);
		}

		const startupWorkspaceId = activeWorkspaceId;
		if (startupWorkspaceId) {
			void queueProjectTask(
				async (version) => {
					await activateWorkspace(startupWorkspaceId, version);
				},
				(err) => {
					console.error("Startup workspace activation failed:", err);
					recordDebugTrace(`startup-activation-error: ${err instanceof Error ? err.message : String(err)}`);
					chatView?.notify("Failed to restore workspace runtime", "error");
				},
				{ label: "startup-activate-workspace" },
			);
		}

		await runStartupCompatibilityCheck();
		await refreshCliUpdateStatus();
		await refreshDesktopUpdateStatus();
		startCliUpdatePolling();
		startDesktopUpdatePolling();
	} catch (err) {
		connectionError = err instanceof Error ? err.message : String(err);
		recordDebugTrace(`initialize-fatal: ${connectionError}`);
		renderApp();
	}
}

function mountSettingsPanel(): SettingsPanel {
	const settingsContainer = document.getElementById("settings-pane");
	if (!settingsContainer) {
		throw new Error("Settings pane container not found");
	}
	if (settingsPanel) {
		settingsPanel.setContainer(settingsContainer);
		syncSidebarSettingsNavigation();
		return settingsPanel;
	}
	const panel = new SettingsPanel(settingsContainer);
	panel.setOnDesktopStatusChange((status) => {
		desktopUpdateStatus = status;
		syncDesktopUpdateUiHint();
	});
	panel.setOnCliStatusChange((status) => {
		cliUpdateStatus = status;
		syncCliUpdateUiHint();
	});
	panel.setOnClose(() => {
		const workspace = getActiveWorkspace();
		if (!workspace || workspace.pane !== "settings") return;
		workspace.pane = "chat";
		persistWorkspaces();
		syncWorkspaceTabsBar();
		void applyWorkspacePane(workspace);
	});
	panel.setOnRequestAddProject(() => {
		void sidebar?.openFolder();
	});
	panel.setOnNavigationStateChange(() => {
		syncSidebarSettingsNavigation();
	});
	settingsPanel = panel;
	syncSidebarSettingsNavigation();
	return panel;
}

function initializeComponents(): void {
	if (commandPalette || sessionBrowser || shortcutsPanel || extensionUiHandler) {
		return;
	}

	const commandPaletteContainer = document.createElement("div");
	commandPaletteContainer.id = "command-palette-container";
	document.body.appendChild(commandPaletteContainer);
	commandPalette = new CommandPalette(commandPaletteContainer);

	const sessionBrowserContainer = document.createElement("div");
	sessionBrowserContainer.id = "session-browser-container";
	document.body.appendChild(sessionBrowserContainer);
	sessionBrowser = new SessionBrowser(sessionBrowserContainer);
	sessionBrowser.setOnSessionSelected(async () => {
		const workspace = getActiveWorkspace();
		if (workspace) {
			workspace.pane = "chat";
			persistWorkspaces();
		}
		await chatView?.refreshFromBackend({ throwOnError: true });
		await applyWorkspacePane(workspace ?? null);
	});
	sessionBrowser.setOnForkText((text) => {
		chatView?.setInputText(text);
	});

	const shortcutsPanelContainer = document.createElement("div");
	shortcutsPanelContainer.id = "shortcuts-panel-container";
	document.body.appendChild(shortcutsPanelContainer);
	shortcutsPanel = new ShortcutsPanel(shortcutsPanelContainer);

	extensionUiHandler = new ExtensionUiHandler();
	extensionUiHandler.setTraceHandler(recordDebugTrace);
	ensureNotificationAttentionListeners();
	extensionUiHandler.setNotificationActionHandler((target) => {
		void queueProjectTask(
			async (version) => {
				await focusNotificationTarget(target, version);
			},
			(err) => {
				console.error("Failed to focus notification target:", err);
			},
			{ label: "notification-action-focus" },
		);
	});

	rpcBridge.onEvent((event) => {
		const type = typeof event.type === "string" ? event.type : "unknown";
		if (type === "agent_start" || type === "agent_end" || type === "error" || type === "extension_ui_request") {
			recordDebugTrace(`rpc:event type=${type}`);
		}
		if (type === "extension_ui_request") {
			const method = typeof event.method === "string" ? event.method : "unknown";
			const message = typeof event.message === "string" ? event.message : "";
			recordDebugTrace(`extension_ui_request method=${method} message=${message.slice(0, 80)}`);

			const request = { ...(event as Record<string, unknown>) } as Record<string, unknown>;
			if (method === "notify") {
				const runtime = getActiveRuntime();
				const workspace = runtime ? workspaces.find((entry) => entry.id === runtime.workspaceId) ?? null : getActiveWorkspace();
				const activeTab = workspace ? getActiveSessionTab(workspace) : null;
				const targetWorkspaceId = runtime?.workspaceId ?? workspace?.id ?? undefined;
				const targetTabId = runtime?.tabId ?? activeTab?.id ?? undefined;
				const targetSessionPath = runtime?.lastKnownSessionPath ?? activeTab?.sessionPath ?? undefined;

				if (targetWorkspaceId || targetTabId || targetSessionPath) {
					request.notifyTargetWorkspaceId = targetWorkspaceId;
					request.notifyTargetTabId = targetTabId;
					request.notifyTargetSessionPath = targetSessionPath;
					recordDebugTrace(
						`notify-target workspace=${targetWorkspaceId ?? "-"} tab=${targetTabId ?? "-"} session=${targetSessionPath ?? "-"}`,
					);
					markSessionAttentionTarget({
						workspaceId: targetWorkspaceId,
						tabId: targetTabId,
						sessionPath: targetSessionPath,
					});
				}
			}

			const normalizedRequest = normalizeExtensionUiRequest(request);
			if (!normalizedRequest) {
				const requestId = typeof request.id === "string" ? request.id.trim() : "";
				const unsupportedMethod = typeof request.method === "string" ? request.method : "unknown";
				recordDebugTrace(`extension_ui_request unsupported method=${unsupportedMethod} source=active`);
				if (requestId) {
					if (extensionUiHandler) {
						void extensionUiHandler.respondUnsupportedRequest(requestId, unsupportedMethod, "active");
					} else {
						void rpcBridge.sendExtensionUiResponse({
							type: "extension_ui_response",
							id: requestId,
							success: false,
							error: `Unsupported extension UI capability: ${unsupportedMethod}`,
						});
					}
				}
				return;
			}

			void extensionUiHandler?.handleRequest(normalizedRequest);
		}
	});
}

function openPackagesPane(): void {
	const workspace = getActiveWorkspace();
	if (!workspace) return;
	workspace.pane = "packages";
	persistWorkspaces();
	syncWorkspaceTabsBar();
	void applyWorkspacePane(workspace);
}

async function startFreshSessionTab(): Promise<void> {
	const workspace = getActiveWorkspace();
	if (!workspace) return;
	ensureWorkspaceContentState(workspace);
	const projectPath = getWorkspaceActiveProjectPath(workspace);
	if (!projectPath) return;

	pruneInactiveEphemeralSessionTabs(workspace);
	createAndActivateEmptySessionTab(workspace, NEW_SESSION_TAB_TITLE, getWorkspaceActiveProjectId(workspace), projectPath);
	persistWorkspaces();
	syncWorkspaceTabsBar();
	syncContentTabsBar(workspace);
	syncActiveChatRuntimeBinding(workspace, { forceReset: true, statusText: "Starting new session…" });
	await applyWorkspacePane(workspace);

	await queueProjectTask(
		async (version) => {
			await ensureRpcForProject(projectPath, version);
			assertProjectTaskCurrent(version);
			await chatView?.refreshFromBackend({ throwOnError: true });
			assertProjectTaskCurrent(version);
			await applyWorkspacePane(workspace ?? null);
		},
		(err) => {
			console.error("Failed to create session tab:", err);
			chatView?.notify("Failed to create new session", "error");
		},
		{ label: "fresh-session-tab" },
	);
}

function wireCommandPaletteBuiltins(): void {
	commandPalette?.setBuiltins([
		{
			name: "new-session",
			description: "Start a fresh session",
			action: async () => startFreshSessionTab(),
		},
		{
			name: "sessions",
			description: "Browse and resume sessions",
			action: async () => sessionBrowser?.open(),
		},
		{
			name: "settings",
			description: "Open desktop settings",
			action: async () => requestOpenSettingsPanel(),
		},
		{
			name: "packages",
			description: "Open packages & resources",
			action: async () => openPackagesPane(),
		},
		{
			name: "fork",
			description: "Fork from previous message",
			action: async () => chatView?.openHistoryViewerForFork({ loading: false, sessionName: null }),
		},
		{
			name: "history",
			description: "Open session history viewer",
			action: async () => chatView?.openHistoryViewer(),
		},
		{
			name: "compact",
			description: "Compact current session context",
			action: async () => {
				await chatView?.compactNow();
			},
		},
	]);
}

function scheduleSettingsPaneRecovery(reason: string, delayMs = 80): void {
	if (settingsPaneRecoveryTimer) {
		clearTimeout(settingsPaneRecoveryTimer);
	}
	settingsPaneRecoveryTimer = setTimeout(() => {
		settingsPaneRecoveryTimer = null;
		void recoverSettingsPaneIfBlank(reason);
	}, delayMs);
}

async function recoverSettingsPaneIfBlank(reason: string): Promise<void> {
	const workspace = getActiveWorkspace();
	if (!workspace || workspace.pane !== "settings") return;
	const settingsContainer = document.getElementById("settings-pane");
	if (!settingsContainer) return;
	if (settingsContainer.childElementCount > 0 && settingsPanel?.isVisible()) return;
	recordDebugTrace(`settings-recover reason=${reason}`);
	try {
		settingsPanel = null;
		const panel = mountSettingsPanel();
		panel.setRuntimeProjectPath(resolveSettingsRuntimeProjectPath(workspace));
		await panel.open();
	} catch (err) {
		console.error("Settings pane blank recovery failed:", err);
	}
}

function normalizeSettingsSectionId(sectionId: string | null | undefined): SettingsSectionId | null {
	switch ((sectionId || "").trim().toLowerCase()) {
		case "general":
			return "general";
		case "appearance":
			return "appearance";
		case "account":
			return "account";
		case "updates":
			return "updates";
		default:
			return null;
	}
}

function requestOpenSettingsPanel(sectionId?: string): void {
	const workspace = getActiveWorkspace();
	if (!workspace) return;
	const targetSection = normalizeSettingsSectionId(sectionId);
	workspace.pane = "settings";
	persistWorkspaces();
	syncWorkspaceTabsBar();
	setPaneVisibility("settings");
	try {
		const panel = mountSettingsPanel();
		panel.setRuntimeProjectPath(resolveSettingsRuntimeProjectPath(workspace));
		if (targetSection) panel.setActiveSection(targetSection);
	} catch (mountErr) {
		console.error("Failed to prepare settings panel before open:", mountErr);
	}
	void applyWorkspacePane(workspace)
		.catch((err) => {
			console.error("Failed to open settings pane:", err);
			try {
				settingsPanel = null;
				setPaneVisibility("settings");
				const panel = mountSettingsPanel();
				panel.setRuntimeProjectPath(resolveSettingsRuntimeProjectPath(workspace));
				if (targetSection) panel.setActiveSection(targetSection);
				void panel.open();
			} catch (innerErr) {
				console.error("Settings pane recovery failed:", innerErr);
			}
		})
		.finally(() => {
			scheduleSettingsPaneRecovery("request-open");
		});
}

function openSettings(): void {
	requestOpenSettingsPanel();
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
	toggleDesktopTheme();
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
		if (e.defaultPrevented) return;

		if (isCtrlOrMeta && e.key.toLowerCase() === "n") {
			e.preventDefault();
			void startFreshSessionTab();
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
			requestOpenSettingsPanel();
			return;
		}

		if (isCtrlOrMeta && isShift && e.key.toLowerCase() === "r") {
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
					await chatView?.refreshFromBackend({ throwOnError: true });
				})
				.catch((err) => console.error("Failed to cycle model:", err));
			return;
		}

		if (e.key === "Tab" && isShift && !isInput) {
			e.preventDefault();
			void rpcBridge
				.cycleThinkingLevel()
				.then(async () => {
					await chatView?.refreshFromBackend({ throwOnError: true });
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
			if (commandPalette?.isVisible()) {
				e.preventDefault();
				commandPalette.close();
				return;
			}
			if (sessionBrowser?.isVisible()) {
				e.preventDefault();
				sessionBrowser.close();
				return;
			}
			if (shortcutsPanel?.isVisible()) {
				e.preventDefault();
				shortcutsPanel.close();
				return;
			}
			if (settingsPanel?.isVisible()) {
				e.preventDefault();
				settingsPanel.close();
				return;
			}
			return;
		}

		if (e.key === "/" && !isInput) {
			e.preventDefault();
			void commandPalette?.open();
		}
	});
}

function renderApp(): void {
	const app = document.getElementById("app");
	if (!app) return;

	if (connectionError) {
		removeSidebarResizeHandlers?.();
		removeSidebarResizeHandlers = null;
		const cliMissing = isCliMissingError(connectionError);
		render(
			html`
				<div class="error-shell">
					<div class="error-card ${cliMissing ? "onboarding-card" : ""}">
						<h1>${cliMissing ? "Install Pi CLI to continue" : "Connection failed"}</h1>
						${cliMissing
							? html`
								<p>Pi Desktop could not find the <code>pi</code> CLI on your machine.</p>
								<div class="onboarding-command-block">
									<div class="onboarding-command-label">Run this in Terminal</div>
									<code>${CLI_INSTALL_COMMAND}</code>
								</div>
								<div class="onboarding-actions">
									<button class="ghost-btn" @click=${() => void copyCliInstallCommand()}>Copy install command</button>
									<button @click=${() => {
										connectionError = null;
										void initialize();
									}}>I installed it · Retry</button>
								</div>
								<p class="onboarding-footnote">Need npm first? Install Node.js, then run the command above.</p>
							`
							: html`
								<p>${connectionError}</p>
								<button @click=${() => {
									connectionError = null;
									void initialize();
								}}>Retry</button>
							`}
					</div>
				</div>
			`,
			app,
		);
		return;
	}

	render(
		html`
			<div class="app-shell">
				<pre id="runtime-debug-overlay" class="runtime-debug-overlay ${shouldShowDebugOverlay() ? "" : "hidden"}"></pre>
				<div class="content-shell">
					<div id="sidebar-container"></div>
					<div id="sidebar-resize-handle" title="Resize sidebar"></div>
					<div id="main-pane">
						<button
							id="sidebar-collapse-toggle"
							class="workspace-sidebar-toggle ${isSidebarCollapsedState() ? "collapsed" : "hidden"}"
							title="Toggle sidebar"
							@click=${() => {
								sidebar?.toggleCollapsed();
								syncSidebarCollapseToggleButton();
							}}
						>
							<svg viewBox="0 0 16 16" aria-hidden="true">
								<path d="M3 3.5h10v9H3z" />
								<path d="M6 3.5v9" />
							</svg>
						</button>
						<div id="content-tabs-container" data-tauri-drag-region></div>
						<div id="session-pane"><div id="chat-container"></div></div>
						<div id="file-pane" class="hidden-pane"></div>
						<div id="terminal-pane" class="hidden-pane"></div>
						<div id="packages-pane" class="hidden-pane"></div>
						<div id="settings-pane" class="hidden-pane"></div>
					</div>
				</div>
			</div>
		`,
		app,
	);
	const settingsPaneContainer = document.getElementById("settings-pane");
	if (settingsPanel && settingsPaneContainer) {
		settingsPanel.setContainer(settingsPaneContainer);
		if (settingsPanel.isVisible() && !settingsPanel.hasRenderedContent()) {
			settingsPanel.render();
		}
	}
	const activeWorkspace = getActiveWorkspace();
	if (activeWorkspace?.pane === "settings" && settingsPaneContainer && settingsPaneContainer.childElementCount === 0) {
		scheduleSettingsPaneRecovery("render-app");
	}

	applySidebarWidth();
	setupSidebarResize();
	syncSidebarCollapseToggleButton();

	const contentTabsContainer = document.getElementById("content-tabs-container");
	if (contentTabsContainer) {
		contentTabsBar = new ContentTabs(contentTabsContainer);
		contentTabsBar.setOnSelect((tabId) => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			ensureWorkspaceContentState(workspace);

			if (tabId === "terminal") {
				workspace.terminalOpen = true;
				workspace.pane = "terminal";
				pruneEphemeralTabsWhenLeavingDraft(workspace);
				persistWorkspaces();
				syncWorkspaceTabsBar();
				void applyWorkspacePane(workspace);
				return;
			}

			const fileTab = workspace.fileTabs.find((tab) => tab.id === tabId);
			if (fileTab) {
				workspace.activeFileTabId = fileTab.id;
				workspace.filePath = fileTab.path;
				setWorkspaceActiveProject(workspace, { id: fileTab.projectId, path: fileTab.projectPath });
				workspace.pane = "file";
				pruneEphemeralTabsWhenLeavingDraft(workspace);
				persistWorkspaces();
				syncWorkspaceTabsBar();
				void applyWorkspacePane(workspace);
				return;
			}

			const candidateSessionTab = workspace.sessionTabs.find((tab) => tab.id === tabId) ?? null;
			if (!candidateSessionTab) return;

			const sessionTab = setActiveSessionTab(workspace, tabId);
			if (!sessionTab) return;
			pruneInactiveEphemeralSessionTabs(workspace, [sessionTab.id]);
			persistWorkspaces();
			syncWorkspaceTabsBar();
			syncContentTabsBar(workspace);
			syncActiveChatRuntimeBinding(workspace, { forceReset: true, statusText: sessionTab.sessionPath ? "Loading session…" : "Starting new session…" });
			void applyWorkspacePane(workspace);

			const projectPath = getSessionTabProjectPath(sessionTab);
			void queueProjectTask(
				async (version) => {
					if (projectPath) {
						await ensureRuntimeForSessionTab(workspace, sessionTab, projectPath, true, version);
						assertProjectTaskCurrent(version);
						await chatView?.refreshFromBackend({ throwOnError: true });
						assertProjectTaskCurrent(version);
						await chatView?.refreshModels();
					}
					assertProjectTaskCurrent(version);
					await applyWorkspacePane(workspace);
				},
				(err) => {
					console.error("Failed to switch content-tab session:", err);
					chatView?.notify("Failed to switch session tab", "error");
				},
			);
		});
		contentTabsBar.setOnOpenTerminal(() => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			workspace.terminalOpen = true;
			workspace.pane = "terminal";
			persistWorkspaces();
			syncWorkspaceTabsBar();
			void applyWorkspacePane(workspace);
		});
		contentTabsBar.setOnRename((tabId, nextTitle) => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			ensureWorkspaceContentState(workspace);
			const title = nextTitle.trim();
			if (!title) return;

			const fileTab = workspace.fileTabs.find((tab) => tab.id === tabId);
			if (fileTab) {
				fileTab.title = title;
				persistWorkspaces();
				syncWorkspaceTabsBar();
				syncContentTabsBar(workspace);
				if (workspace.activeFileTabId === fileTab.id && workspace.pane === "file") {
					void applyWorkspacePane(workspace);
				}
				return;
			}

			const sessionTab = workspace.sessionTabs.find((tab) => tab.id === tabId);
			if (sessionTab) {
				sessionTab.title = title;
				if (workspace.activeSessionTabId === sessionTab.id) {
					workspace.sessionTitle = title;
				}
				persistWorkspaces();
				syncWorkspaceTabsBar();
				syncContentTabsBar(workspace);
			}
		});

		contentTabsBar.setOnClose((tabId) => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			ensureWorkspaceContentState(workspace);

			if (tabId === "terminal") {
				workspace.terminalOpen = false;
				if (workspace.pane === "terminal") workspace.pane = "chat";
				persistWorkspaces();
				syncWorkspaceTabsBar();
				void applyWorkspacePane(workspace);
				return;
			}

			const fileIndex = workspace.fileTabs.findIndex((tab) => tab.id === tabId);
			if (fileIndex !== -1) {
				const wasActive = workspace.activeFileTabId === tabId;
				workspace.fileTabs.splice(fileIndex, 1);
				if (wasActive) {
					const nextFile = workspace.fileTabs[fileIndex] ?? workspace.fileTabs[fileIndex - 1] ?? null;
					workspace.activeFileTabId = nextFile?.id ?? null;
					workspace.filePath = nextFile?.path ?? null;
					workspace.pane = nextFile ? "file" : "chat";
				}
				ensureWorkspaceContentState(workspace);
				persistWorkspaces();
				syncWorkspaceTabsBar();
				void applyWorkspacePane(workspace);
				return;
			}

			const sessionIndex = workspace.sessionTabs.findIndex((tab) => tab.id === tabId);
			if (sessionIndex === -1) return;

			const wasActive = workspace.activeSessionTabId === tabId;
			const removedTab = workspace.sessionTabs[sessionIndex] ?? null;
			workspace.sessionTabs.splice(sessionIndex, 1);
			scheduleDiscardEphemeralSessionTabs(removedTab ? [removedTab] : []);
			let nextSession: WorkspaceSessionTab | null = null;

			if (workspace.sessionTabs.length === 0) {
				nextSession = createSessionTab(
					NEW_SESSION_TAB_TITLE,
					null,
					removedTab?.projectId ?? workspace.activeProjectId,
					removedTab?.projectPath ?? workspace.activeProjectPath,
				);
				workspace.sessionTabs = [nextSession];
				workspace.activeSessionTabId = nextSession.id;
				workspace.sessionTitle = nextSession.title;
				workspace.pane = "chat";
			} else if (wasActive) {
				nextSession = workspace.sessionTabs[sessionIndex] ?? workspace.sessionTabs[sessionIndex - 1] ?? workspace.sessionTabs[0] ?? null;
				workspace.activeSessionTabId = nextSession?.id ?? null;
				workspace.sessionTitle = nextSession?.title ?? NEW_SESSION_TAB_TITLE;
				workspace.pane = "chat";
			}

			ensureWorkspaceContentState(workspace);
			persistWorkspaces();
			syncWorkspaceTabsBar();
			syncContentTabsBar(workspace);
			syncActiveChatRuntimeBinding(workspace, {
				forceReset: true,
				statusText: nextSession?.sessionPath ? "Loading session…" : "Starting new session…",
			});
			void applyWorkspacePane(workspace);

			const disposeRemovedRuntime = () => {
				if (removedTab) {
					removeRuntimeForTab(workspace.id, removedTab.id);
				}
			};

			if (!wasActive) {
				disposeRemovedRuntime();
				void applyWorkspacePane(workspace);
				return;
			}

			const nextProjectPath = getSessionTabProjectPath(nextSession) ?? getWorkspaceActiveProjectPath(workspace);
			void queueProjectTask(
				async (version) => {
					if (nextProjectPath && nextSession) {
						await ensureRuntimeForSessionTab(workspace, nextSession, nextProjectPath, true, version);
						assertProjectTaskCurrent(version);
						await chatView?.refreshFromBackend({ throwOnError: true });
					}
					assertProjectTaskCurrent(version);
					disposeRemovedRuntime();
					scheduleSidebarSessionsRefresh(0);
					await applyWorkspacePane(workspace);
				},
				(err) => {
					console.error("Failed to switch after closing session tab:", err);
					chatView?.notify("Failed to switch session tab", "error");
				},
			);
		});
	}

	const filePane = document.getElementById("file-pane");
	if (filePane) {
		fileViewer = new FileViewer(filePane);
		fileViewer.setProjectPath(null);
		fileViewer.setOnDraftFileCreated((filePath) => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			ensureWorkspaceContentState(workspace);

			const activeFileTab = workspace.fileTabs.find((tab) => tab.id === workspace.activeFileTabId) ?? null;
			if (activeFileTab && !activeFileTab.path) {
				const anchorPath = normalizeStoredPath(activeFileTab.draftAnchorPath);
				activeFileTab.path = filePath;
				activeFileTab.title = baseName(filePath);
				activeFileTab.draftDirectoryPath = null;
				activeFileTab.draftAnchorPath = null;
				setFileTabProject(activeFileTab, activeFileTab.projectId ?? workspace.activeProjectId, activeFileTab.projectPath ?? workspace.activeProjectPath);
				if (anchorPath && activeFileTab.projectId) {
					sidebar?.setNewFilePlacementHint(activeFileTab.projectId, filePath, anchorPath);
				}
			} else {
				openOrActivateFileTab(workspace, filePath, workspace.activeProjectId, workspace.activeProjectPath);
			}

			workspace.filePath = filePath;
			workspace.pane = "file";
			ensureWorkspaceContentState(workspace);
			persistWorkspaces();
			syncWorkspaceTabsBar();
			syncContentTabsBar(workspace);
			syncSidebarSelectionFromWorkspace(workspace);
			sidebar?.refreshActiveProjectFiles(true);
			void applyWorkspacePane(workspace);
		});
	}

	const terminalPane = document.getElementById("terminal-pane");
	if (terminalPane) {
		terminalPanel = new TerminalPanel(terminalPane);
		terminalPanel.setProjectPath(null);
	}

	const packagesPane = document.getElementById("packages-pane");
	if (packagesPane) {
		packagesView = new PackagesView(packagesPane);
		packagesView.setProjectPath(null);
		packagesView.setOnBack(() => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			workspace.pane = "chat";
			persistWorkspaces();
			syncWorkspaceTabsBar();
			void applyWorkspacePane(workspace);
		});
		packagesView.setOnInsertPromptTemplate(async (commandText) => {
			const workspace = getActiveWorkspace();
			if (!workspace) return;
			workspace.pane = "chat";
			persistWorkspaces();
			syncWorkspaceTabsBar();
			await applyWorkspacePane(workspace);
			chatView?.stageComposerCommand(commandText);
			clearVisibleActiveSessionAttention();
		});
	}

	const sidebarContainer = document.getElementById("sidebar-container");
	if (!sidebarContainer) return;
	sidebar = new Sidebar(sidebarContainer);
	sidebar.setOnCollapsedChange(() => {
		applyWorkspaceTopbarOffset();
		syncSidebarCollapseToggleButton();
	});
	syncSidebarCollapseToggleButton();
	syncCliUpdateUiHint();
	syncDesktopUpdateUiHint();

	sidebar.setOnWorkspaceSelect((workspaceId) => {
		void queueProjectTask(
			async (version) => {
				assertProjectTaskCurrent(version);
				await activateWorkspace(workspaceId, version);
			},
			(err) => {
				console.error("Failed to switch workspace:", err);
				chatView?.notify("Failed to switch workspace", "error");
			},
			{ label: "workspace-select" },
		);
	});

	sidebar.setOnWorkspaceCreate((draft) => {
		const title = draft?.title?.trim();
		const emoji = draft?.emoji ?? null;
		const workspace = createWorkspace(title && title.length > 0 ? title : undefined, emoji);
		workspaces.push(workspace);
		activeWorkspaceId = workspace.id;
		persistWorkspaces();
		syncWorkspaceTabsBar();
		void queueProjectTask(
			async (version) => {
				assertProjectTaskCurrent(version);
				await activateWorkspace(workspace.id, version);
			},
			(err) => {
				console.error("Failed to create workspace:", err);
				chatView?.notify("Failed to create workspace", "error");
			},
			{ label: "workspace-add" },
		);
	});

	sidebar.setOnWorkspaceEmoji((workspaceId, emoji) => {
		const workspace = workspaces.find((entry) => entry.id === workspaceId);
		if (!workspace) return;
		workspace.emoji = emoji ?? pickWorkspaceDefaultEmoji(workspace.id);
		persistWorkspaces();
		syncWorkspaceTabsBar();
	});


	sidebar.setOnWorkspaceRename((workspaceId, nextTitle) => {
		const workspace = workspaces.find((entry) => entry.id === workspaceId);
		const title = nextTitle.trim();
		if (!workspace || !title || title === workspace.title) return;
		workspace.title = title;
		persistWorkspaces();
		syncWorkspaceTabsBar();
	});

	sidebar.setOnWorkspaceDelete((workspaceId) => {
		closeWorkspace(workspaceId);
	});

	sidebar.setOnWorkspaceReorder((orderedIds) => {
		if (!applyWorkspaceTabOrder(orderedIds)) return;
		persistWorkspaces();
		syncWorkspaceTabsBar();
	});

	sidebar.setOnOpenSettings(() => {
		requestOpenSettingsPanel();
	});

	sidebar.setOnTogglePackages(() => {
		const workspace = getActiveWorkspace();
		if (!workspace) return;
		workspace.pane = workspace.pane === "packages" ? "chat" : "packages";
		persistWorkspaces();
		syncWorkspaceTabsBar();
		void applyWorkspacePane(workspace);
	});

	sidebar.setOnModeChange((mode) => {
		const workspace = getActiveWorkspace();
		if (!workspace) return;
		workspace.leftMode = mode;
		persistWorkspaces();
		syncWorkspaceTabsBar();
	});

	sidebar.setOnSettingsNavSelect((sectionId) => {
		if (!settingsPanel) return;
		settingsPanel.setActiveSection(sectionId as SettingsSectionId);
		syncSidebarSettingsNavigation();
	});

	sidebar.setOnProjectSelect((project) => {
		const workspace = getActiveWorkspace();
		if (!workspace) return;
		ensureWorkspaceContentState(workspace);

		const currentProjectId = getWorkspaceActiveProjectId(workspace);
		const currentProjectPath = getWorkspaceActiveProjectPath(workspace);
		const selectingSameProject =
			project !== null &&
			currentProjectId === project.id &&
			normalizeProjectPath(currentProjectPath) === normalizeProjectPath(project.path);
		if (selectingSameProject) {
			setWorkspaceActiveProject(workspace, project);
			persistWorkspaces();
			syncWorkspaceTabsBar();
			void applyWorkspacePane(workspace);
			return;
		}

		const oldRuntimeKeys = listRuntimeKeysForWorkspace(workspace.id);
		const discardedSessionTabs = [...workspace.sessionTabs];
		if (!project) {
			scheduleDiscardEphemeralSessionTabs(discardedSessionTabs);
			setWorkspaceActiveProject(workspace, null);
			setActiveRuntime(null);
			resetWorkspaceContentTabs(workspace, null);
			persistWorkspaces();
			syncWorkspaceTabsBar();
			chatView?.setProjectPath(null);
			packagesView?.setProjectPath(null);
			terminalPanel?.setProjectPath(null);
			fileViewer?.setProjectPath(null);
			void applyWorkspacePane(workspace);
			void queueProjectTask(
				async (version) => {
					assertProjectTaskCurrent(version);
					removeRuntimeKeys(oldRuntimeKeys);
					syncRunningSessionIndicators();
					await applyWorkspacePane(workspace);
				},
				(err) => {
					console.error("Failed to clear active project:", err);
					chatView?.notify("Failed to clear active project", "error");
				},
			);
			return;
		}

		const preferredSession = sidebar?.getPreferredSessionForProject(project.id) ?? null;
		setWorkspaceActiveProject(workspace, project);
		scheduleDiscardEphemeralSessionTabs(discardedSessionTabs);

		if (preferredSession) {
			resetWorkspaceContentTabs(workspace, project);
			const sessionTab = openOrActivateSessionTab(workspace, preferredSession.path, project.id, project.path, preferredSession.name);
			pruneInactiveEphemeralSessionTabs(workspace, [sessionTab.id]);
			persistWorkspaces();
			syncWorkspaceTabsBar();
			syncContentTabsBar(workspace);
			syncActiveChatRuntimeBinding(workspace, { forceReset: true, statusText: "Loading session…" });
			void applyWorkspacePane(workspace);

			void queueProjectTask(
				async (version) => {
					await ensureRuntimeForSessionTab(workspace, sessionTab, project.path, true, version);
					assertProjectTaskCurrent(version);
					await chatView?.refreshFromBackend({ throwOnError: true });
					assertProjectTaskCurrent(version);
					await chatView?.refreshModels();
					assertProjectTaskCurrent(version);
					removeRuntimeKeys(oldRuntimeKeys.filter((key) => key !== activeSessionRuntimeKey));
					await applyWorkspacePane(workspace);
				},
				(err) => {
					console.error("Failed to switch project session:", err);
					chatView?.notify("Failed to switch project", "error");
				},
				{ label: "sidebar-project-select" },
			);
			return;
		}

		resetWorkspaceContentTabs(workspace, project);
		persistWorkspaces();
		syncWorkspaceTabsBar();
		syncContentTabsBar(workspace);
		syncActiveChatRuntimeBinding(workspace, { forceReset: true, statusText: "Starting new session…" });
		void applyWorkspacePane(workspace);

		void queueProjectTask(
			async (version) => {
				await ensureRpcForProject(project.path, version);
				assertProjectTaskCurrent(version);
				await chatView?.refreshFromBackend({ throwOnError: true });
				assertProjectTaskCurrent(version);
				await chatView?.refreshModels();
				assertProjectTaskCurrent(version);
				removeRuntimeKeys(oldRuntimeKeys.filter((key) => key !== activeSessionRuntimeKey));
				await applyWorkspacePane(workspace);
			},
			(err) => {
				console.error("Failed to switch project:", err);
				chatView?.notify("Failed to switch project", "error");
			},
			{ label: "sidebar-project-select" },
		);
	});

	sidebar.setOnNewSessionInProject((project) => {
		const workspace = getActiveWorkspace();
		if (!workspace) return;
		const sameProject = normalizeProjectPath(getWorkspaceActiveProjectPath(workspace)) === normalizeProjectPath(project.path);
		const oldRuntimeKeys = sameProject ? [] : listRuntimeKeysForWorkspace(workspace.id);
		const discardedSessionTabs = sameProject ? [] : [...workspace.sessionTabs];

		setWorkspaceActiveProject(workspace, project);
		if (sameProject) {
			pruneInactiveEphemeralSessionTabs(workspace);
			createAndActivateEmptySessionTab(workspace, NEW_SESSION_TAB_TITLE, project.id, project.path);
		} else {
			scheduleDiscardEphemeralSessionTabs(discardedSessionTabs);
			resetWorkspaceContentTabs(workspace, project);
		}
		persistWorkspaces();
		syncWorkspaceTabsBar();
		syncContentTabsBar(workspace);
		syncActiveChatRuntimeBinding(workspace, { forceReset: true, statusText: "Starting new session…" });
		void applyWorkspacePane(workspace);

		void queueProjectTask(
			async (version) => {
				await ensureRpcForProject(project.path, version);
				assertProjectTaskCurrent(version);
				await chatView?.refreshFromBackend({ throwOnError: true });
				assertProjectTaskCurrent(version);
				await chatView?.refreshModels();
				assertProjectTaskCurrent(version);
				removeRuntimeKeys(oldRuntimeKeys.filter((key) => key !== activeSessionRuntimeKey));
				await applyWorkspacePane(workspace);
			},
			(err) => {
				console.error("Failed to create project session:", err);
				chatView?.notify("Failed to create project session", "error");
			},
			{ label: "sidebar-new-session" },
		);
	});

	sidebar.setOnNewFileInProject((project) => {
		const workspace = getActiveWorkspace();
		if (!workspace) return;
		const switchingProject = normalizeProjectPath(getWorkspaceActiveProjectPath(workspace)) !== normalizeProjectPath(project.path);
		const oldRuntimeKeys = switchingProject ? listRuntimeKeysForWorkspace(workspace.id) : [];
		const discardedSessionTabs = switchingProject ? [...workspace.sessionTabs] : [];
		const draftDirectoryPath = normalizeStoredPath(project.directoryPath) ?? normalizeStoredPath(project.path);
		const draftAnchorPath = normalizeStoredPath(project.anchorPath);
		setWorkspaceActiveProject(workspace, project);
		if (switchingProject) {
			scheduleDiscardEphemeralSessionTabs(discardedSessionTabs);
			resetWorkspaceContentTabs(workspace, project);
		}
		createAndActivateEmptyFileTab(workspace, NEW_FILE_TAB_TITLE, project.id, project.path, draftDirectoryPath, draftAnchorPath);
		fileViewer?.setProjectPath(draftDirectoryPath ?? project.path);
		persistWorkspaces();
		syncWorkspaceTabsBar();
		syncContentTabsBar(workspace);
		void applyWorkspacePane(workspace);

		void queueProjectTask(
			async (version) => {
				await ensureRpcForProject(project.path, version);
				assertProjectTaskCurrent(version);
				removeRuntimeKeys(oldRuntimeKeys.filter((key) => key !== activeSessionRuntimeKey));
				await applyWorkspacePane(workspace);
			},
			(err) => {
				console.error("Failed to create draft file tab:", err);
				chatView?.notify("Failed to create new file tab", "error");
			},
			{ label: "sidebar-new-file" },
		);
	});

	const activateSidebarSession = (
		projectId: string,
		sessionPath: string,
		sessionName?: string,
		options?: { label?: string; onActivated?: () => void | Promise<void>; onFailed?: (err: unknown) => void },
	): void => {
		const workspace = getActiveWorkspace();
		const project = sidebar?.getProjectById(projectId);
		if (!workspace || !project) return;

		const switchingProject = normalizeProjectPath(getWorkspaceActiveProjectPath(workspace)) !== normalizeProjectPath(project.path);
		const oldRuntimeKeys = switchingProject ? listRuntimeKeysForWorkspace(workspace.id) : [];
		const discardedSessionTabs = switchingProject ? [...workspace.sessionTabs] : [];
		setWorkspaceActiveProject(workspace, project);
		if (switchingProject) {
			scheduleDiscardEphemeralSessionTabs(discardedSessionTabs);
			resetWorkspaceContentTabs(workspace, project);
		}

		const sessionTab = openOrActivateSessionTab(workspace, sessionPath, project.id, project.path, sessionName);
		pruneInactiveEphemeralSessionTabs(workspace, [sessionTab.id]);
		persistWorkspaces();
		syncWorkspaceTabsBar();
		syncContentTabsBar(workspace);
		syncActiveChatRuntimeBinding(workspace, { forceReset: true, statusText: "Loading session…" });
		void applyWorkspacePane(workspace);

		void queueProjectTask(
			async (version) => {
				await ensureRuntimeForSessionTab(workspace, sessionTab, project.path, true, version);
				assertProjectTaskCurrent(version);
				await chatView?.refreshFromBackend({ throwOnError: true });
				assertProjectTaskCurrent(version);
				await chatView?.refreshModels();
				assertProjectTaskCurrent(version);
				removeRuntimeKeys(oldRuntimeKeys.filter((key) => key !== activeSessionRuntimeKey));
				await applyWorkspacePane(workspace);
				if (options?.onActivated) {
					await options.onActivated();
				}
			},
			(err) => {
				console.error("Failed to switch session:", err);
				chatView?.notify("Failed to switch session", "error");
				options?.onFailed?.(err);
			},
			{ label: options?.label ?? "sidebar-session-select" },
		);
	};

	sidebar.setOnSessionSelect((projectId, sessionPath, sessionName) => {
		activateSidebarSession(projectId, sessionPath, sessionName, { label: "sidebar-session-select" });
	});

	sidebar.setOnSessionFork((projectId, sessionPath, sessionName) => {
		chatView?.openHistoryViewerForFork({ loading: true, sessionName });
		activateSidebarSession(projectId, sessionPath, sessionName, {
			label: "sidebar-session-fork",
			onActivated: () => {
				chatView?.openHistoryViewerForFork({ loading: false, sessionName });
			},
			onFailed: () => {
				chatView?.openHistoryViewerForFork({ loading: false, sessionName });
			},
		});
	});

	sidebar.setOnSessionMarkUnread((_projectId, sessionPath, _sessionName) => {
		const workspace = getActiveWorkspace();
		if (!workspace) return;
		ensureWorkspaceContentState(workspace);
		const normalizedTarget = normalizeSessionPath(sessionPath);
		const targetTab = workspace.sessionTabs.find((tab) => normalizeSessionPath(tab.sessionPath) === normalizedTarget) ?? null;
		if (!targetTab) {
			chatView?.notify("Open this session before marking unread", "info");
			return;
		}
		targetTab.needsAttention = true;
		targetTab.attentionMessage = pickSessionAttentionMessage(targetTab.attentionMessage);
		persistWorkspaces();
		syncContentTabsBar(workspace);
		syncSidebarSelectionFromWorkspace(workspace);
		chatView?.notify("Marked session as unread", "info");
	});

	sidebar.setOnSessionRename((projectId, sessionPath, _currentName, nextName) => {
		void renameSessionFromWorkspace(projectId, sessionPath, nextName);
	});

	sidebar.setOnSessionDelete((projectId, sessionPath) => {
		const workspace = getActiveWorkspace();
		const project = sidebar?.getProjectById(projectId);
		if (!workspace || !project) return;

		ensureWorkspaceContentState(workspace);
		const normalizedTarget = normalizeSessionPath(sessionPath);
		const removedIndices = workspace.sessionTabs
			.map((tab, index) => ({ tab, index }))
			.filter(({ tab }) => normalizeSessionPath(tab.sessionPath) === normalizedTarget)
			.map(({ index }) => index);

		if (removedIndices.length === 0) {
			scheduleSidebarSessionsRefresh(0);
			return;
		}

		const firstRemovedIndex = removedIndices[0];
		const removedTabs = workspace.sessionTabs.filter((tab) => normalizeSessionPath(tab.sessionPath) === normalizedTarget);
		const activeTab = workspace.sessionTabs.find((tab) => tab.id === workspace.activeSessionTabId) ?? null;
		const activeWasRemoved = Boolean(activeTab && normalizeSessionPath(activeTab.sessionPath) === normalizedTarget);

		workspace.sessionTabs = workspace.sessionTabs.filter((tab) => normalizeSessionPath(tab.sessionPath) !== normalizedTarget);

		let nextSession: WorkspaceSessionTab | null = null;

		if (workspace.sessionTabs.length === 0) {
			nextSession = createSessionTab(NEW_SESSION_TAB_TITLE, null, project.id, project.path);
			workspace.sessionTabs = [nextSession];
			workspace.activeSessionTabId = nextSession.id;
			workspace.sessionTitle = nextSession.title;
		} else if (activeWasRemoved) {
			nextSession = workspace.sessionTabs[firstRemovedIndex] ?? workspace.sessionTabs[firstRemovedIndex - 1] ?? workspace.sessionTabs[0] ?? null;
			workspace.activeSessionTabId = nextSession?.id ?? null;
			workspace.sessionTitle = nextSession?.title ?? NEW_SESSION_TAB_TITLE;
		} else {
			const stillActive = workspace.sessionTabs.find((tab) => tab.id === workspace.activeSessionTabId) ?? workspace.sessionTabs[0] ?? null;
			workspace.activeSessionTabId = stillActive?.id ?? null;
			workspace.sessionTitle = stillActive?.title ?? NEW_SESSION_TAB_TITLE;
		}

		ensureWorkspaceContentState(workspace);
		persistWorkspaces();
		syncWorkspaceTabsBar();
		syncContentTabsBar(workspace);
		scheduleSidebarSessionsRefresh(0);
		syncActiveChatRuntimeBinding(workspace, {
			forceReset: true,
			statusText: nextSession?.sessionPath ? "Loading session…" : "Starting new session…",
		});
		void applyWorkspacePane(workspace);

		const disposeRemovedRuntimes = () => {
			removedTabs.forEach((tab) => removeRuntimeForTab(workspace.id, tab.id));
		};

		if (!activeWasRemoved) {
			disposeRemovedRuntimes();
			void applyWorkspacePane(workspace);
			return;
		}

		sidebar?.setActiveSessionPath(nextSession?.sessionPath ?? null);

		const nextProjectPath = getSessionTabProjectPath(nextSession) ?? getWorkspaceActiveProjectPath(workspace);
		void queueProjectTask(
			async (version) => {
				if (nextSession && nextProjectPath) {
					await ensureRuntimeForSessionTab(workspace, nextSession, nextProjectPath, true, version);
					assertProjectTaskCurrent(version);
					await chatView?.refreshFromBackend({ throwOnError: true });
				}
				assertProjectTaskCurrent(version);
				disposeRemovedRuntimes();
				scheduleSidebarSessionsRefresh(0);
				await applyWorkspacePane(workspace);
			},
			(err) => {
				console.error("Failed to switch session after delete:", err);
				chatView?.notify("Failed to switch session after delete", "error");
			},
		);
	});

	sidebar.setOnFileDelete((projectId, filePath) => {
		const workspace = getActiveWorkspace();
		const project = sidebar?.getProjectById(projectId);
		if (!workspace || !project) return;

		ensureWorkspaceContentState(workspace);
		const normalizedTarget = normalizeProjectPath(filePath);
		const removedIndices = workspace.fileTabs
			.map((tab, index) => ({ tab, index }))
			.filter(({ tab }) => normalizeProjectPath(tab.path) === normalizedTarget)
			.map(({ index }) => index);

		if (removedIndices.length === 0) {
			if (normalizeProjectPath(workspace.filePath) === normalizedTarget) {
				workspace.filePath = null;
				workspace.activeFileTabId = null;
				if (workspace.pane === "file") workspace.pane = "chat";
				persistWorkspaces();
				syncWorkspaceTabsBar();
				syncContentTabsBar(workspace);
				void applyWorkspacePane(workspace);
			}
			return;
		}

		const firstRemovedIndex = removedIndices[0];
		const activeFileTab = workspace.fileTabs.find((tab) => tab.id === workspace.activeFileTabId) ?? null;
		const activeWasRemoved = Boolean(activeFileTab && normalizeProjectPath(activeFileTab.path) === normalizedTarget);
		workspace.fileTabs = workspace.fileTabs.filter((tab) => normalizeProjectPath(tab.path) !== normalizedTarget);

		if (workspace.fileTabs.length === 0) {
			workspace.activeFileTabId = null;
			workspace.filePath = null;
			if (workspace.pane === "file") workspace.pane = "chat";
		} else if (activeWasRemoved) {
			const nextFile = workspace.fileTabs[firstRemovedIndex] ?? workspace.fileTabs[firstRemovedIndex - 1] ?? workspace.fileTabs[0] ?? null;
			workspace.activeFileTabId = nextFile?.id ?? null;
			workspace.filePath = nextFile?.path ?? null;
		} else if (!workspace.fileTabs.some((tab) => tab.id === workspace.activeFileTabId)) {
			workspace.activeFileTabId = workspace.fileTabs[0]?.id ?? null;
			workspace.filePath = workspace.fileTabs[0]?.path ?? null;
		}

		ensureWorkspaceContentState(workspace);
		persistWorkspaces();
		syncWorkspaceTabsBar();
		syncContentTabsBar(workspace);
		void applyWorkspacePane(workspace);
	});

	sidebar.setOnFileOpen((projectId, filePath) => {
		const workspace = getActiveWorkspace();
		const project = sidebar?.getProjectById(projectId);
		if (!workspace || !project) return;

		const switchingProject = normalizeProjectPath(getWorkspaceActiveProjectPath(workspace)) !== normalizeProjectPath(project.path);
		const oldRuntimeKeys = switchingProject ? listRuntimeKeysForWorkspace(workspace.id) : [];
		setWorkspaceActiveProject(workspace, project);
		if (switchingProject) {
			resetWorkspaceContentTabs(workspace, project);
		}

		openOrActivateFileTab(workspace, filePath, project.id, project.path);
		persistWorkspaces();
		syncWorkspaceTabsBar();
		syncContentTabsBar(workspace);
		void applyWorkspacePane(workspace);

		void queueProjectTask(
			async (version) => {
				await ensureRpcForProject(project.path, version);
				assertProjectTaskCurrent(version);
				removeRuntimeKeys(oldRuntimeKeys.filter((key) => key !== activeSessionRuntimeKey));
				await applyWorkspacePane(workspace);
			},
			(err) => {
				console.error("Failed to open file:", err);
				chatView?.notify("Failed to open file", "error");
			},
		);
	});

	syncRunningSessionIndicators();
	ensureRunningSessionPoller();
	syncWorkspaceTabsBar();
	syncWorkspaceContextChrome(getActiveWorkspace());
}

function setupThemeSyncListeners(): void {
	const refreshThemeProjection = () => {
		const resolved = getResolvedDesktopTheme();
		const profiles = loadDesktopAppearanceProfiles();
		const workspace = getActiveWorkspace();
		const projectPath = workspace ? getWorkspaceActiveProjectPath(workspace) : null;
		void syncDesktopThemeWithPiTheme(projectPath).finally(() => {
			applyDesktopAppearanceProfileToRoot(resolved, profiles);
		});
	};
	window.addEventListener(DESKTOP_THEME_CHANGED_EVENT, refreshThemeProjection);
	window.addEventListener(DESKTOP_APPEARANCE_PROFILE_CHANGED_EVENT, refreshThemeProjection);
}

applyInitialTheme();
void applyNativeWindowVisualFixes();
setupThemeSyncListeners();
setupKeyboardShortcuts();
void initialize();
