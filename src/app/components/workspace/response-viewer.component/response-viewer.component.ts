import { Component, signal, computed, inject, ViewChild, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { TabStateService } from '../../../shared/services/tab.state.service';
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor.component/monaco-editor.component';

import { VariableService } from '../../../shared/services/variable.service';
import { NotificationService } from '../../../shared/services/notification.service';

import { WrapStyle, WRAP_STYLE_OPTIONS, formatBodyByStyle } from '../../../shared/utils/format.utils';

@Component({
    selector: 'app-response-viewer-component',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormsModule, MatIcon, ScrollableSelectComponent, MonacoEditorComponent],
    templateUrl: './response-viewer.component.html',
    styleUrl: './response-viewer.component.css'
})
export class ResponseViewerComponent {
    tabStateService = inject(TabStateService);
    private variableService = inject(VariableService);
    private notificationService = inject(NotificationService);

    activeTab = signal('Body');
    activeMode = signal('Pretty');
    responseType = signal('JSON');
    responseTypes = signal(['JSON', 'XML']);
    
    wrapStyles = WRAP_STYLE_OPTIONS;
    wrapStyle = signal<WrapStyle>('pretty');
    isWordWrap = computed(() => this.wrapStyle() === 'word-wrap' || this.wrapStyle() === 'collapsed');
    wrapResponse = computed(() => this.isWordWrap());
    wrapConsole = signal(false);

    tabId = input.required<string>();
    tabState = computed(() => this.tabStateService.getState(this.tabId()));

    // ── Derived from active tab state ──────────────────────────────────────
    responseBody = computed(() => this.tabState()?.responseBody ?? null);

    formattedResponseBody = computed(() => {
        const body = this.responseBody();
        if (body === null) return '';
        return formatBodyByStyle(body, this.wrapStyle(), this.responseType());
    });
    responseStatus = computed(() => this.tabState()?.responseStatus ?? null);
    responseTime = computed(() => this.tabState()?.responseTime ?? null);
    responseSize = computed(() => this.tabState()?.responseSize ?? null);
    responseCookies = computed(() => this.tabState()?.responseCookies ?? []);
    responseHeaders = computed(() => this.tabState()?.responseHeaders ?? []);
    testResults = computed(() => this.tabState()?.testResults ?? []);

    hasResponse = computed(() => this.responseStatus() !== null);

    passedTests = computed(() => this.testResults().filter(t => t.passed).length);
    failedTests = computed(() => this.testResults().filter(t => !t.passed).length);

    encryptionConsole = computed(() => this.tabState()?.scripts?.encryptionConsole ?? '');

    tabs = computed(() => [
        { name: 'Body', count: null },
        { name: 'Cookies', count: this.responseCookies().length || null },
        { name: 'Headers', count: this.responseHeaders().filter(h => h.enabled).length || null },
        { name: 'Test Results', count: this.testResults().length || null },
        { name: 'Encryption Console', count: null },
        { name: 'Script Console', count: null },
    ]);

