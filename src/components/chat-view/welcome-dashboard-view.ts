import { html, nothing, type TemplateResult } from "lit";

interface WelcomeDashboardSnapshotViewModel {
	loading: boolean;
	skills: string[];
	extensions: string[];
	themes: string[];
	error: string | null;
}

interface WelcomeProjectViewModel {
	id: string;
	name: string;
}

interface RenderCenteredWelcomeViewParams {
	brandIconUrl: string;
	welcomeHeadline: string;
	projectLabel: string;
	hasProject: boolean;
	projectMenuOpen: boolean;
	projects: WelcomeProjectViewModel[];
	activeProjectId: string | null;
	snapshot: WelcomeDashboardSnapshotViewModel;
	onToggleProjectMenu: () => void;
	onSelectProject: (projectId: string) => void;
	onAddProject: () => void;
	onOpenPackages: () => void;
	onOpenSettings: () => void;
}

export function renderCenteredWelcomeView({
	brandIconUrl,
	welcomeHeadline,
	projectLabel,
	hasProject,
	projectMenuOpen,
	projects,
	activeProjectId,
	snapshot,
	onToggleProjectMenu,
	onSelectProject,
	onAddProject,
	onOpenPackages,
	onOpenSettings,
}: RenderCenteredWelcomeViewParams): TemplateResult {
	return html`
		<div class="welcome-dashboard welcome-dashboard-minimal">
			<div class="welcome-brand-lockup" aria-hidden="true">
				<div class="welcome-brand-mark"><img src=${brandIconUrl} alt="Pi Desktop" /></div>
			</div>
			<h2>${welcomeHeadline}</h2>
			<div class="welcome-project-wrap">
				<button class="welcome-project-trigger ${hasProject ? "active" : ""}" @click=${onToggleProjectMenu}>
					<span>${projectLabel}</span>
					<span class="welcome-project-caret ${projectMenuOpen ? "open" : ""}">⌄</span>
				</button>
				${projectMenuOpen
					? html`
						<div class="welcome-project-menu">
							${projects.map((project) => {
								const isCurrent = project.id === activeProjectId;
								return html`
									<button class="welcome-project-item ${isCurrent ? "current" : ""}" @click=${() => onSelectProject(project.id)}>
										<span>${project.name}</span>
										<span>${isCurrent ? "✓" : ""}</span>
									</button>
								`;
							})}
							${projects.length > 0 ? html`<div class="welcome-project-sep"></div>` : nothing}
							<button class="welcome-project-item" @click=${onAddProject}>Add new project</button>
							<div class="welcome-project-sep"></div>
							<button class="welcome-project-item" @click=${onOpenPackages}>Packages</button>
							<button class="welcome-project-item" @click=${onOpenSettings}>Settings</button>
						</div>
					`
					: nothing}
			</div>
			<div class="welcome-meta-line muted ${projectMenuOpen ? "hidden" : ""}">
				${snapshot.loading
					? "Refreshing local Pi inventory…"
					: `${snapshot.skills.length} skills · ${snapshot.extensions.length} extensions · ${snapshot.themes.length} themes`}
			</div>
			${snapshot.error ? html`<div class="welcome-error">${snapshot.error}</div>` : nothing}
		</div>
	`;
}
