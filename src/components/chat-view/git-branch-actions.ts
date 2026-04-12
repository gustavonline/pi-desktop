import type { GitBranchEntry } from "../../git/branches.js";

type NoticeKind = "info" | "success" | "error";

interface GitCommandResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

interface GitActionContextBase {
	isSwitchingGitBranch: () => boolean;
	setSwitchingGitBranch: (next: boolean) => void;
	render: () => void;
	closeGitMenu: () => void;
	pushNotice: (text: string, kind: NoticeKind) => void;
	runGit: (args: string[]) => Promise<GitCommandResult>;
	hasGitHeadCommit: () => Promise<boolean>;
	switchUnbornHeadBranch: (branch: string) => Promise<{ ok: boolean; error: string }>;
	refreshGitSummary: (force?: boolean) => Promise<void>;
}

interface SwitchGitBranchActionParams extends GitActionContextBase {
	branch: string;
	currentBranch: string;
}

interface SwitchRemoteTrackingBranchActionParams extends GitActionContextBase {
	entry: GitBranchEntry;
	branches: string[];
	switchGitBranch: (branch: string) => Promise<void>;
}

interface FetchGitRemotesActionParams {
	isRepo: boolean;
	fetchingGitRemotes: boolean;
	isSwitchingGitBranch: () => boolean;
	setFetchingGitRemotes: (next: boolean) => void;
	render: () => void;
	pushNotice: (text: string, kind: NoticeKind) => void;
	runGit: (args: string[]) => Promise<GitCommandResult>;
	refreshGitSummary: (force?: boolean) => Promise<void>;
}

interface CreateAndCheckoutBranchActionParams extends GitActionContextBase {
	rawName?: string;
	gitBranchQuery: string;
	resolveGitBranchSelection: (query: string) => GitBranchEntry | null;
	switchGitBranchEntry: (entry: GitBranchEntry) => Promise<void>;
}

export async function switchGitBranchAction({
	branch,
	currentBranch,
	isSwitchingGitBranch,
	setSwitchingGitBranch,
	render,
	closeGitMenu,
	pushNotice,
	runGit,
	hasGitHeadCommit,
	switchUnbornHeadBranch,
	refreshGitSummary,
}: SwitchGitBranchActionParams): Promise<void> {
	if (!branch || isSwitchingGitBranch()) return;
	if (branch === currentBranch) {
		closeGitMenu();
		render();
		return;
	}

	setSwitchingGitBranch(true);
	render();
	try {
		const hasCommit = await hasGitHeadCommit();
		if (!hasCommit) {
			const switched = await switchUnbornHeadBranch(branch);
			if (!switched.ok) {
				pushNotice(switched.error || `Failed to switch branch: ${branch}`, "error");
				return;
			}
			closeGitMenu();
			pushNotice(`Switched to ${branch}`, "success");
			await refreshGitSummary(true);
			return;
		}

		let result = await runGit(["switch", branch]);
		if (result.exitCode !== 0) {
			result = await runGit(["checkout", branch]);
		}
		if (result.exitCode !== 0) {
			pushNotice(result.stderr.trim() || result.stdout.trim() || `Failed to switch branch: ${branch}`, "error");
			return;
		}
		closeGitMenu();
		pushNotice(`Switched to ${branch}`, "success");
		await refreshGitSummary(true);
	} catch (err) {
		console.error("Failed to switch branch:", err);
		pushNotice("Failed to switch branch", "error");
	} finally {
		setSwitchingGitBranch(false);
		render();
	}
}

export async function switchRemoteTrackingBranchAction({
	entry,
	branches,
	switchGitBranch,
	isSwitchingGitBranch,
	setSwitchingGitBranch,
	render,
	closeGitMenu,
	pushNotice,
	runGit,
	refreshGitSummary,
}: SwitchRemoteTrackingBranchActionParams): Promise<void> {
	if (isSwitchingGitBranch()) return;
	const localBranch = entry.name.trim();
	const remoteRef = entry.fullName.trim();
	if (!localBranch || !remoteRef) return;
	if (branches.includes(localBranch)) {
		await switchGitBranch(localBranch);
		return;
	}

	setSwitchingGitBranch(true);
	render();
	try {
		let result = await runGit(["switch", "--track", "-c", localBranch, remoteRef]);
		if (result.exitCode !== 0) {
			result = await runGit(["checkout", "--track", "-b", localBranch, remoteRef]);
		}
		if (result.exitCode !== 0) {
			const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
			if (message.includes("already exists")) {
				await switchGitBranch(localBranch);
				return;
			}
			let fallback = await runGit(["switch", "--track", remoteRef]);
			if (fallback.exitCode !== 0) {
				fallback = await runGit(["checkout", "--track", remoteRef]);
			}
			if (fallback.exitCode === 0) {
				closeGitMenu();
				pushNotice(`Switched to ${localBranch} (tracking ${remoteRef})`, "success");
				await refreshGitSummary(true);
				return;
			}
			pushNotice(result.stderr.trim() || result.stdout.trim() || `Failed to switch branch: ${remoteRef}`, "error");
			return;
		}
		closeGitMenu();
		pushNotice(`Switched to ${localBranch} (tracking ${remoteRef})`, "success");
		await refreshGitSummary(true);
	} catch (err) {
		console.error("Failed to switch remote branch:", err);
		pushNotice("Failed to switch remote branch", "error");
	} finally {
		setSwitchingGitBranch(false);
		render();
	}
}

