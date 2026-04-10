import { html, nothing, type TemplateResult } from "lit";
import type { AssistantWorkflow, WorkflowToolCall, WorkflowToolCallGroup } from "./workflow-utils.js";

type WorkflowExpansionState = {
	total: number;
	running: number;
	autoExpanded: boolean;
	expanded: boolean;
};

interface RenderAssistantWorkflowViewParams {
	workflow: AssistantWorkflow;
	resolveWorkflowExpansionState: (
		workflowId: string,
		toolCalls: WorkflowToolCall[],
		isTerminal: boolean,
	) => WorkflowExpansionState;
	normalizeThinkingText: (value: string) => string;
	summarizeToolCall: (toolCall: WorkflowToolCall) => string;
	renderToolPreview: (preview: string) => TemplateResult;
	formatDuration: (ms: number) => string;
	isWorkflowThinkingExpanded: (thinkingId: string) => boolean;
	toggleWorkflowThinkingExpanded: (thinkingId: string) => void;
	isToolGroupExpanded: (workflowId: string, groupId: string) => boolean;
	toggleToolGroupExpanded: (workflowId: string, groupId: string) => void;
	toggleToolWorkflowExpanded: (workflowId: string, autoExpanded: boolean, currentlyExpanded: boolean) => void;
	clearCollapsedWorkflowState: (workflowId: string) => void;
	piGlyphIcon: () => TemplateResult;
}

type WorkflowDetailEntry =
	| {
		kind: "thinking";
		id: string;
		text: string;
		animating: boolean;
	}
	| {
		kind: "group";
		group: WorkflowToolCallGroup;
	};

