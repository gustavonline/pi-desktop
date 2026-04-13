import { html, nothing, type TemplateResult } from "lit";
import { formatModelDisplayName, formatProviderDisplayName } from "../../models/model-options.js";
import { resolveModelPickerAuthHint, resolveModelPickerProviderAuthActionState } from "../../models/model-picker-auth-ui.js";
import type { ModelPickerProviderGroup } from "../../models/model-picker-provider-groups.js";
import { normalizeProviderKey } from "../../auth/provider-auth.js";
import type { ThinkingLevel } from "../../rpc/bridge.js";

interface CloseModelPickerOptions {
	focusComposer?: boolean;
}

interface RenderComposerControlsViewParams {
	canSend: boolean;
	isStreaming: boolean;
	interactionLocked: boolean;
	sendingPrompt: boolean;
	settingModel: boolean;
	settingThinking: boolean;
	thinkingValue: ThinkingLevel;
	thinkingLabel: string;
	currentProvider: string;
	currentModelId: string;
	currentModelValue: string;
	currentModelTitle: string;
	currentModelDisplay: string;
	currentProviderDisplay: string;
	modelPickerOpen: boolean;
	loadingModels: boolean;
	loadingModelCatalog: boolean;
	providerGroups: ModelPickerProviderGroup[];
	activeProviderGroup: ModelPickerProviderGroup | null;
	resolvedActiveProvider: string;
	runningProviderAuthActionProvider: string | null;
	attachIcon: TemplateResult;
	stopIcon: TemplateResult;
	spinnerIcon: TemplateResult;
	sendIcon: TemplateResult;
	onAttachFile: () => void;
	onCloseModelPicker: (options?: CloseModelPickerOptions) => void;
	onToggleModelPicker: (preferredProvider: string) => void;
	onSetModelPickerActiveProvider: (provider: string) => void;
	onProviderAuthAction: (provider: string, action: "login" | "logout") => void | Promise<unknown>;
	onSelectModel: (provider: string, modelId: string) => void | Promise<unknown>;
	onSetThinkingLevel: (value: ThinkingLevel) => void | Promise<unknown>;
	onAbort: () => void | Promise<unknown>;
	onSend: () => void | Promise<unknown>;
}

