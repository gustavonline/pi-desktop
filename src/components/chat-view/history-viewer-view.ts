import { html, nothing, type TemplateResult } from "lit";
import type { ForkOption, HistoryTreeRow, HistoryViewerMessage, HistoryViewerRole } from "./history-viewer-types.js";

interface RenderHistoryViewerViewParams<Message extends HistoryViewerMessage> {
	historyViewerOpen: boolean;
	historyViewerMode: "browse" | "fork";
	historyViewerLoading: boolean;
	historyViewerSessionLabel: string;
	historyQuery: string;
	historyRoleFilter: HistoryViewerRole | "all";
	messages: Message[];
	historyTreeRows: HistoryTreeRow[];
	forkOptions: ForkOption[];
	messagePreview: (message: Message) => string;
	resolveForkEntryId: (messages: Message[], index: number) => string | null;
	onClose: () => void;
	onQueryChange: (value: string) => void;
	onRoleFilterChange: (role: HistoryViewerRole | "all") => void;
	onJumpToMessage: (messageId: string) => void;
	onForkFromEntry: (entryId: string) => unknown;
	compactTreeLinePrefix: (prefix: string, depth: number) => string;
	truncateText: (value: string, maxLength: number) => string;
}

export function renderHistoryViewerView<Message extends HistoryViewerMessage>({
	historyViewerOpen,
	historyViewerMode,
	historyViewerLoading,
	historyViewerSessionLabel,
	historyQuery,
	historyRoleFilter,
	messages,
	historyTreeRows,
	forkOptions,
	messagePreview,
	resolveForkEntryId,
	onClose,
	onQueryChange,
	onRoleFilterChange,
	onJumpToMessage,
	onForkFromEntry,
	compactTreeLinePrefix,
	truncateText,
}: RenderHistoryViewerViewParams<Message>): TemplateResult | typeof nothing {
	if (!historyViewerOpen) return nothing;

	const forkMode = historyViewerMode === "fork";
	const query = historyQuery.trim().toLowerCase();
	const sourceMessages: Message[] = messages;
	const sessionMessageIdByEntryId = new Map<string, string>();
	for (const message of messages) {
		if (!message.sessionEntryId) continue;
		if (sessionMessageIdByEntryId.has(message.sessionEntryId)) continue;
		sessionMessageIdByEntryId.set(message.sessionEntryId, message.id);
	}

	const filteredForkOptions: ForkOption[] = forkMode
		? forkOptions.filter((option) => {
			if (!query) return true;
			return option.text.toLowerCase().includes(query);
		})
		: [];

	const useTreeRows = !forkMode && historyTreeRows.length > 0;
	const filteredTreeRows: HistoryTreeRow[] = forkMode
		? []
		: historyTreeRows.filter((row) => {
			if (historyRoleFilter !== "all" && row.role !== historyRoleFilter) return false;
			if (!query) return true;
			const haystack = `${row.role} ${row.entryLabel} ${row.preview} ${row.displayText} ${row.entryId}`.toLowerCase();
			return haystack.includes(query);
		});

	const filteredBrowseRows: Array<{ msg: Message; sourceIndex: number }> = forkMode || useTreeRows
		? []
		: sourceMessages
			.map((msg, sourceIndex) => ({ msg, sourceIndex }))
			.filter(({ msg }) => {
				if (historyRoleFilter !== "all" && msg.role !== historyRoleFilter) return false;
				if (!query) return true;
				const haystack = `${msg.role} ${msg.label || ""} ${messagePreview(msg)}`.toLowerCase();
				return haystack.includes(query);
			});

	const hasNoRows = forkMode
		? filteredForkOptions.length === 0
		: useTreeRows
			? filteredTreeRows.length === 0
			: filteredBrowseRows.length === 0;

	return html`
		<div class="overlay" @click=${(event: Event) => event.target === event.currentTarget && onClose()}>
			<div class="overlay-card history-card ${forkMode ? "fork-mode" : ""}">
				<div class="overlay-header">
					<div>
						<div>${forkMode ? "Fork from message" : "Session tree"}</div>
						${forkMode
							? html`<div class="history-subtitle">${historyViewerSessionLabel || "Current session"}</div>`
							: nothing}
					</div>
					<button @click=${onClose}>✕</button>
				</div>
				<div class="history-controls ${forkMode ? "fork" : ""}">
					<input
						type="text"
						placeholder=${forkMode ? "Search user messages" : "Search tree entries"}
						.value=${historyQuery}
						@input=${(event: Event) => {
							onQueryChange((event.target as HTMLInputElement).value);
						}}
					/>
					${forkMode
						? nothing
						: html`
							<select
								class="settings-select"
								.value=${historyRoleFilter}
								@change=${(event: Event) => {
									onRoleFilterChange((event.target as HTMLSelectElement).value as HistoryViewerRole | "all");
								}}
							>
								<option value="all">all roles</option>
								<option value="user">user</option>
								<option value="assistant">assistant</option>
								<option value="system">system</option>
								<option value="custom">custom</option>
							</select>
						`}
				</div>
				<div class="overlay-body history-list ${forkMode ? "fork-history-list" : ""}">
					${historyViewerLoading
						? html`<div class="overlay-empty">Loading session history…</div>`
						: hasNoRows
							? html`<div class="overlay-empty">${forkMode ? "No messages available for forking." : "No session entries match your filters."}</div>`
							: forkMode
								? filteredForkOptions.map((option, idx) => {
										const preview = truncateText(option.text.replace(/\s+/g, " ").trim(), 240);
										return html`
											<div class="history-item fork-user-row">
												<div class="history-item-main">
													<button class="history-jump" @click=${() => void onForkFromEntry(option.entryId)} title="Fork from this user message">
														<div class="history-meta">
															<span class="history-role role-user">user</span>
															<span>#${idx + 1}</span>
														</div>
														<div class="history-preview">${preview}</div>
													</button>
													<button class="history-fork-btn" @click=${() => void onForkFromEntry(option.entryId)} title="Fork from this user message">Fork</button>
												</div>
											</div>
										`;
								  })
								: useTreeRows
									? filteredTreeRows.map((row, idx) => {
											const visibleMessageId = sessionMessageIdByEntryId.get(row.entryId) ?? null;
											const canJump = Boolean(visibleMessageId);
											const title = canJump ? "Jump to this entry" : "Entry is outside the active branch";
											const compactPrefix = compactTreeLinePrefix(row.linePrefix, row.depth);
											const rowText = row.displayText.trim() || row.preview || "(entry)";
											const lineText = `${compactPrefix}${row.onActivePath ? "• " : "  "}${truncateText(rowText, 320)}`;
											const lineBody = html`<span class="history-tree-line-mono role-${row.role}">${lineText}</span>`;
											return html`
												<div class="history-tree-line-row ${row.onActivePath ? "on-path" : "off-path"}">
													${canJump && visibleMessageId
														? html`<button class="history-tree-line ${row.onActivePath ? "on-path" : ""}" @click=${() => onJumpToMessage(visibleMessageId)} title=${title}>${lineBody}</button>`
														: html`<div class="history-tree-line static" title=${title}>${lineBody}</div>`}
													<div class="history-tree-line-actions">
														<span class="history-tree-index">#${idx + 1}</span>
														${row.canFork
															? html`<button class="history-fork-btn" @click=${() => void onForkFromEntry(row.entryId)} title="Fork from this user message">Fork</button>`
															: nothing}
													</div>
												</div>
											`;
									  })
									: filteredBrowseRows.map(({ msg, sourceIndex }, idx) => {
											const forkEntryId = resolveForkEntryId(sourceMessages, sourceIndex);
											const canFork = Boolean(forkEntryId) && (msg.role === "user" || msg.role === "assistant");
											return html`
												<div class="history-item">
													<div class="history-item-main">
														<button class="history-jump" @click=${() => onJumpToMessage(msg.id)}>
															<div class="history-meta">
																<span class="history-role role-${msg.role}">${msg.role}</span>
																<span>#${idx + 1}</span>
															</div>
															<div class="history-preview">${truncateText(messagePreview(msg).replace(/\s+/g, " "), 200)}</div>
														</button>
														${canFork && forkEntryId
															? html`<button class="history-fork-btn" @click=${() => void onForkFromEntry(forkEntryId)} title=${msg.role === "assistant" ? "Fork from preceding user message" : "Fork from this user message"}>Fork</button>`
															: nothing}
													</div>
												</div>
											`;
					  })}
				</div>
			</div>
		</div>
	`;
}
