export type GitBranchScope = "local" | "remote";

export interface GitBranchEntry {
	name: string;
	fullName: string;
	scope: GitBranchScope;
	remote: string | null;
	isCurrent: boolean;
}

export interface GitBranchIndex {
	entries: GitBranchEntry[];
	localNames: string[];
	hasRemoteEntries: boolean;
}

interface RemoteBranchCandidate {
	name: string;
	fullName: string;
	remote: string;
}

function compareCaseInsensitive(a: string, b: string): number {
	return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function parseRemoteRef(ref: string): RemoteBranchCandidate | null {
	const rest = ref.slice("refs/remotes/".length).trim();
	if (!rest) return null;
	const slash = rest.indexOf("/");
	if (slash <= 0) return null;
	const remote = rest.slice(0, slash).trim();
	const name = rest.slice(slash + 1).trim();
	if (!remote || !name) return null;
	if (name === "HEAD") return null;
	return {
		name,
		fullName: `${remote}/${name}`,
		remote,
	};
}

function pickPreferredRemoteCandidate(candidates: RemoteBranchCandidate[]): RemoteBranchCandidate {
	const unique = new Map<string, RemoteBranchCandidate>();
	for (const candidate of candidates) {
		if (!unique.has(candidate.fullName)) unique.set(candidate.fullName, candidate);
	}
	const deduped = [...unique.values()];
	const origin = deduped.find((candidate) => candidate.remote === "origin");
	if (origin) return origin;
	deduped.sort((a, b) => {
		const byRemote = compareCaseInsensitive(a.remote, b.remote);
		if (byRemote !== 0) return byRemote;
		return compareCaseInsensitive(a.fullName, b.fullName);
	});
	return deduped[0]!;
}

export function buildGitBranchIndex(
	refs: string[],
	options: {
		currentBranch?: string | null;
		knownLocalBranches?: string[];
	} = {},
): GitBranchIndex {
	const currentBranch = options.currentBranch?.trim() || null;
	const localNames = new Set<string>();
	const remoteCandidatesByName = new Map<string, RemoteBranchCandidate[]>();

	if (currentBranch) {
		localNames.add(currentBranch);
	}

	for (const branch of options.knownLocalBranches ?? []) {
		const normalized = branch.trim();
		if (!normalized) continue;
		localNames.add(normalized);
	}

	for (const rawRef of refs) {
		const ref = rawRef.trim();
		if (!ref) continue;

		if (ref.startsWith("refs/heads/")) {
			const name = ref.slice("refs/heads/".length).trim();
			if (!name) continue;
			localNames.add(name);
			continue;
		}

		if (ref.startsWith("refs/remotes/")) {
			const remote = parseRemoteRef(ref);
			if (!remote) continue;
			const current = remoteCandidatesByName.get(remote.name) ?? [];
			current.push(remote);
			remoteCandidatesByName.set(remote.name, current);
		}
	}

	const entries: GitBranchEntry[] = [];

	const sortedLocalNames = [...localNames].sort(compareCaseInsensitive);
	for (const name of sortedLocalNames) {
		entries.push({
			name,
			fullName: name,
			scope: "local",
			remote: null,
			isCurrent: Boolean(currentBranch && currentBranch === name),
		});
	}

	for (const [name, candidates] of remoteCandidatesByName.entries()) {
		if (localNames.has(name)) continue;
		const preferred = pickPreferredRemoteCandidate(candidates);
		entries.push({
			name,
			fullName: preferred.fullName,
			scope: "remote",
			remote: preferred.remote,
			isCurrent: false,
		});
	}

	entries.sort((a, b) => {
		if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
		if (a.scope !== b.scope) return a.scope === "local" ? -1 : 1;
		const labelA = a.scope === "remote" ? a.fullName : a.name;
		const labelB = b.scope === "remote" ? b.fullName : b.name;
		return compareCaseInsensitive(labelA, labelB);
	});

	return {
		entries,
		localNames: entries.filter((entry) => entry.scope === "local").map((entry) => entry.name),
		hasRemoteEntries: entries.some((entry) => entry.scope === "remote"),
	};
}

export function findGitBranchEntryByQuery(query: string, entries: GitBranchEntry[]): GitBranchEntry | null {
	const normalized = query.trim();
	if (!normalized) return null;

	const exactLocalByName = entries.find((entry) => entry.scope === "local" && entry.name === normalized);
	if (exactLocalByName) return exactLocalByName;

	const exactByFullName = entries.find((entry) => entry.fullName === normalized);
	if (exactByFullName) return exactByFullName;

	const exactByName = entries.find((entry) => entry.name === normalized);
	if (exactByName) return exactByName;

	const needle = normalized.toLowerCase();
	const caseInsensitiveLocal = entries.find((entry) => entry.scope === "local" && entry.name.toLowerCase() === needle);
	if (caseInsensitiveLocal) return caseInsensitiveLocal;

	const caseInsensitiveByFullName = entries.find((entry) => entry.fullName.toLowerCase() === needle);
	if (caseInsensitiveByFullName) return caseInsensitiveByFullName;

	return entries.find((entry) => entry.name.toLowerCase() === needle) ?? null;
}