export function renderComposerControlsView({
	canSend,
	isStreaming,
	interactionLocked,
	sendingPrompt,
	settingModel,
	settingThinking,
	thinkingValue,
	thinkingLabel,
	currentProvider,
	currentModelId,
	currentModelValue,
	currentModelTitle,
	currentModelDisplay,
	currentProviderDisplay,
	modelPickerOpen,
	loadingModels,
	loadingModelCatalog,
	providerGroups,
	activeProviderGroup,
	resolvedActiveProvider,
	runningProviderAuthActionProvider,
	attachIcon,
	stopIcon,
	spinnerIcon,
	sendIcon,
	onAttachFile,
	onCloseModelPicker,
	onToggleModelPicker,
	onSetModelPickerActiveProvider,
	onProviderAuthAction,
	onSelectModel,
	onSetThinkingLevel,
	onAbort,
	onSend,
}: RenderComposerControlsViewParams): TemplateResult {
	return html`
		<div class="composer-controls">
			<div class="control-group">
				<button
					class="composer-icon-btn"
					title="Attach file"
					?disabled=${interactionLocked}
					@click=${() => {
						if (interactionLocked) return;
						onAttachFile();
					}}
				>
					${attachIcon}
				</button>

				<div
					class="model-picker-root"
					@keydown=${(event: KeyboardEvent) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						onCloseModelPicker({ focusComposer: true });
					}}
					@focusout=${(event: FocusEvent) => {
						const next = event.relatedTarget as Node | null;
						const root = event.currentTarget as HTMLElement;
						if (next && root.contains(next)) return;
						onCloseModelPicker();
					}}
				>
					<button
						type="button"
						class="model-picker-trigger"
						title=${currentModelTitle}
						?disabled=${interactionLocked || settingModel}
						@click=${() => {
							if (interactionLocked || settingModel) return;
							onToggleModelPicker(resolvedActiveProvider);
						}}
					>
						<span class="model-picker-trigger-label">${currentProviderDisplay ? `${currentModelDisplay} · ${currentProviderDisplay}` : currentModelDisplay}</span>
						<span class="composer-select-caret">▾</span>
					</button>

					${modelPickerOpen
						? html`
							<div class="model-picker-popover" role="listbox" aria-label="Available models">
								${providerGroups.length === 0
									? html`<div class="model-picker-empty">${loadingModels || loadingModelCatalog ? "Loading models…" : "No models available"}</div>`
									: html`
										<div class="model-picker-providers">
											${providerGroups.map((group) => {
												const authKey = normalizeProviderKey(group.providerKey);
												const actionState = resolveModelPickerProviderAuthActionState({
													group,
													authKey,
													runningProviderAuthActionKey: runningProviderAuthActionProvider,
													interactionLocked,
													settingModel,
												});
												return html`
													<div class="model-picker-provider-row ${group.providerKey === resolvedActiveProvider ? "active" : ""} ${group.authConfigured ? "" : "unauth"}">
														<button
															type="button"
															class="model-picker-provider ${group.providerKey === resolvedActiveProvider ? "active" : ""} ${group.authConfigured ? "" : "unauth"}"
															title=${group.authConfigured ? `${group.providerLabel} connected` : `${group.providerLabel} needs setup`}
															@mouseenter=${() => onSetModelPickerActiveProvider(group.providerKey)}
															@focus=${() => onSetModelPickerActiveProvider(group.providerKey)}
															@click=${() => onSetModelPickerActiveProvider(group.providerKey)}
														>
															<span class="model-picker-provider-label">${group.providerLabel}</span>
														</button>
														<button
															type="button"
															class="model-picker-provider-auth ${group.authConfigured ? "connected" : ""} ${actionState.isBusy ? "busy" : ""}"
															title=${actionState.title}
															?disabled=${actionState.disabled}
															@click=${(event: MouseEvent) => {
																event.preventDefault();
																event.stopPropagation();
																if (actionState.disabled) return;
																void onProviderAuthAction(group.providerKey, actionState.action);
															}}
														>
															${actionState.isBusy ? "…" : actionState.label}
														</button>
													</div>
												`;
											})}
										</div>
										<div class="model-picker-models">
											${activeProviderGroup
												? html`
													${activeProviderGroup.models.length === 0
														? html`
															<div class="model-picker-auth-hint">
																${resolveModelPickerAuthHint(activeProviderGroup, false)}
															</div>
														`
														: html`
															${!activeProviderGroup.authConfigured
																? html`<div class="model-picker-auth-hint">${resolveModelPickerAuthHint(activeProviderGroup, true)}</div>`
																: nothing}
															${activeProviderGroup.models.map((model) => {
																const nextValue = `${model.provider}::${model.id}`;
																const isActive = model.provider === currentProvider && model.id === currentModelId;
																const isDisabled = !model.selectable || !activeProviderGroup.authConfigured;
																return html`
																	<button
																		type="button"
																		class="model-picker-model ${isActive ? "active" : ""} ${isDisabled ? "disabled" : ""}"
																		title=${isDisabled
																			? `${formatProviderDisplayName(model.provider)} / ${model.id} (setup required)`
																			: `${formatProviderDisplayName(model.provider)} / ${model.id}`}
																		?disabled=${interactionLocked || settingModel || isDisabled}
																		@click=${() => {
																			if (isDisabled) return;
																			onCloseModelPicker();
																			if (nextValue === currentModelValue) return;
																			void onSelectModel(model.provider, model.id);
																		}}
																	>
																		<span>${formatModelDisplayName(model.id)}</span>
																	</button>
																`;
															})}
														`}
												`
												: html`<div class="model-picker-empty">No models</div>`}
										</div>
									`}
							</div>
						`
						: nothing}
				</div>

				<div class="thinking-select-wrap" title="Reasoning effort · Shift+Tab to cycle">
					<span class="thinking-select-label">${thinkingLabel}</span>
					<select
						class="thinking-select-native"
						.value=${thinkingValue}
						?disabled=${interactionLocked || settingThinking}
						@change=${(event: Event) => void onSetThinkingLevel((event.target as HTMLSelectElement).value as ThinkingLevel)}
					>
						<option value="off">off</option>
						<option value="minimal">minimal</option>
						<option value="low">low</option>
						<option value="medium">medium</option>
						<option value="high">high</option>
						<option value="xhigh">xhigh</option>
					</select>
					<span class="thinking-select-caret">▾</span>
				</div>
			</div>

			<div class="control-group right">
				${isStreaming
					? html`
						<button
							class="send-btn stop-btn"
							title="Stop generation"
							?disabled=${interactionLocked}
							@click=${() => {
								if (interactionLocked) return;
								void onAbort();
							}}
						>
							${stopIcon}
						</button>
					`
					: sendingPrompt
						? html`
							<button class="send-btn pending-send" title="Sending" disabled>
								${spinnerIcon}
							</button>
						`
						: html`
							<button
								class="send-btn primary-send"
								?disabled=${interactionLocked || !canSend}
								title="Send (Enter) · Queue while streaming (Alt+Enter)"
								@click=${() => {
									if (interactionLocked) return;
									void onSend();
								}}
							>
								${sendIcon}
							</button>
						`}
			</div>
		</div>
	`;
}