export async function fetchGitRemotesAction({
	isRepo,
	fetchingGitRemotes,
	isSwitchingGitBranch,
	setFetchingGitRemotes,
	render,
	pushNotice,
	runGit,
	refreshGitSummary,
}: FetchGitRemotesActionParams): Promise<void> {
	if (!isRepo || fetchingGitRemotes || isSwitchingGitBranch()) return;
	setFetchingGitRemotes(true);
	render();
	try {
		const result = await runGit(["fetch", "--all", "--prune"]);
		if (result.exitCode !== 0) {
			pushNotice(result.stderr.trim() || result.stdout.trim() || "Failed to fetch remotes", "error");
			return;
		}
		pushNotice("Fetched remote branches", "success");
		await refreshGitSummary(true);
	} catch (err) {
		console.error("Failed to fetch remotes:", err);
		pushNotice("Failed to fetch remotes", "error");
	} finally {
		setFetchingGitRemotes(false);
		render();
	}
}

export async function createAndCheckoutBranchAction({
	rawName = "",
	gitBranchQuery,
	resolveGitBranchSelection,
	switchGitBranchEntry,
	isSwitchingGitBranch,
	setSwitchingGitBranch,
	render,
	closeGitMenu,
	pushNotice,
	runGit,
	hasGitHeadCommit,
	switchUnbornHeadBranch,
	refreshGitSummary,
}: CreateAndCheckoutBranchActionParams): Promise<void> {
	if (isSwitchingGitBranch()) return;

	let proposed = rawName.trim();
	if (!proposed) {
		const prompted = window.prompt("Branch name", gitBranchQuery.trim()) ?? "";
		proposed = prompted.trim();
	}
	if (!proposed) {
		pushNotice("Enter a branch name first", "info");
		return;
	}
	const existingBranch = resolveGitBranchSelection(proposed);
	if (existingBranch) {
		await switchGitBranchEntry(existingBranch);
		return;
	}

	if (!/^[A-Za-z0-9._\/-]+$/.test(proposed)) {
		pushNotice("Use letters, numbers, ., _, -, / for branch names", "error");
		return;
	}

	const refCheck = await runGit(["check-ref-format", "--branch", proposed]);
	if (refCheck.exitCode !== 0) {
		pushNotice(refCheck.stderr.trim() || refCheck.stdout.trim() || "Invalid branch name", "error");
		return;
	}

	setSwitchingGitBranch(true);
	render();
	try {
		const hasCommit = await hasGitHeadCommit();
		if (!hasCommit) {
			const switched = await switchUnbornHeadBranch(proposed);
			if (!switched.ok) {
				pushNotice(switched.error || "Failed to create branch", "error");
				return;
			}
			closeGitMenu();
			pushNotice(`Created and switched to ${proposed}`, "success");
			await refreshGitSummary(true);
			return;
		}

		let result = await runGit(["switch", "-c", proposed]);
		if (result.exitCode !== 0) {
			result = await runGit(["checkout", "-b", proposed]);
		}
		if (result.exitCode !== 0) {
			const message = `${result.stderr}\n${result.stdout}`.toLowerCase();
			if (message.includes("already exists")) {
				let switchExisting = await runGit(["switch", proposed]);
				if (switchExisting.exitCode !== 0) {
					switchExisting = await runGit(["checkout", proposed]);
				}
				if (switchExisting.exitCode === 0) {
					closeGitMenu();
					pushNotice(`Switched to ${proposed}`, "success");
					await refreshGitSummary(true);
					return;
				}
			}

			const branchOnly = await runGit(["branch", proposed]);
			if (branchOnly.exitCode === 0) {
				let switchToCreated = await runGit(["switch", proposed]);
				if (switchToCreated.exitCode !== 0) {
					switchToCreated = await runGit(["checkout", proposed]);
				}
				if (switchToCreated.exitCode === 0) {
					closeGitMenu();
					pushNotice(`Created and switched to ${proposed}`, "success");
					await refreshGitSummary(true);
					return;
				}
			}

			pushNotice(result.stderr.trim() || result.stdout.trim() || "Failed to create branch", "error");
			return;
		}
		closeGitMenu();
		pushNotice(`Created and switched to ${proposed}`, "success");
		await refreshGitSummary(true);
	} catch (err) {
		console.error("Failed to create branch:", err);
		pushNotice("Failed to create branch", "error");
	} finally {
		setSwitchingGitBranch(false);
		render();
	}
}
