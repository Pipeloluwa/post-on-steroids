import { Component, signal, computed, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/scrollable.select.component/scrollable.select.component';

interface RequestTab {
    id: string;
    method: string;
    name: string;
    isDirty: boolean;
}

@Component({
    standalone: true,
    selector: 'app-request-tabs-component',
    imports: [CommonModule, MatIcon, ScrollableSelectComponent],
    templateUrl: './request-tabs.component.html',
    styleUrl: './request-tabs.component.css',
})
export class RequestTabsComponent {
    tabs = signal<RequestTab[]>([
        { id: '1', method: 'POST', name: 'http://acegeld.runasp.net/login', isDirty: true },
        { id: '2', method: 'POST', name: 'http://acegeld.runasp.net/registration', isDirty: false },
        { id: '3', method: 'GET', name: 'https://api.example.com/...', isDirty: true },
        { id: '4', method: 'POST', name: 'http://local.dev/...', isDirty: false },
        { id: '5', method: 'POST', name: 'http://server.com/...', isDirty: false },
        { id: '6', method: 'POST', name: 'http://api.v2/...', isDirty: false },
        { id: '7', method: 'GET', name: 'https://prod.env/...', isDirty: false },
        { id: '8', method: 'POST', name: 'http://test.api/...', isDirty: false },
        { id: '9', method: 'PUT', name: 'https://update.me/...', isDirty: false },
        { id: '10', method: 'DEL', name: 'https://delete.it/...', isDirty: false },
        { id: '11', method: 'POST', name: 'http://acegeld.runasp.net/login', isDirty: true },
        { id: '12', method: 'POST', name: 'http://acegeld.runasp.net/registration', isDirty: false },
        { id: '13', method: 'GET', name: 'https://api.example.com/...', isDirty: true },
        { id: '14', method: 'POST', name: 'http://local.dev/...', isDirty: false },
        { id: '15', method: 'POST', name: 'http://server.com/...', isDirty: false },
        { id: '16', method: 'POST', name: 'http://api.v2/...', isDirty: false },
        { id: '17', method: 'GET', name: 'https://prod.env/...', isDirty: false },
        { id: '18', method: 'POST', name: 'http://test.api/...', isDirty: false },
        { id: '19', method: 'PUT', name: 'https://update.me/...', isDirty: false },
        { id: '20', method: 'DEL', name: 'https://delete.it/...', isDirty: false },
    ]);

    activeTabId = signal<string>('4');
    autoAuthEnabled = signal<boolean>(true);

    historyStack = signal<string[]>(['4']);
    historyIndex = signal<number>(0);

    endpoints = computed(() => this.tabs().map(t => t.name));

    @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

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

        this.activeTabId.set(id);

        if (!isHistoryNav) {
            // New navigation, clear forward history
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
        if (currentTabs.length === 1) return; // Keep at least one tab

        const tabIndex = currentTabs.findIndex(t => t.id === id);
        const filteredTabs = currentTabs.filter(t => t.id !== id);
        this.tabs.set(filteredTabs);

        if (this.activeTabId() === id) {
            // Focus previous or next tab
            const newActiveTab = filteredTabs[tabIndex] || filteredTabs[tabIndex - 1];
            if (newActiveTab) {
                this.activeTabId.set(newActiveTab.id);
            }
        }
    }

    toggleAutoAuth() {
        this.autoAuthEnabled.update(v => !v);
    }

    scrollLeft() {
        if (this.scrollContainer) {
            this.scrollContainer.nativeElement.scrollBy({ left: -200, behavior: 'smooth' });
        }
    }

    scrollRight() {
        if (this.scrollContainer) {
            this.scrollContainer.nativeElement.scrollBy({ left: 200, behavior: 'smooth' });
        }
    }

    selectEndpoint(endpoint: string) {
        const tab = this.tabs().find(t => t.name === endpoint);
        if (tab) {
            this.activeTabId.set(tab.id);
            const activeEl = this.scrollContainer.nativeElement.querySelector(`#tab${tab.id}`);
            if (activeEl) {
                activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }

            // Wait for DOM update then scroll to active tab
            // setTimeout(() => {
            //     const activeEl = this.scrollContainer.nativeElement.querySelector(`#tab${tab.id}`);
            //     if (activeEl) {
            //         activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            //     }
            // }, 0);
        }
    }

    addTab() {
        const newId = (this.tabs().length + 1).toString();
        this.tabs.update(t => [...t, {
            id: newId,
            method: 'GET',
            name: 'New Request',
            isDirty: false
        }]);
        this.activeTabId.set(newId);

        // Scroll to the end
        setTimeout(() => {
            if (this.scrollContainer) {
                this.scrollContainer.nativeElement.scrollTo({ left: this.scrollContainer.nativeElement.scrollWidth, behavior: 'smooth' });
            }
        }, 0);
    }
}
