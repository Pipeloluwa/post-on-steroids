import { Injectable, signal, computed, effect, untracked, inject, PLATFORM_ID, Injector } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { generateUUID } from '../utils/uuid.util';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService, UserAuth } from './auth.service';
import { NotificationService } from './notification.service';
import { API_BASE_URL } from '../constants/api.constants';
import { VariableService } from './variable.service';
import { AutoAuthService } from './auto-auth.service';
import { IGlobalVariable } from '../../interfaces/services/IVariableService';
import { extractRequestsVariables } from '../utils/import-variable.util';
import { getAppBaseUrl } from '../utils/url.util';
import { buildCurlCommand, CurlBuildOptions } from '../utils/curl-generator.util';
import { copyTextToClipboard } from '../utils/clipboard.util';
import {
    DEFAULT_ENCRYPTION_SCRIPT_SKELETON,
    DEFAULT_PRE_REQUEST_SCRIPT_SKELETON,
    DEFAULT_POST_RESPONSE_SCRIPT_SKELETON,
    DEFAULT_TEST_SCRIPT_SKELETON
} from '../constants/script.snippets.constants';

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

export interface RequestGroup {
    id: string;
    name: string;
    capsuleId: string;
    isExpanded?: boolean;
    requestIds: string[];
    createdAt: number;
}

export type SidebarRootItem =
    | { type: 'group'; id: string; group: RequestGroup; requests: RequestState[] }
    | { type: 'request'; id: string; request: RequestState };

export type SidebarFocusedItem = {
    type: 'group' | 'request';
    id: string;
    groupId: string | null;
} | null;

export interface RequestState {
    id: string;
    capsuleId?: string;
    groupId?: string | null;
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
    executionToken?: number;
    bodyWrapStyle?: 'pretty' | 'key-field' | 'word-wrap' | 'collapsed';
    responseWrapStyle?: 'pretty' | 'key-field' | 'word-wrap' | 'collapsed';
    responseActiveMode?: string;
    consoleWrap?: boolean;
}


export interface Capsule {
    id: string;
    name: string;
    createdAt: number;
    autoAuthEnabled?: 'off' | 'individual' | 'global' | string;
    autoAuthEndpointId?: string | null;
    isLocalOnly?: boolean;
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

    private getAutoAuthService(): AutoAuthService | null {
        try {
            return this.injector.get(AutoAuthService);
        } catch {
            return null;
        }
    }

