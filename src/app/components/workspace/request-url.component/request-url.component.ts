import { Component, signal, computed, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { VariableService } from '../../../shared/services/variable.service';
import { TabStateService, TriggerFlowConfig, TriggerFlowCondition } from '../../../shared/services/tab.state.service';
import { RequestExecutionService } from '../../../shared/services/request.execution.service';
import { AutoAuthService } from '../../../shared/services/auto-auth.service';
import { AutoAuthModalComponent } from '../../../shared/components/auto-auth.modal.component';
import { VariableInputComponent } from '../../../shared/components/variable-input.component/variable-input.component';
import { NotificationService } from '../../../shared/services/notification.service';
import { ThemeService } from '../../../shared/services/theme.service';
import { getHttpMethodColor } from '../../../shared/utils/http-method.util';
import { input } from '@angular/core';

@Component({
    selector: 'app-request-url-component',
    imports: [CommonModule, FormsModule, ScrollableSelectComponent, MatIcon, AutoAuthModalComponent, VariableInputComponent],
    templateUrl: './request-url.component.html',
    styleUrl: './request-url.component.css',
    host: {
        class: 'block relative z-40',
        '(document:click)': 'onDocumentClick()'
    }
})
export class RequestUrlComponent {


    variableService = inject(VariableService);
    tabStateService = inject(TabStateService);
    executionService = inject(RequestExecutionService);
    autoAuthService = inject(AutoAuthService);
    notificationService = inject(NotificationService);
    themeService = inject(ThemeService);
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

    tabId = input.required<string>();
    tabState = computed(() => this.tabStateService.getState(this.tabId()));

    selectedMethod = computed(() => this.tabState()?.method || 'GET');
    isLoading = computed(() => this.tabState()?.isLoading || false);
    isAutoAuthEnabled = computed(() => this.autoAuthService.isAutoAuthEnabled(this.tabId()));
    autoAuthScope = computed(() => this.tabState()?.autoAuthEnabled ? 'individual' : (this.autoAuthService.isAutoAuthEnabled(this.tabId()) ? 'global' : 'off'));
    isCurrentAuthTab = computed(() => {
        const authEndpointId = this.autoAuthService.getAutoAuthEndpointId();
        return !!(authEndpointId && authEndpointId === this.tabId());
    });
    pendingScope: 'off' | 'individual' | 'global' | null = null;
    lastEnabledScope: 'individual' | 'global' = 'individual';

    // Post Trigger Request Chaining State
    isTriggerDropdownOpen = signal(false);
    postTriggerTabId = computed(() => {
        const targetId = this.tabState()?.postTriggerTabId || null;
        if (!targetId) return null;

        if (this.isCurrentAuthTab()) {
            const targetState = this.tabStateService.getState(targetId);
            const targetReq = this.tabStateService.allCapsuleRequests().find(r => r.id === targetId);
            const hasAutoAuth = this.autoAuthService.isAutoAuthEnabled(targetId) || !!(targetState?.autoAuthEnabled ?? targetReq?.autoAuthEnabled);
            if (hasAutoAuth) {
                return null;
            }
        }

        return targetId;
    });

    availableTriggerRequests = computed(() => {
        const currentId = this.tabId();
        const all = this.tabStateService.allCapsuleRequests();
        const isAuthTab = this.isCurrentAuthTab();

        return all.filter(r => {
            if (r.id === currentId) return false;

            // When on the auth tab request, exclude any request that has auto auth enabled linked to it
            if (isAuthTab) {
                const targetState = this.tabStateService.getState(r.id);
                const hasAutoAuth = this.autoAuthService.isAutoAuthEnabled(r.id) || !!(targetState?.autoAuthEnabled ?? r.autoAuthEnabled);
                if (hasAutoAuth) {
                    return false;
                }
            }

            return true;
        });
    });

    targetTriggerRequest = computed(() => {
        const targetId = this.postTriggerTabId();
        if (!targetId || targetId === '__script__') return null;
        return this.tabStateService.getState(targetId) || this.tabStateService.allCapsuleRequests().find(r => r.id === targetId) || null;
    });

    triggerConfig = computed<TriggerFlowConfig>(() => {
        return this.tabState()?.triggerConfig || {
            condition: 'always',
            expectedStatus: 200,
            delayMs: 250,
            retryCountOnFail: 0,
            scheduleIntervalMs: 0
        };
    });
    isScriptControlledTrigger = computed(() => this.postTriggerTabId() === '__script__');
    scheduleInfo = computed(() => this.executionService.activeSchedules()[this.tabId()] || null);
    isScheduleActive = computed(() => !!this.scheduleInfo());
    scheduleIntervalSeconds = computed(() => Math.max(1, Math.round((this.triggerConfig().scheduleIntervalMs || 10000) / 1000)));
    activeScheduleSeconds = computed(() => {
        const info = this.scheduleInfo();
        return info ? Math.max(1, Math.round(info.intervalMs / 1000)) : 10;
    });
    hasTriggerOrAutomation = computed(() =>
        !!this.postTriggerTabId() ||
        this.isScheduleActive() ||
        (this.triggerConfig().retryCountOnFail ?? 0) > 0
    );

    // Auto Auth Modal State
    showAutoAuthModal = signal(false);
    detectedEndpoint = signal<any>(null);

    url = computed(() => this.tabState()?.url || '');
    hasUrlError = signal(false);
    isDark = computed(() => this.themeService.isDarkMode());
    @ViewChild(VariableInputComponent) variableInput?: VariableInputComponent;

    constructor() {
    }

    resolvedUrl = computed(() => this.variableService.resolve(this.url()));
    
    showResolvedUrl = computed(() => {
        const u = this.url();
        return u.includes('{{') || u.includes('$') || /(?:^|[/?&=]):[a-zA-Z0-9_-]+/.test(u) || /(?:^|[/?&=])\{[a-zA-Z0-9_-]+\}/.test(u);
    });

    onUrlChange(newUrl: string) {
        if (newUrl && /^\s*curl\s+/i.test(newUrl)) {
            this.parseCurlCommand(newUrl.trim());
            return;
        }
        if (this.hasUrlError() && newUrl?.trim()) {
            this.hasUrlError.set(false);
        }
        this.tabStateService.updateState(this.tabId(), { url: newUrl });
    }

    setMethod(method: string) {
        this.tabStateService.updateState(this.tabId(), { method });
    }

    getMethodColor = (method: string): string => getHttpMethodColor(method);

    onSend() {
        const currentUrl = (this.url() || '').trim();
        if (!currentUrl) {
            this.hasUrlError.set(true);
            this.variableInput?.focus();
            this.notificationService.notify('Please enter a request URL before sending', 'warning');
            return;
        }
        this.hasUrlError.set(false);
        this.executionService.executeRequest(this.tabId());
    }

    onCancel() {
        this.executionService.cancelRequest(this.tabId());
    }

    toggleTriggerDropdown(event: MouseEvent) {
        event.stopPropagation();
        this.isTriggerDropdownOpen.update(v => !v);
    }

    onMainTriggerClick() {
        if (this.postTriggerTabId()) {
            this.selectTriggerTarget(null);
        } else {
            this.isTriggerDropdownOpen.set(true);
        }
    }

    selectTriggerTarget(targetId: string | null) {
        if (targetId && targetId !== '__script__' && this.isCurrentAuthTab()) {
            const targetState = this.tabStateService.getState(targetId);
            const targetReq = this.tabStateService.allCapsuleRequests().find(r => r.id === targetId);
            const hasAutoAuth = this.autoAuthService.isAutoAuthEnabled(targetId) || !!(targetState?.autoAuthEnabled ?? targetReq?.autoAuthEnabled);
            if (hasAutoAuth) {
                return;
            }
        }
        const currCfg = this.triggerConfig();
        const nextCfg: TriggerFlowConfig = targetId === '__script__'
            ? { ...currCfg, condition: 'script-only' }
            : (currCfg.condition === 'script-only' ? { ...currCfg, condition: 'always' } : currCfg);
        this.tabStateService.updateState(this.tabId(), {
            postTriggerTabId: targetId,
            triggerConfig: nextCfg
        });
        this.isTriggerDropdownOpen.set(false);
    }

    updateTriggerConfig(patch: Partial<TriggerFlowConfig>) {
        this.tabStateService.updateState(this.tabId(), {
            triggerConfig: {
                ...this.triggerConfig(),
                ...patch
            }
        });
    }

    onConditionChange(condition: string) {
        const cond = (condition || 'always') as TriggerFlowCondition;
        this.updateTriggerConfig({ condition: cond });
    }

    onExpectedStatusChange(rawVal: string | number) {
        const num = Math.max(100, Math.min(599, Math.round(Number(rawVal) || 200)));
        this.updateTriggerConfig({ expectedStatus: num });
    }

    onDelayChange(rawVal: string | number) {
        const num = Math.max(0, Math.min(60000, Math.round(Number(rawVal) || 0)));
        this.updateTriggerConfig({ delayMs: num });
    }

    onRetryChange(rawVal: string | number) {
        const num = Math.max(0, Math.min(5, Math.round(Number(rawVal) || 0)));
        this.updateTriggerConfig({ retryCountOnFail: num });
    }

    onScheduleSecondsChange(rawVal: string | number) {
        const sec = Math.max(1, Math.min(86400, Math.round(Number(rawVal) || 10)));
        const ms = sec * 1000;
        this.updateTriggerConfig({ scheduleIntervalMs: ms });
        if (this.isScheduleActive()) {
            this.executionService.startSchedule(this.tabId(), ms);
        }
    }

    toggleRecurringSchedule(event: MouseEvent) {
        event.stopPropagation();
        const ms = this.scheduleIntervalSeconds() * 1000;
        this.updateTriggerConfig({ scheduleIntervalMs: ms });
        this.executionService.toggleSchedule(this.tabId(), ms);
    }

    private cleanupAuthEndpointTriggerIfPointingToThisTab() {
        const authEndpointId = this.autoAuthService.getAutoAuthEndpointId();
        if (authEndpointId && authEndpointId !== this.tabId()) {
            const authState = this.tabStateService.getState(authEndpointId);
            if (authState?.postTriggerTabId === this.tabId()) {
                this.tabStateService.updateState(authEndpointId, { postTriggerTabId: null });
            }
        }
    }

    onDocumentClick() {
        if (this.isTriggerDropdownOpen()) {
            this.isTriggerDropdownOpen.set(false);
        }
    }

    onMainAutoAuthClick() {
        if (this.isAutoAuthEnabled()) {
            this.selectScope('off');
        } else {
            this.selectScope('individual');
        }
    }

    selectScope(scope: 'off' | 'individual' | 'global') {
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
                    this.cleanupAuthEndpointTriggerIfPointingToThisTab();
                } else if (scope === 'global') {
                    this.cleanupAuthEndpointTriggerIfPointingToThisTab();
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
            this.cleanupAuthEndpointTriggerIfPointingToThisTab();
        } else if (scope === 'global') {
            this.cleanupAuthEndpointTriggerIfPointingToThisTab();
        }
        this.showAutoAuthModal.set(false);
        this.pendingScope = null;
    }

    onPaste(event: ClipboardEvent) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return;
        const pastedText = clipboardData.getData('text');
        
        if (pastedText && /^\s*curl\s+/i.test(pastedText)) {
            event.preventDefault();
            this.parseCurlCommand(pastedText.trim());
        }
    }

    private parseCurlCommand(curlStr: string) {
        let method = 'GET';
        let url = '';
        const headers: { key: string; value: string; enabled: boolean }[] = [];
        let params: { key: string; value: string; enabled: boolean }[] = [];
        const formDataRows: { enabled: boolean; key: string; value: string; type: 'text' | 'file' }[] = [];
        const urlEncodedList: string[] = [];
        let auth: any = null;
        let body = '';
        let isJsonHeader = false;
        let isXmlHeader = false;
        let isSoapHeader = false;
        let isUrlEncodedHeader = false;
        let isTextHeader = false;
        let hasSoapActionHeader = false;

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
                // Shell line continuation: backslash followed by optional whitespace and newline
                let lookAhead = i + 1;
                while (lookAhead < curlStr.length && (curlStr[lookAhead] === ' ' || curlStr[lookAhead] === '\t')) {
                    lookAhead++;
                }
                if (lookAhead < curlStr.length && (curlStr[lookAhead] === '\n' || curlStr[lookAhead] === '\r')) {
                    i = lookAhead;
                    if (curlStr[i] === '\r' && curlStr[i + 1] === '\n') {
                        i++;
                    }
                    continue;
                }
                escapeNext = true;
                continue;
            }

            if (char === "'" && !inDoubleQuote) {
                if (!inSingleQuote && currentToken === '$') {
                    // Shell ANSI-C quoting prefix $'...' -> drop the '$'
                    currentToken = '';
                }
                inSingleQuote = !inSingleQuote;
                continue;
            }
            if (char === '"' && !inSingleQuote) {
                if (!inDoubleQuote && currentToken === '$') {
                    currentToken = '';
                }
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
            let flag = token;
            let inlineVal: string | null = null;
            const eqIdx = token.indexOf('=');
            if (token.startsWith('-') && eqIdx > 1) {
                flag = token.slice(0, eqIdx);
                inlineVal = token.slice(eqIdx + 1);
            }

            const getNextVal = (): string => {
                if (inlineVal !== null) return inlineVal;
                return tokens[++i] || '';
            };

            if (flag === '-X' || flag === '--request') {
                method = getNextVal().toUpperCase() || method;
            } else if (flag === '-H' || flag === '--header') {
                const headerStr = getNextVal();
                if (headerStr) {
                    const separatorIdx = headerStr.indexOf(':');
                    if (separatorIdx > -1) {
                        const key = headerStr.slice(0, separatorIdx).trim();
                        const value = headerStr.slice(separatorIdx + 1).trim();
                        const keyLower = key.toLowerCase();
                        const valLower = value.toLowerCase();

                        if (keyLower === 'authorization' && valLower.startsWith('bearer ')) {
                            auth = { type: 'bearer', token: value.substring(7).trim() };
                        } else if (keyLower === 'authorization' && valLower.startsWith('basic ')) {
                            auth = { type: 'basic', token: value.substring(6).trim() };
                        } else {
                            headers.push({ key, value, enabled: true });
                        }

                        if (keyLower === 'content-type') {
                            if (valLower.includes('application/soap+xml')) {
                                isSoapHeader = true;
                                isXmlHeader = true;
                            } else if (valLower.includes('text/xml') || valLower.includes('application/xml') || valLower.includes('+xml')) {
                                isXmlHeader = true;
                            } else if (valLower.includes('application/x-www-form-urlencoded')) {
                                isUrlEncodedHeader = true;
                            } else if (valLower.includes('application/json') || valLower.includes('+json')) {
                                isJsonHeader = true;
                            } else if (valLower.includes('text/plain')) {
                                isTextHeader = true;
                            }
                        } else if (keyLower === 'soapaction') {
                            hasSoapActionHeader = true;
                            isSoapHeader = true;
                            isXmlHeader = true;
                        }
                    }
                }
            } else if (flag === '--data-urlencode') {
                const dataVal = getNextVal();
                if (dataVal) urlEncodedList.push(dataVal);
                if (method === 'GET') method = 'POST';
            } else if (flag === '-d' || flag === '--data' || flag === '--data-raw' || flag === '--data-binary') {
                const dataVal = getNextVal();
                body = body ? (body + '&' + dataVal) : dataVal;
                if (method === 'GET') method = 'POST'; // cURL defaults to POST if -d is used
            } else if (flag === '-F' || flag === '--form') {
                const formParam = getNextVal();
                if (formParam) {
                    const eq = formParam.indexOf('=');
                    if (eq > -1) {
                        const k = formParam.slice(0, eq).trim().replace(/^["']|["']$/g, '');
                        let v = formParam.slice(eq + 1).trim();
                        const isFile = v.startsWith('@');
                        if (isFile) {
                            const filePath = v.slice(1).split(';')[0].trim().replace(/^["']|["']$/g, '');
                            formDataRows.push({
                                enabled: true,
                                key: k,
                                value: filePath,
                                type: 'file'
                            });
                        } else {
                            v = v.replace(/^["']|["']$/g, '');
                            formDataRows.push({
                                enabled: true,
                                key: k,
                                value: v,
                                type: 'text'
                            });
                        }
                    }
                }
                if (method === 'GET') method = 'POST';
            } else if (flag === '-u' || flag === '--user') {
                const userPass = getNextVal();
                if (userPass) {
                    try {
                        auth = { type: 'basic', token: btoa(userPass) };
                    } catch {
                        auth = { type: 'basic', token: userPass };
                    }
                }
            } else if (flag === '--url') {
                url = getNextVal() || url;
            } else if (!token.startsWith('-') && !url) {
                url = token;
            }
        }

        // Clean surrounding quotes from URL if any
        if (url) {
            url = url.replace(/^['"]|['"]$/g, '');
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
        
        const parseUrlEncodedStr = (str: string) => {
            const rows: { enabled: boolean; key: string; value: string }[] = [];
            const pairs = str.split('&');
            for (const p of pairs) {
                if (!p) continue;
                const eq = p.indexOf('=');
                let k = eq > -1 ? p.slice(0, eq) : p;
                let v = eq > -1 ? p.slice(eq + 1) : '';
                try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch {}
                try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch {}
                rows.push({ enabled: true, key: k, value: v });
            }
            return rows;
        };

        if (urlEncodedList.length > 0 || (isUrlEncodedHeader && body)) {
            const combinedList = [...urlEncodedList];
            if (isUrlEncodedHeader && body) {
                combinedList.push(body);
            }
            const allRows: { enabled: boolean; key: string; value: string }[] = [];
            for (const item of combinedList) {
                allRows.push(...parseUrlEncodedStr(item));
            }
            updateData.bodyType = 'x-www-form-urlencoded';
            updateData.urlEncodedData = allRows.length > 0 ? allRows : [{ enabled: true, key: '', value: '' }];
            updateData.payloadType = 'body';
        } else if (body) {
            updateData.payloadType = 'body';
            const trimmedBody = body.trim();

            let isGraphql = false;
            if (trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) {
                try {
                    const parsedGql = JSON.parse(trimmedBody);
                    if (parsedGql && typeof parsedGql.query === 'string') {
                        isGraphql = true;
                        updateData.bodyType = 'graphql';
                        updateData.graphqlQuery = parsedGql.query;
                        updateData.graphqlVariables = parsedGql.variables ? JSON.stringify(parsedGql.variables, null, 2) : '{\n  \n}';
                    }
                } catch {}
            }

            if (!isGraphql) {
                updateData.bodyType = 'raw';
                updateData.rawBody = body;

                const soapXmlPattern = /<(?:soap|soapenv|soap12):Envelope\b|xmlns:(?:soap|soapenv|soap12)=|http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/|http:\/\/www\.w3\.org\/2003\/05\/soap-envelope/i;
                const isSoapDetected = isSoapHeader || hasSoapActionHeader || soapXmlPattern.test(trimmedBody);

                const looksLikeXml = trimmedBody.startsWith('<') && (trimmedBody.endsWith('>') || trimmedBody.includes('</'));
                const looksLikeJson = (trimmedBody.startsWith('{') && trimmedBody.endsWith('}')) || (trimmedBody.startsWith('[') && trimmedBody.endsWith(']'));
                const isXmlDetected = isSoapDetected || isXmlHeader || trimmedBody.startsWith('<?xml') || (looksLikeXml && !looksLikeJson);

                if (isSoapDetected) {
                    updateData.rawType = 'XML (SOAP)';
                    updateData.rawBodyXml = body;
                } else if (isXmlDetected) {
                    updateData.rawType = 'XML';
                    updateData.rawBodyXml = body;
                } else if (isTextHeader && !looksLikeJson) {
                    updateData.rawType = 'Text';
                    updateData.rawBodyText = body;
                } else {
                    updateData.rawType = 'JSON';
                    updateData.rawBodyJson = body;
                }
            }
        } else if (formDataRows.length > 0) {
            updateData.bodyType = 'form-data';
            updateData.formData = formDataRows;
            updateData.payloadType = 'body';
            const cleanHeaders = headers.filter(h => h.key.toLowerCase() !== 'content-type' || !h.value.toLowerCase().includes('multipart/form-data'));
            if (cleanHeaders.length !== headers.length) {
                updateData.headers = cleanHeaders;
            }
        }

        if (Object.keys(updateData).length > 0) {
            this.tabStateService.updateState(this.tabId(), updateData);
            this.notificationService.notify('cURL command successfully parsed and imported!');
        }
    }
}
