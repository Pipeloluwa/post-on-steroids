import { Injectable, signal, computed, effect, untracked, inject, PLATFORM_ID, Injector } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, UserAuth } from './auth.service';
import { API_BASE_URL } from '../constants/api.constants';
import { VariableService } from './variable.service';

export interface KeyValue {
    enabled: boolean;
    key: string;
    value: string;
}
export interface FormDataRow {
    enabled: boolean;
    key: string;
    value: string;
    type: 'text' | 'file';
}

export interface AuthState {
    type: 'none' | 'bearer' | 'basic';
    token: string;
}

export interface ScriptsState {
    preRequest: string;
    postResponse: string;
    preRequestConsole: string;
    postResponseConsole: string;
    encryptionConsole: string;
    testScript: string;
    testScriptEnabled: boolean;
}

export interface CookieRow {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: string;
}


export interface TestResult {
    name: string;
    passed: boolean;
}

export interface EncryptionState {
    algorithm: 'AES-256' | 'RSA-2048' | 'none';
    key: string;
    autoEncryptBody: boolean;
    autoEncryptHeaders: boolean;
    channelName: string;
    encryptedHeaders: string[];
    encryptedBodyPaths: string[];
    script: string;
}

export interface SettingsState {
    followRedirects: boolean;
    verifySsl: boolean;
    enableCookies: boolean;
    bypassCors: boolean;
}

export interface RequestState {
    id: string;
    capsuleId?: string;
    url: string;
    method: string;
    name: string;
    isDirty: boolean;
    isLoading: boolean;
    autoAuthEnabled?: boolean;
    postTriggerTabId?: string | null;
    // Payload type tabs
    payloadType: string;
    params: KeyValue[];
    headers: KeyValue[];
    auth: AuthState;
    scripts: ScriptsState;
    encryption: EncryptionState;
    settings: SettingsState;
    // Body
    bodyType: string;
    rawType: string;
    rawBody: string; // Keep for compatibility or current selection
    rawBodyJson: string;
    rawBodyXml: string;
    formData: FormDataRow[];
    requestBody: unknown;
    // Response
    responseBody: unknown;
    responseStatus: number | null;
    responseTime: number | null;
    responseSize: number | null;
    responseCookies: CookieRow[];
    responseHeaders: KeyValue[];
    testResults: TestResult[];
    editorScrollPositions: Record<string, { scrollTop: number; scrollLeft: number }>;
}


export interface Capsule {
    id: string;
    name: string;
    createdAt: number;
}

