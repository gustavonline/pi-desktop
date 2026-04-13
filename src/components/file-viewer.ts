/**
 * FileViewer - lightweight file surface (view + basic edit + draft create)
 */

import "@mariozechner/mini-lit/dist/CodeBlock.js";
import "@mariozechner/mini-lit/dist/MarkdownBlock.js";
import { invoke } from "@tauri-apps/api/core";
import { html, nothing, render } from "lit";

type FileViewMode = "rendered" | "raw";

const DEFAULT_DRAFT_NAME = "New file";
const AUTO_SAVE_DELAY_MS = 200;

function truncatePath(path: string, max = 140): string {
	if (path.length <= max) return path;
	return `…${path.slice(path.length - max + 1)}`;
}

function fileExtension(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const base = normalized.split("/").pop() || normalized;
	const idx = base.lastIndexOf(".");
	if (idx === -1) return "";
	return base.slice(idx + 1).toLowerCase();
}

function pathBaseName(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/");
	return parts[parts.length - 1] || normalized;
}

function pathDirName(path: string): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const idx = normalized.lastIndexOf("/");
	if (idx === -1) return "";
	if (idx === 0) return "/";
	return normalized.slice(0, idx);
}

function isMarkdownPath(path: string | null): boolean {
	if (!path) return false;
	return ["md", "markdown", "mdown", "mkdn", "mdx"].includes(fileExtension(path));
}

function joinFsPath(base: string, name: string): string {
	const sep = base.includes("\\") ? "\\" : "/";
	const normalizedBase = base.replace(/[\\/]+$/, "");
	return `${normalizedBase}${sep}${name}`;
}

export class FileViewer {
	private container: HTMLElement;
	private filePath: string | null = null;
	private projectPath: string | null = null;
	private draftId: string | null = null;
	private draftName = DEFAULT_DRAFT_NAME;

