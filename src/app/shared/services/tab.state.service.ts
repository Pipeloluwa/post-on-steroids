import { Injectable, signal, computed, effect, untracked, inject, PLATFORM_ID, Injector } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { generateUUID } from '../utils/uuid.util';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, UserAuth } from './auth.service';
import { NotificationService } from './notification.service';
import { API_BASE_URL } from '../constants/api.constants';
import { VariableService } from './variable.service';
import { IGlobalVariable } from '../../interfaces/services/IVariableService';
import { extractRequestsVariables } from '../utils/import-variable.util';

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
    file?: File;
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
    autoAuthEnabled?: 'off' | 'individual' | 'global' | string;
    autoAuthEndpointId?: string | null;
}

@Injectable({
    providedIn: 'root',
})
export class TabStateService {
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);
    private http = inject(HttpClient);
    private authService = inject(AuthService);
    private notificationService = inject(NotificationService);
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

            // Sync to backend for cross-device persistence (debounced)
            this.syncWorkspaceStateToBackend();

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
            if (!u) keysToTry.push('onsteroids_last_session');

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

            // 7. Restore variables in VariableService (Deferred to break circular dependency)
            setTimeout(() => {
                const vs = this.getVariableService();
                if (vs) {
                    if (Array.isArray(session.variables) && session.variables.length > 0) {
                        vs.setVariables(session.variables);
                    } else {
                        vs.restoreUserVariables(u);
                    }
                }
            }, 0);

            return true;
        } catch (e) {
            console.error('Failed to restore user session', e);
            return false;
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
                if (s.responseStatus !== null || (s.responseBody !== null && s.responseBody !== undefined)) {
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
                capsules: this.capsules(),
                autoAuthEnabled: this.autoAuthEnabled(),
                autoAuthEndpointId: this.autoAuthEndpointId(),
                timestamp: Date.now()
            };
        } catch (e) {
            return null;
        }
    }

    private hasOfflineWork(): boolean {
        // If they opened multiple tabs
        if (this.openTabIds().length > 1) return true;
        
        // Check the single open tab
        const firstTabId = this.openTabIds()[0];
        if (!firstTabId) return false;
        
        const state = this.states().get(firstTabId);
        if (!state) return false;
        
        // If they typed a URL or changed the method or have a response
        if (state.url && state.url.trim().length > 0) return true;
        if (state.method !== 'GET') return true;
        if (state.responseStatus || state.responseBody) return true;
        
        return false;
    }

    applyBackendSession(session: any) {
        if (!session) return;
        
        const hasWork = this.hasOfflineWork();

        if (!hasWork) {
            if (session.activeCapsuleId) {
                this.activeCapsuleId.set(session.activeCapsuleId);
                if (this.isBrowser) {
                    localStorage.setItem('onsteroids_active_capsule', session.activeCapsuleId);
                }
            }
            if (session.activeCapsuleName) {
                this.activeCapsuleName.set(session.activeCapsuleName);
            }
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

        if (!hasWork) {
            if (Array.isArray(session.openTabIds) && session.openTabIds.length > 0) {
                this.openTabIds.set(session.openTabIds);
            }
            if (session.activeTabId) {
                this.activeTabId.set(session.activeTabId);
            }
        }

        if (session.autoAuthEnabled) {
            this.autoAuthEnabled.set(session.autoAuthEnabled);
        }
        if (session.autoAuthEndpointId) {
            this.autoAuthEndpointId.set(session.autoAuthEndpointId);
        }
        if (session.autoSaveEnabled !== undefined) {
            this.autoSaveEnabled.set(session.autoSaveEnabled);
            if (this.isBrowser) {
                localStorage.setItem('onsteroids_autosave', session.autoSaveEnabled ? 'true' : 'false');
            }
        }
    }

    /** Debounced sync of workspace state to backend for cross-device persistence */
    private syncWorkspaceStateToBackend() {
        if (!this.isBrowser || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;

        clearTimeout(this.workspaceStateSyncTimeout);
        this.workspaceStateSyncTimeout = setTimeout(async () => {
            try {
                const currentStates = Array.from(this.states().entries());
                let storedResponses: Record<string, unknown> = {};
                try {
                    const rawResp = localStorage.getItem('onsteroids_responses');
                    if (rawResp) storedResponses = JSON.parse(rawResp);
                } catch {}

                // Capture live responses from tab states
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

                const payload = {
                    activeCapsuleId: this.activeCapsuleId(),
                    activeCapsuleName: this.activeCapsuleName(),
                    activeTabId: this.activeTabId(),
                    openTabIds: JSON.stringify(this.openTabIds()),
                    tabStates: JSON.stringify(currentStates),
                    responses: JSON.stringify(storedResponses),
                    autoAuthEnabled: this.autoAuthEnabled(),
                    autoAuthEndpointId: this.autoAuthEndpointId(),
                    autoSaveEnabled: this.autoSaveEnabled()
                };

                await firstValueFrom(
                    this.http.put(`${API_BASE_URL}/WorkspaceState`, payload)
                );
            } catch (e) {
                console.warn('Failed to sync workspace state to backend', e);
            }
        }, 2000);
    }

    private activeTabSyncTimeout: any = null;

    /** Lightweight sync of active tab and open tabs to backend for resume/login persistence */
    syncActiveTabToBackend() {
        if (!this.isBrowser || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;

        clearTimeout(this.activeTabSyncTimeout);
        this.activeTabSyncTimeout = setTimeout(async () => {
            try {
                const activeId = this.activeTabId();
                if (!activeId) return;

                const payload = {
                    activeCapsuleId: this.activeCapsuleId(),
                    activeCapsuleName: this.activeCapsuleName(),
                    activeTabId: activeId,
                    openTabIds: JSON.stringify(this.openTabIds())
                };

                await firstValueFrom(
                    this.http.patch(`${API_BASE_URL}/WorkspaceState/active-tab`, payload)
                );
            } catch (e) {
                console.warn('Failed to sync active tab to backend', e);
            }
        }, 500);
    }

    /** Load workspace state from backend and apply it (called on login/loadBackendData) */
    private async loadWorkspaceStateFromBackend(): Promise<boolean> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) return false;
        try {
            const res = await firstValueFrom(
                this.http.get<{ data: any }>(`${API_BASE_URL}/WorkspaceState`)
            );
            if (res?.data) {
                const ws = res.data;
                const session: any = {
                    activeCapsuleId: ws.activeCapsuleId,
                    activeCapsuleName: ws.activeCapsuleName,
                    activeTabId: ws.activeTabId,
                    autoAuthEnabled: ws.autoAuthEnabled,
                    autoAuthEndpointId: ws.autoAuthEndpointId,
                    autoSaveEnabled: ws.autoSaveEnabled
                };

                // Parse JSON fields
                try { session.openTabIds = ws.openTabIds ? JSON.parse(ws.openTabIds) : []; } catch { session.openTabIds = []; }
                try { session.states = ws.tabStates ? JSON.parse(ws.tabStates) : []; } catch { session.states = []; }
                try { session.responses = ws.responses ? JSON.parse(ws.responses) : {}; } catch { session.responses = {}; }

                this.applyBackendSession(session);
                return true;
            }
        } catch (e) {
            console.warn('Failed to load workspace state from backend', e);
        }
        return false;
    }

    getState(id: string): RequestState | undefined {
        return this.states().get(id);
    }
    private backendSyncTimeout: any;
    private workspaceStateSyncTimeout: any;
    activeTabId = signal<string | null>(null);
    activeCapsuleName = signal<string>('My Capsule');
    activeCapsuleId = signal<string>('1');
    autoAuthEnabled = signal<'off' | 'individual' | 'global'>('off');
    autoAuthEndpointId = signal<string | null>(null);
    isCapsuleLoading = signal<boolean>(false);
    isSaving = signal<boolean>(false);
    isAutoSaving = signal<boolean>(false);
    isSaveCancelled = false;
    requestExamplesMap = signal<Map<string, any[]>>(new Map());
    examplesLoadingMap = signal<Set<string>>(new Set());

    isExamplesLoading(requestId: string): boolean {
        return this.examplesLoadingMap().has(requestId);
    }

    private historyStack = new Map<string, { past: Partial<RequestState>[], future: Partial<RequestState>[] }>();

    // Shared capsule list (drives both workspace sidebar and Capsules page)
    capsules = signal<Capsule[]>([
        { id: '1', name: 'My Capsule', createdAt: Date.now() }
    ]);

    // In-memory "database" of saved requests
    savedCapsules = signal<RequestState[]>([]);

    // All requests belonging to the active capsule (both saved in backend and local/open tabs)
    allCapsuleRequests = computed<RequestState[]>(() => {
        const capId = this.activeCapsuleId();
        const filterFn = (r: RequestState) => r.capsuleId === capId || (!r.capsuleId && (!capId || capId === '1'));
        const saved = this.savedCapsules().filter(filterFn);
        const inMemory = Array.from(this.states().values()).filter(filterFn);

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

    isLoadingBackendData = signal<boolean>(false);
    private hasInitialBackendLoaded = false;
    private statesSaveTimeout: any = null;
    private fetchedExamplesIds = new Set<string>();
    private inFlightExampleRequests = new Map<string, Promise<any[]>>();
    
    autoSaveEnabled = signal<boolean>(false);
    private autoSaveTimeout: any = null;
    private capsuleSwitchVersion = 0;

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
            this.loadBackendData();
        });

    }

    private loadFromStorage() {
        if (!this.isBrowser) return;

        const autoSavePref = localStorage.getItem('onsteroids_autosave');
        if (autoSavePref === 'true') {
            this.autoSaveEnabled.set(true);
        }

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

        this.syncActiveTabToBackend();
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
        clearTimeout(this.backendSyncTimeout);
        clearTimeout(this.workspaceStateSyncTimeout);

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
                        key.startsWith('auth_') ||
                        key === 'request_history'
                    )) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
            } catch (e) {
                console.error('Error clearing workspace storage on logout', e);
            }
        }

        // Open a single pristine default tab
        this.createAndOpenNewTab();
    }

    setActiveCapsuleName(name: string) {
        this.activeCapsuleName.set(name);
    }

    createAndOpenNewTab(insertIndex?: number): string {
        const newId = this.createId();
        const newState = this.getDefaultState(newId);
        
        let capId = this.activeCapsuleId();
        if (!capId) {
            capId = this.createId();
            const newCap = { id: capId, name: 'My Capsule', createdAt: Date.now() };
            this.capsules.update(list => [...list, newCap]);
            this.activeCapsuleId.set(capId);
            this.activeCapsuleName.set(newCap.name);
            
            if (this.isBrowser && this.authService.isLoggedIn()) {
                firstValueFrom(
                    this.http.post<{ data: any }>(`${API_BASE_URL}/capsule`, {
                        name: 'My Capsule',
                        autoAuthEnabled: 'off',
                        autoAuthEndpointId: null
                    })
                ).then(res => {
                    if (res?.data) {
                        const realId = res.data.id;
                        this.capsules.update(list => list.map(c => c.id === capId ? { ...c, id: realId } : c));
                        if (this.activeCapsuleId() === capId) this.activeCapsuleId.set(realId);
                        this.states.update(map => {
                            const next = new Map(map);
                            for (const [k, v] of next.entries()) {
                                if (v.capsuleId === capId) next.set(k, { ...v, capsuleId: realId });
                            }
                            return next;
                        });
                        this.savedCapsules.update(col => col.map(r => r.capsuleId === capId ? { ...r, capsuleId: realId } : r));
                    }
                }).catch(err => console.error('Failed to auto-create capsule', err));
            }
        }
        
        newState.capsuleId = capId;
        
        this.states.update(map => {
            const next = new Map(map);
            next.set(newId, newState);
            return next;
        });
        this.openTabIds.update(ids => {
            if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= ids.length) {
                const newIds = [...ids];
                newIds.splice(insertIndex, 0, newId);
                return newIds;
            }
            return [...ids, newId];
        });
        this.activeTabId.set(newId);
        this.syncActiveTabToBackend();
        return newId;
    }

    async switchCapsule(capsule: { id: string; name: string }): Promise<void> {
        if (this.isSaving()) {
            this.notificationService.notify('Please wait for the current save operation to complete or cancel it before switching capsules.');
            return;
        }

        const switchVersion = ++this.capsuleSwitchVersion;

        // Cancel any pending autoSave timer immediately so it doesn't fire for the previous capsule
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
            this.autoSaveTimeout = null;
        }

        // Save current capsule's tab layout and variables before switching
        const prevCapId = this.activeCapsuleId();
        if (this.isBrowser && prevCapId && prevCapId !== capsule.id) {
            localStorage.setItem(`onsteroids_open_tab_ids_${prevCapId}`, JSON.stringify(this.openTabIds()));
            localStorage.setItem(`onsteroids_active_tab_${prevCapId}`, this.activeTabId() || '');
            const vs = this.getVariableService();
            if (vs) {
                vs.saveVariables(false, prevCapId);
            }
        }

        this.activeCapsuleId.set(capsule.id);
        this.activeCapsuleName.set(capsule.name);
        // Clear savedCapsules immediately to avoid showing stale requests from previous capsule
        this.savedCapsules.set([]);

        // Restore open tabs from local storage for this target capsule
        let targetOpenIds: string[] = [];
        const savedCapOpen = this.isBrowser ? localStorage.getItem(`onsteroids_open_tab_ids_${capsule.id}`) : null;
        if (savedCapOpen) {
            try {
                const parsed = JSON.parse(savedCapOpen);
                if (Array.isArray(parsed)) {
                    targetOpenIds = parsed;
                }
            } catch (e) { }
        }
        this.openTabIds.set(targetOpenIds);

        const savedActive = this.isBrowser ? localStorage.getItem(`onsteroids_active_tab_${capsule.id}`) : null;
        if (savedActive && targetOpenIds.includes(savedActive)) {
            this.activeTabId.set(savedActive);
        } else {
            this.activeTabId.set(targetOpenIds[0] || null);
        }

        if (this.isBrowser) {
            localStorage.setItem('onsteroids_active_capsule', capsule.id);
        }

        const foundCap = this.capsules().find(c => c.id === capsule.id);
        if (foundCap) {
            this.autoAuthEnabled.set((foundCap.autoAuthEnabled as any) || 'off');
            this.autoAuthEndpointId.set(foundCap.autoAuthEndpointId || null);
        } else {
            this.autoAuthEnabled.set('off');
            this.autoAuthEndpointId.set(null);
        }

        // Explicitly load variables for the new capsule before loading requests
        const vs = this.getVariableService();
        if (vs) {
            await vs.loadVariables(capsule.id);
        }
        if (switchVersion !== this.capsuleSwitchVersion) return;

        await this.loadRequestsForCapsule(capsule.id);
        if (switchVersion !== this.capsuleSwitchVersion) return;

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
                            capsuleId: capsule.id,
                            responseBody: existing.responseBody ?? req.responseBody,
                            responseStatus: existing.responseStatus ?? req.responseStatus,
                            responseTime: existing.responseTime ?? req.responseTime,
                            responseSize: existing.responseSize ?? req.responseSize,
                            responseCookies: existing.responseCookies ?? req.responseCookies,
                            responseHeaders: existing.responseHeaders ?? req.responseHeaders,
                            testResults: existing.testResults ?? req.testResults
                        });
                    } else {
                        next.set(req.id, { ...req, capsuleId: capsule.id });
                    }
                }
                return next;
            });
        }

        // Re-validate open tabs after requests are loaded
        if (targetOpenIds.length === 0 && requestsInCapsule.length > 0) {
            targetOpenIds = requestsInCapsule.map(r => r.id);
            this.openTabIds.set(targetOpenIds);
            if (!this.activeTabId()) {
                this.activeTabId.set(targetOpenIds[0] || null);
            }
        }

        this.preloadAllExamples();

        if (switchVersion === this.capsuleSwitchVersion) {
            this.syncWorkspaceStateToBackend();
        }
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
                    this.http.post<{ data: any }>(`${API_BASE_URL}/capsule`, {
                        name: trimmed,
                        autoAuthEnabled: 'off',
                        autoAuthEndpointId: null
                    })
                );
                if (res?.data) {
                    newCap = {
                        id: res.data.id,
                        name: res.data.name,
                        autoAuthEnabled: res.data.autoAuthEnabled || 'off',
                        autoAuthEndpointId: res.data.autoAuthEndpointId || null,
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

    updateCurrentCapsuleAutoAuth(enabled?: 'off' | 'individual' | 'global', endpointId?: string | null) {
        const capId = this.activeCapsuleId();
        if (!capId) return;

        const currentScope = enabled !== undefined ? enabled : this.autoAuthEnabled();
        const currentEndpoint = endpointId !== undefined ? endpointId : this.autoAuthEndpointId();

        this.capsules.update(list => list.map(c => {
            if (c.id === capId) {
                return {
                    ...c,
                    autoAuthEnabled: currentScope,
                    autoAuthEndpointId: currentEndpoint
                };
            }
            return c;
        }));

        if (this.isBrowser && this.authService.isLoggedIn() && capId !== '1' && capId.length >= 8) {
            const currentCap = this.capsules().find(c => c.id === capId);
            firstValueFrom(
                this.http.put(`${API_BASE_URL}/capsule/${capId}`, {
                    name: currentCap?.name || this.activeCapsuleName(),
                    autoAuthEnabled: currentScope,
                    autoAuthEndpointId: currentEndpoint
                })
            ).catch(err => console.warn('Failed to persist capsule auto-auth settings to backend', err));
        }
    }

    async updateCapsuleName(id: string, newName: string): Promise<void> {
        const trimmed = newName.trim();
        if (!trimmed) return;

        this.capsules.update(list => list.map(c => c.id === id ? { ...c, name: trimmed } : c));
        
        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.put(`${API_BASE_URL}/capsule/${id}`, { name: trimmed })
                );
            } catch (err) {
                console.error('Failed to update capsule name on backend', err);
                throw err;
            }
        }
        
        if (this.isBrowser) {
            localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
        }
    }

    async duplicateCapsule(capsule: Capsule): Promise<Capsule> {
        // Create new capsule WITHOUT switching to it immediately
        const trimmed = `${capsule.name} (Copy)`.trim();
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
                console.error('Failed to create duplicated capsule on backend', err);
            }
        }

        // Clone Variables locally before we switch
        if (this.isBrowser) {
            const u = this.authService.currentUser();
            const oldId = capsule.id;
            const newId = newCap.id;
            const k1 = `onsteroids_last_vars_${oldId}`;
            const k2 = `onsteroids_vars_${oldId}`;
            const userK = u?.id ? `onsteroids_user_vars_${oldId}_${u.id}` : null;
            
            const saved = (userK ? localStorage.getItem(userK) : null) || localStorage.getItem(k1) || localStorage.getItem(k2);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(v => delete v.id); // clear IDs so they create new variables on backend
                        const str = JSON.stringify(parsed);
                        localStorage.setItem(`onsteroids_vars_${newId}`, str);
                        localStorage.setItem(`onsteroids_last_vars_${newId}`, str);
                        if (userK) localStorage.setItem(`onsteroids_user_vars_${newId}_${u!.id}`, str);
                    }
                } catch(e){}
            }
        }
        
        // Clone Requests
        const oldRequests = Array.from(this.states().values()).filter(r => r.capsuleId === capsule.id);
        const newStates = new Map(this.states());
        const idMap = new Map<string, string>();
        
        for (const req of oldRequests) {
            const newReqId = this.createId();
            idMap.set(req.id, newReqId);
            
            const clonedReq: RequestState = JSON.parse(JSON.stringify(req));
            clonedReq.id = newReqId;
            clonedReq.capsuleId = newCap.id;
            
            // Clean up request tracking info so it looks like a fresh clone
            clonedReq.responseBody = undefined;
            clonedReq.responseHeaders = [];
            clonedReq.responseStatus = 0;
            clonedReq.responseSize = 0;
            clonedReq.responseTime = 0;
            
            newStates.set(newReqId, clonedReq);
        }
        
        this.states.set(newStates);
        
        // Open the newly cloned tabs
        const clonedTabIds = oldRequests.map(r => idMap.get(r.id)!).filter(Boolean);
        if (clonedTabIds.length > 0) {
            this.openTabIds.set(clonedTabIds);
            this.activeTabId.set(clonedTabIds[0]);
        }
        
        this.capsules.update(list => [...list, newCap]);
        await this.switchCapsule(newCap);

        if (this.isBrowser) {
            localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
        }
        
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
                throw err;
            }
        }

        this.capsules.update(list => list.filter(c => c.id !== id));

        this.savedCapsules.update(col => col.filter(r => r.capsuleId !== id));
        this.states.update(map => {
            const next = new Map(map);
            for (const [key, state] of next.entries()) {
                if (state.capsuleId === id) {
                    next.delete(key);
                    this.historyStack.delete(key);
                }
            }
            return next;
        });

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
                const vs = this.getVariableService();
                if (vs) {
                    vs.setVariables([]);
                }
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
                throw err;
            }
        }

        const idSet = new Set(ids);
        this.capsules.update(list => list.filter(c => !idSet.has(c.id)));

        this.savedCapsules.update(col => col.filter(r => !r.capsuleId || !idSet.has(r.capsuleId)));
        this.states.update(map => {
            const next = new Map(map);
            for (const [key, state] of next.entries()) {
                if (state.capsuleId && idSet.has(state.capsuleId)) {
                    next.delete(key);
                    this.historyStack.delete(key);
                }
            }
            return next;
        });

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
                const vs = this.getVariableService();
                if (vs) {
                    vs.setVariables([]);
                }
            }
        }
    }

    async deleteRequest(id: string): Promise<void> {
        let backendError: any = null;
        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/request/${id}`)
                );
            } catch (err: any) {
                console.warn(`Backend delete for request ${id} notice:`, err);
                if (err?.status !== 404) {
                    backendError = err;
                }
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
        
        if (this.isBrowser) {
            try {
                const stored = localStorage.getItem('onsteroids_responses');
                if (stored) {
                    const map = JSON.parse(stored);
                    if (map[id]) {
                        delete map[id];
                        localStorage.setItem('onsteroids_responses', JSON.stringify(map));
                    }
                }
            } catch (e) {}
        }

        if (this.activeTabId() === id) {
            const remaining = this.openTabIds();
            this.activeTabId.set(remaining.length > 0 ? remaining[0] : null);
        }
        
        if (this.autoSaveEnabled() && this.authService.isLoggedIn()) {
            this.triggerAutoSave();
        }

        if (backendError) {
            throw backendError;
        }
    }

    async batchDeleteRequests(ids: string[]): Promise<void> {
        if (!ids || ids.length === 0) return;

        let backendError: any = null;
        if (this.isBrowser && this.authService.isLoggedIn()) {
            try {
                await firstValueFrom(
                    this.http.post(`${API_BASE_URL}/request/batch-delete`, { ids })
                );
            } catch (err: any) {
                console.warn('Backend batch delete requests notice:', err);
                if (err?.status !== 404) {
                    backendError = err;
                }
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

        if (this.isBrowser) {
            try {
                const stored = localStorage.getItem('onsteroids_responses');
                if (stored) {
                    const map = JSON.parse(stored);
                    let changed = false;
                    for (const id of ids) {
                        if (map[id]) {
                            delete map[id];
                            changed = true;
                        }
                    }
                    if (changed) {
                        localStorage.setItem('onsteroids_responses', JSON.stringify(map));
                    }
                }
            } catch (e) {}
        }

        if (this.activeTabId() && idSet.has(this.activeTabId()!)) {
            const remaining = this.openTabIds();
            this.activeTabId.set(remaining.length > 0 ? remaining[0] : null);
        }
        
        if (this.autoSaveEnabled() && this.authService.isLoggedIn()) {
            this.triggerAutoSave();
        }

        if (backendError) {
            throw backendError;
        }
    }

    closeOtherTabs(keepId: string) {
        this.openTabIds.set([keepId]);
        this.activeTabId.set(keepId);
        this.syncActiveTabToBackend();
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
            localStorage.setItem('onsteroids_responses', JSON.stringify(map));
        } catch (e) {
            console.warn('Could not cache response to storage', e);
        }

        // Auto-save: persist the new response to the backend workspace state
        // (the same sync manual save performs via snapshotCurrentSession)
        if (this.autoSaveEnabled() && this.authService.isLoggedIn()) {
            this.syncWorkspaceStateToBackend();
        }
    }

    getCachedResponse(id: string, url?: string): any {
        if (!this.isBrowser) return null;
        try {
            const stored = localStorage.getItem('onsteroids_responses');
            if (!stored) return null;
            const map = JSON.parse(stored);
            if (map[id]) return map[id];
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
            const isFile = window.location.origin.startsWith('file:');
            const origin = isFile ? 'http://localhost:5000' : window.location.origin;
            return `${origin}${isFile ? '/#/' : '/'}import?share=${res.data.shareToken}`;
        }
        throw new Error('Failed to generate share link');
    }

    mapStateToSaveRequest(state: RequestState, capsuleId?: string, capsuleName?: string): any {
        return {
            id: state.id,
            capsuleId: capsuleId || state.capsuleId,
            capsuleName: capsuleName || this.activeCapsuleName(),
            name: state.name || 'Imported Request',
            url: state.url || '',
            method: (state.method || 'GET').toUpperCase(),
            payloadType: state.payloadType || 'params',
            bodyType: state.bodyType || 'none',
            rawType: state.rawType || 'JSON',
            rawBody: state.rawBody || '',
            rawBodyJson: state.rawBodyJson || '',
            rawBodyXml: state.rawBodyXml || '',
            auth: {
                type: state.auth?.type || 'none',
                token: state.auth?.token || ''
            },
            scripts: {
                preRequest: state.scripts?.preRequest || '',
                postResponse: state.scripts?.postResponse || '',
                testScript: state.scripts?.testScript || '',
                testScriptEnabled: state.scripts?.testScriptEnabled ?? false
            },
            encryption: state.encryption || {
                algorithm: 'none',
                key: '',
                autoEncryptBody: false,
                autoEncryptHeaders: false,
                encryptedHeaders: [],
                encryptedBodyPaths: [],
                script: ''
            },
            settings: state.settings || {
                followRedirects: true,
                verifySsl: true,
                enableCookies: true,
                bypassCors: true
            },
            postTriggerTabId: state.postTriggerTabId || null,
            autoAuthEnabled: !!state.autoAuthEnabled,
            params: (state.params || []).map(p => ({ enabled: p.enabled ?? true, key: p.key || '', value: p.value || '' })),
            headers: (state.headers || []).map(h => ({ enabled: h.enabled ?? true, key: h.key || '', value: h.value || '' })),
            formData: (state.formData || []).map(f => ({ enabled: f.enabled ?? true, key: f.key || '', value: f.value || '', type: f.type || 'text' }))
        };
    }

    async importData(data: {
        capsules: {
            id?: string;
            name: string;
            autoAuthEnabled?: string;
            autoAuthEndpointId?: string | null;
            requests: RequestState[];
            variables?: IGlobalVariable[];
        }[];
        variables?: IGlobalVariable[];
    }, options?: { saveToBackend?: boolean }): Promise<{ capsulesCount: number; requestsCount: number }> {
        if (!data || !data.capsules || data.capsules.length === 0) {
            return { capsulesCount: 0, requestsCount: 0 };
        }

        const shouldSaveToBackend = options?.saveToBackend !== undefined
            ? options.saveToBackend
            : (this.isBrowser && this.authService.isLoggedIn());

        let totalRequests = 0;
        let lastCreatedCap: Capsule | null = null;
        let lastCreatedRequests: RequestState[] = [];
        let lastCreatedCapVars: IGlobalVariable[] = [];

        if (this.isBrowser && this.authService.isLoggedIn() && shouldSaveToBackend) {
            const payload = {
                capsules: data.capsules.map(c => ({
                    id: c.id,
                    name: c.name.trim() || 'Imported Capsule',
                    autoAuthEnabled: c.autoAuthEnabled || 'off',
                    autoAuthEndpointId: c.autoAuthEndpointId || null,
                    variables: (c.variables || data.variables || []).map(v => ({
                        id: v.id && v.id.length > 8 ? v.id : null,
                        key: (v.key || '').trim(),
                        value: v.value ?? '',
                        type: v.type ?? 'global',
                        enabled: v.enabled ?? true
                    })),
                    requests: c.requests.map(r => this.mapStateToSaveRequest(r, c.id, c.name))
                })),
                variables: (data.variables || []).map(v => ({
                    id: v.id && v.id.length > 8 ? v.id : null,
                    key: (v.key || '').trim(),
                    value: v.value ?? '',
                    type: v.type ?? 'global',
                    enabled: v.enabled ?? true
                }))
            };

            const response = await firstValueFrom(
                this.http.post<{ data: { capsulesCount: number; requestsCount: number; capsules: { capsule: any; requests: any[]; variables?: any[] }[] } }>(
                    `${API_BASE_URL}/import`,
                    payload
                )
            );

            if (response?.data && Array.isArray(response.data.capsules)) {
                for (let i = 0; i < response.data.capsules.length; i++) {
                    const importedCap = response.data.capsules[i];
                    const capData = importedCap.capsule;
                    const reqsData = importedCap.requests || [];
                    const capInput = data.capsules[i];

                    const newCap: Capsule = {
                        id: capData.id,
                        name: capData.name,
                        autoAuthEnabled: capData.autoAuthEnabled || 'off',
                        autoAuthEndpointId: capData.autoAuthEndpointId || null,
                        createdAt: new Date(capData.createdAt).getTime() || Date.now()
                    };

                    this.capsules.update(list => {
                        const exists = list.some(c => c.id === newCap.id);
                        return exists ? list.map(c => c.id === newCap.id ? newCap : c) : [...list, newCap];
                    });

                    const mappedRequests: RequestState[] = reqsData.map(r => {
                        const st = this.mapDtoToState(r);
                        st.capsuleId = newCap.id;
                        st.isDirty = false;
                        return st;
                    });

                    this.states.update(map => {
                        const next = new Map(map);
                        for (const mr of mappedRequests) {
                            next.set(mr.id, mr);
                        }
                        return next;
                    });



                    // Store variables for this capsule
                    const capVars: IGlobalVariable[] = (importedCap.variables && importedCap.variables.length > 0)
                        ? importedCap.variables.map(v => ({
                            id: v.id ? String(v.id) : this.createId(),
                            key: v.variableKey || v.key || '',
                            value: v.variableValue !== undefined ? v.variableValue : (v.value !== undefined ? v.value : ''),
                            type: v.type || 'global',
                            enabled: v.isEnabled !== undefined ? v.isEnabled : (v.enabled !== undefined ? v.enabled : true)
                        }))
                        : (capInput?.variables || data.variables || []);

                    if (this.isBrowser && capVars.length > 0) {
                        const varsJson = JSON.stringify(capVars);
                        localStorage.setItem(`onsteroids_vars_${newCap.id}`, varsJson);
                        localStorage.setItem(`onsteroids_last_vars_${newCap.id}`, varsJson);
                        const u = this.authService.currentUser();
                        if (u?.id) localStorage.setItem(`onsteroids_user_vars_${newCap.id}_${u.id}`, varsJson);
                        if (u?.email) localStorage.setItem(`onsteroids_user_vars_${newCap.id}_${u.email}`, varsJson);
                    }

                    totalRequests += mappedRequests.length;
                    lastCreatedCap = newCap;
                    lastCreatedRequests = mappedRequests;
                    lastCreatedCapVars = capVars;
                }
            }
        } else {
            // Local-only import for guest / offline users
            for (const c of data.capsules) {
                const capId = c.id || this.createId();
                const newCap: Capsule = {
                    id: capId,
                    name: c.name.trim() || 'Imported Capsule',
                    autoAuthEnabled: c.autoAuthEnabled || 'off',
                    autoAuthEndpointId: c.autoAuthEndpointId || null,
                    createdAt: Date.now()
                };

                this.capsules.update(list => [...list, newCap]);

                const reqs: RequestState[] = c.requests.map(r => ({
                    ...r,
                    capsuleId: capId,
                    isDirty: false
                }));

                this.states.update(map => {
                    const next = new Map(map);
                    for (const req of reqs) {
                        next.set(req.id, req);
                    }
                    return next;
                });

                const capVars = c.variables || data.variables || [];
                if (this.isBrowser && capVars.length > 0) {
                    const varsJson = JSON.stringify(capVars);
                    localStorage.setItem(`onsteroids_vars_${capId}`, varsJson);
                    localStorage.setItem(`onsteroids_last_vars_${capId}`, varsJson);
                }

                totalRequests += reqs.length;
                lastCreatedCap = newCap;
                lastCreatedRequests = reqs;
                lastCreatedCapVars = capVars;
            }
        }

        // Activate the imported capsule, its tabs, and its variables
        if (lastCreatedCap) {
            this.activeCapsuleId.set(lastCreatedCap.id);
            this.activeCapsuleName.set(lastCreatedCap.name);
            this.autoAuthEnabled.set((lastCreatedCap.autoAuthEnabled as any) || 'off');
            this.autoAuthEndpointId.set(lastCreatedCap.autoAuthEndpointId || null);

            if (this.isBrowser) {
                localStorage.setItem('onsteroids_active_capsule', lastCreatedCap.id);
                localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
            }

            const vs = this.getVariableService();
            if (vs) {
                vs.setVariables(lastCreatedCapVars || [], lastCreatedCap.id);
            }

            if (lastCreatedRequests.length > 0) {
                this.savedCapsules.set(lastCreatedRequests);
                const openIds = lastCreatedRequests.map(r => r.id);
                this.openTabIds.set(openIds);
                this.activeTabId.set(openIds[0]);

                if (this.isBrowser) {
                    localStorage.setItem(`onsteroids_open_tab_ids_${lastCreatedCap.id}`, JSON.stringify(openIds));
                    localStorage.setItem(`onsteroids_active_tab_${lastCreatedCap.id}`, openIds[0]);
                    localStorage.setItem('onsteroids_open_tab_ids', JSON.stringify(openIds));
                    localStorage.setItem('onsteroids_active_tab', openIds[0]);
                }
            }

            this.preloadAllExamples();
            if (shouldSaveToBackend) {
                this.syncWorkspaceStateToBackend();
            }
        }

        return {
            capsulesCount: data.capsules.length,
            requestsCount: totalRequests
        };
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
        const capId = this.createId();
        const capName = shared.capsuleName || 'Imported Capsule';

        const requestsToSave: RequestState[] = [];
        if (shared.requests && Array.isArray(shared.requests)) {
            for (const r of shared.requests) {
                const reqState = this.mapDtoToState({ ...r, id: this.createId(), capsuleId: capId });
                requestsToSave.push(reqState);
            }
        }

        const extractedVars = extractRequestsVariables(requestsToSave, shared.variables);

        const importRes = await this.importData({
            capsules: [{
                id: capId,
                name: capName,
                requests: requestsToSave,
                variables: extractedVars
            }],
            variables: extractedVars
        });

        return { capsuleName: capName, requestsCount: importRes.requestsCount };
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
        // Populate local storage cached examples into memory for instant access without network requests
        const requests = this.allCapsuleRequests();
        for (const req of requests) {
            const local = this.getLocalExamples(req.id);
            if (local.length > 0) {
                this.requestExamplesMap.update(map => {
                    if (map.has(req.id)) return map;
                    return new Map(map).set(req.id, local);
                });
            }
        }

        // Only fetch from backend if the user explicitly left a request expanded in the sidebar
        const savedExpanded = localStorage.getItem('onsteroids_expanded_example_req');
        if (savedExpanded && this.authService.isLoggedIn() && !this.fetchedExamplesIds.has(savedExpanded) && !this.inFlightExampleRequests.has(savedExpanded)) {
            this.getExamples(savedExpanded).catch(() => {});
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
                throw err;
            }
        }

        this.capsules.update(list => list.map(c => c.id === id ? { ...c, name: trimmed } : c));
        if (this.activeCapsuleId() === id) {
            this.activeCapsuleName.set(trimmed);
        }
    }

    updateState(id: string, partialState: Partial<RequestState>, recordHistory = true) {
        const ignorableKeys = ['isLoading', 'responseBody', 'responseStatus', 'responseTime', 'responseSize', 'responseCookies', 'responseHeaders', 'testResults', 'editorScrollPositions', 'isDirty'];
        const explicitDirty = Object.prototype.hasOwnProperty.call(partialState, 'isDirty');
        let becameDirty = false;

        this.states.update(map => {
            const currentState = map.get(id) || this.getDefaultState(id);

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

            let nextState: RequestState = { ...currentState, ...partialState };

            // Accurate baseline dirty tracking: compare against saved state (or default state if unsaved)
            if (!explicitDirty && isSignificantChange) {
                const saved = this.savedCapsules().find(r => r.id === id);
                const baseline = saved || this.getDefaultState(id);
                const isNowDirty = this.persistableFingerprint(nextState) !== this.persistableFingerprint(baseline);
                const fingerprintChanged = this.persistableFingerprint(currentState) !== this.persistableFingerprint(nextState);

                if (fingerprintChanged) {
                    this.editVersions.set(id, (this.editVersions.get(id) ?? 0) + 1);
                }

                if (nextState.isDirty !== isNowDirty) {
                    nextState = { ...nextState, isDirty: isNowDirty };
                }

                if (isNowDirty && fingerprintChanged) {
                    becameDirty = true;
                }
            }

            map.set(id, nextState);
            return new Map(map);
        });

        if (partialState.headers || partialState.params || partialState.rawBody || partialState.rawBodyJson) {
            const updated = this.states().get(id);
            if (updated) {
                this.getVariableService()?.syncVariablesFromInputs(id, updated);
            }
        }

        if (becameDirty && this.autoSaveEnabled() && this.authService.isLoggedIn()) {
            this.triggerAutoSave();
        }
    }

    /** Per-tab counter bumped on every real edit; used to detect edits made while a save is in flight */
    private editVersions = new Map<string, number>();

    /** Serialises only the fields that are persisted to the backend, used for dirty detection */
    private persistableFingerprint(s: RequestState): string {
        const normParams = (s.params || [])
            .filter(p => (p.key && p.key.trim() !== '') || (p.value && p.value.trim() !== ''))
            .map(p => ({ enabled: !!p.enabled, key: (p.key || '').trim(), value: (p.value || '').trim() }));

        const normHeaders = (s.headers || [])
            .filter(h => (h.key && h.key.trim() !== '') || (h.value && h.value.trim() !== ''))
            .map(h => ({ enabled: !!h.enabled, key: (h.key || '').trim(), value: (h.value || '').trim() }));

        const normFormData = (s.formData || [])
            .filter(f => (f.key && f.key.trim() !== '') || (f.value && f.value.trim() !== ''))
            .map(f => ({ enabled: !!f.enabled, key: (f.key || '').trim(), value: (f.value || '').trim(), type: f.type || 'text' }));

        return JSON.stringify([
            (s.name || '').trim(),
            (s.url || '').trim(),
            (s.method || 'GET').toUpperCase(),
            s.payloadType || 'params',
            s.bodyType || 'none',
            s.rawType || 'JSON',
            s.rawBody || '',
            s.rawBodyJson || '',
            s.rawBodyXml || '',
            s.auth?.type || 'none',
            s.auth?.token || '',
            s.scripts?.preRequest || '',
            s.scripts?.postResponse || '',
            s.scripts?.testScript || '',
            !!s.scripts?.testScriptEnabled,
            s.encryption?.algorithm || 'none',
            s.encryption?.key || '',
            !!s.encryption?.autoEncryptBody,
            !!s.encryption?.autoEncryptHeaders,
            s.encryption?.encryptedHeaders || [],
            s.encryption?.encryptedBodyPaths || [],
            s.encryption?.script || '',
            !!s.settings?.followRedirects,
            !!s.settings?.verifySsl,
            !!s.settings?.enableCookies,
            !!s.settings?.bypassCors,
            s.postTriggerTabId ?? null,
            !!s.autoAuthEnabled,
            normParams,
            normHeaders,
            normFormData
        ]);
    }

    triggerAutoSave() {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        this.autoSaveTimeout = setTimeout(() => this.runAutoSave(), 1500); // 1.5 second debounce
    }

    private async runAutoSave() {
        if (!this.autoSaveEnabled() || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;
        // Never run two saves concurrently — retry shortly after the current one finishes
        if (this.isSaving() || this.isAutoSaving()) {
            this.triggerAutoSave();
            return;
        }
        
        try {
            await this.saveToCapsule(undefined, { isAutoSave: true, onlyDirty: true });
        } catch (e) {
            console.warn('Auto-save failed', e);
        }
    }

    toggleAutoSave() {
        const next = !this.autoSaveEnabled();
        this.autoSaveEnabled.set(next);
        if (this.isBrowser) {
            localStorage.setItem('onsteroids_autosave', next ? 'true' : 'false');
        }
        if (this.authService.isLoggedIn()) {
            // Persist the preference to the backend right away for cross-device sync
            this.syncWorkspaceStateToBackend();
            if (next) {
                // Flush any pending unsaved edits immediately when enabling auto-save
                this.runAutoSave();
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
        this.syncActiveTabToBackend();
    }



    cancelSave() {
        if (this.isSaving()) {
            this.isSaveCancelled = true;
            this.notificationService.notify('Save operation cancelled.');
        }
    }

    async saveToCapsule(id?: string, options?: { onlyDirty?: boolean; isAutoSave?: boolean }): Promise<void> {
        const onlyDirty = !!options?.onlyDirty;
        const isAuto = !!options?.isAutoSave;
        if (isAuto) {
            this.isAutoSaving.set(true);
        } else {
            this.isSaving.set(true);
        }
        this.isSaveCancelled = false;

        try {
            const currentCapId = this.activeCapsuleId();
            const currentCapName = this.activeCapsuleName();

            // 1. Ensure all variables are synced to backend API
            const vs = this.getVariableService();
            if (vs) {
                vs.saveVariables(false);
                await vs.syncVariablesToBackend();
            }

            // 2. Collect all requests belonging to this capsule (deep cloned to capture a snapshot)
            const tabsToSave: RequestState[] = [];
            const seenIds = new Set<string>();

            if (id) {
                const activeTabState = this.states().get(id);
                if (activeTabState) {
                    tabsToSave.push(structuredClone(activeTabState));
                    seenIds.add(id);
                }
            }

            for (const s of this.states().values()) {
                if (onlyDirty && !s.isDirty) continue;
                if (!seenIds.has(s.id) && (s.capsuleId === currentCapId || (!s.capsuleId && currentCapId === '1'))) {
                    tabsToSave.push(structuredClone(s));
                    seenIds.add(s.id);
                }
            }

            if (!onlyDirty) {
                for (const s of this.savedCapsules()) {
                    if (!seenIds.has(s.id) && (s.capsuleId === currentCapId || (!s.capsuleId && currentCapId === '1'))) {
                        tabsToSave.push(structuredClone(s));
                        seenIds.add(s.id);
                    }
                }
            }

            if (onlyDirty && tabsToSave.length === 0) return;

            // Snapshot edit versions so we can detect edits made while the save is in flight
            const versionAtSnapshot = new Map<string, number>();
            for (const t of tabsToSave) {
                versionAtSnapshot.set(t.id, this.editVersions.get(t.id) ?? 0);
            }

            if (this.isSaveCancelled) return;

            // 3. If logged in, sync capsule and variables in parallel if capsule exists
            let effectiveCapId = currentCapId;
            if (this.authService.isLoggedIn() && currentCapId) {
                try {
                    const existing = this.capsules().find(c => c.id === currentCapId);
                    if (!existing || currentCapId === '1' || currentCapId.length < 8) {
                        const res = await firstValueFrom(
                            this.http.post<{ data: any }>(`${API_BASE_URL}/capsule`, {
                                name: currentCapName,
                                autoAuthEnabled: this.autoAuthEnabled(),
                                autoAuthEndpointId: this.autoAuthEndpointId()
                            })
                        );
                        if (res?.data?.id) {
                            const oldId = currentCapId;
                            effectiveCapId = res.data.id;
                            this.activeCapsuleId.set(effectiveCapId);
                            this.capsules.update(list => list.map(c => c.id === oldId ? {
                                ...c,
                                id: effectiveCapId,
                                name: currentCapName,
                                autoAuthEnabled: this.autoAuthEnabled(),
                                autoAuthEndpointId: this.autoAuthEndpointId()
                            } : c));
                            for (const tabState of tabsToSave) {
                                tabState.capsuleId = effectiveCapId;
                            }
                        }
                        if (vs) {
                            await vs.syncVariablesToBackend(effectiveCapId);
                        }
                    } else {
                        // Capsule already exists on backend: parallelize variable sync and capsule PUT
                        const prepTasks: Promise<any>[] = [];
                        if (vs) {
                            prepTasks.push(vs.syncVariablesToBackend(effectiveCapId));
                        }
                        if (!onlyDirty) {
                            prepTasks.push(
                                firstValueFrom(
                                    this.http.put(`${API_BASE_URL}/capsule/${currentCapId}`, {
                                        name: currentCapName,
                                        autoAuthEnabled: this.autoAuthEnabled(),
                                        autoAuthEndpointId: this.autoAuthEndpointId()
                                    })
                                ).catch(() => {})
                            );
                        }
                        if (prepTasks.length > 0) {
                            await Promise.allSettled(prepTasks);
                        }
                    }
                } catch (e) {
                    console.warn('Capsule sync note:', e);
                }
            }

            if (this.isSaveCancelled) return;

            // 4. Save independent request tabs in parallel
            const savePromises = tabsToSave.map(async (tabState) => {
                if (this.isSaveCancelled || this.authService.isLoggingOut()) {
                    return { oldId: tabState.id, savedId: tabState.id, persisted: false, editedDuringSave: false, tabState };
                }

                const oldId = tabState.id;
                let savedId = oldId;
                let persisted = false;
                let editedDuringSave = false;
                let updatedState: RequestState | undefined;
                let finalState: RequestState | undefined;

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
                            postTriggerTabId: tabState.postTriggerTabId || null,
                            autoAuthEnabled: !!tabState.autoAuthEnabled,
                            params: tabState.params.map(p => ({ enabled: p.enabled, key: p.key, value: p.value })),
                            headers: tabState.headers.map(h => ({ enabled: h.enabled, key: h.key, value: h.value })),
                            formData: tabState.formData.map(f => ({ enabled: f.enabled, key: f.key, value: f.value, type: f.type }))
                        };

                        const response = await firstValueFrom(
                            this.http.post<{ data: any }>(`${API_BASE_URL}/request/save`, payload)
                        );

                        if (response?.data) {
                            const savedData = response.data;
                            savedId = savedData.id || oldId;
                            if (savedId !== oldId) {
                                this.getVariableService()?.updateTabIdInSources(oldId, savedId);
                            }

                            const mappedSaved = this.mapDtoToState(savedData);
                            updatedState = {
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

                            editedDuringSave = (this.editVersions.get(oldId) ?? 0) !== (versionAtSnapshot.get(oldId) ?? 0);
                            finalState = editedDuringSave ? { ...tabState, id: savedId } : updatedState;
                            persisted = true;
                        }
                    } catch (err) {
                        console.error(`Failed to persist request ${tabState.id} to backend`, err);
                    }
                } else {
                    persisted = true;
                    finalState = tabState;
                }

                return { oldId, savedId, persisted, editedDuringSave, updatedState, finalState, tabState };
            });

            const saveResults = await Promise.all(savePromises);

            if (this.isSaveCancelled) return;

            // Batch update state in memory
            let idsChanged = false;
            const oldToNewIdMap = new Map<string, string>();

            this.states.update(map => {
                const next = new Map(map);
                for (const res of saveResults) {
                    if (!res.persisted) continue;
                    const live = next.get(res.oldId);
                    if (res.savedId !== res.oldId) {
                        next.delete(res.oldId);
                        oldToNewIdMap.set(res.oldId, res.savedId);
                    }
                    if (res.editedDuringSave && live) {
                        next.set(res.savedId, { ...live, id: res.savedId, capsuleId: effectiveCapId, isDirty: true });
                    } else if (res.updatedState) {
                        next.set(res.savedId, res.updatedState);
                    }
                }
                return next;
            });

            this.savedCapsules.update(col => {
                const nextCol = [...col];
                for (const res of saveResults) {
                    if (!res.persisted) continue;
                    const finalState = res.finalState || res.tabState;
                    const itemToSave = { ...finalState, isDirty: false, capsuleId: effectiveCapId };
                    const idx = nextCol.findIndex(r => r.id === res.savedId || r.id === res.oldId);
                    if (idx >= 0) {
                        nextCol[idx] = itemToSave;
                    } else {
                        nextCol.push(itemToSave);
                    }
                }
                return nextCol;
            });

            for (const res of saveResults) {
                if (!res.persisted) continue;
                if (res.savedId !== res.oldId) {
                    idsChanged = true;
                    const ver = this.editVersions.get(res.oldId);
                    if (ver !== undefined) {
                        this.editVersions.delete(res.oldId);
                        this.editVersions.set(res.savedId, ver);
                    }
                }
                this.updateState(res.savedId, { isDirty: res.editedDuringSave, capsuleId: effectiveCapId }, false);
            }

            if (idsChanged) {
                this.openTabIds.update(ids => ids.map(tid => oldToNewIdMap.get(tid) || tid));
                const active = this.activeTabId();
                if (active && oldToNewIdMap.has(active)) {
                    this.activeTabId.set(oldToNewIdMap.get(active)!);
                }
            }

            // 5. Update backend session in Variable table with newly saved IDs and state
            if (vs && this.authService.isLoggedIn() && (!onlyDirty || idsChanged)) {
                await vs.syncVariablesToBackend(effectiveCapId);
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
            if (isAuto) {
                this.isAutoSaving.set(false);
            } else {
                this.isSaving.set(false);
            }
        }
    }

    async loadBackendData(): Promise<void> {
        if (!this.isBrowser || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;
        if (this.isLoadingBackendData()) return;
        this.isLoadingBackendData.set(true);

        try {
            this.hasInitialBackendLoaded = true;

            // 1. Fetch WorkspaceState and Capsules in parallel
            const [wsRes, capRes] = await Promise.all([
                firstValueFrom(this.http.get<{ data: any }>(`${API_BASE_URL}/WorkspaceState`)).catch(err => {
                    console.warn('Could not load WorkspaceState', err);
                    return null;
                }),
                firstValueFrom(this.http.get<{ data: any[] }>(`${API_BASE_URL}/capsule`)).catch(err => {
                    console.warn('Could not load Capsules', err);
                    return null;
                })
            ]);

            // 2. Process capsules
            let backendCaps: Capsule[] = [];
            if (capRes?.data && Array.isArray(capRes.data) && capRes.data.length > 0) {
                backendCaps = capRes.data.map(c => ({
                    id: c.id,
                    name: c.name,
                    autoAuthEnabled: c.autoAuthEnabled || 'off',
                    autoAuthEndpointId: c.autoAuthEndpointId || null,
                    createdAt: new Date(c.createdAt).getTime() || Date.now()
                }));

                const mergedCaps = [...this.capsules()];
                backendCaps.forEach(bc => {
                    const idx = mergedCaps.findIndex(lc => lc.id === bc.id);
                    if (idx === -1) {
                        mergedCaps.push(bc);
                    } else {
                        mergedCaps[idx] = { ...mergedCaps[idx], ...bc };
                    }
                });

                // Remove fake '1' if backend has real capsules
                const fakeOne = mergedCaps.find(c => c.id === '1');
                if (fakeOne && backendCaps.length > 0) {
                    const idx = mergedCaps.findIndex(c => c.id === '1');
                    if (idx !== -1) mergedCaps.splice(idx, 1);
                }

                this.capsules.set(mergedCaps);
            }

            // 3. Immediately apply workspace state (restores active capsule, open tabs, active tab, draft states, responses)
            let targetCapId: string | null = null;
            if (wsRes?.data) {
                const ws = wsRes.data;
                const session: any = {
                    activeCapsuleId: ws.activeCapsuleId,
                    activeCapsuleName: ws.activeCapsuleName,
                    activeTabId: ws.activeTabId,
                    autoAuthEnabled: ws.autoAuthEnabled,
                    autoAuthEndpointId: ws.autoAuthEndpointId,
                    autoSaveEnabled: ws.autoSaveEnabled
                };

                try { session.openTabIds = ws.openTabIds ? JSON.parse(ws.openTabIds) : []; } catch { session.openTabIds = []; }
                try { session.states = ws.tabStates ? JSON.parse(ws.tabStates) : []; } catch { session.states = []; }
                try { session.responses = ws.responses ? JSON.parse(ws.responses) : {}; } catch { session.responses = {}; }

                this.applyBackendSession(session);
                targetCapId = session.activeCapsuleId || null;
            }

            // 4. Ensure active capsule is valid
            if (!targetCapId) {
                targetCapId = this.activeCapsuleId();
            }
            const matchingCap = this.capsules().find(c => c.id === targetCapId) || this.capsules()[0];
            if (matchingCap) {
                targetCapId = matchingCap.id;
                this.activeCapsuleId.set(matchingCap.id);
                this.activeCapsuleName.set(matchingCap.name);
                this.autoAuthEnabled.set((matchingCap.autoAuthEnabled as any) || 'off');
                this.autoAuthEndpointId.set(matchingCap.autoAuthEndpointId || null);
            }

            // 5. Fetch ONLY the active capsule's requests and variables in parallel
            const vs = this.getVariableService();
            if (targetCapId && targetCapId !== '1') {
                await Promise.all([
                    this.loadRequestsForCapsule(targetCapId),
                    matchingCap && vs ? vs.loadVariables(targetCapId) : Promise.resolve()
                ]);
            }

            // 6. Restore open tabs and active tab selection
            let targetOpenIds = this.openTabIds().filter(id => this.states().has(id));
            if (targetOpenIds.length === 0) {
                const capRequests = this.savedCapsules().filter(r => r.capsuleId === this.activeCapsuleId());
                if (capRequests.length > 0) {
                    targetOpenIds = capRequests.map(r => r.id);
                } else if (this.savedCapsules().length > 0) {
                    targetOpenIds = [this.savedCapsules()[0].id];
                }
            }

            if (targetOpenIds.length > 0) {
                this.openTabIds.set(targetOpenIds);
                const currentActive = this.activeTabId();
                if (!currentActive || !targetOpenIds.includes(currentActive)) {
                    this.activeTabId.set(targetOpenIds[0] || null);
                }
            }

            // Seed local examples and fetch only if a single request was expanded
            this.preloadAllExamples();

            // 7. Non-blocking background prefetch for other capsules (does not delay workspace display)
            setTimeout(() => {
                if (!this.isBrowser || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;
                const otherCaps = this.capsules().filter(c => c.id !== targetCapId && c.id !== '1' && c.id.length >= 8);
                if (otherCaps.length > 0) {
                    Promise.allSettled(
                        otherCaps.map(c =>
                            firstValueFrom(this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/capsule/${c.id}`))
                                .then(res => {
                                    if (res?.data && Array.isArray(res.data)) {
                                        const mapped = res.data.map(dto => this.mapDtoToState({ ...dto, capsuleId: c.id }));
                                        this.states.update(map => {
                                            const next = new Map(map);
                                            for (const req of mapped) {
                                                if (!next.has(req.id)) next.set(req.id, req);
                                            }
                                            return next;
                                        });
                                    }
                                })
                                .catch(() => {})
                        )
                    );
                }
            }, 1500);

        } catch (e) {
            console.error('Failed to load backend data', e);
        } finally {
            this.isLoadingBackendData.set(false);
        }
    }

    async loadRequestsForCapsule(capsuleId: string): Promise<void> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) return;

        try {
            const reqRes = await firstValueFrom(
                this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/capsule/${capsuleId}`)
            );
            // If active capsule changed while request was in-flight, discard stale response
            if (this.activeCapsuleId() !== capsuleId) {
                return;
            }
            if (reqRes?.data) {
                const sortedData = reqRes.data.sort((a, b) => {
                    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return timeA - timeB;
                });
                const mapped = sortedData.map(dto => this.mapDtoToState({ ...dto, capsuleId }));
                this.savedCapsules.set(mapped);
                this.states.update(map => {
                    const next = new Map(map);
                    for (const req of mapped) {
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
                postResponse: dto.postResponseScript || '',
                  testScript: dto.testScript || '',
                  testScriptEnabled: dto.testScriptEnabled || false
            },
            encryption: {
                ...base.encryption,
                algorithm: (dto.encryptionAlgorithm as any) || 'none',
                key: dto.encryptionKey || '',
                autoEncryptBody: dto.autoEncryptBody ?? false,
                autoEncryptHeaders: dto.autoEncryptHeaders ?? false,
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
            postTriggerTabId: dto.postTriggerTabId || null,
            autoAuthEnabled: !!dto.autoAuthEnabled,
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
        
        if (this.autoSaveEnabled() && this.authService.isLoggedIn()) {
            this.triggerAutoSave();
        }
        
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

        if (this.isBrowser) {
            localStorage.setItem(`onsteroids_open_tab_ids_${this.activeCapsuleId()}`, JSON.stringify(this.openTabIds()));
            localStorage.setItem('onsteroids_open_tab_ids', JSON.stringify(this.openTabIds()));
        }
        
        if (this.authService.isLoggedIn()) {
            this.syncWorkspaceStateToBackend();
        }
        
        if (this.autoSaveEnabled() && this.authService.isLoggedIn()) {
            this.triggerAutoSave();
        }
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
                encryptedHeaders: [],
                encryptedBodyPaths: [],
                script: 'async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths) {\n    //only code written within this code block will be executed\n}'
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


    createId(): string {
        return generateUUID();
    }
}







