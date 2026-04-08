/**
 * ContentTabs - mixed tab strip (session + file + terminal)
 */

import { html, nothing, render } from "lit";

export type ContentTabType = "session" | "file" | "terminal";

export interface MainContentTab {
	id: string;
	type: ContentTabType;
	title: string;
	path?: string;
	closable: boolean;
	needsAttention?: boolean;
	attentionLabel?: string;
	pinned?: boolean;
}

const TAB_COLORS_STORAGE_KEY = "pi-desktop.content-tab-colors.v1";
const TAB_LAYOUT_STORAGE_KEY = "pi-desktop.content-tab-layout.v1";
const DRAG_START_THRESHOLD_PX = 6;

const COLOR_PRESETS = [
	{ id: "red", value: "#8b4a46", label: "Red" },
	{ id: "green", value: "#4f755f", label: "Green" },
	{ id: "yellow", value: "#846a3f", label: "Yellow" },
	{ id: "blue", value: "#4d6f95", label: "Blue" },
	{ id: "purple", value: "#7a5891", label: "Purple" },
	{ id: "teal", value: "#4f8b8b", label: "Teal" },
] as const;

type TabLayoutState = {
	pins: Record<string, boolean>;
	order: string[];
};

export class ContentTabs {
	private container: HTMLElement;
	private tabs: MainContentTab[] = [];
	private activeId: string | null = null;
	private onSelect: ((id: string) => void) | null = null;
	private onClose: ((id: string) => void) | null = null;
	private onRename: ((id: string, title: string) => void) | null = null;
	private onOpenTerminal: (() => void) | null = null;
	private onCreateTab: (() => void) | null = null;
	private terminalActive = false;

	private globalDismissListenerActive = false;

	private tabColors: Record<string, string> = {};
	private tabPins: Record<string, boolean> = {};
	private tabOrder: string[] = [];
	private contextTabKey: string | null = null;
	private contextX = 0;
	private contextY = 0;
	private overflowMeasureFrame: number | null = null;
	private pendingDragTabKey: string | null = null;
	private pendingDragPointerId: number | null = null;
	private dragStartX = 0;
	private dragCurrentX = 0;
	private dragGrabOffsetX = 0;
	private draggingTabKey: string | null = null;
	private dragGhostWidth = 0;
	private previewTabs: MainContentTab[] | null = null;
	private suppressClickTabKey: string | null = null;
	private suppressClickUntil = 0;

