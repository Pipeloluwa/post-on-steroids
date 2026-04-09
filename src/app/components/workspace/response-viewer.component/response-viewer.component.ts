import { Component, signal, computed, inject, Type, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { TabStateService } from '../../../shared/services/tab.state.service';
import { ChangeDetectionStrategy } from '@angular/core';

@Component({
    selector: 'app-response-viewer-component',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormsModule, MatIcon, ScrollableSelectComponent],
    templateUrl: './response-viewer.component.html',
    styleUrl: './response-viewer.component.css'
})
export class ResponseViewerComponent {
    protected jsonComponent = signal<Type<unknown> | null>(null);
    tabStateService = inject(TabStateService);

    constructor() {
        afterNextRender(async () => {
            try {
                const { JsonComponent } = await import('../../../shared/components/json.component/json.component');
                this.jsonComponent.set(JsonComponent);
            } catch {
                // lazy load failure – silent
            }
        });
    }

    activeTab = signal('Body');
    activeMode = signal('Pretty');
    responseType = signal('JSON');
    responseTypes = signal(['JSON', 'XML']);

    // ── Derived from active tab state ──────────────────────────────────────
    responseBody = computed(() => this.tabStateService.activeTabState()?.responseBody ?? null);
    responseStatus = computed(() => this.tabStateService.activeTabState()?.responseStatus ?? null);
    responseTime = computed(() => this.tabStateService.activeTabState()?.responseTime ?? null);
    responseSize = computed(() => this.tabStateService.activeTabState()?.responseSize ?? null);
    responseCookies = computed(() => this.tabStateService.activeTabState()?.responseCookies ?? []);
    responseHeaders = computed(() => this.tabStateService.activeTabState()?.responseHeaders ?? []);
    testResults = computed(() => this.tabStateService.activeTabState()?.testResults ?? []);

    hasResponse = computed(() => this.responseStatus() !== null);

    passedTests = computed(() => this.testResults().filter(t => t.passed).length);
    failedTests = computed(() => this.testResults().filter(t => !t.passed).length);

    tabs = computed(() => [
        { name: 'Body', count: null },
        { name: 'Cookies', count: this.responseCookies().length || null },
        { name: 'Headers', count: this.responseHeaders().filter(h => h.enabled).length || null },
        { name: 'Test Results', count: this.testResults().length || null },
        { name: 'Script Console', count: null },
    ]);

    // Script Console tab state
    activeScriptConsoleTab = signal<'preRequest' | 'postResponse'>('postResponse');
    scriptConsoleOptions = ['Pre-request Script', 'Post-response Script'];
    displayScriptConsoleTab = computed(() => this.activeScriptConsoleTab() === 'preRequest' ? 'Pre-request Script' : 'Post-response Script');
    activeScriptConsoleOutput = computed(() => {
        const scripts = this.tabStateService.activeTabState()?.scripts;
        if (!scripts) return '';
        return this.activeScriptConsoleTab() === 'preRequest' ? scripts.preRequestConsole : scripts.postResponseConsole;
    });

    setScriptConsoleTab(option: string) {
        if (option === 'Pre-request Script') this.activeScriptConsoleTab.set('preRequest');
        else if (option === 'Post-response Script') this.activeScriptConsoleTab.set('postResponse');
    }

    statusColor = computed(() => {
        const s = this.responseStatus();
        if (s === null) return '';
        if (s >= 200 && s < 300) return 'text-green-500 bg-green-500/10';
        if (s >= 300 && s < 400) return 'text-yellow-400 bg-yellow-400/10';
        if (s >= 400 && s < 500) return 'text-orange-400 bg-orange-400/10';
        return 'text-red-500 bg-red-500/10';
    });

    statusLabel = computed(() => {
        const s = this.responseStatus();
        if (s === null) return '';
        const labels: Record<number, string> = {
            200: 'OK', 201: 'Created', 204: 'No Content',
            301: 'Moved', 302: 'Found', 304: 'Not Modified',
            400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
            500: 'Server Error', 503: 'Unavailable',
        };
        return `${s} ${labels[s] ?? ''}`.trim();
    });

    formattedSize = computed(() => {
        const b = this.responseSize();
        if (b === null) return '';
        if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
        if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
        return `${b} B`;
    });

    setTab(tab: string) { this.activeTab.set(tab); }
    setMode(mode: string) { this.activeMode.set(mode); }
    setResponseType(type: string) { this.responseType.set(type); }

    copyResponse() {
        const data = JSON.stringify(this.responseBody(), null, 2);
        navigator.clipboard.writeText(data);
    }
}
