import { html, nothing, type TemplateResult } from "lit";
import type { GitBranchEntry } from "../../git/branches.js";

interface GitSummaryLike {
	isRepo: boolean;
	branch: string | null;
	branchEntries: GitBranchEntry[];
	dirtyFiles: number;
	additions: number;
	deletions: number;
}

interface RenderGitRepoControlViewParams {
	summary: GitSummaryLike;
	creatingGitRepo: boolean;
	refreshingGitSummary: boolean;
	switchingGitBranch: boolean;
	fetchingGitRemotes: boolean;
	gitMenuOpen: boolean;
	gitBranchQuery: string;
	resolveGitBranchSelection: (query: string) => GitBranchEntry | null;
	gitIcon: () => TemplateResult;
	onCreateRepo: () => void | Promise<unknown>;
	onToggleMenu: () => void;
	onSetBranchQuery: (value: string) => void;
	onCreateAndCheckoutBranch: (value: string) => void | Promise<unknown>;
	onFetchRemotes: () => void | Promise<unknown>;
	onSwitchGitBranchEntry: (entry: GitBranchEntry) => void | Promise<unknown>;
}

export function renderGitRepoControlView({
	summary,
	creatingGitRepo,
	refreshingGitSummary,
	switchingGitBranch,
	fetchingGitRemotes,
	gitMenuOpen,
	gitBranchQuery,
	resolveGitBranchSelection,
	gitIcon,
	onCreateRepo,
	onToggleMenu,
	onSetBranchQuery,
	onCreateAndCheckoutBranch,
	onFetchRemotes,
	onSwitchGitBranchEntry,
}: RenderGitRepoControlViewParams): TemplateResult {
	if (!summary.isRepo) {
		return html`
			<button class="composer-repo-btn" ?disabled=${creatingGitRepo || refreshingGitSummary} @click=${() => void onCreateRepo()}>
				${gitIcon()}
				<span>${creatingGitRepo ? "Creating git repository…" : "Create git repository"}</span>
			</button>
		`;
	}

	const currentBranch = summary.branch || "detached";
	const query = gitBranchQuery.trim().toLowerCase();
	const branchEntries = summary.branchEntries.filter((entry) => {
		if (!query) return true;
		const haystack = `${entry.name} ${entry.fullName} ${entry.remote ?? ""} ${entry.scope}`.toLowerCase();
		return haystack.includes(query);
	});
	const filesLabel = summary.dirtyFiles === 1 ? "file" : "files";
	const matchingEntry = gitBranchQuery.trim().length > 0 ? resolveGitBranchSelection(gitBranchQuery) : null;
	const branchActionLabel = matchingEntry
		? matchingEntry.scope === "remote"
			? `Checkout ${matchingEntry.fullName}`
			: `Switch to ${matchingEntry.name}`
		: "Create and checkout new branch…";

	return html`
		<div class="git-branch-wrap">
			<button
				class="git-branch-pill ${gitMenuOpen ? "open" : ""}"
				title="Switch branch"
				?disabled=${switchingGitBranch || refreshingGitSummary || fetchingGitRemotes}
				@click=${(event: Event) => {
					event.stopPropagation();
					onToggleMenu();
				}}
			>
				${gitIcon()}
				<span class="git-branch-pill-name">${currentBranch}</span>
				<span class="git-branch-pill-caret">▾</span>
			</button>

			${gitMenuOpen
				? html`
					<div class="git-branch-menu" @click=${(event: Event) => event.stopPropagation()}>
						<label class="git-branch-search">
							<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.2"></circle><path d="M10.2 10.2l3 3"></path></svg>
							<input
								type="text"
								placeholder="Search branches or type a new name"
								.value=${gitBranchQuery}
								@input=${(event: Event) => onSetBranchQuery((event.target as HTMLInputElement).value)}
								@keydown=${(event: KeyboardEvent) => {
									if (event.key === "Enter") {
										event.preventDefault();
										void onCreateAndCheckoutBranch(gitBranchQuery);
									}
								}}
							/>
						</label>
						<div class="git-branch-menu-head">
							<div class="git-branch-menu-title">Branches</div>
							<button
								class="git-branch-fetch"
								?disabled=${fetchingGitRemotes || switchingGitBranch}
								@click=${() => void onFetchRemotes()}
							>
								${fetchingGitRemotes ? "Fetching…" : "Fetch"}
							</button>
						</div>
						<div class="git-branch-list">
							${branchEntries.length === 0
								? html`<div class="git-branch-empty">No branches found.</div>`
								: branchEntries.map((entry) => {
										const active = entry.scope === "local" && entry.name === currentBranch;
										const disabled = active || switchingGitBranch || fetchingGitRemotes;
										const label = entry.scope === "remote" ? entry.fullName : entry.name;
										return html`
											<button
												class="git-branch-item ${active ? "active" : ""}"
												?disabled=${disabled}
												@click=${() => void onSwitchGitBranchEntry(entry)}
											>
												<div class="git-branch-item-top">
													<span class="git-branch-item-icon">${gitIcon()}</span>
													<span class="git-branch-item-name">${label}</span>
													<span class="git-branch-item-trailing">
														${entry.scope === "remote" ? html`<span class="git-branch-item-badge">remote</span>` : nothing}
														${active ? html`<span class="git-branch-item-check">✓</span>` : nothing}
													</span>
												</div>
												${entry.scope === "remote"
													? html`<div class="git-branch-item-meta">Checkout tracking branch from ${entry.fullName}</div>`
													: active && summary.dirtyFiles > 0
														? html`
															<div class="git-branch-item-meta">
																Uncommitted: ${summary.dirtyFiles.toLocaleString()} ${filesLabel}
																<span class="git-delta plus">+${summary.additions.toLocaleString()}</span>
																<span class="git-delta minus">-${summary.deletions.toLocaleString()}</span>
															</div>
														`
														: nothing}
											</button>
										`;
								  })}
						</div>
						<button
							class="git-branch-create"
							?disabled=${switchingGitBranch || fetchingGitRemotes}
							@click=${() => void onCreateAndCheckoutBranch(gitBranchQuery)}
						>
							<span class="git-branch-create-plus">${matchingEntry ? "↩" : "＋"}</span>
							<span>${branchActionLabel}</span>
						</button>
					</div>
				`
				: nothing}
		</div>
	`;
}
