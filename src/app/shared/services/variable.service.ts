import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
    modalSource = signal<VariableSource | undefined>(undefined);

    openAddModal(key: string = '', value: string = '', source?: VariableSource) {
        this.modalKey.set(key);
        this.modalValue.set(value);
        this.modalSource.set(source);
        this.showAddModal.set(true);
    }

    closeAddModal() {
        this.showAddModal.set(false);
        this.modalSource.set(undefined);
    }

    constructor() {
        this.loadVariables();
        if (this.authService.isLoggedIn()) {
            this.loadVariablesFromBackend();
        }
        this.authService.onLogout.subscribe((user) => {
            const u = user || this.authService.currentUser();
            const json = JSON.stringify(this.variables());
            this.localStorageService.setItem('onsteroids_last_vars', json);
            if (u?.id) {
                this.localStorageService.setItem(`onsteroids_user_vars_${u.id}`, json);
            }
            if (u?.email) {
                this.localStorageService.setItem(`onsteroids_user_vars_${u.email}`, json);
            }
            this.resetVariables();
        });
        this.authService.onLogin.subscribe((user) => {
            this.restoreUserVariables(user);
            this.loadVariablesFromBackend();
        });
    }

    private loadVariables() {
        const user = this.authService.currentUser();
        const userKey = user ? `onsteroids_user_vars_${user.id || user.email}` : null;
        const saved = (userKey && this.localStorageService.getItem(userKey)) ||
            this.localStorageService.getItem('onsteroids_last_vars') ||
            this.localStorageService.getItem(LocalStorageService.STORAGE_KEY);
        if (saved) {
            try {
                this.variables.set(JSON.parse(saved));
            } catch (e) {
                this.variables.set([]);
            }
        } else {
            // Default example variable
            this.variables.set([
                { id: '1', key: 'baseUrl', value: 'http://acegeld.runasp.net/api/v1', enabled: true }
            ]);
            this.saveVariables();
        }
    }

    restoreUserVariables(user?: any) {
        const u = user || this.authService.currentUser();
        const keysToTry: string[] = [];
        if (u?.id) keysToTry.push(`onsteroids_user_vars_${u.id}`);
        if (u?.email) keysToTry.push(`onsteroids_user_vars_${u.email}`);
        keysToTry.push('onsteroids_last_vars');
        keysToTry.push(LocalStorageService.STORAGE_KEY);

        for (const k of keysToTry) {
            const saved = this.localStorageService.getItem(k);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        this.variables.set(parsed);
                        this.saveVariables();
                        return;
                    }
                } catch (e) {}
            }
        }
    }

    setVariables(vars: IGlobalVariable[]) {
        if (Array.isArray(vars)) {
            this.variables.set(vars);
            this.saveVariables();
        }
    }

    private hasPendingSync = false;

    async loadVariablesFromBackend(): Promise<void> {
        if (!this.authService.isLoggedIn()) return;
        try {
            const res = await firstValueFrom(
                this.http.get<{ data: any[] }>(`${API_BASE_URL}/Variable`)
            );
            if (res?.data && Array.isArray(res.data)) {
                let sessionSourcesMap = new Map<string, VariableSource>();

                // Check if any variable holds the backend workspace session payload
                const sessionVar = res.data.find(v => v.variableKey === '__workspace_session__');
                if (sessionVar && sessionVar.variableValue) {
                    try {
                        const parsedSession = JSON.parse(sessionVar.variableValue);
                        if (parsedSession?.variables && Array.isArray(parsedSession.variables)) {
                            for (const sv of parsedSession.variables) {
                                if (sv.source && sv.key) {
                                    sessionSourcesMap.set(sv.key.trim().toLowerCase(), sv.source);
                                }
                            }
                        }
                        this.tabStateService.applyBackendSession(parsedSession);
                    } catch (e) {
                        console.warn('Failed to parse backend session variable', e);
                    }
                }

                // Filter out internal system variables from the user-facing variables list
                const userVars: IGlobalVariable[] = res.data
                    .filter(v => !v.variableKey.startsWith('__'))
                    .map(v => {
                        const existing = this.variables().find(
                            ev => ev.id === v.id || ev.key.trim().toLowerCase() === v.variableKey.trim().toLowerCase()
                        );
                        const source = sessionSourcesMap.get(v.variableKey.trim().toLowerCase()) || existing?.source;
                        return {
                            id: v.id,
                            key: v.variableKey,
                            value: v.variableValue ?? existing?.value ?? '',
                            enabled: v.isEnabled ?? true,
                            source
                        };
                    });

                // Also keep any active local variables that weren't in res.data yet
                const backendKeys = new Set(res.data.map(v => v.variableKey.trim().toLowerCase()));
                const extraLocalVars = this.variables().filter(v => !v.key.startsWith('__') && !backendKeys.has(v.key.trim().toLowerCase()));

                const finalVars = [...userVars, ...extraLocalVars];
                if (finalVars.length > 0) {
                    this.variables.set(finalVars);
                    this.saveVariables(false);
                }
            }
        } catch (e) {
            console.error('Failed to load variables from backend', e);
        }
    }

    async syncVariablesToBackend(): Promise<void> {
        if (!this.authService.isLoggedIn()) return;
        if (this.isSyncing()) {
            this.hasPendingSync = true;
            return;
        }
        this.isSyncing.set(true);
        try {
            const userVars = this.variables().filter(v => !v.key.startsWith('__'));
            const payloadVars: any[] = userVars.map(v => ({
                id: v.id && v.id.length > 8 ? v.id : null,
                key: v.key.trim(),
                value: (v.source ? this.getVariableValue(v) : v.value) ?? '',
                enabled: v.enabled ?? true
            }));

            // Include workspace session metadata so active capsule, open tabs, and responses persist in API database
            const sessionPayload = this.tabStateService.getBackendSessionPayload();
            if (sessionPayload) {
                payloadVars.push({
                    id: null,
                    key: '__workspace_session__',
                    value: JSON.stringify(sessionPayload),
                    enabled: true
                });
            }

            const res = await firstValueFrom(
                this.http.post<{ data: any[] }>(`${API_BASE_URL}/Variable/sync`, { variables: payloadVars })
            );

            if (res?.data && Array.isArray(res.data)) {
                const idMap = new Map<string, string>();
                for (const dbVar of res.data) {
                    if (dbVar.variableKey.startsWith('__')) continue;
                    const matched = this.variables().find(
                        v => v.key.trim().toLowerCase() === dbVar.variableKey.trim().toLowerCase()
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
                }
            }
        } catch (e) {
            console.error('Failed to sync variables to backend', e);
        } finally {
            this.isSyncing.set(false);
            if (this.hasPendingSync) {
                this.hasPendingSync = false;
                this.syncVariablesToBackend();
            }
        }
    }

    saveVariables(syncBackend = true) {
        const json = JSON.stringify(this.variables());
        this.localStorageService.setItem(LocalStorageService.STORAGE_KEY, json);
        this.localStorageService.setItem('onsteroids_last_vars', json);
        const user = this.authService.currentUser();
        if (user?.id) {
            this.localStorageService.setItem(`onsteroids_user_vars_${user.id}`, json);
        }
        if (user?.email) {
            this.localStorageService.setItem(`onsteroids_user_vars_${user.email}`, json);
        }
        try {
            this.tabStateService.snapshotCurrentSession();
        } catch {}

        if (syncBackend && this.authService.isLoggedIn()) {
            this.syncVariablesToBackend();
        }
    }

    resetVariables() {
        this.variables.set([
            { id: '1', key: 'baseUrl', value: 'http://acegeld.runasp.net/api/v1', enabled: true }
        ]);
    }

    addVariable(key: string = '', value: string = '', source?: VariableSource) {
        const trimmedKey = (key || '').trim();
        if (!trimmedKey) {
            const newVar: IGlobalVariable = {
                id: crypto.randomUUID(),
                key: '',
                value: value || '',
                enabled: true,
                source
            };
            this.variables.update(vars => [...vars, newVar]);
            this.saveVariables();
            return;
        }

        const existingIndex = this.variables().findIndex(
            v => v.key.trim().toLowerCase() === trimmedKey.toLowerCase()
        );

        if (existingIndex >= 0) {
            this.variables.update(vars => {
                const updated = [...vars];
                const existing = updated[existingIndex];
                updated[existingIndex] = {
                    ...existing,
                    key: trimmedKey,
                    value: value,
                    enabled: true,
                    source: source !== undefined ? source : existing.source
                };
                return updated;
            });
        } else {
            const newVar: IGlobalVariable = {
                id: crypto.randomUUID(),
                key: trimmedKey,
                value,
                enabled: true,
                source
            };
            this.variables.update(vars => [...vars, newVar]);
        }
        this.saveVariables();
    }

    updateVariable(updatedVar: IGlobalVariable) {
        this.variables.update(vars => vars.map(v => v.id === updatedVar.id ? updatedVar : v));
        this.saveVariables();
    }

    removeVariable(id: string) {
        this.variables.update(vars => vars.filter(v => v.id !== id));
        this.saveVariables();
    }

    updateTabIdInSources(oldId: string, newId: string) {
        if (!oldId || !newId || oldId === newId) return;
        let changed = false;
        this.variables.update(vars => vars.map(v => {
            if (v.source && v.source.tabId === oldId) {
                changed = true;
                return {
                    ...v,
                    source: {
                        ...v.source,
                        tabId: newId
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

        // 1. Direct tabId or request id match
        if (source.tabId && (source.tabId === currentTabId || (requestState && source.tabId === requestState.id))) {
            return true;
        }
        if (source.requestId && requestState && source.requestId === requestState.id) {
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
            if (sn && rn && sn === rn && sn !== 'new request') {
                return true;
            }
        }

        return false;
    }

    findStateForVariable(v: IGlobalVariable): any {
        if (!v.source) return undefined;

        // 1. Direct tabId lookup in active states map
        if (v.source.tabId) {
            const state = this.tabStateService.getState(v.source.tabId);
            if (state) return state;
        }

        // 2. allCapsuleRequests and allStates by ID or requestId
        const allReqs = this.tabStateService.allCapsuleRequests();
        const allStates = this.tabStateService.getAllStates();
        const reqId = v.source.requestId || v.source.tabId;
        if (reqId) {
            const state = allReqs.find(r => r.id === reqId) || allStates.find(r => r.id === reqId);
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
            if (sn && sn !== 'new request') {
                const state = allReqs.find(r => r.name?.trim().toLowerCase() === sn) ||
                    allStates.find(r => r.name?.trim().toLowerCase() === sn);
                if (state) {
                    v.source.tabId = state.id;
                    if (state.id) v.source.requestId = state.id;
                    return state;
                }
            }
        }

        return undefined;
    }

    syncVariablesFromResponse(tabId: string, responseBody: any, responseHeaders: any[], requestState?: any, resolvedUrl?: string) {
        if (responseBody === undefined && (!responseHeaders || responseHeaders.length === 0)) return;
        let hasChanges = false;

        this.variables.update(vars => {
            return vars.map(v => {
                if (!v.source) return v;

                const matchesTab = this.requestMatchesSource(v.source, tabId, requestState, resolvedUrl);
                if (!matchesTab) return v;

                // Refresh source anchors so subsequent lookups are instantaneous
                if (requestState) {
                    if (requestState.url && !v.source.requestUrl) v.source.requestUrl = requestState.url;
                    if (requestState.name && !v.source.requestName) v.source.requestName = requestState.name;
                    if (requestState.id) v.source.requestId = requestState.id;
                }
                v.source.tabId = tabId;

                if (v.source.type === 'response') {
                    const prop = v.source.propertyKey?.trim();
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
                        if (strVal !== v.value) {
                            hasChanges = true;
                            return { ...v, value: strVal };
                        }
                    }
                }
                return v;
            });
        });

        if (hasChanges) {
            this.saveVariables();
        }
    }

    syncVariablesFromInputs(tabId: string, state: any) {
        if (!state) return;
        let hasChanges = false;

        this.variables.update(vars => {
            return vars.map(v => {
                if (!v.source) return v;

                const matchesTab = this.requestMatchesSource(v.source, tabId, state);
                if (!matchesTab) return v;

                if (state.url && !v.source.requestUrl) v.source.requestUrl = state.url;
                if (state.name && !v.source.requestName) v.source.requestName = state.name;
                if (state.id) v.source.requestId = state.id;
                v.source.tabId = tabId;

                const prop = v.source.propertyKey?.trim();

                if (v.source.type === 'header' && prop && state.headers) {
                    const match = state.headers.find((h: any) => h.key?.trim().toLowerCase() === prop.toLowerCase());
                    if (match && match.value !== undefined && match.value !== v.value) {
                        hasChanges = true;
                        return { ...v, value: match.value };
                    }
                } else if (v.source.type === 'param' && prop && state.params) {
                    const match = state.params.find((p: any) => p.key?.trim().toLowerCase() === prop.toLowerCase());
                    if (match && match.value !== undefined && match.value !== v.value) {
                        hasChanges = true;
                        return { ...v, value: match.value };
                    }
                } else if (v.source.type === 'body' && (state.rawBodyJson || state.rawBody)) {
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
                            return { ...v, value: strVal };
                        }
                    }
                }

                return v;
            });
        });

        if (hasChanges) {
            this.saveVariables();
        }
    }

    getVariableValue(v: IGlobalVariable): string {
        if (!v.source) {
            return v.value;
        }

        const state = this.findStateForVariable(v);

        if (!state) {
            return v.value;
        }

        const prop = v.source.propertyKey?.trim();

        if (v.source.type === 'header') {
            if (!prop) return v.value;
            const match = state.headers?.find((h: any) => h.key.trim().toLowerCase() === prop.toLowerCase());
            const newVal = match && match.value !== undefined ? match.value : v.value;
            if (newVal !== v.value) v.value = newVal;
            return newVal;
        }

        if (v.source.type === 'param') {
            if (!prop) return v.value;
            const match = state.params?.find((p: any) => p.key.trim().toLowerCase() === prop.toLowerCase());
            const newVal = match && match.value !== undefined ? match.value : v.value;
            if (newVal !== v.value) v.value = newVal;
            return newVal;
        }

        if (v.source.type === 'body') {
            const raw = state.rawBodyJson || state.rawBody;
            if (prop && raw) {
                const extracted = this.extractValue(raw, prop);
                if (extracted !== undefined && extracted !== null) {
                    const strVal = typeof extracted === 'object' ? JSON.stringify(extracted) : String(extracted);
                    if (strVal !== v.value) v.value = strVal;
                    return strVal;
                }
            }
            return v.value;
        }

        if (v.source.type === 'response') {
            if (prop && state.responseBody !== undefined && state.responseBody !== null) {
                const extracted = this.extractValue(state.responseBody, prop);
                if (extracted !== undefined && extracted !== null) {
                    const strVal = typeof extracted === 'object' ? JSON.stringify(extracted) : String(extracted);
                    if (strVal !== v.value) v.value = strVal;
                    return strVal;
                }
            }
            return v.value;
        }

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
        this.variables().forEach(v => {
            if (v.enabled && v.key) {
                const dynamicVal = this.getVariableValue(v) ?? '';
                const escapedKey = v.key.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`{{\\s*${escapedKey}\\s*}}`, 'g');
                resolvedText = resolvedText.replace(regex, dynamicVal.trim());
            }
        });
        return resolvedText;
    }
}
