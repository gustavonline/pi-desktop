interface CliUpdateStatus {
	current_version?: string | null;
	latest_version?: string | null;
	update_available?: boolean;
}

interface DirEntry {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
	isSymlink: boolean;
}

export interface WelcomeDashboardInventory {
	skills: string[];
	extensions: string[];
	themes: string[];
	currentCliVersion: string | null;
	latestCliVersion: string | null;
	updateAvailable: boolean;
}

function joinFsPath(base: string, child: string): string {
	const separator = base.includes("\\") ? "\\" : "/";
	const normalizedBase = base.replace(/[\\/]+$/, "");
	return `${normalizedBase}${separator}${child}`;
}

async function readDirSafe(path: string): Promise<DirEntry[]> {
	try {
		const { exists, readDir } = await import("@tauri-apps/plugin-fs");
		if (!(await exists(path))) return [];
		return await readDir(path);
	} catch {
		return [];
	}
}

async function collectSkillNames(skillsRoot: string): Promise<string[]> {
	const names = new Set<string>();
	const queue: Array<{ path: string; depth: number }> = [{ path: skillsRoot, depth: 0 }];

	while (queue.length > 0) {
		const next = queue.shift();
		if (!next) continue;
		if (next.depth > 5) continue;
		const entries = await readDirSafe(next.path);
		for (const entry of entries) {
			const fullPath = joinFsPath(next.path, entry.name);
			if (entry.isDirectory) {
				queue.push({ path: fullPath, depth: next.depth + 1 });
				continue;
			}
			if (entry.isFile && entry.name.toLowerCase() === "skill.md") {
				const parts = next.path.replace(/\\/g, "/").split("/");
				names.add(parts[parts.length - 1] || next.path);
			}
		}
	}

	return [...names].sort((a, b) => a.localeCompare(b));
}

async function collectExtensionNames(extensionsRoot: string): Promise<string[]> {
	const names = new Set<string>();
	const queue: Array<{ path: string; depth: number }> = [{ path: extensionsRoot, depth: 0 }];

	while (queue.length > 0) {
		const next = queue.shift();
		if (!next) continue;
		if (next.depth > 2) continue;
		const entries = await readDirSafe(next.path);
		for (const entry of entries) {
			const fullPath = joinFsPath(next.path, entry.name);
			if (entry.isDirectory) {
				if (next.depth > 0) names.add(entry.name);
				queue.push({ path: fullPath, depth: next.depth + 1 });
				continue;
			}
			if (entry.isFile && entry.name.toLowerCase().endsWith(".json")) {
				names.add(entry.name.replace(/\.json$/i, ""));
			}
		}
	}

	return [...names].sort((a, b) => a.localeCompare(b));
}

async function collectThemeNames(themesRoot: string): Promise<string[]> {
	const entries = await readDirSafe(themesRoot);
	return entries
		.filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".json"))
		.map((entry) => entry.name.replace(/\.json$/i, ""))
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));
}

export async function loadWelcomeDashboardInventory(
	fetchCliUpdateStatus: () => Promise<CliUpdateStatus>,
): Promise<WelcomeDashboardInventory> {
	const { homeDir } = await import("@tauri-apps/api/path");
	const home = await homeDir();
	const agentRoot = joinFsPath(joinFsPath(home, ".pi"), "agent");
	const skillsRoot = joinFsPath(agentRoot, "skills");
	const extensionsRoot = joinFsPath(agentRoot, "extensions");
	const themesRoot = joinFsPath(agentRoot, "themes");

	const [skills, extensions, themes] = await Promise.all([
		collectSkillNames(skillsRoot),
		collectExtensionNames(extensionsRoot),
		collectThemeNames(themesRoot),
	]);

	let currentCliVersion: string | null = null;
	let latestCliVersion: string | null = null;
	let updateAvailable = false;
	try {
		const cliStatus = await fetchCliUpdateStatus();
		currentCliVersion = cliStatus.current_version ?? null;
		latestCliVersion = cliStatus.latest_version ?? null;
		updateAvailable = Boolean(cliStatus.update_available);
	} catch {
		// Ignore status fetch errors for welcome state.
	}

	return {
		skills,
		extensions,
		themes,
		currentCliVersion,
		latestCliVersion,
		updateAvailable,
	};
}
