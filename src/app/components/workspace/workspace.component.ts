import { Component, signal, afterNextRender, Type, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RequestTabsComponent } from './request-tabs.component/request-tabs.component';
import { RequestDetailsComponent } from './request-details.component/request-details.component';
import { RequestUrlComponent } from './request-url.component/request-url.component';
import { PayloadTypesComponent } from './payload.types.component/payload.types.component';

import { ResponseViewerComponent } from './response-viewer.component/response-viewer.component';
import { NgComponentOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { AuthService } from '../../shared/services/auth.service';
import { NotificationService } from '../../shared/services/notification.service';
import { LocalStorageService } from '../../shared/services/local.storage.service';
import { TabStateService } from '../../shared/services/tab.state.service';
import { computed } from '@angular/core';

@Component({
    selector: 'app-workspace',
    imports: [
        CommonModule,
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
        const minHeight = 200;
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
}
