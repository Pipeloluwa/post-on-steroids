import { Component, signal, inject, PLATFORM_ID, ViewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RequestTabsComponent } from './request-tabs.component/request-tabs.component';
import { RequestDetailsComponent } from './request-details.component/request-details.component';
import { RequestUrlComponent } from './request-url.component/request-url.component';
import { PayloadTypesComponent } from './payload.types.component/payload.types.component';
import { CreateCapsuleModalComponent } from '../../shared/components/create-capsule.modal.component/create-capsule.modal.component';

import { ResponseViewerComponent } from './response-viewer.component/response-viewer.component';
import { MatIcon } from '@angular/material/icon';
import { AuthService } from '../../shared/services/auth.service';
import { NotificationService } from '../../shared/services/notification.service';
import { LocalStorageService } from '../../shared/services/local.storage.service';
import { TabStateService } from '../../shared/services/tab.state.service';

@Component({
    selector: 'app-workspace',
    imports: [
        CommonModule,
        FormsModule,
        RequestTabsComponent,
        RequestDetailsComponent,
        RequestUrlComponent,
        PayloadTypesComponent,
        ResponseViewerComponent,
        CreateCapsuleModalComponent,
        MatIcon
    ],
    templateUrl: './workspace.component.html',
    styleUrl: './workspace.component.css',
    host: {
        '(document:mousemove)': 'onMouseMove($event)',
        '(document:mouseup)': 'onMouseUp()',
        '(document:keydown)': 'handleKeyboardShortcuts($event)'
    }
})
export class WorkspaceComponent {
    private localStorageService = inject(LocalStorageService);
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);

    authService = inject(AuthService);
    notificationService = inject(NotificationService);
    tabStateService = inject(TabStateService);

    requestHeight = signal<number>(450); // Pixel height
    isResizing = signal<boolean>(false);


    isSidebarOpen = signal<boolean>(true);

    constructor() {
        const savedHeight = this.localStorageService.getItem(LocalStorageService.JSON_RESIZE_HEIGHT);
        if (savedHeight) {
            const height = parseInt(savedHeight, 10);
            if (!isNaN(height)) {
                this.requestHeight.set(this.clampHeight(height));
            }
        }
    }

    private clampHeight(height: number): number {
        const minHeight = 100; // Decreased to allow pulling the divider further up
        const screenHeight = this.isBrowser ? window.innerHeight : 1000;
        const maxHeight = Math.max(minHeight, screenHeight - 130);
        return Math.max(minHeight, Math.min(height, maxHeight));
    }

    startResizing(event: MouseEvent) {
        event.preventDefault();
        this.isResizing.set(true);
    }

    onMouseMove(event: MouseEvent) {
        if (!this.isResizing()) return;

        const container = document.querySelector('.workspace-container');
        if (container) {
            const rect = container.getBoundingClientRect();
            const tabHeight = 38;
            const newHeight = event.clientY - rect.top - tabHeight;
            this.requestHeight.set(this.clampHeight(newHeight));
        }
    }

    onMouseUp() {
        if (this.isResizing()) {
            this.isResizing.set(false);
            this.localStorageService.setItem(LocalStorageService.JSON_RESIZE_HEIGHT, this.requestHeight().toString());
        }
    }

    triggerNotification(message: string) {
        this.notificationService.notify(message);
    }

    toggleAuthModal() {
        this.authService.openAuthModal();
    }

    toggleSidebar() {
        this.isSidebarOpen.update(v => !v);
    }

    @ViewChild('createCapsuleModal') createCapsuleModal?: CreateCapsuleModalComponent;

    async onCapsuleChange(capsuleId: string) {
        if (capsuleId === '__create_new__') {
            this.createCapsuleModal?.open();
            return;
        }
        const capsule = this.tabStateService.capsules().find(c => c.id === capsuleId);
        if (capsule) {
            await this.tabStateService.switchCapsule(capsule);
        }
    }

    openCreateCapsuleModal() {
        this.createCapsuleModal?.open();
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

    openRequest(request: any) {
        this.tabStateService.addOpenTab(request);
        this.tabStateService.setActiveTab(request.id);
    }

    addNewRequest() {
        this.tabStateService.createAndOpenNewTab();
    }

    // Batch selection
    selectedRequestIds = signal<Set<string>>(new Set());
    isDeletingRequests = signal<boolean>(false);

    toggleSelectRequest(id: string, event: Event) {
        event.stopPropagation();
        const current = new Set(this.selectedRequestIds());
        if (current.has(id)) {
            current.delete(id);
        } else {
            current.add(id);
        }
        this.selectedRequestIds.set(current);
    }

    toggleSelectAllRequests() {
        const allReqs = this.tabStateService.allCapsuleRequests();
        if (this.selectedRequestIds().size === allReqs.length) {
            this.selectedRequestIds.set(new Set());
        } else {
            this.selectedRequestIds.set(new Set(allReqs.map(r => r.id)));
        }
    }

    async deleteRequestFromSidebar(request: any, event: Event) {
        event.stopPropagation();
        const displayName = this.tabStateService.resolveRequestTitle(request.name, request.url);
        const confirmMsg = `Are you sure you want to delete request "${displayName}"?`;
        if (!window.confirm(confirmMsg)) return;

        try {
            await this.tabStateService.deleteRequest(request.id);
            this.selectedRequestIds.update(set => {
                const next = new Set(set);
                next.delete(request.id);
                return next;
            });
            this.notificationService.notify(`Request "${displayName}" deleted.`);
        } catch (e: any) {
            this.notificationService.notify(`Failed to delete request: ${e.message || 'Error'}`);
        }
    }

    async batchDeleteSelectedRequests() {
        const ids = Array.from(this.selectedRequestIds());
        if (ids.length === 0) return;

        const confirmMsg = `Are you sure you want to delete ${ids.length} selected request(s)?`;
        if (!window.confirm(confirmMsg)) return;

        this.isDeletingRequests.set(true);
        try {
            await this.tabStateService.batchDeleteRequests(ids);
            this.selectedRequestIds.set(new Set());
            this.notificationService.notify(`Deleted ${ids.length} request(s) successfully.`);
        } catch (e: any) {
            this.notificationService.notify(`Failed to delete requests: ${e.message || 'Error'}`);
        } finally {
            this.isDeletingRequests.set(false);
        }
    }

    // Request Examples
    expandedExampleRequestId = signal<string | null>(null);
    requestExamplesMap = signal<Map<string, any[]>>(new Map());

    async toggleExamples(requestId: string, event: Event) {
        event.stopPropagation();
        if (this.expandedExampleRequestId() === requestId) {
            this.expandedExampleRequestId.set(null);
            return;
        }
        this.expandedExampleRequestId.set(requestId);
        const examples = await this.tabStateService.getExamples(requestId);
        this.requestExamplesMap.update(map => {
            const next = new Map(map);
            next.set(requestId, examples);
            return next;
        });
    }

    loadExample(example: any, event: Event) {
        event.stopPropagation();
        try {
            const snapshot = typeof example.requestSnapshot === 'string' ? JSON.parse(example.requestSnapshot) : example.requestSnapshot;
            const targetId = example.requestId || this.tabStateService.activeTabId();
            if (targetId) {
                this.tabStateService.updateState(targetId, snapshot);
                this.tabStateService.setActiveTab(targetId);
                this.notificationService.notify(`Loaded example "${example.name}".`);
            }
        } catch (e) {
            console.error('Failed to load example', e);
        }
    }

    async deleteExample(requestId: string, exampleId: string, event: Event) {
        event.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this example?')) return;
        await this.tabStateService.deleteExample(requestId, exampleId);
        const examples = await this.tabStateService.getExamples(requestId);
        this.requestExamplesMap.update(map => {
            const next = new Map(map);
            next.set(requestId, examples);
            return next;
        });
        this.notificationService.notify('Example deleted.');
    }

    formatRequestName(name: string): string {
        if (name.includes(' — ')) {
            return name.split(' — ')[1];
        }
        return name;
    }

    handleKeyboardShortcuts(event: KeyboardEvent) {
        if (!this.isBrowser) return;

        const target = event.target as HTMLElement;
        
        if (target?.closest('.monaco-editor')) {
            return;
        }

        if (target?.closest('.cdk-overlay-container') || target?.closest('app-utility-component') || target?.closest('app-swagger-import-modal') || target?.closest('app-variable-modal')) {
            return;
        }

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey;

        if (isCtrlOrCmd) {
            if (event.key.toLowerCase() === 's') {
                event.preventDefault();
                const activeId = this.tabStateService.activeTabId();
                if (activeId) {
                    if (!this.authService.isLoggedIn()) {
                        this.authService.openAuthModal();
                        this.notificationService.notify('Please sign in to save your request.');
                    } else {
                        this.tabStateService.saveToCapsule(activeId);
                        this.notificationService.notify('Request saved successfully!');
                    }
                }
            } else if (event.key.toLowerCase() === 'z') {
                if (event.shiftKey) {
                    this.tabStateService.redo();
                } else {
                    this.tabStateService.undo();
                }
                event.preventDefault();
            } else if (event.key.toLowerCase() === 'y' && !isMac) {
                this.tabStateService.redo();
                event.preventDefault();
            }
        }
    }
}
