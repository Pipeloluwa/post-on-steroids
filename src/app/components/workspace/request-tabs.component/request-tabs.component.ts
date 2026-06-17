import { Component, signal, computed, inject, ViewChild, ElementRef, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { CdkDragDrop, DragDropModule, CdkDragMove } from '@angular/cdk/drag-drop';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { VariableModalComponent } from '../../../shared/components/variable.modal.component/variable.modal.component';
import { SwaggerImportModalComponent } from '../../../shared/components/swagger-import.modal.component/swagger-import.modal.component';
import { VariableService } from '../../../shared/services/variable.service';
import { TabStateService } from '../../../shared/services/tab.state.service';
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
})
export class RequestTabsComponent {
    variableService = inject(VariableService);
    tabStateService = inject(TabStateService);
    @ViewChild('variableModal') variableModal!: VariableModalComponent;
    @ViewChild('swaggerModal') swaggerModal!: SwaggerImportModalComponent;

    tabs = computed<RequestTab[]>(() => {
        return this.tabStateService.getAllOpenTabs().map(state => {
            let name = state.name;
            if (name.includes(' — ')) {
                name = name.split(' — ')[1];
            }
            return {
                id: state.id,
                method: state.method,
                name: name,
                isDirty: state.isDirty,
            };
        });
    });

    activeTabId = this.tabStateService.activeTabId;

    historyStack = signal<string[]>([]);
    historyIndex = signal<number>(-1);

    canScrollLeft = signal<boolean>(false);
    canScrollRight = signal<boolean>(true);

    endpoints = computed(() => this.tabs().map(t => t.name));

    /** Get the current method for a tab from the persisted service state */
    getTabMethod(tabId: string): string {
        return this.tabStateService.getState(tabId)?.method ?? 'GET';
    }

    @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

    constructor() {
        effect(() => {
            const activeId = this.tabStateService.activeTabId();
            if (activeId && !this.historyStack().includes(activeId)) {
                const currentStack = this.historyStack().slice(0, this.historyIndex() + 1);
                this.historyStack.set([...currentStack, activeId]);
                this.historyIndex.set(this.historyStack().length - 1);
            }
        });

        effect(() => {
            const activeId = this.tabStateService.activeTabId();
            if (activeId && this.scrollContainer) {
                this.scrollToTab(activeId);
            }
        });

        afterNextRender(() => {
            this.updateScrollState();
            this.scrollContainer.nativeElement.addEventListener('scroll', () => {
                this.updateScrollState();
            });
        });
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

    setActiveTab(id: string, isHistoryNav: boolean = false) {
        if (this.activeTabId() === id) return;

        this.tabStateService.setActiveTab(id);

        if (!isHistoryNav) {
            const currentStack = this.historyStack().slice(0, this.historyIndex() + 1);
            this.historyStack.set([...currentStack, id]);
            this.historyIndex.set(this.historyStack().length - 1);
        }
    }

    goBack() {
        if (this.historyIndex() > 0) {
            this.historyIndex.update(i => i - 1);
            const prevTabId = this.historyStack()[this.historyIndex()];
            this.setActiveTab(prevTabId, true);
            this.scrollToTab(prevTabId);
        }
    }

    goForward() {
        if (this.historyIndex() < this.historyStack().length - 1) {
            this.historyIndex.update(i => i + 1);
            const nextTabId = this.historyStack()[this.historyIndex()];
            this.setActiveTab(nextTabId, true);
            this.scrollToTab(nextTabId);
        }
    }

    private scrollToTab(id: string) {
        setTimeout(() => {
            const activeEl = this.scrollContainer.nativeElement.querySelector(`#tab${id}`);
            if (activeEl) {
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }, 0);
    }

    closeTab(id: string, event: Event) {
        event.stopPropagation();
        const currentTabs = this.tabs();
        if (currentTabs.length === 1) return;

        const tabIndex = currentTabs.findIndex(t => t.id === id);
        this.tabStateService.closeTab(id);

        if (this.activeTabId() === id) {
            const newTab = this.tabs()[tabIndex] || this.tabs()[tabIndex - 1];
            if (newTab) {
                this.tabStateService.setActiveTab(newTab.id);
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
        if (!this.scrollContainer) return;
        
        const container = this.scrollContainer.nativeElement;
        const rect = container.getBoundingClientRect();
        
        // Use pointer position to determine if we're near the edge
        const pointerX = event.pointerPosition.x;
        const edgeThreshold = 60;
        const scrollSpeed = 25;
        
        if (pointerX < rect.left + edgeThreshold) {
            container.scrollLeft -= scrollSpeed;
        } else if (pointerX > rect.right - edgeThreshold) {
            container.scrollLeft += scrollSpeed;
        }
    }

    scrollLeft() {
        if (this.scrollContainer) {
            this.scrollContainer.nativeElement.scrollBy({ left: -200, behavior: 'smooth' });
            setTimeout(() => this.updateScrollState(), 300);
        }
    }

    scrollRight() {
        if (this.scrollContainer) {
            this.scrollContainer.nativeElement.scrollBy({ left: 200, behavior: 'smooth' });
            setTimeout(() => this.updateScrollState(), 300);
        }
    }

    selectEndpoint(endpoint: string) {
        const tab = this.tabs().find(t => t.name === endpoint);
        if (tab) {
            this.tabStateService.setActiveTab(tab.id);
            const activeEl = this.scrollContainer.nativeElement.querySelector(`#tab${tab.id}`);
            if (activeEl) {
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }
    }

    addTab() {
        const newId = Date.now().toString();
        this.tabStateService.setActiveTab(newId);

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
