import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { generateUUID } from '../utils/uuid.util';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../constants/api.constants';
import { LocalStorageService } from './local.storage.service';
import { IGlobalVariable, VariableSource } from '../../interfaces/services/IVariableService';
import { TabStateService } from './tab.state.service';
import { AuthService } from './auth.service';

@Injectable({
    providedIn: 'root'
})
export class VariableService {
    private http = inject(HttpClient);
    private localStorageService = inject(LocalStorageService);
    private tabStateService = inject(TabStateService);
    private authService = inject(AuthService);

    variables = signal<IGlobalVariable[]>([]);
    isSyncing = signal<boolean>(false);

    // Confirmation Modal state for adding a variable
    showAddModal = signal<boolean>(false);
    modalKey = signal<string>('');
    modalValue = signal<string>('');
    modalType = signal<'global' | 'path'>('global');
    modalSource = signal<VariableSource | undefined>(undefined);

    openAddModal(key: string = '', value: string = '', source?: VariableSource, type: 'global' | 'path' = 'global') {
        this.modalKey.set(key);
        this.modalValue.set(value);
        this.modalType.set(type);
        this.modalSource.set(source);
        this.showAddModal.set(true);
    }

    closeAddModal() {
        this.showAddModal.set(false);
        this.modalSource.set(undefined);
    }

    private inFlightLoads = new Map<string, Promise<void>>();

    constructor() {
        effect(() => {
            const capId = this.tabStateService.activeCapsuleId();
            if (capId) {
                this.loadVariables(capId);
            }
        }, { allowSignalWrites: true });

        this.authService.registerSaveChecker(() => this.isSyncing());

        // Note: TabStateService.loadBackendData() orchestrates variable loading after
        // capsules, requests, and active capsule are fully restored.
        this.authService.onLogout.subscribe(() => {
            this.resetVariables();
        });
    }

