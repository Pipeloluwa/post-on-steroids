import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../constants/api.constants';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { firstValueFrom } from 'rxjs';
import { LocalStorageService } from './local.storage.service';
import { generateUUID } from '../utils/uuid.util';
import {
    DEFAULT_ENCRYPTION_SCRIPTS,
    DEFAULT_DECRYPTION_SCRIPTS,
    DEFAULT_PRE_REQUEST_SCRIPTS,
    DEFAULT_POST_RESPONSE_SCRIPTS,
    DEFAULT_TEST_SCRIPTS,
    DefaultScriptEntry,
    ScriptLanguage,
    getDefaultScriptCode,
    getNewScriptGuidelineCode
} from '../constants/script.snippets.constants';

export interface ScriptDto {
    id: string;
    userId: string;
    type: string;
    name: string;
    content: string;
    language?: ScriptLanguage;
    isDefault: boolean;
    originalContent?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ApiResponse<T> {
    title: string;
    responseCode: string;
    message: string;
    data: T;
    errors?: string[];
}

export interface BuiltInDefaultScriptDef {
    type: string;
    name: string;
    virtualId: string;
    getDefaultContent: (language?: ScriptLanguage) => string;
}

function toScriptSlug(name: string): string {
    return (name || 'default')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'default';
}

function buildDefaultDefsForList(
    type: string,
    entries: DefaultScriptEntry[],
    primaryVirtualId: string
): BuiltInDefaultScriptDef[] {
    return entries.map((entry, idx) => ({
        type,
        name: entry.name,
        virtualId: idx === 0 ? primaryVirtualId : `default_${type.toLowerCase()}_${toScriptSlug(entry.name)}`,
        getDefaultContent: (lang: ScriptLanguage = 'javascript') =>
            (lang === 'python' && entry.pythonCode) ? entry.pythonCode : entry.code
    }));
}

export const BUILT_IN_DEFAULT_SCRIPTS: BuiltInDefaultScriptDef[] = [
    ...buildDefaultDefsForList('Encryption', DEFAULT_ENCRYPTION_SCRIPTS, 'default_encrypt_fallback'),
    ...buildDefaultDefsForList('Encryption', DEFAULT_DECRYPTION_SCRIPTS, 'default_decrypt_fallback'),
    ...buildDefaultDefsForList('PreRequest', DEFAULT_PRE_REQUEST_SCRIPTS, 'default_prerequest_fallback'),
    ...buildDefaultDefsForList('PostRequest', DEFAULT_POST_RESPONSE_SCRIPTS, 'default_postresponse_fallback'),
    ...buildDefaultDefsForList('Test', DEFAULT_TEST_SCRIPTS, 'default_test_fallback')
];

@Injectable({
    providedIn: 'root'
})
export class ScriptManagementService {
    private http = inject(HttpClient);
    private authService = inject(AuthService);
    private notificationService = inject(NotificationService);
    private localStorageService = inject(LocalStorageService);

    // Store scripts globally
    scripts = signal<ScriptDto[]>([]);
    isLoading = signal<boolean>(false);

    constructor() {
        this.fetchMyScripts();

        // Fetch scripts when user logs in
        this.authService.onLogin.subscribe(() => {
            this.fetchMyScripts();
        });

        // Load offline scripts on logout
        this.authService.onLogout.subscribe(() => {
            this.fetchMyScripts();
        });
    }

    isBuiltInDefaultScript(type: string, name?: string, isDefault?: boolean, id?: string): boolean {
        if (id && id.startsWith('default_')) return true;
        if (isDefault) return true;
        const lowerName = (name || '').trim().toLowerCase();
        return BUILT_IN_DEFAULT_SCRIPTS.some(
            def => (!type || def.type === type) && def.name.trim().toLowerCase() === lowerName
        );
    }

    getDefaultContentForScript(type: string, name?: string, language: ScriptLanguage = 'javascript'): string {
        return getDefaultScriptCode(type, name, language);
    }

    getNewScriptGuideline(type: string, language: ScriptLanguage = 'javascript'): string {
        return getNewScriptGuidelineCode(type, language);
    }

    getScriptContent(type: string, name: string): string {
        const found = this.scripts().find(
            s => s.type === type && s.name.toLowerCase() === name.toLowerCase()
        );
        if (found && found.content && found.content.trim()) {
            return found.content;
        }

        const cached = this.readFromLocalCache(this.getStorageKey()).find(
            s => s.type === type && s.name.toLowerCase() === name.toLowerCase()
        );
        if (cached && cached.content && cached.content.trim()) {
            return cached.content;
        }

        return this.getDefaultContentForScript(type, name);
    }