export function renderAssistantWorkflowView({
	workflow,
	resolveWorkflowExpansionState,
	normalizeThinkingText,
	summarizeToolCall,
	renderToolPreview,
	formatDuration,
	isWorkflowThinkingExpanded,
	toggleWorkflowThinkingExpanded,
	isToolGroupExpanded,
	toggleToolGroupExpanded,
	toggleToolWorkflowExpanded,
	clearCollapsedWorkflowState,
	piGlyphIcon,
}: RenderAssistantWorkflowViewParams): TemplateResult {
	const { total, running, autoExpanded, expanded } = resolveWorkflowExpansionState(
		workflow.id,
		workflow.toolCalls,
		workflow.isTerminal,
	);
	const failed = workflow.toolCalls.filter((toolCall) => toolCall.isError).length;
	const durationMs =
		workflow.startedAt > 0
			? (running > 0 ? Date.now() : Math.max(workflow.endedAt, workflow.startedAt)) - workflow.startedAt
			: 0;
	const durationLabel = durationMs > 0 ? formatDuration(durationMs) : "0s";
	const summaryPrimary = durationLabel;
	const completed = Math.max(0, total - running - failed);
	const summaryParts: string[] = [];
	if (completed > 0) summaryParts.push(`${completed} complete`);
	if (failed > 0) summaryParts.push(`${failed} failed`);
	if (running > 0) summaryParts.push(`${running} running`);
	if (summaryParts.length === 0 && total > 0) summaryParts.push(`${total} complete`);
	const summarySecondary = summaryParts.join(" · ");
	const hasFinalContent = Boolean(workflow.finalText || workflow.errorText);
	const detailEntries: WorkflowDetailEntry[] = [];
	let lastThinkingFull = "";
	for (const message of workflow.messages) {
		const normalizedThinking = normalizeThinkingText((message.thinking ?? "").replace(/^\s+/, ""));
		if (normalizedThinking) {
			let displayThinking = normalizedThinking;
			if (lastThinkingFull) {
				if (normalizedThinking.startsWith(lastThinkingFull)) {
					displayThinking = normalizedThinking.slice(lastThinkingFull.length).replace(/^\s+/, "").trim();
				} else if (lastThinkingFull.startsWith(normalizedThinking)) {
					displayThinking = "";
				}
			}
			lastThinkingFull = normalizedThinking;

			const previous = detailEntries[detailEntries.length - 1];
			if (!displayThinking) {
				if (previous && previous.kind === "thinking") {
					previous.animating = previous.animating || Boolean(message.isThinkingStreaming);
				}
			} else if (previous && previous.kind === "thinking") {
				previous.animating = previous.animating || Boolean(message.isThinkingStreaming);
				if (displayThinking === previous.text || previous.text.startsWith(displayThinking)) {
					// no-op: duplicate or shorter repeat
				} else if (displayThinking.startsWith(previous.text)) {
					previous.text = displayThinking;
				} else {
					detailEntries.push({
						kind: "thinking",
						id: `${workflow.id}:thinking:${message.id}`,
						text: displayThinking,
						animating: Boolean(message.isThinkingStreaming),
					});
				}
			} else {
				detailEntries.push({
					kind: "thinking",
					id: `${workflow.id}:thinking:${message.id}`,
					text: displayThinking,
					animating: Boolean(message.isThinkingStreaming),
				});
			}
		}

		for (const toolCall of message.toolCalls) {
			const preview = summarizeToolCall(toolCall);
			const previous = detailEntries[detailEntries.length - 1];
			if (previous && previous.kind === "group" && previous.group.toolName === toolCall.name && previous.group.preview === preview) {
				previous.group.calls.push(toolCall);
				continue;
			}
			detailEntries.push({
				kind: "group",
				group: {
					id: `${toolCall.id}-group`,
					toolName: toolCall.name,
					preview,
					calls: [toolCall],
				},
			});
		}
	}
	if (!expanded) {
		clearCollapsedWorkflowState(workflow.id);
	}

	return html`
		<div class="chat-row assistant-row assistant-workflow-row" data-message-id=${workflow.id}>
			<div class="message-shell assistant-message-shell">
				<div class="assistant-block">
					<button
						class="tool-workflow-summary"
						@click=${() => {
							toggleToolWorkflowExpanded(workflow.id, autoExpanded, expanded);
						}}
					>
						<span class="workflow-divider" aria-hidden="true"></span>
						<span class="workflow-summary-center">
							<span class="workflow-summary-label">${summaryPrimary}</span>
							${summarySecondary ? html`<span class="workflow-summary-meta">${summarySecondary}</span>` : nothing}
							<span class="workflow-summary-caret">${expanded ? "▾" : "▸"}</span>
						</span>
						<span class="workflow-divider" aria-hidden="true"></span>
					</button>
					${expanded
						? html`
							<div class="tool-workflow-list">
								${detailEntries.map((entry) => {
									if (entry.kind === "thinking") {
										const thinkingExpanded = isWorkflowThinkingExpanded(entry.id);
										const thinkingAnimating = running === 0 && entry.animating;
										return html`
											<div class="tool-workflow-thinking">
												<button class="tool-workflow-thinking-toggle ${thinkingAnimating ? "animating" : "done"}" @click=${() => toggleWorkflowThinkingExpanded(entry.id)}>
													${thinkingAnimating ? html`<span class="tool-workflow-inline-pi" aria-hidden="true">${piGlyphIcon()}</span>` : nothing}
													<span class="tool-workflow-thinking-text">Thinking…</span>
												</button>
												${thinkingExpanded ? html`<div class="tool-workflow-thinking-content">${entry.text}</div>` : nothing}
											</div>
										`;
									}
									const group = entry.group;
									const count = group.calls.length;
									const groupRunning = group.calls.some((toolCall) => toolCall.isRunning);
									const groupFailed = group.calls.some((toolCall) => toolCall.isError);
									const groupExpanded = isToolGroupExpanded(workflow.id, group.id);
									const output =
										[...group.calls]
											.reverse()
											.map((call) => (call.streamingOutput ?? call.result ?? "").trim())
											.find((value) => value.length > 0) ?? "";
									const statusLabel = groupRunning ? "running" : groupFailed ? "failed" : "success";
									return html`
										<div class="tool-workflow-item">
											<button
												class="tool-workflow-line ${groupRunning ? "running" : ""}"
												@click=${() => toggleToolGroupExpanded(workflow.id, group.id)}
											>
												${groupRunning ? html`<span class="tool-workflow-inline-pi" aria-hidden="true">${piGlyphIcon()}</span>` : nothing}
												<span class="tool-workflow-line-text ${groupRunning ? "running" : ""}">${renderToolPreview(group.preview)}</span>
												${count > 1 ? html`<span class="tool-workflow-count">×${count}</span>` : nothing}
											</button>
											${groupExpanded
												? html`
													<div class="tool-workflow-details">
														<pre class="tool-workflow-output">${output || "No output reported."}${groupRunning ? html`<span class="streaming-inline"></span>` : nothing}</pre>
														<div class="tool-workflow-detail-meta"><span class="tool-workflow-detail-status ${groupRunning ? "running" : groupFailed ? "error" : "done"}">${statusLabel}</span></div>
													</div>
												`
												: nothing}
										</div>
									`;
								})}
							</div>
							${hasFinalContent ? html`<div class="assistant-final-divider"><span>Agent</span></div>` : nothing}
							${workflow.finalText
								? html`<div class="assistant-content"><markdown-block .content=${workflow.finalText}></markdown-block></div>`
								: nothing}
							${workflow.errorText ? html`<div class="assistant-error-line">${workflow.errorText}</div>` : nothing}
						`
						: html`
							${workflow.finalText
								? html`<div class="assistant-content workflow-final-collapsed"><markdown-block .content=${workflow.finalText}></markdown-block></div>`
								: nothing}
							${workflow.errorText ? html`<div class="assistant-error-line">${workflow.errorText}</div>` : nothing}
						`}
				</div>
			</div>
		</div>
	`;
}
