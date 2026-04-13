import { html, nothing, type TemplateResult } from "lit";
import type { SlashPaletteItem } from "../../commands/slash-command-runtime.js";

interface RenderSlashPaletteViewParams {
	open: boolean;
	loading: boolean;
	query: string;
	items: SlashPaletteItem[];
	activeIndex: number;
	navigationMode: "pointer" | "keyboard";
	onMouseMove: (event: MouseEvent) => void;
	onSelect: (item: SlashPaletteItem) => void;
}

export function renderSlashPaletteView({
	open,
	loading,
	query,
	items,
	activeIndex,
	navigationMode,
	onMouseMove,
	onSelect,
}: RenderSlashPaletteViewParams): TemplateResult | typeof nothing {
	if (!open) return nothing;
	if (loading && items.length === 0) {
		return html`<div class="composer-slash-menu"><div class="composer-slash-empty">Loading commands…</div></div>`;
	}
	if (items.length === 0) {
		return html`<div class="composer-slash-menu"><div class="composer-slash-empty">No commands match “/${query}”.</div></div>`;
	}

	const boundedActiveIndex = Math.max(0, Math.min(activeIndex, items.length - 1));
	let currentSection: SlashPaletteItem["section"] | null = null;

	return html`
		<div
			class="composer-slash-menu ${navigationMode === "keyboard" ? "keyboard-nav" : ""}"
			@mousemove=${onMouseMove}
		>
			${items.map((item, index) => {
				const sectionChanged = item.section !== currentSection;
				currentSection = item.section;
				return html`
					${sectionChanged ? html`<div class="composer-slash-section">${item.section}</div>` : nothing}
					<button
						class="composer-slash-item ${index === boundedActiveIndex ? "active" : ""}"
						data-index=${String(index)}
						@click=${() => onSelect(item)}
					>
						<span class="composer-slash-item-main">
							<span class="composer-slash-item-label">${item.label}</span>
							<span class="composer-slash-item-hint">${item.hint}</span>
						</span>
					</button>
				`;
			})}
		</div>
	`;
}
