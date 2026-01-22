import { Component, signal, afterNextRender, Type, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RequestTabsComponent } from './request-tabs.component/request-tabs.component';
import { RequestDetailsComponent } from './request-details.component/request-details.component';
import { RequestUrlComponent } from './request-url.component/request-url.component';
import { PayloadTypesComponent } from './payload.types.component/payload.types.component';
import { BodyTypesComponent } from './body.types.component/body.types.component';
import { ResponseViewerComponent } from './response-viewer.component/response-viewer.component';
import { NgComponentOutlet } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';

@Component({
    selector: 'app-workspace',
    imports: [
        CommonModule,
        RequestTabsComponent,
        RequestDetailsComponent,
        RequestUrlComponent,
        PayloadTypesComponent,
        BodyTypesComponent,
        ResponseViewerComponent,
        NgComponentOutlet
    ],
    templateUrl: './workspace.component.html',
    styleUrl: './workspace.component.css',
    host: {
        '(document:mousemove)': 'onMouseMove($event)',
        '(document:mouseup)': 'onMouseUp()'
    }
})
export class WorkspaceComponent {
    authService = inject(AuthService);
    notificationService = inject(NotificationService);

    protected jsonComponent = signal<Type<any> | null>(null);
    requestHeight = signal<number>(450); // Pixel height
    isResizing = signal<boolean>(false);

    jsonData = {
        "products": [{
            "name": "car",
            "product": [{
                "name": "honda",
                "model": [
                    { "id": "civic", "name": "civic" },
                    { "id": "accord", "name": "accord" },
                    { "id": "crv", "name": "crv" },
                    { "id": "pilot", "name": "pilot" },
                    { "id": "odyssey", "name": "odyssey" }
                ]
            }]
        }]
    };

    constructor() {
        afterNextRender(async () => {
            try {
                const { JsonComponent } = await import('../../shared/json.component/json.component');
                this.jsonComponent.set(JsonComponent);
            } catch (error) {
            }
        });
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
            console.log("mouse Y", event.clientY);
            console.log("rect top", rect.top);
            console.log("tab height", tabHeight);
            console.log("new height", newHeight);

            // Constraints: Min 200px, Max (window height - response section buffer)
            const minHeight = 200;
            const maxHeight = window.innerHeight - 300;

            if (newHeight >= minHeight && newHeight <= maxHeight) {
                this.requestHeight.set(newHeight);
            }
        }
    }

    onMouseUp() {
        this.isResizing.set(false);
    }

    triggerNotification(message: string) {
        this.notificationService.notify(message);
    }

    toggleAuthModal() {
        this.authService.toggleAuthModal();
    }
}