@Injectable({
    providedIn: 'root',
})
export class TabStateService {
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);
    private http = inject(HttpClient);
    private authService = inject(AuthService);
    private injector = inject(Injector);
    private states = signal<Map<string, RequestState>>(new Map());
    openTabIds = signal<string[]>([]);

    private getVariableService(): VariableService | null {
        try {
            return this.injector.get(VariableService);
        } catch {
            return null;
        }
    }

    snapshotCurrentSession(userParam?: UserAuth | null) {
        if (!this.isBrowser) return;

        // CRITICAL GUARD: Never overwrite a valid saved session with an empty workspace!
        if (this.openTabIds().length === 0 && this.states().size === 0) {
            return;
        }

        const user = userParam || this.authService.currentUser();
        const effectiveId = user?.id || user?.email || 'default';
        try {
            const currentStates = Array.from(this.states().entries());
            let storedResponses: Record<string, any> = {};
            try {
                const rawResp = localStorage.getItem('onsteroids_responses');
                if (rawResp) storedResponses = JSON.parse(rawResp);
            } catch {}

            // Ensure all live responses from tab states are captured
            for (const [id, s] of currentStates) {
                if (s.responseBody !== null && s.responseBody !== undefined) {
                    storedResponses[id] = {
                        responseBody: s.responseBody,
                        responseStatus: s.responseStatus,
                        responseTime: s.responseTime,
                        responseSize: s.responseSize,
                        responseCookies: s.responseCookies,
                        responseHeaders: s.responseHeaders,
                        testResults: s.testResults
                    };
                }
            }

            const vs = this.getVariableService();

            const sessionData = {
                userId: effectiveId,
                activeCapsuleId: this.activeCapsuleId(),
                activeCapsuleName: this.activeCapsuleName(),
                capsules: this.capsules(),
                openTabIds: this.openTabIds(),
                activeTabId: this.activeTabId(),
                states: currentStates,
                responses: storedResponses,
                variables: vs ? vs.variables() : [],
                autoAuthEnabled: this.autoAuthEnabled(),
                autoAuthEndpointId: this.autoAuthEndpointId(),
                timestamp: Date.now()
            };

            const serialized = JSON.stringify(sessionData);
            localStorage.setItem(`onsteroids_user_session_${effectiveId}`, serialized);
            localStorage.setItem('onsteroids_last_session', serialized);
            if (user?.id) localStorage.setItem(`onsteroids_user_session_${user.id}`, serialized);
            if (user?.email) localStorage.setItem(`onsteroids_user_session_${user.email}`, serialized);

            if (this.authService.isLoggedIn() && vs) {
                clearTimeout(this.backendSyncTimeout);
                this.backendSyncTimeout = setTimeout(() => {
                    vs.syncVariablesToBackend().catch(() => {});
                }, 2000);
            }
        } catch (e) {
            console.error('Error snapshotting session', e);
        }
    }

    restoreUserSession(user?: UserAuth | null): boolean {
        if (!this.isBrowser) return false;
        const u = user || this.authService.currentUser();
        try {
            const keysToTry: string[] = [];
            if (u?.id) keysToTry.push(`onsteroids_user_session_${u.id}`);
            if (u?.email) keysToTry.push(`onsteroids_user_session_${u.email}`);
            keysToTry.push('onsteroids_last_session');

            let sessionRaw: string | null = null;
            for (const k of keysToTry) {
                sessionRaw = localStorage.getItem(k);
                if (sessionRaw) {
                    try {
                        const parsed = JSON.parse(sessionRaw);
                        // Make sure parsed session isn't empty
                        if (parsed && (
                            (Array.isArray(parsed.openTabIds) && parsed.openTabIds.length > 0) ||
                            (Array.isArray(parsed.states) && parsed.states.length > 0)
                        )) {
                            break;
                        }
                    } catch {}
                }
            }

            if (!sessionRaw) return false;

            const session = JSON.parse(sessionRaw);
            if (!session) return false;

            // 1. Restore capsules
            if (Array.isArray(session.capsules) && session.capsules.length > 0) {
                this.capsules.set(session.capsules);
            }

            // 2. Restore active capsule
            if (session.activeCapsuleId) {
                this.activeCapsuleId.set(session.activeCapsuleId);
                localStorage.setItem('onsteroids_active_capsule', session.activeCapsuleId);
            }
            if (session.activeCapsuleName) {
                this.activeCapsuleName.set(session.activeCapsuleName);
            }

            // 3. Restore states (hydrating response bodies & test results)
            if (Array.isArray(session.states) && session.states.length > 0) {
                const restoredMap = new Map<string, RequestState>(session.states);
                if (session.responses && typeof session.responses === 'object') {
                    for (const [id, state] of restoredMap.entries()) {
                        const resp = session.responses[id];
                        if (resp) {
                            restoredMap.set(id, {
                                ...state,
                                responseBody: state.responseBody ?? resp.responseBody,
                                responseStatus: state.responseStatus ?? resp.responseStatus,
                                responseTime: state.responseTime ?? resp.responseTime,
                                responseSize: state.responseSize ?? resp.responseSize,
                                responseCookies: state.responseCookies ?? resp.responseCookies,
                                responseHeaders: state.responseHeaders ?? resp.responseHeaders,
                                testResults: state.testResults ?? resp.testResults
                            });
                        }
                    }
                }
                this.states.set(restoredMap);
            }

            // 4. Restore open tabs and active tab
            if (Array.isArray(session.openTabIds) && session.openTabIds.length > 0) {
                this.openTabIds.set(session.openTabIds);
                localStorage.setItem('onsteroids_open_tab_ids', JSON.stringify(session.openTabIds));
                if (session.activeCapsuleId) {
                    localStorage.setItem(`onsteroids_open_tab_ids_${session.activeCapsuleId}`, JSON.stringify(session.openTabIds));
                }
            }
            if (session.activeTabId) {
                this.activeTabId.set(session.activeTabId);
                localStorage.setItem('onsteroids_active_tab', session.activeTabId);
                if (session.activeCapsuleId) {
                    localStorage.setItem(`onsteroids_active_tab_${session.activeCapsuleId}`, session.activeTabId);
                }
            }

            // 5. Restore responses in localStorage
            if (session.responses) {
                localStorage.setItem('onsteroids_responses', JSON.stringify(session.responses));
            }

            // 6. Restore auto-auth
            if (session.autoAuthEnabled) {
                this.autoAuthEnabled.set(session.autoAuthEnabled);
            }
            if (session.autoAuthEndpointId) {
                this.autoAuthEndpointId.set(session.autoAuthEndpointId);
            }

            // 7. Restore variables in VariableService
            const vs = this.getVariableService();
            if (vs) {
                if (Array.isArray(session.variables) && session.variables.length > 0) {
                    vs.setVariables(session.variables);
                } else {
                    vs.restoreUserVariables(u);
                }
            }

            return true;
        } catch (e) {
            console.error('Failed to restore user session', e);
            return false;
        }
    }

    async saveFinalSessionBeforeLogout(): Promise<void> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) return;
        try {
            this.snapshotCurrentSession();
            const vs = this.getVariableService();
            if (vs) {
                vs.saveVariables(false);
                await vs.syncVariablesToBackend();
            }
        } catch (e) {
            console.error('Error saving session before logout', e);
        }
    }

    getBackendSessionPayload(): any {
        try {
            const currentStates = Array.from(this.states().entries());
            let storedResponses: Record<string, any> = {};
            try {
                const rawResp = localStorage.getItem('onsteroids_responses');
                if (rawResp) storedResponses = JSON.parse(rawResp);
            } catch {}

            for (const [id, s] of currentStates) {
                if (s.responseBody !== null && s.responseBody !== undefined) {
                    storedResponses[id] = {
                        responseBody: s.responseBody,
                        responseStatus: s.responseStatus,
                        responseTime: s.responseTime,
                        responseSize: s.responseSize,
                        responseCookies: s.responseCookies,
                        responseHeaders: s.responseHeaders,
                        testResults: s.testResults
                    };
                }
            }

            const vs = this.getVariableService();

            return {
                activeCapsuleId: this.activeCapsuleId(),
                activeCapsuleName: this.activeCapsuleName(),
                openTabIds: this.openTabIds(),
                activeTabId: this.activeTabId(),
                states: currentStates,
                responses: storedResponses,
                variables: vs ? vs.variables() : [],
                autoAuthEnabled: this.autoAuthEnabled(),
                autoAuthEndpointId: this.autoAuthEndpointId(),
                timestamp: Date.now()
            };
        } catch (e) {
            return null;
        }
    }

    applyBackendSession(session: any) {
        if (!session) return;

        if (session.activeCapsuleId) {
            this.activeCapsuleId.set(session.activeCapsuleId);
            if (this.isBrowser) {
                localStorage.setItem('onsteroids_active_capsule', session.activeCapsuleId);
            }
        }
        if (session.activeCapsuleName) {
            this.activeCapsuleName.set(session.activeCapsuleName);
        }

        // Restore tab states (e.g. unsaved draft tabs, modified settings, etc.)
        if (Array.isArray(session.states) && session.states.length > 0) {
            this.states.update(map => {
                const next = new Map(map);
                for (const [id, state] of session.states) {
                    if (!next.has(id)) {
                        next.set(id, state);
                    } else {
                        next.set(id, { ...next.get(id), ...state });
                    }
                }
                return next;
            });
        }

        if (session.responses && typeof session.responses === 'object') {
            this.states.update(map => {
                const next = new Map(map);
                for (const [id, state] of next.entries()) {
                    const resp = session.responses[id];
                    if (resp) {
                        next.set(id, {
                            ...state,
                            responseBody: state.responseBody ?? resp.responseBody,
                            responseStatus: state.responseStatus ?? resp.responseStatus,
                            responseTime: state.responseTime ?? resp.responseTime,
                            responseSize: state.responseSize ?? resp.responseSize,
                            responseCookies: state.responseCookies ?? resp.responseCookies,
                            responseHeaders: state.responseHeaders ?? resp.responseHeaders,
                            testResults: state.testResults ?? resp.testResults
                        });
                    }
                }
                return next;
            });

            if (this.isBrowser) {
                try {
                    localStorage.setItem('onsteroids_responses', JSON.stringify(session.responses));
                } catch {}
            }
        }

        if (Array.isArray(session.openTabIds) && session.openTabIds.length > 0) {
            this.openTabIds.set(session.openTabIds);
        }
        if (session.activeTabId) {
            this.activeTabId.set(session.activeTabId);
        }

        if (session.autoAuthEnabled) {
            this.autoAuthEnabled.set(session.autoAuthEnabled);
        }
        if (session.autoAuthEndpointId) {
            this.autoAuthEndpointId.set(session.autoAuthEndpointId);
        }
    }

    getState(id: string): RequestState | undefined {
        return this.states().get(id);
    }
    private backendSyncTimeout: any;
    activeTabId = signal<string | null>(null);
    activeCapsuleName = signal<string>('My Capsule');
    activeCapsuleId = signal<string>('1');
    autoAuthEnabled = signal<'off' | 'individual' | 'global'>('off');
    autoAuthEndpointId = signal<string | null>(null);
    isCapsuleLoading = signal<boolean>(false);
    isSaving = signal<boolean>(false);
    requestExamplesMap = signal<Map<string, any[]>>(new Map());
    examplesLoadingMap = signal<Set<string>>(new Set());

    isExamplesLoading(requestId: string): boolean {
        return this.examplesLoadingMap().has(requestId);
    }

    private historyStack = new Map<string, { past: Partial<RequestState>[], future: Partial<RequestState>[] }>();

    // Shared capsule list (drives both workspace sidebar and Capsules page)
    capsules = signal<Capsule[]>([
        { id: '1', name: 'My Capsule', createdAt: Date.now() - 10000 },
        { id: '2', name: 'API Project A', createdAt: Date.now() - 5000 },
        { id: '3', name: 'Personal Sandbox', createdAt: Date.now() }
    ]);

    // In-memory "database" of saved requests
    savedCapsules = signal<RequestState[]>([]);

    // All requests belonging to the active capsule (both saved in backend and local/open tabs)
    allCapsuleRequests = computed<RequestState[]>(() => {
        const capId = this.activeCapsuleId();
        const saved = this.savedCapsules().filter(r => !r.capsuleId || r.capsuleId === capId);
        const inMemory = Array.from(this.states().values()).filter(s => !s.capsuleId || s.capsuleId === capId);

        const map = new Map<string, RequestState>();
        for (const req of saved) {
            map.set(req.id, req);
        }
        for (const req of inMemory) {
            map.set(req.id, req);
        }
        return Array.from(map.values());
    });

    // Reactive list of open tabs (mirrors the horizontal tab strip)
    openTabs = computed<RequestState[]>(() => {
        const ids = this.openTabIds();
        const stateMap = this.states();
        return ids.map(id => stateMap.get(id)).filter((s): s is RequestState => Boolean(s));
    });

    activeTabState = computed(() => {
        const id = this.activeTabId();
        return id ? this.states().get(id) || this.getDefaultState(id) : null;
    });

    private isLoadingBackendData = false;
    private hasInitialBackendLoaded = false;
    private statesSaveTimeout: any = null;
    private fetchedExamplesIds = new Set<string>();
    private inFlightExampleRequests = new Map<string, Promise<any[]>>();

    constructor() {
        if (this.isBrowser) {
            this.loadFromStorage();
        }

        // 1. Lightweight tab & capsule metadata persisted immediately
        effect(() => {
            if (this.isBrowser) {
                const capId = this.activeCapsuleId();
                if (capId) {
                    localStorage.setItem('onsteroids_active_capsule', capId);
                    localStorage.setItem(`onsteroids_active_tab_${capId}`, this.activeTabId() || '');
                    localStorage.setItem(`onsteroids_open_tab_ids_${capId}`, JSON.stringify(this.openTabIds()));
                }
                localStorage.setItem('onsteroids_active_tab', this.activeTabId() || '');
                localStorage.setItem('onsteroids_open_tab_ids', JSON.stringify(this.openTabIds()));
                localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
                localStorage.setItem('autoAuthEnabled', String(this.autoAuthEnabled()));
                localStorage.setItem('autoAuthEndpointId', this.autoAuthEndpointId() || '');
            }
        });

        // 2. Heavy states JSON serialization debounced by 300ms (eliminates lag during tab clicks)
        effect(() => {
            const statesMap = this.states();
            if (this.isBrowser) {
                if (this.statesSaveTimeout) {
                    clearTimeout(this.statesSaveTimeout);
                }
                this.statesSaveTimeout = setTimeout(() => {
                    try {
                        const currentStates = Array.from(statesMap.entries());
                        localStorage.setItem('onsteroids_states', JSON.stringify(currentStates));
                    } catch (e) {
                        console.warn('Could not persist all states to localStorage:', e);
                    }
                }, 300);
            }
        });

        // 3. One-time backend loading on login/startup (untracked to prevent reactive loops)
        effect(() => {
            const loggedIn = this.authService.isLoggedIn();
            if (loggedIn && !this.hasInitialBackendLoaded) {
                untracked(() => {
                    this.loadBackendData();
                });
            }
        });

        this.authService.onLogout.subscribe((user) => {
            this.hasInitialBackendLoaded = false;
            this.fetchedExamplesIds.clear();
            this.inFlightExampleRequests.clear();
            this.clearWorkspace(user);
        });

        this.authService.onLogin.subscribe((user) => {
            this.restoreUserSession(user);
            this.loadBackendData();
        });

        if (this.states().size === 0) {
            this.setActiveTab('1');
        }
    }

    private loadFromStorage() {
        if (!this.isBrowser) return;

        if (this.authService.isLoggedIn()) {
            const restored = this.restoreUserSession(this.authService.currentUser());
            if (restored) return;
        }

        const savedCapsulesList = localStorage.getItem('onsteroids_capsules');
        if (savedCapsulesList) {
            try {
                const parsed = JSON.parse(savedCapsulesList);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.capsules.set(parsed);
                }
            } catch (e) {
                console.error('Failed to parse saved capsules list', e);
            }
        }

        const savedActiveCapId = localStorage.getItem('onsteroids_active_capsule');
        if (savedActiveCapId) {
            const found = this.capsules().find(c => c.id === savedActiveCapId);
            if (found) {
                this.activeCapsuleId.set(found.id);
                this.activeCapsuleName.set(found.name);
            }
        }

        const savedStates = localStorage.getItem('onsteroids_states');
        if (savedStates) {
            try {
                const parsed = JSON.parse(savedStates);
                this.states.set(new Map(parsed));
            } catch (e) {
                console.error('Failed to load states from storage', e);
            }
        }

        const currentCapId = this.activeCapsuleId();
        const capOpenTabs = localStorage.getItem(`onsteroids_open_tab_ids_${currentCapId}`) || localStorage.getItem('onsteroids_open_tab_ids');
        const capActiveTab = localStorage.getItem(`onsteroids_active_tab_${currentCapId}`) || localStorage.getItem('onsteroids_active_tab');

        if (capOpenTabs) {
            try {
                const parsed = JSON.parse(capOpenTabs);
                if (Array.isArray(parsed)) {
                    this.openTabIds.set(parsed.filter(item => typeof item === 'string'));
                }
            } catch (e) {
                console.error('Failed to load open tabs from storage', e);
            }
        }

        if (this.openTabIds().length === 0 && this.states().size > 0) {
            const capTabs = Array.from(this.states().values())
                .filter(s => s.capsuleId === currentCapId || !s.capsuleId)
                .map(s => s.id);
            this.openTabIds.set(capTabs.length > 0 ? capTabs : Array.from(this.states().keys()));
        }

        if (capActiveTab && this.openTabIds().includes(capActiveTab)) {
            this.activeTabId.set(capActiveTab);
        } else if (this.openTabIds().length > 0) {
            this.activeTabId.set(this.openTabIds()[0]);
        }

        const savedAutoAuth = localStorage.getItem('autoAuthEnabled');
        const savedAutoAuthId = localStorage.getItem('autoAuthEndpointId');
        if (savedAutoAuth) {
            if (savedAutoAuth === 'true') {
                this.autoAuthEnabled.set('individual');
            } else if (savedAutoAuth === 'false') {
                this.autoAuthEnabled.set('off');
            } else {
                this.autoAuthEnabled.set(savedAutoAuth as any);
            }
        }
        if (savedAutoAuthId) {
            this.autoAuthEndpointId.set(savedAutoAuthId);
        }

        this.preloadAllExamples();
    }

    setActiveTab(id: string) {
        if (!this.states().has(id)) {
            this.states.update(map => {
                map.set(id, this.getDefaultState(id));
                return new Map(map);
            });
        }

        if (!this.openTabIds().includes(id)) {
            this.openTabIds.update(ids => [...ids, id]);
        }

        this.activeTabId.set(id);
    }

    getAllOpenTabs(): RequestState[] {
        return this.openTabIds()
            .map(id => this.states().get(id))
            .filter((state): state is RequestState => Boolean(state));
    }

    getAllStates(): RequestState[] {
        return Array.from(this.states().values());
    }

    closeAllTabs() {
        this.openTabIds.set([]);
        this.activeTabId.set(null);
    }

    clearWorkspace(userParam?: UserAuth | null) {
        this.snapshotCurrentSession(userParam);
        const vs = this.getVariableService();
        if (vs && this.authService.isLoggedIn()) {
            vs.syncVariablesToBackend();
        }

        this.openTabIds.set([]);
        this.activeTabId.set(null);
        this.states.set(new Map());
        this.savedCapsules.set([]);
        this.requestExamplesMap.set(new Map());
        this.historyStack.clear();
        this.activeCapsuleId.set('1');
        this.activeCapsuleName.set('My Capsule');
        this.capsules.set([
            { id: '1', name: 'My Capsule', createdAt: Date.now() }
        ]);
        this.autoAuthEnabled.set('off');
        this.autoAuthEndpointId.set(null);

        if (this.isBrowser) {
            try {
                const keysToRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (
                        key.startsWith('onsteroids_') ||
                        key.startsWith('autoAuth') ||
                        key === 'request_history'
                    )) {
                        if (
                            key.startsWith('onsteroids_user_session_') ||
                            key.startsWith('onsteroids_user_vars_') ||
                            key === 'onsteroids_last_session' ||
                            key === 'onsteroids_last_vars' ||
                            key === 'onsteroids_responses'
                        ) {
                            continue;
                        }
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
            } catch (e) {
                console.error('Error clearing workspace storage on logout', e);
            }
        }
    }

    setActiveCapsuleName(name: string) {
        this.activeCapsuleName.set(name);
    }

    createAndOpenNewTab(): string {
        const newId = this.createId();
        const newState = this.getDefaultState(newId);
        newState.capsuleId = this.activeCapsuleId();
        this.states.update(map => {
            const next = new Map(map);
            next.set(newId, newState);
            return next;
        });
        this.openTabIds.update(ids => [...ids, newId]);
        this.activeTabId.set(newId);
        return newId;
    }

    async switchCapsule(capsule: { id: string; name: string }): Promise<void> {
        // Save current capsule's tab layout before switching
        const prevCapId = this.activeCapsuleId();
        if (this.isBrowser && prevCapId) {
            localStorage.setItem(`onsteroids_open_tab_ids_${prevCapId}`, JSON.stringify(this.openTabIds()));
            localStorage.setItem(`onsteroids_active_tab_${prevCapId}`, this.activeTabId() || '');
        }

        this.activeCapsuleId.set(capsule.id);
        this.activeCapsuleName.set(capsule.name);
        if (this.isBrowser) {
            localStorage.setItem('onsteroids_active_capsule', capsule.id);
        }

        await this.loadRequestsForCapsule(capsule.id);

        const requestsInCapsule = this.savedCapsules();
        // Merge saved requests into states, preserving any active response data already in memory
        if (requestsInCapsule.length > 0) {
            this.states.update(map => {
                const next = new Map(map);
                for (const req of requestsInCapsule) {
                    const existing = next.get(req.id);
                    if (existing) {
                        next.set(req.id, {
                            ...req,
                            responseBody: existing.responseBody ?? req.responseBody,
                            responseStatus: existing.responseStatus ?? req.responseStatus,
                            responseTime: existing.responseTime ?? req.responseTime,
                            responseSize: existing.responseSize ?? req.responseSize,
                            responseCookies: existing.responseCookies ?? req.responseCookies,
                            responseHeaders: existing.responseHeaders ?? req.responseHeaders,
                            testResults: existing.testResults ?? req.testResults
                        });
                    } else {
                        next.set(req.id, req);
                    }
                }
                return next;
            });
        }

        // Restore open tabs for this target capsule
        let targetOpenIds: string[] = [];
        const savedCapOpen = this.isBrowser ? localStorage.getItem(`onsteroids_open_tab_ids_${capsule.id}`) : null;
        if (savedCapOpen) {
            try {
                const parsed = JSON.parse(savedCapOpen);
                if (Array.isArray(parsed)) {
                    targetOpenIds = parsed.filter(id => this.states().has(id));
                }
            } catch (e) { }
        }

        if (targetOpenIds.length === 0) {
            if (requestsInCapsule.length > 0) {
                targetOpenIds = requestsInCapsule.map(r => r.id);
            } else {
                const newId = this.createId();
                const blankState = this.getDefaultState(newId);
                blankState.capsuleId = capsule.id;
                this.states.update(map => new Map(map).set(newId, blankState));
                targetOpenIds = [newId];
            }
        }

        this.openTabIds.set(targetOpenIds);

        const savedActive = this.isBrowser ? localStorage.getItem(`onsteroids_active_tab_${capsule.id}`) : null;
        if (savedActive && targetOpenIds.includes(savedActive)) {
            this.activeTabId.set(savedActive);
        } else {
            this.activeTabId.set(targetOpenIds[0] || null);
        }

        this.preloadAllExamples();
    }

    async createCapsule(name: string): Promise<Capsule> {
        const trimmed = name.trim() || 'New Capsule';
        let newCap: Capsule = {
            id: this.createId(),
            name: trimmed,
            createdAt: Date.now()
        };

        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                const res = await firstValueFrom(
                    this.http.post<{ data: any }>(`${API_BASE_URL}/capsule`, { name: trimmed })
                );
                if (res?.data) {
                    newCap = {
                        id: res.data.id,
                        name: res.data.name,
                        createdAt: new Date(res.data.createdAt).getTime() || Date.now()
                    };
                }
            } catch (err) {
                console.error('Failed to create capsule on backend', err);
            }
        }

        this.capsules.update(list => [...list, newCap]);
        await this.switchCapsule(newCap);
        return newCap;
    }

    async deleteCapsule(id: string): Promise<void> {
        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/capsule/${id}`)
                );
            } catch (err) {
                console.error('Failed to delete capsule on backend', err);
            }
        }

        this.capsules.update(list => list.filter(c => c.id !== id));

        if (this.isBrowser) {
            localStorage.removeItem(`onsteroids_open_tab_ids_${id}`);
            localStorage.removeItem(`onsteroids_active_tab_${id}`);
            localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
        }

        if (this.activeCapsuleId() === id) {
            const remaining = this.capsules();
            if (remaining.length > 0) {
                await this.switchCapsule(remaining[0]);
            } else {
                this.activeCapsuleId.set('');
                this.activeCapsuleName.set('');
                this.savedCapsules.set([]);
                this.states.set(new Map());
                this.openTabIds.set([]);
                this.activeTabId.set(null);
                if (this.isBrowser) {
                    localStorage.removeItem('onsteroids_active_capsule');
                    localStorage.removeItem('onsteroids_active_tab');
                    localStorage.removeItem('onsteroids_open_tab_ids');
                }
            }
        }
    }

    async batchDeleteCapsules(ids: string[]): Promise<void> {
        if (!ids || ids.length === 0) return;

        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.post(`${API_BASE_URL}/capsule/batch-delete`, { ids })
                );
            } catch (err) {
                console.error('Failed to batch delete capsules on backend', err);
            }
        }

        const idSet = new Set(ids);
        this.capsules.update(list => list.filter(c => !idSet.has(c.id)));

        if (this.isBrowser) {
            for (const id of ids) {
                localStorage.removeItem(`onsteroids_open_tab_ids_${id}`);
                localStorage.removeItem(`onsteroids_active_tab_${id}`);
            }
            localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
        }

        if (this.activeCapsuleId() && idSet.has(this.activeCapsuleId())) {
            const remaining = this.capsules();
            if (remaining.length > 0) {
                await this.switchCapsule(remaining[0]);
            } else {
                this.activeCapsuleId.set('');
                this.activeCapsuleName.set('');
                this.savedCapsules.set([]);
                this.states.set(new Map());
                this.openTabIds.set([]);
                this.activeTabId.set(null);
            }
        }
    }

    async deleteRequest(id: string): Promise<void> {
        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/request/${id}`)
                );
            } catch (err) {
                console.error(`Failed to delete request ${id} on backend`, err);
            }
        }

        this.savedCapsules.update(col => col.filter(r => r.id !== id));
        this.openTabIds.update(ids => ids.filter(tabId => tabId !== id));
        this.states.update(map => {
            const next = new Map(map);
            next.delete(id);
            return next;
        });
        this.historyStack.delete(id);

        if (this.activeTabId() === id) {
            const remaining = this.openTabIds();
            this.activeTabId.set(remaining.length > 0 ? remaining[0] : null);
        }
    }

    async batchDeleteRequests(ids: string[]): Promise<void> {
        if (!ids || ids.length === 0) return;

        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.post(`${API_BASE_URL}/request/batch-delete`, { ids })
                );
            } catch (err) {
                console.error('Failed to batch delete requests on backend', err);
            }
        }

        const idSet = new Set(ids);
        this.savedCapsules.update(col => col.filter(r => !idSet.has(r.id)));
        this.openTabIds.update(openIds => openIds.filter(id => !idSet.has(id)));
        this.states.update(map => {
            const next = new Map(map);
            for (const id of ids) {
                next.delete(id);
                this.historyStack.delete(id);
            }
            return next;
        });

        if (this.activeTabId() && idSet.has(this.activeTabId()!)) {
            const remaining = this.openTabIds();
            this.activeTabId.set(remaining.length > 0 ? remaining[0] : null);
        }
    }

    closeOtherTabs(keepId: string) {
        this.openTabIds.set([keepId]);
        this.activeTabId.set(keepId);
    }

    resolveRequestTitle(name?: string, url?: string): string {
        if (name && name.trim() !== '' && name.trim() !== 'New Request') {
            return name.trim();
        }
        if (url && url.trim() !== '') {
            try {
                const parsed = new URL(url.startsWith('http') ? url : `http://${url}`);
                const path = parsed.pathname;
                if (path && path !== '/' && path.trim() !== '') {
                    return path;
                }
                return parsed.hostname;
            } catch {
                return url.split('?')[0];
            }
        }
        return name || 'New Request';
    }

    cacheResponse(id: string, url: string, responseData: {
        responseBody: any;
        responseStatus: number | null;
        responseTime: number | null;
        responseSize: number | null;
        responseCookies?: CookieRow[];
        responseHeaders?: KeyValue[];
        testResults?: TestResult[];
    }) {
        if (!this.isBrowser) return;
        try {
            const stored = localStorage.getItem('onsteroids_responses');
            const map = stored ? JSON.parse(stored) : {};
            map[id] = responseData;
            if (url) {
                map[`url_${url}`] = responseData;
            }
            localStorage.setItem('onsteroids_responses', JSON.stringify(map));
        } catch (e) {
            console.warn('Could not cache response to storage', e);
        }
    }

    getCachedResponse(id: string, url?: string): any {
        if (!this.isBrowser) return null;
        try {
            const stored = localStorage.getItem('onsteroids_responses');
            if (!stored) return null;
            const map = JSON.parse(stored);
            if (map[id]) return map[id];
            if (url && map[`url_${url}`]) return map[`url_${url}`];
        } catch (e) { }
        return null;
    }

    async shareCapsule(capsuleId: string): Promise<string> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) {
            throw new Error('Please sign in to share this capsule.');
        }

        const res = await firstValueFrom(
            this.http.post<{ data: { shareToken: string; shareUrl: string } }>(
                `${API_BASE_URL}/capsule/${capsuleId}/share`,
                {}
            )
        );

        if (res?.data) {
            const origin = window.location.origin;
            return `${origin}/import?share=${res.data.shareToken}`;
        }
        throw new Error('Failed to generate share link');
    }

    async importCapsuleFromUrl(urlOrToken: string): Promise<{ capsuleName: string; requestsCount: number }> {
        let token = urlOrToken.trim();
        if (token.includes('share=')) {
            const url = new URL(token);
            token = url.searchParams.get('share') || token;
        } else if (token.includes('/share/')) {
            const parts = token.split('/share/');
            token = parts[parts.length - 1].split('?')[0].split('#')[0];
        }

        const res = await firstValueFrom(
            this.http.get<{ data: any }>(`${API_BASE_URL}/capsule/shared/${token}`)
        );

        if (!res?.data) {
            throw new Error('Shared capsule not found or link has expired.');
        }

        const shared = res.data;
        const newCap = await this.createCapsule(shared.capsuleName || 'Imported Capsule');
        
        const requestsToSave: RequestState[] = [];
        if (shared.requests && Array.isArray(shared.requests)) {
            for (const r of shared.requests) {
                const reqState = this.mapDtoToState({ ...r, capsuleId: newCap.id });
                requestsToSave.push(reqState);
            }
        }

        if (requestsToSave.length > 0) {
            this.states.update(map => {
                const next = new Map(map);
                for (const req of requestsToSave) {
                    next.set(req.id, req);
                }
                return next;
            });
            this.savedCapsules.set(requestsToSave);
            this.openTabIds.set(requestsToSave.map(r => r.id));
            this.activeTabId.set(requestsToSave[0].id);

            for (const r of requestsToSave) {
                await this.saveToCapsule(r.id);
            }
        }

        return { capsuleName: newCap.name, requestsCount: requestsToSave.length };
    }

    async createExample(requestId: string, name: string, exampleData: any): Promise<any> {
        const newEx = {
            id: 'ex_' + this.createId(),
            requestId,
            name,
            requestSnapshot: JSON.stringify(exampleData),
            createdAt: new Date().toISOString()
        };

        // Immediately reflect in tree
        this.requestExamplesMap.update(map => {
            const next = new Map(map);
            const current = next.get(requestId) || this.getLocalExamples(requestId);
            next.set(requestId, [...current, newEx]);
            return next;
        });

        const localExamples = this.getLocalExamples(requestId);
        this.saveLocalExamples(requestId, [...localExamples, newEx]);
        this.fetchedExamplesIds.delete(requestId);

        if (!this.authService.isLoggedIn()) {
            return newEx;
        }

        try {
            const res = await firstValueFrom(
                this.http.post<{ data: any }>(`${API_BASE_URL}/request/${requestId}/example`, {
                    name,
                    requestSnapshot: JSON.stringify(exampleData)
                })
            );

            if (res?.data) {
                // Silently update optimistic item with actual backend record
                this.requestExamplesMap.update(map => {
                    const next = new Map(map);
                    const list = (next.get(requestId) || []).map(ex => ex.id === newEx.id ? res.data : ex);
                    next.set(requestId, list);
                    return next;
                });
                const updatedLocal = this.getLocalExamples(requestId).map(ex => ex.id === newEx.id ? res.data : ex);
                this.saveLocalExamples(requestId, updatedLocal);
                return res.data;
            }
            return newEx;
        } catch (err) {
            // Rollback optimistic example on error
            this.requestExamplesMap.update(map => {
                const next = new Map(map);
                const list = (next.get(requestId) || []).filter(ex => ex.id !== newEx.id);
                next.set(requestId, list);
                return next;
            });
            const revertedLocal = this.getLocalExamples(requestId).filter(ex => ex.id !== newEx.id);
            this.saveLocalExamples(requestId, revertedLocal);
            throw err;
        }
    }

    async getExamples(requestId: string, forceRefresh = false): Promise<any[]> {
        // Seed from local storage cache immediately so UI shows instantly if cached
        const local = this.getLocalExamples(requestId);
        if (local.length > 0 && !this.requestExamplesMap().has(requestId)) {
            this.requestExamplesMap.update(map => new Map(map).set(requestId, local));
        }

        // Deduplication: Return ongoing promise or already-fetched cache unless forceRefresh
        if (!forceRefresh) {
            if (this.inFlightExampleRequests.has(requestId)) {
                return this.inFlightExampleRequests.get(requestId)!;
            }
            if (this.fetchedExamplesIds.has(requestId)) {
                return this.requestExamplesMap().get(requestId) || local;
            }
        }

        const task = (async () => {
            this.examplesLoadingMap.update(set => new Set(set).add(requestId));

            let examples: any[] = [];
            try {
                if (this.authService.isLoggedIn()) {
                    try {
                        const res = await firstValueFrom(
                            this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/${requestId}/example`)
                        );
                        if (res?.data && Array.isArray(res.data)) {
                            examples = res.data;
                            this.saveLocalExamples(requestId, examples);
                        }
                    } catch { }
                }
                if (examples.length === 0 && local.length > 0) {
                    examples = local;
                }

                this.requestExamplesMap.update(map => {
                    const next = new Map(map);
                    next.set(requestId, examples);
                    return next;
                });

                this.fetchedExamplesIds.add(requestId);
                return examples;
            } finally {
                this.inFlightExampleRequests.delete(requestId);
                this.examplesLoadingMap.update(set => {
                    const next = new Set(set);
                    next.delete(requestId);
                    return next;
                });
            }
        })();

        this.inFlightExampleRequests.set(requestId, task);
        return task;
    }

    preloadAllExamples(): void {
        if (!this.isBrowser) return;
        const requests = this.allCapsuleRequests();
        for (const req of requests) {
            const local = this.getLocalExamples(req.id);
            if (local.length > 0) {
                this.requestExamplesMap.update(map => {
                    const next = new Map(map);
                    if (!next.has(req.id)) next.set(req.id, local);
                    return next;
                });
            }
            if (this.authService.isLoggedIn() && !this.fetchedExamplesIds.has(req.id) && !this.inFlightExampleRequests.has(req.id)) {
                this.getExamples(req.id).catch(() => {});
            }
        }
    }

    async deleteExample(requestId: string, exampleId: string): Promise<void> {
        this.fetchedExamplesIds.delete(requestId);
        if (this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/request/example/${exampleId}`)
                );
            } catch { }
        }
        const local = this.getLocalExamples(requestId).filter(e => e.id !== exampleId);
        this.saveLocalExamples(requestId, local);

        this.requestExamplesMap.update(map => {
            const next = new Map(map);
            const current = next.get(requestId) || [];
            next.set(requestId, current.filter(e => e.id !== exampleId));
            return next;
        });
    }

    private getLocalExamples(requestId: string): any[] {
        if (!this.isBrowser) return [];
        try {
            const raw = localStorage.getItem(`onsteroids_examples_${requestId}`);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    private saveLocalExamples(requestId: string, examples: any[]) {
        if (!this.isBrowser) return;
        try {
            localStorage.setItem(`onsteroids_examples_${requestId}`, JSON.stringify(examples));
        } catch { }
    }

    async renameCapsule(id: string, name: string): Promise<void> {
        const trimmed = name.trim();
        if (!trimmed) return;

        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.put(`${API_BASE_URL}/capsule/${id}`, { name: trimmed })
                );
            } catch (err) {
                console.error('Failed to rename capsule on backend', err);
            }
        }

        this.capsules.update(list => list.map(c => c.id === id ? { ...c, name: trimmed } : c));
        if (this.activeCapsuleId() === id) {
            this.activeCapsuleName.set(trimmed);
        }
    }

    updateState(id: string, partialState: Partial<RequestState>, recordHistory = true) {
        this.states.update(map => {
            const currentState = map.get(id) || this.getDefaultState(id);

            const ignorableKeys = ['isLoading', 'responseBody', 'responseStatus', 'responseTime', 'responseSize', 'responseCookies', 'responseHeaders', 'testResults', 'editorScrollPositions', 'isDirty'];
            const isSignificantChange = Object.keys(partialState).some(k => !ignorableKeys.includes(k));

            if (recordHistory && isSignificantChange) {
                const pastChange: Partial<RequestState> = {};
                for (const key in partialState) {
                    if (!ignorableKeys.includes(key)) {
                        pastChange[key as keyof RequestState] = currentState[key as keyof RequestState] as any;
                    }
                }
                
                if (Object.keys(pastChange).length > 0) {
                    const stack = this.historyStack.get(id) || { past: [], future: [] };
                    stack.past.push(pastChange);
                    if (stack.past.length > 50) stack.past.shift();
                    stack.future = [];
                    this.historyStack.set(id, stack);
                }
            }

            map.set(id, { ...currentState, ...partialState });
            return new Map(map);
        });

        if (partialState.headers || partialState.params || partialState.rawBody || partialState.rawBodyJson) {
            const updated = this.states().get(id);
            if (updated) {
                this.getVariableService()?.syncVariablesFromInputs(id, updated);
            }
        }
    }

    undo() {
        const id = this.activeTabId();
        if (!id) return;
        const stack = this.historyStack.get(id);
        if (!stack || stack.past.length === 0) return;

        const pastChange = stack.past.pop()!;
        const currentState = this.states().get(id)!;
        
        const futureChange: Partial<RequestState> = {};
        for (const key in pastChange) {
            futureChange[key as keyof RequestState] = currentState[key as keyof RequestState] as any;
        }
        stack.future.push(futureChange);
        
        this.updateState(id, pastChange, false);
    }

    redo() {
        const id = this.activeTabId();
        if (!id) return;
        const stack = this.historyStack.get(id);
        if (!stack || stack.future.length === 0) return;

        const futureChange = stack.future.pop()!;
        const currentState = this.states().get(id)!;
        
        const pastChange: Partial<RequestState> = {};
        for (const key in futureChange) {
            pastChange[key as keyof RequestState] = currentState[key as keyof RequestState] as any;
        }
        stack.past.push(pastChange);
        
        this.updateState(id, futureChange, false);
    }

    addOpenTab(state: RequestState) {
        let hydrated = { ...state };
        if (hydrated.responseBody === null || hydrated.responseBody === undefined) {
            const cached = this.getCachedResponse(hydrated.id, hydrated.url);
            if (cached) {
                hydrated = {
                    ...hydrated,
                    responseBody: cached.responseBody ?? hydrated.responseBody,
                    responseStatus: cached.responseStatus ?? hydrated.responseStatus,
                    responseTime: cached.responseTime ?? hydrated.responseTime,
                    responseSize: cached.responseSize ?? hydrated.responseSize,
                    responseCookies: cached.responseCookies ?? hydrated.responseCookies,
                    responseHeaders: cached.responseHeaders ?? hydrated.responseHeaders,
                    testResults: cached.testResults ?? hydrated.testResults
                };
            }
        }

        this.states.update(map => {
            const next = new Map(map);
            if (!next.has(hydrated.id)) {
                next.set(hydrated.id, hydrated);
            } else {
                const existing = next.get(hydrated.id)!;
                if (existing.responseBody === null && hydrated.responseBody !== null) {
                    next.set(hydrated.id, { ...existing, ...hydrated });
                }
            }
            return next;
        });

        if (!this.openTabIds().includes(hydrated.id)) {
            this.openTabIds.update(ids => [...ids, hydrated.id]);
        }
    }

    closeTab(id: string) {
        this.openTabIds.update(ids => ids.filter(tabId => tabId !== id));
        // Only delete from states if it was an empty, untouched unsaved request
        const state = this.states().get(id);
        const isSaved = this.savedCapsules().some(r => r.id === id);
        if (!isSaved && (!state || (!state.url && state.name === 'New Request'))) {
            this.states.update(map => {
                const next = new Map(map);
                next.delete(id);
                return next;
            });
        }
        this.historyStack.delete(id);
    }

    async fetchCapsuleData(collectionName: string) {
        this.isCapsuleLoading.set(true);
        this.states.update(map => {
            const newMap = new Map(map);
            for (let [id, state] of newMap.entries()) {
                const dummyData = this.generateDummyData(id);
                newMap.set(id, { ...state, ...dummyData, isLoading: false });
            }
            return newMap;
        });

        this.isCapsuleLoading.set(false);
    }

    async fetchTabData(id: string) {
        this.updateState(id, { isLoading: true });
        const dummyData = this.generateDummyData(id);
        this.updateState(id, { ...dummyData, isLoading: false });
    }

    async saveToCapsule(id?: string): Promise<void> {
        this.isSaving.set(true);

        try {
            const currentCapId = this.activeCapsuleId();
            const currentCapName = this.activeCapsuleName();

            // 1. Ensure all variables are synced to backend API
            const vs = this.getVariableService();
            if (vs) {
                vs.saveVariables(false);
                await vs.syncVariablesToBackend();
            }

            // 2. Collect all requests belonging to this capsule
            const tabsToSave: RequestState[] = [];
            const seenIds = new Set<string>();

            if (id) {
                const activeTabState = this.states().get(id);
                if (activeTabState) {
                    tabsToSave.push(activeTabState);
                    seenIds.add(id);
                }
            }

            for (const s of this.states().values()) {
                if (!seenIds.has(s.id) && (s.capsuleId === currentCapId || !s.capsuleId)) {
                    tabsToSave.push(s);
                    seenIds.add(s.id);
                }
            }

            for (const s of this.savedCapsules()) {
                if (!seenIds.has(s.id) && (s.capsuleId === currentCapId || !s.capsuleId)) {
                    tabsToSave.push(s);
                    seenIds.add(s.id);
                }
            }

            // 3. If logged in, sync capsule and requests to backend
            let effectiveCapId = currentCapId;
            if (this.authService.isLoggedIn() && currentCapId) {
                try {
                    const existing = this.capsules().find(c => c.id === currentCapId);
                    if (!existing || currentCapId === '1' || currentCapId.length < 8) {
                        const res = await firstValueFrom(
                            this.http.post<{ data: any }>(`${API_BASE_URL}/capsule`, { name: currentCapName })
                        );
                        if (res?.data?.id) {
                            const oldId = currentCapId;
                            effectiveCapId = res.data.id;
                            this.activeCapsuleId.set(effectiveCapId);
                            this.capsules.update(list => list.map(c => c.id === oldId ? { ...c, id: effectiveCapId, name: currentCapName } : c));
                            for (const tabState of tabsToSave) {
                                tabState.capsuleId = effectiveCapId;
                            }
                        }
                    } else {
                        await firstValueFrom(
                            this.http.put(`${API_BASE_URL}/capsule/${currentCapId}`, { name: currentCapName })
                        ).catch(() => {});
                    }
                } catch (e) {
                    console.warn('Capsule sync note:', e);
                }
            }

            for (const tabState of tabsToSave) {
                let savedId = tabState.id;
                if (this.authService.isLoggedIn()) {
                    try {
                        const payload = {
                            id: tabState.id,
                            capsuleId: effectiveCapId,
                            capsuleName: currentCapName,
                            name: tabState.name,
                            url: tabState.url,
                            method: tabState.method,
                            payloadType: tabState.payloadType,
                            bodyType: tabState.bodyType,
                            rawType: tabState.rawType,
                            rawBody: tabState.rawBody,
                            rawBodyJson: tabState.rawBodyJson,
                            rawBodyXml: tabState.rawBodyXml,
                            auth: {
                                type: tabState.auth.type,
                                token: tabState.auth.token
                            },
                            scripts: {
                                preRequest: tabState.scripts.preRequest,
                                postResponse: tabState.scripts.postResponse,
                                testScript: tabState.scripts.testScript,
                                testScriptEnabled: tabState.scripts.testScriptEnabled
                            },
                            encryption: tabState.encryption,
                            settings: tabState.settings,
                            params: tabState.params.map(p => ({ enabled: p.enabled, key: p.key, value: p.value })),
                            headers: tabState.headers.map(h => ({ enabled: h.enabled, key: h.key, value: h.value })),
                            formData: tabState.formData.map(f => ({ enabled: f.enabled, key: f.key, value: f.value, type: f.type }))
                        };

                        const response = await firstValueFrom(
                            this.http.post<{ data: any }>(`${API_BASE_URL}/request/save`, payload)
                        );

                        if (response?.data) {
                            const savedData = response.data;
                            const oldId = tabState.id;
                            savedId = savedData.id || oldId;
                            if (savedId !== oldId) {
                                this.getVariableService()?.updateTabIdInSources(oldId, savedId);
                            }

                            const mappedSaved = this.mapDtoToState(savedData);
                            const updatedState: RequestState = {
                                ...mappedSaved,
                                id: savedId,
                                capsuleId: effectiveCapId,
                                isDirty: false,
                                autoAuthEnabled: tabState.autoAuthEnabled,
                                postTriggerTabId: tabState.postTriggerTabId,
                                responseBody: tabState.responseBody ?? mappedSaved.responseBody,
                                responseStatus: tabState.responseStatus ?? mappedSaved.responseStatus,
                                responseTime: tabState.responseTime ?? mappedSaved.responseTime,
                                responseSize: tabState.responseSize ?? mappedSaved.responseSize,
                                responseCookies: tabState.responseCookies ?? mappedSaved.responseCookies,
                                responseHeaders: tabState.responseHeaders ?? mappedSaved.responseHeaders,
                                testResults: tabState.testResults ?? mappedSaved.testResults
                            };

                            this.states.update(map => {
                                const next = new Map(map);
                                if (savedId !== oldId) next.delete(oldId);
                                next.set(savedId, updatedState);
                                return next;
                            });

                            if (savedId !== oldId) {
                                this.openTabIds.update(ids => ids.map(tid => tid === oldId ? savedId : tid));
                                if (this.activeTabId() === oldId) {
                                    this.activeTabId.set(savedId);
                                }
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to persist request ${tabState.id} to backend`, err);
                    }
                }

                const finalState = this.states().get(savedId) || tabState;
                this.savedCapsules.update(col => {
                    const idx = col.findIndex(r => r.id === savedId);
                    if (idx >= 0) {
                        const updated = [...col];
                        updated[idx] = { ...finalState, isDirty: false, capsuleId: effectiveCapId };
                        return updated;
                    } else {
                        return [...col, { ...finalState, isDirty: false, capsuleId: effectiveCapId }];
                    }
                });
                this.updateState(savedId, { isDirty: false, capsuleId: effectiveCapId });
            }

            // 4. Update backend session in Variable table with newly saved IDs and state
            if (vs && this.authService.isLoggedIn()) {
                await vs.syncVariablesToBackend();
            }

            if (this.isBrowser && effectiveCapId) {
                localStorage.setItem(`onsteroids_open_tab_ids_${effectiveCapId}`, JSON.stringify(this.openTabIds()));
                localStorage.setItem(`onsteroids_active_tab_${effectiveCapId}`, this.activeTabId() || '');
                localStorage.setItem('onsteroids_active_capsule', effectiveCapId);
                localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
                try {
                    const currentStates = Array.from(this.states().entries());
                    localStorage.setItem('onsteroids_states', JSON.stringify(currentStates));
                } catch {}
                this.snapshotCurrentSession();
            }
        } finally {
            this.isSaving.set(false);
        }
    }

    async loadBackendData(): Promise<void> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) return;
        if (this.isLoadingBackendData) return;
        this.isLoadingBackendData = true;

        try {
            this.hasInitialBackendLoaded = true;
            // 1. Fetch capsules from backend
            const capRes = await firstValueFrom(
                this.http.get<{ data: any[] }>(`${API_BASE_URL}/capsule`)
            );
            if (capRes?.data && capRes.data.length > 0) {
                const caps: Capsule[] = capRes.data.map(c => ({
                    id: c.id,
                    name: c.name,
                    createdAt: new Date(c.createdAt).getTime() || Date.now()
                }));
                this.capsules.set(caps);

                // 2. Fetch requests across ALL user capsules so the workspace tree has full data
                const allLoadedRequests: RequestState[] = [];
                for (const cap of caps) {
                    try {
                        const reqRes = await firstValueFrom(
                            this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/capsule/${cap.id}`)
                        );
                        if (reqRes?.data && Array.isArray(reqRes.data)) {
                            const mapped = reqRes.data.map(dto => this.mapDtoToState(dto));
                            allLoadedRequests.push(...mapped);
                        }
                    } catch (err) {
                        console.warn(`Could not load requests for capsule ${cap.id}`, err);
                    }
                }

                this.savedCapsules.set(allLoadedRequests);

                if (allLoadedRequests.length > 0) {
                    this.states.update(map => {
                        const next = new Map(map);
                        for (const req of allLoadedRequests) {
                            const existing = next.get(req.id);
                            if (existing) {
                                next.set(req.id, {
                                    ...req,
                                    responseBody: existing.responseBody ?? req.responseBody,
                                    responseStatus: existing.responseStatus ?? req.responseStatus,
                                    responseTime: existing.responseTime ?? req.responseTime,
                                    responseSize: existing.responseSize ?? req.responseSize,
                                    responseCookies: existing.responseCookies ?? req.responseCookies,
                                    responseHeaders: existing.responseHeaders ?? req.responseHeaders,
                                    testResults: existing.testResults ?? req.testResults
                                });
                            } else {
                                next.set(req.id, req);
                            }
                        }
                        return next;
                    });
                }
            }

            // 3. Load variables and workspace session from backend API
            const vs = this.getVariableService();
            if (vs) {
                await vs.loadVariablesFromBackend();
            }

            // 4. Ensure active capsule is valid
            const currentCapId = this.activeCapsuleId();
            const matchingCap = this.capsules().find(c => c.id === currentCapId) || this.capsules()[0];
            if (matchingCap) {
                this.activeCapsuleId.set(matchingCap.id);
                this.activeCapsuleName.set(matchingCap.name);
            }

            // 5. Restore open tabs
            let targetOpenIds = this.openTabIds().filter(id => this.states().has(id));
            if (targetOpenIds.length === 0) {
                const capRequests = this.savedCapsules().filter(r => r.capsuleId === this.activeCapsuleId());
                if (capRequests.length > 0) {
                    targetOpenIds = capRequests.map(r => r.id);
                } else if (this.savedCapsules().length > 0) {
                    targetOpenIds = [this.savedCapsules()[0].id];
                } else {
                    const newId = this.createId();
                    const blankState = this.getDefaultState(newId);
                    blankState.capsuleId = this.activeCapsuleId();
                    this.states.update(map => new Map(map).set(newId, blankState));
                    targetOpenIds = [newId];
                }
            }

            this.openTabIds.set(targetOpenIds);

            const currentActive = this.activeTabId();
            if (currentActive && targetOpenIds.includes(currentActive)) {
                // Retain current active tab
            } else {
                this.activeTabId.set(targetOpenIds[0] || null);
            }

            this.preloadAllExamples();
        } catch (e) {
            console.error('Failed to load backend data', e);
        } finally {
            this.isLoadingBackendData = false;
        }
    }

    async loadRequestsForCapsule(capsuleId: string): Promise<void> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) return;

        try {
            const reqRes = await firstValueFrom(
                this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/capsule/${capsuleId}`)
            );
            if (reqRes?.data) {
                const mapped = reqRes.data.map(dto => this.mapDtoToState(dto));
                this.savedCapsules.set(mapped);
            }
        } catch (e) {
            console.error('Failed to load requests for capsule', e);
        }
    }

    private mapDtoToState(dto: any): RequestState {
        const base = this.getDefaultState(dto.id || this.createId());
        let encHeaders: string[] = [];
        let encBodyPaths: string[] = [];
        try {
            if (dto.encryptedHeaders) encHeaders = JSON.parse(dto.encryptedHeaders);
            if (dto.encryptedBodyPaths) encBodyPaths = JSON.parse(dto.encryptedBodyPaths);
        } catch (e) { }

        const cached = this.getCachedResponse(dto.id, dto.url);

        return {
            ...base,
            id: dto.id,
            capsuleId: dto.capsuleId || this.activeCapsuleId(),
            name: dto.name || 'New Request',
            url: dto.url || '',
            method: dto.method || 'GET',
            payloadType: dto.payloadType || 'params',
            bodyType: dto.bodyType || 'none',
            rawType: dto.rawType || 'JSON',
            rawBody: dto.rawBody || '',
            rawBodyJson: dto.rawBodyJson || '',
            rawBodyXml: dto.rawBodyXml || '',
            auth: {
                type: (dto.authType as any) || 'none',
                token: dto.authToken || ''
            },
            scripts: {
                ...base.scripts,
                preRequest: dto.preRequestScript || '',
                postResponse: dto.postResponseScript || ''
            },
            encryption: {
                ...base.encryption,
                algorithm: (dto.encryptionAlgorithm as any) || 'none',
                key: dto.encryptionKey || '',
                autoEncryptBody: dto.autoEncryptBody ?? false,
                autoEncryptHeaders: dto.autoEncryptHeaders ?? false,
                channelName: dto.encryptionChannel || '',
                encryptedHeaders: encHeaders,
                encryptedBodyPaths: encBodyPaths,
                script: dto.encryptionScript || base.encryption.script
            },
            settings: {
                followRedirects: dto.followRedirects ?? true,
                verifySsl: dto.verifySsl ?? true,
                enableCookies: dto.enableCookies ?? true,
                bypassCors: dto.bypassCors ?? true
            },
            params: (dto.params || []).map((p: any) => ({
                enabled: p.isEnabled ?? p.enabled ?? true,
                key: p.paramKey ?? p.key ?? '',
                value: p.paramValue ?? p.value ?? ''
            })),
            headers: (dto.headers || []).map((h: any) => ({
                enabled: h.isEnabled ?? h.enabled ?? true,
                key: h.headerKey ?? h.key ?? '',
                value: h.headerValue ?? h.value ?? ''
            })),
            formData: (dto.formData || []).map((f: any) => ({
                enabled: f.isEnabled ?? f.enabled ?? true,
                key: f.fieldKey ?? f.key ?? '',
                value: f.fieldValue ?? f.value ?? '',
                type: (f.fieldType as any) || (f.type as any) || 'text'
            })),
            responseBody: cached?.responseBody ?? base.responseBody,
            responseStatus: cached?.responseStatus ?? base.responseStatus,
            responseTime: cached?.responseTime ?? base.responseTime,
            responseSize: cached?.responseSize ?? base.responseSize,
            responseCookies: cached?.responseCookies ?? base.responseCookies,
            responseHeaders: cached?.responseHeaders ?? base.responseHeaders,
            testResults: cached?.testResults ?? base.testResults,
            isDirty: false,
            isLoading: false
        };
    }

    duplicateTab(id: string): string | null {
        const source = this.states().get(id);
        if (!source) return null;

        const newId = this.createId();
        const duplicate: RequestState = {
            ...structuredClone(source),
            id: newId,
            name: `${source.name} Copy`,
            isDirty: true,
            isLoading: false,
        };

        this.states.update(map => {
            const next = new Map(map);
            next.set(newId, duplicate);
            return next;
        });

        this.openTabIds.update(ids => {
            const sourceIndex = ids.indexOf(id);
            if (sourceIndex === -1) {
                return [...ids, newId];
            }

            const next = [...ids];
            next.splice(sourceIndex + 1, 0, newId);
            return next;
        });

        this.activeTabId.set(newId);
        return newId;
    }

    reorderOpenTabs(previousIndex: number, currentIndex: number) {
        this.openTabIds.update(ids => {
            if (
                previousIndex === currentIndex ||
                previousIndex < 0 ||
                currentIndex < 0 ||
                previousIndex >= ids.length ||
                currentIndex >= ids.length
            ) {
                return ids;
            }

            const next = [...ids];
            const [movedId] = next.splice(previousIndex, 1);
            next.splice(currentIndex, 0, movedId);
            return next;
        });
    }

    getDefaultState(id: string): RequestState {
        return {
            id,
            capsuleId: this.activeCapsuleId(),
            url: '',
            method: 'GET',
            name: 'New Request',
            isDirty: false,
            isLoading: false,
            autoAuthEnabled: false,
            postTriggerTabId: null,
            payloadType: 'params',
            params: [{ enabled: true, key: '', value: '' }],
            headers: [
                { enabled: true, key: 'Accept', value: 'application/json' },
                { enabled: true, key: '', value: '' }
            ],
            auth: { type: 'none', token: '' },
            scripts: {
                preRequest: 'function preScript(headers, body, params){\n    //only code written within this code block will be executed\n}',
                postResponse: 'function postScript(responseHeader, responseBody){\n    //only code written within this code block will be executed\n}',
                preRequestConsole: '',
                postResponseConsole: '',
                encryptionConsole: '',
                testScript: 'function testScript(responseStatus, responseTime, responseBody){\n    let passed = true;\n    //Add test assertions here\n    return passed;\n}',
                testScriptEnabled: false
            },
            encryption: {
                algorithm: 'none',
                key: '',
                autoEncryptBody: false,
                autoEncryptHeaders: false,
                channelName: '',
                encryptedHeaders: [],
                encryptedBodyPaths: [],
                script: 'async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths) {\n    function getNestedValue(obj, path) {\n        return path.split(".").reduce((acc, part) => acc && acc[part], obj);\n    }\n    function setNestedValue(obj, path, value) {\n        const parts = path.split(".");\n        const last = parts.pop();\n        const target = parts.reduce((acc, part) => {\n            if (!acc[part]) acc[part] = {};\n            return acc[part];\n        }, obj);\n        if (target) target[last] = value;\n    }\n    function getPrimitivePaths(obj, currentPath = "") {\n        let paths = [];\n        for (let key in obj) {\n            if (obj.hasOwnProperty(key)) {\n                const path = currentPath ? `${currentPath}.${key}` : key;\n                if (obj[key] !== null && typeof obj[key] === "object") {\n                    paths = paths.concat(getPrimitivePaths(obj[key], path));\n                } else {\n                    paths.push(path);\n                }\n            }\n        }\n        return paths;\n    }\n    const parameters = {};\n    const shouldEncryptAllHeaders = typeof autoEncryptHeaders !== "undefined" ? autoEncryptHeaders : false;\n    const encHeadersList = encryptedHeaders || [];\n    for (let h of headers) {\n        if (h.enabled && h.key) {\n            if (shouldEncryptAllHeaders || encHeadersList.includes(h.key)) {\n                parameters[h.key] = h.value;\n            }\n        }\n    }\n    let bodyObj = null;\n    if (body) {\n        try {\n            bodyObj = JSON.parse(body);\n        } catch (e) {}\n    }\n    if (bodyObj) {\n        const shouldEncryptAllBody = typeof autoEncryptBody !== "undefined" ? autoEncryptBody : false;\n        const encBodyPathsList = encryptedBodyPaths || [];\n        if (shouldEncryptAllBody) {\n            const allPaths = getPrimitivePaths(bodyObj);\n            for (let path of allPaths) {\n                const val = getNestedValue(bodyObj, path);\n                if (val !== undefined && val !== null) {\n                    parameters[path] = val;\n                }\n            }\n        } else {\n            for (let path of encBodyPathsList) {\n                const val = getNestedValue(bodyObj, path);\n                if (val !== undefined && val !== null) {\n                    parameters[path] = val;\n                }\n            }\n        }\n    }\n    if (Object.keys(parameters).length > 0) {\n        console.log("Sending the following parameters for encryption:", JSON.stringify(parameters, null, 2));\n        try {\n            const chName = typeof channelName !== "undefined" ? channelName : "Default Channel";\n            const response = await fetch("https://localhost:7131/api/v1/auth/encrypt", {\n                method: "POST",\n                headers: {\n                    "Content-Type": "application/json"\n                },\n                body: JSON.stringify({\n                    channelName: chName,\n                    parameters: parameters\n                })\n            });\n            if (response.ok) {\n                const result = await response.json();\n                console.log("Encryption successful. Encrypted values received:", JSON.stringify(result, null, 2));\n                const encryptedParams = result.parameters || result;\n                for (let h of headers) {\n                    if (h.key && encryptedParams[h.key] !== undefined) {\n                        h.value = String(encryptedParams[h.key]);\n                    }\n                }\n                if (bodyObj) {\n                    for (let key in encryptedParams) {\n                        if (encryptedParams.hasOwnProperty(key)) {\n                            if (key.includes(".") || getNestedValue(bodyObj, key) !== undefined) {\n                                setNestedValue(bodyObj, key, encryptedParams[key]);\n                            }\n                        }\n                    }\n                    body = JSON.stringify(bodyObj, null, 2);\n                }\n            } else {\n                console.log("Encryption failed. Status:", response.status);\n            }\n        } catch (error) {\n            console.error("Error during payload encryption:", error);\n        }\n    } else {\n        console.log("No parameters were selected for encryption.");\n    }\n    return body;\n}'
            },
            settings: { followRedirects: true, verifySsl: false, enableCookies: true, bypassCors: true },
            bodyType: 'none',
            rawType: 'JSON',
            rawBody: '{}',
            rawBodyJson: '{}',
            rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>',
            formData: [{ enabled: true, key: '', value: '', type: 'text' }],
            requestBody: {},
            responseBody: null,
            responseStatus: null,
            responseTime: null,
            responseSize: null,
            responseCookies: [],
            responseHeaders: [],
            testResults: [],
            editorScrollPositions: {},
        };
    }

    private generateDummyData(id: string): Partial<RequestState> {
        const methods = ['GET', 'POST', 'PUT', 'DELETE'];
        const method = methods[Math.floor(Math.random() * methods.length)];
        const entries = [
            {
                url: 'https://api.acegeld.runasp.net/login',
                name: 'Login',
                params: [
                    { enabled: true, key: 'redirect', value: 'dashboard' },
                    { enabled: false, key: 'lang', value: 'en' },
                    { enabled: true, key: '', value: '' },
                ],
                responseBody: { success: true, token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature', expiresAt: '2026-12-31', user: { id: 1, email: 'john@example.com' } },
                responseStatus: 200,
                responseTime: 143,
                responseSize: 512,
                responseCookies: [
                    { name: 'session_id', value: 'abc123xyz', domain: 'acegeld.runasp.net', path: '/', expires: '2026-12-31T00:00:00Z' },
                ],
                responseHeaders: [
                    { enabled: true, key: 'Content-Type', value: 'application/json' },
                    { enabled: true, key: 'X-Request-Id', value: 'req-abc-123' },
                    { enabled: true, key: 'Cache-Control', value: 'no-store' },
                ],
                testResults: [
                    { name: 'Status code is 200', passed: true },
                    { name: 'Response has token', passed: true },
                    { name: 'Token is not empty', passed: true },
                ],
                auth: { type: 'none' as const, token: '', username: '', password: '' },
                formData: [],
                rawBody: JSON.stringify({ email: 'john@example.com', password: 'secret' }, null, 2),
            },
            {
                url: 'https://api.example.com/v1/users',
                name: 'Get Users',
                params: [
                    { enabled: true, key: 'page', value: '1' },
                    { enabled: true, key: 'limit', value: '20' },
                    { enabled: true, key: '', value: '' },
                ],
                responseBody: { data: [{ id: 1, name: 'Alice', role: 'admin' }, { id: 2, name: 'Bob', role: 'user' }], total: 2, page: 1 },
                responseStatus: 200,
                responseTime: 88,
                responseSize: 304,
                responseCookies: [],
                responseHeaders: [
                    { enabled: true, key: 'Content-Type', value: 'application/json' },
                    { enabled: true, key: 'X-Total-Count', value: '200' },
                    { enabled: true, key: 'X-Page', value: '1' },
                    { enabled: true, key: 'Vary', value: 'Accept-Encoding' },
                ],
                testResults: [
                    { name: 'Status code is 200', passed: true },
                    { name: 'Response has data array', passed: true },
                    { name: 'Pagination fields present', passed: false },
                ],
                auth: { type: 'bearer' as const, token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig', username: '', password: '' },
                formData: [],
                rawBody: '{}',
            },
            {
                url: 'https://api.shop.dev/products/123',
                name: 'Get Product',
                params: [
                    { enabled: true, key: 'include', value: 'images,variants' },
                    { enabled: true, key: '', value: '' },
                ],
                responseBody: { product: { id: 'p1', name: 'Wireless Headphones', price: 99.99, currency: 'USD', stock: 42 } },
                responseStatus: 200,
                responseTime: 264,
                responseSize: 820,
                responseCookies: [
                    { name: 'cart_id', value: 'cart-9k2j', domain: 'api.shop.dev', path: '/', expires: 'Session' },
                ],
                responseHeaders: [
                    { enabled: true, key: 'Content-Type', value: 'application/json' },
                    { enabled: true, key: 'ETag', value: '"abc123"' },
                    { enabled: true, key: 'Cache-Control', value: 'max-age=3600' },
                ],
                testResults: [
                    { name: 'Status code is 200', passed: true },
                    { name: 'Product has price field', passed: true },
                    { name: 'Price is positive', passed: true },
                    { name: 'Stock > 0', passed: false },
                ],
                auth: { type: 'none' as const, token: '', username: '', password: '' },
                formData: [
                    { enabled: true, key: 'thumbnail', value: '', type: 'file' as const },
                    { enabled: true, key: 'alt_text', value: 'Headphones front view', type: 'text' as const },
                    { enabled: true, key: '', value: '', type: 'text' as const },
                ],
                rawBody: '{}',
            },
            {
                url: 'https://jsonplaceholder.typicode.com/posts',
                name: 'Get Posts',
                params: [
                    { enabled: true, key: '_limit', value: '10' },
                    { enabled: false, key: 'userId', value: '1' },
                    { enabled: true, key: '', value: '' },
                ],
                responseBody: [
                    { id: 1, title: 'Hello World', body: 'Lorem ipsum dolor sit amet', userId: 1 },
                    { id: 2, title: 'Angular Signals', body: 'Signals revolutionize reactivity in Angular', userId: 1 },
                ],
                responseStatus: 404,
                responseTime: 512,
                responseSize: 2048,
                responseCookies: [],
                responseHeaders: [
                    { enabled: true, key: 'Content-Type', value: 'application/json; charset=utf-8' },
                    { enabled: true, key: 'X-Powered-By', value: 'Express' },
                ],
                testResults: [
                    { name: 'Status code is 200', passed: false },
                    { name: 'Response is array', passed: true },
                    { name: 'Array is not empty', passed: true },
                ],
                auth: { type: 'none' as const, token: '', username: '', password: '' },
                formData: [],
                rawBody: JSON.stringify({ title: 'New Post', body: 'Post content here', userId: 1 }, null, 2),
            },
        ];

        const entry = entries[parseInt(id, 10) % entries.length];

        const rawBody = entry.rawBody || '{}';
        return {
            url: entry.url,
            method,
            name: entry.name,
            params: entry.params,
            headers: [
                { enabled: true, key: 'Accept', value: 'application/json' },
                { enabled: true, key: 'Content-Type', value: 'application/json' },
                { enabled: method !== 'GET', key: 'Authorization', value: entry.auth.type === 'bearer' ? `Bearer ${entry.auth.token}` : '' },
                { enabled: true, key: '', value: '' },
            ],
            auth: entry.auth,
            formData: entry.formData ?? [{ enabled: true, key: '', value: '', type: 'text' }],
            rawBody: rawBody,
            rawBodyJson: rawBody,
            rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>',
            requestBody: method === 'POST' || method === 'PUT' ? JSON.parse(rawBody || '{}') : {},
            responseBody: entry.responseBody,
            responseStatus: entry.responseStatus,
            responseTime: entry.responseTime,
            responseSize: entry.responseSize,
            responseCookies: entry.responseCookies,
            responseHeaders: entry.responseHeaders,
            testResults: entry.testResults,
            editorScrollPositions: {},
            isDirty: Math.random() > 0.5,
            payloadType: 'params',
            bodyType: method === 'POST' || method === 'PUT' ? 'raw' : 'none',
            rawType: 'JSON',
            scripts: {
                preRequest: method === 'POST' ? `function preScript(headers, body, params){\n    const timestamp = Date.now();\n    headers.push({ enabled: true, key: 'X-Timestamp', value: String(timestamp) });\n}` : 'function preScript(headers, body, params){\n    //only code written within this code block will be executed\n}',
                postResponse: `function postScript(responseHeader, responseBody){\n    //only code written within this code block will be executed\n}`,
                preRequestConsole: method === 'POST' ? 'Setting variable timestamp to 1710587421932\nScript evaluated successfully.' : '',
                postResponseConsole: 'Executing test: Status is OK\nResult: PASS',
                encryptionConsole: '',
                testScript: 'function testScript(responseStatus, responseTime, responseBody){\n    let passed = true;\n    //Add test assertions here\n    return passed;\n}',
                testScriptEnabled: false
            },
            encryption: {
                algorithm: 'none',
                key: '',
                autoEncryptBody: false,
                autoEncryptHeaders: false,
                channelName: '',
                encryptedHeaders: [],
                encryptedBodyPaths: [],
                script: 'async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths) {\n    function getNestedValue(obj, path) {\n        return path.split(\'.\').reduce((acc, part) => acc && acc[part], obj);\n    }\n    function setNestedValue(obj, path, value) {\n        const parts = path.split(\'.\');\n        const last = parts.pop();\n        const target = parts.reduce((acc, part) => {\n            if (!acc[part]) acc[part] = {};\n            return acc[part];\n        }, obj);\n        if (target) target[last] = value;\n    }\n    function getPrimitivePaths(obj, currentPath = \'\') {\n        let paths = [];\n        for (let key in obj) {\n            if (obj.hasOwnProperty(key)) {\n                const path = currentPath ? `${currentPath}.${key}` : key;\n                if (obj[key] !== null && typeof obj[key] === \'object\') {\n                    paths = paths.concat(getPrimitivePaths(obj[key], path));\n                } else {\n                    paths.push(path);\n                }\n            }\n        }\n        return paths;\n    }\n    const parameters = {};\n    const shouldEncryptAllHeaders = typeof autoEncryptHeaders !== \'undefined\' ? autoEncryptHeaders : false;\n    const encHeadersList = encryptedHeaders || [];\n    for (let h of headers) {\n        if (h.enabled && h.key) {\n            if (shouldEncryptAllHeaders || encHeadersList.includes(h.key)) {\n                parameters[h.key] = h.value;\n            }\n        }\n    }\n    let bodyObj = null;\n    if (body) {\n        try {\n            bodyObj = JSON.parse(body);\n        } catch (e) {}\n    }\n    if (bodyObj) {\n        const shouldEncryptAllBody = typeof autoEncryptBody !== \'undefined\' ? autoEncryptBody : false;\n        const encBodyPathsList = encryptedBodyPaths || [];\n        if (shouldEncryptAllBody) {\n            const allPaths = getPrimitivePaths(bodyObj);\n            for (let path of allPaths) {\n                const val = getNestedValue(bodyObj, path);\n                if (val !== undefined && val !== null) {\n                    parameters[path] = val;\n                }\n            }\n        } else {\n            for (let path of encBodyPathsList) {\n                const val = getNestedValue(bodyObj, path);\n                if (val !== undefined && val !== null) {\n                    parameters[path] = val;\n                }\n            }\n        }\n    }\n    if (Object.keys(parameters).length > 0) {\n        try {\n            const chName = typeof channelName !== \'undefined\' ? channelName : \'Default Channel\';\n            const response = await fetch(\'https://localhost:7131/api/v1/auth/encrypt\', {\n                method: \'POST\',\n                headers: {\n                    \'Content-Type\': \'application/json\'\n                },\n                body: JSON.stringify({\n                    channelName: chName,\n                    parameters: parameters\n                })\n            });\n            if (response.ok) {\n                const result = await response.json();\n                const encryptedParams = result.parameters || result;\n                for (let h of headers) {\n                    if (h.key && encryptedParams[h.key] !== undefined) {\n                        h.value = String(encryptedParams[h.key]);\n                    }\n                }\n                if (bodyObj) {\n                    for (let key in encryptedParams) {\n                        if (encryptedParams.hasOwnProperty(key)) {\n                            if (key.includes(\'.\') || getNestedValue(bodyObj, key) !== undefined) {\n                                setNestedValue(bodyObj, key, encryptedParams[key]);\n                            }\n                        }\n                    }\n                    body = JSON.stringify(bodyObj, null, 2);\n                }\n            }\n        } catch (error) {\n            console.error(\'Error during payload encryption:\', error);\n        }\n    }\n    return body;\n}'
            },
            settings: { followRedirects: true, verifySsl: true, enableCookies: true, bypassCors: true },
        };
    }

    createId(): string {
        if (this.isBrowser && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}