    public getSourceMapForCapsule(capId: string): Record<string, VariableSource> {
        if (!this.localStorageService) return {};
        const user = this.authService.currentUser();
        const userKey = user?.id ? `onsteroids_user_var_sources_${capId}_${user.id}` : (user?.email ? `onsteroids_user_var_sources_${capId}_${user.email}` : null);
        let raw = userKey ? this.localStorageService.getItem(userKey) : null;
        if (!raw) {
            raw = this.localStorageService.getItem(`onsteroids_var_sources_${capId}`);
        }
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed;
                }
            } catch {}
        }
        return {};
    }

    public saveSourceMapForCapsule(capId: string, map: Record<string, VariableSource>): void {
        if (!this.localStorageService) return;
        const json = JSON.stringify(map);
        this.localStorageService.setItem(`onsteroids_var_sources_${capId}`, json);
        const user = this.authService.currentUser();
        if (user?.id) {
            this.localStorageService.setItem(`onsteroids_user_var_sources_${capId}_${user.id}`, json);
        }
        if (user?.email) {
            this.localStorageService.setItem(`onsteroids_user_var_sources_${capId}_${user.email}`, json);
        }
    }

    public getCachedVariablesForCapsule(capId: string): IGlobalVariable[] {
        if (!this.localStorageService) return [];
        const user = this.authService.currentUser();
        const userKey = user?.id ? `onsteroids_user_vars_${capId}_${user.id}` : (user?.email ? `onsteroids_user_vars_${capId}_${user.email}` : null);
        let saved = userKey ? this.localStorageService.getItem(userKey) : null;
        if (!saved) {
            saved = this.localStorageService.getItem(`onsteroids_vars_${capId}`) ||
                this.localStorageService.getItem(`onsteroids_last_vars_${capId}`);
        }
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            } catch {}
        }
        return [];
    }

    private cacheVariablesForCapsule(capId: string, vars: IGlobalVariable[]) {
        if (!vars || !Array.isArray(vars)) return;

        // Persist dedicated source map for this capsule
        const existingSourceMap = this.getSourceMapForCapsule(capId);
        let sourceMapChanged = false;

        const enrichedVars = vars.map(v => {
            const kLower = (v.key || '').trim().toLowerCase();
            if (!kLower) return v;

            if (v.source) {
                existingSourceMap[kLower] = { ...v.source };
                sourceMapChanged = true;
                return v;
            } else if (existingSourceMap[kLower]) {
                return {
                    ...v,
                    source: { ...existingSourceMap[kLower] }
                };
            }
            return v;
        });

        if (sourceMapChanged) {
            this.saveSourceMapForCapsule(capId, existingSourceMap);
        }

        const json = JSON.stringify(enrichedVars);
        this.localStorageService.setItem(`onsteroids_vars_${capId}`, json);
        this.localStorageService.setItem(`onsteroids_last_vars_${capId}`, json);
        const user = this.authService.currentUser();
        if (user?.id) {
            this.localStorageService.setItem(`onsteroids_user_vars_${capId}_${user.id}`, json);
        }
        if (user?.email) {
            this.localStorageService.setItem(`onsteroids_user_vars_${capId}_${user.email}`, json);
        }
    }

    public async loadVariables(capsuleId?: string): Promise<void> {
        const user = this.authService.currentUser();
        const capId = capsuleId || this.tabStateService.activeCapsuleId() || '1';
        const sourceMap = this.getSourceMapForCapsule(capId);

        let localVars: IGlobalVariable[] | null = null;
        const cached = this.getCachedVariablesForCapsule(capId);
        if (cached && cached.length > 0) {
            localVars = cached.map(v => {
                const kLower = (v.key || '').trim().toLowerCase();
                return {
                    ...v,
                    source: v.source ?? sourceMap[kLower]
                };
            });
        }

        // 2. Immediately isolate in-memory state for this capsule.
        // If this capsule has local variables cached, show them.
        // If not cached, reset to empty (or default baseUrl only for offline guest capsule '1').
        // This ensures variables from previously opened capsules NEVER leak!
        if (localVars !== null && localVars.length > 0) {
            this.variables.set(localVars);
            this.reanchorVariableSources(capId);
        } else if (!this.authService.isLoggedIn() && capId === '1') {
            this.variables.set([
                { id: '1', key: 'baseUrl', value: 'http://acegeld.runasp.net/api/v1', enabled: true }
            ]);
        } else {
            this.variables.set([]);
        }

        // 3. When logged in, fetch latest from backend for this specific capsule (deduplicated)
        if (this.authService.isLoggedIn() && !this.authService.isLoggingOut()) {
            if (this.inFlightLoads.has(capId)) {
                await this.inFlightLoads.get(capId);
                return;
            }
            const loadPromise = this.loadVariablesFromBackend(false, capId);
            this.inFlightLoads.set(capId, loadPromise);
            try {
                await loadPromise;
            } finally {
                this.inFlightLoads.delete(capId);
            }
        }
    }

    restoreUserVariables(user?: any, targetCapId?: string) {
        const u = user || this.authService.currentUser();
        const capId = targetCapId || this.tabStateService.activeCapsuleId() || '1';
        const sourceMap = this.getSourceMapForCapsule(capId);

        const keysToTry: string[] = [];
        if (u?.id) keysToTry.push(`onsteroids_user_vars_${capId}_${u.id}`);
        if (u?.email) keysToTry.push(`onsteroids_user_vars_${capId}_${u.email}`);
        keysToTry.push(`onsteroids_vars_${capId}`);
        keysToTry.push(`onsteroids_last_vars_${capId}`);

        for (const k of keysToTry) {
            const saved = this.localStorageService.getItem(k);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const enriched = parsed.map(v => {
                            const kLower = (v.key || '').trim().toLowerCase();
                            return {
                                ...v,
                                source: v.source ?? sourceMap[kLower]
                            };
                        });
                        this.variables.set(enriched);
                        this.saveVariables(false, capId);
                        this.reanchorVariableSources(capId);
                        return;
                    }
                } catch (e) {}
            }
        }
        if (this.variables().length === 0) {
            this.variables.set([]);
        }
    }

    setVariables(vars: IGlobalVariable[], targetCapId?: string, syncBackend = true) {
        if (Array.isArray(vars)) {
            const capId = targetCapId || this.tabStateService.activeCapsuleId() || '1';
            const sourceMap = this.getSourceMapForCapsule(capId);
            const enriched = vars.map(v => {
                const kLower = (v.key || '').trim().toLowerCase();
                return {
                    ...v,
                    source: v.source ?? sourceMap[kLower]
                };
            });
            this.variables.set(enriched);
            this.saveVariables(syncBackend, capId);
            this.reanchorVariableSources(capId);
        }
    }

    private hasPendingSync = false;
    private systemSourceVarIds = new Map<string, string>();

    async loadVariablesFromBackend(forceNoCapsuleFilter = false, targetCapId?: string): Promise<void> {
        if (!this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;
        const capId = targetCapId || this.tabStateService.activeCapsuleId() || '1';
        const isGuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(capId);

        // If not forced and not a valid GUID (e.g. offline '1'), don't query backend without a filter!
        if (!forceNoCapsuleFilter && !isGuid) {
            return;
        }

        const currentCap = this.tabStateService.capsules().find(c => c.id === capId);
        if (currentCap?.isLocalOnly) {
            return;
        }

        try {
            const qs = (!forceNoCapsuleFilter && isGuid) ? `?capsuleId=${capId}` : '';
            const res = await firstValueFrom(
                this.http.get<{ data: any[] }>(`${API_BASE_URL}/Variable${qs}`)
            );
            if (res?.data && Array.isArray(res.data)) {
                const cachedVars = this.getCachedVariablesForCapsule(capId);
                let sourceMap = this.getSourceMapForCapsule(capId);
                const inMemVars = this.variables();

                // Extract backend-persisted __var_sources__ system variable if present
                const sysSourceEntry = res.data.find(v => (v.variableKey || v.key || '').trim() === '__var_sources__');
                if (sysSourceEntry) {
                    if (sysSourceEntry.id) {
                        this.systemSourceVarIds.set(capId, sysSourceEntry.id);
                    }
                    const rawSysVal = sysSourceEntry.variableValue ?? sysSourceEntry.value;
                    if (rawSysVal && typeof rawSysVal === 'string') {
                        try {
                            const parsedBackendSources = JSON.parse(rawSysVal);
                            if (parsedBackendSources && typeof parsedBackendSources === 'object' && !Array.isArray(parsedBackendSources)) {
                                sourceMap = { ...parsedBackendSources, ...sourceMap };
                                this.saveSourceMapForCapsule(capId, sourceMap);
                            }
                        } catch {}
                    }
                }

                // Filter out internal system variables from the user-facing variables list
                const userVars: IGlobalVariable[] = res.data
                    .filter(v => {
                        const k = v.variableKey || v.key || '';
                        return !k.startsWith('__');
                    })
                    .map(v => {
                        const key = (v.variableKey || v.key || '').trim();
                        const keyLower = key.toLowerCase();
                        const val = v.variableValue !== undefined ? v.variableValue : (v.value !== undefined ? v.value : '');

                        const existingCached = cachedVars.find(
                            ev => ev.id === v.id || (ev.key || '').trim().toLowerCase() === keyLower
                        );
                        const existingInMem = inMemVars.find(
                            ev => ev.id === v.id || (ev.key || '').trim().toLowerCase() === keyLower
                        );

                        const resolvedSource = existingInMem?.source ?? existingCached?.source ?? sourceMap[keyLower];

                        return {
                            id: v.id,
                            key: key,
                            value: (val ?? existingInMem?.value ?? existingCached?.value ?? ''),
                            type: v.type ?? existingInMem?.type ?? existingCached?.type ?? 'global',
                            enabled: (v.isEnabled !== undefined ? v.isEnabled : (v.enabled !== undefined ? v.enabled : true)),
                            source: resolvedSource
                        };
                    });

                // Concurrency check: If active capsule changed while this request was in flight, do not overwrite in-memory variables!
                const currentCap = this.tabStateService.activeCapsuleId();
                if (currentCap && currentCap !== capId) {
                    this.cacheVariablesForCapsule(capId, userVars);
                    return;
                }

                // Keep only active local variables for THIS capsule that weren't in res.data yet.
                // Genuinely local/unsaved variables have short IDs (length <= 8), not 36-char backend GUIDs.
                const backendKeys = new Set(res.data.map(v => (v.variableKey || v.key || '').trim().toLowerCase()));
                const extraLocalVars = this.variables()
                    .filter(v => {
                        const k = (v.key || '').trim().toLowerCase();
                        const isLocalOnly = !v.id || v.id.length <= 8;
                        return isLocalOnly && !(v.key || '').startsWith('__') && !backendKeys.has(k);
                    })
                    .map(v => ({
                        ...v,
                        id: v.id && v.id.length > 8 ? v.id.substring(0, 7) : v.id,
                        source: v.source ?? sourceMap[(v.key || '').trim().toLowerCase()]
                    }));

                const finalVars = [...userVars, ...extraLocalVars];
                this.variables.set(finalVars);
                this.saveVariables(false, capId);
                this.reanchorVariableSources(capId);

                if (extraLocalVars.length > 0 && this.authService.isLoggedIn() && isGuid) {
                    this.syncVariablesToBackend(capId);
                }
            }
        } catch (e) {
            console.error('Failed to load variables from backend', e);
        }
    }

    async syncVariablesToBackend(targetCapId?: string): Promise<void> {
        if (!this.authService.isLoggedIn() || this.authService.isLoggingOut()) return;
        if (this.isSyncing()) {
            this.hasPendingSync = true;
            return;
        }
        this.isSyncing.set(true);
        try {
            const capsuleId = targetCapId || this.tabStateService.activeCapsuleId();
            const isGuid = capsuleId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(capsuleId);
            if (!isGuid) {
                return;
            }

            const currentCap = this.tabStateService.capsules().find(c => c.id === capsuleId);
            if (currentCap?.isLocalOnly) {
                return;
            }

            const userVars = this.variables().filter(v => !(v.key || '').startsWith('__'));
            const payloadVars: any[] = userVars.map(v => ({
                id: v.id && v.id.length > 8 ? v.id : null,
                key: (v.key || '').trim(),
                variableKey: (v.key || '').trim(),
                value: (v.source ? this.getVariableValue(v) : v.value) ?? '',
                variableValue: (v.source ? this.getVariableValue(v) : v.value) ?? '',
                type: v.type ?? 'global',
                enabled: v.enabled ?? true
            }));

            // Also persist the capsule's variable source map as an internal system variable
            const sourceMap = this.getSourceMapForCapsule(capsuleId);
            for (const v of userVars) {
                const kLower = (v.key || '').trim().toLowerCase();
                if (kLower && v.source) {
                    sourceMap[kLower] = { ...v.source };
                }
            }
            if (Object.keys(sourceMap).length > 0) {
                const sourcesJson = JSON.stringify(sourceMap);
                const sysId = this.systemSourceVarIds.get(capsuleId) || null;
                payloadVars.push({
                    id: sysId && sysId.length > 8 ? sysId : null,
                    key: '__var_sources__',
                    variableKey: '__var_sources__',
                    value: sourcesJson,
                    variableValue: sourcesJson,
                    type: 'global',
                    enabled: false
                });
            }

            const payload = { 
                capsuleId: capsuleId,
                variables: payloadVars 
            };

            const res = await firstValueFrom(
                this.http.post<{ data: any[] }>(`${API_BASE_URL}/Variable/sync`, payload)
            );

            if (res?.data && Array.isArray(res.data)) {
                const idMap = new Map<string, string>();
                for (const dbVar of res.data) {
                    const dbKey = (dbVar.variableKey || dbVar.key || '').trim();
                    if (dbKey === '__var_sources__' && dbVar.id && capsuleId) {
                        this.systemSourceVarIds.set(capsuleId, dbVar.id);
                        continue;
                    }
                    if (dbKey.startsWith('__')) continue;
                    const matched = this.variables().find(
                        v => (v.key || '').trim().toLowerCase() === dbKey.toLowerCase()
                    );
                    if (matched && matched.id !== dbVar.id) {
                        idMap.set(matched.id, dbVar.id);
                    }
                }
                if (idMap.size > 0) {
                    this.variables.update(vars => vars.map(v => {
                        const newId = idMap.get(v.id);
                        return newId ? { ...v, id: newId } : v;
                    }));
                    if (capsuleId) {
                        this.cacheVariablesForCapsule(capsuleId, this.variables());
                    }
                }
            }
        } catch (e) {
            console.error('Failed to sync variables to backend', e);
        } finally {
            this.isSyncing.set(false);
            if (this.hasPendingSync) {
                this.hasPendingSync = false;
                this.syncVariablesToBackend(targetCapId);
            }
        }
    }

    saveVariables(syncBackend = true, targetCapId?: string) {
        const capId = targetCapId || this.tabStateService.activeCapsuleId() || '1';
        this.cacheVariablesForCapsule(capId, this.variables());
        try {
            this.tabStateService.snapshotCurrentSession();
        } catch {}

        if (syncBackend && this.authService.isLoggedIn()) {
            this.syncVariablesToBackend(capId);
        }
    }

    resetVariables() {
        this.variables.set([
            { id: '1', key: 'baseUrl', value: 'http://acegeld.runasp.net/api/v1', enabled: true }
        ]);
    }

    addVariable(key: string = '', value: string = '', source?: VariableSource, type: 'global' | 'path' = 'global') {
        const trimmedKey = (key || '').trim();
        const capId = this.tabStateService.activeCapsuleId() || '1';

        if (trimmedKey && source) {
            const sourceMap = this.getSourceMapForCapsule(capId);
            sourceMap[trimmedKey.toLowerCase()] = { ...source };
            this.saveSourceMapForCapsule(capId, sourceMap);
        }

        if (!trimmedKey) {
            const newVar: IGlobalVariable = {
                id: generateUUID().substring(0, 7),
                key: '',
                value: value || '',
                type: type,
                enabled: true,
                source
            };
            this.variables.update(vars => [...vars, newVar]);
            this.saveVariables();
            return;
        }

        const existingIndex = this.variables().findIndex(
            v => (v.key || '').trim().toLowerCase() === trimmedKey.toLowerCase()
        );

        if (existingIndex >= 0) {
            this.variables.update(vars => {
                const updated = [...vars];
                const existing = updated[existingIndex];
                const sourceMap = this.getSourceMapForCapsule(capId);
                const resolvedSource = source !== undefined ? source : (existing.source ?? sourceMap[trimmedKey.toLowerCase()]);
                updated[existingIndex] = {
                    ...existing,
                    key: trimmedKey,
                    value: value,
                    type: type,
                    enabled: true,
                    source: resolvedSource
                };
                return updated;
            });
        } else {
            const newVar: IGlobalVariable = {
                id: generateUUID().substring(0, 7),
                key: trimmedKey,
                value,
                type: type,
                enabled: true,
                source
            };
            this.variables.update(vars => [...vars, newVar]);
        }
        this.saveVariables();
    }

    updateVariable(updatedVar: IGlobalVariable) {
        const capId = this.tabStateService.activeCapsuleId() || '1';
        const sourceMap = this.getSourceMapForCapsule(capId);
        const existing = this.variables().find(v => v.id === updatedVar.id);
        const oldKeyLower = (existing?.key || '').trim().toLowerCase();
        const newKeyLower = (updatedVar.key || '').trim().toLowerCase();

        // Always preserve existing dynamic source even when the user manually edits the variable value or key
        const preservedSource = updatedVar.source
            ?? existing?.source
            ?? (oldKeyLower ? sourceMap[oldKeyLower] : undefined)
            ?? (newKeyLower ? sourceMap[newKeyLower] : undefined);

        const finalVar: IGlobalVariable = preservedSource
            ? { ...updatedVar, source: { ...preservedSource } }
            : updatedVar;

        let mapUpdated = false;
        if (oldKeyLower && oldKeyLower !== newKeyLower && sourceMap[oldKeyLower]) {
            delete sourceMap[oldKeyLower];
            mapUpdated = true;
        }
        if (newKeyLower && finalVar.source) {
            sourceMap[newKeyLower] = { ...finalVar.source };
            mapUpdated = true;
        }
        if (mapUpdated) {
            this.saveSourceMapForCapsule(capId, sourceMap);
        }

        this.variables.update(vars => vars.map(v => v.id === finalVar.id ? finalVar : v));
        this.saveVariables();
    }

    removeVariable(id: string) {
        const toRemove = this.variables().find(v => v.id === id);
        this.variables.update(vars => vars.filter(v => v.id !== id));
        if (toRemove?.key) {
            const capId = this.tabStateService.activeCapsuleId() || '1';
            const sourceMap = this.getSourceMapForCapsule(capId);
            const kLower = toRemove.key.trim().toLowerCase();
            if (sourceMap[kLower]) {
                delete sourceMap[kLower];
                this.saveSourceMapForCapsule(capId, sourceMap);
            }
        }
        this.saveVariables();
    }

    updateTabIdInSources(oldId: string, newId: string) {
        if (!oldId || !newId || oldId === newId) return;
        let changed = false;
        this.variables.update(vars => vars.map(v => {
            if (v.source && (v.source.tabId === oldId || v.source.requestId === oldId)) {
                changed = true;
                return {
                    ...v,
                    source: {
                        ...v.source,
                        tabId: v.source.tabId === oldId ? newId : v.source.tabId,
                        requestId: (v.source.requestId === oldId || !v.source.requestId) ? newId : v.source.requestId
                    }
                };
            }
            return v;
        }));
        if (changed) {
            this.saveVariables();
        }
    }

    urlsMatch(url1?: string, url2?: string): boolean {
        if (!url1 || !url2) return false;
        // Fast raw comparison (handles unexpanded {{baseUrl}}/path before variables load)
        const raw1 = url1.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        const raw2 = url2.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
        if (raw1 === raw2) return true;
        const rawP1 = raw1.split('?')[0];
        const rawP2 = raw2.split('?')[0];
        if (rawP1 && rawP1 === rawP2) return true;

        const norm1 = this.normalizeUrl(url1);
        const norm2 = this.normalizeUrl(url2);
        if (norm1 === norm2) return true;
        // Compare path ignoring query parameters
        const p1 = norm1.split('?')[0];
        const p2 = norm2.split('?')[0];
        return !!p1 && p1 === p2;
    }

    normalizeUrl(url: string): string {
        if (!url) return '';
        let resolved = this.resolve(url).trim().toLowerCase();
        // Remove scheme
        resolved = resolved.replace(/^https?:\/\//, '');
        // Remove trailing slash
        resolved = resolved.replace(/\/+$/, '');
        return resolved;
    }

    requestMatchesSource(source: VariableSource, currentTabId: string, requestState?: any, resolvedUrl?: string): boolean {
        if (!source) return false;

        const resolvedSourceTabId = this.tabStateService.resolveTabId(source.tabId);
        const resolvedSourceReqId = source.requestId ? this.tabStateService.resolveTabId(source.requestId) : undefined;
        const resolvedCurrentTabId = this.tabStateService.resolveTabId(currentTabId);
        const currentReqId = requestState?.id ? this.tabStateService.resolveTabId(requestState.id) : undefined;

        // 1. Direct tabId or request id match (including through id redirects)
        if (resolvedSourceTabId && (
            resolvedSourceTabId === resolvedCurrentTabId ||
            resolvedSourceTabId === currentTabId ||
            (currentReqId && resolvedSourceTabId === currentReqId) ||
            (requestState?.id && resolvedSourceTabId === requestState.id)
        )) {
            return true;
        }

        if (resolvedSourceReqId && (
            resolvedSourceReqId === resolvedCurrentTabId ||
            resolvedSourceReqId === currentTabId ||
            (currentReqId && resolvedSourceReqId === currentReqId) ||
            (requestState?.id && resolvedSourceReqId === requestState.id)
        )) {
            return true;
        }

        // 2. Normalized URL match (against raw or resolved URL)
        if (source.requestUrl) {
            if (requestState?.url && this.urlsMatch(source.requestUrl, requestState.url)) {
                return true;
            }
            if (resolvedUrl && this.urlsMatch(source.requestUrl, resolvedUrl)) {
                return true;
            }
        }

        // 3. Request name match (trimmed, case-insensitive)
        if (source.requestName && requestState?.name) {
            const sn = source.requestName.trim().toLowerCase();
            const rn = requestState.name.trim().toLowerCase();
            if (sn && rn && sn === rn) {
                if (sn !== 'new request' || (source.requestUrl && requestState.url && this.urlsMatch(source.requestUrl, requestState.url))) {
                    return true;
                }
            }
        }

        return false;
    }

    findStateForVariable(v: IGlobalVariable): any {
        if (!v.source) return undefined;

        // 1. Direct tabId lookup in active states map
        if (v.source.tabId) {
            const resolvedId = this.tabStateService.resolveTabId(v.source.tabId);
            const state = this.tabStateService.getState(resolvedId) || this.tabStateService.getState(v.source.tabId);
            if (state) return state;
        }

        // 2. allCapsuleRequests and allStates by ID or requestId
        const allReqs = this.tabStateService.allCapsuleRequests();
        const allStates = this.tabStateService.getAllStates();
        const reqId = v.source.requestId || v.source.tabId;
        if (reqId) {
            const resolvedReqId = this.tabStateService.resolveTabId(reqId);
            const state = allReqs.find(r => r.id === resolvedReqId || r.id === reqId) ||
                allStates.find(r => r.id === resolvedReqId || r.id === reqId);
            if (state) {
                v.source.tabId = state.id;
                if (state.id) v.source.requestId = state.id;
                return state;
            }
        }

        // 3. Fallback: match by URL (raw or normalized)
        if (v.source.requestUrl) {
            const state = allReqs.find(r => this.urlsMatch(r.url, v.source?.requestUrl)) ||
                allStates.find(r => this.urlsMatch(r.url, v.source?.requestUrl));
            if (state) {
                v.source.tabId = state.id;
                if (state.id) v.source.requestId = state.id;
                return state;
            }
        }

        // 4. Fallback: match by name
        if (v.source.requestName) {
            const sn = v.source.requestName.trim().toLowerCase();
            if (sn) {
                const state = allReqs.find(r => {
                    const rn = r.name?.trim().toLowerCase();
                    if (rn !== sn) return false;
                    if (sn === 'new request') {
                        return v.source?.requestUrl ? this.urlsMatch(r.url, v.source.requestUrl) : true;
                    }
                    return true;
                }) || allStates.find(r => {
                    const rn = r.name?.trim().toLowerCase();
                    if (rn !== sn) return false;
                    if (sn === 'new request') {
                        return v.source?.requestUrl ? this.urlsMatch(r.url, v.source.requestUrl) : true;
                    }
                    return true;
                });
                if (state) {
                    v.source.tabId = state.id;
                    if (state.id) v.source.requestId = state.id;
                    return state;
                }
            }
        }

        return undefined;
    }

    reanchorVariableSources(targetCapId?: string): void {
        const capId = targetCapId || this.tabStateService.activeCapsuleId() || '1';
        const sourceMap = this.getSourceMapForCapsule(capId);
        let changed = false;

        this.variables.update(vars => {
            return vars.map(v => {
                const kLower = (v.key || '').trim().toLowerCase();
                const src = v.source ?? (kLower ? sourceMap[kLower] : undefined);
                if (!src) return v;

                const workingVar: IGlobalVariable = v.source ? v : { ...v, source: { ...src } };
                if (!v.source) changed = true;

                const matchedState = this.findStateForVariable(workingVar);
                if (matchedState && matchedState.id && workingVar.source) {
                    const resolvedId = this.tabStateService.resolveTabId(matchedState.id);
                    const oldTabId = workingVar.source.tabId;
                    const oldReqId = workingVar.source.requestId;
                    const oldUrl = workingVar.source.requestUrl;
                    const oldName = workingVar.source.requestName;

                    if (oldTabId !== resolvedId || oldReqId !== resolvedId || (matchedState.url && oldUrl !== matchedState.url) || (matchedState.name && oldName !== matchedState.name)) {
                        changed = true;
                        return {
                            ...workingVar,
                            source: {
                                ...workingVar.source,
                                tabId: resolvedId,
                                requestId: resolvedId,
                                requestUrl: matchedState.url || workingVar.source.requestUrl,
                                requestName: matchedState.name || workingVar.source.requestName
                            }
                        };
                    }
                }
                return workingVar;
            });
        });

        if (changed) {
            this.saveVariables(false, capId);
        }
    }

    syncVariablesFromResponse(tabId: string, responseBody: any, responseHeaders: any[], requestState?: any, resolvedUrl?: string) {
        if (responseBody === undefined && (!responseHeaders || responseHeaders.length === 0)) return;
        const capId = this.tabStateService.activeCapsuleId() || '1';
        const sourceMap = this.getSourceMapForCapsule(capId);
        let hasChanges = false;
        let anchorsChanged = false;

        this.variables.update(vars => {
            return vars.map(v => {
                const kLower = (v.key || '').trim().toLowerCase();
                const src = v.source ?? (kLower ? sourceMap[kLower] : undefined);
                if (!src) return v;

                const activeSource: VariableSource = { ...src };
                const matchesTab = this.requestMatchesSource(activeSource, tabId, requestState, resolvedUrl);
                if (!matchesTab) {
                    return v.source ? v : { ...v, source: activeSource };
                }

                // Refresh source anchors so subsequent lookups are instantaneous
                if (requestState) {
                    if (requestState.url && activeSource.requestUrl !== requestState.url) {
                        activeSource.requestUrl = requestState.url;
                        anchorsChanged = true;
                    }
                    if (requestState.name && activeSource.requestName !== requestState.name) {
                        activeSource.requestName = requestState.name;
                        anchorsChanged = true;
                    }
                    if (requestState.id && activeSource.requestId !== requestState.id) {
                        activeSource.requestId = requestState.id;
                        anchorsChanged = true;
                    }
                }
                if (activeSource.tabId !== tabId) {
                    activeSource.tabId = tabId;
                    anchorsChanged = true;
                }

                if (activeSource.type === 'response') {
                    const prop = activeSource.propertyKey?.trim();
                    let newVal: any = undefined;

                    if (prop && responseBody !== undefined && responseBody !== null) {
                        newVal = this.extractValue(responseBody, prop);
                    } else if (!prop && responseBody !== undefined && responseBody !== null) {
                        newVal = typeof responseBody === 'object' ? JSON.stringify(responseBody) : String(responseBody);
                    }

                    if ((newVal === undefined || newVal === null) && prop && Array.isArray(responseHeaders)) {
                        const hMatch = responseHeaders.find((h: any) => h.key?.toLowerCase() === prop.toLowerCase());
                        if (hMatch && hMatch.value !== undefined) {
                            newVal = hMatch.value;
                        }
                    }

                    if (newVal !== undefined && newVal !== null) {
                        const strVal = typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal);
                        if (strVal !== v.value || !v.source) {
                            hasChanges = true;
                            return { ...v, value: strVal, source: activeSource };
                        }
                    }
                }
                return anchorsChanged || !v.source ? { ...v, source: activeSource } : v;
            });
        });

        if (hasChanges || anchorsChanged) {
            this.saveVariables(hasChanges);
        }
    }

    syncVariablesFromInputs(tabId: string, state: any) {
        if (!state) return;
        const capId = this.tabStateService.activeCapsuleId() || '1';
        const sourceMap = this.getSourceMapForCapsule(capId);
        let hasChanges = false;

        this.variables.update(vars => {
            return vars.map(v => {
                const kLower = (v.key || '').trim().toLowerCase();
                const src = v.source ?? (kLower ? sourceMap[kLower] : undefined);
                if (!src) return v;

                const activeSource: VariableSource = { ...src };
                const matchesTab = this.requestMatchesSource(activeSource, tabId, state);
                if (!matchesTab) {
                    return v.source ? v : { ...v, source: activeSource };
                }

                if (state.url && !activeSource.requestUrl) activeSource.requestUrl = state.url;
                if (state.name && !activeSource.requestName) activeSource.requestName = state.name;
                if (state.id) activeSource.requestId = state.id;
                activeSource.tabId = tabId;

                const prop = activeSource.propertyKey?.trim();

                if (activeSource.type === 'header' && prop && state.headers) {
                    const match = state.headers.find((h: any) => h.key?.trim().toLowerCase() === prop.toLowerCase());
                    if (match && match.value !== undefined && match.value !== v.value) {
                        hasChanges = true;
                        return { ...v, value: match.value, source: activeSource };
                    }
                } else if (activeSource.type === 'param' && prop && state.params) {
                    const match = state.params.find((p: any) => p.key?.trim().toLowerCase() === prop.toLowerCase());
                    if (match && match.value !== undefined && match.value !== v.value) {
                        hasChanges = true;
                        return { ...v, value: match.value, source: activeSource };
                    }
                } else if (activeSource.type === 'body' && (state.rawBodyJson || state.rawBody)) {
                    const raw = state.rawBodyJson || state.rawBody;
                    let newVal: any = undefined;
                    if (prop) {
                        newVal = this.extractValue(raw, prop);
                    } else {
                        newVal = raw;
                    }
                    if (newVal !== undefined && newVal !== null) {
                        const strVal = typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal);
                        if (strVal !== v.value) {
                            hasChanges = true;
                            return { ...v, value: strVal, source: activeSource };
                        }
                    }
                }

                return !v.source ? { ...v, source: activeSource } : v;
            });
        });

        if (hasChanges) {
            this.saveVariables();
        }
    }

    getVariableValue(v: IGlobalVariable): string {
        return v.value;
    }

    private extractValue(data: any, path: string): any {
        if (!path || data === undefined || data === null) return undefined;
        let current = data;

        if (typeof current === 'string') {
            try {
                current = JSON.parse(current);
            } catch {
                // Try XML tag extraction: e.g. <token>xyz</token>
                const tagRegex = new RegExp(`<${path}[^>]*>([\\s\\S]*?)<\\/${path}>`, 'i');
                const match = current.match(tagRegex);
                if (match) return match[1].trim();

                const attrRegex = new RegExp(`<${path}[^>]*value=["']([^"']*)["']`, 'i');
                const attrMatch = current.match(attrRegex);
                if (attrMatch) return attrMatch[1].trim();

                const attrRegex2 = new RegExp(`<[^>]*\\b${path}=["']([^"']*)["']`, 'i');
                const attrMatch2 = current.match(attrRegex2);
                if (attrMatch2) return attrMatch2[1].trim();

                // Regex search for "path": "value" or 'path': 'value' or path: value in raw text
                const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const jsonRegex = new RegExp(`["']?${escaped}["']?\\s*:\\s*(?:"((?:\\\\.|[^"\\\\])*)"|'((?:\\\\.|[^'\\\\])*)'|([0-9.]+|true|false))`, 'i');
                const jsonMatch = current.match(jsonRegex);
                if (jsonMatch) {
                    return jsonMatch[1] ?? jsonMatch[2] ?? jsonMatch[3];
                }

                return undefined;
            }
        }

        if (!current || typeof current !== 'object') return undefined;

        // 1. Direct key match (exact case)
        if (path in current && current[path] !== undefined) {
            return current[path];
        }

        // 2. Direct key match (case-insensitive)
        const lowerPath = path.toLowerCase();
        if (!Array.isArray(current)) {
            const matchedKey = Object.keys(current).find(k => k.toLowerCase() === lowerPath);
            if (matchedKey && current[matchedKey] !== undefined) {
                return current[matchedKey];
            }
        }

        // 3. Dot-path or array index navigation (e.g. "data.token", "items[0].id", "items.0.id")
        const normalizedTokens = path
            .replace(/\[(\w+)\]/g, '.$1')
            .split('.')
            .map(t => t.trim())
            .filter(Boolean);

        if (normalizedTokens.length > 1) {
            let temp: any = current;
            let found = true;
            for (const token of normalizedTokens) {
                if (temp === null || temp === undefined) {
                    found = false;
                    break;
                }
                if (Array.isArray(temp)) {
                    const idx = parseInt(token, 10);
                    if (!isNaN(idx) && idx >= 0 && idx < temp.length) {
                        temp = temp[idx];
                    } else {
                        found = false;
                        break;
                    }
                } else if (typeof temp === 'object') {
                    if (token in temp && temp[token] !== undefined) {
                        temp = temp[token];
                    } else {
                        const lowToken = token.toLowerCase();
                        const mk = Object.keys(temp).find(k => k.toLowerCase() === lowToken);
                        if (mk && temp[mk] !== undefined) {
                            temp = temp[mk];
                        } else {
                            found = false;
                            break;
                        }
                    }
                } else {
                    found = false;
                    break;
                }
            }
            if (found && temp !== undefined) {
                return temp;
            }
        }

        // 4. Breadth-First Deep Search across all nested objects and arrays
        return this.deepSearchKey(current, path);
    }

    private deepSearchKey(obj: any, targetKey: string, maxDepth = 10): any {
        if (!obj || typeof obj !== 'object' || maxDepth <= 0) return undefined;

        const queue: { target: any; depth: number }[] = [{ target: obj, depth: 0 }];
        const visited = new Set<any>();
        const lowerTarget = targetKey.toLowerCase();

        while (queue.length > 0) {
            const { target, depth } = queue.shift()!;
            if (!target || typeof target !== 'object' || visited.has(target)) continue;
            visited.add(target);

            if (Array.isArray(target)) {
                for (const item of target) {
                    if (item && typeof item === 'object') {
                        queue.push({ target: item, depth: depth + 1 });
                    }
                }
            } else {
                // Check if this object contains the key
                if (targetKey in target && target[targetKey] !== undefined) {
                    return target[targetKey];
                }
                const match = Object.keys(target).find(k => k.toLowerCase() === lowerTarget);
                if (match && target[match] !== undefined) {
                    return target[match];
                }

                if (depth < maxDepth) {
                    for (const k of Object.keys(target)) {
                        const val = target[k];
                        if (val && typeof val === 'object') {
                            queue.push({ target: val, depth: depth + 1 });
                        }
                    }
                }
            }
        }

        return undefined;
    }

    resolve(text: string): string {
        if (!text) return text;
        let resolvedText = text;

        // Sort variables by key length descending to prevent partial replacements (e.g. 'calendarId' before 'calendar')
        const sortedVars = [...this.variables()].sort((a, b) => (b.key?.length || 0) - (a.key?.length || 0));

        sortedVars.forEach(v => {
            if (v.enabled && v.key) {
                const dynamicVal = (this.getVariableValue(v) ?? '').trim();
                const rawK = v.key.trim();
                if (!rawK) return;
                // Strip any accidental brackets or colon from key
                const cleanK = rawK.replace(/^[:{]+/, '').replace(/[}]+$/, '').trim();
                if (!cleanK) return;
                const escapedKey = cleanK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // 1. Postman {{key}} syntax
                const globalRegex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, 'g');
                resolvedText = resolvedText.replace(globalRegex, dynamicVal);

                // 2. Path parameter :key syntax (preceded by start, /, ?, &, or =)
                const pathRegex = new RegExp(`(?<=^|[/?&=]):${escapedKey}(?=[/?&#]|$)`, 'g');
                resolvedText = resolvedText.replace(pathRegex, dynamicVal);

                // 3. OpenAPI / Swagger {key} syntax (preceded by start, /, ?, &, or =)
                const swaggerRegex = new RegExp(`(?<=^|[/?&=]){${escapedKey}}(?=[/?&#]|$)`, 'g');
                resolvedText = resolvedText.replace(swaggerRegex, dynamicVal);
            }
        });

        // Utility replacements
        resolvedText = resolvedText.replace(/\$guid/gi, () => crypto.randomUUID());
        resolvedText = resolvedText.replace(/\$timestamp/gi, () => Date.now().toString());
        resolvedText = resolvedText.replace(/\$randomInt/gi, () => Math.floor(Math.random() * 1000).toString());
        resolvedText = resolvedText.replace(/\$randomUUID/gi, () => crypto.randomUUID());
        resolvedText = resolvedText.replace(/\$randomEmail/gi, () => `test_${Math.floor(Math.random() * 10000)}@example.com`);
        resolvedText = resolvedText.replace(/\$randomName/gi, () => 'John Doe');
        resolvedText = resolvedText.replace(/\$randomWord/gi, () => 'lorem');
        resolvedText = resolvedText.replace(/\$randomColor/gi, () => '#' + Math.floor(Math.random()*16777215).toString(16));
        resolvedText = resolvedText.replace(/\$randomCity/gi, () => 'New York');
        resolvedText = resolvedText.replace(/\$randomStreetAddress/gi, () => '123 Main St');
        resolvedText = resolvedText.replace(/\$randomPhoneNumber/gi, () => '555-0100');
        resolvedText = resolvedText.replace(/\$randomBoolean/gi, () => Math.random() > 0.5 ? 'true' : 'false');
        resolvedText = resolvedText.replace(/\$randomAlphaNumeric/gi, () => Math.random().toString(36).substring(2, 10));
        resolvedText = resolvedText.replace(/\$randomIPv4/gi, () => `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`);

        return resolvedText;
    }
}