	private readonly onWindowPointerDown = (event: PointerEvent) => {
		if (!this.contextTabKey) return;
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest(".content-tab-context-menu")) return;
		this.closeContext();
	};

	private readonly onWindowPointerMove = (event: PointerEvent) => {
		if (event.pointerId !== this.pendingDragPointerId) return;
		if (!this.pendingDragTabKey) return;

		const deltaX = event.clientX - this.dragStartX;
		if (!this.draggingTabKey) {
			if (Math.abs(deltaX) < DRAG_START_THRESHOLD_PX) return;
			this.activateTabDrag(this.pendingDragTabKey);
		}

		this.dragCurrentX = event.clientX;
		this.updatePreviewOrderFromPointer();
		this.render();
	};

	private readonly onWindowPointerUp = (event: PointerEvent) => {
		if (event.pointerId !== this.pendingDragPointerId) return;
		this.finishTabPointerInteraction();
	};

	constructor(container: HTMLElement) {
		this.container = container;
		this.loadTabColors();
		this.loadTabLayout();
		this.render();
	}

	setTabs(tabs: MainContentTab[], activeId: string | null): void {
		this.tabs = this.applyStoredLayoutToTabs(tabs);
		this.activeId = activeId;

		if (this.contextTabKey && !this.tabs.some((tab) => this.tabKey(tab) === this.contextTabKey)) {
			this.contextTabKey = null;
		}

		if (this.draggingTabKey && !this.tabs.some((tab) => this.tabKey(tab) === this.draggingTabKey)) {
			this.clearDragState();
		}

		this.syncGlobalDismissListener();
		this.render();
	}

	setOnSelect(cb: (id: string) => void): void {
		this.onSelect = cb;
	}

	setOnClose(cb: (id: string) => void): void {
		this.onClose = cb;
	}

	setOnRename(cb: (id: string, title: string) => void): void {
		this.onRename = cb;
	}

	setOnOpenTerminal(cb: () => void): void {
		this.onOpenTerminal = cb;
	}

	setOnCreateTab(cb: () => void): void {
		this.onCreateTab = cb;
	}

	setTerminalActive(active: boolean): void {
		if (this.terminalActive === active) return;
		this.terminalActive = active;
		this.render();
	}

	private syncGlobalDismissListener(): void {
		const shouldListen = this.contextTabKey !== null;
		if (shouldListen && !this.globalDismissListenerActive) {
			window.addEventListener("pointerdown", this.onWindowPointerDown, true);
			this.globalDismissListenerActive = true;
			return;
		}
		if (!shouldListen && this.globalDismissListenerActive) {
			window.removeEventListener("pointerdown", this.onWindowPointerDown, true);
			this.globalDismissListenerActive = false;
		}
	}

	private tabKey(tab: MainContentTab): string {
		return `${tab.type}:${tab.id}`;
	}

	private isTabPinned(tab: MainContentTab): boolean {
		const key = this.tabKey(tab);
		if (Object.prototype.hasOwnProperty.call(this.tabPins, key)) {
			return Boolean(this.tabPins[key]);
		}
		return Boolean(tab.pinned);
	}

	private applyStoredLayoutToTabs(tabs: MainContentTab[]): MainContentTab[] {
		const withPins = tabs.map((tab) => {
			const key = this.tabKey(tab);
			const storedPinned = Object.prototype.hasOwnProperty.call(this.tabPins, key)
				? Boolean(this.tabPins[key])
				: Boolean(tab.pinned);
			return { ...tab, pinned: storedPinned };
		});

		const sorted = this.sortTabsByPinnedOrder(withPins);
		const keys = sorted.map((tab) => this.tabKey(tab));
		const nextOrder = [
			...this.tabOrder.filter((key) => keys.includes(key)),
			...keys.filter((key) => !this.tabOrder.includes(key)),
		];

		if (nextOrder.join("|") !== this.tabOrder.join("|")) {
			this.tabOrder = nextOrder;
			this.persistTabLayout();
		}

		return sorted;
	}

	private sortTabsByPinnedOrder(tabs: MainContentTab[]): MainContentTab[] {
		const order = new Map<string, number>();
		this.tabOrder.forEach((key, index) => order.set(key, index));
		const ranked = tabs.map((tab, index) => ({ tab, index, key: this.tabKey(tab), pinned: this.isTabPinned(tab) }));
		const sorter = (a: typeof ranked[number], b: typeof ranked[number]) => {
			const aOrder = order.get(a.key);
			const bOrder = order.get(b.key);
			if (typeof aOrder === "number" && typeof bOrder === "number") return aOrder - bOrder;
			if (typeof aOrder === "number") return -1;
			if (typeof bOrder === "number") return 1;
			return a.index - b.index;
		};

		const pinned = ranked.filter((entry) => entry.pinned).sort(sorter).map((entry) => entry.tab);
		const unpinned = ranked.filter((entry) => !entry.pinned).sort(sorter).map((entry) => entry.tab);
		return [...pinned, ...unpinned];
	}

	private loadTabColors(): void {
		try {
			const raw = localStorage.getItem(TAB_COLORS_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Record<string, string>;
			if (parsed && typeof parsed === "object") {
				this.tabColors = parsed;
			}
		} catch {
			this.tabColors = {};
		}
	}

	private persistTabColors(): void {
		try {
			localStorage.setItem(TAB_COLORS_STORAGE_KEY, JSON.stringify(this.tabColors));
		} catch {
			// ignore
		}
	}

	private loadTabLayout(): void {
		try {
			const raw = localStorage.getItem(TAB_LAYOUT_STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<TabLayoutState>;
			if (parsed && typeof parsed === "object") {
				if (parsed.pins && typeof parsed.pins === "object") {
					this.tabPins = Object.fromEntries(
						Object.entries(parsed.pins).map(([key, value]) => [key, Boolean(value)]),
					);
				}
				if (Array.isArray(parsed.order)) {
					this.tabOrder = parsed.order.filter((value): value is string => typeof value === "string");
				}
			}
		} catch {
			this.tabPins = {};
			this.tabOrder = [];
		}
	}

	private persistTabLayout(): void {
		try {
			const payload: TabLayoutState = {
				pins: this.tabPins,
				order: this.tabOrder,
			};
			localStorage.setItem(TAB_LAYOUT_STORAGE_KEY, JSON.stringify(payload));
		} catch {
			// ignore
		}
	}

	private openContext(tab: MainContentTab, e: MouseEvent): void {
		e.preventDefault();
		this.contextTabKey = this.tabKey(tab);
		const menuWidth = 252;
		const menuHeight = 188;
		const pad = 10;
		this.contextX = Math.min(Math.max(pad, e.clientX + 6), Math.max(pad, window.innerWidth - menuWidth - pad));
		this.contextY = Math.min(Math.max(pad, e.clientY + 6), Math.max(pad, window.innerHeight - menuHeight - pad));
		this.syncGlobalDismissListener();
		this.render();
	}

	private closeContext(shouldRender = true): void {
		if (!this.contextTabKey) return;
		this.contextTabKey = null;
		this.syncGlobalDismissListener();
		if (shouldRender) this.render();
	}

	private getContextTab(): MainContentTab | null {
		if (!this.contextTabKey) return null;
		return this.tabs.find((tab) => this.tabKey(tab) === this.contextTabKey) ?? null;
	}

	private renameContextTab(): void {
		const tab = this.getContextTab();
		if (!tab) {
			this.closeContext();
			return;
		}
		const next = window.prompt("Rename tab", tab.title)?.trim();
		if (!next || next === tab.title) {
			this.closeContext();
			return;
		}
		this.onRename?.(tab.id, next);
		this.closeContext();
	}

	private closeContextTab(): void {
		const tab = this.getContextTab();
		if (!tab) {
			this.closeContext();
			return;
		}
		if (tab.closable) {
			this.onClose?.(tab.id);
		}
		this.closeContext();
	}

	private toggleContextTabPinned(): void {
		const tab = this.getContextTab();
		if (!tab) {
			this.closeContext();
			return;
		}
		const key = this.tabKey(tab);
		const nextPinned = !this.isTabPinned(tab);
		if (nextPinned) {
			this.tabPins[key] = true;
		} else {
			delete this.tabPins[key];
		}

		this.tabs = this.applyStoredLayoutToTabs(
			this.tabs.map((entry) => this.tabKey(entry) === key ? { ...entry, pinned: nextPinned } : entry),
		);
		this.persistTabLayout();
		this.closeContext();
	}

	private setTabColor(tabKey: string, color: string | null): void {
		if (!color) {
			delete this.tabColors[tabKey];
		} else {
			this.tabColors[tabKey] = color;
		}
		this.persistTabColors();
		this.closeContext();
	}

	private clearDragState(shouldRender = false): void {
		this.pendingDragTabKey = null;
		this.pendingDragPointerId = null;
		this.dragStartX = 0;
		this.dragCurrentX = 0;
		this.dragGrabOffsetX = 0;
		this.draggingTabKey = null;
		this.dragGhostWidth = 0;
		this.previewTabs = null;
		window.removeEventListener("pointermove", this.onWindowPointerMove, true);
		window.removeEventListener("pointerup", this.onWindowPointerUp, true);
		if (shouldRender) this.render();
	}

	private beginTabPointerInteraction(tab: MainContentTab, event: PointerEvent): void {
		if (event.button !== 0) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest(".content-tab-close")) return;
		if (target?.closest("input")) return;

		const key = this.tabKey(tab);
		const element = (event.currentTarget as HTMLElement | null) ?? this.container.querySelector<HTMLElement>(`.content-tab[data-tab-key="${key}"]`);
		const rect = element?.getBoundingClientRect();

		this.pendingDragTabKey = key;
		this.pendingDragPointerId = event.pointerId;
		this.dragStartX = event.clientX;
		this.dragCurrentX = event.clientX;
		this.dragGrabOffsetX = rect ? event.clientX - rect.left : 0;
		window.addEventListener("pointermove", this.onWindowPointerMove, true);
		window.addEventListener("pointerup", this.onWindowPointerUp, true);
	}

	private activateTabDrag(tabKey: string): void {
		const tab = this.tabs.find((entry) => this.tabKey(entry) === tabKey) ?? null;
		if (!tab) return;
		const element = this.container.querySelector<HTMLElement>(`.content-tab[data-tab-key="${tabKey}"]`);
		const rect = element?.getBoundingClientRect();
		this.draggingTabKey = tabKey;
		this.dragGhostWidth = rect?.width ?? 110;
		this.previewTabs = [...this.tabs];
		this.closeContext(false);
	}

	private updatePreviewOrderFromPointer(): void {
		const draggedKey = this.draggingTabKey;
		const previewTabs = this.previewTabs;
		if (!draggedKey || !previewTabs) return;

		const draggedTab = previewTabs.find((tab) => this.tabKey(tab) === draggedKey);
		if (!draggedTab) return;

		const draggedPinned = this.isTabPinned(draggedTab);
		const sameGroupTabs = previewTabs.filter((tab) => this.isTabPinned(tab) === draggedPinned);
		const otherTabs = sameGroupTabs.filter((tab) => this.tabKey(tab) !== draggedKey);

		let insertIndex = 0;
		for (const tab of otherTabs) {
			const key = this.tabKey(tab);
			const element = this.container.querySelector<HTMLElement>(`.content-tab[data-tab-key="${key}"]`);
			const rect = element?.getBoundingClientRect();
			if (!rect) continue;
			const centerX = rect.left + rect.width / 2;
			if (this.dragCurrentX > centerX) {
				insertIndex += 1;
			}
		}

		const reorderedGroup = [...otherTabs];
		reorderedGroup.splice(insertIndex, 0, draggedTab);
		const pinnedGroup = draggedPinned ? reorderedGroup : previewTabs.filter((tab) => this.isTabPinned(tab));
		const unpinnedGroup = draggedPinned ? previewTabs.filter((tab) => !this.isTabPinned(tab)) : reorderedGroup;
		const nextPreviewTabs = [...pinnedGroup, ...unpinnedGroup];

		const currentIds = previewTabs.map((tab) => this.tabKey(tab)).join("|");
		const nextIds = nextPreviewTabs.map((tab) => this.tabKey(tab)).join("|");
		if (currentIds !== nextIds) {
			this.previewTabs = nextPreviewTabs;
		}
	}

	private finishTabPointerInteraction(): void {
		const draggingKey = this.draggingTabKey;
		const previewTabs = this.previewTabs;
		const initialIds = this.tabs.map((tab) => this.tabKey(tab)).join("|");
		const finalIds = previewTabs?.map((tab) => this.tabKey(tab)).join("|") ?? initialIds;
		const orderChanged = Boolean(draggingKey && previewTabs && finalIds !== initialIds);

		this.clearDragState(false);
		if (draggingKey) {
			this.suppressClickTabKey = draggingKey;
			this.suppressClickUntil = Date.now() + 250;
		}

		if (orderChanged && previewTabs) {
			this.tabs = [...previewTabs];
			this.tabOrder = previewTabs.map((tab) => this.tabKey(tab));
			this.persistTabLayout();
		}

		this.render();
	}

	private shouldSuppressTabClick(tab: MainContentTab): boolean {
		const key = this.tabKey(tab);
		if (this.suppressClickTabKey !== key) return false;
		if (Date.now() > this.suppressClickUntil) {
			this.suppressClickTabKey = null;
			this.suppressClickUntil = 0;
			return false;
		}
		this.suppressClickTabKey = null;
		this.suppressClickUntil = 0;
		return true;
	}

	private getRenderedTabs(): MainContentTab[] {
		return this.previewTabs ?? this.tabs;
	}

	private getDragGhostLeft(): number {
		const scroll = this.container.querySelector<HTMLElement>(".content-tabs-scroll");
		if (!scroll) return 0;
		const rect = scroll.getBoundingClientRect();
		return this.dragCurrentX - this.dragGrabOffsetX - rect.left + scroll.scrollLeft;
	}

	private scheduleOverflowMeasurement(): void {
		if (this.overflowMeasureFrame !== null) {
			cancelAnimationFrame(this.overflowMeasureFrame);
		}
		this.overflowMeasureFrame = requestAnimationFrame(() => {
			this.overflowMeasureFrame = null;
			const titleEls = this.container.querySelectorAll<HTMLElement>(".content-tab-title");
			titleEls.forEach((titleEl) => {
				const overflowing = titleEl.scrollWidth > titleEl.clientWidth + 1;
				titleEl.classList.toggle("overflowing", overflowing);
			});
		});
	}

	private renderTab(tab: MainContentTab, index: number, placeholder = false): ReturnType<typeof html> {
		const key = this.tabKey(tab);
		const color = this.tabColors[key] ?? "";
		const renderedTabs = this.getRenderedTabs();
		const nextTab = renderedTabs[index + 1] ?? null;
		const pinned = this.isTabPinned(tab);
		const pinnedBoundary = Boolean(pinned && (!nextTab || !this.isTabPinned(nextTab)));
		return html`
			<div
				class="content-tab ${this.activeId === tab.id ? "active" : ""} ${color ? "has-color" : ""} ${pinned ? "pinned" : ""} ${pinnedBoundary ? "pinned-boundary" : ""} ${placeholder ? "content-tab-placeholder" : ""}"
				style=${color ? `--content-tab-fill: ${color};` : ""}
				data-tab-key=${key}
				@contextmenu=${(e: MouseEvent) => this.openContext(tab, e)}
				@pointerdown=${(event: PointerEvent) => this.beginTabPointerInteraction(tab, event)}
			>
				${placeholder
					? html`<div class="content-tab-main content-tab-main-placeholder"></div>`
					: html`
						<button class="content-tab-main" @click=${() => {
							if (this.shouldSuppressTabClick(tab)) return;
							this.onSelect?.(tab.id);
						}} title=${tab.path || tab.title}>
							<span class="content-tab-title-wrap">
								<span class="content-tab-title ${tab.needsAttention ? "needs-attention" : ""}">${tab.title}</span>
							</span>
						</button>
						${tab.closable
							? html`<button class="content-tab-close" @click=${(event: Event) => {
								event.stopPropagation();
								this.onClose?.(tab.id);
							}} title="Close tab">✕</button>`
							: nothing}
					`}
			</div>
		`;
	}

	render(): void {
		const menuOpen = this.contextTabKey !== null;
		const contextTab = this.getContextTab();
		const renderedTabs = this.getRenderedTabs();
		const draggingTab = this.tabs.find((tab) => this.tabKey(tab) === this.draggingTabKey) ?? null;
		const dragGhostLeft = this.draggingTabKey ? this.getDragGhostLeft() : 0;

		const template = html`
			<div
				class="content-tabs-root ${this.draggingTabKey ? "is-dragging" : ""}"
				data-tauri-drag-region
				@click=${(e: Event) => {
					if (!menuOpen) return;
					const target = e.target instanceof Element ? e.target : null;
					if (target?.closest(".content-tab-context-menu")) return;
					this.closeContext();
				}}
			>
				<div class="content-tabs-scroll" data-tauri-drag-region>
					${renderedTabs.map((tab, index) => this.renderTab(tab, index, this.draggingTabKey === this.tabKey(tab)))}
					<button
						class="content-tabs-add-btn content-tab-add-inline"
						title="New tab"
						@click=${(event: Event) => {
							event.stopPropagation();
							this.onCreateTab?.();
						}}
					>
						＋
					</button>
					${draggingTab
						? html`
							<div
								class="content-tab content-tab-drag-ghost ${draggingTab.pinned ? "pinned" : ""} ${draggingTab.needsAttention ? "needs-attention" : ""} ${this.activeId === draggingTab.id ? "active" : ""}"
								style=${`left:${dragGhostLeft}px;width:${this.dragGhostWidth}px;${this.tabColors[this.tabKey(draggingTab)] ? `--content-tab-fill:${this.tabColors[this.tabKey(draggingTab)]};` : ""}`}
							>
								<div class="content-tab-main">
									<span class="content-tab-title-wrap">
										<span class="content-tab-title ${draggingTab.needsAttention ? "needs-attention" : ""}">${draggingTab.title}</span>
									</span>
								</div>
							</div>
						`
						: nothing}
				</div>

				<div class="content-tabs-trailing" data-tauri-drag-region>
					<button
						class="content-tabs-terminal-btn ${this.terminalActive ? "active" : ""}"
						title="Open terminal"
						@click=${(event: Event) => {
							event.stopPropagation();
							this.onOpenTerminal?.();
						}}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.2h10v9.6H3z"></path><path d="M5.1 6.2l1.9 1.8-1.9 1.8"></path><path d="M8.6 9.8h2.6"></path></svg>
					</button>
				</div>

				${this.contextTabKey
					? html`
						<div class="content-tab-context-menu" style=${`left:${this.contextX}px;top:${this.contextY}px`} @click=${(e: Event) => e.stopPropagation()}>
							<button class="content-tab-context-action" @click=${() => this.toggleContextTabPinned()}>
								${contextTab && this.isTabPinned(contextTab) ? "Unpin tab" : "Pin tab"}
							</button>
							<button class="content-tab-context-action" @click=${() => this.renameContextTab()}>Rename tab</button>
							<button class="content-tab-context-action" ?disabled=${!contextTab?.closable} @click=${() => this.closeContextTab()}>Close tab</button>
							<div class="content-tab-context-divider"></div>
							<div class="content-tab-context-title">Tab color</div>
							<div class="content-tab-context-colors">
								<button class="tab-color-swatch reset" title="Default" @click=${() => this.setTabColor(this.contextTabKey!, null)}>×</button>
								${COLOR_PRESETS.map(
									(color) => html`
										<button
											class="tab-color-swatch"
											style=${`--swatch:${color.value}`}
											title=${color.label}
											@click=${() => this.setTabColor(this.contextTabKey!, color.value)}
										></button>
									`,
								)}
							</div>
						</div>
					`
					: nothing}
			</div>
		`;

		render(template, this.container);
		this.scheduleOverflowMeasurement();
	}
}
