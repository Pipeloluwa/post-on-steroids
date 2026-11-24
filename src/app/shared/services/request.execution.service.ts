import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { timeout } from 'rxjs';
import { generateUUID } from '../utils/uuid.util';
import { isLocalhostOrLoopbackUrl, isElectronApp } from '../utils/url.util';
import { formatTimeoutLabel } from '../utils/request-timeout.util';
import { environment } from '../../../environments/environment';
import { TabStateService, FormDataRow, KeyValue, TriggerFlowConfig } from './tab.state.service';
import { VariableService } from './variable.service';
import { SandboxExecutionService } from './sandbox.execution.service';
import { AutoAuthService } from './auto-auth.service';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { NetworkService } from './network.service';
import { API_BASE_URL } from '../constants/api.constants';
import { sanitizeJsonBodyForScripts, extractSoapActionFromXml } from '../utils/format.utils';
import { buildEncryptionPayloadContext, reconcileEncryptionResult } from '../utils/encryption-path.util';
import { generateAwsSigV4Headers } from '../utils/aws-sigv4.util';
import { CookieJarService } from './cookie-jar.service';
import { EnvironmentService } from './environment.service';
import { applyRequestFieldLinksToTabState, RequestFieldLinkMutation } from '../utils/script-field-link.util';

export interface ClientCertConfig {
    id?: string;
    host: string;
    type: 'pfx' | 'pem';
    pfxBase64?: string;
    certPem?: string;
    keyPem?: string;
    passphrase?: string;
}

export interface ExecutionAuditEvent {
    tabId: string;
    capsuleId?: string;
    requestName: string;
    method: string;
    url: string;
    status: number;
    responseTimeMs: number;
    timestamp: number;
}

@Injectable({
    providedIn: 'root'
})
export class RequestExecutionService {
    private http = inject(HttpClient);
    private tabStateService = inject(TabStateService);
    private variableService = inject(VariableService);
    private sandboxService = inject(SandboxExecutionService);
    private autoAuthService = inject(AutoAuthService);
    private authService = inject(AuthService);
    private notificationService = inject(NotificationService);
    private networkService = inject(NetworkService);
    private cookieJar = inject(CookieJarService);
    private environmentService = inject(EnvironmentService);

    private cancellationTokens = new Map<string, { cancelled: boolean, cancelFn?: () => void }>();
    private clientCertProviders: Array<(targetUrl: string) => ClientCertConfig | null> = [];
    private executionObservers: Array<(event: ExecutionAuditEvent) => void> = [];
    private schedules = new Map<string, {
        startTimerId?: ReturnType<typeof setTimeout>;
        intervalId?: ReturnType<typeof setInterval>;
        endTimerId?: ReturnType<typeof setTimeout>;
        intervalMs: number;
        startAt: number | null;
        endAt: number | null;
        runCount: number;
        status: 'waiting' | 'running';
    }>();
    readonly activeSchedules = signal<Record<string, {
        intervalMs: number;
        runCount: number;
        nextRunAt: number;
        startAt?: number | null;
        endAt?: number | null;
        status: 'waiting' | 'running';
    }>>({});
    readonly triggerScheduleLogs = signal<Array<{
        id: string;
        timestamp: number;
        tabId: string;
        requestName: string;
        method: string;
        url?: string;
        status: number;
        durationMs: number;
        testsPassed: number;
        testsFailed: number;
        responseHeaders?: any[];
        responseBody?: any;
        testResults?: Array<{ name: string; passed: boolean; error?: string }>;
        error?: string;
    }>>([]);

    clearTriggerScheduleLogs(): void {
        this.triggerScheduleLogs.set([]);
    }

