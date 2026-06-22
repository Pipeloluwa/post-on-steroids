import { Component, signal, inject, PLATFORM_ID, HostListener } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RequestTabsComponent } from './request-tabs.component/request-tabs.component';
import { RequestDetailsComponent } from './request-details.component/request-details.component';
import { RequestUrlComponent } from './request-url.component/request-url.component';
import { PayloadTypesComponent } from './payload.types.component/payload.types.component';

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
        MatIcon
    ],
    templateUrl: './workspace.component.html',
    styleUrl: './workspace.component.css',
    host: {
        '(document:mousemove)': 'onMouseMove($event)',
        '(document:mouseup)': 'onMouseUp()'
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
        this.authService.toggleAuthModal();
    }

    toggleSidebar() {
        this.isSidebarOpen.update(v => !v);
    }

    onCapsuleChange(capsuleId: string) {
        const capsule = this.tabStateService.capsules().find(c => c.id === capsuleId);
        if (capsule) {
            this.tabStateService.switchCapsule(capsule);
        }
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

    closeTabFromSidebar(id: string, event: Event) {
        event.stopPropagation();
        const tabs = this.tabStateService.openTabs();
        if (tabs.length === 1) return; // never close the last tab
        this.tabStateService.closeTab(id);
        if (this.tabStateService.activeTabId() === id) {
            const remaining = this.tabStateService.openTabs();
            if (remaining.length > 0) {
                this.tabStateService.setActiveTab(remaining[0].id);
            }
        }
    }

    formatRequestName(name: string): string {
        if (name.includes(' — ')) {
            return name.split(' — ')[1];
        }
        return name;
    }

    @HostListener('document:keydown', ['$event'])
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
            if (event.key.toLowerCase() === 'z') {
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
