import { Component, signal, computed, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { VariableService } from '../../../shared/services/variable.service';
import { TabStateService } from '../../../shared/services/tab.state.service';
import { RequestExecutionService } from '../../../shared/services/request.execution.service';
import { AutoAuthService } from '../../../shared/services/auto-auth.service';
import { AutoAuthModalComponent } from '../../../shared/components/auto-auth.modal.component';
import { VariableInputComponent } from '../../../shared/components/variable-input.component/variable-input.component';
import { NotificationService } from '../../../shared/services/notification.service';
import { input } from '@angular/core';

@Component({
    selector: 'app-request-url-component',
    imports: [CommonModule, FormsModule, ScrollableSelectComponent, MatIcon, AutoAuthModalComponent, VariableInputComponent],
    templateUrl: './request-url.component.html',
    styleUrl: './request-url.component.css',
    host: {
        '(document:click)': 'onDocumentClick()'
    }
})
export class RequestUrlComponent {


    variableService = inject(VariableService);
    tabStateService = inject(TabStateService);
    executionService = inject(RequestExecutionService);
    autoAuthService = inject(AutoAuthService);
    notificationService = inject(NotificationService);
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

    tabId = input.required<string>();
    tabState = computed(() => this.tabStateService.getState(this.tabId()));

    selectedMethod = computed(() => this.tabState()?.method || 'GET');
    isLoading = computed(() => this.tabState()?.isLoading || false);
    isAutoAuthEnabled = computed(() => this.autoAuthService.isAutoAuthEnabled());
    autoAuthScope = computed(() => this.tabState()?.autoAuthEnabled ? 'individual' : (this.autoAuthService.isAutoAuthEnabled() ? 'global' : 'off'));
    isDropdownOpen = signal(false);
    pendingScope: 'off' | 'individual' | 'global' | null = null;
    lastEnabledScope: 'individual' | 'global' = 'individual';

    // Auto Auth Modal State
    showAutoAuthModal = signal(false);
    detectedEndpoint = signal<any>(null);

    url = computed(() => this.tabState()?.url || '');

    constructor() {
    }

    resolvedUrl = computed(() => this.variableService.resolve(this.url()));

    onUrlChange(newUrl: string) {
        this.tabStateService.updateState(this.tabId(), { url: newUrl });
    }

    setMethod(method: string) {
        this.tabStateService.updateState(this.tabId(), { method });
    }

    getMethodColor = (method: string): string => {
        switch (method) {
            case 'GET': return '#00BF8E';
            case 'POST': return '#FFB400';
            case 'PUT': return '#097BED';
            case 'PATCH': return '#A97BFF';
            case 'DELETE': return '#FF5233';
            case 'HEAD': return '#00BF8E';
            case 'OPTIONS': return '#FF60AD';
            default: return 'var(--postonsteroids-text-primary)';
        }
    }

    onSend() {
        this.executionService.executeRequest(this.tabId());
    }

    onCancel() {
        this.executionService.cancelRequest(this.tabId());
    }

    toggleDropdown(event: MouseEvent) {
        event.stopPropagation();
        this.isDropdownOpen.update(v => !v);
    }

    onDocumentClick() {
        if (this.isDropdownOpen()) {
            this.isDropdownOpen.set(false);
        }
    }

    onMainAutoAuthClick() {
        const currentScope = this.autoAuthScope();
        if (currentScope === 'off') {
            const last = this.lastEnabledScope || 'individual';
            this.selectScope(last);
        } else {
            this.lastEnabledScope = currentScope;
            this.selectScope('off');
        }
    }

    selectScope(scope: 'off' | 'individual' | 'global') {
        this.isDropdownOpen.set(false);
        if (scope === 'off') {
            this.autoAuthService.setAutoAuthEnabled('off');
            this.autoAuthService.setAutoAuthEndpointId(null);
            this.tabStateService.updateState(this.tabId(), { autoAuthEnabled: false });
        } else {
            if (!this.autoAuthService.getAutoAuthEndpointId()) {
                this.pendingScope = scope;
                const detected = this.autoAuthService.detectLoginEndpoint();
                this.detectedEndpoint.set(detected);
                this.showAutoAuthModal.set(true);
            } else {
                this.autoAuthService.setAutoAuthEnabled(scope);
                if (scope === 'individual') {
                    this.tabStateService.updateState(this.tabId(), { autoAuthEnabled: true });
                }
            }
        }
    }

    onCancelAutoAuth() {
        this.showAutoAuthModal.set(false);
        this.pendingScope = null;
    }

    onConfirmAutoAuth(endpointId: string) {
        this.autoAuthService.setAutoAuthEndpointId(endpointId);
        const scope = this.pendingScope || 'individual';
        this.autoAuthService.setAutoAuthEnabled(scope);
        if (scope === 'individual') {
            this.tabStateService.updateState(this.tabId(), { autoAuthEnabled: true });
        }
        this.showAutoAuthModal.set(false);
        this.pendingScope = null;
    }

    onPaste(event: ClipboardEvent) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return;
        const pastedText = clipboardData.getData('text');
        
        if (pastedText && pastedText.trim().toLowerCase().startsWith('curl ')) {
            event.preventDefault();
            this.parseCurlCommand(pastedText.trim());
        }
    }

    private parseCurlCommand(curlStr: string) {
        let method = 'GET';
        let url = '';
        const headers: { key: string; value: string; enabled: boolean }[] = [];
        let params: { key: string; value: string; enabled: boolean }[] = [];
        let auth: any = null;
        let body = '';
        let isJsonBody = false;

        // Tokenize respecting single and double quotes
        const tokens: string[] = [];
        let currentToken = '';
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let escapeNext = false;

        for (let i = 0; i < curlStr.length; i++) {
            const char = curlStr[i];
            
            if (escapeNext) {
                currentToken += char;
                escapeNext = false;
                continue;
            }
            if (char === '\\' && !inSingleQuote) {
                if (curlStr[i+1] === '\n' || curlStr[i+1] === '\r') {
                    continue;
                }
                escapeNext = true;
                continue;
            }

            if (char === "'" && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                continue;
            }
            if (char === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }
            if (char === '\n' || char === '\r') {
                if (!inSingleQuote && !inDoubleQuote) {
                    if (currentToken.trim()) {
                        tokens.push(currentToken);
                        currentToken = '';
                    }
                    continue;
                }
            }
            
            if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
                if (currentToken.trim()) {
                    tokens.push(currentToken);
                    currentToken = '';
                }
            } else {
                currentToken += char;
            }
        }
        if (currentToken.trim()) tokens.push(currentToken);

        // Process tokens
        for (let i = 1; i < tokens.length; i++) {
            const token = tokens[i];
            
            if (token === '-X' || token === '--request') {
                method = tokens[++i]?.toUpperCase() || method;
            } else if (token === '-H' || token === '--header') {
                const headerStr = tokens[++i];
                if (headerStr) {
                    const separatorIdx = headerStr.indexOf(':');
                    if (separatorIdx > -1) {
                        const key = headerStr.slice(0, separatorIdx).trim();
                        const value = headerStr.slice(separatorIdx + 1).trim();
                        
                        if (key.toLowerCase() === 'authorization' && value.toLowerCase().startsWith('bearer ')) {
                            auth = { type: 'bearer', token: value.substring(7).trim() };
                        } else {
                            headers.push({ key, value, enabled: true });
                        }
                        
                        if (key.toLowerCase() === 'content-type' && value.toLowerCase().includes('application/json')) {
                            isJsonBody = true;
                        }
                    }
                }
            } else if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
                body = tokens[++i] || '';
                if (method === 'GET') method = 'POST'; // cURL defaults to POST if -d is used
            } else if (!token.startsWith('-') && !url) {
                url = token;
            }
        }

        // Parse query params from URL
        if (url.includes('?')) {
            const [baseUrl, queryString] = url.split('?', 2);
            url = baseUrl;
            const searchParams = new URLSearchParams(queryString);
            searchParams.forEach((val, key) => {
                params.push({ key, value: val, enabled: true });
            });
        }

        // Apply parsed data to the state
        const updateData: any = {};
        if (url) updateData.url = url;
        if (method) updateData.method = method;
        if (headers.length > 0) updateData.headers = headers;
        if (params.length > 0) updateData.params = params;
        if (auth) updateData.auth = auth;
        
        if (body) {
            updateData.rawBodyJson = body;
            updateData.bodyType = 'raw';
            updateData.rawType = isJsonBody ? 'JSON' : 'Text';
        }

        if (Object.keys(updateData).length > 0) {
            this.tabStateService.updateState(this.tabId(), updateData);
            this.notificationService.notify('cURL command successfully parsed and imported!');
        }
    }
}