    private resolveTextWithOverrides(input: string, overrideVars?: Record<string, string>): string {
        if (!input) return '';
        let text = input;
        if (overrideVars && Object.keys(overrideVars).length > 0) {
            const lowerMap = new Map<string, string>();
            for (const [k, v] of Object.entries(overrideVars)) {
                lowerMap.set(k.trim().toLowerCase(), String(v ?? ''));
            }
            text = text.replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, (match, rawKey) => {
                const k = String(rawKey || '').trim().toLowerCase();
                return lowerMap.has(k) ? lowerMap.get(k)! : match;
            });
        }
        return this.variableService.resolve(text);
    }

    private resolveJsonWithOverrides(input: string, overrideVars?: Record<string, string>): string {
        if (!input) return '';
        let text = input;
        if (overrideVars && Object.keys(overrideVars).length > 0) {
            const lowerMap = new Map<string, string>();
            for (const [k, v] of Object.entries(overrideVars)) {
                lowerMap.set(k.trim().toLowerCase(), String(v ?? ''));
            }
            text = text.replace(/\{\{\s*([^{}\r\n]+?)\s*\}\}/g, (match, rawKey) => {
                const k = String(rawKey || '').trim().toLowerCase();
                return lowerMap.has(k) ? lowerMap.get(k)! : match;
            });
        }
        return this.variableService.resolveJson(text);
    }

    private parseLocalDateTimeMs(value?: string | null): number | null {
        if (!value || typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const localMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (localMatch) {
            const [, y, m, d, hh, mm, ss] = localMatch;
            const dt = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss || '0'), 0);
            const ms = dt.getTime();
            return Number.isFinite(ms) ? ms : null;
        }
        const parsed = new Date(trimmed).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    }

    private scheduleTimeoutSafe(fn: () => void, delayMs: number): ReturnType<typeof setTimeout> {
        const MAX_TIMEOUT_MS = 2_147_483_647;
        if (delayMs <= MAX_TIMEOUT_MS) {
            return setTimeout(fn, Math.max(0, delayMs));
        }
        return setTimeout(() => this.scheduleTimeoutSafe(fn, delayMs - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
    }

    startSchedule(
        tabId: string,
        intervalMs: number,
        options?: { startAt?: string | null; endAt?: string | null }
    ): boolean {
        const effectiveId = this.tabStateService.resolveTabId(tabId);
        const state = this.tabStateService.getState(effectiveId);
        const safeMs = Math.max(1000, Math.min(86_400_000, Math.round(Number(intervalMs) || 10000)));
        const rawStartAt = options && options.startAt !== undefined ? options.startAt : state?.triggerConfig?.scheduleStartAt;
        const rawEndAt = options && options.endAt !== undefined ? options.endAt : state?.triggerConfig?.scheduleEndAt;
        const startAtMs = this.parseLocalDateTimeMs(rawStartAt);
        const endAtMs = this.parseLocalDateTimeMs(rawEndAt);
        const now = Date.now();

        if (endAtMs !== null && endAtMs <= now) {
            this.notificationService.notify('Optional schedule end date & time must be in the future.', 'warning');
            return false;
        }
        if (startAtMs !== null && endAtMs !== null && endAtMs <= startAtMs) {
            this.notificationService.notify('End date & time must be after execution start date & time.', 'warning');
            return false;
        }

        this.stopSchedule(effectiveId, true);

        const isFutureStart = startAtMs !== null && startAtMs > now + 500;
        const entry: {
            startTimerId?: ReturnType<typeof setTimeout>;
            intervalId?: ReturnType<typeof setInterval>;
            endTimerId?: ReturnType<typeof setTimeout>;
            intervalMs: number;
            startAt: number | null;
            endAt: number | null;
            runCount: number;
            status: 'waiting' | 'running';
        } = {
            intervalMs: safeMs,
            startAt: startAtMs,
            endAt: endAtMs,
            runCount: 0,
            status: isFutureStart ? 'waiting' : 'running'
        };

        const runTick = () => {
            if (entry.endAt !== null && Date.now() >= entry.endAt) {
                const label = this.tabStateService.getState(effectiveId)?.name || 'Request';
                this.stopSchedule(effectiveId, true);
                this.notificationService.notify(`Scheduled trigger for "${label}" completed (reached end date/time).`);
                return;
            }
            const st = this.tabStateService.getState(effectiveId);
            if (!st) {
                this.stopSchedule(effectiveId, true);
                return;
            }
            entry.status = 'running';
            entry.runCount += 1;
            const nextRunAt = Date.now() + safeMs;
            this.activeSchedules.update(curr => ({
                ...curr,
                [effectiveId]: {
                    intervalMs: safeMs,
                    runCount: entry.runCount,
                    nextRunAt: entry.endAt !== null && nextRunAt > entry.endAt ? entry.endAt : nextRunAt,
                    startAt: entry.startAt,
                    endAt: entry.endAt,
                    status: 'running'
                }
            }));
            void this.executeRequest(effectiveId, false, 0, 0, {
                isolatedRun: true,
                onComplete: (summary) => {
                    this.triggerScheduleLogs.update(curr => [
                        {
                            id: generateUUID(),
                            timestamp: Date.now(),
                            tabId: effectiveId,
                            requestName: st.name || st.url || 'Scheduled Request',
                            method: st.method || 'GET',
                            url: summary.url || st.url,
                            status: summary.status,
                            durationMs: Math.round(summary.durationMs || 0),
                            testsPassed: summary.testsPassed,
                            testsFailed: summary.testsFailed,
                            responseHeaders: summary.responseHeaders,
                            responseBody: summary.responseBody,
                            testResults: summary.testResults,
                            error: summary.error
                        },
                        ...curr
                    ].slice(0, 150));
                }
            });
        };

        const startRecurringLoop = () => {
            entry.intervalId = setInterval(runTick, safeMs);
        };

        if (endAtMs !== null) {
            const label = state?.name || 'Request';
            entry.endTimerId = this.scheduleTimeoutSafe(() => {
                if (this.schedules.get(effectiveId) !== entry) return;
                this.stopSchedule(effectiveId, true);
                this.notificationService.notify(`Scheduled trigger for "${label}" stopped at configured end date/time.`);
            }, Math.max(0, endAtMs - now));
        }

        if (isFutureStart && startAtMs !== null) {
            entry.startTimerId = this.scheduleTimeoutSafe(() => {
                if (this.schedules.get(effectiveId) !== entry) return;
                entry.status = 'running';
                runTick();
                if (this.schedules.get(effectiveId) === entry) {
                    startRecurringLoop();
                }
            }, startAtMs - now);
        } else {
            startRecurringLoop();
        }

        this.schedules.set(effectiveId, entry);
        this.activeSchedules.update(curr => ({
            ...curr,
            [effectiveId]: {
                intervalMs: safeMs,
                runCount: 0,
                nextRunAt: isFutureStart && startAtMs !== null ? startAtMs : Date.now() + safeMs,
                startAt: startAtMs,
                endAt: endAtMs,
                status: entry.status
            }
        }));
        const label = state?.name || 'Request';
        if (isFutureStart && startAtMs !== null) {
            const startLabel = new Date(startAtMs).toLocaleString();
            this.notificationService.notify(
                `Trigger scheduled for "${label}" at ${startLabel} (every ${Math.round(safeMs / 1000)}s)${endAtMs ? ` until ${new Date(endAtMs).toLocaleString()}` : ''}`,
                'success'
            );
        } else {
            this.notificationService.notify(
                `Recurring schedule started for "${label}" every ${Math.round(safeMs / 1000)}s${endAtMs ? ` until ${new Date(endAtMs).toLocaleString()}` : ''}`,
                'success'
            );
        }
        return true;
    }

    stopSchedule(tabId: string, silent: boolean = false): void {
        const effectiveId = this.tabStateService.resolveTabId(tabId);
        const existing = this.schedules.get(effectiveId);
        if (existing) {
            if (existing.startTimerId) clearTimeout(existing.startTimerId);
            if (existing.intervalId) clearInterval(existing.intervalId);
            if (existing.endTimerId) clearTimeout(existing.endTimerId);
            this.schedules.delete(effectiveId);
        }
        this.activeSchedules.update(curr => {
            if (!curr[effectiveId]) return curr;
            const copy = { ...curr };
            delete copy[effectiveId];
            return copy;
        });
        if (!silent && existing) {
            const label = this.tabStateService.getState(effectiveId)?.name || 'Request';
            this.notificationService.notify(`Recurring schedule stopped for "${label}"`);
        }
    }

    toggleSchedule(
        tabId: string,
        intervalMs: number,
        options?: { startAt?: string | null; endAt?: string | null }
    ): boolean {
        if (this.isScheduleActive(tabId)) {
            this.stopSchedule(tabId);
            return false;
        }
        return this.startSchedule(tabId, intervalMs, options);
    }

    isScheduleActive(tabId: string): boolean {
        const effectiveId = this.tabStateService.resolveTabId(tabId);
        return this.schedules.has(effectiveId);
    }

    getScheduleRunCount(tabId: string): number {
        const effectiveId = this.tabStateService.resolveTabId(tabId);
        return this.schedules.get(effectiveId)?.runCount || 0;
    }

    stopAllSchedules(): number {
        const ids = Array.from(this.schedules.keys());
        for (const id of ids) {
            this.stopSchedule(id, true);
        }
        return ids.length;
    }

    registerClientCertProvider(provider: (targetUrl: string) => ClientCertConfig | null): () => void {
        this.clientCertProviders.push(provider);
        return () => {
            this.clientCertProviders = this.clientCertProviders.filter(p => p !== provider);
        };
    }

    registerExecutionObserver(observer: (event: ExecutionAuditEvent) => void): () => void {
        this.executionObservers.push(observer);
        return () => {
            this.executionObservers = this.executionObservers.filter(o => o !== observer);
        };
    }

    private resolveClientCert(targetUrl: string): ClientCertConfig | null {
        for (const p of this.clientCertProviders) {
            const cert = p(targetUrl);
            if (cert) return cert;
        }
        return null;
    }

    private encodeBasicCredentials(raw: string): string {
        try {
            return btoa(unescape(encodeURIComponent(raw)));
        } catch {
            return raw;
        }
    }

    cancelRequest(tabId: string) {
        const effectiveId = this.tabStateService.resolveTabId(tabId);
        this.tabStateService.nextExecutionToken(effectiveId);
        this.tabStateService.updateState(effectiveId, { isLoading: false });

        const token = this.cancellationTokens.get(effectiveId) || this.cancellationTokens.get(tabId);
        if (token) {
            token.cancelled = true;
            if (token.cancelFn) token.cancelFn();
            this.cancellationTokens.delete(effectiveId);
            this.cancellationTokens.delete(tabId);
        }
    }

    async executeRequest(
        tabId: string,
        isAutoAuthRetry: boolean = false,
        chainDepth: number = 0,
        retryAttempt: number = 0,
        options?: {
            isolatedRun?: boolean;
            overrideVars?: Record<string, string>;
            onComplete?: (summary: {
                status: number;
                durationMs: number;
                testsPassed: number;
                testsFailed: number;
                error?: string;
                url?: string;
                responseHeaders?: any[];
                responseBody?: any;
                testResults?: Array<{ name: string; passed: boolean; error?: string }>;
            }) => void;
        }
    ): Promise<void> {
        const effectiveTabId = this.tabStateService.resolveTabId(tabId);
        const state = this.tabStateService.getState(effectiveTabId);
        if (!state) return;
        const isIsolated = !!options?.isolatedRun;
        const overrideVars = options?.overrideVars;

        let originalTabId: string | null | undefined;
        if (isAutoAuthRetry && !isIsolated) {
            originalTabId = this.tabStateService.activeTabId();
            if (originalTabId && originalTabId !== effectiveTabId) {
                this.tabStateService.setActiveTab(effectiveTabId);
                // Yield so UI renders
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        const cancelToken = { cancelled: false, cancelFn: undefined as (() => void) | undefined };
        if (!isIsolated) {
            this.cancellationTokens.set(effectiveTabId, cancelToken);
            if (effectiveTabId !== tabId) {
                this.cancellationTokens.set(tabId, cancelToken);
            }
        }

        // Generate a new execution token for fencing against race conditions
        const executionToken = isIsolated ? 0 : this.tabStateService.nextExecutionToken(effectiveTabId);

        // Reset Tab to Loading and clear previous response and consoles immediately so stale output won't linger
        if (!isIsolated) {
            this.tabStateService.updateState(effectiveTabId, {
                isLoading: true,
                responseBody: null,
                responseStatus: null,
                responseTime: null,
                responseSize: null,
                responseHeaders: [],
                responseCookies: [],
                testResults: [],
                scripts: {
                    ...(state.scripts || {}),
                    preRequestConsole: '',
                    postResponseConsole: '',
                    encryptionConsole: ''
                }
            });
        }

        // Yield to the event loop to allow Angular to paint the "Cancel" button before heavy synchronous work
        await new Promise(resolve => setTimeout(resolve, 0));

        if (cancelToken.cancelled || (!isIsolated && !this.tabStateService.isExecutionCurrent(effectiveTabId, executionToken))) return;

        if (!navigator.onLine) {
            this.tabStateService.updateState(effectiveTabId, { isLoading: false });
            this.notificationService.notify('You are offline. Request will automatically execute when the connection is restored.');
            
            const handleOnline = () => {
                window.removeEventListener('online', handleOnline);
                this.notificationService.notify('Connection restored. Executing request...');
                this.executeRequest(effectiveTabId, isAutoAuthRetry, chainDepth);
            };
            window.addEventListener('online', handleOnline);
            return;
        }

        try {
            const startTime = performance.now();

            // Flush microtask queue so any pending ngModelChange handlers (e.g. from
            // the Monaco editor body component) have propagated into the tab state signal.
            // Without this, a user who corrected the payload after a bad-request error
            // could still see the OLD payload being sent because the signal update hadn't
            // committed yet at the time we snapshot the state below.
            await Promise.resolve();

            // Re-read the LATEST state before preparing payload.
            // The initial `state` read above was only for the guard check (existence + id match).
            // Between a previous failed request and the user pressing Send again, the user may
            // have corrected the body, headers, URL, etc. — we must use the freshest data.
            const freshState = this.tabStateService.getState(tabId);
            if (!freshState) return;

            // 1. Resolve URL
            if (!(freshState.url || '').trim()) {
                this.tabStateService.updateState(effectiveTabId, { isLoading: false });
                this.notificationService.notify('Please enter a request URL before sending', 'warning');
                return;
            }
            const resolvedUrl = this.resolveTextWithOverrides(freshState.url, overrideVars);
            if (!resolvedUrl.trim()) {
                if (!isIsolated) this.tabStateService.updateState(effectiveTabId, { isLoading: false });
                this.notificationService.notify('Resolved request URL is empty. Please enter a valid URL', 'warning');
                options?.onComplete?.({ status: 0, durationMs: 0, testsPassed: 0, testsFailed: 0, error: 'Empty resolved URL' });
                return;
            }

            // 2. Prepare Headers (preserve `enabled: true` so encryption/decryption scripts checking `if (h.enabled && h.key)` process them)
            let headers: { enabled?: boolean; key: string; value: string }[] = freshState.headers
                .filter(h => h.enabled && h.key)
                .map(h => ({
                    enabled: true,
                    key: this.resolveTextWithOverrides(h.key, overrideVars).trim().replace(/[\r\n]+/g, ''),
                    value: this.resolveTextWithOverrides(h.value, overrideVars).trim().replace(/[\r\n]+/g, '')
                }))
                .filter(h => !!h.key);

            // 3. Prepare Params (needs to exist before apikey query injection)
            let params = freshState.params.filter(p => p.enabled && p.key).map(p => ({
                key: this.resolveTextWithOverrides(p.key, overrideVars),
                value: this.resolveTextWithOverrides(p.value, overrideVars)
            }));

            // Inject Auth Header / Query if applicable
            if ((freshState.auth.type === 'bearer' || freshState.auth.type === 'oauth2') && freshState.auth.token) {
                const token = this.variableService.resolve(freshState.auth.token).trim().replace(/[\r\n]+/g, '');
                const prefix = freshState.auth.type === 'oauth2'
                    ? (freshState.auth.oauth2?.headerPrefix || 'Bearer')
                    : 'Bearer';
                if (token) {
                    headers.push({ enabled: true, key: 'Authorization', value: `${prefix} ${token}` });
                }
            } else if (freshState.auth.type === 'basic') {
                if (freshState.auth.username !== undefined || freshState.auth.password !== undefined) {
                    const user = this.variableService.resolve(freshState.auth.username || '');
                    const pass = this.variableService.resolve(freshState.auth.password || '');
                    if (user || pass) {
                        headers.push({
                            enabled: true,
                            key: 'Authorization',
                            value: `Basic ${this.encodeBasicCredentials(`${user}:${pass}`)}`
                        });
                    }
                } else if (freshState.auth.token) {
                    const tokenStr = this.variableService.resolve(freshState.auth.token).trim().replace(/[\r\n]+/g, '');
                    const encoded = tokenStr.includes(':') ? this.encodeBasicCredentials(tokenStr) : tokenStr;
                    if (encoded) {
                        headers.push({ enabled: true, key: 'Authorization', value: `Basic ${encoded}` });
                    }
                }
            } else if (freshState.auth.type === 'apikey' && freshState.auth.apiKeyName) {
                const apiKeyName = this.variableService.resolve(freshState.auth.apiKeyName).trim();
                const apiKeyVal = this.variableService.resolve(freshState.auth.apiKeyValue ?? freshState.auth.token ?? '').trim();
                if (apiKeyName) {
                    if (freshState.auth.apiKeyIn === 'query') {
                        if (!params.some(p => p.key === apiKeyName)) {
                            params.push({ key: apiKeyName, value: apiKeyVal });
                        }
                    } else if (!headers.some(h => h.key.toLowerCase() === apiKeyName.toLowerCase())) {
                        headers.push({ enabled: true, key: apiKeyName, value: apiKeyVal.replace(/[\r\n]+/g, '') });
                    }
                }
            }

            // Inject globally cached Auto-Auth token if no tab-level auth is configured
            const autoAuthEnabled = this.autoAuthService.isAutoAuthEnabled(tabId);
            if (autoAuthEnabled && !freshState.auth.token && freshState.auth.type === 'none') {
                const cachedToken = this.autoAuthService.getCachedToken();
                if (cachedToken) {
                    const alreadyHasAuth = headers.some(h => h.key.toLowerCase() === 'authorization');
                    if (!alreadyHasAuth) {
                        const token = cachedToken.trim().replace(/[\r\n]+/g, '');
                        headers.push({ enabled: true, key: 'Authorization', value: `Bearer ${token}` });
                    }
                }
            }

            // 4. Prepare Body
            let body: any = null;
            if (freshState.method !== 'GET' && freshState.method !== 'HEAD') {
                if (freshState.bodyType === 'raw') {
                    // Read from the type-specific field to ensure the latest editor content is used.
                    // The shared `rawBody` can be stale if the user corrected the payload after a failed request.
                    const isXmlType = freshState.rawType === 'XML' || freshState.rawType === 'XML (SOAP)' || freshState.rawType === 'SOAP';
                    const isTextType = freshState.rawType === 'Text';
                    const rawBodyContent = isXmlType
                        ? (freshState.rawBodyXml || '')
                        : (isTextType ? (freshState.rawBodyText || freshState.rawBody || '') : (freshState.rawBodyJson || '{}'));

                    let resolvedRaw = (isXmlType || isTextType)
                        ? this.resolveTextWithOverrides(rawBodyContent, overrideVars)
                        : this.resolveJsonWithOverrides(rawBodyContent, overrideVars);

                    // Safely strip comments and sanitize JSON payload so encrypted values with '/', '//', '/*' parse cleanly
                    if (freshState.rawType === 'JSON') {
                        resolvedRaw = sanitizeJsonBodyForScripts(resolvedRaw);
                    }

                    if (freshState.rawType === 'JSON') {
                        try {
                            body = JSON.parse(resolvedRaw);
                        } catch {
                            body = resolvedRaw;
                        }
                    } else {
                        body = resolvedRaw;
                    }
                } else if (freshState.bodyType === 'x-www-form-urlencoded') {
                    body = (freshState.urlEncodedData || []).filter((r: KeyValue) => r.enabled && r.key).map((r: KeyValue) => ({
                        ...r,
                        key: this.resolveTextWithOverrides(r.key, overrideVars),
                        value: this.resolveTextWithOverrides(r.value || '', overrideVars)
                    }));
                } else if (freshState.bodyType === 'graphql') {
                    const query = this.resolveTextWithOverrides(freshState.graphqlQuery || '', overrideVars);
                    let variables: any = {};
                    try {
                        const resolvedVars = this.resolveJsonWithOverrides(freshState.graphqlVariables || '{}', overrideVars);
                        variables = JSON.parse(resolvedVars || '{}');
                    } catch {
                        variables = {};
                    }
                    body = { query, variables };
                } else if (freshState.bodyType === 'form-data') {
                    // For Sandbox passing we can pass form-data as array
                    body = freshState.formData.filter((f: FormDataRow) => f.enabled && f.key).map((f: FormDataRow) => ({
                        ...f,
                        key: this.resolveTextWithOverrides(f.key, overrideVars),
                        value: typeof f.value === 'string' ? this.resolveTextWithOverrides(f.value, overrideVars) : f.value
                    }));
                }
            }



            // 5. Script Execution (Encryption -> Pre-Request)
            let preRequestLogs = '';

            // 5a. Encryption Script
            const encryptionScriptCode = freshState.encryption?.script
                ? this.variableService.resolveScript(freshState.encryption.script)
                : '';
            let encryptionLogs = '';

            const encState = freshState.encryption;
            const isXmlType = freshState.rawType === 'XML' || freshState.rawType === 'XML (SOAP)' || freshState.rawType === 'SOAP';
            const preparedEnc = buildEncryptionPayloadContext({
                bodyType: freshState.bodyType || 'none',
                rawType: freshState.rawType || 'JSON',
                rawBodyJson: !isXmlType && freshState.rawType !== 'Text'
                    ? (typeof body === 'string' ? body : JSON.stringify(body ?? {}))
                    : undefined,
                rawBodyXml: isXmlType ? (typeof body === 'string' ? body : '') : undefined,
                rawBodyText: freshState.rawType === 'Text' ? (typeof body === 'string' ? body : String(body ?? '')) : undefined,
                rawBody: typeof body === 'string' ? body : undefined,
                formData: freshState.bodyType === 'form-data' && Array.isArray(body) ? body : [],
                urlEncodedData: freshState.bodyType === 'x-www-form-urlencoded' && Array.isArray(body) ? body : [],
                graphqlQuery: freshState.bodyType === 'graphql' ? (body?.query || '') : '',
                graphqlVariables: freshState.bodyType === 'graphql' ? (body?.variables || {}) : {},
                encryptedBodyPaths: freshState.encryption?.encryptedBodyPaths || [],
                autoEncryptBody: freshState.encryption?.autoEncryptBody || false
            });

            const hasFieldEncryptToggledOn = Boolean(
                encState?.autoEncryptHeaders ||
                (encState?.encryptedHeaders && encState.encryptedHeaders.length > 0) ||
                (preparedEnc.bodyType !== 'none' && (
                    preparedEnc.autoEncryptBody ||
                    preparedEnc.encryptedBodyPaths.length > 0 ||
                    preparedEnc.encryptedFormData.length > 0 ||
                    preparedEnc.encryptedUrlEncodedData.length > 0 ||
                    preparedEnc.encryptedGraphqlPaths.length > 0 ||
                    preparedEnc.encryptRawText
                ))
            );

            if (encryptionScriptCode && encryptionScriptCode.trim()) {
                const rawEncHeaders = freshState.encryption?.encryptedHeaders || [];
                const autoEncHeaders = !!freshState.encryption?.autoEncryptHeaders;
                const normalizedEncHeaders = Array.from(new Set([
                    ...rawEncHeaders,
                    ...rawEncHeaders.map(k => k.trim()),
                    ...rawEncHeaders.map(k => this.variableService.resolve(k).trim()),
                    ...(autoEncHeaders
                        ? freshState.headers.filter(h => h.enabled && h.key).map(h => this.variableService.resolve(h.key).trim())
                        : [])
                ])).filter(Boolean);

                for (const h of headers) {
                    if (h.enabled && h.key && normalizedEncHeaders.some(ek => ek.toLowerCase() === h.key.toLowerCase())) {
                        if (!normalizedEncHeaders.includes(h.key)) {
                            normalizedEncHeaders.push(h.key);
                        }
                        // Strip accidental surrounding quotes/trailing comma on header values copied from JSON output
                        const qm = h.value.match(/^["'](.*)["']\s*,?$/s);
                        if (qm) {
                            h.value = qm[1].trim();
                        }
                    }
                }

                const encContext = this.buildScriptEnvContext({
                    headers,
                    body: preparedEnc.body,
                    params,
                    url: resolvedUrl,
                    method: freshState.method,
                    encryptedHeaders: normalizedEncHeaders,
                    encryptedBodyPaths: preparedEnc.encryptedBodyPaths,
                    bodyType: preparedEnc.bodyType,
                    rawType: preparedEnc.rawType,
                    formData: preparedEnc.formData,
                    encryptedFormData: preparedEnc.encryptedFormData,
                    urlEncodedData: preparedEnc.urlEncodedData,
                    encryptedUrlEncodedData: preparedEnc.encryptedUrlEncodedData,
                    graphql: preparedEnc.graphql,
                    encryptedGraphqlPaths: preparedEnc.encryptedGraphqlPaths,
                    rawText: preparedEnc.rawText,
                    encryptRawText: preparedEnc.encryptRawText,
                    autoEncryptBody: preparedEnc.autoEncryptBody,
                    autoEncryptHeaders: autoEncHeaders
                });
                const encResult = await this.sandboxService.executeScript(
                    encryptionScriptCode,
                    encContext,
                    freshState.encryption?.scriptLanguage
                );
                if (cancelToken.cancelled || !this.tabStateService.isExecutionCurrent(effectiveTabId, executionToken)) return;
                encryptionLogs = encResult.logs || '';
                this.applyScriptMutations(encResult.context, effectiveTabId);

                if (encResult.success && encResult.context) {
                    headers = encResult.context.headers || headers;
                    body = reconcileEncryptionResult(preparedEnc, encResult.context);
                    params = encResult.context.params || params;

                    if (hasFieldEncryptToggledOn && !isAutoAuthRetry) {
                        const fnBodyOnly = encryptionScriptCode
                            .replace(/^(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{/, '')
                            .replace(/^(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^:]+)?:/, '')
                            .replace(/\}\s*$/, '')
                            .replace(/"(?:[^"\\]|\\.)*"|(\/\*[\s\S]*?\*\/|\/\/.*|#.*)/g, (m, c) => (c ? '' : m))
                            .replace(/^\s*pass\s*$/gm, '')
                            .trim();
                        if (!fnBodyOnly) {
                            this.notificationService.notify('Encryption Failed: Encryption script is empty', 'error');
                        } else if (encResult.context?.encryptionPassed === false || encResult.context?.encryptionFailed === true) {
                            this.notificationService.notify('Encryption Failed', 'error');
                        } else {
                            this.notificationService.notify('Encryption Passed', 'success');
                        }
                    }
                } else if (encResult.error) {
                    if (!this.tabStateService.isExecutionCurrent(effectiveTabId, executionToken)) return;
                    encryptionLogs = `Encryption Error: ${encResult.error}`;
                    console.error(' [Encryption] ERROR - Encryption script failed:', encResult.error);

                    if (hasFieldEncryptToggledOn && !isAutoAuthRetry) {
                        this.notificationService.notify(`Encryption Failed: ${encResult.error}`, 'error');
                    }

                    const errorStr = `Encryption Script Error:\n${encResult.error}`;
                    const targetId = this.tabStateService.resolveTabId(effectiveTabId);
                    this.tabStateService.updateState(targetId, {
                        isLoading: false,
                        responseStatus: 400,
                        responseBody: errorStr,
                        responseHeaders: [],
                        responseCookies: [],
                        responseSize: new Blob([errorStr]).size,
                        responseTime: Math.floor(performance.now() - startTime),
                        scripts: { ...freshState.scripts, preRequestConsole: preRequestLogs, encryptionConsole: encryptionLogs }
                    });
                    this.cancellationTokens.delete(effectiveTabId);
                    this.cancellationTokens.delete(tabId);
                    return;
                }
            } else if (hasFieldEncryptToggledOn && !isAutoAuthRetry) {
                this.notificationService.notify('Encryption Failed: No encryption script configured', 'error');
            }

            // 5b. Pre-Request Script
            let scriptNextRequest: string | null | undefined = undefined;
            const preScriptCode = freshState.scripts?.preRequest
                ? this.variableService.resolveScript(freshState.scripts.preRequest)
                : '';
            if (preScriptCode && preScriptCode.trim()) {
                const context = this.buildScriptEnvContext({
                    headers,
                    body,
                    params,
                    url: resolvedUrl,
                    method: freshState.method,
                    bodyType: preparedEnc.bodyType,
                    rawType: preparedEnc.rawType,
                    formData: freshState.bodyType === 'form-data' && Array.isArray(body) ? body : preparedEnc.formData,
                    urlEncodedData: freshState.bodyType === 'x-www-form-urlencoded' && Array.isArray(body) ? body : preparedEnc.urlEncodedData,
                    graphql: freshState.bodyType === 'graphql' && body && typeof body === 'object' ? body : preparedEnc.graphql,
                    rawText: freshState.rawType === 'Text' && typeof body === 'string' ? body : preparedEnc.rawText
                });
                const result = await this.sandboxService.executeScript(
                    preScriptCode,
                    context,
                    freshState.scripts?.preRequestLanguage
                );
                if (cancelToken.cancelled || !this.tabStateService.isExecutionCurrent(effectiveTabId, executionToken)) return;
                preRequestLogs += result.logs || '';
                const mutated = this.applyScriptMutations(result.context, effectiveTabId);
                if (mutated.nextRequest !== undefined) scriptNextRequest = mutated.nextRequest;

                if (result.success && result.context) {
                    headers = result.context.headers || headers;
                    body = result.context.body !== undefined ? result.context.body : body;
                    params = result.context.params || params;
                    if (typeof result.context.rawText === 'string' && freshState.bodyType === 'raw' && freshState.rawType === 'Text') {
                        body = result.context.rawText;
                    }
                } else if (result.error) {
                    if (!this.tabStateService.isExecutionCurrent(effectiveTabId, executionToken)) return;
                    preRequestLogs += `\nError: ${result.error}`;
                    const errorStr = `Pre-Request Script Error:\n${result.error}`;
                    const targetId = this.tabStateService.resolveTabId(effectiveTabId);
                    this.tabStateService.updateState(targetId, {
                        isLoading: false,
                        responseStatus: 400,
                        responseBody: errorStr,
                        responseHeaders: [],
                        responseCookies: [],
                        responseSize: new Blob([errorStr]).size,
                        responseTime: Math.floor(performance.now() - startTime),
                        scripts: { ...freshState.scripts, preRequestConsole: preRequestLogs, encryptionConsole: encryptionLogs }
                    });
                    this.cancellationTokens.delete(effectiveTabId);
                    this.cancellationTokens.delete(tabId);
                    return;
                }
            }

            // 6. Build Http headers and params
            let httpHeaders = new HttpHeaders();
            headers.forEach(h => {
                const cleanKey = (h.key || '').trim().replace(/[\r\n]+/g, '');
                const cleanVal = (typeof h.value === 'string' ? h.value : String(h.value ?? '')).trim().replace(/[\r\n]+/g, '');
                if (cleanKey) {
                    httpHeaders = httpHeaders.set(cleanKey, cleanVal);
                }
            });

            // Anti-caching headers to prevent Edge Incognito from caching identical requests
            const cacheControlKey = httpHeaders.keys().find(k => k.toLowerCase() === 'cache-control');
            if (!cacheControlKey) {
                httpHeaders = httpHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
            const pragmaKey = httpHeaders.keys().find(k => k.toLowerCase() === 'pragma');
            if (!pragmaKey) {
                httpHeaders = httpHeaders.set('Pragma', 'no-cache');
            }
            const expiresKey = httpHeaders.keys().find(k => k.toLowerCase() === 'expires');
            if (!expiresKey) {
                httpHeaders = httpHeaders.set('Expires', '0');
            }

            let finalBody: any = body;

            // XML & SOAP Support: ensure Content-Type and SOAPAction are set if raw type is XML/SOAP
            const isXmlReq = freshState.rawType === 'XML' || freshState.rawType === 'XML (SOAP)' || freshState.rawType === 'SOAP';
            if (freshState.bodyType === 'raw' && isXmlReq) {
                const isSoap = freshState.rawType === 'XML (SOAP)' || freshState.rawType === 'SOAP' || (typeof finalBody === 'string' && (finalBody.includes('soap:Envelope') || finalBody.includes('soap12:Envelope') || finalBody.includes('schemas.xmlsoap.org')));
                const isSoap12 = isSoap && typeof finalBody === 'string' && finalBody.includes('2003/05/soap-envelope');
                if (!httpHeaders.has('Content-Type')) {
                    const ct = isSoap ? (isSoap12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8') : 'application/xml';
                    httpHeaders = httpHeaders.set('Content-Type', ct);
                }
                if (isSoap && !isSoap12) {
                    const soapActionKey = httpHeaders.keys().find(k => k.toLowerCase() === 'soapaction');
                    const userAction = soapActionKey ? httpHeaders.get(soapActionKey) : null;
                    const hasMeaningfulUserAction = Boolean(userAction && userAction.trim().replace(/^"+|"+$/g, '').trim().length > 0);

                    if (hasMeaningfulUserAction) {
                        let val = userAction!.trim();
                        if (!val.startsWith('"') || !val.endsWith('"')) {
                            val = `"${val.replace(/^"+|"+$/g, '')}"`;
                        }
                        httpHeaders = httpHeaders.set('SOAPAction', val);
                    } else {
                        const detectedAction = typeof finalBody === 'string' ? extractSoapActionFromXml(finalBody) : null;
                        const actionVal = detectedAction ? `"${detectedAction}"` : '""';
                        httpHeaders = httpHeaders.set('SOAPAction', actionVal);
                    }
                }
            }
            
            // Build real FormData or URLSearchParams if needed
            if (freshState.bodyType === 'form-data' && Array.isArray(body)) {
                const fd = new FormData();
                const rawFormData = freshState.formData;
                
                for (const row of body) {
                    const originalRow = rawFormData.find((f: any) => f.key === row.key);
                    if (originalRow && originalRow.type === 'file' && originalRow.file) {
                        fd.append(row.key, originalRow.file, originalRow.file.name);
                    } else {
                        fd.append(row.key, row.value);
                    }
                }
                finalBody = fd;
                
                // CRITICAL: We must remove any preset Content-Type so the browser sets multipart/form-data with the correct boundary
                const contentTypeKey = httpHeaders.keys().find(k => k.toLowerCase() === 'content-type');
                if (contentTypeKey) {
                    httpHeaders = httpHeaders.delete(contentTypeKey);
                }
            } else if (freshState.bodyType === 'x-www-form-urlencoded') {
                if (typeof body === 'string') {
                    finalBody = body;
                } else {
                    const urlParams = new URLSearchParams();
                    if (Array.isArray(body)) {
                        for (const row of body) {
                            if (row && row.key) {
                                urlParams.append(row.key, row.value ?? '');
                            }
                        }
                    } else if (body && typeof body === 'object') {
                        for (const [k, v] of Object.entries(body)) {
                            urlParams.append(k, String(v ?? ''));
                        }
                    }
                    finalBody = urlParams.toString();
                }
                if (!httpHeaders.has('Content-Type')) {
                    httpHeaders = httpHeaders.set('Content-Type', 'application/x-www-form-urlencoded; charset=utf-8');
                }
            } else if (freshState.bodyType === 'graphql') {
                if (!httpHeaders.has('Content-Type')) {
                    httpHeaders = httpHeaders.set('Content-Type', 'application/json');
                }
                finalBody = typeof body === 'string' ? body : JSON.stringify(body);
            } else if (freshState.bodyType === 'raw' && freshState.rawType === 'Text') {
                if (!httpHeaders.has('Content-Type')) {
                    httpHeaders = httpHeaders.set('Content-Type', 'text/plain');
                }
                finalBody = typeof body === 'string' ? body : String(body ?? '');
            } else {
                // Ensure Content-Type is application/json if body is an object or JSON string and not already set
                if (finalBody && !httpHeaders.has('Content-Type')) {
                    if (typeof finalBody === 'object' || (typeof finalBody === 'string' && finalBody.trim().startsWith('{'))) {
                        httpHeaders = httpHeaders.set('Content-Type', 'application/json');
                    }
                }
            }

            let httpParams = new HttpParams();
            params.forEach(p => {
                httpParams = httpParams.append(p.key, p.value);
            });

            const reqOptions = {
                headers: httpHeaders,
                params: httpParams,
                observe: 'response' as const,
                responseType: 'text' as const,
                withCredentials: freshState.settings?.enableCookies ?? true
            };

            // Making the Call: ensure protocol so relative URLs do not resolve against file:/// in Electron
            let finalUrl = resolvedUrl.trim();
            const isLoopback = isLocalhostOrLoopbackUrl(finalUrl);
            if (!/^https?:\/\//i.test(finalUrl)) {
                finalUrl = (isLoopback ? 'http://' : 'https://') + finalUrl;
            }

            // Inject managed Cookie Jar cookies if enabled and no explicit Cookie header exists
            if (freshState.settings?.enableCookies !== false) {
                const hasCookieHdr = httpHeaders.keys().some(k => k.toLowerCase() === 'cookie');
                if (!hasCookieHdr) {
                    const jarHeader = this.cookieJar.getCookieHeaderForUrl(finalUrl);
                    if (jarHeader) {
                        httpHeaders = httpHeaders.set('Cookie', jarHeader);
                    }
                }
            }

            // Apply AWS Signature v4 headers if configured
            if (freshState.auth.type === 'aws-sigv4' && freshState.auth.awsSigV4) {
                const cfg = freshState.auth.awsSigV4;
                const accessKey = this.variableService.resolve(cfg.accessKey || '').trim();
                const secretKey = this.variableService.resolve(cfg.secretKey || '').trim();
                if (accessKey && secretKey) {
                    try {
                        let signUrl = finalUrl;
                        const qs = httpParams.toString();
                        if (qs) signUrl += (signUrl.includes('?') ? '&' : '?') + qs;
                        const hdrRecord: Record<string, string> = {};
                        httpHeaders.keys().forEach(k => { hdrRecord[k] = httpHeaders.get(k) || ''; });
                        const signBody = typeof finalBody === 'string'
                            ? finalBody
                            : (finalBody && !(finalBody instanceof FormData) ? JSON.stringify(finalBody) : '');
                        const sigHeaders = await generateAwsSigV4Headers({
                            method: freshState.method,
                            url: signUrl,
                            headers: hdrRecord,
                            body: signBody,
                            accessKey,
                            secretKey,
                            region: this.variableService.resolve(cfg.region || 'us-east-1'),
                            service: this.variableService.resolve(cfg.service || 'execute-api'),
                            sessionToken: cfg.sessionToken ? this.variableService.resolve(cfg.sessionToken) : undefined
                        });
                        for (const [k, v] of Object.entries(sigHeaders)) {
                            httpHeaders = httpHeaders.set(k, v);
                        }
                    } catch (sigErr) {
                        console.warn('[AWS SigV4] Failed to sign request:', sigErr);
                    }
                }
            }

            // Check if running inside Electron wrapper
            const isElectron = isElectronApp();
            const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
            const useElectronIpc = isElectron && electronApi && typeof electronApi.executeHttpRequest === 'function';

            // Only browser uses proxy to bypass CORS restrictions on remote endpoints.
            // Desktop / Electron executes all requests directly from the client without proxy.
            const isUsingProxy = !isElectron && !isLoopback && (freshState.settings?.bypassCors !== false);

            let httpResponse: HttpResponse<string> | HttpErrorResponse | null = null;
            let proxyReturnedResponse: { statusCode: number; headers: Record<string, string>; body?: string; cookies?: any[]; responseTimeMs?: number } | null = null;
            let electronNetworkError: { code?: string; message?: string } | null = null;


            try {
                let reqObservable: any;

                if (useElectronIpc) {
                    const headersObj: Record<string, string> = {};
                    httpHeaders.keys().forEach(k => {
                        const cleanKey = k.trim().replace(/[\r\n]+/g, '');
                        const cleanVal = (httpHeaders.get(k) ?? '').trim().replace(/[\r\n]+/g, '');
                        if (cleanKey) {
                            headersObj[cleanKey] = cleanVal;
                        }
                    });

                    // Ensure Content-Type is present for Electron Node HTTP dispatch
                    if (!Object.keys(headersObj).some(k => k.toLowerCase() === 'content-type')) {
                        if (freshState.bodyType === 'raw' && isXmlReq) {
                            const xmlText = typeof finalBody === 'string' ? finalBody : '';
                            const isSoap = freshState.rawType === 'XML (SOAP)' || freshState.rawType === 'SOAP' || xmlText.includes('soap:Envelope') || xmlText.includes('soap12:Envelope') || xmlText.includes('schemas.xmlsoap.org');
                            const isSoap12 = isSoap && xmlText.includes('2003/05/soap-envelope');
                            headersObj['Content-Type'] = isSoap ? (isSoap12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8') : 'application/xml';
                        } else if (freshState.bodyType === 'raw' && freshState.rawType === 'Text') {
                            headersObj['Content-Type'] = 'text/plain';
                        } else if (freshState.bodyType === 'raw' && freshState.rawType === 'JSON') {
                            headersObj['Content-Type'] = 'application/json';
                        } else if (freshState.bodyType === 'x-www-form-urlencoded') {
                            headersObj['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
                        } else if (freshState.bodyType === 'graphql') {
                            headersObj['Content-Type'] = 'application/json';
                        } else if (finalBody && freshState.bodyType !== 'form-data' && (typeof finalBody === 'object' || (typeof finalBody === 'string' && finalBody.trim().startsWith('{')))) {
                            headersObj['Content-Type'] = 'application/json';
                        }
                    }

                    let targetUrl = finalUrl;
                    const queryString = httpParams.toString();
                    if (queryString) {
                        targetUrl += (targetUrl.includes('?') ? '&' : '?') + queryString;
                    }

                    let multipartParts: Array<{ name: string; value?: string; fileName?: string; mimeType?: string; base64Data?: string }> | null = null;
                    let bodyPayload: string | null = null;

                    if (freshState.bodyType === 'form-data' && Array.isArray(body)) {
                        multipartParts = [];
                        const rawFormData = freshState.formData;
                        for (const row of body) {
                            const originalRow = rawFormData.find((f: any) => this.variableService.resolve(f.key || '') === row.key || f.key === row.key);
                            if (originalRow && originalRow.type === 'file' && originalRow.file) {
                                const buf = await originalRow.file.arrayBuffer();
                                const bytes = new Uint8Array(buf);
                                let binary = '';
                                for (let i = 0; i < bytes.length; i += 0x8000) {
                                    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
                                }
                                multipartParts.push({
                                    name: row.key,
                                    fileName: originalRow.file.name,
                                    mimeType: originalRow.file.type || 'application/octet-stream',
                                    base64Data: btoa(binary)
                                });
                            } else {
                                multipartParts.push({
                                    name: row.key,
                                    value: String(row.value ?? '')
                                });
                            }
                        }
                    } else if (freshState.method !== 'GET' && freshState.method !== 'HEAD' && finalBody !== null && finalBody !== undefined) {
                        bodyPayload = typeof finalBody === 'string' ? finalBody : JSON.stringify(finalBody);
                    }

                    const electronReqId = generateUUID();
                    cancelToken.cancelFn = () => {
                        electronApi.cancelHttpRequest?.(electronReqId);
                    };

                    const timeoutMs = this.tabStateService.requestTimeoutMs();
                    const clientCert = this.resolveClientCert(targetUrl);
                    const electronRes = await electronApi.executeHttpRequest({
                        requestId: electronReqId,
                        url: targetUrl,
                        method: freshState.method,
                        headers: headersObj,
                        body: bodyPayload,
                        multipartParts,
                        verifySsl: freshState.settings?.verifySsl ?? false,
                        followRedirects: freshState.settings?.followRedirects ?? true,
                        enableCookies: freshState.settings?.enableCookies ?? true,
                        timeoutMs,
                        ...(clientCert ? { clientCert } : {})
                    });

                    if (electronRes?.cancelled || cancelToken.cancelled) {
                        const targetId = this.tabStateService.resolveTabId(effectiveTabId);
                        this.tabStateService.updateState(targetId, { isLoading: false });
                        return;
                    }

                    if (electronRes?.ok) {
                        proxyReturnedResponse = {
                            statusCode: electronRes.statusCode,
                            headers: electronRes.headers || {},
                            body: electronRes.body ?? '',
                            cookies: electronRes.cookies || [],
                            responseTimeMs: electronRes.responseTimeMs
                        };
                    } else {
                        electronNetworkError = {
                            code: electronRes?.errorCode || 'NETWORK_ERROR',
                            message: electronRes?.errorMessage || `Could not reach API at ${targetUrl}.`
                        };
                    }
                } else if (isUsingProxy) {
                    // Build proxy payload for OnSteroidApi
                    const headersObj: Record<string, string> = {};
                    httpHeaders.keys().forEach(k => {
                        const cleanKey = k.trim().replace(/[\r\n]+/g, '');
                        const cleanVal = (httpHeaders.get(k) ?? '').trim().replace(/[\r\n]+/g, '');
                        if (cleanKey) {
                            headersObj[cleanKey] = cleanVal;
                        }
                    });

                    let bodyPayload: string | null = null;
                    if (freshState.bodyType === 'x-www-form-urlencoded' || freshState.bodyType === 'graphql' || (freshState.bodyType === 'raw' && freshState.rawType === 'Text')) {
                        bodyPayload = typeof finalBody === 'string'
                            ? finalBody
                            : (finalBody instanceof HttpParams ? finalBody.toString() : (finalBody !== null && finalBody !== undefined ? JSON.stringify(finalBody) : null));
                    } else if (finalBody !== undefined && finalBody !== null && !(finalBody instanceof FormData)) {
                        bodyPayload = typeof finalBody === 'string' ? finalBody : JSON.stringify(finalBody);
                    } else if (body !== undefined && body !== null) {
                        bodyPayload = typeof body === 'string' ? body : JSON.stringify(body);
                    }

                    // Ensure Content-Type is present for raw JSON/XML/SOAP if not already set
                    if (!Object.keys(headersObj).some(k => k.toLowerCase() === 'content-type')) {
                        if (freshState.bodyType === 'raw' && isXmlReq) {
                            const isSoap = freshState.rawType === 'XML (SOAP)' || freshState.rawType === 'SOAP' || (bodyPayload && (bodyPayload.includes('soap:Envelope') || bodyPayload.includes('soap12:Envelope') || bodyPayload.includes('schemas.xmlsoap.org')));
                            const isSoap12 = isSoap && bodyPayload && bodyPayload.includes('2003/05/soap-envelope');
                            headersObj['Content-Type'] = isSoap ? (isSoap12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8') : 'application/xml';
                        } else if (freshState.bodyType === 'raw' && freshState.rawType === 'Text') {
                            headersObj['Content-Type'] = 'text/plain';
                        } else if (freshState.bodyType === 'raw' && freshState.rawType === 'JSON') {
                            headersObj['Content-Type'] = 'application/json';
                        } else if (freshState.bodyType === 'x-www-form-urlencoded') {
                            headersObj['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8';
                        } else if (freshState.bodyType === 'graphql') {
                            headersObj['Content-Type'] = 'application/json';
                        } else if (finalBody && (typeof finalBody === 'object' || (typeof finalBody === 'string' && finalBody.trim().startsWith('{')))) {
                            headersObj['Content-Type'] = 'application/json';
                        }
                    }

                    if (freshState.bodyType === 'raw' && isXmlReq) {
                        const isSoap = freshState.rawType === 'XML (SOAP)' || freshState.rawType === 'SOAP' || (bodyPayload && bodyPayload.includes('schemas.xmlsoap.org/soap/envelope/'));
                        const isSoap12 = isSoap && bodyPayload && bodyPayload.includes('2003/05/soap-envelope');
                        if (isSoap && !isSoap12) {
                            const existingKey = Object.keys(headersObj).find(k => k.toLowerCase() === 'soapaction');
                            const userAction = existingKey ? headersObj[existingKey] : null;
                            const hasMeaningfulUserAction = Boolean(userAction && userAction.trim().replace(/^"+|"+$/g, '').trim().length > 0);

                            if (hasMeaningfulUserAction) {
                                let val = userAction!.trim();
                                if (!val.startsWith('"') || !val.endsWith('"')) {
                                    val = `"${val.replace(/^"+|"+$/g, '')}"`;
                                }
                                headersObj['SOAPAction'] = val;
                            } else {
                                const detectedAction = bodyPayload ? extractSoapActionFromXml(bodyPayload) : null;
                                headersObj['SOAPAction'] = detectedAction ? `"${detectedAction}"` : '""';
                            }
                        }
                    }

                    if (!Object.keys(headersObj).some(k => k.toLowerCase() === 'x-request-id')) {
                        headersObj['X-Request-ID'] = generateUUID();
                    }

                    // Construct full URL including query params
                    let targetUrl = resolvedUrl;
                    const queryString = httpParams.toString();
                    if (queryString) {
                        targetUrl += (targetUrl.includes('?') ? '&' : '?') + queryString;
                    }

                    const hasHttpOrigin = typeof window !== 'undefined' && /^https?:$/i.test(window.location?.protocol || '');
                    const proxyEndpoints = Array.from(new Set([
                        environment.proxyUrl,
                        environment.proxyFallbackUrl,
                        ...(hasHttpOrigin ? ['/api/v1/Proxy'] : [])
                    ].filter(Boolean)));
                    const timeoutMs = this.tabStateService.requestTimeoutMs();
                    const proxyTimeoutMs = timeoutMs > 0 ? timeoutMs : 0;
                    let lastResult: any = null;

                    for (const currentProxyUrl of proxyEndpoints) {
                        if (freshState.bodyType === 'form-data') {
                            const fd = new FormData();
                            fd.append('url', targetUrl);
                            fd.append('method', freshState.method);
                            fd.append('headers', JSON.stringify(headersObj));
                            fd.append('verifySsl', String(freshState.settings?.verifySsl ?? false));
                            fd.append('timeoutMs', String(proxyTimeoutMs));
                            fd.append('bodyType', 'form-data');

                            // Append original files and fields
                            const rawFormData = Array.isArray(freshState.formData) ? freshState.formData : [];
                            const formRows = Array.isArray(body) ? body : [];
                            for (const row of formRows) {
                                if (!row || !row.key) continue;
                                const originalRow = rawFormData.find((f: any) => this.variableService.resolve(f.key || '') === row.key || f.key === row.key);
                                if (originalRow && originalRow.type === 'file' && originalRow.file) {
                                    fd.append(row.key, originalRow.file, originalRow.file.name);
                                } else {
                                    fd.append(row.key, row.value ?? '');
                                }
                            }

                            reqObservable = this.http.post<any>(`${currentProxyUrl}/multipart`, fd, {
                                observe: 'response' as const
                            });
                        } else {
                            const proxyPayload = {
                                url: targetUrl,
                                method: freshState.method,
                                headers: headersObj,
                                body: bodyPayload,
                                verifySsl: freshState.settings?.verifySsl ?? false,
                                timeoutMs: proxyTimeoutMs
                            };
                            reqObservable = this.http.post<any>(currentProxyUrl, proxyPayload, {
                                headers: new HttpHeaders({ 'Content-Type': 'application/json' }),
                                observe: 'response' as const
                            });
                        }

                        if (timeoutMs > 0) {
                            reqObservable = reqObservable.pipe(timeout(timeoutMs));
                        }

                        lastResult = await new Promise((resolve, reject) => {
                            const sub = reqObservable.subscribe({
                                next: (res: any) => resolve(res),
                                error: (err: any) => resolve(err)
                            });
                            cancelToken.cancelFn = () => {
                                sub.unsubscribe();
                                reject(new Error('Request cancelled'));
                            };
                        });

                        // If timed out (client RxJS timer or proxy timeout response), stop retrying fallback proxies
                        const isProxyTimeoutErr = lastResult instanceof HttpErrorResponse && (
                            lastResult.status === 408 ||
                            lastResult.status === 504 ||
                            (typeof lastResult.error?.message === 'string' && /timed out/i.test(lastResult.error.message))
                        );
                        if (lastResult?.name === 'TimeoutError' || isProxyTimeoutErr) {
                            break;
                        }

                        // If not a network/connection error (status 0 or 5xx), accept this result
                        if (!(lastResult instanceof HttpErrorResponse) || (lastResult.status > 0 && lastResult.status < 500)) {
                            break;
                        }
                    }

                    if (!(lastResult instanceof HttpErrorResponse) && lastResult?.body) {
                        proxyReturnedResponse = lastResult.body.data ? lastResult.body.data : lastResult.body;
                    } else {
                        httpResponse = lastResult;
                    }
                } else {
                    switch (freshState.method) {
                        case 'GET': reqObservable = this.http.get(finalUrl, reqOptions); break;
                        case 'POST':
                            reqObservable = this.http.post(finalUrl, finalBody, reqOptions); break;
                        case 'PUT':
                            reqObservable = this.http.put(finalUrl, finalBody, reqOptions); break;
                        case 'DELETE':
                            reqObservable = (finalBody !== null && finalBody !== undefined)
                                ? this.http.request('DELETE', finalUrl, { ...reqOptions, body: finalBody })
                                : this.http.delete(finalUrl, reqOptions);
                            break;
                        case 'PATCH': reqObservable = this.http.patch(finalUrl, finalBody, reqOptions); break;
                        case 'HEAD': reqObservable = this.http.head(finalUrl, reqOptions); break;
                        case 'OPTIONS': reqObservable = this.http.options(finalUrl, reqOptions); break;
                        default: reqObservable = this.http.request(freshState.method, finalUrl, { ...reqOptions, body: finalBody }); break;
                    }

                    const timeoutMs = this.tabStateService.requestTimeoutMs();
                    if (timeoutMs > 0) {
                        reqObservable = reqObservable.pipe(timeout(timeoutMs));
                    }

                    const rawResult: any = await new Promise((resolve, reject) => {
                        const sub = reqObservable.subscribe({
                            next: (res: any) => resolve(res),
                            error: (err: any) => resolve(err)
                        });
                        cancelToken.cancelFn = () => {
                            sub.unsubscribe();
                            reject(new Error('Request cancelled'));
                        };
                    });

                    httpResponse = rawResult;
                }
            } catch (err: any) {
                if (err.message === 'Request cancelled') {
                    const targetId = this.tabStateService.resolveTabId(effectiveTabId);
                    this.tabStateService.updateState(targetId, { isLoading: false });
                    return; // Stop processing
                }
                httpResponse = err as HttpErrorResponse;
            } finally {
                this.cancellationTokens.delete(effectiveTabId);
                this.cancellationTokens.delete(tabId);
            }

            const endTime = performance.now();
            let responseTime = Math.floor(endTime - startTime);

            // 8. Process Response
            let status = 0;
            let rawResponseBody: any = '';
            const responseHeaders: { key: string, value: string }[] = [];
            const responseCookies: any[] = Array.isArray(proxyReturnedResponse?.cookies) ? proxyReturnedResponse.cookies : [];

            if (proxyReturnedResponse) {
                status = proxyReturnedResponse.statusCode;
                rawResponseBody = proxyReturnedResponse.body ?? '';
                if (proxyReturnedResponse.responseTimeMs !== undefined) {
                    responseTime = proxyReturnedResponse.responseTimeMs;
                }
                if (proxyReturnedResponse.headers) {
                    Object.entries(proxyReturnedResponse.headers).forEach(([k, v]) => {
                        responseHeaders.push({ key: k, value: v });
                    });
                }
            } else if (electronNetworkError) {
                status = 0;
                const isTimeoutErr = electronNetworkError.code === 'ETIMEDOUT' || electronNetworkError.code === 'ESOCKETTIMEDOUT';
                rawResponseBody = {
                    error: isTimeoutErr ? 'Request Timed Out' : 'API Unreachable',
                    code: electronNetworkError.code || 'NETWORK_ERROR',
                    url: finalUrl,
                    ...(isTimeoutErr ? { timeoutMs: this.tabStateService.requestTimeoutMs() } : {}),
                    message: electronNetworkError.message || `Could not reach API at ${finalUrl}.`
                };
            } else if ((httpResponse as any)?.name === 'TimeoutError' || (
                httpResponse instanceof HttpErrorResponse && (
                    httpResponse.status === 408 ||
                    httpResponse.status === 504 ||
                    (typeof httpResponse.error?.message === 'string' && /timed out/i.test(httpResponse.error.message))
                )
            )) {
                const timeoutMs = this.tabStateService.requestTimeoutMs();
                const proxyTimeoutMsg = httpResponse instanceof HttpErrorResponse && typeof httpResponse.error?.message === 'string'
                    ? httpResponse.error.message
                    : '';
                status = 0;
                rawResponseBody = {
                    error: 'Request Timed Out',
                    code: 'ETIMEDOUT',
                    url: finalUrl,
                    timeoutMs,
                    message: proxyTimeoutMsg || (timeoutMs > 0
                        ? `Request timed out after ${timeoutMs} ms (${formatTimeoutLabel(timeoutMs)}) while waiting for a response from ${finalUrl}. You can adjust the global Request Timeout in Settings.`
                        : `Request timed out while waiting for a response from ${finalUrl}.`)
                };
            } else {
                status = httpResponse?.status || 0;
                rawResponseBody = (httpResponse as any)?.error;
                if (rawResponseBody === undefined || rawResponseBody === null) {
                    rawResponseBody = (httpResponse as HttpResponse<string>)?.body || (httpResponse as any)?.message || '';
                }

                const isPlainEmptyObject =
                    rawResponseBody !== null &&
                    typeof rawResponseBody === 'object' &&
                    !Array.isArray(rawResponseBody) &&
                    Object.keys(rawResponseBody).length === 0;
                const isProgressOrHttpErr =
                    rawResponseBody &&
                    typeof rawResponseBody === 'object' &&
                    (rawResponseBody instanceof Event ||
                        rawResponseBody.type === 'error' ||
                        rawResponseBody.name === 'HttpErrorResponse' ||
                        isPlainEmptyObject);
                const isEmptyStringOnZeroStatus =
                    status === 0 && (rawResponseBody === undefined || rawResponseBody === null || (typeof rawResponseBody === 'string' && !rawResponseBody.trim()));

                if (isProgressOrHttpErr || isEmptyStringOnZeroStatus) {
                    let message: string;
                    if (!this.networkService.isOnline()) {
                        message = 'Internet connection lost. Please check your network and try again.';
                    } else if (isUsingProxy) {
                        message = environment.production
                            ? 'Failed to connect to the target API or OnSteroid proxy (proxy.onsteroid.com). Verify the endpoint URL and your internet connection.'
                            : `Failed to connect to local proxy (OnSteroidApi at ${environment.proxyUrl}) or target API. Ensure OnSteroidApi is running.`;
                    } else {
                        message = isElectron
                            ? ((httpResponse as any)?.message || `Unable to connect to ${finalUrl}. Please verify the URL, port, SSL certificate, or network connectivity.`)
                            : `Unable to reach ${finalUrl}. The server may be offline, unreachable, blocked by CORS, or using an invalid SSL certificate.`;
                    }
                    rawResponseBody = {
                        error: 'API Unreachable',
                        url: finalUrl,
                        message
                    };
                }

                httpResponse?.headers?.keys().forEach(key => {
                    responseHeaders.push({ key, value: httpResponse!.headers.get(key) || '' });
                });
            }

            // Ensure unreachable status 0 responses never show an empty "{}" JSON body
            if (status === 0 && (
                rawResponseBody === '' ||
                rawResponseBody === null ||
                rawResponseBody === undefined ||
                (typeof rawResponseBody === 'object' && !Array.isArray(rawResponseBody) && Object.keys(rawResponseBody).length === 0)
            )) {
                rawResponseBody = {
                    error: 'API Unreachable',
                    url: finalUrl,
                    message: `Could not reach ${finalUrl}. Check that the server is running, the URL is valid, and network/SSL access is available.`
                };
            }

            let responseSize = 0;

            if (typeof rawResponseBody === 'string') {
                responseSize = new Blob([rawResponseBody]).size;
            } else if (rawResponseBody) {
                const str = JSON.stringify(rawResponseBody);
                responseSize = new Blob([str]).size;
            }

            let responseBodyParsed = rawResponseBody;
            if (typeof rawResponseBody === 'string') {
                try {
                    responseBodyParsed = JSON.parse(rawResponseBody);
                } catch {
                    responseBodyParsed = rawResponseBody;
                }
            }

            // 9. Post-Response Script Execution
            const postScriptCode = freshState.scripts?.postResponse
                ? this.variableService.resolveScript(freshState.scripts.postResponse)
                : '';
            let postResponseLogs = '';
            let testResults: any[] = [];
            if (postScriptCode && postScriptCode.trim()) {
                const context = this.buildScriptEnvContext({
                    url: finalUrl || resolvedUrl,
                    method: freshState.method,
                    responseStatus: status,
                    responseTime,
                    responseHeaders,
                    responseHeader: responseHeaders, // alias for backwards compatibility with default script
                    responseBody: responseBodyParsed,
                    headers, // provide request headers to post-script
                    body, // provide request body to post-script
                    params, // provide request params to post-script
                    bodyType: preparedEnc.bodyType,
                    rawType: preparedEnc.rawType,
                    formData: freshState.bodyType === 'form-data' && Array.isArray(body) ? body : preparedEnc.formData,
                    urlEncodedData: freshState.bodyType === 'x-www-form-urlencoded' && Array.isArray(body) ? body : preparedEnc.urlEncodedData,
                    graphql: freshState.bodyType === 'graphql' && body && typeof body === 'object' ? body : preparedEnc.graphql,
                    rawText: freshState.rawType === 'Text' && typeof body === 'string' ? body : preparedEnc.rawText
                });
                const result = await this.sandboxService.executeScript(
                    postScriptCode,
                    context,
                    freshState.scripts?.postResponseLanguage
                );
                postResponseLogs = result.logs || '';
                const mutated = this.applyScriptMutations(result.context, effectiveTabId);
                if (mutated.nextRequest !== undefined) scriptNextRequest = mutated.nextRequest;

                if (result.success && result.context) {
                    if (Array.isArray(result.context.testResults) && result.context.testResults.length > 0) {
                        testResults.push(...result.context.testResults);
                    }
                } else if (result.error) {
                    postResponseLogs += `\nError: ${result.error}`;
                }
            }

            // 9.5 Test Script Execution
            const testScriptCode = freshState.scripts?.testScript
                ? this.variableService.resolveScript(freshState.scripts.testScript)
                : '';
            if (freshState.scripts?.testScriptEnabled && testScriptCode && testScriptCode.trim()) {
                const testContext = this.buildScriptEnvContext({
                    url: finalUrl || resolvedUrl,
                    method: freshState.method,
                    responseStatus: status,
                    responseTime,
                    responseBody: responseBodyParsed,
                    responseHeaders,
                    responseHeader: responseHeaders,
                    headers,
                    body,
                    params,
                    bodyType: preparedEnc.bodyType,
                    rawType: preparedEnc.rawType,
                    formData: freshState.bodyType === 'form-data' && Array.isArray(body) ? body : preparedEnc.formData,
                    urlEncodedData: freshState.bodyType === 'x-www-form-urlencoded' && Array.isArray(body) ? body : preparedEnc.urlEncodedData,
                    graphql: freshState.bodyType === 'graphql' && body && typeof body === 'object' ? body : preparedEnc.graphql,
                    rawText: freshState.rawType === 'Text' && typeof body === 'string' ? body : preparedEnc.rawText
                });
                const testResult = await this.sandboxService.executeScript(
                    testScriptCode,
                    testContext,
                    freshState.scripts?.testScriptLanguage
                );
                const mutated = this.applyScriptMutations(testResult.context, effectiveTabId);
                if (mutated.nextRequest !== undefined) scriptNextRequest = mutated.nextRequest;
                if (testResult.context?.testResults && Array.isArray(testResult.context.testResults)) {
                    testResults = [...testResults, ...testResult.context.testResults];
                } else if (testResult.logs) {
                    const lines = testResult.logs.split('\n');
                    for (const line of lines) {
                        const m = line.match(/^(PASS|FAIL):\s*(.*)/i);
                        if (m) {
                            testResults.push({
                                name: m[2].trim(),
                                passed: m[1].toUpperCase() === 'PASS'
                            });
                        }
                    }
                }
                if (testResult.error) {
                    testResults.push({
                        name: 'Test Execution Error',
                        passed: false,
                        error: testResult.error
                    });
                }
            }

            // 10. Auto Auth Check — only triggered on 401, never on initial request
            if (status === 401 && !isAutoAuthRetry && this.autoAuthService.isAutoAuthEnabled(tabId)) {
                const endpointId = this.autoAuthService.getAutoAuthEndpointId();
                if (endpointId) {

                    // If a cached token existed but got 401, it has expired — clear it
                    if (this.autoAuthService.getCachedToken()) {
                        this.autoAuthService.clearCachedToken();
                    }

                    // Execute auth tab silently in background without switching UI
                    await this.executeRequest(endpointId, true); // true to prevent infinite loops

                    // Get token from auth response
                    const authState = this.tabStateService.getState(endpointId);
                    if (authState && authState.responseStatus === 200) {
                        const token = this.autoAuthService.extractAccessToken(authState.responseBody);
                        if (token) {

                            // Cache the token cleanly and synchronize it contextually into the active environment / Variables
                            this.autoAuthService.setCachedToken(token);
                            const existingAuthVar = this.variableService.variables().find(
                                v => (v.key || '').trim().toLowerCase() === 'authtoken'
                            );
                            if (this.environmentService.isEnvironmentFeatureEnabled() && this.environmentService.activeEnvironment()) {
                                this.environmentService.setActiveVariable('authToken', token);
                                if (!existingAuthVar) {
                                    this.variableService.addVariable('authToken', '', undefined, 'global');
                                }
                            } else {
                                this.variableService.addVariable('authToken', token, undefined, 'global');
                            }

                            // Also update this tab's auth state for explicit auth type tabs
                            const originalState = this.tabStateService.getState(tabId);
                            if (originalState && (originalState.auth.type === 'bearer' || originalState.auth.type === 'none')) {
                                this.tabStateService.updateState(tabId, {
                                    auth: {
                                        ...originalState.auth,
                                        type: 'bearer',
                                        token: token
                                    }
                                });
                            }

                            // Retry original request silently
                            await this.executeRequest(tabId, true);
                            return; // Exit here as retry will handle state update
                        } else {
                            console.warn(' [Auto Auth] Could not extract token from auth response.');
                        }
                    } else {
                        console.warn(' [Auto Auth] Auth request failed with status:', authState?.responseStatus);
                    }

                }
            }

            // Check if this execution is still current before committing results
            if (cancelToken.cancelled || (!isIsolated && !this.tabStateService.isExecutionCurrent(effectiveTabId, executionToken))) {
                return;
            }

            // 10.5 Automated Retry on Failure (if configured in Trigger & Automation Flow)
            const triggerCfg: TriggerFlowConfig = freshState.triggerConfig || {
                condition: 'always',
                expectedStatus: 200,
                delayMs: 250,
                retryCountOnFail: 0,
                scheduleIntervalMs: 0
            };
            const maxRetries = Math.max(0, Math.floor(Number(triggerCfg.retryCountOnFail) || 0));
            if (!isAutoAuthRetry && (status === 0 || status >= 500) && retryAttempt < maxRetries) {
                const retryDelayMs = Math.max(250, Math.min(10000, Number(triggerCfg.delayMs ?? 350)));
                this.notificationService.notify(
                    `Request "${freshState.name || finalUrl}" returned ${status || 'network error'} — retrying (${retryAttempt + 1}/${maxRetries})...`,
                    'warning'
                );
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                if (!cancelToken.cancelled && (isIsolated || this.tabStateService.isExecutionCurrent(effectiveTabId, executionToken))) {
                    await this.executeRequest(tabId, false, chainDepth, retryAttempt + 1, options);
                }
                return;
            }

            const targetId = this.tabStateService.resolveTabId(effectiveTabId);

            // 11. Update Tab State
            const responseData = {
                responseBody: responseBodyParsed,
                responseStatus: status,
                responseTime,
                responseSize,
                responseHeaders: responseHeaders.map(rh => ({ enabled: true, key: rh.key, value: rh.value })),
                responseCookies,
                testResults,
                scripts: {
                    ...freshState.scripts,
                    preRequestConsole: preRequestLogs,
                    postResponseConsole: postResponseLogs,
                    encryptionConsole: encryptionLogs
                }
            };

            this.tabStateService.updateState(targetId, {
                isLoading: false,
                ...responseData
            });

            // Persist returned cookies into local Cookie Jar
            if (freshState.settings?.enableCookies !== false && responseCookies.length > 0) {
                this.cookieJar.captureResponseCookies(finalUrl, responseCookies);
            }

            // Notify execution observers (Enterprise Audit Log)
            for (const observer of this.executionObservers) {
                try {
                    observer({
                        tabId: targetId,
                        capsuleId: freshState.capsuleId,
                        requestName: freshState.name || finalUrl,
                        method: freshState.method,
                        url: finalUrl,
                        status,
                        responseTimeMs: responseTime,
                        timestamp: Date.now()
                    });
                } catch {}
            }

            const latestReqState = this.tabStateService.getState(targetId) || freshState;

            // Dynamically sync any variables sourced from this request's inputs (body, headers, params) or response
            this.variableService.syncVariablesFromInputs(targetId, latestReqState);
            this.variableService.syncVariablesFromResponse(
                targetId,
                responseBodyParsed,
                responseData.responseHeaders,
                latestReqState,
                resolvedUrl
            );
            this.environmentService.syncActiveEnvVariablesFromResponse(
                targetId,
                responseBodyParsed,
                responseData.responseHeaders,
                latestReqState,
                resolvedUrl
            );

            this.tabStateService.cacheResponse(targetId, freshState.url, {
                responseBody: responseBodyParsed,
                responseStatus: status,
                responseTime,
                responseSize,
                responseHeaders: responseData.responseHeaders,
                testResults
            });

            this.recordHistory({
                method: freshState.method,
                url: resolvedUrl || freshState.url,
                requestSnapshot: JSON.stringify({
                    ...freshState,
                    ...responseData
                }),
                responseStatus: status,
                responseTime,
                responseSize
            });

            options?.onComplete?.({
                status,
                durationMs: responseTime,
                testsPassed: testResults.filter(t => !!t.passed).length,
                testsFailed: testResults.filter(t => !t.passed).length,
                url: finalUrl,
                responseHeaders: responseData.responseHeaders,
                responseBody: responseBodyParsed,
                testResults
            });

            // Post-Response Request Chaining & Script-Controlled Flow (Trigger Next Request)
            let resolvedTriggerTargetId: string | null = null;
            if (scriptNextRequest === null) {
                resolvedTriggerTargetId = null;
            } else if (typeof scriptNextRequest === 'string' && scriptNextRequest.trim()) {
                const needle = scriptNextRequest.trim().toLowerCase();
                const allReqs = this.tabStateService.allCapsuleRequests();
                const matched = allReqs.find(r => r.id.toLowerCase() === needle)
                    || allReqs.find(r => (r.name || '').trim().toLowerCase() === needle)
                    || allReqs.find(r => (r.name || '').toLowerCase().includes(needle));
                if (matched) {
                    resolvedTriggerTargetId = matched.id;
                } else {
                    this.notificationService.notify(`Script setNextRequest target "${scriptNextRequest}" was not found in active capsule.`, 'warning');
                }
            } else if (freshState.postTriggerTabId && freshState.postTriggerTabId !== '__script__') {
                const cond = triggerCfg.condition || 'always';
                const allTestsPassed = testResults.length === 0 || testResults.every(t => !!t.passed);
                const conditionMet =
                    cond === 'always' ||
                    (cond === 'on-2xx' && status >= 200 && status < 300) ||
                    (cond === 'on-tests-pass' && allTestsPassed) ||
                    (cond === 'on-status-match' && status === Number(triggerCfg.expectedStatus ?? 200));
                if (conditionMet) {
                    resolvedTriggerTargetId = freshState.postTriggerTabId;
                }
            }

            if (resolvedTriggerTargetId && resolvedTriggerTargetId !== '__script__') {
                const targetTabId = resolvedTriggerTargetId;
                const authEndpointId = this.autoAuthService.getAutoAuthEndpointId();
                const isCurrentAuthTab = !!(authEndpointId && authEndpointId === tabId);
                const targetReq = this.tabStateService.allCapsuleRequests().find(r => r.id === targetTabId);
                const targetState = this.tabStateService.getState(targetTabId) || targetReq;
                const targetHasAutoAuth = this.autoAuthService.isAutoAuthEnabled(targetTabId) || !!(targetState?.autoAuthEnabled ?? targetReq?.autoAuthEnabled);

                if (isCurrentAuthTab && targetHasAutoAuth) {
                    console.warn(`[Trigger] Skipped chained trigger to "${targetState?.name || targetTabId}" because it has Auto Auth enabled linked to this auth endpoint (prevents infinite loop).`);
                } else if (chainDepth >= 10) {
                    this.notificationService.notify('Chained request depth limit reached (max 10) to prevent infinite loops.', 'warning');
                } else if (targetState) {
                    const delayMs = Math.max(0, Math.min(60000, Number(triggerCfg.delayMs ?? 250)));
                    this.notificationService.notify(
                        `Triggering chained request: "${targetState.name || 'Request'}"${delayMs > 0 ? ` in ${delayMs}ms` : ''}...`
                    );
                    if (targetReq) {
                        this.tabStateService.addOpenTab(targetReq);
                    }
                    this.tabStateService.setActiveTab(targetTabId);
                    setTimeout(() => {
                        this.executeRequest(targetTabId, false, chainDepth + 1, 0);
                    }, delayMs);
                }
            }

        } catch (globalErr: any) {
            const latestCfgState = this.tabStateService.getState(effectiveTabId);
            const catchMaxRetries = Math.max(0, Math.floor(Number(latestCfgState?.triggerConfig?.retryCountOnFail) || 0));
            if (!isAutoAuthRetry && !cancelToken.cancelled && retryAttempt < catchMaxRetries) {
                const catchDelayMs = Math.max(250, Math.min(10000, Number(latestCfgState?.triggerConfig?.delayMs ?? 350)));
                this.notificationService.notify(
                    `Request execution failed — retrying (${retryAttempt + 1}/${catchMaxRetries})...`,
                    'warning'
                );
                await new Promise(resolve => setTimeout(resolve, catchDelayMs));
                if (!cancelToken.cancelled && (isIsolated || this.tabStateService.isExecutionCurrent(effectiveTabId, executionToken))) {
                    await this.executeRequest(tabId, false, chainDepth, retryAttempt + 1, options);
                }
                return;
            }
            console.error("Critical Execution Error:", globalErr);
            const resolvedTargetUrl = (this.tabStateService.getState(effectiveTabId)?.url || '').trim();
            const fallbackBody = {
                error: 'API Unreachable',
                url: resolvedTargetUrl,
                message: globalErr?.message || String(globalErr || 'Failed to connect to the server.')
            };
            if (!isIsolated) {
                this.tabStateService.updateState(effectiveTabId, {
                    isLoading: false,
                    responseStatus: 0,
                    responseBody: fallbackBody,
                    responseSize: new Blob([JSON.stringify(fallbackBody)]).size
                });
            }
            options?.onComplete?.({
                status: 0,
                durationMs: 0,
                testsPassed: 0,
                testsFailed: 0,
                error: globalErr?.message || String(globalErr || 'Execution error')
            });
        } finally {
            if (isAutoAuthRetry && originalTabId && originalTabId !== tabId) {
                this.tabStateService.setActiveTab(originalTabId);
            }
        }
    }

    private recordHistory(entry: {
        method: string;
        url: string;
        requestSnapshot: string;
        responseStatus: number;
        responseTime: number;
        responseSize: number;
    }) {
        try {
            const raw = localStorage.getItem('onsteroids_history');
            const list = raw ? JSON.parse(raw) : [];
            const historyItem = {
                id: generateUUID(),
                ...entry,
                createdAt: new Date().toISOString()
            };
            list.unshift(historyItem);
            if (list.length > 200) list.pop();
            localStorage.setItem('onsteroids_history', JSON.stringify(list));
        } catch (e) { }

        if (this.authService.isLoggedIn()) {
            this.http.post(`${API_BASE_URL}/History`, entry).subscribe({
                error: (err) => console.warn('Could not persist history to backend', err)
            });
        }
    }

    private buildScriptEnvContext(extra: Record<string, any> = {}): Record<string, any> {
        const envVars: Record<string, string> = {};
        const activeEnv = this.environmentService.activeEnvironment();
        if (activeEnv?.variables) {
            for (const v of activeEnv.variables) {
                if (v.enabled && v.key && v.key.trim()) {
                    envVars[v.key.trim()] = v.value ?? '';
                }
            }
        }
        const capsuleVars: Record<string, string> = {};
        for (const v of this.variableService.variables()) {
            if (v.enabled && v.key && v.key.trim()) {
                capsuleVars[v.key.trim()] = v.value ?? '';
            }
        }
        return {
            ...extra,
            __envVars: envVars,
            __capsuleVars: capsuleVars
        };
    }

    private applyScriptMutations(resultContext?: Record<string, any>, currentTabId?: string): { nextRequest?: string | null } {
        if (!resultContext || typeof resultContext !== 'object') {
            return {};
        }
        const applyContextualSet = (rawKey: string, val: any, preferEnv: boolean) => {
            const key = (rawKey || '').trim();
            if (!key) return;
            const strVal = String(val ?? '');
            const existingKey = this.variableService.variables().some(
                v => (v.key || '').trim().toLowerCase() === key.toLowerCase()
            );
            const hasActiveEnv = this.environmentService.isEnvironmentFeatureEnabled() && !!this.environmentService.activeEnvironment();
            if (hasActiveEnv) {
                this.environmentService.setActiveVariable(key, strVal);
                if (!existingKey) {
                    // Register key schema in shared Variables list without leaking active env value to other envs
                    this.variableService.addVariable(key, '', undefined, 'global');
                }
            } else {
                this.variableService.addVariable(key, strVal, undefined, 'global');
                if (this.environmentService.isEnvironmentFeatureEnabled()) {
                    this.environmentService.ensureKeyAcrossEnvironments(key, preferEnv ? strVal : undefined);
                }
            }
        };

        const envSet = resultContext['__envSet'];
        if (envSet && typeof envSet === 'object') {
            for (const [key, val] of Object.entries(envSet)) {
                applyContextualSet(key, val, true);
            }
        }
        const envUnset = resultContext['__envUnset'];
        if (Array.isArray(envUnset)) {
            for (const key of envUnset) {
                if (typeof key === 'string' && key) {
                    this.environmentService.unsetActiveVariable(key);
                }
            }
        }
        const varSet = resultContext['__varSet'];
        if (varSet && typeof varSet === 'object') {
            for (const [key, val] of Object.entries(varSet)) {
                applyContextualSet(key, val, false);
            }
        }

        const fieldLinks = resultContext['__requestFieldLinks'];
        if (Array.isArray(fieldLinks) && fieldLinks.length > 0) {
            const byTargetId = new Map<string, RequestFieldLinkMutation[]>();
            const allReqs = this.tabStateService.allCapsuleRequests();
            for (const rawLink of fieldLinks as RequestFieldLinkMutation[]) {
                if (!rawLink) continue;
                let destId = currentTabId ? this.tabStateService.resolveTabId(currentTabId) : '';
                if (rawLink.request && String(rawLink.request).trim()) {
                    const needle = String(rawLink.request).trim().toLowerCase();
                    const matched = allReqs.find(r => r.id.toLowerCase() === needle)
                        || allReqs.find(r => (r.name || '').trim().toLowerCase() === needle)
                        || allReqs.find(r => (r.name || '').toLowerCase().includes(needle));
                    if (matched) {
                        destId = this.tabStateService.resolveTabId(matched.id);
                    }
                }
                if (destId) {
                    const arr = byTargetId.get(destId) || [];
                    arr.push(rawLink);
                    byTargetId.set(destId, arr);
                }
            }
            for (const [destId, linksForTab] of byTargetId.entries()) {
                const targetState = this.tabStateService.getState(destId);
                if (targetState) {
                    const patch = applyRequestFieldLinksToTabState(targetState, linksForTab);
                    if (Object.keys(patch).length > 0) {
                        this.tabStateService.updateState(destId, patch);
                    }
                }
            }
        }

        return {
            nextRequest: '__nextRequest' in resultContext ? (resultContext['__nextRequest'] as string | null) : undefined
        };
    }
}