	private content = "";
	private editorText = "";
	private loading = false;
	private saving = false;
	private dirty = false;
	private error = "";
	private viewMode: FileViewMode = "raw";
	private openingExternal = false;
	private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	private onDraftFileCreated: ((filePath: string) => void) | null = null;
	private onClose: (() => void) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.render();
	}

	setProjectPath(projectPath: string | null): void {
		if (this.projectPath === projectPath) return;
		this.projectPath = projectPath;
		if (this.draftId) {
			this.render();
		}
	}

	setOnDraftFileCreated(cb: (filePath: string) => void): void {
		this.onDraftFileCreated = cb;
	}

	setOnClose(cb: () => void): void {
		this.onClose = cb;
	}

	async openFile(filePath: string): Promise<void> {
		if (this.filePath === filePath && !this.draftId && !this.loading) return;
		if (this.filePath && this.filePath !== filePath && this.dirty) {
			await this.persistOpenedFile({ silent: true });
		}
		this.clearAutoSaveTimer();
		this.filePath = filePath;
		this.draftId = null;
		this.draftName = pathBaseName(filePath);
		this.loading = true;
		this.saving = false;
		this.dirty = false;
		this.error = "";
		this.content = "";
		this.editorText = "";
		this.viewMode = isMarkdownPath(filePath) ? "rendered" : "raw";
		this.render();

		try {
			const { readTextFile } = await import("@tauri-apps/plugin-fs");
			const text = await readTextFile(filePath);
			if (text.includes("\u0000")) {
				this.error = "Binary file preview is not supported yet.";
				this.content = "";
				this.editorText = "";
			} else {
				this.content = text;
				this.editorText = text;
			}
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			this.content = "";
			this.editorText = "";
		} finally {
			this.loading = false;
			this.render();
		}
	}

	openDraft(draftId: string, suggestedName = DEFAULT_DRAFT_NAME): void {
		this.clearAutoSaveTimer();
		const firstOpen = this.draftId !== draftId || this.filePath !== null;
		this.filePath = null;
		this.loading = false;
		this.saving = false;
		this.error = "";
		this.openingExternal = false;
		this.draftId = draftId;
		this.draftName = suggestedName.trim() || DEFAULT_DRAFT_NAME;

		if (firstOpen) {
			this.content = "";
			this.editorText = "";
			this.dirty = false;
		}

		if (!isMarkdownPath(this.draftName) && this.viewMode === "rendered") {
			this.viewMode = "raw";
		}

		this.render();
	}

	clear(): void {
		this.clearAutoSaveTimer();
		this.filePath = null;
		this.draftId = null;
		this.draftName = DEFAULT_DRAFT_NAME;
		this.content = "";
		this.editorText = "";
		this.loading = false;
		this.saving = false;
		this.dirty = false;
		this.error = "";
		this.viewMode = "raw";
		this.openingExternal = false;
		this.render();
	}

	private setViewMode(mode: FileViewMode): void {
		if (this.viewMode === mode) return;
		this.viewMode = mode;
		this.render();
	}

	private clearAutoSaveTimer(): void {
		if (!this.autoSaveTimer) return;
		clearTimeout(this.autoSaveTimer);
		this.autoSaveTimer = null;
	}

	private scheduleAutoSave(): void {
		this.clearAutoSaveTimer();
		if (!this.filePath || !this.dirty || this.loading) return;
		this.autoSaveTimer = setTimeout(() => {
			this.autoSaveTimer = null;
			void this.persistOpenedFile({ silent: true });
		}, AUTO_SAVE_DELAY_MS);
	}

	private async persistOpenedFile(options: { silent?: boolean } = {}): Promise<void> {
		if (!this.filePath || !this.dirty || this.loading) return;
		if (this.saving) return;
		const textToSave = this.editorText;
		this.saving = true;
		this.render();
		try {
			const { writeTextFile } = await import("@tauri-apps/plugin-fs");
			await writeTextFile(this.filePath, textToSave);
			this.content = textToSave;
			this.dirty = this.editorText !== this.content;
		} catch (err) {
			console.error("Autosave failed:", err);
			if (!options.silent) {
				window.alert(err instanceof Error ? err.message : String(err));
			}
		} finally {
			this.saving = false;
			if (this.filePath && this.dirty) {
				this.scheduleAutoSave();
			}
			this.render();
		}
	}

	private updateEditorText(next: string): void {
		this.editorText = next;
		if (this.filePath) {
			this.dirty = this.editorText !== this.content;
			this.scheduleAutoSave();
		} else {
			this.dirty = this.editorText.length > 0;
		}
		this.render();
	}

	private updateDraftName(next: string): void {
		if (!this.draftId) return;
		this.draftName = next;
		if (!isMarkdownPath(this.draftName) && this.viewMode === "rendered") {
			this.viewMode = "raw";
		}
		this.render();
	}

	private async saveCurrentFile(): Promise<void> {
		if (this.loading || this.saving) return;

		if (this.filePath) {
			await this.persistOpenedFile({ silent: false });
			return;
		}

		if (!this.draftId) return;
		const name = this.draftName.trim();
		if (!name) {
			window.alert("Enter a file name first.");
			return;
		}
		if (name.includes("/") || name.includes("\\")) {
			window.alert("Use a file name without folders.");
			return;
		}
		if (!this.projectPath) {
			window.alert("Select a project before creating a file.");
			return;
		}

		this.saving = true;
		this.render();
		try {
			const { exists, writeTextFile } = await import("@tauri-apps/plugin-fs");
			const nextPath = joinFsPath(this.projectPath, name);
			if (await exists(nextPath)) {
				window.alert("A file with that name already exists.");
				return;
			}
			await writeTextFile(nextPath, this.editorText);
			this.filePath = nextPath;
			this.draftId = null;
			this.content = this.editorText;
			this.dirty = false;
			this.onDraftFileCreated?.(nextPath);
		} catch (err) {
			window.alert(err instanceof Error ? err.message : String(err));
		} finally {
			this.saving = false;
			this.render();
		}
	}

	private async openInEditor(): Promise<void> {
		if (!this.filePath || this.openingExternal) return;
		this.openingExternal = true;
		this.render();
		try {
			await invoke("open_path_in_default_app", { path: this.filePath });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			window.alert(message);
		} finally {
			this.openingExternal = false;
			this.render();
		}
	}

	render(): void {
		const isDraft = Boolean(this.draftId && !this.filePath);
		const activeNameOrPath = this.filePath ?? this.draftName;
		const markdown = isMarkdownPath(activeNameOrPath);
		const canCreateDraft = Boolean(this.draftId);
		const fileTitle = this.filePath ? pathBaseName(this.filePath) : this.draftName;
		const fileDirectory = this.filePath ? pathDirName(this.filePath) : null;
		const filePathLabel = this.filePath
			? truncatePath(fileDirectory || this.filePath)
			: "Select a file from the sidebar.";

		const template = html`
			<div class="file-viewer-root">
				<div class="file-viewer-header minimal">
					${isDraft
						? html`
							<input
								class="file-viewer-draft-name"
								.value=${this.draftName}
								placeholder="New file"
								@input=${(e: Event) => this.updateDraftName((e.target as HTMLInputElement).value)}
							/>
						`
						: html`
							<div class="file-viewer-meta">
								<div class="file-viewer-path" title=${fileDirectory || this.filePath || ""}>${filePathLabel}</div>
								<div class="file-viewer-title" title=${fileTitle}>${fileTitle}</div>
							</div>
						`}
					<div class="file-viewer-actions">
						${markdown
							? html`
								<div class="file-viewer-segment" role="tablist" aria-label="Markdown view mode">
									<button
										class="file-viewer-segment-btn ${this.viewMode === "rendered" ? "active" : ""}"
										@click=${() => this.setViewMode("rendered")}
									>
										Rendered
									</button>
									<button
										class="file-viewer-segment-btn ${this.viewMode === "raw" ? "active" : ""}"
										@click=${() => this.setViewMode("raw")}
									>
										Raw
									</button>
								</div>
							`
							: null}
						${isDraft
							? html`
								<button class="file-viewer-save-btn" ?disabled=${!canCreateDraft || this.saving || this.loading} @click=${() => void this.saveCurrentFile()}>
									${this.saving ? "Creating…" : "Create file"}
								</button>
							`
							: nothing}
						<button class="file-viewer-open-btn" ?disabled=${!this.filePath || this.loading || this.openingExternal} @click=${() => void this.openInEditor()}>
							<span>Open in editor</span>
							<svg class="file-viewer-open-icon" viewBox="0 0 16 16" aria-hidden="true">
								<path d="M6 3h7v7"></path>
								<path d="M13 3L4.8 11.2"></path>
							</svg>
						</button>
						<button class="file-viewer-close-btn" title="Close file panel" @click=${() => this.onClose?.()}>✕</button>
					</div>
				</div>
				<div class="file-viewer-body">
					${isDraft
						? html`<div class="file-viewer-draft-hint">Name the file above (for example <code>notes.md</code> or <code>script.js</code>) and press <strong>Create file</strong>.</div>`
						: null}
					${this.loading
						? html`<div class="file-viewer-empty">Loading file…</div>`
						: this.error
							? html`<div class="file-viewer-empty error">${this.error}</div>`
							: markdown && this.viewMode === "rendered"
								? html`
									<div class="file-viewer-markdown">
										<markdown-block .content=${this.editorText}></markdown-block>
									</div>
								`
								: html`
									<textarea
										class="file-viewer-editor"
										.value=${this.editorText}
										placeholder=${isDraft ? "Write file content…" : ""}
										@input=${(e: Event) => this.updateEditorText((e.target as HTMLTextAreaElement).value)}
									></textarea>
								`}
					${this.filePath && this.saving
						? html`<div class="file-viewer-status-row"><span class="file-viewer-status-dirty">Saving…</span></div>`
						: nothing}
				</div>
			</div>
		`;
		render(template, this.container);
	}
}