    getBuiltInDefaultScripts(): ScriptDto[] {
        const now = new Date().toISOString();
        return BUILT_IN_DEFAULT_SCRIPTS.map(def => ({
            id: def.virtualId,
            userId: 'virtual',
            type: def.type,
            name: def.name,
            content: def.getDefaultContent(),
            isDefault: true,
            createdAt: now,
            updatedAt: now
        }));
    }

    getStorageKey(): string {
        const user = this.authService.currentUser();
        return user?.id ? `onsteroids_scripts_${user.id}` : 'onsteroids_offline_scripts';
    }

    readFromLocalCache(key: string): ScriptDto[] {
        let saved = this.localStorageService.getItem(key);
        // Fallback: If checking user-specific cache and it's empty, check offline cache
        if (!saved && key !== 'onsteroids_offline_scripts') {
            saved = this.localStorageService.getItem('onsteroids_offline_scripts');
        }
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            } catch (e) {
                console.error('Failed to parse cached scripts', e);
            }
        }
        return [];
    }

    saveToLocalCache(): void {
        const key = this.getStorageKey();
        this.localStorageService.setItem(key, JSON.stringify(this.scripts()));
        if (!this.authService.isLoggedIn()) {
            this.localStorageService.setItem('onsteroids_offline_scripts', JSON.stringify(this.scripts()));
        }
    }

    resolveScripts(localCache: ScriptDto[], dbScripts: ScriptDto[], isAuth: boolean): ScriptDto[] {
        const result: ScriptDto[] = [];
        const now = new Date().toISOString();

        // 3-Tier Loading for each built-in default script:
        // Tier 1: Local cache (if present and non-empty)
        // Tier 2: Database (for authenticated user only, if present and non-empty)
        // Tier 3: Default Snippet skeleton from script.snippets.constants.ts
        for (const def of BUILT_IN_DEFAULT_SCRIPTS) {
            const cached = localCache.find(
                s => s.type === def.type && s.name.toLowerCase() === def.name.toLowerCase()
            );
            const dbMatch = isAuth
                ? dbScripts.find(s => s.type === def.type && s.name.toLowerCase() === def.name.toLowerCase())
                : undefined;

            const cachedHasContent = !!(cached && cached.content && cached.content.trim().length > 0);
            const dbHasContent = !!(dbMatch && dbMatch.content && dbMatch.content.trim().length > 0);

            if (cachedHasContent) {
                // Tier 1: Load from local cache (and upgrade any legacy wrapped built-in default scripts to st.* syntax)
                const lang: ScriptLanguage = (cached!.language === 'python' ? 'python' : 'javascript');
                const upgradedContent = this.upgradeLegacyBuiltInContent(cached!.content, def, lang);
                result.push({
                    ...cached!,
                    id: (isAuth && dbMatch) ? dbMatch.id : (cached!.id || def.virtualId),
                    userId: (isAuth && dbMatch) ? dbMatch.userId : (cached!.userId || 'virtual'),
                    type: def.type,
                    name: def.name,
                    content: upgradedContent,
                    isDefault: true,
                    updatedAt: cached!.updatedAt || now
                });
            } else if (isAuth && dbHasContent) {
                // Tier 2: Load from DB for authenticated user (and upgrade legacy wrapped built-in defaults)
                const lang: ScriptLanguage = (dbMatch!.language === 'python' ? 'python' : 'javascript');
                const upgradedContent = this.upgradeLegacyBuiltInContent(dbMatch!.content, def, lang);
                result.push({
                    ...dbMatch!,
                    type: def.type,
                    name: def.name,
                    content: upgradedContent,
                    isDefault: true
                });
            } else {
                // Tier 3: Default to snippet skeleton
                result.push({
                    id: (isAuth && dbMatch) ? dbMatch.id : def.virtualId,
                    userId: (isAuth && dbMatch) ? dbMatch.userId : 'virtual',
                    type: def.type,
                    name: def.name,
                    content: def.getDefaultContent(),
                    isDefault: true,
                    createdAt: dbMatch?.createdAt || now,
                    updatedAt: dbMatch?.updatedAt || now
                });
            }
        }

        // Include custom (non-default) scripts from DB
        if (isAuth && dbScripts.length > 0) {
            for (const dbScript of dbScripts) {
                const isDefault = this.isBuiltInDefaultScript(dbScript.type, dbScript.name, dbScript.isDefault, dbScript.id);
                if (!isDefault) {
                    if (!result.some(s => s.id === dbScript.id)) {
                        result.push(dbScript);
                    }
                }
            }
        }

        // Include custom (non-default) scripts from local cache
        for (const cached of localCache) {
            if (!cached || !cached.name) continue;
            const isDefault = this.isBuiltInDefaultScript(cached.type, cached.name, cached.isDefault, cached.id);
            if (!isDefault) {
                const normalizedCached: ScriptDto = {
                    ...cached,
                    id: cached.id || generateUUID()
                };
                const alreadyIncluded = result.some(
                    s => s.id === normalizedCached.id || (s.type === normalizedCached.type && s.name.toLowerCase() === normalizedCached.name.toLowerCase())
                );
                if (!alreadyIncluded) {
                    result.push(normalizedCached);
                }
            }
        }

        // Apply safe JSON-comment stripping fix (never re-wrap scripts back into legacy parent functions)
        for (const script of result) {
            if (script.content) {
                script.content = script.content
                    .split(".replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, '')")
                    .join('.replace(/"(?:[^"\\\\]|\\\\.)*"|(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*)/g, (m, c) => c ? \'\' : m)')
                    .split('.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, "")')
                    .join('.replace(/"(?:[^"\\\\]|\\\\.)*"|(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*)/g, (m, c) => c ? "" : m)');
            }
        }

        return result;
    }

    /**
     * Upgrades legacy built-in default scripts that still contain an outer
     * `async function preScript/postScript/testScript/encryptScript/decryptScript(...)` wrapper
     * to top-level `st.*` syntax without losing user-authored custom lines.
     */
    private upgradeLegacyBuiltInContent(
        rawContent: string,
        def: BuiltInDefaultScriptDef,
        language: ScriptLanguage
    ): string {
        const content = (rawContent || '').trim();
        if (!content) return def.getDefaultContent(language);

        const legacyJsHeader = /^(?:\/\*(?:[\s\S]*?)\*\/\s*|\/\/[^\n]*\n\s*)*(?:async\s+)?function\s+(?:pre|post|test|encrypt|decrypt)Script\s*\([^)]*\)\s*\{([\s\S]*)\}\s*;?\s*$/;
        const match = content.match(legacyJsHeader);
        if (!match) return rawContent;

        const innerRaw = match[1] || '';
        const unindentedLines = innerRaw
            .split(/\r?\n/)
            .map(line => line.replace(/^[ \t]{1,4}/, ''));
        // Drop legacy `let passed = true;` / `return passed;` test wrapper boilerplate
        const meaningfulLines = unindentedLines.filter(line => {
            const t = line.trim();
            if (!t) return false;
            if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return false;
            if (/^(?:let|var|const)\s+passed\s*=\s*true\s*;?$/.test(t)) return false;
            if (/^return\s+passed\s*;?$/.test(t)) return false;
            if (/^console\.log\(\s*["']Running (?:pre-request|post-response|test)/i.test(t)) return false;
            return true;
        });

        const legacySampleMarkers = [
            'Encode targeted headers',
            'Decode targeted Base64 headers',
            'X-Correlation-ID',
            'Set env var "authUrl"',
            'X-Session-Token',
            'Status code is 2xx',
            'Enter custom pre-request',
            'Enter custom post-response',
            'Enter custom test'
        ];
        const isUnmodifiedLegacyTemplate =
            meaningfulLines.length === 0 ||
            legacySampleMarkers.some(marker => content.includes(marker));

        if (isUnmodifiedLegacyTemplate) {
            return def.getDefaultContent(language);
        }

        // Preserve custom user code inside the old built-in default, stripped of its outer function wrapper
        const strippedBody = unindentedLines
            .filter(line => {
                const t = line.trim();
                return !/^(?:let|var|const)\s+passed\s*=\s*true\s*;?$/.test(t) && !/^return\s+passed\s*;?$/.test(t);
            })
            .join('\n')
            .trim();
        return strippedBody || def.getDefaultContent(language);
    }

    ensureDefaultScripts(userScripts: ScriptDto[]): ScriptDto[] {
        const storageKey = this.getStorageKey();
        const localCache = this.readFromLocalCache(storageKey);
        return this.resolveScripts(localCache, userScripts, this.authService.isLoggedIn());
    }

    async fetchMyScripts(): Promise<void> {
        const isAuth = this.authService.isLoggedIn() && !this.authService.isTestUserSession();
        const storageKey = this.getStorageKey();
        const localCachedScripts = this.readFromLocalCache(storageKey);

        if (!isAuth) {
            const resolved = this.resolveScripts(localCachedScripts, [], false);
            this.scripts.set(resolved);
            this.saveToLocalCache();
            return;
        }

        // For authenticated users, immediately populate from local cache if present to avoid lag
        if (localCachedScripts.length > 0) {
            const preliminary = this.resolveScripts(localCachedScripts, [], true);
            this.scripts.set(preliminary);
        }

        this.isLoading.set(true);
        try {
            const res = await firstValueFrom(
                this.http.get<ApiResponse<ScriptDto[]>>(`${API_BASE_URL}/scripts`)
            );
            const dbScripts = res?.data || [];
            const resolved = this.resolveScripts(localCachedScripts, dbScripts, true);
            this.scripts.set(resolved);
            this.saveToLocalCache();
        } catch (err) {
            console.error('Failed to fetch scripts from DB', err);
            const fallback = this.resolveScripts(localCachedScripts, [], true);
            this.scripts.set(fallback);
            this.saveToLocalCache();
        } finally {
            this.isLoading.set(false);
        }
    }

    async createScript(type: string, name: string, content: string, language: ScriptLanguage = 'javascript'): Promise<ScriptDto | null> {
        if (!this.authService.isLoggedIn() || this.authService.isTestUserSession()) {
            const script: ScriptDto = { 
                id: generateUUID(), 
                userId: this.authService.currentUser()?.id || 'offline', 
                type, 
                name, 
                content, 
                language,
                isDefault: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            this.scripts.update(s => [...s, script]);
            this.saveToLocalCache();
            this.notificationService.notify('Script created successfully');
            return script;
        }

        try {
            const script = { type, name, content } as ScriptDto;
            const res = await firstValueFrom(
                this.http.post<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts`, script)
            );
            if (res && res.data) {
                const normalized: ScriptDto = {
                    ...res.data,
                    id: res.data.id || generateUUID(),
                    type: res.data.type || type,
                    name: res.data.name || name,
                    content: res.data.content ?? content,
                    isDefault: res.data.isDefault ?? false
                };
                this.scripts.update(s => [...s, normalized]);
                this.saveToLocalCache();
                this.notificationService.notify('Script created successfully');
                return normalized;
            }
        } catch (err) {
            console.error('Failed to create script', err);
            this.notificationService.notify('Failed to create script');
        }
        return null;
    }

    async updateScript(id: string, name: string, content: string): Promise<ScriptDto | null> {
        const isVirtual = (id || '').startsWith('default_');
        const target = this.scripts().find(x => x.id === id);
        const scriptType = target?.type || (
            name.toLowerCase().includes('decrypt') ? 'Encryption' :
            name.toLowerCase().includes('encrypt') ? 'Encryption' :
            name.toLowerCase().includes('pre-request') ? 'PreRequest' :
            name.toLowerCase().includes('post-response') ? 'PostRequest' :
            name.toLowerCase().includes('test') ? 'Test' : 'Encryption'
        );

        // 1. Update in-memory signal immediately
        let updatedScript: ScriptDto | null = null;
        this.scripts.update(list => list.map(x => {
            if (x.id === id) {
                updatedScript = { ...x, name, content, updatedAt: new Date().toISOString() };
                return updatedScript;
            }
            return x;
        }));

        // 2. Persist to local cache immediately
        this.saveToLocalCache();

        // 3. Offline or local test session: Done
        if (!this.authService.isLoggedIn() || this.authService.isTestUserSession()) {
            return updatedScript;
        }

        // 4. Authenticated: Update to backend
        if (isVirtual) {
            try {
                const res = await firstValueFrom(
                    this.http.post<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts`, {
                        type: scriptType,
                        name,
                        content
                    })
                );
                if (res && res.data) {
                    const created = res.data;
                    this.scripts.update(list => list.map(x => x.id === id ? { ...created, isDefault: x.isDefault ?? true } : x));
                    this.saveToLocalCache();
                    this.notificationService.notify('Script updated successfully');
                    return created;
                }
            } catch (err) {
                console.warn('Failed to create virtual script on backend via POST, trying fallback update', err);
                try {
                    const fetchRes = await firstValueFrom(
                        this.http.get<ApiResponse<ScriptDto[]>>(`${API_BASE_URL}/scripts`)
                    );
                    const existingOnBackend = fetchRes?.data?.find(
                        s => s.type === scriptType && s.name.toLowerCase() === name.toLowerCase()
                    );
                    if (existingOnBackend) {
                        const updateRes = await firstValueFrom(
                            this.http.put<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts/${existingOnBackend.id}`, {
                                name,
                                content
                            })
                        );
                        if (updateRes && updateRes.data) {
                            const updated = updateRes.data;
                            this.scripts.update(list => list.map(x => x.id === id ? { ...updated, isDefault: x.isDefault ?? true } : x));
                            this.saveToLocalCache();
                            this.notificationService.notify('Script updated successfully');
                            return updated;
                        }
                    }
                } catch (innerErr) {
                    console.error('Fallback backend update failed', innerErr);
                }
                this.notificationService.notify('Script saved locally; failed to sync to backend');
                return updatedScript;
            }
        } else {
            // Script already exists in DB: Send PUT
            try {
                const res = await firstValueFrom(
                    this.http.put<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts/${id}`, {
                        name,
                        content
                    })
                );
                if (res && res.data) {
                    const updated = res.data;
                    this.scripts.update(list => list.map(x => x.id === id ? { ...x, ...updated } : x));
                    this.saveToLocalCache();
                    this.notificationService.notify('Script updated successfully');
                    return updated;
                }
            } catch (err) {
                console.error('Failed to update script on backend', err);
                this.notificationService.notify('Script saved locally; failed to sync to backend');
                return updatedScript;
            }
        }

        return updatedScript;
    }

    async deleteScript(id: string): Promise<boolean> {
        const target = this.scripts().find(s => s.id === id);
        if ((id || '').startsWith('default_') || target?.isDefault || this.isBuiltInDefaultScript(target?.type || '', target?.name, target?.isDefault, id)) {
            this.notificationService.notify('Cannot delete built-in default scripts.');
            return false;
        }

        if (!this.authService.isLoggedIn() || this.authService.isTestUserSession()) {
            this.scripts.update(s => s.filter(x => x.id !== id));
            this.saveToLocalCache();
            this.notificationService.notify('Script deleted successfully');
            return true;
        }

        try {
            await firstValueFrom(
                this.http.delete<ApiResponse<boolean>>(`${API_BASE_URL}/scripts/${id}`)
            );
            this.scripts.update(s => s.filter(x => x.id !== id));
            this.saveToLocalCache();
            this.notificationService.notify('Script deleted successfully');
            return true;
        } catch (err) {
            console.error('Failed to delete script', err);
            this.notificationService.notify('Failed to delete script');
            return false;
        }
    }

    async resetScript(id: string, language?: ScriptLanguage): Promise<ScriptDto | null> {
        const targetScript = this.scripts().find(s => s.id === id);
        if (!targetScript) return null;

        const defaultContent = this.getDefaultContentForScript(
            targetScript.type,
            targetScript.name,
            language || targetScript.language || 'javascript'
        );
        const isVirtual = (id || '').startsWith('default_');

        let updatedScript: ScriptDto | null = null;
        this.scripts.update(list => list.map(x => {
            if (x.id === id) {
                updatedScript = { ...x, content: defaultContent, updatedAt: new Date().toISOString() };
                return updatedScript;
            }
            return x;
        }));
        this.saveToLocalCache();

        if (!this.authService.isLoggedIn() || this.authService.isTestUserSession() || isVirtual) {
            this.notificationService.notify('Script reset to default');
            return updatedScript;
        }

        try {
            const res = await firstValueFrom(
                this.http.put<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts/${id}`, {
                    name: targetScript.name,
                    content: defaultContent
                })
            );
            if (res && res.data) {
                this.scripts.update(list => list.map(x => x.id === id ? { ...x, ...res.data } : x));
                this.saveToLocalCache();
                this.notificationService.notify('Script reset to default successfully');
                return res.data;
            }
        } catch (err) {
            console.error('Failed to reset script on backend', err);
            this.notificationService.notify('Script reset locally; failed to sync to backend');
        }

        return updatedScript;
    }
}
