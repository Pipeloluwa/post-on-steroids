import { Component, signal, computed, inject, ViewChild, ElementRef, afterNextRender, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule, CdkDragMove } from '@angular/cdk/drag-drop';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { VariableModalComponent } from '../../../shared/components/variable.modal.component/variable.modal.component';
import { SwaggerImportModalComponent } from '../../../shared/components/swagger-import.modal.component/swagger-import.modal.component';
import { VariableService } from '../../../shared/services/variable.service';
import { TabStateService } from '../../../shared/services/tab.state.service';
import { AuthService } from '../../../shared/services/auth.service';
import { effect } from '@angular/core';

interface RequestTab {
    id: string;
    method: string;
    name: string;
    isDirty: boolean;
}

@Component({
    selector: 'app-request-tabs-component',
    imports: [CommonModule, MatIcon, DragDropModule, ScrollableSelectComponent, VariableModalComponent, SwaggerImportModalComponent],
    templateUrl: './request-tabs.component.html',
    styleUrl: './request-tabs.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RequestTabsComponent {
    variableService = inject(VariableService);
    tabStateService = inject(TabStateService);
    authService = inject(AuthService);
    private destroyRef = inject(DestroyRef);
    @ViewChild('variableModal') variableModal!: VariableModalComponent;
    @ViewChild('swaggerModal') swaggerModal!: SwaggerImportModalComponent;

    tabs = computed<RequestTab[]>(() => {
        return this.tabStateService.getAllOpenTabs().map(state => {
            const name = this.tabStateService.resolveRequestTitle(state.name, state.url);
            return {
                id: state.id,
                method: state.method,
                name: name,
                isDirty: state.isDirty,
            };
        });
    });

    activeTabId = this.tabStateService.activeTabId;
    isTabsLoading = computed(() => this.tabStateService.isCapsuleLoading());

    readonly skeletonTabs = [1, 2, 3];

    // Right click context menu state
    contextMenu = signal<{ isOpen: boolean; x: number; y: number; tabId: string | null }>({
        isOpen: false,
        x: 0,
        y: 0,
        tabId: null
    });

    onTabContextMenu(event: MouseEvent, tabId: string) {
        event.preventDefault();
        event.stopPropagation();
        this.contextMenu.set({
            isOpen: true,
            x: event.clientX,
            y: event.clientY,
            tabId
        });
    }

    closeContextMenu() {
        if (this.contextMenu().isOpen) {
            this.contextMenu.set({ isOpen: false, x: 0, y: 0, tabId: null });
        }
    }

    onCloseTabFromContext(event: Event) {
        event.stopPropagation();
        const tabId = this.contextMenu().tabId;
        if (tabId) {
            this.closeTab(tabId, event);
        }
        this.closeContextMenu();
    }

    onCloseOtherTabsFromContext(event: Event) {
        event.stopPropagation();
        const tabId = this.contextMenu().tabId;
        if (tabId) {
            this.tabStateService.closeOtherTabs(tabId);
        }
        this.closeContextMenu();
    }

    onCloseAllTabsFromContext(event: Event) {
        event.stopPropagation();
        this.tabStateService.closeAllTabs();
        this.closeContextMenu();
    }

    onDuplicateTabFromContext(event: Event) {
        event.stopPropagation();
        const tabId = this.contextMenu().tabId;
        if (tabId) {
            this.duplicateTab(tabId, event);
        }
        this.closeContextMenu();
    }

    onNewTabLeftFromContext(event: Event) {
        event.stopPropagation();
        const tabId = this.contextMenu().tabId;
        if (tabId) {
            const index = this.tabStateService.openTabIds().indexOf(tabId);
            if (index !== -1) {
                this.tabStateService.createAndOpenNewTab(index);
                this.scrollToActiveTab();
            }
        }
        this.closeContextMenu();
    }

    onNewTabRightFromContext(event: Event) {
        event.stopPropagation();
        const tabId = this.contextMenu().tabId;
        if (tabId) {
            const index = this.tabStateService.openTabIds().indexOf(tabId);
            if (index !== -1) {
                this.tabStateService.createAndOpenNewTab(index + 1);
                this.scrollToActiveTab();
            }
        }
        this.closeContextMenu();
    }

    private scrollToActiveTab() {
        setTimeout(() => {
            const activeId = this.tabStateService.activeTabId();
            if (activeId) {
                this.scrollToTab(activeId);
                setTimeout(() => this.updateScrollState(), 300);
            }
        }, 0);
    }

    canGoBack = this.tabStateService.canNavigateBack;
    canGoForward = this.tabStateService.canNavigateForward;

    canScrollLeft = signal<boolean>(false);
    canScrollRight = signal<boolean>(true);
    isMouseOverTabs = false;
    private isWheelScrolling = false;
    private targetScrollLeft = 0;
    private wheelAnimFrameId: number | null = null;
    private lastAnimTime = 0;

    endpoints = computed(() => this.tabs().map(t => t.name));

    /** Get the current method for a tab from the persisted service state */
    getTabMethod(tabId: string): string {
        return this.tabStateService.getState(tabId)?.method ?? 'GET';
    }

    @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

    constructor() {
        

        effect(() => {
            const loading = this.isTabsLoading();
            const tabCount = this.tabs().length;
            const activeId = this.tabStateService.activeTabId();
            if (!loading && this.scrollContainer) {
                setTimeout(() => {
                    this.updateScrollState();
                    if (activeId && tabCount > 0) {
                        this.scrollToTab(activeId);
                    }
                }, 0);
            }
        });

        afterNextRender(() => {
            this.updateScrollState();
            const el = this.scrollContainer?.nativeElement;
            if (!el) return;

            const scrollHandler = () => {
                if (!this.isWheelScrolling && this.scrollContainer) {
                    this.targetScrollLeft = this.scrollContainer.nativeElement.scrollLeft;
                }
                this.updateScrollState();
            };
            const wheelHandler = (event: WheelEvent) => this.onWheel(event);
            const mouseEnterHandler = () => this.onTabsMouseEnter();
            const mouseLeaveHandler = () => this.onTabsMouseLeave();

            el.addEventListener('scroll', scrollHandler, { passive: true });
            el.addEventListener('wheel', wheelHandler, { passive: false });
            el.addEventListener('mouseenter', mouseEnterHandler, { passive: true });
            el.addEventListener('mouseleave', mouseLeaveHandler, { passive: true });

            this.destroyRef.onDestroy(() => {
                this.stopWheelAnimation();
                el.removeEventListener('scroll', scrollHandler);
                el.removeEventListener('wheel', wheelHandler);
                el.removeEventListener('mouseenter', mouseEnterHandler);
                el.removeEventListener('mouseleave', mouseLeaveHandler);
            });
        });
    }

    private stopWheelAnimation() {
        if (this.wheelAnimFrameId !== null) {
            cancelAnimationFrame(this.wheelAnimFrameId);
            this.wheelAnimFrameId = null;
        }
        this.isWheelScrolling = false;
        this.lastAnimTime = 0;
    }

    onTabsMouseEnter() {
        this.isMouseOverTabs = true;
        if (this.scrollContainer && !this.isWheelScrolling) {
            this.targetScrollLeft = this.scrollContainer.nativeElement.scrollLeft;
        }
    }

    onTabsMouseLeave() {
        this.isMouseOverTabs = false;
    }

    onWheel(event: WheelEvent) {
        // Horizontal tab scrolling only affects when mouse has entered the horizontal tabs region
        if (!this.isMouseOverTabs || !this.scrollContainer) return;
        const el = this.scrollContainer.nativeElement;

        // Verify the cursor is physically inside the horizontal tabs bounding rectangle
        const rect = el.getBoundingClientRect();
        if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        ) {
            this.isMouseOverTabs = false;
            return;
        }

        // If tabs do not overflow horizontally, allow standard parent horizontal scrolling
        const maxScrollLeft = el.scrollWidth - el.clientWidth;
        if (maxScrollLeft <= 1) return;

        // Honor trackpad horizontal gesture if present; otherwise translate vertical mouse wheel into horizontal scroll
        const isHorizontalGesture = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        const rawDelta = isHorizontalGesture ? event.deltaX : event.deltaY;
        if (rawDelta === 0) return;

        // Normalize delta based on deltaMode (0: pixels, 1: lines, 2: pages)
        const multiplier = event.deltaMode === 1 ? 33 : (event.deltaMode === 2 ? el.clientWidth : 1);
        const scrollDelta = rawDelta * multiplier;

        // Sync baseline target with current scroll position if idle or reversing direction
        if (!this.isWheelScrolling) {
            this.targetScrollLeft = el.scrollLeft;
        } else {
            const isMovingLeft = this.targetScrollLeft < el.scrollLeft;
            const isMovingRight = this.targetScrollLeft > el.scrollLeft;
            if ((scrollDelta > 0 && isMovingLeft) || (scrollDelta < 0 && isMovingRight)) {
                this.targetScrollLeft = el.scrollLeft;
            }
        }

        const isAtLeft = el.scrollLeft <= 0 && this.targetScrollLeft <= 0;
        const isAtRight = el.scrollLeft >= maxScrollLeft - 1 && this.targetScrollLeft >= maxScrollLeft - 1;

        // If tabs are already at the boundary edge in the requested direction,
        // do NOT prevent default so general parent horizontal scrolling (e.g. on small window) functions naturally
        if ((scrollDelta < 0 && isAtLeft) || (scrollDelta > 0 && isAtRight)) {
            return;
        }

        // Only prevent default and consume event when within bounds and actively scrolling the tabs
        event.preventDefault();

        // Accumulate target scroll position clamped to container bounds
        this.targetScrollLeft = Math.max(0, Math.min(maxScrollLeft, this.targetScrollLeft + scrollDelta));

        if (!this.isWheelScrolling) {
            this.isWheelScrolling = true;
            this.lastAnimTime = performance.now();
            this.wheelAnimFrameId = requestAnimationFrame((t) => this.animateScroll(t));
        }
    }

    private animateScroll(timestamp: number) {
        if (!this.scrollContainer) {
            this.stopWheelAnimation();
            return;
        }
        const el = this.scrollContainer.nativeElement;
        const diff = this.targetScrollLeft - el.scrollLeft;

        // If within sub-pixel threshold of target, snap and end animation
        if (Math.abs(diff) < 0.75) {
            el.scrollLeft = this.targetScrollLeft;
            this.updateScrollState();
            this.stopWheelAnimation();
            return;
        }

        const dt = this.lastAnimTime ? Math.min(0.05, (timestamp - this.lastAnimTime) / 1000) : 0.016;
        this.lastAnimTime = timestamp;

        // Frame-rate independent exponential smoothing (lambda = 15 yields a silky ~150-180ms glide)
        const factor = 1 - Math.exp(-15 * dt);
        const step = diff * factor;

        const minStep = 0.5 * Math.sign(diff);
        const appliedStep = Math.abs(step) < Math.abs(minStep) ? minStep : step;

        el.scrollLeft += appliedStep;
        this.updateScrollState();

        this.wheelAnimFrameId = requestAnimationFrame((t) => this.animateScroll(t));
    }

    updateScrollState() {
        if (!this.scrollContainer) return;
        const el = this.scrollContainer.nativeElement;
        this.canScrollLeft.set(el.scrollLeft > 0);
        this.canScrollRight.set(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    }

    getMethodColor(method: string): string {
        switch (method.toUpperCase()) {
            case 'GET': return '#00BF8E';
            case 'POST': return '#FFB400';
            case 'PUT': return '#097BED';
            case 'DEL':
            case 'DELETE': return '#FF5233';
            default: return 'var(--postonsteroids-text-primary)';
        }
    }

    setActiveTab(id: string) {
        if (this.activeTabId() === id) return;
        this.tabStateService.setActiveTab(id);
    }

    goBack() {
        const targetId = this.tabStateService.navigateBack();
        if (targetId) {
            this.scrollToTab(targetId);
        }
    }

    goForward() {
        const targetId = this.tabStateService.navigateForward();
        if (targetId) {
            this.scrollToTab(targetId);
        }
    }

    private scrollToTab(id: string) {
        this.stopWheelAnimation();
        setTimeout(() => {
            if (!this.scrollContainer) return;
            const container = this.scrollContainer.nativeElement;
            const activeEl = container.querySelector<HTMLElement>(`#tab${id}`);
            if (activeEl) {
                const targetLeft = activeEl.offsetLeft - container.clientWidth / 2 + activeEl.offsetWidth / 2;
                container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
            }
        }, 0);
    }

    closeTab(id: string, event: Event) {
        event.stopPropagation();
        const currentTabs = this.tabs();

        const tabIndex = currentTabs.findIndex(t => t.id === id);
        this.tabStateService.closeTab(id);

        if (this.activeTabId() === id) {
            const remaining = this.tabs();
            const newTab = remaining[tabIndex] || remaining[tabIndex - 1] || null;
            if (newTab) {
                this.tabStateService.setActiveTab(newTab.id);
            } else {
                this.tabStateService.activeTabId.set(null);
            }
        }

        setTimeout(() => this.updateScrollState(), 50);
    }

    duplicateTab(id: string, event: Event) {
        event.stopPropagation();
        const duplicateId = this.tabStateService.duplicateTab(id);
        if (duplicateId) {
            setTimeout(() => {
                this.scrollToTab(duplicateId);
                this.updateScrollState();
            }, 50);
        }
    }

    dropTab(event: CdkDragDrop<RequestTab[]>) {
        this.tabStateService.reorderOpenTabs(event.previousIndex, event.currentIndex);
        setTimeout(() => this.updateScrollState(), 50);
    }

    onDragMoved(event: CdkDragMove<any>) {
        this.stopWheelAnimation();
        if (!this.scrollContainer) return;

        const container = this.scrollContainer.nativeElement;
        const rect = container.getBoundingClientRect();

        // Use pointer position to determine if we're near the edge
        const pointerX = event.pointerPosition.x;
        const edgeThreshold = 80;
        const scrollSpeed = 50;

        if (pointerX < rect.left + edgeThreshold) {
            container.scrollLeft -= scrollSpeed;
        } else if (pointerX > rect.right - edgeThreshold) {
            container.scrollLeft += scrollSpeed;
        }
    }

    scrollLeft() {
        this.stopWheelAnimation();
        if (this.scrollContainer) {
            this.scrollContainer.nativeElement.scrollBy({ left: -200, behavior: 'smooth' });
            setTimeout(() => this.updateScrollState(), 300);
        }
    }

    scrollRight() {
        this.stopWheelAnimation();
        if (this.scrollContainer) {
            this.scrollContainer.nativeElement.scrollBy({ left: 200, behavior: 'smooth' });
            setTimeout(() => this.updateScrollState(), 300);
        }
    }

    selectEndpoint(endpoint: string) {
        const tab = this.tabs().find(t => t.name === endpoint);
        if (tab) {
            this.tabStateService.setActiveTab(tab.id);
            this.scrollToTab(tab.id);
        }
    }

    addTab() {
        this.stopWheelAnimation();
        const newId = this.tabStateService.createAndOpenNewTab();

        setTimeout(() => {
            if (this.scrollContainer) {
                this.scrollContainer.nativeElement.scrollTo({ left: this.scrollContainer.nativeElement.scrollWidth, behavior: 'smooth' });
                setTimeout(() => this.updateScrollState(), 300);
            }
        }, 0);
    }

    openVariableModal() {
        this.variableModal.isOpen.set(true);
    }
}