    snapshotCurrentSession(userParam?: UserAuth | null, syncBackend: boolean = true, allowEmpty: boolean = false) {
        if (!this.isBrowser) return;

        // CRITICAL GUARD: Never overwrite a valid saved session with an empty workspace unless explicitly deleting/clearing
        if (!allowEmpty && this.openTabIds().length === 0 && this.states().size === 0) {
            return;
        }

        const user = userParam || this.authService.currentUser();
        const effectiveId = user?.id || user?.email || 'default';
        try {
            const currentStates: [string, RequestState][] = Array.from(this.states().entries()).map(([id, s]) => [
                id,
                s && s.isLoading ? { ...s, isLoading: false } : s
            ]);
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

            for (const delReqId of this.deletedRequestIds) {
                delete storedResponses[delReqId];
            }
            const cleanGroupsEntries = Array.from(this.capsuleGroupsMap().entries())
                .filter(([cId]) => !this.deletingCapsuleIds.has(cId));
            const cleanOrderEntries = Array.from(this.capsuleRequestOrderMap().entries())
                .filter(([cId]) => !this.deletingCapsuleIds.has(cId));
            storedResponses['__capsule_groups_map__'] = Object.fromEntries(cleanGroupsEntries);
            storedResponses['__capsule_order_map__'] = Object.fromEntries(cleanOrderEntries);

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
                capsuleGroups: Array.from(this.capsuleGroupsMap().entries()),
                capsuleOrders: Array.from(this.capsuleRequestOrderMap().entries()),
                autoAuthEnabled: this.autoAuthEnabled(),
                autoAuthEndpointId: this.autoAuthEndpointId(),
                timestamp: Date.now()
            };

            const serialized = JSON.stringify(sessionData);
            localStorage.setItem(`onsteroids_user_session_${effectiveId}`, serialized);
            localStorage.setItem('onsteroids_last_session', serialized);
            if (user?.id) localStorage.setItem(`onsteroids_user_session_${user.id}`, serialized);
            if (user?.email) localStorage.setItem(`onsteroids_user_session_${user.email}`, serialized);

            if (syncBackend) {
                // Sync to backend for cross-device persistence (debounced)
                this.syncWorkspaceStateToBackend();
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

            // 4b. Restore capsule groups & request orders
            if (Array.isArray(session.capsuleGroups) && session.capsuleGroups.length > 0) {
                this.capsuleGroupsMap.set(new Map<string, RequestGroup[]>(session.capsuleGroups));
            }
            if (Array.isArray(session.capsuleOrders) && session.capsuleOrders.length > 0) {
                this.capsuleRequestOrderMap.set(new Map<string, string[]>(session.capsuleOrders));
            }

            // 5. Restore responses in localStorage
            if (session.responses) {
                if (session.responses['__capsule_groups_map__'] && typeof session.responses['__capsule_groups_map__'] === 'object') {
                    const gMap = new Map<string, RequestGroup[]>(this.capsuleGroupsMap());
                    for (const [cId, grps] of Object.entries(session.responses['__capsule_groups_map__'])) {
                        if (Array.isArray(grps)) gMap.set(cId, grps as RequestGroup[]);
                    }
                    this.capsuleGroupsMap.set(gMap);
                }
                if (session.responses['__capsule_order_map__'] && typeof session.responses['__capsule_order_map__'] === 'object') {
                    const oMap = new Map<string, string[]>(this.capsuleRequestOrderMap());
                    for (const [cId, ord] of Object.entries(session.responses['__capsule_order_map__'])) {
                        if (Array.isArray(ord)) oMap.set(cId, ord as string[]);
                    }
                    this.capsuleRequestOrderMap.set(oMap);
                }
                localStorage.setItem('onsteroids_responses', JSON.stringify(session.responses));
            }

            // 5b. Overlay latest per-capsule groups and orders from dedicated localStorage keys
            try {
                const rawAllGroups = localStorage.getItem('onsteroids_all_capsule_groups');
                if (rawAllGroups) {
                    const parsedAll = JSON.parse(rawAllGroups);
                    if (parsedAll && typeof parsedAll === 'object') {
                        const gMap = new Map<string, RequestGroup[]>(this.capsuleGroupsMap());
                        for (const [cId, grps] of Object.entries(parsedAll)) {
                            if (Array.isArray(grps)) gMap.set(cId, grps as RequestGroup[]);
                        }
                        this.capsuleGroupsMap.set(gMap);
                    }
                }
                const capIdsToCheck = new Set<string>([
                    ...this.capsules().map(c => c.id),
                    ...(session.activeCapsuleId ? [session.activeCapsuleId] : [])
                ]);
                for (const cId of capIdsToCheck) {
                    const localGrps = this.loadCapsuleGroupsFromStorage(cId);
                    if (localGrps) {
                        this.capsuleGroupsMap.update(m => new Map(m).set(cId, localGrps));
                    }
                    const localOrd = this.loadCapsuleRequestOrder(cId);
                    if (localOrd) {
                        this.capsuleRequestOrderMap.update(m => new Map(m).set(cId, localOrd));
                    }
                    this.syncGroupAssignmentsToRequests(cId);
                }
            } catch {}

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
                        vs.setVariables(session.variables, session.activeCapsuleId, false);
                    } else {
                        vs.restoreUserVariables(u, session.activeCapsuleId);
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
        const openTabs = this.openTabs();
        // If they opened multiple tabs
        if (openTabs.length > 1) return true;
        
        // Check the single open tab
        const state = openTabs[0];
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
                    if (this.deletedRequestIds.has(id) || (state?.capsuleId && this.deletingCapsuleIds.has(state.capsuleId))) {
                        continue;
                    }
                    const safeState = state ? { ...state, isLoading: false } : state;
                    if (!next.has(id)) {
                        next.set(id, safeState);
                    } else {
                        next.set(id, { ...next.get(id), ...safeState, isLoading: false });
                    }
                }
                return next;
            });
        }

        if (session.responses && typeof session.responses === 'object') {
            const backendTsMap: Record<string, number> =
                (session.responses['__capsule_structure_ts_map__'] && typeof session.responses['__capsule_structure_ts_map__'] === 'object')
                    ? session.responses['__capsule_structure_ts_map__']
                    : {};

            if (session.responses['__capsule_groups_map__'] && typeof session.responses['__capsule_groups_map__'] === 'object') {
                this.capsuleGroupsMap.update(map => {
                    const next = new Map(map);
                    for (const [cId, grps] of Object.entries(session.responses['__capsule_groups_map__'])) {
                        if (this.deletingCapsuleIds.has(cId)) continue;
                        if (Array.isArray(grps)) {
                            const localTs = this.getLocalStructureTimestamp(cId);
                            const remoteTs = Number(backendTsMap[cId] || 0);
                            if (localTs > 0 && localTs > remoteTs && next.has(cId)) {
                                continue;
                            }
                            const cleanedGrps = (grps as RequestGroup[])
                                .filter(g => !this.deletedGroupIds.has(g.id))
                                .map(g => ({
                                    ...g,
                                    requestIds: (g.requestIds || []).filter(rId => !this.deletedRequestIds.has(rId))
                                }));
                            next.set(cId, cleanedGrps);
                            if (this.isBrowser) {
                                try {
                                    localStorage.setItem(`onsteroids_capsule_groups_${cId}`, JSON.stringify(cleanedGrps));
                                } catch {}
                            }
                        }
                    }
                    if (this.isBrowser) {
                        try {
                            localStorage.setItem('onsteroids_all_capsule_groups', JSON.stringify(Object.fromEntries(next)));
                        } catch {}
                    }
                    return next;
                });
            }
            if (session.responses['__capsule_order_map__'] && typeof session.responses['__capsule_order_map__'] === 'object') {
                this.capsuleRequestOrderMap.update(map => {
                    const next = new Map(map);
                    for (const [cId, ord] of Object.entries(session.responses['__capsule_order_map__'])) {
                        if (this.deletingCapsuleIds.has(cId)) continue;
                        if (Array.isArray(ord)) {
                            const localTs = this.getLocalStructureTimestamp(cId);
                            const remoteTs = Number(backendTsMap[cId] || 0);
                            if (localTs > 0 && localTs > remoteTs && next.has(cId)) {
                                continue;
                            }
                            const cleanedOrd = (ord as string[]).filter(
                                id => !this.deletedGroupIds.has(id) && !this.deletedRequestIds.has(id)
                            );
                            next.set(cId, cleanedOrd);
                            if (this.isBrowser) {
                                try {
                                    localStorage.setItem(`onsteroids_capsule_order_${cId}`, JSON.stringify(cleanedOrd));
                                } catch {}
                            }
                        }
                    }
                    return next;
                });
            }

            this.states.update(map => {
                const next = new Map(map);
                for (const [id, state] of next.entries()) {
                    if (id.startsWith('__')) continue;
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
                const filteredTabs = (session.openTabIds as string[]).filter(id => !this.deletedRequestIds.has(id));
                this.openTabIds.set(filteredTabs);
                if (session.activeTabId && filteredTabs.includes(session.activeTabId)) {
                    this.activeTabId.set(session.activeTabId);
                } else {
                    this.activeTabId.set(filteredTabs[0] || null);
                }
            } else if (session.activeTabId && !this.deletedRequestIds.has(session.activeTabId)) {
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

    /** Debounced (or immediate) sync of workspace state to backend for cross-device persistence */
    private syncWorkspaceStateToBackend(immediate = false, forceSync = false): Promise<void> {
        if (!this.isBrowser || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) {
            return Promise.resolve();
        }

        const capIdNow = this.activeCapsuleId();
        const currentCap = this.capsules().find(c => c.id === capIdNow);
        if (!forceSync && (currentCap?.isLocalOnly || (capIdNow && this.deletingCapsuleIds.has(capIdNow)))) {
            return Promise.resolve();
        }

        clearTimeout(this.workspaceStateSyncTimeout);

        const executeSync = async () => {
            try {
                const activeIdNow = this.activeCapsuleId();
                const activeCap = this.capsules().find(c => c.id === activeIdNow);
                if (!forceSync && (activeCap?.isLocalOnly || (activeIdNow && this.deletingCapsuleIds.has(activeIdNow)))) return;

                const currentStates = Array.from(this.states().entries()).filter(
                    ([id, s]) => !this.deletedRequestIds.has(id) && !(s.capsuleId && this.deletingCapsuleIds.has(s.capsuleId))
                );
                let storedResponses: Record<string, unknown> = {};
                try {
                    const rawResp = localStorage.getItem('onsteroids_responses');
                    if (rawResp) storedResponses = JSON.parse(rawResp);
                } catch {}

                for (const delReqId of this.deletedRequestIds) {
                    delete storedResponses[delReqId];
                }

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

                const tsMap: Record<string, number> = {};
                for (const c of this.capsules()) {
                    if (this.deletingCapsuleIds.has(c.id)) continue;
                    const ts = this.getLocalStructureTimestamp(c.id);
                    if (ts > 0) tsMap[c.id] = ts;
                }

                const cleanGroupsEntries = Array.from(this.capsuleGroupsMap().entries())
                    .filter(([cId]) => !this.deletingCapsuleIds.has(cId));
                const cleanOrderEntries = Array.from(this.capsuleRequestOrderMap().entries())
                    .filter(([cId]) => !this.deletingCapsuleIds.has(cId));

                storedResponses['__capsule_groups_map__'] = Object.fromEntries(cleanGroupsEntries);
                storedResponses['__capsule_order_map__'] = Object.fromEntries(cleanOrderEntries);
                storedResponses['__capsule_structure_ts_map__'] = tsMap;

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
        };

        if (immediate) {
            return executeSync();
        }

        return new Promise<void>(resolve => {
            this.workspaceStateSyncTimeout = setTimeout(async () => {
                await executeSync();
                resolve();
            }, 600);
        });
    }

    private activeTabSyncTimeout: any = null;

    /** Lightweight sync of active tab and open tabs to backend for resume/login persistence */
    syncActiveTabToBackend() {
        if (!this.isBrowser || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;

        const currentCap = this.capsules().find(c => c.id === this.activeCapsuleId());
        if (currentCap?.isLocalOnly) return;

        clearTimeout(this.activeTabSyncTimeout);
        this.activeTabSyncTimeout = setTimeout(async () => {
            try {
                const activeId = this.activeTabId();
                if (!activeId) return;

                const activeCap = this.capsules().find(c => c.id === this.activeCapsuleId());
                if (activeCap?.isLocalOnly) return;

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

    /** Tracks tab IDs that have been remapped during saves (e.g. temporary ID -> persisted GUID) */
    private idRedirects = new Map<string, string>();

    /** Tracks active execution sequence counter per tab to fence against race conditions */
    private executionTokens = new Map<string, number>();

    resolveTabId(id: string): string {
        if (!id) return id;
        let current = id;
        const seen = new Set<string>();
        while (this.idRedirects.has(current) && !seen.has(current)) {
            seen.add(current);
            current = this.idRedirects.get(current)!;
        }
        return current;
    }

    registerIdRedirect(oldId: string, newId: string): void {
        if (oldId && newId && oldId !== newId) {
            this.idRedirects.set(oldId, newId);
            const tok = this.executionTokens.get(oldId);
            if (tok !== undefined) {
                this.executionTokens.set(newId, tok);
            }
        }
    }

    nextExecutionToken(tabId: string): number {
        const effectiveId = this.resolveTabId(tabId);
        const next = (this.executionTokens.get(effectiveId) ?? 0) + 1;
        this.executionTokens.set(effectiveId, next);
        if (effectiveId !== tabId) {
            this.executionTokens.set(tabId, next);
        }
        return next;
    }

    getExecutionToken(tabId: string): number {
        const effectiveId = this.resolveTabId(tabId);
        return this.executionTokens.get(effectiveId) ?? this.executionTokens.get(tabId) ?? 0;
    }

    isExecutionCurrent(tabId: string, token: number): boolean {
        const effectiveId = this.resolveTabId(tabId);
        const current = this.executionTokens.get(effectiveId) ?? this.executionTokens.get(tabId) ?? 0;
        return current === token;
    }

    getState(id: string): RequestState | undefined {
        const effectiveId = this.resolveTabId(id);
        return this.states().get(effectiveId) ?? this.states().get(id);
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

    // Tab Navigation History
    tabNavigationStack = signal<string[]>([]);
    tabNavigationIndex = signal<number>(-1);
    private isNavigatingHistory = false;

    canNavigateBack = computed(() => this.tabNavigationIndex() > 0);
    canNavigateForward = computed(() => {
        const idx = this.tabNavigationIndex();
        return idx >= 0 && idx < this.tabNavigationStack().length - 1;
    });

    // Custom order of requests per capsule (drives vertical sidebar list rearrangement)
    capsuleRequestOrderMap = signal<Map<string, string[]>>(new Map());

    // Request groups (Postman-style folders) per capsule
    capsuleGroupsMap = signal<Map<string, RequestGroup[]>>(new Map());
    focusedSidebarItem = signal<SidebarFocusedItem>(null);
    focusedDirectoryGroupName = computed<string | null>(() => {
        const capId = this.activeCapsuleId();
        const groupId = this.resolveFocusedDirectoryGroupId(capId);
        if (!groupId) return null;
        return this.getGroupsForCapsule(capId).find(g => g.id === groupId)?.name || null;
    });
    private groupsVarSyncTimeout: any = null;
    private hasPendingStructureSync = false;
    private checkedGroupCapsules = new Set<string>();
    private inFlightGroupLoads = new Map<string, Promise<RequestGroup[]>>();
    private deletingCapsuleIds = new Set<string>();
    private deletedRequestIds = new Set<string>();
    private deletedGroupIds = new Set<string>();

    public isCapsuleDeleting(capId: string): boolean {
        return Boolean(capId && this.deletingCapsuleIds.has(capId));
    }

    setFocusedSidebarItem(item: SidebarFocusedItem): void {
        this.focusedSidebarItem.set(item);
    }

    resolveFocusedDirectoryGroupId(capsuleId?: string): string | null {
        const focused = this.focusedSidebarItem();
        if (!focused) return null;
        const capId = capsuleId || this.activeCapsuleId();
        if (!capId) return null;
        const groups = this.getGroupsForCapsule(capId);

        if (focused.type === 'group') {
            return groups.some(g => g.id === focused.id) ? focused.id : null;
        }

        const ownerByGroup = groups.find(g => (g.requestIds || []).includes(focused.id));
        if (ownerByGroup) return ownerByGroup.id;

        const reqState = this.states().get(focused.id) || this.savedCapsules().find(r => r.id === focused.id);
        const candidateGroupId = reqState?.groupId ?? focused.groupId;
        if (candidateGroupId && groups.some(g => g.id === candidateGroupId)) {
            return candidateGroupId;
        }
        return null;
    }

    private isValidGuid(id?: string | null): boolean {
        return Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    }

    private expandResolvedIds(ids: string[]): string[] {
        const expanded = new Set<string>();
        for (const rawId of ids) {
            if (!rawId) continue;
            expanded.add(rawId);
            const resolved = this.resolveTabId(rawId);
            if (resolved) expanded.add(resolved);
        }
        for (const [oldId, newId] of this.idRedirects.entries()) {
            if (expanded.has(oldId) || expanded.has(newId)) {
                expanded.add(oldId);
                expanded.add(newId);
            }
        }
        return Array.from(expanded);
    }

    private markLocalStructureTimestamp(capId: string): number {
        const now = Date.now();
        if (this.isBrowser && capId) {
            try {
                localStorage.setItem(`onsteroids_capsule_structure_ts_${capId}`, String(now));
            } catch {}
        }
        return now;
    }

    private getLocalStructureTimestamp(capId: string): number {
        if (!this.isBrowser || !capId) return 0;
        try {
            const raw = localStorage.getItem(`onsteroids_capsule_structure_ts_${capId}`);
            return raw ? Number(raw) || 0 : 0;
        } catch {
            return 0;
        }
    }

    private syncGroupAssignmentsToRequests(capId: string): void {
        if (!capId) return;
        const groups = this.getGroupsForCapsule(capId);
        const reqToGroup = new Map<string, string>();
        for (const g of groups) {
            for (const rId of (g.requestIds || [])) {
                reqToGroup.set(rId, g.id);
            }
        }

        this.states.update(map => {
            let changed = false;
            const next = new Map(map);
            for (const [rId, st] of next.entries()) {
                if (st.capsuleId === capId || (!st.capsuleId && capId === '1')) {
                    const targetGId = reqToGroup.get(rId) ?? null;
                    if ((st.groupId ?? null) !== targetGId) {
                        next.set(rId, { ...st, groupId: targetGId });
                        changed = true;
                    }
                }
            }
            return changed ? next : map;
        });

        this.savedCapsules.update(col => col.map(r => {
            if (r.capsuleId === capId || (!r.capsuleId && capId === '1')) {
                const targetGId = reqToGroup.get(r.id) ?? null;
                if ((r.groupId ?? null) !== targetGId) {
                    return { ...r, groupId: targetGId };
                }
            }
            return r;
        }));
    }

    private notifyStructureOrOrderChanged(capId: string, syncBackend = true): void {
        if (!capId || this.deletingCapsuleIds.has(capId)) return;
        this.markLocalStructureTimestamp(capId);
        this.snapshotCurrentSession(undefined, false);

        if (syncBackend && this.authService.isLoggedIn()) {
            this.syncWorkspaceStateToBackend();
            this.scheduleGroupsVariableSync(capId);
            if (this.autoSaveEnabled()) {
                this.hasPendingStructureSync = true;
                this.triggerAutoSave(600);
            }
        }
    }

    private loadCapsuleRequestOrder(capId: string): string[] | null {
        if (!this.isBrowser || !capId) return null;
        try {
            const raw = localStorage.getItem(`onsteroids_capsule_order_${capId}`);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch { }
        return null;
    }

    private loadCapsuleGroupsFromStorage(capId: string): RequestGroup[] | null {
        if (!this.isBrowser || !capId) return null;
        try {
            const raw = localStorage.getItem(`onsteroids_capsule_groups_${capId}`);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch { }
        return null;
    }

    getGroupsForCapsule(capId: string): RequestGroup[] {
        if (!capId) return [];
        const inMem = this.capsuleGroupsMap().get(capId);
        if (inMem) return inMem;
        const fromStorage = this.loadCapsuleGroupsFromStorage(capId);
        return fromStorage || [];
    }

    private setGroupsForCapsule(capId: string, groups: RequestGroup[], syncBackend = true): void {
        if (!capId) return;
        this.checkedGroupCapsules.add(capId);
        const currentInMem = this.capsuleGroupsMap().get(capId);
        if (!syncBackend && currentInMem && currentInMem.length === 0 && groups.length === 0) {
            return;
        }
        this.capsuleGroupsMap.update(m => {
            const next = new Map(m);
            next.set(capId, groups);
            if (this.isBrowser) {
                try {
                    localStorage.setItem(`onsteroids_capsule_groups_${capId}`, JSON.stringify(groups));
                    localStorage.setItem('onsteroids_all_capsule_groups', JSON.stringify(Object.fromEntries(next)));
                } catch {}
            }
            return next;
        });

        if (syncBackend) {
            this.notifyStructureOrOrderChanged(capId, true);
        } else {
            this.snapshotCurrentSession(undefined, false);
        }
    }

    private scheduleGroupsVariableSync(capId: string): void {
        if (!capId || this.deletingCapsuleIds.has(capId) || !this.isBrowser || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;
        clearTimeout(this.groupsVarSyncTimeout);
        this.groupsVarSyncTimeout = setTimeout(() => {
            const vs = this.getVariableService();
            if (vs) {
                vs.syncVariablesToBackend(capId).catch(() => {});
            }
        }, 600);
    }

    getRequestOrderForCapsule(capId: string): string[] {
        if (!capId) return [];
        return this.capsuleRequestOrderMap().get(capId) || this.loadCapsuleRequestOrder(capId) || [];
    }

    getCapsuleGroupsSyncPayload(capId: string): {
        groups: RequestGroup[];
        groupOrder: string[];
        order: string[];
        updatedAt: number;
        autoAuthEnabled?: string;
        autoAuthEndpointId?: string | null;
        requestMeta?: Record<string, any>;
    } {
        const groups = this.getGroupsForCapsule(capId);
        const groupOrder = groups.map(g => g.id);
        const order = this.getRequestOrderForCapsule(capId);
        const updatedAt = this.getLocalStructureTimestamp(capId) || Date.now();
        const cap = this.capsules().find(c => c.id === capId);
        const autoAuthEnabled = (capId === this.activeCapsuleId() ? this.autoAuthEnabled() : cap?.autoAuthEnabled) || 'off';
        const autoAuthEndpointId = (capId === this.activeCapsuleId() ? this.autoAuthEndpointId() : cap?.autoAuthEndpointId) || null;

        const reqs = this.getCapsuleRequestsSync(capId);
        const requestMeta: Record<string, any> = {};
        for (const r of reqs) {
            if (!r?.id) continue;
            requestMeta[r.id] = {
                postTriggerTabId: r.postTriggerTabId || null,
                autoAuthEnabled: !!r.autoAuthEnabled,
                groupId: r.groupId || null,
                settings: r.settings,
                encryption: r.encryption,
                scripts: r.scripts ? {
                    preRequest: r.scripts.preRequest,
                    postResponse: r.scripts.postResponse,
                    testScript: r.scripts.testScript,
                    testScriptEnabled: r.scripts.testScriptEnabled
                } : undefined,
                bodyWrapStyle: r.bodyWrapStyle,
                responseWrapStyle: r.responseWrapStyle,
                responseActiveMode: r.responseActiveMode,
                consoleWrap: r.consoleWrap
            };
        }

        return {
            groups,
            groupOrder,
            order,
            updatedAt,
            autoAuthEnabled,
            autoAuthEndpointId,
            requestMeta
        };
    }

    applyBackendCapsuleGroups(capId: string, payload: {
        groups?: RequestGroup[];
        groupOrder?: string[];
        order?: string[];
        updatedAt?: number;
        autoAuthEnabled?: string;
        autoAuthEndpointId?: string | null;
        requestMeta?: Record<string, any>;
    }): void {
        if (!capId || this.deletingCapsuleIds.has(capId) || !payload || typeof payload !== 'object') return;

        const localTs = this.getLocalStructureTimestamp(capId);
        const remoteTs = Number(payload.updatedAt || 0);
        const hasLocalData = this.getGroupsForCapsule(capId).length > 0 || this.getRequestOrderForCapsule(capId).length > 0;
        if (localTs > 0 && localTs > remoteTs && hasLocalData) {
            this.syncGroupAssignmentsToRequests(capId);
            this.scheduleGroupsVariableSync(capId);
            return;
        }

        const reqToGroup = new Map<string, string>();
        if (Array.isArray(payload.groups)) {
            const normalizedGroups: RequestGroup[] = payload.groups
                .filter(g => !g?.id || !this.deletedGroupIds.has(g.id))
                .map(g => ({
                    id: g.id || ('grp_' + this.createId()),
                    name: g.name || 'Folder',
                    capsuleId: capId,
                    isExpanded: g.isExpanded ?? true,
                    requestIds: Array.isArray(g.requestIds)
                        ? g.requestIds.filter(rId => !this.deletedRequestIds.has(rId))
                        : [],
                    createdAt: g.createdAt || Date.now()
                }));
            if (Array.isArray(payload.groupOrder) && payload.groupOrder.length > 0) {
                const grpOrderIdx = new Map<string, number>();
                payload.groupOrder.forEach((id, idx) => grpOrderIdx.set(id, idx));
                normalizedGroups.sort((a, b) => {
                    const ia = grpOrderIdx.has(a.id) ? grpOrderIdx.get(a.id)! : 999999;
                    const ib = grpOrderIdx.has(b.id) ? grpOrderIdx.get(b.id)! : 999999;
                    return ia - ib;
                });
            }
            this.setGroupsForCapsule(capId, normalizedGroups, false);

            for (const g of normalizedGroups) {
                for (const rId of g.requestIds) {
                    reqToGroup.set(rId, g.id);
                }
            }
        }

        const reqMetaMap = (payload.requestMeta && typeof payload.requestMeta === 'object') ? payload.requestMeta : null;
        if (Array.isArray(payload.groups) || reqMetaMap) {
            const applyMetaToRequest = (st: RequestState): RequestState => {
                const targetGId = Array.isArray(payload.groups)
                    ? (reqToGroup.get(st.id) ?? null)
                    : (st.groupId ?? null);
                const meta = reqMetaMap ? reqMetaMap[st.id] : null;
                return {
                    ...st,
                    groupId: targetGId,
                    ...(meta ? {
                        postTriggerTabId: st.postTriggerTabId ?? meta.postTriggerTabId ?? null,
                        autoAuthEnabled: st.autoAuthEnabled ?? meta.autoAuthEnabled ?? false,
                        settings: meta.settings ? { ...st.settings, ...meta.settings } : st.settings,
                        encryption: meta.encryption ? { ...st.encryption, ...meta.encryption } : st.encryption,
                        scripts: meta.scripts ? { ...st.scripts, ...meta.scripts } : st.scripts,
                        bodyWrapStyle: st.bodyWrapStyle || meta.bodyWrapStyle,
                        responseWrapStyle: st.responseWrapStyle || meta.responseWrapStyle,
                        responseActiveMode: st.responseActiveMode || meta.responseActiveMode,
                        consoleWrap: st.consoleWrap ?? meta.consoleWrap
                    } : {})
                };
            };

            this.states.update(map => {
                let changed = false;
                const next = new Map(map);
                for (const [rId, st] of next.entries()) {
                    if (st.capsuleId === capId || (!st.capsuleId && capId === '1')) {
                        next.set(rId, applyMetaToRequest(st));
                        changed = true;
                    }
                }
                return changed ? next : map;
            });
            this.savedCapsules.update(col => col.map(r => {
                if (r.capsuleId === capId || (!r.capsuleId && capId === '1')) {
                    return applyMetaToRequest(r);
                }
                return r;
            }));
        }

        if (payload.autoAuthEnabled !== undefined || payload.autoAuthEndpointId !== undefined) {
            this.capsules.update(list => list.map(c => {
                if (c.id !== capId) return c;
                return {
                    ...c,
                    autoAuthEnabled: (payload.autoAuthEnabled as any) || c.autoAuthEnabled || 'off',
                    autoAuthEndpointId: payload.autoAuthEndpointId !== undefined ? payload.autoAuthEndpointId : (c.autoAuthEndpointId ?? null)
                };
            }));
            if (capId === this.activeCapsuleId()) {
                if (payload.autoAuthEnabled) {
                    this.autoAuthEnabled.set(payload.autoAuthEnabled as any);
                }
                if (payload.autoAuthEndpointId !== undefined) {
                    this.autoAuthEndpointId.set(payload.autoAuthEndpointId);
                }
            }
        }

        if (Array.isArray(payload.order) && payload.order.length > 0) {
            const filteredOrder = payload.order.filter(
                id => !this.deletedGroupIds.has(id) && !this.deletedRequestIds.has(id)
            );
            this.capsuleRequestOrderMap.update(m => {
                const next = new Map(m);
                next.set(capId, filteredOrder);
                return next;
            });
            if (this.isBrowser) {
                try {
                    localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(filteredOrder));
                } catch {}
            }
        }
    }

    activeCapsuleGroups = computed<RequestGroup[]>(() => {
        const capId = this.activeCapsuleId();
        return this.capsuleGroupsMap().get(capId) || this.loadCapsuleGroupsFromStorage(capId) || [];
    });

    groupedCapsuleRequests = computed<{ group: RequestGroup; requests: RequestState[] }[]>(() => {
        const groups = this.activeCapsuleGroups();
        const all = this.allCapsuleRequests();
        const reqMap = new Map<string, RequestState>();
        for (const r of all) {
            reqMap.set(r.id, r);
        }
        const assignedIds = new Set<string>();

        return groups.map(group => {
            const requests: RequestState[] = [];
            for (const reqId of (group.requestIds || [])) {
                const req = reqMap.get(reqId);
                if (req && !assignedIds.has(reqId)) {
                    requests.push(req);
                    assignedIds.add(reqId);
                }
            }
            for (const req of all) {
                if (req.groupId === group.id && !assignedIds.has(req.id)) {
                    requests.push(req);
                    assignedIds.add(req.id);
                }
            }
            return { group, requests };
        });
    });

    ungroupedCapsuleRequests = computed<RequestState[]>(() => {
        const grouped = this.groupedCapsuleRequests();
        const assignedIds = new Set<string>();
        for (const item of grouped) {
            for (const r of item.requests) {
                assignedIds.add(r.id);
            }
        }
        return this.allCapsuleRequests().filter(r => !assignedIds.has(r.id));
    });

    sidebarRootItems = computed<SidebarRootItem[]>(() => {
        const capId = this.activeCapsuleId();
        const grouped = this.groupedCapsuleRequests();
        const ungrouped = this.ungroupedCapsuleRequests();

        const items: SidebarRootItem[] = [
            ...grouped.map(g => ({
                type: 'group' as const,
                id: g.group.id,
                group: g.group,
                requests: g.requests
            })),
            ...ungrouped.map(r => ({
                type: 'request' as const,
                id: r.id,
                request: r
            }))
        ];

        const order = this.capsuleRequestOrderMap().get(capId) || this.loadCapsuleRequestOrder(capId);
        if (order && order.length > 0 && order.some(id => id.startsWith('grp_'))) {
            const orderIndexMap = new Map<string, number>();
            order.forEach((id, idx) => orderIndexMap.set(id, idx));
            items.sort((a, b) => {
                const idxA = orderIndexMap.has(a.id) ? orderIndexMap.get(a.id)! : 999999;
                const idxB = orderIndexMap.has(b.id) ? orderIndexMap.get(b.id)! : 999999;
                return idxA - idxB;
            });
        }

        return items;
    });

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
        const all = Array.from(map.values());

        const order = this.capsuleRequestOrderMap().get(capId) || this.loadCapsuleRequestOrder(capId);
        if (order && order.length > 0) {
            const orderIndexMap = new Map<string, number>();
            order.forEach((id, idx) => orderIndexMap.set(id, idx));

            all.sort((a, b) => {
                const idxA = orderIndexMap.has(a.id) ? orderIndexMap.get(a.id)! : 999999;
                const idxB = orderIndexMap.has(b.id) ? orderIndexMap.get(b.id)! : 999999;
                return idxA - idxB;
            });
        }

        return all;
    });

    reorderCapsuleRequests(previousIndex: number, currentIndex: number) {
        const capId = this.activeCapsuleId();
        const currentList = this.allCapsuleRequests();
        if (
            previousIndex === currentIndex ||
            previousIndex < 0 || currentIndex < 0 ||
            previousIndex >= currentList.length || currentIndex >= currentList.length
        ) {
            return;
        }

        const nextIds = currentList.map(r => r.id);
        const [movedId] = nextIds.splice(previousIndex, 1);
        nextIds.splice(currentIndex, 0, movedId);

        this.capsuleRequestOrderMap.update(m => {
            const newMap = new Map(m);
            newMap.set(capId, nextIds);
            return newMap;
        });

        if (this.isBrowser) {
            localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(nextIds));
        }

        this.notifyStructureOrOrderChanged(capId, true);
    }

    createRequestGroup(name: string = 'New Folder', initialRequestIds: string[] = [], capsuleId?: string): RequestGroup {
        const capId = capsuleId || this.activeCapsuleId();
        const currentGroups = this.getGroupsForCapsule(capId);
        const uniqueReqIds = Array.from(new Set(initialRequestIds.filter(Boolean)));
        const initSet = new Set(uniqueReqIds);

        const newGroup: RequestGroup = {
            id: 'grp_' + this.createId(),
            name: (name || '').trim() || 'New Folder',
            capsuleId: capId,
            isExpanded: true,
            requestIds: uniqueReqIds,
            createdAt: Date.now()
        };

        const updatedGroups = [
            ...currentGroups.map(g => ({
                ...g,
                requestIds: (g.requestIds || []).filter(id => !initSet.has(id))
            })),
            newGroup
        ];

        if (initSet.size > 0) {
            const savedSet = new Set(this.savedCapsules().map(r => r.id));
            this.states.update(map => {
                const next = new Map(map);
                for (const rId of initSet) {
                    const st = next.get(rId);
                    if (st) {
                        const needsSave = !savedSet.has(rId) || st.isDirty;
                        next.set(rId, { ...st, groupId: newGroup.id, isDirty: needsSave });
                    }
                }
                return next;
            });
            this.savedCapsules.update(col => col.map(r => initSet.has(r.id) ? { ...r, groupId: newGroup.id } : r));
        }

        const existingOrder = this.getRequestOrderForCapsule(capId);
        if (existingOrder.length > 0 && existingOrder.some(id => id.startsWith('grp_'))) {
            const nextOrder = [...existingOrder];
            let insertIdx = -1;
            if (uniqueReqIds.length > 0) {
                for (const rId of uniqueReqIds) {
                    const idx = nextOrder.indexOf(rId);
                    if (idx !== -1 && (insertIdx === -1 || idx < insertIdx)) {
                        insertIdx = idx;
                    }
                }
            }
            if (insertIdx !== -1) {
                nextOrder.splice(insertIdx, 0, newGroup.id);
            } else {
                let lastGrpIdx = -1;
                nextOrder.forEach((id, i) => {
                    if (id.startsWith('grp_')) lastGrpIdx = i;
                });
                nextOrder.splice(lastGrpIdx + 1, 0, newGroup.id);
            }
            this.capsuleRequestOrderMap.update(m => new Map(m).set(capId, nextOrder));
            if (this.isBrowser) {
                localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(nextOrder));
            }
        }

        this.setGroupsForCapsule(capId, updatedGroups, true);
        return newGroup;
    }

    renameRequestGroup(groupId: string, newName: string, capsuleId?: string): void {
        const capId = capsuleId || this.activeCapsuleId();
        const trimmed = (newName || '').trim();
        if (!trimmed) return;

        const currentGroups = this.getGroupsForCapsule(capId);
        const updated = currentGroups.map(g => g.id === groupId ? { ...g, name: trimmed } : g);
        this.setGroupsForCapsule(capId, updated, true);
    }

    toggleGroupExpanded(groupId: string, capsuleId?: string): void {
        const capId = capsuleId || this.activeCapsuleId();
        const currentGroups = this.getGroupsForCapsule(capId);
        const updated = currentGroups.map(g => g.id === groupId ? { ...g, isExpanded: !(g.isExpanded ?? true) } : g);
        this.setGroupsForCapsule(capId, updated, true);
    }

    private serializeNonEmptyKvRows(rows?: KeyValue[]): { enabled: boolean; key: string; value: string }[] {
        return (rows || [])
            .filter(r => (r.key ?? '').trim() !== '' || (r.value ?? '').trim() !== '')
            .map(r => ({ enabled: r.enabled ?? true, key: r.key || '', value: r.value || '' }));
    }

    private serializeNonEmptyFormDataRows(rows?: FormDataRow[]): { enabled: boolean; key: string; value: string; type: string }[] {
        return (rows || [])
            .filter(r => (r.key ?? '').trim() !== '' || (r.value ?? '').trim() !== '')
            .map(r => ({ enabled: r.enabled ?? true, key: r.key || '', value: r.value || '', type: r.type || 'text' }));
    }

    private async clearRequestChildrenOnBackend(
        gid: string,
        fallbackDtoMap?: Map<string, RequestState>,
        fallbackCapsuleId?: string
    ): Promise<string | null> {
        // 1. Delete any request examples linked to this request
        try {
            const exRes = await firstValueFrom(
                this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/${gid}/example`)
            );
            const examples = Array.isArray(exRes?.data) ? exRes.data : [];
            if (examples.length > 0) {
                await Promise.allSettled(
                    examples
                        .filter(ex => ex?.id)
                        .map(ex => firstValueFrom(this.http.delete(`${API_BASE_URL}/request/example/${ex.id}`)).catch(() => {}))
                );
            }
        } catch {}

        // 2. Resolve request state (or minimal metadata) so /request/save can purge RequestParam/Header/FormData rows
        let baseState =
            this.states().get(gid) ||
            this.savedCapsules().find(r => r.id === gid) ||
            fallbackDtoMap?.get(gid) ||
            null;

        const preferredCapId =
            (baseState?.capsuleId && this.isValidGuid(baseState.capsuleId) ? baseState.capsuleId : null) ||
            (fallbackCapsuleId && this.isValidGuid(fallbackCapsuleId) ? fallbackCapsuleId : null) ||
            (this.isValidGuid(this.activeCapsuleId()) ? this.activeCapsuleId() : null);

        if (!baseState && preferredCapId) {
            try {
                const capReqs = await firstValueFrom(
                    this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/capsule/${preferredCapId}`)
                );
                const found = (capReqs?.data || []).find(r => r?.id === gid);
                if (found) {
                    baseState = this.mapDtoToState(found);
                }
            } catch {}
        }

        const effectiveCapId =
            (baseState?.capsuleId && this.isValidGuid(baseState.capsuleId) ? baseState.capsuleId : null) ||
            preferredCapId;
        if (!effectiveCapId) return null;

        const capName =
            this.capsules().find(c => c.id === effectiveCapId)?.name ||
            this.activeCapsuleName() ||
            'Capsule';

        const stateForClear: RequestState = {
            ...(baseState || this.getDefaultState(gid)),
            id: gid,
            capsuleId: effectiveCapId,
            params: [],
            headers: [],
            formData: [],
            postTriggerTabId: null,
            autoAuthEnabled: false
        };

        try {
            const saveRes = await firstValueFrom(
                this.http.post<{ data: any }>(`${API_BASE_URL}/request/save`, this.mapStateToSaveRequest(stateForClear, effectiveCapId, capName))
            );
            const savedId = saveRes?.data?.id;
            return savedId && savedId !== gid ? savedId : null;
        } catch {
            return null;
        }
    }

    private async deleteSingleRequestWithChildCleanup(
        gid: string,
        fallbackDtoMap?: Map<string, RequestState>,
        fallbackCapsuleId?: string
    ): Promise<void> {
        try {
            await firstValueFrom(
                this.http.delete(`${API_BASE_URL}/request/${gid}`)
            );
            return;
        } catch (err: any) {
            if (err?.status === 404) return;
            // Hosted SQL DBs with FK_RequestParam_Request without ON DELETE CASCADE fail 500 if RequestParam rows remain.
            // Strip params/headers/formData/examples first via /request/save and retry DELETE.
            const alternateSavedId = await this.clearRequestChildrenOnBackend(gid, fallbackDtoMap, fallbackCapsuleId);
            if (alternateSavedId && this.isValidGuid(alternateSavedId)) {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/request/${alternateSavedId}`)
                ).catch(() => {});
            }
            try {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/request/${gid}`)
                );
            } catch (retryErr: any) {
                if (retryErr?.status === 404) return;
                throw retryErr;
            }
        }
    }

    private async deleteRequestsOnBackendResilient(
        reqIds: string[],
        fallbackDtoMap?: Map<string, RequestState>,
        fallbackCapsuleId?: string
    ): Promise<void> {
        const guidIds = Array.from(new Set(reqIds.filter(id => this.isValidGuid(id))));
        if (!this.isBrowser || !this.authService.isLoggedIn() || guidIds.length === 0) return;

        try {
            await firstValueFrom(
                this.http.post(`${API_BASE_URL}/request/batch-delete`, { ids: guidIds })
            );
            return;
        } catch (batchErr: any) {
            if (batchErr?.status === 404) return;
            console.warn('Batch delete requests failed, attempting resilient individual delete fallback:', batchErr);
        }

        let firstRealError: any = null;
        for (const gid of guidIds) {
            try {
                await this.deleteSingleRequestWithChildCleanup(gid, fallbackDtoMap, fallbackCapsuleId);
            } catch (err: any) {
                if (err?.status !== 404 && !firstRealError) {
                    firstRealError = err;
                }
            }
        }
        if (firstRealError) {
            throw firstRealError;
        }
    }

    async deleteRequestGroup(groupId: string, deleteRequests: boolean = false, capsuleId?: string): Promise<void> {
        const capId = capsuleId || this.activeCapsuleId();
        if (deleteRequests) {
            await this.deleteRequestGroupsAndRequests([groupId], [], capId);
            return;
        }

        const currentGroups = this.getGroupsForCapsule(capId);
        const targetGroup = currentGroups.find(g => g.id === groupId);
        if (!targetGroup) return;

        const memberIds: string[] = [];
        const seen = new Set<string>();
        for (const rId of (targetGroup.requestIds || [])) {
            if (rId && !seen.has(rId)) {
                memberIds.push(rId);
                seen.add(rId);
            }
        }
        for (const r of this.allCapsuleRequests()) {
            if (r.groupId === groupId && !seen.has(r.id)) {
                memberIds.push(r.id);
                seen.add(r.id);
            }
        }

        const memberSet = new Set(memberIds);
        const remainingGroups = currentGroups.filter(g => g.id !== groupId);

        this.states.update(map => {
            const next = new Map(map);
            for (const rId of memberSet) {
                const st = next.get(rId);
                if (st) next.set(rId, { ...st, groupId: null });
            }
            return next;
        });
        this.savedCapsules.update(col => col.map(r => memberSet.has(r.id) ? { ...r, groupId: null } : r));

        // Replace the group placeholder in root order with its ungrouped requests in-place
        const existingOrder = this.getRequestOrderForCapsule(capId);
        if (existingOrder.length > 0) {
            const nextOrder: string[] = [];
            let inserted = false;
            for (const entryId of existingOrder) {
                if (entryId === groupId) {
                    nextOrder.push(...memberIds);
                    inserted = true;
                } else if (!memberSet.has(entryId)) {
                    nextOrder.push(entryId);
                }
            }
            if (!inserted) {
                nextOrder.push(...memberIds);
            }
            this.capsuleRequestOrderMap.update(m => new Map(m).set(capId, nextOrder));
            if (this.isBrowser) {
                try {
                    localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(nextOrder));
                } catch {}
            }
        }

        if (this.focusedSidebarItem()?.type === 'group' && this.focusedSidebarItem()?.id === groupId) {
            this.focusedSidebarItem.set(null);
        }

        this.setGroupsForCapsule(capId, remainingGroups, true);
    }

    /** Atomically delete marked group folder(s) and/or request(s) without popping requests outside folders first */
    async deleteRequestGroupsAndRequests(groupIds: string[], requestIds: string[] = [], capsuleId?: string): Promise<void> {
        const capId = capsuleId || this.activeCapsuleId();
        const groupIdSet = new Set((groupIds || []).filter(Boolean));
        const currentGroups = this.getGroupsForCapsule(capId);

        const rawReqIds = new Set<string>((requestIds || []).filter(Boolean));
        for (const g of currentGroups) {
            if (groupIdSet.has(g.id)) {
                for (const rId of (g.requestIds || [])) {
                    if (rId) rawReqIds.add(rId);
                }
            }
        }
        for (const r of this.savedCapsules()) {
            if (r.groupId && groupIdSet.has(r.groupId) && (r.capsuleId === capId || (!r.capsuleId && capId === '1'))) {
                rawReqIds.add(r.id);
            }
        }
        for (const s of this.states().values()) {
            if (s.groupId && groupIdSet.has(s.groupId) && (s.capsuleId === capId || (!s.capsuleId && capId === '1'))) {
                rawReqIds.add(s.id);
            }
        }

        const allReqIds = this.expandResolvedIds(Array.from(rawReqIds));
        if (groupIdSet.size === 0 && allReqIds.length === 0) return;

        const reqIdSet = new Set(allReqIds);

        // Cancel pending saves/syncs so in-flight autosave cannot race or resurrect deleted items
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = null;
        clearTimeout(this.groupsVarSyncTimeout);
        clearTimeout(this.workspaceStateSyncTimeout);
        this.hasPendingStructureSync = false;

        for (const gId of groupIdSet) this.deletedGroupIds.add(gId);
        for (const rId of reqIdSet) this.deletedRequestIds.add(rId);

        try {
            if (this.isBrowser && this.authService.isLoggedIn() && allReqIds.length > 0) {
                await this.deleteRequestsOnBackendResilient(allReqIds);
            }
        } catch (err) {
            // Rollback tombstones if backend delete aborted before removing locally
            for (const gId of groupIdSet) this.deletedGroupIds.delete(gId);
            for (const rId of reqIdSet) this.deletedRequestIds.delete(rId);
            throw err;
        }

        // Remove deleted requests BEFORE updating groups or snapshotting session
        this.savedCapsules.update(col => col.filter(r => !reqIdSet.has(r.id)));
        this.openTabIds.update(openIds => openIds.filter(tabId => !reqIdSet.has(tabId)));
        this.tabNavigationStack.update(stack => {
            const filtered = stack.filter(tabId => !reqIdSet.has(tabId));
            return filtered;
        });
        if (this.tabNavigationIndex() >= this.tabNavigationStack().length) {
            this.tabNavigationIndex.set(this.tabNavigationStack().length - 1);
        }

        this.states.update(map => {
            const next = new Map(map);
            for (const rId of reqIdSet) {
                next.delete(rId);
                this.historyStack.delete(rId);
                this.fetchedExamplesIds.delete(rId);
            }
            return next;
        });

        this.requestExamplesMap.update(m => {
            const next = new Map(m);
            for (const rId of reqIdSet) next.delete(rId);
            return next;
        });

        if (this.isBrowser) {
            try {
                const stored = localStorage.getItem('onsteroids_responses');
                if (stored) {
                    const map = JSON.parse(stored);
                    let changed = false;
                    for (const rId of reqIdSet) {
                        if (map[rId]) {
                            delete map[rId];
                            changed = true;
                        }
                    }
                    if (changed) {
                        localStorage.setItem('onsteroids_responses', JSON.stringify(map));
                    }
                }
            } catch {}
        }

        if (this.activeTabId() && reqIdSet.has(this.activeTabId()!)) {
            const remaining = this.openTabIds();
            this.activeTabId.set(remaining.length > 0 ? remaining[0] : null);
        }

        // Clean custom sidebar order for deleted groups & deleted requests
        const existingOrder = this.getRequestOrderForCapsule(capId);
        if (existingOrder.length > 0) {
            const cleanedOrder = existingOrder.filter(id => !groupIdSet.has(id) && !reqIdSet.has(id));
            this.capsuleRequestOrderMap.update(m => new Map(m).set(capId, cleanedOrder));
            if (this.isBrowser) {
                try {
                    localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(cleanedOrder));
                } catch {}
            }
        }

        // Remove deleted groups & strip deleted requestIds from any remaining groups (syncBackend = false so we flush cleanly right after)
        const updatedGroups = currentGroups
            .filter(g => !groupIdSet.has(g.id))
            .map(g => ({
                ...g,
                requestIds: (g.requestIds || []).filter(rId => !reqIdSet.has(rId))
            }));
        const curFocused = this.focusedSidebarItem();
        if (curFocused && ((curFocused.type === 'group' && groupIdSet.has(curFocused.id)) || (curFocused.type === 'request' && reqIdSet.has(curFocused.id)))) {
            this.focusedSidebarItem.set(null);
        }

        this.setGroupsForCapsule(capId, updatedGroups, false);

        if (capId) {
            this.markLocalStructureTimestamp(capId);
            if (this.isBrowser) {
                try {
                    localStorage.setItem(`onsteroids_open_tab_ids_${capId}`, JSON.stringify(this.openTabIds()));
                    localStorage.setItem(`onsteroids_active_tab_${capId}`, this.activeTabId() || '');
                } catch {}
            }
        }

        this.snapshotCurrentSession(undefined, false, true);

        const targetCap = this.capsules().find(c => c.id === capId);
        if (this.isBrowser && this.authService.isLoggedIn() && capId && !targetCap?.isLocalOnly) {
            const vs = this.getVariableService();
            if (vs && this.isValidGuid(capId)) {
                vs.syncVariablesToBackend(capId).catch(() => {});
            }
            this.syncWorkspaceStateToBackend(true);
        }
    }

    moveRequestsToGroup(requestIds: string[], targetGroupId: string | null, capsuleId?: string): void {
        const capId = capsuleId || this.activeCapsuleId();
        const moveSet = new Set(requestIds.filter(Boolean));
        if (moveSet.size === 0) return;

        const currentGroups = this.getGroupsForCapsule(capId);
        const updatedGroups = currentGroups.map(g => {
            const filtered = (g.requestIds || []).filter(id => !moveSet.has(id));
            if (targetGroupId && g.id === targetGroupId) {
                return {
                    ...g,
                    isExpanded: true,
                    requestIds: [...filtered, ...Array.from(moveSet)]
                };
            }
            return {
                ...g,
                requestIds: filtered
            };
        });

        const savedSetForMove = new Set(this.savedCapsules().map(r => r.id));
        this.states.update(map => {
            const next = new Map(map);
            for (const rId of moveSet) {
                const st = next.get(rId);
                if (st) {
                    const needsSave = !savedSetForMove.has(rId) || st.isDirty;
                    next.set(rId, { ...st, groupId: targetGroupId, isDirty: needsSave });
                }
            }
            return next;
        });
        this.savedCapsules.update(col => col.map(r => moveSet.has(r.id) ? { ...r, groupId: targetGroupId } : r));

        const curFocused = this.focusedSidebarItem();
        if (curFocused?.type === 'request' && moveSet.has(curFocused.id)) {
            this.focusedSidebarItem.set({ ...curFocused, groupId: targetGroupId });
        }

        this.setGroupsForCapsule(capId, updatedGroups, true);
    }

    reorderRequestGroups(previousIndex: number, currentIndex: number, capsuleId?: string): void {
        const capId = capsuleId || this.activeCapsuleId();
        const currentGroups = [...this.getGroupsForCapsule(capId)];
        if (
            previousIndex === currentIndex ||
            previousIndex < 0 ||
            currentIndex < 0 ||
            previousIndex >= currentGroups.length ||
            currentIndex >= currentGroups.length
        ) {
            return;
        }
        const [moved] = currentGroups.splice(previousIndex, 1);
        currentGroups.splice(currentIndex, 0, moved);
        this.setGroupsForCapsule(capId, currentGroups, true);
    }

    reorderSidebarRootItem(itemId: string, previousIndex: number, currentIndex: number, capsuleId?: string): void {
        const capId = capsuleId || this.activeCapsuleId();
        const rootItems = [...this.sidebarRootItems()];
        const fromIdx = itemId ? rootItems.findIndex(it => it.id === itemId) : previousIndex;
        const actualPrev = fromIdx !== -1 ? fromIdx : previousIndex;
        if (
            actualPrev === currentIndex ||
            actualPrev < 0 ||
            currentIndex < 0 ||
            actualPrev >= rootItems.length ||
            currentIndex >= rootItems.length
        ) {
            return;
        }

        const [moved] = rootItems.splice(actualPrev, 1);
        rootItems.splice(currentIndex, 0, moved);

        const currentGroups = this.getGroupsForCapsule(capId);
        const groupMap = new Map<string, RequestGroup>();
        for (const g of currentGroups) groupMap.set(g.id, g);

        const reorderedGroups: RequestGroup[] = [];
        for (const it of rootItems) {
            if (it.type === 'group') {
                const grp = groupMap.get(it.id);
                if (grp) reorderedGroups.push(grp);
            }
        }
        for (const g of currentGroups) {
            if (!reorderedGroups.some(rg => rg.id === g.id)) {
                reorderedGroups.push(g);
            }
        }

        const groupedReqIds = this.groupedCapsuleRequests().flatMap(gi => gi.requests.map(r => r.id));
        const rootOrderIds = rootItems.map(it => it.id);
        const nextOrder = [...rootOrderIds, ...groupedReqIds];

        this.capsuleRequestOrderMap.update(m => new Map(m).set(capId, nextOrder));
        if (this.isBrowser) {
            localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(nextOrder));
        }

        this.setGroupsForCapsule(capId, reorderedGroups, true);
        if (this.autoSaveEnabled() && this.authService.isLoggedIn()) {
            this.triggerAutoSave();
        }
    }

    handleRequestDrop(
        requestOrIds: string | string[],
        sourceGroupId: string | null,
        targetGroupId: string | null,
        previousIndex: number,
        currentIndex: number,
        capsuleId?: string
    ): void {
        const capId = capsuleId || this.activeCapsuleId();
        const movingIds = Array.from(
            new Set((Array.isArray(requestOrIds) ? requestOrIds : [requestOrIds]).filter(Boolean))
        );
        if (movingIds.length === 0) return;
        const moveSet = new Set(movingIds);

        const currentGroups = this.getGroupsForCapsule(capId);
        const groupedView = this.groupedCapsuleRequests();

        // Case 1: Dropping into a folder (reordering inside the same folder OR moving 1+ requests into targetGroupId)
        if (targetGroupId) {
            if (sourceGroupId === targetGroupId && movingIds.length === 1) {
                const singleId = movingIds[0];
                const groupEntry = groupedView.find(gi => gi.group.id === sourceGroupId);
                const listIds = groupEntry ? groupEntry.requests.map(r => r.id) : [];
                const fromIdx = listIds.indexOf(singleId);
                const actualPrev = fromIdx !== -1 ? fromIdx : previousIndex;
                if (actualPrev === currentIndex || actualPrev < 0 || currentIndex < 0 || actualPrev >= listIds.length) {
                    return;
                }
                const [moved] = listIds.splice(actualPrev, 1);
                listIds.splice(currentIndex, 0, moved);

                const updatedGroups = currentGroups.map(g => g.id === sourceGroupId ? { ...g, requestIds: listIds } : g);
                this.setGroupsForCapsule(capId, updatedGroups, true);
                return;
            }

            const updatedGroups = currentGroups.map(g => {
                const groupEntry = groupedView.find(gi => gi.group.id === g.id);
                const fullIds = groupEntry ? groupEntry.requests.map(r => r.id) : (g.requestIds || []);
                const baseIds = fullIds.filter(id => !moveSet.has(id));
                if (g.id === targetGroupId) {
                    const insertAt = Math.max(0, Math.min(currentIndex, baseIds.length));
                    baseIds.splice(insertAt, 0, ...movingIds);
                    return { ...g, isExpanded: true, requestIds: baseIds };
                }
                return { ...g, requestIds: baseIds };
            });

            const savedSetForDrop = new Set(this.savedCapsules().map(r => r.id));
            this.states.update(map => {
                const next = new Map(map);
                for (const rId of moveSet) {
                    const st = next.get(rId);
                    if (st) {
                        const needsSave = !savedSetForDrop.has(rId) || st.isDirty;
                        next.set(rId, { ...st, groupId: targetGroupId, isDirty: needsSave });
                    }
                }
                return next;
            });
            this.savedCapsules.update(col => col.map(r => moveSet.has(r.id) ? { ...r, groupId: targetGroupId } : r));

            this.setGroupsForCapsule(capId, updatedGroups, true);
            return;
        }

        // Case 2: Dropping into root list (targetGroupId === null)
        // Supports reordering ungrouped request(s) relative to folders & requests OR moving request(s) out of a folder into root
        const currentRootIds = this.sidebarRootItems().map(it => it.id);
        let nextRootIds: string[];

        if (!sourceGroupId && movingIds.length === 1) {
            const singleId = movingIds[0];
            nextRootIds = [...currentRootIds];
            const fromIdx = nextRootIds.indexOf(singleId);
            const actualPrev = fromIdx !== -1 ? fromIdx : previousIndex;
            if (actualPrev === currentIndex || actualPrev < 0 || currentIndex < 0 || actualPrev >= nextRootIds.length) {
                return;
            }
            const [moved] = nextRootIds.splice(actualPrev, 1);
            nextRootIds.splice(currentIndex, 0, moved);
        } else {
            nextRootIds = currentRootIds.filter(id => !moveSet.has(id));
            const insertAt = Math.max(0, Math.min(currentIndex, nextRootIds.length));
            nextRootIds.splice(insertAt, 0, ...movingIds);
        }

        const updatedGroups = currentGroups.map(g => {
            const groupEntry = groupedView.find(gi => gi.group.id === g.id);
            const baseIds = (groupEntry ? groupEntry.requests.map(r => r.id) : (g.requestIds || [])).filter(id => !moveSet.has(id));
            return { ...g, requestIds: baseIds };
        });

        const groupedIds = updatedGroups.flatMap(g => g.requestIds);
        const nextOrder = [...nextRootIds, ...groupedIds];

        this.states.update(map => {
            const next = new Map(map);
            for (const rId of moveSet) {
                const st = next.get(rId);
                if (st) next.set(rId, { ...st, groupId: null });
            }
            return next;
        });
        this.savedCapsules.update(col => col.map(r => moveSet.has(r.id) ? { ...r, groupId: null } : r));

        this.capsuleRequestOrderMap.update(m => {
            const next = new Map(m);
            next.set(capId, nextOrder);
            return next;
        });
        if (this.isBrowser) {
            localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(nextOrder));
        }

        this.setGroupsForCapsule(capId, updatedGroups, true);
    }

    getCapsuleRequestsSync(capsuleId: string): RequestState[] {
        if (!capsuleId || this.deletingCapsuleIds.has(capsuleId)) return [];

        const map = new Map<string, RequestState>();

        // 1. If it's the active capsule, include all live and open tab states
        if (capsuleId === this.activeCapsuleId()) {
            for (const r of this.allCapsuleRequests()) {
                map.set(r.id, r);
            }
        }

        // 2. Check savedCapsules
        for (const r of this.savedCapsules()) {
            if (r.capsuleId === capsuleId || (!r.capsuleId && capsuleId === '1')) {
                if (!map.has(r.id)) map.set(r.id, r);
            }
        }

        // 3. Check all states in memory
        for (const r of this.states().values()) {
            if (r.capsuleId === capsuleId || (!r.capsuleId && capsuleId === '1')) {
                if (!map.has(r.id)) map.set(r.id, r);
            }
        }

        // 4. Check cached localStorage session if available
        if (this.isBrowser) {
            try {
                const rawSession = localStorage.getItem('onsteroids_last_session');
                if (rawSession) {
                    const session = JSON.parse(rawSession);
                    if (session.states && Array.isArray(session.states)) {
                        for (const entry of session.states) {
                            const r = entry[1] || entry;
                            if (r && (r.capsuleId === capsuleId || (!r.capsuleId && capsuleId === '1'))) {
                                if (!map.has(r.id)) map.set(r.id, r);
                            }
                        }
                    }
                }
            } catch {}
        }

        return Array.from(map.values()).filter(r => !this.deletedRequestIds.has(r.id));
    }

    async getCapsuleRequests(capsuleId: string): Promise<RequestState[]> {
        const syncList = this.getCapsuleRequestsSync(capsuleId);
        if (syncList.length > 0) return syncList;

        // If not found in memory/cache and user is logged in, fetch from backend
        if (this.isBrowser && this.authService.isLoggedIn() && capsuleId && capsuleId !== '1') {
            try {
                const res = await firstValueFrom(
                    this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/capsule/${capsuleId}`)
                );
                if (res?.data && Array.isArray(res.data)) {
                    const mapped = res.data.map(dto => this.mapDtoToState({ ...dto, capsuleId }));
                    this.states.update(map => {
                        const next = new Map(map);
                        for (const mr of mapped) {
                            if (!next.has(mr.id)) next.set(mr.id, mr);
                        }
                        return next;
                    });
                    return mapped;
                }
            } catch (err) {
                console.error(`Failed to fetch requests for capsule ${capsuleId}`, err);
            }
        }

        return syncList;
    }

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
            if (this.authService.isLoggedIn() && this.openTabs().length === 0) {
                this.isCapsuleLoading.set(true);
            }
        }

        // 1. Lightweight tab & capsule metadata persisted immediately
        effect(() => {
            if (this.isBrowser) {
                const capId = this.activeCapsuleId();
                const isLoadingCap = this.isCapsuleLoading() || this.isLoadingBackendData();
                if (capId) {
                    localStorage.setItem('onsteroids_active_capsule', capId);
                    if (!isLoadingCap) {
                        localStorage.setItem(`onsteroids_active_tab_${capId}`, this.activeTabId() || '');
                        localStorage.setItem(`onsteroids_open_tab_ids_${capId}`, JSON.stringify(this.openTabIds()));
                    }
                }
                if (!isLoadingCap) {
                    localStorage.setItem('onsteroids_active_tab', this.activeTabId() || '');
                    localStorage.setItem('onsteroids_open_tab_ids', JSON.stringify(this.openTabIds()));
                }
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
                        const currentStates: [string, RequestState][] = Array.from(statesMap.entries()).map(([id, st]) => [
                            id,
                            st && st.isLoading ? { ...st, isLoading: false } : st
                        ]);
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

        this.authService.registerSaveChecker(() => this.isSaving() || this.isAutoSaving());

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

        const savedAllGroups = localStorage.getItem('onsteroids_all_capsule_groups');
        if (savedAllGroups) {
            try {
                const parsed = JSON.parse(savedAllGroups);
                if (parsed && typeof parsed === 'object') {
                    const gMap = new Map<string, RequestGroup[]>();
                    for (const [cId, grps] of Object.entries(parsed)) {
                        if (Array.isArray(grps)) gMap.set(cId, grps as RequestGroup[]);
                    }
                    this.capsuleGroupsMap.set(gMap);
                }
            } catch {}
        }

        const savedStates = localStorage.getItem('onsteroids_states');
        if (savedStates) {
            try {
                const parsed = JSON.parse(savedStates);
                if (Array.isArray(parsed)) {
                    const cleanedStates: [string, RequestState][] = parsed.map(([id, state]: [string, any]) => [
                        id,
                        state ? { ...state, isLoading: false } : state
                    ]);
                    this.states.set(new Map(cleanedStates));
                }
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
        setTimeout(() => {
            this.getVariableService()?.reanchorVariableSources(this.activeCapsuleId());
        }, 0);
    }

    setActiveTab(id: string, isHistoryNavigation: boolean = false) {
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

        if (!isHistoryNavigation && !this.isNavigatingHistory) {
            const stack = this.tabNavigationStack();
            const idx = this.tabNavigationIndex();
            if (idx === -1 || stack[idx] !== id) {
                const newStack = stack.slice(0, idx + 1);
                newStack.push(id);
                this.tabNavigationStack.set(newStack);
                this.tabNavigationIndex.set(newStack.length - 1);
            }
        }

        this.syncActiveTabToBackend();
    }

    navigateBack(): string | null {
        const idx = this.tabNavigationIndex();
        if (idx > 0) {
            this.isNavigatingHistory = true;
            try {
                const nextIdx = idx - 1;
                this.tabNavigationIndex.set(nextIdx);
                const targetId = this.tabNavigationStack()[nextIdx];
                this.setActiveTab(targetId, true);
                return targetId;
            } finally {
                this.isNavigatingHistory = false;
            }
        }
        return null;
    }

    navigateForward(): string | null {
        const idx = this.tabNavigationIndex();
        const stack = this.tabNavigationStack();
        if (idx >= 0 && idx < stack.length - 1) {
            this.isNavigatingHistory = true;
            try {
                const nextIdx = idx + 1;
                this.tabNavigationIndex.set(nextIdx);
                const targetId = stack[nextIdx];
                this.setActiveTab(targetId, true);
                return targetId;
            } finally {
                this.isNavigatingHistory = false;
            }
        }
        return null;
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
        clearTimeout(this.groupsVarSyncTimeout);
        clearTimeout(this.autoSaveTimeout);
        this.deletingCapsuleIds.clear();
        this.deletedRequestIds.clear();
        this.deletedGroupIds.clear();
        this.checkedGroupCapsules.clear();
        this.inFlightGroupLoads.clear();
        this.idRedirects.clear();

        this.openTabIds.set([]);
        this.activeTabId.set(null);
        this.states.set(new Map());
        this.savedCapsules.set([]);
        this.capsuleGroupsMap.set(new Map());
        this.capsuleRequestOrderMap.set(new Map());
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
                const preservedKeys = new Set([
                    'onsteroids_sidebar_collapsed',
                    'onsteroids_workspace_sidebar_open',
                    'onsteroids_expanded_example_req',
                    'onsteroids_expanded_example_reqs',
                    'onsteroids_body_wrap_style',
                    'onsteroids_response_wrap_style',
                    'onsteroids_response_active_mode',
                    'onsteroids_console_wrap'
                ]);
                const keysToRemove: string[] = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key || preservedKeys.has(key) || key.startsWith('onsteroids_user_var_sources_') || key.startsWith('onsteroids_var_sources_')) {
                        continue;
                    }
                    if (
                        key.startsWith('onsteroids_') ||
                        key.startsWith('autoAuth') ||
                        key.startsWith('auth_') ||
                        key === 'request_history'
                    ) {
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

    createAndOpenNewTab(insertIndex?: number, groupId?: string | null): string {
        const newId = this.createId();
        const newState = this.getDefaultState(newId);

        let capId = this.activeCapsuleId();
        const focusedBeforeCreate = this.focusedSidebarItem();
        const targetGroupId =
            groupId !== undefined
                ? groupId
                : (capId ? this.resolveFocusedDirectoryGroupId(capId) : null);

        if (targetGroupId) {
            newState.groupId = targetGroupId;
        }

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

        const anchorReqId =
            groupId === undefined && focusedBeforeCreate?.type === 'request'
                ? focusedBeforeCreate.id
                : null;

        if (targetGroupId) {
            newState.isDirty = true;
            this.states.update(map => new Map(map).set(newId, { ...newState }));
            const currentGroups = this.getGroupsForCapsule(capId);
            const updatedGroups = currentGroups.map(g => {
                if (g.id !== targetGroupId) return g;
                const nextReqIds = [...(g.requestIds || [])];
                const anchorIdx = anchorReqId ? nextReqIds.indexOf(anchorReqId) : -1;
                if (anchorIdx !== -1) {
                    nextReqIds.splice(anchorIdx + 1, 0, newId);
                } else {
                    nextReqIds.push(newId);
                }
                return { ...g, isExpanded: true, requestIds: nextReqIds };
            });
            this.setGroupsForCapsule(capId, updatedGroups, true);
        } else if (anchorReqId) {
            const existingOrder = this.getRequestOrderForCapsule(capId);
            const anchorOrderIdx = existingOrder.indexOf(anchorReqId);
            if (anchorOrderIdx !== -1 && !existingOrder.includes(newId)) {
                const nextOrder = [...existingOrder];
                nextOrder.splice(anchorOrderIdx + 1, 0, newId);
                this.capsuleRequestOrderMap.update(m => new Map(m).set(capId, nextOrder));
                if (this.isBrowser) {
                    try {
                        localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(nextOrder));
                    } catch {}
                }
            }
        }

        this.focusedSidebarItem.set({
            type: 'request',
            id: newId,
            groupId: targetGroupId ?? null
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

        const prevCapId = this.activeCapsuleId();
        if (prevCapId === capsule.id && !this.isCapsuleLoading()) {
            return;
        }

        const switchVersion = ++this.capsuleSwitchVersion;

        // Cancel any pending autoSave timer immediately so it doesn't fire for the previous capsule
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
            this.autoSaveTimeout = null;
        }

        // Save current capsule's tab layout and variables before switching
        if (this.isBrowser && prevCapId && prevCapId !== capsule.id && !this.isCapsuleLoading() && !this.deletingCapsuleIds.has(prevCapId)) {
            localStorage.setItem(`onsteroids_open_tab_ids_${prevCapId}`, JSON.stringify(this.openTabIds()));
            localStorage.setItem(`onsteroids_active_tab_${prevCapId}`, this.activeTabId() || '');
            const vs = this.getVariableService();
            if (vs) {
                vs.saveVariables(false, prevCapId);
            }
        }

        this.isCapsuleLoading.set(true);

        try {
            this.activeCapsuleId.set(capsule.id);
            this.activeCapsuleName.set(capsule.name);
            // Clear savedCapsules and sidebar focus immediately to avoid stale state from previous capsule
            this.savedCapsules.set([]);
            this.focusedSidebarItem.set(null);

            // Read saved open tabs from local storage for this target capsule before clearing visible tabs
            let savedTargetOpenIds: string[] = [];
            const savedCapOpen = this.isBrowser ? localStorage.getItem(`onsteroids_open_tab_ids_${capsule.id}`) : null;
            if (savedCapOpen) {
                try {
                    const parsed = JSON.parse(savedCapOpen);
                    if (Array.isArray(parsed)) {
                        savedTargetOpenIds = parsed.filter((item): item is string => typeof item === 'string');
                    }
                } catch (e) { }
            }
            const savedActive = this.isBrowser ? localStorage.getItem(`onsteroids_active_tab_${capsule.id}`) : null;

            // Clear visible tabs while capsule is loading so the horizontal request tabs skeleton is shown cleanly
            this.openTabIds.set([]);
            this.activeTabId.set(null);

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

            // Load variables and requests for the target capsule in parallel
            const vs = this.getVariableService();
            await Promise.all([
                vs ? vs.loadVariables(capsule.id) : Promise.resolve(),
                this.loadRequestsForCapsule(capsule.id)
            ]);
            if (switchVersion !== this.capsuleSwitchVersion) return;

            if (vs) {
                vs.reanchorVariableSources(capsule.id);
            }

            this.syncGroupAssignmentsToRequests(capsule.id);
            const requestsInCapsule = this.savedCapsules();
            // Merge saved requests into states, preserving any active response data and groupId already in memory
            if (requestsInCapsule.length > 0) {
                this.states.update(map => {
                    const next = new Map(map);
                    for (const req of requestsInCapsule) {
                        const existing = next.get(req.id);
                        if (existing) {
                            next.set(req.id, {
                                ...req,
                                capsuleId: capsule.id,
                                groupId: req.groupId ?? existing.groupId ?? null,
                                isLoading: false,
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
            this.syncGroupAssignmentsToRequests(capsule.id);

            // If the user manually opened a tab while the capsule was loading, respect their selection
            const tabsOpenedDuringLoad = this.openTabIds();
            if (tabsOpenedDuringLoad.length > 0) {
                if (!this.activeTabId() || !tabsOpenedDuringLoad.includes(this.activeTabId()!)) {
                    this.activeTabId.set(tabsOpenedDuringLoad[0] || null);
                }
            } else {
                const validSavedOpenIds = savedTargetOpenIds.filter(id => {
                    const st = this.states().get(id);
                    return Boolean(st) && (!st!.capsuleId || st!.capsuleId === capsule.id);
                });

                let finalOpenIds: string[] = [];
                if (validSavedOpenIds.length > 0) {
                    finalOpenIds = validSavedOpenIds;
                } else if (requestsInCapsule.length > 0) {
                    finalOpenIds = requestsInCapsule.map(r => r.id);
                }

                this.openTabIds.set(finalOpenIds);
                if (savedActive && finalOpenIds.includes(savedActive)) {
                    this.activeTabId.set(savedActive);
                } else {
                    this.activeTabId.set(finalOpenIds[0] || null);
                }
            }

            if (this.isBrowser) {
                localStorage.setItem(`onsteroids_open_tab_ids_${capsule.id}`, JSON.stringify(this.openTabIds()));
                localStorage.setItem(`onsteroids_active_tab_${capsule.id}`, this.activeTabId() || '');
            }

            this.preloadAllExamples();

            if (switchVersion === this.capsuleSwitchVersion) {
                this.syncWorkspaceStateToBackend();
            }
        } finally {
            if (switchVersion === this.capsuleSwitchVersion) {
                this.isCapsuleLoading.set(false);
            }
        }
    }

    async createCapsule(name: string): Promise<Capsule> {
        const trimmed = name.trim() || 'New Capsule';
        let newCap: Capsule = {
            id: this.createId(),
            name: trimmed,
            createdAt: Date.now(),
            isLocalOnly: !this.authService.isLoggedIn()
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
                        createdAt: new Date(res.data.createdAt).getTime() || Date.now(),
                        isLocalOnly: false
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

        const currentCap = this.capsules().find(c => c.id === capId);
        if (this.isBrowser && this.authService.isLoggedIn() && capId !== '1' && capId.length >= 8 && !currentCap?.isLocalOnly) {
            firstValueFrom(
                this.http.put(`${API_BASE_URL}/capsule/${capId}`, {
                    name: currentCap?.name || this.activeCapsuleName(),
                    autoAuthEnabled: currentScope,
                    autoAuthEndpointId: currentEndpoint
                })
            ).catch(err => console.warn('Failed to persist capsule auto-auth settings to backend', err));
            this.syncWorkspaceStateToBackend();
            this.scheduleGroupsVariableSync(capId);
        }
    }

    async updateCapsuleName(id: string, newName: string): Promise<void> {
        const trimmed = newName.trim();
        if (!trimmed) return;

        this.capsules.update(list => list.map(c => c.id === id ? { ...c, name: trimmed } : c));
        
        const currentCap = this.capsules().find(c => c.id === id);
        if (this.isBrowser && this.authService.isLoggedIn() && !currentCap?.isLocalOnly) {
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
            createdAt: Date.now(),
            isLocalOnly: !this.authService.isLoggedIn()
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
                        createdAt: new Date(res.data.createdAt).getTime() || Date.now(),
                        isLocalOnly: false
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
        
        const clonedRequestsList: RequestState[] = [];
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
            
            clonedRequestsList.push(clonedReq);
        }

        // Second pass: remap postTriggerTabId across cloned requests
        for (const clonedReq of clonedRequestsList) {
            if (clonedReq.postTriggerTabId && idMap.has(clonedReq.postTriggerTabId)) {
                clonedReq.postTriggerTabId = idMap.get(clonedReq.postTriggerTabId)!;
            }
            newStates.set(clonedReq.id, clonedReq);
        }

        // Remap capsule-level autoAuthEnabled & autoAuthEndpointId
        const sourceAutoAuth = capsule.autoAuthEnabled || (capsule.id === this.activeCapsuleId() ? this.autoAuthEnabled() : 'off');
        const sourceEndpoint = capsule.autoAuthEndpointId ?? (capsule.id === this.activeCapsuleId() ? this.autoAuthEndpointId() : null);
        newCap.autoAuthEnabled = sourceAutoAuth;
        newCap.autoAuthEndpointId = sourceEndpoint ? (idMap.get(sourceEndpoint) || sourceEndpoint) : null;

        this.states.set(newStates);

        // Clone Request Groups for the duplicated capsule first so groupIdMap is available for order remapping
        const sourceGroups = this.getGroupsForCapsule(capsule.id);
        const groupIdMap = new Map<string, string>();
        if (sourceGroups.length > 0) {
            const clonedGroups: RequestGroup[] = sourceGroups.map(g => {
                const newGId = 'grp_' + this.createId();
                groupIdMap.set(g.id, newGId);
                return {
                    ...g,
                    id: newGId,
                    capsuleId: newCap.id,
                    requestIds: (g.requestIds || []).map(oldRId => idMap.get(oldRId)!).filter(Boolean)
                };
            });
            this.setGroupsForCapsule(newCap.id, clonedGroups, false);
            this.states.update(map => {
                const next = new Map(map);
                for (const [, newRId] of idMap.entries()) {
                    const st = next.get(newRId);
                    if (st && st.groupId && groupIdMap.has(st.groupId)) {
                        next.set(newRId, { ...st, groupId: groupIdMap.get(st.groupId)! });
                    }
                }
                return next;
            });
        }

        // Clone custom request & folder order
        const sourceOrder = this.getRequestOrderForCapsule(capsule.id);
        if (sourceOrder.length > 0) {
            const clonedOrder = sourceOrder
                .map(oldId => idMap.get(oldId) || groupIdMap.get(oldId)!)
                .filter(Boolean);
            this.capsuleRequestOrderMap.update(m => new Map(m).set(newCap.id, clonedOrder));
            if (this.isBrowser) {
                localStorage.setItem(`onsteroids_capsule_order_${newCap.id}`, JSON.stringify(clonedOrder));
            }
        }

        // Clone and remap variable sources to the newly cloned requests
        if (this.isBrowser) {
            const oldId = capsule.id;
            const newId = newCap.id;
            const u = this.authService.currentUser();
            const oldSources = localStorage.getItem(`onsteroids_var_sources_${oldId}`);
            if (oldSources) {
                try {
                    const parsed = JSON.parse(oldSources);
                    if (parsed && typeof parsed === 'object') {
                        for (const k of Object.keys(parsed)) {
                            const s = parsed[k];
                            if (s?.tabId && idMap.has(s.tabId)) s.tabId = idMap.get(s.tabId);
                            if (s?.requestId && idMap.has(s.requestId)) s.requestId = idMap.get(s.requestId);
                        }
                        const str = JSON.stringify(parsed);
                        localStorage.setItem(`onsteroids_var_sources_${newId}`, str);
                        if (u?.id) localStorage.setItem(`onsteroids_user_var_sources_${newId}_${u.id}`, str);
                    }
                } catch {}
            }
        }

        // Persist the newly cloned tab IDs for the target capsule before switching
        const clonedTabIds = oldRequests.map(r => idMap.get(r.id)!).filter(Boolean);
        if (this.isBrowser && clonedTabIds.length > 0) {
            localStorage.setItem(`onsteroids_open_tab_ids_${newCap.id}`, JSON.stringify(clonedTabIds));
            localStorage.setItem(`onsteroids_active_tab_${newCap.id}`, clonedTabIds[0]);
        }
        
        this.capsules.update(list => [...list, newCap]);
        await this.switchCapsule(newCap);

        if (this.isBrowser) {
            localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
        }
        
        return newCap;
    }

    private async deleteCapsuleOnBackendResilient(id: string): Promise<void> {
        if (!this.isBrowser || !this.authService.isLoggedIn() || !this.isValidGuid(id) || id === '1') {
            return;
        }

        const vs = this.getVariableService();
        // Clear capsule variables (including __capsule_groups__ and __var_sources__) before deleting the capsule
        // so hosted DBs with FK constraints or legacy spCapsule_Delete procedures do not throw 500.
        if (vs) {
            await vs.clearCapsuleVariablesOnBackend(id);
        }

        try {
            await firstValueFrom(
                this.http.delete(`${API_BASE_URL}/capsule/${id}`)
            );
            return;
        } catch (err: any) {
            if (err?.status === 404) return;
            console.warn(`Direct capsule delete failed for ${id}, attempting child cleanup retry:`, err);

            // Clear capsule autoAuthEndpointId first in case a DB FK blocks deleting referenced request or capsule
            const capObj = this.capsules().find(c => c.id === id);
            if (capObj?.autoAuthEndpointId) {
                await firstValueFrom(
                    this.http.put(`${API_BASE_URL}/capsule/${id}`, {
                        name: capObj.name || 'Capsule',
                        autoAuthEnabled: 'off',
                        autoAuthEndpointId: null
                    })
                ).catch(() => {});
            }

            // Collect all requests in the capsule (local + backend) and delete them first before retrying capsule delete
            const dtoMap = new Map<string, RequestState>();
            const reqIdSet = new Set<string>(
                this.getCapsuleRequestsSync(id).map(r => r.id).filter(rId => this.isValidGuid(rId))
            );
            try {
                const reqRes = await firstValueFrom(
                    this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/capsule/${id}`)
                );
                if (reqRes?.data && Array.isArray(reqRes.data)) {
                    for (const r of reqRes.data) {
                        if (r?.id && this.isValidGuid(r.id)) {
                            reqIdSet.add(r.id);
                            dtoMap.set(r.id, this.mapDtoToState(r));
                        }
                    }
                }
            } catch {}

            if (reqIdSet.size > 0) {
                await this.deleteRequestsOnBackendResilient(Array.from(reqIdSet), dtoMap, id).catch(() => {});
            }

            if (vs) {
                await vs.clearCapsuleVariablesOnBackend(id);
            }

            try {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/capsule/${id}`)
                );
            } catch (retryErr: any) {
                if (retryErr?.status === 404) return;
                throw retryErr;
            }
        }
    }

    private async finalizeDeletedCapsules(deletedIds: string[]): Promise<void> {
        const idSet = new Set(deletedIds);
        const vs = this.getVariableService();

        // Extract all request IDs and group IDs belonging to the deleted capsules
        const deletedReqIds = new Set<string>();
        const deletedGrpIds = new Set<string>();

        for (const r of this.savedCapsules()) {
            if (r.capsuleId && idSet.has(r.capsuleId)) {
                deletedReqIds.add(r.id);
            }
        }
        for (const [k, st] of this.states().entries()) {
            if (st.capsuleId && idSet.has(st.capsuleId)) {
                deletedReqIds.add(k);
                deletedReqIds.add(st.id);
            }
        }

        const currentGroupsMap = this.capsuleGroupsMap();
        for (const capId of idSet) {
            const grps = currentGroupsMap.get(capId) || this.loadCapsuleGroupsFromStorage(capId) || [];
            for (const g of grps) {
                if (g.id) deletedGrpIds.add(g.id);
                for (const rId of (g.requestIds || [])) {
                    if (rId) deletedReqIds.add(rId);
                }
            }
        }

        for (const rId of deletedReqIds) this.deletedRequestIds.add(rId);
        for (const gId of deletedGrpIds) this.deletedGroupIds.add(gId);

        const curFocused = this.focusedSidebarItem();
        if (curFocused && (
            (curFocused.type === 'group' && deletedGrpIds.has(curFocused.id)) ||
            (curFocused.type === 'request' && deletedReqIds.has(curFocused.id)) ||
            idSet.has(this.activeCapsuleId())
        )) {
            this.focusedSidebarItem.set(null);
        }

        // Extract and remove affected groups for deleted capsules, and strip any orphaned refs from remaining groups
        this.capsuleGroupsMap.update(map => {
            const next = new Map<string, RequestGroup[]>();
            for (const [cId, grps] of map.entries()) {
                if (idSet.has(cId)) continue;
                const cleaned = grps
                    .filter(g => !deletedGrpIds.has(g.id))
                    .map(g => ({
                        ...g,
                        requestIds: (g.requestIds || []).filter(rId => !deletedReqIds.has(rId))
                    }));
                next.set(cId, cleaned);
            }
            if (this.isBrowser) {
                try {
                    localStorage.setItem('onsteroids_all_capsule_groups', JSON.stringify(Object.fromEntries(next)));
                } catch {}
            }
            return next;
        });

        // Remove deleted capsules' custom request/folder orders and strip any orphaned request refs
        this.capsuleRequestOrderMap.update(map => {
            const next = new Map<string, string[]>();
            for (const [cId, ord] of map.entries()) {
                if (idSet.has(cId)) continue;
                next.set(cId, ord.filter(itemId => !deletedReqIds.has(itemId) && !deletedGrpIds.has(itemId)));
            }
            return next;
        });

        this.capsules.update(list => list.filter(c => !idSet.has(c.id)));
        this.savedCapsules.update(col => col.filter(r => !r.capsuleId || !idSet.has(r.capsuleId)));
        this.openTabIds.update(openIds => openIds.filter(tabId => !deletedReqIds.has(tabId)));
        this.tabNavigationStack.update(stack => stack.filter(tabId => !deletedReqIds.has(tabId)));
        if (this.tabNavigationIndex() >= this.tabNavigationStack().length) {
            this.tabNavigationIndex.set(this.tabNavigationStack().length - 1);
        }

        this.states.update(map => {
            const next = new Map(map);
            for (const [key, state] of next.entries()) {
                if ((state.capsuleId && idSet.has(state.capsuleId)) || deletedReqIds.has(key)) {
                    next.delete(key);
                    this.historyStack.delete(key);
                    this.fetchedExamplesIds.delete(key);
                }
            }
            return next;
        });

        this.requestExamplesMap.update(m => {
            const next = new Map(m);
            for (const rId of deletedReqIds) next.delete(rId);
            return next;
        });

        if (vs) {
            for (const capId of idSet) {
                vs.clearCapsuleLocalData(capId);
            }
        }

        if (this.isBrowser) {
            for (const capId of idSet) {
                localStorage.removeItem(`onsteroids_open_tab_ids_${capId}`);
                localStorage.removeItem(`onsteroids_active_tab_${capId}`);
                localStorage.removeItem(`onsteroids_capsule_groups_${capId}`);
                localStorage.removeItem(`onsteroids_capsule_order_${capId}`);
                localStorage.removeItem(`onsteroids_capsule_structure_ts_${capId}`);
            }
            try {
                const storedResp = localStorage.getItem('onsteroids_responses');
                if (storedResp) {
                    const parsed = JSON.parse(storedResp);
                    for (const rId of deletedReqIds) {
                        delete parsed[rId];
                    }
                    for (const capId of idSet) {
                        if (parsed['__capsule_groups_map__'] && typeof parsed['__capsule_groups_map__'] === 'object') {
                            delete parsed['__capsule_groups_map__'][capId];
                        }
                        if (parsed['__capsule_order_map__'] && typeof parsed['__capsule_order_map__'] === 'object') {
                            delete parsed['__capsule_order_map__'][capId];
                        }
                        if (parsed['__capsule_structure_ts_map__'] && typeof parsed['__capsule_structure_ts_map__'] === 'object') {
                            delete parsed['__capsule_structure_ts_map__'][capId];
                        }
                    }
                    localStorage.setItem('onsteroids_responses', JSON.stringify(parsed));
                }
            } catch {}
            localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
        }

        if (this.activeCapsuleId() && idSet.has(this.activeCapsuleId())) {
            const remaining = this.capsules();
            if (remaining.length > 0) {
                await this.switchCapsule(remaining[0]);
                this.snapshotCurrentSession(undefined, false, true);
                if (this.authService.isLoggedIn()) {
                    await this.syncWorkspaceStateToBackend(true, true);
                }
            } else {
                this.activeCapsuleId.set('');
                this.activeCapsuleName.set('');
                this.savedCapsules.set([]);
                this.states.set(new Map());
                this.openTabIds.set([]);
                this.activeTabId.set(null);
                if (vs) {
                    vs.setVariables([], '', false);
                }
                if (this.isBrowser) {
                    localStorage.removeItem('onsteroids_active_capsule');
                    localStorage.removeItem('onsteroids_active_tab');
                    localStorage.removeItem('onsteroids_open_tab_ids');
                    localStorage.removeItem('onsteroids_states');
                    localStorage.removeItem('onsteroids_last_session');
                    const user = this.authService.currentUser();
                    if (user?.id) localStorage.removeItem(`onsteroids_user_session_${user.id}`);
                    if (user?.email) localStorage.removeItem(`onsteroids_user_session_${user.email}`);
                }
                if (this.authService.isLoggedIn()) {
                    await this.syncWorkspaceStateToBackend(true, true);
                }
            }
        } else {
            this.snapshotCurrentSession(undefined, false, true);
            if (this.authService.isLoggedIn()) {
                await this.syncWorkspaceStateToBackend(true, true);
            }
        }
    }

    async deleteCapsule(id: string): Promise<void> {
        if (!id) return;

        clearTimeout(this.groupsVarSyncTimeout);
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = null;
        clearTimeout(this.workspaceStateSyncTimeout);
        clearTimeout(this.backendSyncTimeout);
        clearTimeout(this.activeTabSyncTimeout);
        this.hasPendingStructureSync = false;

        this.deletingCapsuleIds.add(id);
        const vs = this.getVariableService();
        if (vs) {
            await vs.waitForActiveSync();
        }

        const currentCap = this.capsules().find(c => c.id === id);
        if (this.isBrowser && this.authService.isLoggedIn() && !currentCap?.isLocalOnly && id !== '1' && this.isValidGuid(id)) {
            try {
                await this.deleteCapsuleOnBackendResilient(id);
            } catch (err) {
                this.deletingCapsuleIds.delete(id);
                console.error('Failed to delete capsule on backend', err);
                throw err;
            }
        }

        await this.finalizeDeletedCapsules([id]);
    }

    buildCurlFromState(
        state: RequestState,
        options: Pick<CurlBuildOptions, 'resolveVariables' | 'multiline' | 'includeInsecureFlag'> = {}
    ): string {
        const vs = this.getVariableService();
        const aas = this.getAutoAuthService();
        const cachedToken = aas && aas.isAutoAuthEnabled(state.id) ? aas.getCachedToken() : null;
        return buildCurlCommand(state, {
            resolveVariables: options.resolveVariables ?? true,
            multiline: options.multiline ?? true,
            includeInsecureFlag: options.includeInsecureFlag ?? false,
            resolveText: vs ? (s: string) => vs.resolve(s) : (s: string) => s,
            resolveJson: vs ? (s: string) => vs.resolveJson(s) : (s: string) => s,
            autoAuthToken: cachedToken
        });
    }

    buildCurlForRequest(
        requestId: string,
        options: Pick<CurlBuildOptions, 'resolveVariables' | 'multiline' | 'includeInsecureFlag'> = {}
    ): string {
        const resolvedId = this.resolveTabId(requestId);
        const state = this.states().get(resolvedId) || this.savedCapsules().find(r => r.id === resolvedId);
        if (!state) return '';
        return this.buildCurlFromState(state, options);
    }

    async copyRequestAsCurl(
        requestId: string,
        options: Pick<CurlBuildOptions, 'resolveVariables' | 'multiline' | 'includeInsecureFlag'> = {}
    ): Promise<boolean> {
        const cmd = this.buildCurlForRequest(requestId, options);
        if (!cmd) return false;
        const ok = await copyTextToClipboard(cmd);
        if (ok) {
            this.notificationService.notify('cURL command copied to clipboard!', 'success');
        } else {
            this.notificationService.notify('Failed to copy cURL command.', 'error');
        }
        return ok;
    }

    async loadGroupsForCapsule(capsuleId: string, forceRefresh = false): Promise<RequestGroup[]> {
        if (!capsuleId) return [];
        const existing = this.getGroupsForCapsule(capsuleId);
        if (!forceRefresh && (existing.length > 0 || this.checkedGroupCapsules.has(capsuleId))) {
            return existing;
        }

        const inFlight = this.inFlightGroupLoads.get(capsuleId);
        if (inFlight) return inFlight;

        const loadPromise = (async () => {
            const targetCap = this.capsules().find(c => c.id === capsuleId);
            const vs = this.getVariableService();
            if (
                this.isBrowser &&
                this.authService.isLoggedIn() &&
                vs &&
                this.isValidGuid(capsuleId) &&
                !targetCap?.isLocalOnly
            ) {
                try {
                    await vs.loadVariablesFromBackend(false, capsuleId);
                } catch {}
            }
            this.checkedGroupCapsules.add(capsuleId);
            return this.getGroupsForCapsule(capsuleId);
        })();

        this.inFlightGroupLoads.set(capsuleId, loadPromise);
        try {
            return await loadPromise;
        } finally {
            if (this.inFlightGroupLoads.get(capsuleId) === loadPromise) {
                this.inFlightGroupLoads.delete(capsuleId);
            }
        }
    }

    async transferRequestsToCapsule(
        requestIds: string[],
        targetCapsuleId: string,
        mode: 'copy' | 'move',
        targetGroupId: string | null = null
    ): Promise<{ transferredCount: number; targetCapsuleId: string; targetCapsuleName: string; savedIds: string[] }> {
        const sourceCapId = this.activeCapsuleId();
        const uniqueInputIds = Array.from(new Set((requestIds || []).map(id => this.resolveTabId(id)).filter(Boolean)));
        if (uniqueInputIds.length === 0) {
            throw new Error('No requests selected to transfer.');
        }

        const sourceRequests: RequestState[] = [];
        for (const rId of uniqueInputIds) {
            const st = this.states().get(rId) || this.savedCapsules().find(r => r.id === rId);
            if (st) sourceRequests.push(structuredClone(st));
        }
        if (sourceRequests.length === 0) {
            throw new Error('Could not find the selected request(s).');
        }

        let targetCap = this.capsules().find(c => c.id === targetCapsuleId);
        if (!targetCap) {
            throw new Error('Destination capsule was not found.');
        }

        let effectiveTargetCapId = targetCap.id;
        if (effectiveTargetCapId === sourceCapId) {
            throw new Error('Destination capsule must be different from the current capsule.');
        }

        const vs = this.getVariableService();
        if (vs) {
            await vs.waitForActiveSync();
        }

        const isOnline = this.isBrowser && this.authService.isLoggedIn();

        if (isOnline) {
            targetCap = await this.ensureCapsuleOnBackend(targetCap);
            effectiveTargetCapId = targetCap.id;
        }

        const targetIsBackend = isOnline && !targetCap.isLocalOnly && this.isValidGuid(effectiveTargetCapId);

        // Hydrate destination capsule variables + __capsule_groups__ beforehand so syncing groups never clobbers target vars
        if (targetIsBackend && vs) {
            await vs.loadVariablesFromBackend(false, effectiveTargetCapId).catch(() => {});
        }

        const savedIds: string[] = [];
        const createdStates: RequestState[] = [];

        for (const src of sourceRequests) {
            const newId = this.createId();
            const cloned: RequestState = {
                ...structuredClone(src),
                id: newId,
                capsuleId: effectiveTargetCapId,
                groupId: targetGroupId ?? null,
                postTriggerTabId: null,
                isDirty: true,
                isLoading: false
            };

            // Gather source examples (local cache or backend) so they move/copy alongside the request
            let examplesToCopy = [...(this.requestExamplesMap().get(src.id) || this.getLocalExamples(src.id))];
            if (examplesToCopy.length === 0 && isOnline && this.isValidGuid(src.id)) {
                try {
                    const exRes = await firstValueFrom(
                        this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/${src.id}/example`)
                    );
                    if (Array.isArray(exRes?.data)) {
                        examplesToCopy = exRes.data;
                    }
                } catch {}
            }

            let finalId = newId;
            if (targetIsBackend) {
                const payload = this.mapStateToSaveRequest(cloned, effectiveTargetCapId, targetCap.name);
                const saveRes = await firstValueFrom(
                    this.http.post<{ data: any }>(`${API_BASE_URL}/request/save`, payload)
                );
                if (saveRes?.data?.id) {
                    finalId = saveRes.data.id;
                }
                cloned.id = finalId;
                cloned.isDirty = false;

                if (examplesToCopy.length > 0 && this.isValidGuid(finalId)) {
                    const savedExamples: any[] = [];
                    for (const ex of examplesToCopy) {
                        try {
                            const exRes = await firstValueFrom(
                                this.http.post<{ data: any }>(`${API_BASE_URL}/request/${finalId}/example`, {
                                    name: ex.name || 'Example',
                                    requestSnapshot: typeof ex.requestSnapshot === 'string'
                                        ? ex.requestSnapshot
                                        : JSON.stringify(ex.requestSnapshot || {})
                                })
                            );
                            savedExamples.push(exRes?.data || { ...ex, id: this.createId(), requestId: finalId });
                        } catch {
                            savedExamples.push({ ...ex, id: this.createId(), requestId: finalId });
                        }
                    }
                    this.saveLocalExamples(finalId, savedExamples);
                }
            } else if (examplesToCopy.length > 0) {
                const clonedExamples = examplesToCopy.map(ex => ({ ...ex, id: this.createId(), requestId: finalId }));
                this.saveLocalExamples(finalId, clonedExamples);
            }

            // Copy cached response preview if present
            if (this.isBrowser) {
                try {
                    const stored = localStorage.getItem('onsteroids_responses');
                    if (stored) {
                        const respMap = JSON.parse(stored);
                        if (respMap[src.id]) {
                            respMap[finalId] = structuredClone(respMap[src.id]);
                            localStorage.setItem('onsteroids_responses', JSON.stringify(respMap));
                        }
                    }
                } catch {}
            }

            savedIds.push(finalId);
            createdStates.push(cloned);
        }

        // Register transferred requests in memory & target capsule caches
        this.states.update(map => {
            const next = new Map(map);
            for (const st of createdStates) {
                next.set(st.id, st);
            }
            return next;
        });

        if (this.isBrowser) {
            try {
                const targetOpenKey = `onsteroids_open_tab_ids_${effectiveTargetCapId}`;
                const rawOpen = localStorage.getItem(targetOpenKey);
                if (rawOpen) {
                    const parsed = JSON.parse(rawOpen);
                    if (Array.isArray(parsed)) {
                        const updatedOpen = [...parsed];
                        for (const sId of savedIds) {
                            if (!updatedOpen.includes(sId)) updatedOpen.push(sId);
                        }
                        localStorage.setItem(targetOpenKey, JSON.stringify(updatedOpen));
                    }
                }
            } catch {}
        }

        // Update destination folder assignment or custom root order
        if (targetGroupId) {
            const targetGroups = this.getGroupsForCapsule(effectiveTargetCapId);
            const updatedTargetGroups = targetGroups.map(g => {
                if (g.id !== targetGroupId) return g;
                const merged = [...(g.requestIds || [])];
                for (const sId of savedIds) {
                    if (!merged.includes(sId)) merged.push(sId);
                }
                return { ...g, isExpanded: true, requestIds: merged };
            });
            this.setGroupsForCapsule(effectiveTargetCapId, updatedTargetGroups, false);
            this.markLocalStructureTimestamp(effectiveTargetCapId);
            if (targetIsBackend && vs) {
                await vs.syncVariablesToBackend(effectiveTargetCapId).catch(() => {});
            }
        } else {
            const targetOrder = this.getRequestOrderForCapsule(effectiveTargetCapId);
            if (targetOrder.length > 0) {
                const nextOrder = [...targetOrder];
                for (const sId of savedIds) {
                    if (!nextOrder.includes(sId)) nextOrder.push(sId);
                }
                this.capsuleRequestOrderMap.update(m => new Map(m).set(effectiveTargetCapId, nextOrder));
                if (this.isBrowser) {
                    try {
                        localStorage.setItem(`onsteroids_capsule_order_${effectiveTargetCapId}`, JSON.stringify(nextOrder));
                    } catch {}
                }
            }
        }

        // If moving, safely delete originals AFTER destination requests succeeded
        if (mode === 'move') {
            await this.deleteRequestGroupsAndRequests([], sourceRequests.map(r => r.id), sourceCapId);
        } else {
            this.snapshotCurrentSession(undefined, false, true);
        }

        return {
            transferredCount: createdStates.length,
            targetCapsuleId: effectiveTargetCapId,
            targetCapsuleName: targetCap.name,
            savedIds
        };
    }

    async batchDeleteCapsules(ids: string[]): Promise<void> {
        if (!ids || ids.length === 0) return;

        clearTimeout(this.groupsVarSyncTimeout);
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = null;
        clearTimeout(this.workspaceStateSyncTimeout);
        clearTimeout(this.backendSyncTimeout);
        clearTimeout(this.activeTabSyncTimeout);
        this.hasPendingStructureSync = false;

        for (const id of ids) this.deletingCapsuleIds.add(id);
        const vs = this.getVariableService();
        if (vs) {
            await vs.waitForActiveSync();
        }

        const backendIds = ids.filter(id => {
            const cap = this.capsules().find(c => c.id === id);
            return !cap?.isLocalOnly && id !== '1' && this.isValidGuid(id);
        });

        if (this.isBrowser && this.authService.isLoggedIn() && backendIds.length > 0) {
            if (vs) {
                await Promise.allSettled(backendIds.map(bId => vs.clearCapsuleVariablesOnBackend(bId)));
            }

            try {
                await firstValueFrom(
                    this.http.post(`${API_BASE_URL}/capsule/batch-delete`, { ids: backendIds })
                );
            } catch (batchErr: any) {
                if (batchErr?.status !== 404) {
                    console.warn('Batch capsule delete failed, falling back to resilient per-capsule delete:', batchErr);
                    const succeededIds: string[] = [];
                    let firstErr: any = null;
                    for (const bId of backendIds) {
                        try {
                            await this.deleteCapsuleOnBackendResilient(bId);
                            succeededIds.push(bId);
                        } catch (err) {
                            this.deletingCapsuleIds.delete(bId);
                            if (!firstErr) firstErr = err;
                        }
                    }
                    if (firstErr) {
                        if (succeededIds.length > 0) {
                            await this.finalizeDeletedCapsules(succeededIds);
                        }
                        console.error('Failed to batch delete capsules on backend', firstErr);
                        throw firstErr;
                    }
                }
            }
        }

        await this.finalizeDeletedCapsules(ids);
    }

    async deleteRequest(id: string): Promise<void> {
        if (!id) return;
        await this.deleteRequestGroupsAndRequests([], [id]);
    }

    async batchDeleteRequests(ids: string[]): Promise<void> {
        if (!ids || ids.length === 0) return;
        await this.deleteRequestGroupsAndRequests([], ids);
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

    getFullCapsuleExportDataSync(capsuleId: string): {
        id: string;
        name: string;
        autoAuthEnabled: string;
        autoAuthEndpointId: string | null;
        requests: RequestState[];
        groups: RequestGroup[];
        groupOrder: string[];
        requestOrder: string[];
        variables: IGlobalVariable[];
        variableSources: Record<string, any>;
    } {
        const cap = this.capsules().find(c => c.id === capsuleId);
        const name = cap?.name || (capsuleId === this.activeCapsuleId() ? this.activeCapsuleName() : 'Capsule');
        const autoAuthEnabled = (capsuleId === this.activeCapsuleId() ? this.autoAuthEnabled() : cap?.autoAuthEnabled) || 'off';
        const autoAuthEndpointId = (capsuleId === this.activeCapsuleId() ? this.autoAuthEndpointId() : cap?.autoAuthEndpointId) || null;
        const requests = this.getCapsuleRequestsSync(capsuleId);
        const groups = this.getGroupsForCapsule(capsuleId);
        const groupOrder = groups.map(g => g.id);
        const requestOrder = this.getRequestOrderForCapsule(capsuleId);

        const vs = this.getVariableService();
        const varSources = vs ? vs.getSourceMapForCapsule(capsuleId) : {};
        const rawVars = vs
            ? (capsuleId === this.activeCapsuleId() ? vs.variables() : vs.getCachedVariablesForCapsule(capsuleId))
            : [];
        const variables = rawVars.map(v => {
            const kLower = (v.key || '').trim().toLowerCase();
            return {
                ...v,
                source: v.source ?? varSources[kLower]
            };
        });

        return {
            id: capsuleId,
            name,
            autoAuthEnabled,
            autoAuthEndpointId,
            requests,
            groups,
            groupOrder,
            requestOrder,
            variables,
            variableSources: varSources
        };
    }

    async getFullCapsuleExportData(capsuleId: string): Promise<{
        id: string;
        name: string;
        autoAuthEnabled: string;
        autoAuthEndpointId: string | null;
        requests: RequestState[];
        groups: RequestGroup[];
        groupOrder: string[];
        requestOrder: string[];
        variables: IGlobalVariable[];
        variableSources: Record<string, any>;
    }> {
        const requests = await this.getCapsuleRequests(capsuleId);
        const vs = this.getVariableService();
        const isGuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(capsuleId);

        // If exporting a non-active capsule while logged in and its variables/groups aren't cached yet, fetch from backend
        if (this.isBrowser && this.authService.isLoggedIn() && isGuid && capsuleId !== this.activeCapsuleId()) {
            const cachedVars = vs ? vs.getCachedVariablesForCapsule(capsuleId) : [];
            const cachedGroups = this.getGroupsForCapsule(capsuleId);
            if (cachedVars.length === 0 && cachedGroups.length === 0) {
                try {
                    const res = await firstValueFrom(
                        this.http.get<{ data: any[] }>(`${API_BASE_URL}/Variable?capsuleId=${capsuleId}`)
                    );
                    if (res?.data && Array.isArray(res.data)) {
                        const sysGroupsEntry = res.data.find(v => (v.variableKey || v.key || '').trim() === '__capsule_groups__');
                        const rawGroupsVal = sysGroupsEntry?.variableValue ?? sysGroupsEntry?.value;
                        if (rawGroupsVal && typeof rawGroupsVal === 'string') {
                            try {
                                this.applyBackendCapsuleGroups(capsuleId, JSON.parse(rawGroupsVal));
                            } catch {}
                        }
                        const sysSourceEntry = res.data.find(v => (v.variableKey || v.key || '').trim() === '__var_sources__');
                        const rawSourceVal = sysSourceEntry?.variableValue ?? sysSourceEntry?.value;
                        if (rawSourceVal && typeof rawSourceVal === 'string' && vs) {
                            try {
                                const parsedSources = JSON.parse(rawSourceVal);
                                if (parsedSources && typeof parsedSources === 'object') {
                                    vs.saveSourceMapForCapsule(capsuleId, { ...parsedSources, ...vs.getSourceMapForCapsule(capsuleId) });
                                }
                            } catch {}
                        }
                    }
                } catch {}
            }
        }

        const syncData = this.getFullCapsuleExportDataSync(capsuleId);
        return {
            ...syncData,
            requests: requests.length > 0 ? requests : syncData.requests
        };
    }

    async shareCapsule(capsuleId: string): Promise<string> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) {
            throw new Error('Please sign in to share this capsule.');
        }

        // Flush capsule variables, __capsule_groups__, and __var_sources__ to backend before generating share snapshot
        const vs = this.getVariableService();
        if (vs) {
            try {
                await vs.syncVariablesToBackend(capsuleId);
            } catch {}
        }

        const res = await firstValueFrom(
            this.http.post<{ data: { shareToken: string; shareUrl: string } }>(
                `${API_BASE_URL}/capsule/${capsuleId}/share`,
                {}
            )
        );

        if (res?.data) {
            const baseUrl = getAppBaseUrl();
            const isFile = typeof window !== 'undefined' && (window.location.protocol === 'file:' || window.location.origin.startsWith('file:'));
            const hasHash = isFile || (typeof window !== 'undefined' && window.location.hash && window.location.hash.startsWith('#/'));
            return `${baseUrl}${hasHash ? '/#/' : '/'}import?share=${res.data.shareToken}`;
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
            params: this.serializeNonEmptyKvRows(state.params),
            headers: this.serializeNonEmptyKvRows(state.headers),
            formData: this.serializeNonEmptyFormDataRows(state.formData)
        };
    }

    private async ensureCapsuleOnBackend(targetCap: Capsule): Promise<Capsule> {
        if (!this.isBrowser || !this.authService.isLoggedIn()) return targetCap;
        const oldId = targetCap.id;
        if (!targetCap.isLocalOnly && oldId !== '1' && this.isValidGuid(oldId)) {
            return targetCap;
        }

        const createPayload: any = {
            name: targetCap.name,
            autoAuthEnabled: targetCap.autoAuthEnabled || 'off',
            autoAuthEndpointId: null
        };
        if (this.isValidGuid(oldId) && oldId !== '1') {
            createPayload.id = oldId;
        }

        const capRes = await firstValueFrom(
            this.http.post<{ data: any }>(`${API_BASE_URL}/capsule`, createPayload)
        );
        const promotedId = capRes?.data?.id || oldId;
        const promoted: Capsule = {
            ...targetCap,
            id: promotedId,
            isLocalOnly: false
        };

        this.capsules.update(list => list.map(c => c.id === oldId ? promoted : c));
        if (this.activeCapsuleId() === oldId) {
            this.activeCapsuleId.set(promotedId);
            if (this.isBrowser) {
                localStorage.setItem('onsteroids_active_capsule', promotedId);
            }
        }

        if (oldId !== promotedId) {
            this.states.update(map => {
                const next = new Map(map);
                for (const [k, st] of next.entries()) {
                    if (st.capsuleId === oldId) next.set(k, { ...st, capsuleId: promotedId });
                }
                return next;
            });
            this.savedCapsules.update(col => col.map(r => r.capsuleId === oldId ? { ...r, capsuleId: promotedId } : r));
            const oldGroups = this.getGroupsForCapsule(oldId);
            if (oldGroups.length > 0) {
                this.setGroupsForCapsule(
                    promotedId,
                    oldGroups.map(g => ({ ...g, capsuleId: promotedId })),
                    false
                );
            }
            const oldOrder = this.getRequestOrderForCapsule(oldId);
            if (oldOrder.length > 0) {
                this.capsuleRequestOrderMap.update(m => new Map(m).set(promotedId, oldOrder));
                if (this.isBrowser) {
                    try {
                        localStorage.setItem(`onsteroids_capsule_order_${promotedId}`, JSON.stringify(oldOrder));
                    } catch {}
                }
            }
        }
        return promoted;
    }

    private async importIntoExistingCapsule(
        targetCapInput: Capsule,
        data: {
            capsules: {
                id?: string;
                name: string;
                autoAuthEnabled?: string;
                autoAuthEndpointId?: string | null;
                requests: RequestState[];
                groups?: RequestGroup[];
                requestOrder?: string[];
                variables?: IGlobalVariable[];
                variableSources?: Record<string, any>;
            }[];
            variables?: IGlobalVariable[];
        },
        shouldSaveToBackend: boolean
    ): Promise<{ capsulesCount: number; requestsCount: number }> {
        const vs = this.getVariableService();
        if (vs) {
            await vs.waitForActiveSync();
        }

        const isOnline = this.isBrowser && this.authService.isLoggedIn();
        let targetCap = (shouldSaveToBackend && isOnline)
            ? await this.ensureCapsuleOnBackend(targetCapInput)
            : targetCapInput;
        const targetCapId = targetCap.id;
        const canPersistBackend = shouldSaveToBackend && isOnline && !targetCap.isLocalOnly && this.isValidGuid(targetCapId);

        if (canPersistBackend && vs && targetCapId !== this.activeCapsuleId()) {
            await vs.loadVariablesFromBackend(false, targetCapId).catch(() => {});
        }

        const existingGroups = [...this.getGroupsForCapsule(targetCapId)];
        const existingOrder = [...this.getRequestOrderForCapsule(targetCapId)];
        const mergedGroups: RequestGroup[] = [...existingGroups];
        const addedRootOrderIds: string[] = [];
        const allNewRequests: RequestState[] = [];
        const mergedVarMap = new Map<string, IGlobalVariable>();

        const existingVars = vs
            ? (targetCapId === this.activeCapsuleId() ? vs.variables() : vs.getCachedVariablesForCapsule(targetCapId))
            : [];
        for (const ev of existingVars) {
            const kLower = (ev.key || '').trim().toLowerCase();
            if (kLower) mergedVarMap.set(kLower, { ...ev });
        }
        const mergedVarSources: Record<string, any> = vs ? { ...vs.getSourceMapForCapsule(targetCapId) } : {};

        for (const capInput of data.capsules) {
            const reqIdMap = new Map<string, string>();
            const stagedRequests: RequestState[] = [];

            for (const rawReq of (capInput.requests || [])) {
                const newId = this.createId();
                if (rawReq.id) reqIdMap.set(rawReq.id, newId);
                const cloned: RequestState = {
                    ...structuredClone(rawReq),
                    id: newId,
                    capsuleId: targetCapId,
                    isDirty: !canPersistBackend,
                    isLoading: false
                };
                stagedRequests.push(cloned);
            }

            // Remap postTriggerTabId using local reqIdMap first
            for (const sr of stagedRequests) {
                if (sr.postTriggerTabId) {
                    sr.postTriggerTabId = reqIdMap.get(sr.postTriggerTabId) || sr.postTriggerTabId;
                }
            }

            let finalRequests: RequestState[] = stagedRequests;
            if (canPersistBackend && stagedRequests.length > 0) {
                const savedList: RequestState[] = [];
                for (let idx = 0; idx < stagedRequests.length; idx++) {
                    const sr = stagedRequests[idx];
                    const origOldId = capInput.requests[idx]?.id;
                    const payload = this.mapStateToSaveRequest(sr, targetCapId, targetCap.name);
                    const res = await firstValueFrom(
                        this.http.post<{ data: any }>(`${API_BASE_URL}/request/save`, payload)
                    );
                    const savedDto = res?.data;
                    const mapped = savedDto ? this.mapDtoToState({ ...savedDto, capsuleId: targetCapId }) : sr;
                    if (origOldId) reqIdMap.set(origOldId, mapped.id);
                    reqIdMap.set(sr.id, mapped.id);

                    mapped.capsuleId = targetCapId;
                    mapped.groupId = sr.groupId ?? null;
                    mapped.autoAuthEnabled = sr.autoAuthEnabled;
                    mapped.postTriggerTabId = sr.postTriggerTabId ?? mapped.postTriggerTabId ?? null;
                    if (sr.settings) mapped.settings = { ...mapped.settings, ...sr.settings };
                    if (sr.encryption) mapped.encryption = { ...mapped.encryption, ...sr.encryption };
                    if (sr.scripts) mapped.scripts = { ...mapped.scripts, ...sr.scripts };
                    if (sr.bodyWrapStyle) mapped.bodyWrapStyle = sr.bodyWrapStyle;
                    if (sr.responseWrapStyle) mapped.responseWrapStyle = sr.responseWrapStyle;
                    if (sr.responseActiveMode) mapped.responseActiveMode = sr.responseActiveMode;
                    if (sr.consoleWrap !== undefined) mapped.consoleWrap = sr.consoleWrap;
                    mapped.isDirty = false;
                    savedList.push(mapped);
                }

                // Second pass if postTriggerTabId changed after server ID assignment
                const triggerFixPromises: Promise<any>[] = [];
                for (const mr of savedList) {
                    if (mr.postTriggerTabId) {
                        const remapped = reqIdMap.get(mr.postTriggerTabId) || mr.postTriggerTabId;
                        if (remapped !== mr.postTriggerTabId) {
                            mr.postTriggerTabId = remapped;
                            triggerFixPromises.push(
                                firstValueFrom(
                                    this.http.post(`${API_BASE_URL}/request/save`, this.mapStateToSaveRequest(mr, targetCapId, targetCap.name))
                                ).catch(() => {})
                            );
                        }
                    }
                }
                if (triggerFixPromises.length > 0) {
                    await Promise.allSettled(triggerFixPromises);
                }
                finalRequests = savedList;
            }

            // Remap groups (folders) and assign requests into them
            const newGroupsMap = new Map<string, RequestGroup>();
            if (Array.isArray(capInput.groups) && capInput.groups.length > 0) {
                for (const g of capInput.groups) {
                    const newGId = 'grp_' + this.createId();
                    if (g.id) reqIdMap.set(g.id, newGId);
                    const mappedGroup: RequestGroup = {
                        id: newGId,
                        name: g.name || 'Folder',
                        capsuleId: targetCapId,
                        isExpanded: g.isExpanded ?? true,
                        requestIds: (g.requestIds || []).map(oldId => reqIdMap.get(oldId) || oldId),
                        createdAt: Date.now()
                    };
                    mergedGroups.push(mappedGroup);
                    newGroupsMap.set(newGId, mappedGroup);
                }

                const reqToNewGroup = new Map<string, string>();
                for (const ng of newGroupsMap.values()) {
                    for (const rId of ng.requestIds) reqToNewGroup.set(rId, ng.id);
                }
                for (const fr of finalRequests) {
                    const mappedGId = reqToNewGroup.get(fr.id) || (fr.groupId ? reqIdMap.get(fr.groupId) : undefined);
                    fr.groupId = mappedGId ?? null;
                }
            } else {
                for (const fr of finalRequests) {
                    fr.groupId = null;
                }
            }

            if (Array.isArray(capInput.requestOrder) && capInput.requestOrder.length > 0) {
                for (const oldEntryId of capInput.requestOrder) {
                    const remappedEntryId = reqIdMap.get(oldEntryId) || oldEntryId;
                    if (!addedRootOrderIds.includes(remappedEntryId)) {
                        addedRootOrderIds.push(remappedEntryId);
                    }
                }
            } else {
                for (const ng of newGroupsMap.values()) {
                    addedRootOrderIds.push(ng.id);
                }
                for (const fr of finalRequests) {
                    if (!fr.groupId) addedRootOrderIds.push(fr.id);
                }
            }

            // Merge variables and remapped variableSources cleanly into destination capsule
            if (capInput.variableSources && typeof capInput.variableSources === 'object') {
                for (const [k, src] of Object.entries(capInput.variableSources)) {
                    if (src && typeof src === 'object') {
                        const clonedSrc = { ...src, capsuleId: targetCapId };
                        if (clonedSrc.tabId) clonedSrc.tabId = reqIdMap.get(clonedSrc.tabId) || clonedSrc.tabId;
                        if (clonedSrc.requestId) clonedSrc.requestId = reqIdMap.get(clonedSrc.requestId) || clonedSrc.requestId;
                        mergedVarSources[k.toLowerCase()] = clonedSrc;
                    }
                }
            }

            for (const iv of (capInput.variables || data.variables || [])) {
                const keyTrimmed = (iv.key || '').trim();
                const kLower = keyTrimmed.toLowerCase();
                if (!kLower || keyTrimmed.startsWith('__')) continue;
                let remappedSrc = iv.source ? { ...iv.source, capsuleId: targetCapId } : mergedVarSources[kLower];
                if (remappedSrc) {
                    if (remappedSrc.tabId) remappedSrc.tabId = reqIdMap.get(remappedSrc.tabId) || remappedSrc.tabId;
                    if (remappedSrc.requestId) remappedSrc.requestId = reqIdMap.get(remappedSrc.requestId) || remappedSrc.requestId;
                    mergedVarSources[kLower] = remappedSrc;
                }
                if (!mergedVarMap.has(kLower)) {
                    mergedVarMap.set(kLower, {
                        ...iv,
                        id: iv.id && iv.id.length > 8 ? iv.id : this.createId(),
                        ...(remappedSrc ? { source: remappedSrc } : {})
                    });
                }
            }

            allNewRequests.push(...finalRequests);
        }

        // Apply merged state into memory
        this.states.update(map => {
            const next = new Map(map);
            for (const req of allNewRequests) {
                next.set(req.id, req);
            }
            return next;
        });

        this.setGroupsForCapsule(targetCapId, mergedGroups, false);
        this.markLocalStructureTimestamp(targetCapId);

        if (existingOrder.length > 0 && addedRootOrderIds.length > 0) {
            const nextOrder = [...existingOrder];
            for (const entryId of addedRootOrderIds) {
                if (!nextOrder.includes(entryId)) nextOrder.push(entryId);
            }
            this.capsuleRequestOrderMap.update(m => new Map(m).set(targetCapId, nextOrder));
            if (this.isBrowser) {
                try {
                    localStorage.setItem(`onsteroids_capsule_order_${targetCapId}`, JSON.stringify(nextOrder));
                } catch {}
            }
        }

        const mergedVars = Array.from(mergedVarMap.values());
        if (vs) {
            if (Object.keys(mergedVarSources).length > 0) {
                vs.saveSourceMapForCapsule(targetCapId, mergedVarSources);
            }
            if (targetCapId === this.activeCapsuleId()) {
                vs.setVariables(mergedVars, targetCapId, false);
                vs.reanchorVariableSources(targetCapId);
            } else if (this.isBrowser && mergedVars.length > 0) {
                localStorage.setItem(`onsteroids_vars_${targetCapId}`, JSON.stringify(mergedVars));
            }
            if (canPersistBackend) {
                await vs.syncVariablesToBackend(targetCapId).catch(() => {});
            }
        }

        if (targetCapId === this.activeCapsuleId()) {
            const existingSavedIds = new Set(this.savedCapsules().map(r => r.id));
            const additions = allNewRequests.filter(r => !existingSavedIds.has(r.id));
            if (additions.length > 0) {
                this.savedCapsules.update(col => [...col, ...additions]);
            }

            const newIds = allNewRequests.map(r => r.id);
            if (newIds.length > 0) {
                this.openTabIds.update(ids => {
                    const next = [...ids];
                    for (const nId of newIds) {
                        if (!next.includes(nId)) next.push(nId);
                    }
                    return next;
                });
                this.activeTabId.set(newIds[0]);
                if (this.isBrowser) {
                    localStorage.setItem(`onsteroids_open_tab_ids_${targetCapId}`, JSON.stringify(this.openTabIds()));
                    localStorage.setItem(`onsteroids_active_tab_${targetCapId}`, newIds[0]);
                    localStorage.setItem('onsteroids_open_tab_ids', JSON.stringify(this.openTabIds()));
                    localStorage.setItem('onsteroids_active_tab', newIds[0]);
                }
            }
        } else {
            await this.switchCapsule({ id: targetCapId, name: targetCap.name });
            if (allNewRequests.length > 0) {
                this.openTabIds.update(ids => {
                    const next = [...ids];
                    for (const r of allNewRequests) {
                        if (!next.includes(r.id)) next.push(r.id);
                    }
                    return next;
                });
                this.activeTabId.set(allNewRequests[0].id);
            }
        }

        this.snapshotCurrentSession(undefined, false, true);
        if (canPersistBackend) {
            this.syncWorkspaceStateToBackend(true);
        }

        return {
            capsulesCount: 1,
            requestsCount: allNewRequests.length
        };
    }

    async importData(data: {
        capsules: {
            id?: string;
            name: string;
            autoAuthEnabled?: string;
            autoAuthEndpointId?: string | null;
            requests: RequestState[];
            groups?: RequestGroup[];
            requestOrder?: string[];
            variables?: IGlobalVariable[];
            variableSources?: Record<string, any>;
        }[];
        variables?: IGlobalVariable[];
    }, options?: { saveToBackend?: boolean; targetCapsuleId?: string | null }): Promise<{ capsulesCount: number; requestsCount: number }> {
        if (!data || !data.capsules || data.capsules.length === 0) {
            return { capsulesCount: 0, requestsCount: 0 };
        }

        const shouldSaveToBackend = options?.saveToBackend !== undefined
            ? options.saveToBackend
            : (this.isBrowser && this.authService.isLoggedIn());

        if (options?.targetCapsuleId) {
            const targetCap = this.capsules().find(c => c.id === options.targetCapsuleId);
            if (targetCap) {
                return this.importIntoExistingCapsule(targetCap, data, shouldSaveToBackend);
            }
        }

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

                    const reqIdMap = new Map<string, string>();
                    const mappedRequests: RequestState[] = reqsData.map((r, rIdx) => {
                        const st = this.mapDtoToState(r);
                        st.capsuleId = newCap.id;
                        st.isDirty = false;
                        const inputReq = capInput?.requests?.[rIdx];
                        if (inputReq?.id) {
                            reqIdMap.set(inputReq.id, st.id);
                        }
                        return st;
                    });

                    // Second pass: preserve all inputReq settings, encryption, scripts, autoAuth, and remap postTriggerTabId
                    const triggerUpdatePromises: Promise<any>[] = [];
                    mappedRequests.forEach((mr, rIdx) => {
                        const inputReq = capInput?.requests?.[rIdx];
                        if (!inputReq) return;
                        mr.autoAuthEnabled = inputReq.autoAuthEnabled ?? mr.autoAuthEnabled;
                        const rawTrigger = inputReq.postTriggerTabId || mr.postTriggerTabId || null;
                        const remappedTrigger = rawTrigger ? (reqIdMap.get(rawTrigger) || rawTrigger) : null;
                        const triggerChanged = mr.postTriggerTabId !== remappedTrigger;
                        mr.postTriggerTabId = remappedTrigger;

                        if (inputReq.settings) mr.settings = { ...mr.settings, ...inputReq.settings };
                        if (inputReq.encryption) mr.encryption = { ...mr.encryption, ...inputReq.encryption };
                        if (inputReq.scripts) mr.scripts = { ...mr.scripts, ...inputReq.scripts };
                        if (inputReq.bodyWrapStyle) mr.bodyWrapStyle = inputReq.bodyWrapStyle;
                        if (inputReq.responseWrapStyle) mr.responseWrapStyle = inputReq.responseWrapStyle;
                        if (inputReq.responseActiveMode) mr.responseActiveMode = inputReq.responseActiveMode;
                        if (inputReq.consoleWrap !== undefined) mr.consoleWrap = inputReq.consoleWrap;

                        if (triggerChanged && remappedTrigger) {
                            const savePayload = this.mapStateToSaveRequest(mr, newCap.id, newCap.name);
                            triggerUpdatePromises.push(
                                firstValueFrom(this.http.post(`${API_BASE_URL}/request/save`, savePayload)).catch(() => {})
                            );
                        }
                    });

                    // Remap capsule-level autoAuthEnabled & autoAuthEndpointId
                    const resolvedCapAutoAuth = (capInput?.autoAuthEnabled as any) || capData.autoAuthEnabled || 'off';
                    const rawCapEndpoint = capInput?.autoAuthEndpointId || capData.autoAuthEndpointId || null;
                    const resolvedCapEndpoint = rawCapEndpoint ? (reqIdMap.get(rawCapEndpoint) || rawCapEndpoint) : null;
                    newCap.autoAuthEnabled = resolvedCapAutoAuth;
                    newCap.autoAuthEndpointId = resolvedCapEndpoint;
                    this.capsules.update(list => list.map(c => c.id === newCap.id ? newCap : c));

                    if (resolvedCapEndpoint !== capData.autoAuthEndpointId || resolvedCapAutoAuth !== (capData.autoAuthEnabled || 'off')) {
                        triggerUpdatePromises.push(
                            firstValueFrom(
                                this.http.put(`${API_BASE_URL}/capsule/${newCap.id}`, {
                                    name: newCap.name,
                                    autoAuthEnabled: resolvedCapAutoAuth,
                                    autoAuthEndpointId: resolvedCapEndpoint
                                })
                            ).catch(() => {})
                        );
                    }

                    if (triggerUpdatePromises.length > 0) {
                        await Promise.allSettled(triggerUpdatePromises);
                    }

                    // Remap and persist request groups (folders)
                    if (capInput?.groups && Array.isArray(capInput.groups) && capInput.groups.length > 0) {
                        const importedGroups: RequestGroup[] = capInput.groups.map(g => {
                            const newGId = 'grp_' + this.createId();
                            if (g.id) reqIdMap.set(g.id, newGId);
                            return {
                                id: newGId,
                                name: g.name || 'Folder',
                                capsuleId: newCap.id,
                                isExpanded: g.isExpanded ?? true,
                                requestIds: (g.requestIds || []).map(oldId => reqIdMap.get(oldId) || oldId),
                                createdAt: Date.now()
                            };
                        });
                        const reqToGroup = new Map<string, string>();
                        for (const ig of importedGroups) {
                            for (const rId of ig.requestIds) reqToGroup.set(rId, ig.id);
                        }
                        for (const mr of mappedRequests) {
                            mr.groupId = reqToGroup.get(mr.id) || null;
                        }
                        this.setGroupsForCapsule(newCap.id, importedGroups, false);
                    }

                    // Remap and persist custom request order
                    if (capInput?.requestOrder && Array.isArray(capInput.requestOrder) && capInput.requestOrder.length > 0) {
                        const remappedOrder = capInput.requestOrder.map(oldId => reqIdMap.get(oldId) || oldId);
                        this.capsuleRequestOrderMap.update(m => new Map(m).set(newCap.id, remappedOrder));
                        if (this.isBrowser) {
                            localStorage.setItem(`onsteroids_capsule_order_${newCap.id}`, JSON.stringify(remappedOrder));
                        }
                    }

                    this.states.update(map => {
                        const next = new Map(map);
                        for (const mr of mappedRequests) {
                            next.set(mr.id, mr);
                        }
                        return next;
                    });

                    // Remap variable sources (tabId / requestId) to newly created backend request IDs
                    const inputVars = capInput?.variables || data.variables || [];
                    const inputVarByKey = new Map<string, IGlobalVariable>();
                    const remappedVarSources: Record<string, any> = {};

                    if (capInput?.variableSources && typeof capInput.variableSources === 'object') {
                        for (const [k, src] of Object.entries(capInput.variableSources)) {
                            if (src && typeof src === 'object') {
                                const clonedSrc = { ...src, capsuleId: newCap.id };
                                if (clonedSrc.tabId) clonedSrc.tabId = reqIdMap.get(clonedSrc.tabId) || clonedSrc.tabId;
                                if (clonedSrc.requestId) clonedSrc.requestId = reqIdMap.get(clonedSrc.requestId) || clonedSrc.requestId;
                                remappedVarSources[k.toLowerCase()] = clonedSrc;
                            }
                        }
                    }

                    for (const iv of inputVars) {
                        const kLower = (iv.key || '').trim().toLowerCase();
                        if (!kLower) continue;
                        let remappedSrc = iv.source ? { ...iv.source, capsuleId: newCap.id } : remappedVarSources[kLower];
                        if (remappedSrc) {
                            if (remappedSrc.tabId) remappedSrc.tabId = reqIdMap.get(remappedSrc.tabId) || remappedSrc.tabId;
                            if (remappedSrc.requestId) remappedSrc.requestId = reqIdMap.get(remappedSrc.requestId) || remappedSrc.requestId;
                            remappedVarSources[kLower] = remappedSrc;
                        }
                        inputVarByKey.set(kLower, { ...iv, ...(remappedSrc ? { source: remappedSrc } : {}) });
                    }

                    const vsForImport = this.getVariableService();
                    if (vsForImport && Object.keys(remappedVarSources).length > 0) {
                        vsForImport.saveSourceMapForCapsule(newCap.id, remappedVarSources);
                    }

                    // Store variables for this capsule (preserving type, enabled, and remapped source)
                    const capVars: IGlobalVariable[] = (importedCap.variables && importedCap.variables.length > 0)
                        ? importedCap.variables
                            .filter((v: any) => !(v.variableKey || v.key || '').trim().startsWith('__'))
                            .map((v: any) => {
                                const k = (v.variableKey || v.key || '').trim();
                                const kLower = k.toLowerCase();
                                const matchedInput = inputVarByKey.get(kLower);
                                return {
                                    id: v.id ? String(v.id) : this.createId(),
                                    key: k,
                                    value: v.variableValue !== undefined ? v.variableValue : (v.value !== undefined ? v.value : (matchedInput?.value ?? '')),
                                    type: v.type || matchedInput?.type || 'global',
                                    enabled: v.isEnabled !== undefined ? v.isEnabled : (v.enabled !== undefined ? v.enabled : (matchedInput?.enabled ?? true)),
                                    ...(matchedInput?.source || remappedVarSources[kLower] ? { source: matchedInput?.source || remappedVarSources[kLower] } : {})
                                };
                            })
                        : Array.from(inputVarByKey.values());

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
                const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.id || '');
                const capId = isGuid ? c.id! : this.createId();
                const newCap: Capsule = {
                    id: capId,
                    name: c.name.trim() || 'Imported Capsule',
                    autoAuthEnabled: c.autoAuthEnabled || 'off',
                    autoAuthEndpointId: c.autoAuthEndpointId || null,
                    createdAt: Date.now(),
                    isLocalOnly: true
                };

                this.capsules.update(list => {
                    const exists = list.some(item => item.id === newCap.id);
                    return exists ? list.map(item => item.id === newCap.id ? newCap : item) : [...list, newCap];
                });

                const reqIdMap = new Map<string, string>();
                const reqs: RequestState[] = c.requests.map(r => {
                    const reqIsGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id || '');
                    const finalId = reqIsGuid ? r.id : this.createId();
                    if (r.id) reqIdMap.set(r.id, finalId);
                    return {
                        ...r,
                        id: finalId,
                        capsuleId: capId,
                        isDirty: false
                    };
                });

                // Second pass: remap postTriggerTabId & capsule autoAuthEndpointId
                for (const mr of reqs) {
                    if (mr.postTriggerTabId) {
                        mr.postTriggerTabId = reqIdMap.get(mr.postTriggerTabId) || mr.postTriggerTabId;
                    }
                }
                if (newCap.autoAuthEndpointId) {
                    newCap.autoAuthEndpointId = reqIdMap.get(newCap.autoAuthEndpointId) || newCap.autoAuthEndpointId;
                    this.capsules.update(list => list.map(item => item.id === newCap.id ? newCap : item));
                }

                if (c.groups && Array.isArray(c.groups) && c.groups.length > 0) {
                    const importedGroups: RequestGroup[] = c.groups.map(g => {
                        const newGId = 'grp_' + this.createId();
                        if (g.id) reqIdMap.set(g.id, newGId);
                        return {
                            id: newGId,
                            name: g.name || 'Folder',
                            capsuleId: capId,
                            isExpanded: g.isExpanded ?? true,
                            requestIds: (g.requestIds || []).map(oldId => reqIdMap.get(oldId) || oldId),
                            createdAt: Date.now()
                        };
                    });
                    const reqToGroup = new Map<string, string>();
                    for (const ig of importedGroups) {
                        for (const rId of ig.requestIds) reqToGroup.set(rId, ig.id);
                    }
                    for (const mr of reqs) {
                        mr.groupId = reqToGroup.get(mr.id) || null;
                    }
                    this.setGroupsForCapsule(capId, importedGroups, false);
                }

                if (c.requestOrder && Array.isArray(c.requestOrder) && c.requestOrder.length > 0) {
                    const remappedOrder = c.requestOrder.map(oldId => reqIdMap.get(oldId) || oldId);
                    this.capsuleRequestOrderMap.update(m => new Map(m).set(capId, remappedOrder));
                    if (this.isBrowser) {
                        localStorage.setItem(`onsteroids_capsule_order_${capId}`, JSON.stringify(remappedOrder));
                    }
                }

                this.states.update(map => {
                    const next = new Map(map);
                    for (const req of reqs) {
                        next.set(req.id, req);
                    }
                    return next;
                });

                const remappedLocalSources: Record<string, any> = {};
                if (c.variableSources && typeof c.variableSources === 'object') {
                    for (const [k, src] of Object.entries(c.variableSources)) {
                        if (src && typeof src === 'object') {
                            const clonedSrc = { ...src, capsuleId: capId };
                            if (clonedSrc.tabId) clonedSrc.tabId = reqIdMap.get(clonedSrc.tabId) || clonedSrc.tabId;
                            if (clonedSrc.requestId) clonedSrc.requestId = reqIdMap.get(clonedSrc.requestId) || clonedSrc.requestId;
                            remappedLocalSources[k.toLowerCase()] = clonedSrc;
                        }
                    }
                }

                const capVars = (c.variables || data.variables || []).map(v => {
                    const kLower = (v.key || '').trim().toLowerCase();
                    let src = v.source ? { ...v.source, capsuleId: capId } : remappedLocalSources[kLower];
                    if (src) {
                        if (src.tabId) src.tabId = reqIdMap.get(src.tabId) || src.tabId;
                        if (src.requestId) src.requestId = reqIdMap.get(src.requestId) || src.requestId;
                        remappedLocalSources[kLower] = src;
                    }
                    return { ...v, ...(src ? { source: src } : {}) };
                });

                const vsLocal = this.getVariableService();
                if (vsLocal && Object.keys(remappedLocalSources).length > 0) {
                    vsLocal.saveSourceMapForCapsule(capId, remappedLocalSources);
                }

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
                vs.setVariables(lastCreatedCapVars || [], lastCreatedCap.id, shouldSaveToBackend);
                if (shouldSaveToBackend && this.authService.isLoggedIn()) {
                    await vs.syncVariablesToBackend(lastCreatedCap.id);
                }
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

    async importCapsuleFromUrl(urlOrToken: string, targetCapsuleId?: string | null): Promise<{ capsuleName: string; requestsCount: number }> {
        let token = urlOrToken.trim();
        if (token.includes('share=')) {
            try {
                const parseableUrl = /^https?:\/\//i.test(token) ? token : `https://${token}`;
                const url = new URL(parseableUrl);
                let param = url.searchParams.get('share');
                if (!param && url.hash.includes('share=')) {
                    const hashIndex = url.hash.indexOf('?');
                    if (hashIndex !== -1) {
                        const hashSearch = url.hash.substring(hashIndex);
                        param = new URLSearchParams(hashSearch).get('share');
                    }
                }
                token = param || token;
            } catch {
                const match = token.match(/[?&]share=([^&#]+)/);
                if (match) token = decodeURIComponent(match[1]);
            }
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
        const capName = shared.name || shared.capsuleName || 'Imported Capsule';

        const sharedIdMap = new Map<string, string>();
        const oldIdByIndex: (string | undefined)[] = [];
        const requestsToSave: RequestState[] = [];
        if (shared.requests && Array.isArray(shared.requests)) {
            for (const r of shared.requests) {
                const newReqId = this.createId();
                if (r.id) sharedIdMap.set(r.id, newReqId);
                oldIdByIndex.push(r.id);
                const reqState = this.mapDtoToState({ ...r, id: newReqId, capsuleId: capId });
                requestsToSave.push(reqState);
            }
        }

        let sharedGroups: RequestGroup[] = [];
        let sharedOrder: string[] = [];
        let sharedAutoAuthEnabled: string = shared.autoAuthEnabled || 'off';
        let sharedAutoAuthEndpointId: string | null = shared.autoAuthEndpointId || null;
        const sharedVarSources: Record<string, any> = {};

        if (Array.isArray(shared.variables)) {
            const sysGrpVar = shared.variables.find((v: any) => (v.variableKey || v.key || '').trim() === '__capsule_groups__');
            const rawGrpVal = sysGrpVar?.variableValue ?? sysGrpVar?.value;
            if (rawGrpVal && typeof rawGrpVal === 'string') {
                try {
                    const parsedGrp = JSON.parse(rawGrpVal);
                    if (Array.isArray(parsedGrp?.groups)) {
                        sharedGroups = parsedGrp.groups.map((g: any) => {
                            const newGId = 'grp_' + this.createId();
                            if (g.id) sharedIdMap.set(String(g.id), newGId);
                            return {
                                id: newGId,
                                name: g.name || 'Folder',
                                capsuleId: capId,
                                isExpanded: g.isExpanded ?? true,
                                requestIds: (g.requestIds || []).map((oldId: string) => sharedIdMap.get(oldId) || oldId),
                                createdAt: Date.now()
                            };
                        });
                    }
                    if (Array.isArray(parsedGrp?.order)) {
                        sharedOrder = parsedGrp.order.map((oldId: string) => sharedIdMap.get(oldId) || oldId);
                    }
                    if (parsedGrp?.autoAuthEnabled) {
                        sharedAutoAuthEnabled = parsedGrp.autoAuthEnabled;
                    }
                    if (parsedGrp?.autoAuthEndpointId) {
                        sharedAutoAuthEndpointId = parsedGrp.autoAuthEndpointId;
                    }
                    if (parsedGrp?.requestMeta && typeof parsedGrp.requestMeta === 'object') {
                        requestsToSave.forEach((reqState, idx) => {
                            const origId = oldIdByIndex[idx];
                            const meta = origId ? parsedGrp.requestMeta[origId] : null;
                            if (!meta) return;
                            if (meta.postTriggerTabId !== undefined && !reqState.postTriggerTabId) {
                                reqState.postTriggerTabId = meta.postTriggerTabId;
                            }
                            if (meta.autoAuthEnabled !== undefined) {
                                reqState.autoAuthEnabled = !!meta.autoAuthEnabled;
                            }
                            if (meta.settings) {
                                reqState.settings = { ...reqState.settings, ...meta.settings };
                            }
                            if (meta.encryption) {
                                reqState.encryption = { ...reqState.encryption, ...meta.encryption };
                            }
                            if (meta.scripts) {
                                reqState.scripts = { ...reqState.scripts, ...meta.scripts };
                            }
                            if (meta.bodyWrapStyle) reqState.bodyWrapStyle = meta.bodyWrapStyle;
                            if (meta.responseWrapStyle) reqState.responseWrapStyle = meta.responseWrapStyle;
                            if (meta.responseActiveMode) reqState.responseActiveMode = meta.responseActiveMode;
                            if (meta.consoleWrap !== undefined) reqState.consoleWrap = meta.consoleWrap;
                        });
                    }
                } catch {}
            }

            const sysSrcVar = shared.variables.find((v: any) => (v.variableKey || v.key || '').trim() === '__var_sources__');
            const rawSrcVal = sysSrcVar?.variableValue ?? sysSrcVar?.value;
            if (rawSrcVal && typeof rawSrcVal === 'string') {
                try {
                    const parsedSrc = JSON.parse(rawSrcVal);
                    if (parsedSrc && typeof parsedSrc === 'object') {
                        for (const [k, src] of Object.entries(parsedSrc as Record<string, any>)) {
                            if (src && typeof src === 'object') {
                                const clonedSrc = { ...src, capsuleId: capId };
                                if (clonedSrc.tabId) clonedSrc.tabId = sharedIdMap.get(clonedSrc.tabId) || clonedSrc.tabId;
                                if (clonedSrc.requestId) clonedSrc.requestId = sharedIdMap.get(clonedSrc.requestId) || clonedSrc.requestId;
                                sharedVarSources[k.toLowerCase()] = clonedSrc;
                            }
                        }
                    }
                } catch {}
            }
        }

        // Remap postTriggerTabId and autoAuthEndpointId using sharedIdMap
        for (const reqState of requestsToSave) {
            if (reqState.postTriggerTabId) {
                reqState.postTriggerTabId = sharedIdMap.get(reqState.postTriggerTabId) || reqState.postTriggerTabId;
            }
        }
        if (sharedAutoAuthEndpointId) {
            sharedAutoAuthEndpointId = sharedIdMap.get(sharedAutoAuthEndpointId) || sharedAutoAuthEndpointId;
        }

        const filteredSharedVars = Array.isArray(shared.variables)
            ? shared.variables.filter((v: any) => !(v.variableKey || v.key || '').trim().startsWith('__'))
            : shared.variables;
        const extractedVars = extractRequestsVariables(requestsToSave, filteredSharedVars, sharedVarSources);

        const importRes = await this.importData({
            capsules: [{
                id: capId,
                name: capName,
                autoAuthEnabled: sharedAutoAuthEnabled,
                autoAuthEndpointId: sharedAutoAuthEndpointId,
                requests: requestsToSave,
                groups: sharedGroups,
                requestOrder: sharedOrder,
                variables: extractedVars,
                variableSources: sharedVarSources
            }],
            variables: extractedVars
        }, targetCapsuleId ? { targetCapsuleId } : undefined);

        const resolvedName = targetCapsuleId
            ? (this.capsules().find(c => c.id === targetCapsuleId)?.name || capName)
            : capName;

        return { capsuleName: resolvedName, requestsCount: importRes.requestsCount };
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
        const effectiveId = this.resolveTabId(id);
        const ignorableKeys = ['isLoading', 'responseBody', 'responseStatus', 'responseTime', 'responseSize', 'responseCookies', 'responseHeaders', 'testResults', 'editorScrollPositions', 'isDirty', 'executionToken', 'bodyWrapStyle', 'responseWrapStyle', 'responseActiveMode', 'consoleWrap'];
        const explicitDirty = Object.prototype.hasOwnProperty.call(partialState, 'isDirty');
        let becameDirty = false;

        this.states.update(map => {
            const currentState = map.get(effectiveId) || map.get(id) || this.getDefaultState(effectiveId);

            const isSignificantChange = Object.keys(partialState).some(k => !ignorableKeys.includes(k));

            if (recordHistory && isSignificantChange) {
                const pastChange: Partial<RequestState> = {};
                for (const key in partialState) {
                    if (!ignorableKeys.includes(key)) {
                        pastChange[key as keyof RequestState] = currentState[key as keyof RequestState] as any;
                    }
                }
                
                if (Object.keys(pastChange).length > 0) {
                    const stack = this.historyStack.get(effectiveId) || { past: [], future: [] };
                    stack.past.push(pastChange);
                    if (stack.past.length > 50) stack.past.shift();
                    stack.future = [];
                    this.historyStack.set(effectiveId, stack);
                }
            }

            let nextState: RequestState = { ...currentState, ...partialState };

            // Accurate baseline dirty tracking: compare against saved state (or default state if unsaved)
            if (!explicitDirty && isSignificantChange) {
                const saved = this.savedCapsules().find(r => r.id === effectiveId || r.id === id);
                const baseline = saved || this.getDefaultState(effectiveId);
                const isNowDirty = this.persistableFingerprint(nextState) !== this.persistableFingerprint(baseline);
                const fingerprintChanged = this.persistableFingerprint(currentState) !== this.persistableFingerprint(nextState);

                if (fingerprintChanged) {
                    this.editVersions.set(effectiveId, (this.editVersions.get(effectiveId) ?? 0) + 1);
                }

                if (nextState.isDirty !== isNowDirty) {
                    nextState = { ...nextState, isDirty: isNowDirty };
                }

                if (isNowDirty && fingerprintChanged) {
                    becameDirty = true;
                }
            }

            map.set(effectiveId, nextState);
            if (effectiveId !== id && map.has(id)) {
                map.delete(id);
            }
            return new Map(map);
        });

        if (partialState.headers || partialState.params || partialState.rawBody || partialState.rawBodyJson) {
            const updated = this.states().get(effectiveId);
            if (updated) {
                this.getVariableService()?.syncVariablesFromInputs(effectiveId, updated);
            }
        }

        if (
            this.authService.isLoggedIn() &&
            (partialState.postTriggerTabId !== undefined ||
                partialState.autoAuthEnabled !== undefined ||
                partialState.settings !== undefined ||
                partialState.encryption !== undefined ||
                partialState.scripts !== undefined)
        ) {
            this.scheduleGroupsVariableSync(this.activeCapsuleId());
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
            s.groupId ?? null,
            normParams,
            normHeaders,
            normFormData
        ]);
    }

    triggerAutoSave(delayMs = 1500) {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        this.autoSaveTimeout = setTimeout(() => this.runAutoSave(), delayMs);
    }

    private async runAutoSave() {
        if (!this.autoSaveEnabled() || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;

        const currentCap = this.capsules().find(c => c.id === this.activeCapsuleId());
        if (!currentCap || currentCap.isLocalOnly || this.deletingCapsuleIds.has(currentCap.id)) return;

        // Never run two saves concurrently — retry shortly after the current one finishes
        if (this.isSaving() || this.isAutoSaving()) {
            this.triggerAutoSave(800);
            return;
        }

        const needsStructureSync = this.hasPendingStructureSync;
        try {
            await this.saveToCapsule(undefined, {
                isAutoSave: true,
                onlyDirty: true,
                syncStructure: needsStructureSync
            });
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

    async saveToCapsule(id?: string, options?: { onlyDirty?: boolean; isAutoSave?: boolean; syncStructure?: boolean }): Promise<void> {
        const onlyDirty = !!options?.onlyDirty;
        const isAuto = !!options?.isAutoSave;
        const syncStructure = !!options?.syncStructure || this.hasPendingStructureSync;
        this.hasPendingStructureSync = false;

        if (isAuto) {
            this.isAutoSaving.set(true);
        } else {
            this.isSaving.set(true);
        }
        this.isSaveCancelled = false;

        try {
            const currentCapId = this.activeCapsuleId();
            if (!currentCapId || this.deletingCapsuleIds.has(currentCapId)) return;
            const currentCapName = this.activeCapsuleName();
            const existing = this.capsules().find(c => c.id === currentCapId);

            // If it is an automatic background save and the capsule is local-only, skip backend save!
            if (isAuto && existing?.isLocalOnly) {
                return;
            }

            // 1. Ensure local variables are saved to local storage
            const vs = this.getVariableService();
            if (vs) {
                vs.saveVariables(false);
            }

            // 2. Collect all requests belonging to this capsule (deep cloned to capture a snapshot)
            const tabsToSave: RequestState[] = [];
            const seenIds = new Set<string>();
            const savedIdsSet = new Set(this.savedCapsules().map(r => r.id));

            if (id && !this.deletedRequestIds.has(id)) {
                const activeTabState = this.states().get(id);
                if (activeTabState) {
                    tabsToSave.push(structuredClone(activeTabState));
                    seenIds.add(id);
                }
            }

            for (const s of this.states().values()) {
                if (this.deletedRequestIds.has(s.id)) continue;
                const belongsToCap = s.capsuleId === currentCapId || (!s.capsuleId && currentCapId === '1');
                if (!belongsToCap || seenIds.has(s.id)) continue;
                const isUnsavedGroupedRequest = Boolean(syncStructure && s.groupId && !savedIdsSet.has(s.id));
                if (onlyDirty && !s.isDirty && !isUnsavedGroupedRequest) continue;
                tabsToSave.push(structuredClone(s));
                seenIds.add(s.id);
            }

            if (!onlyDirty) {
                for (const s of this.savedCapsules()) {
                    if (!seenIds.has(s.id) && !this.deletedRequestIds.has(s.id) && (s.capsuleId === currentCapId || (!s.capsuleId && currentCapId === '1'))) {
                        tabsToSave.push(structuredClone(s));
                        seenIds.add(s.id);
                    }
                }
            }

            if (onlyDirty && tabsToSave.length === 0 && !syncStructure) return;

            // Snapshot edit versions so we can detect edits made while the save is in flight
            const versionAtSnapshot = new Map<string, number>();
            for (const t of tabsToSave) {
                versionAtSnapshot.set(t.id, this.editVersions.get(t.id) ?? 0);
            }

            if (this.isSaveCancelled) return;

            // 3. If logged in, ensure capsule exists on backend and sync variables
            let effectiveCapId = currentCapId;
            if (this.authService.isLoggedIn() && currentCapId) {
                try {
                    const isLocalCapsule = !existing || !!existing.isLocalOnly || currentCapId === '1' || currentCapId.length < 8;
                    if (isLocalCapsule) {
                        const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentCapId);
                        const createPayload: any = {
                            name: currentCapName,
                            autoAuthEnabled: this.autoAuthEnabled(),
                            autoAuthEndpointId: this.autoAuthEndpointId()
                        };
                        if (isGuid && currentCapId !== '1') {
                            createPayload.id = currentCapId;
                        }

                        const res = await firstValueFrom(
                            this.http.post<{ data: any }>(`${API_BASE_URL}/capsule`, createPayload)
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
                                autoAuthEndpointId: this.autoAuthEndpointId(),
                                isLocalOnly: false
                            } : c));

                            if (oldId !== effectiveCapId) {
                                for (const tabState of tabsToSave) {
                                    tabState.capsuleId = effectiveCapId;
                                }
                                this.states.update(map => {
                                    const next = new Map(map);
                                    for (const [sId, st] of next) {
                                        if (st.capsuleId === oldId) {
                                            next.set(sId, { ...st, capsuleId: effectiveCapId });
                                        }
                                    }
                                    return next;
                                });
                                if (this.isBrowser) {
                                    const oldOpen = localStorage.getItem(`onsteroids_open_tab_ids_${oldId}`);
                                    if (oldOpen) localStorage.setItem(`onsteroids_open_tab_ids_${effectiveCapId}`, oldOpen);
                                    const oldAct = localStorage.getItem(`onsteroids_active_tab_${oldId}`);
                                    if (oldAct) localStorage.setItem(`onsteroids_active_tab_${effectiveCapId}`, oldAct);
                                    const oldVars = localStorage.getItem(`onsteroids_vars_${oldId}`);
                                    if (oldVars) localStorage.setItem(`onsteroids_vars_${effectiveCapId}`, oldVars);
                                    const oldSources = localStorage.getItem(`onsteroids_var_sources_${oldId}`);
                                    if (oldSources) localStorage.setItem(`onsteroids_var_sources_${effectiveCapId}`, oldSources);
                                    const oldGroups = this.getGroupsForCapsule(oldId);
                                    if (oldGroups.length > 0) {
                                        this.setGroupsForCapsule(
                                            effectiveCapId,
                                            oldGroups.map(g => ({ ...g, capsuleId: effectiveCapId })),
                                            false
                                        );
                                    }
                                    const oldOrder = this.capsuleRequestOrderMap().get(oldId) || this.loadCapsuleRequestOrder(oldId);
                                    if (oldOrder && oldOrder.length > 0) {
                                        this.capsuleRequestOrderMap.update(m => new Map(m).set(effectiveCapId, oldOrder));
                                        localStorage.setItem(`onsteroids_capsule_order_${effectiveCapId}`, JSON.stringify(oldOrder));
                                    }
                                    const u = this.authService.currentUser();
                                    if (u?.id) {
                                        const oldUserSources = localStorage.getItem(`onsteroids_user_var_sources_${oldId}_${u.id}`);
                                        if (oldUserSources) localStorage.setItem(`onsteroids_user_var_sources_${effectiveCapId}_${u.id}`, oldUserSources);
                                    }
                                }
                            } else {
                                this.capsules.update(list => list.map(c => c.id === effectiveCapId ? {
                                    ...c,
                                    isLocalOnly: false
                                } : c));
                            }
                        }

                        if (this.isBrowser) {
                            localStorage.setItem('onsteroids_active_capsule', effectiveCapId);
                            localStorage.setItem('onsteroids_capsules', JSON.stringify(this.capsules()));
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
                                    this.http.put(`${API_BASE_URL}/capsule/${effectiveCapId}`, {
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
                    console.error('Failed to create or sync capsule on backend:', e);
                    throw e;
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
                            params: this.serializeNonEmptyKvRows(tabState.params),
                            headers: this.serializeNonEmptyKvRows(tabState.headers),
                            formData: this.serializeNonEmptyFormDataRows(tabState.formData)
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
                                groupId: tabState.groupId ?? null,
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

            if (this.isSaveCancelled || this.deletingCapsuleIds.has(effectiveCapId) || this.deletingCapsuleIds.has(currentCapId)) {
                return;
            }

            // Fence against requests/groups deleted while saveToCapsule was in flight
            const validSaveResults = saveResults.filter(res => {
                const isDeleted = this.deletedRequestIds.has(res.oldId) || this.deletedRequestIds.has(res.savedId);
                if (isDeleted && res.persisted && this.isValidGuid(res.savedId) && this.authService.isLoggedIn()) {
                    this.deleteRequestsOnBackendResilient([res.savedId]).catch(() => {});
                }
                return !isDeleted;
            });

            // Batch update state in memory
            let idsChanged = false;
            const oldToNewIdMap = new Map<string, string>();

            this.states.update(map => {
                const next = new Map(map);
                for (const res of validSaveResults) {
                    if (!res.persisted) continue;
                    const live = next.get(res.oldId) || next.get(res.savedId);
                    if (res.savedId !== res.oldId) {
                        next.delete(res.oldId);
                        oldToNewIdMap.set(res.oldId, res.savedId);
                        this.registerIdRedirect(res.oldId, res.savedId);
                    }
                    if (live) {
                        // ALWAYS preserve live execution and response state!
                        // The backend request/save only saves configuration (method, url, headers, params, body, etc.),
                        // NEVER runtime response bodies, status, or loading states.
                        const merged: RequestState = {
                            ...(res.updatedState || live),
                            ...live,
                            id: res.savedId,
                            capsuleId: effectiveCapId,
                            isDirty: res.editedDuringSave ? true : (live.isDirty && res.editedDuringSave),
                            // Explicitly protect runtime execution fields from being clobbered by stale snapshots:
                            isLoading: live.isLoading,
                            responseBody: live.responseBody,
                            responseStatus: live.responseStatus,
                            responseTime: live.responseTime,
                            responseSize: live.responseSize,
                            responseHeaders: live.responseHeaders,
                            responseCookies: live.responseCookies,
                            testResults: live.testResults,
                            scripts: live.scripts
                        };
                        next.set(res.savedId, merged);
                    } else if (res.updatedState) {
                        next.set(res.savedId, res.updatedState);
                    }
                }
                return next;
            });

            this.savedCapsules.update(col => {
                const nextCol = [...col];
                for (const res of validSaveResults) {
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

            for (const res of validSaveResults) {
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
                const capGroups = this.getGroupsForCapsule(effectiveCapId);
                if (capGroups.length > 0) {
                    const remappedGroups = capGroups.map(g => ({
                        ...g,
                        requestIds: (g.requestIds || []).map(rId => oldToNewIdMap.get(rId) || rId)
                    }));
                    this.setGroupsForCapsule(effectiveCapId, remappedGroups, false);
                }
                const capOrder = this.capsuleRequestOrderMap().get(effectiveCapId) || this.loadCapsuleRequestOrder(effectiveCapId);
                if (capOrder && capOrder.length > 0) {
                    const remappedOrder = capOrder.map(rId => oldToNewIdMap.get(rId) || rId);
                    this.capsuleRequestOrderMap.update(m => new Map(m).set(effectiveCapId, remappedOrder));
                    if (this.isBrowser) {
                        localStorage.setItem(`onsteroids_capsule_order_${effectiveCapId}`, JSON.stringify(remappedOrder));
                    }
                }
            }

            // 5. Update backend session in Variable table with newly saved IDs, groups, and order state
            if (vs && this.authService.isLoggedIn() && (!onlyDirty || idsChanged || syncStructure)) {
                clearTimeout(this.groupsVarSyncTimeout);
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
                this.snapshotCurrentSession(undefined, false);
                if (this.authService.isLoggedIn()) {
                    await this.syncWorkspaceStateToBackend(true);
                }
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
        if (!this.isBrowser || !this.authService.isLoggedIn() || this.authService.isLoggingOut()) {
            this.isCapsuleLoading.set(false);
            return;
        }
        if (this.isLoadingBackendData()) return;

        const hadOfflineWorkAtStart = this.hasOfflineWork();
        const loadSwitchVersion = this.capsuleSwitchVersion;
        this.isLoadingBackendData.set(true);
        if (!hadOfflineWorkAtStart || this.openTabs().length === 0) {
            this.isCapsuleLoading.set(true);
        }

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

            if (this.capsuleSwitchVersion !== loadSwitchVersion) return;

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
                        mergedCaps.push({ ...bc, isLocalOnly: false });
                    } else {
                        mergedCaps[idx] = { ...mergedCaps[idx], ...bc, isLocalOnly: false };
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
            if (this.capsuleSwitchVersion !== loadSwitchVersion) return;

            if (targetCapId) {
                this.syncGroupAssignmentsToRequests(targetCapId);
            }
            if (vs) {
                vs.reanchorVariableSources(targetCapId || '1');
            }

            // 6. Restore open tabs and active tab selection (if user did not already start working offline)
            if (!hadOfflineWorkAtStart) {
                let targetOpenIds = this.openTabIds().filter(id => {
                    const st = this.states().get(id);
                    return Boolean(st) && (!st!.capsuleId || st!.capsuleId === this.activeCapsuleId());
                });
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
                                    if (this.deletingCapsuleIds.has(c.id)) return;
                                    if (res?.data && Array.isArray(res.data)) {
                                        const mapped = res.data
                                            .map(dto => this.mapDtoToState({ ...dto, capsuleId: c.id }))
                                            .filter(req => !this.deletedRequestIds.has(req.id));
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
            if (this.capsuleSwitchVersion === loadSwitchVersion) {
                this.isCapsuleLoading.set(false);
            }
        }
    }

    async loadRequestsForCapsule(capsuleId: string): Promise<void> {
        const targetCap = this.capsules().find(c => c.id === capsuleId);
        if (targetCap?.isLocalOnly || capsuleId === '1') {
            const localReqs = Array.from(this.states().values()).filter(r => r.capsuleId === capsuleId);
            this.savedCapsules.set(localReqs);
            return;
        }

        if (!this.isBrowser || !this.authService.isLoggedIn()) return;

        try {
            const reqRes = await firstValueFrom(
                this.http.get<{ data: any[] }>(`${API_BASE_URL}/request/capsule/${capsuleId}`)
            );
            // If active capsule changed or capsule is being deleted while request was in-flight, discard stale response
            if (this.activeCapsuleId() !== capsuleId || this.deletingCapsuleIds.has(capsuleId)) {
                return;
            }
            if (reqRes?.data) {
                const sortedData = reqRes.data
                    .filter(dto => !dto?.id || !this.deletedRequestIds.has(dto.id))
                    .sort((a, b) => {
                    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return timeA - timeB;
                });
                const knownGroups = this.getGroupsForCapsule(capsuleId);
                const reqToGroup = new Map<string, string>();
                for (const g of knownGroups) {
                    for (const rId of (g.requestIds || [])) {
                        reqToGroup.set(rId, g.id);
                    }
                }
                const existingStates = this.states();
                const mapped = sortedData.map(dto => {
                    const baseState = this.mapDtoToState({ ...dto, capsuleId });
                    const prev = existingStates.get(baseState.id);
                    return {
                        ...baseState,
                        groupId: reqToGroup.get(baseState.id) ?? prev?.groupId ?? baseState.groupId ?? null,
                        postTriggerTabId: baseState.postTriggerTabId ?? prev?.postTriggerTabId ?? null,
                        autoAuthEnabled: baseState.autoAuthEnabled || prev?.autoAuthEnabled || false,
                        bodyWrapStyle: prev?.bodyWrapStyle || baseState.bodyWrapStyle,
                        responseWrapStyle: prev?.responseWrapStyle || baseState.responseWrapStyle,
                        responseActiveMode: prev?.responseActiveMode || baseState.responseActiveMode,
                        consoleWrap: prev?.consoleWrap ?? baseState.consoleWrap
                    };
                });
                this.savedCapsules.set(mapped);
                this.states.update(map => {
                    const next = new Map(map);
                    for (const req of mapped) {
                        const existing = next.get(req.id);
                        if (existing) {
                            next.set(req.id, {
                                ...req,
                                groupId: req.groupId ?? existing.groupId ?? null,
                                isLoading: false,
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
                this.getVariableService()?.reanchorVariableSources(capsuleId);
            }
        } catch (e) {
            console.error('Failed to load requests for capsule', e);
        }
    }

    mapDtoToState(dto: any): RequestState {
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
                preRequest: dto.preRequestScript || DEFAULT_PRE_REQUEST_SCRIPT_SKELETON,
                postResponse: dto.postResponseScript || DEFAULT_POST_RESPONSE_SCRIPT_SKELETON,
                testScript: dto.testScript || DEFAULT_TEST_SCRIPT_SKELETON,
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
            params: (() => {
                const mapped = (dto.params || []).map((p: any) => ({
                    enabled: p.isEnabled ?? p.enabled ?? true,
                    key: p.paramKey ?? p.key ?? '',
                    value: p.paramValue ?? p.value ?? ''
                }));
                return mapped.length > 0 ? mapped : base.params;
            })(),
            headers: (dto.headers || []).map((h: any) => ({
                enabled: h.isEnabled ?? h.enabled ?? true,
                key: h.headerKey ?? h.key ?? '',
                value: h.headerValue ?? h.value ?? ''
            })),
            formData: (() => {
                const mapped = (dto.formData || []).map((f: any) => ({
                    enabled: f.isEnabled ?? f.enabled ?? true,
                    key: f.fieldKey ?? f.key ?? '',
                    value: f.fieldValue ?? f.value ?? '',
                    type: (f.fieldType as any) || (f.type as any) || 'text'
                }));
                return mapped.length > 0 ? mapped : base.formData;
            })(),
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

        const capId = source.capsuleId || this.activeCapsuleId();
        const capGroups = this.getGroupsForCapsule(capId);
        const ownerGroup = capGroups.find(g => (g.requestIds || []).includes(id) || source.groupId === g.id);
        if (ownerGroup) {
            const updatedGroups = capGroups.map(g => {
                if (g.id !== ownerGroup.id) return g;
                const nextReqIds = [...(g.requestIds || [])];
                const idx = nextReqIds.indexOf(id);
                if (idx !== -1) {
                    nextReqIds.splice(idx + 1, 0, newId);
                } else {
                    nextReqIds.push(newId);
                }
                return { ...g, requestIds: nextReqIds };
            });
            this.setGroupsForCapsule(capId, updatedGroups, true);
        }

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

        this.notifyStructureOrOrderChanged(this.activeCapsuleId(), true);
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
                preRequest: DEFAULT_PRE_REQUEST_SCRIPT_SKELETON,
                postResponse: DEFAULT_POST_RESPONSE_SCRIPT_SKELETON,
                preRequestConsole: '',
                postResponseConsole: '',
                encryptionConsole: '',
                testScript: DEFAULT_TEST_SCRIPT_SKELETON,
                testScriptEnabled: false
            },
            encryption: {
                algorithm: 'none',
                key: '',
                autoEncryptBody: false,
                autoEncryptHeaders: false,
                encryptedHeaders: [],
                encryptedBodyPaths: [],
                script: DEFAULT_ENCRYPTION_SCRIPT_SKELETON
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
            bodyWrapStyle: (this.isBrowser ? localStorage.getItem('onsteroids_body_wrap_style') as any : null) || 'word-wrap',
            responseWrapStyle: (this.isBrowser ? localStorage.getItem('onsteroids_response_wrap_style') as any : null) || 'word-wrap',
            responseActiveMode: (this.isBrowser ? localStorage.getItem('onsteroids_response_active_mode') as any : null) || 'Pretty',
            consoleWrap: this.isBrowser ? localStorage.getItem('onsteroids_console_wrap') === 'true' : false,
            executionToken: 0,
        };
    }


    createId(): string {
        return generateUUID();
    }
}







