const SMART_VOICE_NOTIFY_DIR = "pi-smart-voice-notify";
const SMART_VOICE_NOTIFY_CONFIG_FILE = "config.json";

function joinFsPath(base: string, child: string): string {
	const b = base.replace(/\\/g, "/").replace(/\/+$/, "");
	const c = child.replace(/\\/g, "/").replace(/^\/+/, "");
	return b ? `${b}/${c}` : c;
}

function isLikelyWindowsPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
	return platform.includes("win");
}

function normalizeJsonRecord(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// fall through
	}
	return {};
}

export interface SmartVoiceNotifyHostModeResult {
	path: string;
	updated: boolean;
	skipped: boolean;
	reason?: string;
	error?: string;
}

export async function ensureSmartVoiceNotifyDesktopHostMode(): Promise<SmartVoiceNotifyHostModeResult> {
	if (isLikelyWindowsPlatform()) {
		return {
			path: "",
			updated: false,
			skipped: true,
			reason: "windows-platform",
		};
	}

	try {
		const { homeDir } = await import("@tauri-apps/api/path");
		const { exists, mkdir, readTextFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
		const home = (await homeDir()).replace(/\\/g, "/").replace(/\/+$/, "");
		if (!home) {
			return {
				path: "",
				updated: false,
				skipped: true,
				error: "Could not resolve home directory",
			};
		}

		const extensionDir = joinFsPath(
			joinFsPath(joinFsPath(joinFsPath(home, ".pi"), "agent"), "extensions"),
			SMART_VOICE_NOTIFY_DIR,
		);
		const configPath = joinFsPath(extensionDir, SMART_VOICE_NOTIFY_CONFIG_FILE);

		await mkdir(extensionDir, { recursive: true });
		const hasConfig = await exists(configPath);
		const current = hasConfig ? normalizeJsonRecord(await readTextFile(configPath).catch(() => "{}")) : {};
		if (current.enableDesktopNotification === false) {
			return {
				path: configPath,
				updated: false,
				skipped: true,
				reason: "already-host-mode",
			};
		}

		const next = {
			...current,
			enableDesktopNotification: false,
		};
		await writeTextFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
		return {
			path: configPath,
			updated: true,
			skipped: false,
		};
	} catch (err) {
		return {
			path: "",
			updated: false,
			skipped: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
