const DESKTOP_NOTIFY_BRIDGE_EXTENSION_FILE = "pi-desktop-notify-bridge.ts";
const DESKTOP_NOTIFY_BRIDGE_MARKER = "pi-desktop-notify-bridge-extension/v1";

const DESKTOP_NOTIFY_BRIDGE_CONTENT = `/**
 * ${DESKTOP_NOTIFY_BRIDGE_MARKER}
 *
 * Minimal capability-native desktop notification bridge for Pi Desktop.
 *
 * Why this exists:
 * - Extensions should use ctx.ui.notify(...) for host-native delivery.
 * - Desktop host applies focus/background gating + deep-link metadata.
 *
 * This bridge emits one notify on agent_end:
 * - success => info
 * - run with error => error
 */
export default function (pi) {
\tconst MIN_INTERVAL_MS = 2000;
\tlet lastNotifyAt = 0;
\tlet runHadError = false;

\tconst shouldNotifyNow = () => {
\t\tconst now = Date.now();
\t\tif (now - lastNotifyAt < MIN_INTERVAL_MS) return false;
\t\tlastNotifyAt = now;
\t\treturn true;
\t};

\tconst notify = (ctx, message, kind = "info") => {
\t\tif (!ctx || !ctx.hasUI || !ctx.ui || typeof ctx.ui.notify !== "function") return;
\t\tif (!shouldNotifyNow()) return;
\t\tctx.ui.notify(message, kind);
\t};

\tconst resetRunState = () => {
\t\trunHadError = false;
\t};

\tpi.on("session_start", resetRunState);
\tpi.on("session_switch", resetRunState);
\tpi.on("agent_start", resetRunState);
\tpi.on("error", () => {
\t\trunHadError = true;
\t});
\tpi.on("agent_end", (_event, ctx) => {
\t\tif (runHadError) {
\t\t\tnotify(ctx, "Agent run ended with an error.", "error");
\t\t} else {
\t\t\tnotify(ctx, "Agent finished its current task.", "info");
\t\t}
\t\tresetRunState();
\t});
}
`;

function joinFsPath(base: string, child: string): string {
	const b = base.replace(/\\/g, "/").replace(/\/+$/, "");
	const c = child.replace(/\\/g, "/").replace(/^\/+/, "");
	return b ? `${b}/${c}` : c;
}

async function resolveGlobalExtensionsRoot(): Promise<string | null> {
	const { homeDir } = await import("@tauri-apps/api/path");
	const home = (await homeDir()).replace(/\\/g, "/").replace(/\/+$/, "");
	if (!home) return null;
	return joinFsPath(joinFsPath(joinFsPath(home, ".pi"), "agent"), "extensions");
}

export interface DesktopNotifyBridgeInstallResult {
	path: string;
	created: boolean;
	updated: boolean;
	skipped: boolean;
	error?: string;
}

export async function ensureDesktopNotifyBridgeExtensionInstalled(): Promise<DesktopNotifyBridgeInstallResult> {
	const root = await resolveGlobalExtensionsRoot();
	if (!root) {
		return {
			path: "",
			created: false,
			updated: false,
			skipped: true,
			error: "Could not resolve home directory",
		};
	}

	const extensionPath = joinFsPath(root, DESKTOP_NOTIFY_BRIDGE_EXTENSION_FILE);

	try {
		const { exists, mkdir, readTextFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
		await mkdir(root, { recursive: true });

		const hasExisting = await exists(extensionPath);
		const existingContent = hasExisting ? await readTextFile(extensionPath).catch(() => "") : "";

		const normalizedExisting = existingContent.replace(/\r\n/g, "\n").trim();
		const normalizedTarget = DESKTOP_NOTIFY_BRIDGE_CONTENT.trim();
		if (normalizedExisting === normalizedTarget) {
			return {
				path: extensionPath,
				created: false,
				updated: false,
				skipped: false,
			};
		}

		if (hasExisting && normalizedExisting.length > 0 && !existingContent.includes(DESKTOP_NOTIFY_BRIDGE_MARKER)) {
			return {
				path: extensionPath,
				created: false,
				updated: false,
				skipped: true,
				error: `Skipped writing notify bridge extension because ${DESKTOP_NOTIFY_BRIDGE_EXTENSION_FILE} is user-managed.`,
			};
		}

		await writeTextFile(extensionPath, DESKTOP_NOTIFY_BRIDGE_CONTENT);
		return {
			path: extensionPath,
			created: !hasExisting,
			updated: hasExisting,
			skipped: false,
		};
	} catch (err) {
		return {
			path: extensionPath,
			created: false,
			updated: false,
			skipped: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
