import { Injectable, signal, computed, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { API_BASE_URL } from '../constants/api.constants';

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
    private states = signal<Map<string, RequestState>>(new Map());
    openTabIds = signal<string[]>([]);

    getState(id: string): RequestState | undefined {
        return this.states().get(id);
    }
    activeTabId = signal<string | null>(null);
    activeCapsuleName = signal<string>('My Capsule');
    activeCapsuleId = signal<string>('1');
    autoAuthEnabled = signal<'off' | 'individual' | 'global'>('off');
    autoAuthEndpointId = signal<string | null>(null);
    isCapsuleLoading = signal<boolean>(false);
    isSaving = signal<boolean>(false);

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

    constructor() {
        if (this.isBrowser) {
            this.loadFromStorage();
        }

        // Persist to storage whenever states change
        effect(() => {
            if (this.isBrowser) {
                const capId = this.activeCapsuleId();
                try {
                    const currentStates = Array.from(this.states().entries());
                    localStorage.setItem('onsteroids_states', JSON.stringify(currentStates));
                } catch (e) {
                    console.warn('Could not persist all states to localStorage (possibly quota exceeded):', e);
                }

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

        effect(() => {
            if (this.authService.isLoggedIn()) {
                this.loadBackendData();
            }
        });

        if (this.states().size === 0) {
            this.setActiveTab('1');
        }
    }

    private loadFromStorage() {
        if (!this.isBrowser) return;

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

    closeAllTabs() {
        this.openTabIds.set([]);
        this.activeTabId.set(null);
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
        this.states.update(map => {
            const next = new Map(map);
            if (!next.has(state.id)) {
                next.set(state.id, state);
            }
            return next;
        });

        if (!this.openTabIds().includes(state.id)) {
            this.openTabIds.update(ids => [...ids, state.id]);
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

    async saveToCapsule(id: string): Promise<void> {
        this.isSaving.set(true);

        const currentCapId = this.activeCapsuleId();
        const currentCapName = this.activeCapsuleName();

        // Collect all open tabs belonging to this capsule so full capsule state is saved
        const tabsToSave: RequestState[] = [];
        const activeTabState = this.states().get(id);
        if (activeTabState) {
            tabsToSave.push(activeTabState);
        }

        for (const tabId of this.openTabIds()) {
            if (tabId !== id) {
                const s = this.states().get(tabId);
                if (s && (s.capsuleId === currentCapId || !s.capsuleId)) {
                    tabsToSave.push(s);
                }
            }
        }

        for (const tabState of tabsToSave) {
            let savedId = tabState.id;
            if (this.authService.isLoggedIn()) {
                try {
                    const payload = {
                        id: tabState.id,
                        capsuleId: currentCapId,
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
                            postResponse: tabState.scripts.postResponse
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
                        if (savedData.id && savedData.id !== tabState.id) {
                            const oldId = tabState.id;
                            savedId = savedData.id;
                            const updatedState = { ...tabState, id: savedId, capsuleId: currentCapId, isDirty: false };
                            this.states.update(map => {
                                const next = new Map(map);
                                next.delete(oldId);
                                next.set(savedId, updatedState);
                                return next;
                            });
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
                    updated[idx] = { ...finalState, isDirty: false };
                    return updated;
                } else {
                    return [...col, { ...finalState, isDirty: false }];
                }
            });
            this.updateState(savedId, { isDirty: false, capsuleId: currentCapId });
        }

        if (this.isBrowser && currentCapId) {
            localStorage.setItem(`onsteroids_open_tab_ids_${currentCapId}`, JSON.stringify(this.openTabIds()));
            localStorage.setItem(`onsteroids_active_tab_${currentCapId}`, this.activeTabId() || '');
        }

        this.isSaving.set(false);
    }

    async loadBackendData(): Promise<void> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) return;

        try {
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

                const storedCapId = localStorage.getItem('onsteroids_active_capsule');
                const matched = caps.find(c => c.id === storedCapId) || caps.find(c => c.id === this.activeCapsuleId()) || caps[0];
                this.activeCapsuleId.set(matched.id);
                this.activeCapsuleName.set(matched.name);
                localStorage.setItem('onsteroids_active_capsule', matched.id);

                await this.loadRequestsForCapsule(matched.id);

                const requests = this.savedCapsules();
                if (requests.length > 0) {
                    this.states.update(map => {
                        const next = new Map(map);
                        for (const req of requests) {
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

                // Restore open tabs for this capsule
                let targetOpenIds: string[] = [];
                const savedCapOpen = localStorage.getItem(`onsteroids_open_tab_ids_${matched.id}`) || localStorage.getItem('onsteroids_open_tab_ids');
                if (savedCapOpen) {
                    try {
                        const parsed = JSON.parse(savedCapOpen);
                        if (Array.isArray(parsed)) {
                            targetOpenIds = parsed.filter(id => this.states().has(id));
                        }
                    } catch (e) { }
                }

                if (targetOpenIds.length === 0) {
                    if (requests.length > 0) {
                        targetOpenIds = requests.map(r => r.id);
                    } else {
                        const newId = this.createId();
                        const blankState = this.getDefaultState(newId);
                        blankState.capsuleId = matched.id;
                        this.states.update(map => new Map(map).set(newId, blankState));
                        targetOpenIds = [newId];
                    }
                }

                this.openTabIds.set(targetOpenIds);

                const storedActiveTab = localStorage.getItem(`onsteroids_active_tab_${matched.id}`) || localStorage.getItem('onsteroids_active_tab');
                if (storedActiveTab && targetOpenIds.includes(storedActiveTab)) {
                    this.activeTabId.set(storedActiveTab);
                } else {
                    this.activeTabId.set(targetOpenIds[0] || null);
                }
            }
        } catch (e) {
            console.error('Failed to load capsules from backend', e);
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
                enabled: p.isEnabled ?? true,
                key: p.paramKey ?? '',
                value: p.paramValue ?? ''
            })),
            headers: (dto.headers || []).map((h: any) => ({
                enabled: h.isEnabled ?? true,
                key: h.headerKey ?? '',
                value: h.headerValue ?? ''
            })),
            formData: (dto.formData || []).map((f: any) => ({
                enabled: f.isEnabled ?? true,
                key: f.fieldKey ?? '',
                value: f.fieldValue ?? '',
                type: (f.fieldType as any) || 'text'
            })),
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
