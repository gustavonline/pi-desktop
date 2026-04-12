import { html, nothing, type TemplateResult } from "lit";

interface RenderComposerStatsViewParams {
	hover: boolean;
	refreshing: boolean;
	tooltip: string;
	ratioPercent: string;
	ringRadius: number;
	circumference: number;
	strokeOffset: number;
	statsLines: string[];
	onMouseEnter: () => void;
	onMouseLeave: () => void;
}

export function renderComposerStatsView({
	hover,
	refreshing,
	tooltip,
	ratioPercent,
	ringRadius,
	circumference,
	strokeOffset,
	statsLines,
	onMouseEnter,
	onMouseLeave,
}: RenderComposerStatsViewParams): TemplateResult {
	return html`
		<div class="composer-stats-slot">
			<div class="session-stats-wrap" @mouseenter=${onMouseEnter} @mouseleave=${onMouseLeave}>
				<div class="session-stats-inline">
					<button
						type="button"
						class="session-stats-ring ${refreshing ? "loading" : ""}"
						aria-label=${tooltip}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<circle class="session-stats-ring-track" cx="12" cy="12" r=${ringRadius}></circle>
							<circle
								class="session-stats-ring-progress"
								cx="12"
								cy="12"
								r=${ringRadius}
								style=${`stroke-dasharray:${circumference};stroke-dashoffset:${strokeOffset};`}
							></circle>
						</svg>
					</button>
					<span class="session-stats-percent">${ratioPercent}</span>
				</div>
				${hover
					? html`
						<div class="session-stats-popover">
							${statsLines.length > 0
								? statsLines.map((line) => html`<div>${line}</div>`)
								: html`<div>Session stats unavailable</div>`}
						</div>
					`
					: nothing}
			</div>
		</div>
	`;
}
