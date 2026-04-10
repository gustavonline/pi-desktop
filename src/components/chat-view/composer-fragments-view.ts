import { html, nothing, type TemplateResult } from "lit";

export interface QueuedComposerMessageView {
	text: string;
	imageCount: number;
}

export interface PendingComposerImageView {
	id: string;
	name: string;
	path?: string;
	size: number;
	previewUrl: string;
}

export interface ComposerSkillDraftView {
	name: string;
}

export function renderQueuedComposerMessagesView(
	messages: QueuedComposerMessageView[],
	truncateText: (value: string, len: number) => string,
): TemplateResult | typeof nothing {
	if (messages.length === 0) return nothing;
	const recent = messages.slice(-2);
	return html`
		<div class="composer-queued-row" aria-live="polite">
			${recent.map(
				(entry) => html`
					<div class="composer-queued-pill" title=${entry.text}>
						<span class="composer-queued-label">Queued</span>
						<span class="composer-queued-text">${truncateText(entry.text.replace(/\s+/g, " "), 72)}</span>
						${entry.imageCount > 0 ? html`<span class="composer-queued-meta">+${entry.imageCount} image${entry.imageCount === 1 ? "" : "s"}</span>` : nothing}
					</div>
				`,
			)}
		</div>
	`;
}

export function renderPendingImagesView(
	images: PendingComposerImageView[],
	truncateText: (value: string, len: number) => string,
	onRemoveImage: (id: string) => void,
): TemplateResult | typeof nothing {
	if (images.length === 0) return nothing;
	return html`
		<div class="composer-attachments inline" aria-label="Image attachments">
			${images.map(
				(img) => html`
					<div class="composer-attachment" title=${img.path || img.name}>
						<img class="composer-attachment-thumb" src=${img.previewUrl} alt=${img.name} />
						<span class="composer-attachment-name">${truncateText(img.name, 16)}</span>
						<button class="composer-attachment-remove" title="Remove image" @click=${() => onRemoveImage(img.id)}>✕</button>
					</div>
				`,
			)}
		</div>
	`;
}

export function renderComposerSkillDraftPillView(
	draft: ComposerSkillDraftView | null,
	skillIcon: TemplateResult,
	onRemoveDraft: () => void,
): TemplateResult | typeof nothing {
	if (!draft) return nothing;
	return html`
		<div class="composer-skill-draft-pill inline">
			<span class="composer-skill-draft-icon" aria-hidden="true">${skillIcon}</span>
			<span class="composer-skill-draft-name">${draft.name}</span>
			<button class="composer-skill-draft-remove" title="Remove skill" @click=${onRemoveDraft}>✕</button>
		</div>
	`;
}
