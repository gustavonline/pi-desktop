const DESKTOP_COMPAT_EXTENSION_FILE = "pi-desktop-sdk-compat.ts";
const DESKTOP_COMPAT_EXTENSION_MARKER = "pi-desktop-sdk-compat-extension/v1";

const DESKTOP_COMPAT_EXTENSION_CONTENT = `/**
 * ${DESKTOP_COMPAT_EXTENSION_MARKER}
 *
 * Compatibility shim for extensions that still call
 *   ctx.modelRegistry.getApiKey(model)
 * against runtimes that now expose getApiKeyAndHeaders(model).
 *
 * Safe behavior:
 * - no-op if getApiKey already exists
 * - no-op if getApiKeyAndHeaders is unavailable
 * - returns undefined on resolution failure
 */
export default function (pi) {
\tconst ensureModelRegistryGetApiKeyCompat = (_event, ctx) => {
\t\tconst registry = ctx?.modelRegistry;
\t\tif (!registry || typeof registry !== "object") return;
\t\tif (typeof registry.getApiKey === "function") return;
\t\tconst resolver = registry.getApiKeyAndHeaders;
\t\tif (typeof resolver !== "function") return;
\n\t\tregistry.getApiKey = async (model) => {
\t\t\ttry {
\t\t\t\tconst resolved = await resolver.call(registry, model);
\t\t\t\tif (resolved && typeof resolved === "object" && resolved.ok === true) {
\t\t\t\t\tconst apiKey = resolved.apiKey;
\t\t\t\t\tif (typeof apiKey === "string" && apiKey.trim().length > 0) {
\t\t\t\t\t\treturn apiKey;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t} catch {
\t\t\t\t// no-op: keep compatibility shim non-fatal
\t\t\t}
\t\t\treturn undefined;
\t\t};
\t};
\n\tpi.on("session_start", ensureModelRegistryGetApiKeyCompat);
\tpi.on("before_agent_start", ensureModelRegistryGetApiKeyCompat);
\tpi.on("agent_start", ensureModelRegistryGetApiKeyCompat);
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

export interface DesktopCompatExtensionInstallResult {
	path: string;
	created: boolean;
	updated: boolean;
	skipped: boolean;
	error?: string;
}

export async function ensureDesktopSdkCompatExtensionInstalled(): Promise<DesktopCompatExtensionInstallResult> {
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

	const extensionPath = joinFsPath(root, DESKTOP_COMPAT_EXTENSION_FILE);

	try {
		const { exists, mkdir, readTextFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
		await mkdir(root, { recursive: true });

		const hasExisting = await exists(extensionPath);
		const existingContent = hasExisting ? await readTextFile(extensionPath).catch(() => "") : "";

		const normalizedExisting = existingContent.replace(/\r\n/g, "\n").trim();
		const normalizedTarget = DESKTOP_COMPAT_EXTENSION_CONTENT.trim();
		if (normalizedExisting === normalizedTarget) {
			return {
				path: extensionPath,
				created: false,
				updated: false,
				skipped: false,
			};
		}

		if (hasExisting && normalizedExisting.length > 0 && !existingContent.includes(DESKTOP_COMPAT_EXTENSION_MARKER)) {
			return {
				path: extensionPath,
				created: false,
				updated: false,
				skipped: true,
				error: `Skipped writing compatibility extension because ${DESKTOP_COMPAT_EXTENSION_FILE} is user-managed.`,
			};
		}

		await writeTextFile(extensionPath, DESKTOP_COMPAT_EXTENSION_CONTENT);
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
