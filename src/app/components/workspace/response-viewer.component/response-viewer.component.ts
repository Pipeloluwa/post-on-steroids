import { Component, signal, Type, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/scrollable.select.component/scrollable.select.component';


@Component({
    selector: 'app-response-viewer-component',
    standalone: true,
    imports: [CommonModule, MatIcon, ScrollableSelectComponent],
    templateUrl: './response-viewer.component.html',
    styleUrl: './response-viewer.component.css'
})
export class ResponseViewerComponent {
    protected jsonComponent = signal<Type<any> | null>(null);

    constructor() {
        afterNextRender(async () => {
            try {
                const { JsonComponent } = await import('../../../shared/json.component/json.component');
                this.jsonComponent.set(JsonComponent);
            } catch (error) {

            }
        });
    }

    activeTab = signal('Body');
    activeMode = signal('Pretty');
    responseType = signal('JSON');
    responseTypes = signal(['JSON', 'XML']);


    mockResponse = signal({
        "title": "Operation Successful",
        "responseCode": "01",
        "message": "Request successful",
        "data": []
    });

    tabs = [
        { name: 'Body', count: null },
        { name: 'Cookies', count: null },
        { name: 'Headers', count: 6 },
        { name: 'Test Results', count: null }
    ];

    setTab(tab: string) {
        this.activeTab.set(tab);
    }

    setMode(mode: string) {
        this.activeMode.set(mode);
    }

    setResponseType(type: string) {
        this.responseType.set(type);
    }

    copyResponse() {
        const data = JSON.stringify(this.mockResponse(), null, 2);
        navigator.clipboard.writeText(data);
        // Optional: show a toast or feedback
    }
}