    // Script Console tab state
    activeScriptConsoleTab = signal<'preRequest' | 'postResponse'>('postResponse');
    scriptConsoleOptions = ['Pre-request Script', 'Post-response Script'];
    displayScriptConsoleTab = computed(() => this.activeScriptConsoleTab() === 'preRequest' ? 'Pre-request Script' : 'Post-response Script');
    activeScriptConsoleOutput = computed(() => {
        const scripts = this.tabState()?.scripts;
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

    @ViewChild(MonacoEditorComponent) monacoEditor?: MonacoEditorComponent;

    wrapPretty() {
        this.wrapStyle.set('pretty');
    }

    wrapKeyField() {
        this.wrapStyle.set('key-field');
    }

    wrapSoft() {
        this.wrapStyle.set('word-wrap');
    }

    wrapCollapsed() {
        this.wrapStyle.set('collapsed');
    }

    addResponseToVariable() {
        // Extract key & value from cursor position or text selection in Monaco editor
        const extracted = this.monacoEditor?.extractCurrentKeyValue()
            || MonacoEditorComponent.lastFocusedEditor?.extractCurrentKeyValue();

        let key = extracted?.key || '';
        let value = extracted?.value || '';
        const body = this.responseBody();

        // If no key extracted from cursor, fallback to sensible defaults
        if (!key) {
            if (typeof body === 'object' && body !== null) {
                const keys = Object.keys(body);
                if (keys.length > 0) {
                    key = keys[0];
                    const val = (body as any)[key];
                    value = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
                } else {
                    key = 'responseBody';
                    value = JSON.stringify(body);
                }
            } else if (body !== null && body !== undefined) {
                key = 'response';
                value = String(body);
            } else {
                key = 'responseVar';
                value = '';
            }
        }

        const fullPath = this.findPathInObject(body, key, value);
        const state = this.tabState();
        this.variableService.openAddModal(key, value, {
            tabId: this.tabId(),
            requestId: state?.id,
            requestName: state?.name,
            requestUrl: state?.url,
            type: 'response',
            propertyKey: fullPath || key
        });
    }

    private findPathInObject(obj: any, targetKey: string, targetVal?: string): string | null {
        if (!obj || typeof obj !== 'object' || !targetKey) return null;
        let parsed = obj;
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { return null; }
        }
        if (!parsed || typeof parsed !== 'object') return null;

        const lowerKey = targetKey.toLowerCase();

        function search(curr: any, path: string[]): string | null {
            if (!curr || typeof curr !== 'object') return null;

            if (Array.isArray(curr)) {
                for (let i = 0; i < curr.length; i++) {
                    const res = search(curr[i], [...path, String(i)]);
                    if (res) return res;
                }
                return null;
            }

            for (const k of Object.keys(curr)) {
                if (k.toLowerCase() === lowerKey) {
                    if (targetVal !== undefined && targetVal !== '') {
                        const v = curr[k];
                        const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
                        if (s === targetVal) {
                            return [...path, k].join('.');
                        }
                    } else {
                        return [...path, k].join('.');
                    }
                }
            }

            for (const k of Object.keys(curr)) {
                const child = curr[k];
                if (child && typeof child === 'object') {
                    const res = search(child, [...path, k]);
                    if (res) return res;
                }
            }

            return null;
        }

        return search(parsed, []);
    }

    async saveAsExample() {
        const defaultName = `Example - ${new Date().toLocaleTimeString()}`;
        const name = window.prompt('Enter name for this request/response example:', defaultName);
        if (!name || !name.trim()) return;

        const state = this.tabState();
        if (!state) return;

        try {
            await this.tabStateService.createExample(this.tabId(), name.trim(), {
                method: state.method,
                url: state.url,
                params: state.params,
                headers: state.headers,
                rawBody: state.rawBody,
                responseBody: this.responseBody(),
                responseStatus: this.responseStatus(),
                responseTime: this.responseTime(),
                responseSize: this.responseSize(),
                responseHeaders: this.responseHeaders()
            });
            // Intentionally silent on success as requested
        } catch (e: any) {
            this.notificationService.notify(`Failed to save example: ${e.message || 'Error'}`);
        }
    }

    copyResponse() {
        const data = JSON.stringify(this.responseBody(), null, 2);
        this.copyToClipboard(data);
    }

    copyEncryptionConsole() {
        this.copyToClipboard(this.encryptionConsole());
    }

    copyScriptConsole() {
        this.copyToClipboard(this.activeScriptConsoleOutput());
    }

    copyTestResults() {
        const results = this.testResults().map(t => `${t.passed ? '✓' : '✗'} ${t.name}`).join('\n');
        this.copyToClipboard(results);
    }

    copyHeaders() {
        const hdrs = this.responseHeaders().filter(h => h.enabled).map(h => `${h.key}: ${h.value}`).join('\n');
        this.copyToClipboard(hdrs);
    }

    copyCookies() {
        const cks = this.responseCookies().map(c => `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}; Expires=${c.expires}`).join('\n');
        this.copyToClipboard(cks);
    }

    private copyToClipboard(text: string) {
        if (!text) return;
        navigator.clipboard.writeText(text);
        // Could also trigger a notification here if we had NotificationService injected
    }

    toggleConsoleWrap() {
        this.wrapConsole.update(value => !value);
    }
}
