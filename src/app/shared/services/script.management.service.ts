import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../constants/api.constants';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { catchError, map } from 'rxjs/operators';
import { of, firstValueFrom } from 'rxjs';
import { LocalStorageService } from './local.storage.service';
import { generateUUID } from '../utils/uuid.util';
import { DEFAULT_ENCRYPTION_SCRIPT_SKELETON, DEFAULT_DECRYPTION_SCRIPT_SKELETON, DEFAULT_PRE_REQUEST_SCRIPT_SKELETON, DEFAULT_POST_RESPONSE_SCRIPT_SKELETON, DEFAULT_TEST_SCRIPT_SKELETON } from '../constants/script.snippets.constants';

export interface ScriptDto {
    id: string;
    userId: string;
    type: string;
    name: string;
    content: string;
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

    getDefaultContentForScript(type: string, name?: string): string {
        if (type === 'Encryption') {
            return (name && name.toLowerCase().includes('decrypt')) 
                ? DEFAULT_DECRYPTION_SCRIPT_SKELETON 
                : DEFAULT_ENCRYPTION_SCRIPT_SKELETON;
        }
        if (type === 'PreRequest') return DEFAULT_PRE_REQUEST_SCRIPT_SKELETON;
        if (type === 'PostRequest') return DEFAULT_POST_RESPONSE_SCRIPT_SKELETON;
        if (type === 'Test') return DEFAULT_TEST_SCRIPT_SKELETON;
        return '';
    }

    getScriptContent(type: string, name: string): string {
        const found = this.scripts().find(s => s.type === type && s.name.toLowerCase() === name.toLowerCase());
        if (found && found.content && found.content.trim()) {
            return found.content;
        }
        return this.getDefaultContentForScript(type, name);
    }

    getBuiltInDefaultScripts(): ScriptDto[] {
        const now = new Date().toISOString();
        return [
            {
                id: 'default_encrypt_fallback',
                userId: 'virtual',
                type: 'Encryption',
                name: 'Encrypt',
                content: DEFAULT_ENCRYPTION_SCRIPT_SKELETON,
                isDefault: true,
                createdAt: now,
                updatedAt: now
            },
            {
                id: 'default_decrypt_fallback',
                userId: 'virtual',
                type: 'Encryption',
                name: 'Decrypt',
                content: DEFAULT_DECRYPTION_SCRIPT_SKELETON,
                isDefault: true,
                createdAt: now,
                updatedAt: now
            },
            {
                id: 'default_prerequest_fallback',
                userId: 'virtual',
                type: 'PreRequest',
                name: 'Pre-request',
                content: DEFAULT_PRE_REQUEST_SCRIPT_SKELETON,
                isDefault: true,
                createdAt: now,
                updatedAt: now
            },
            {
                id: 'default_postresponse_fallback',
                userId: 'virtual',
                type: 'PostRequest',
                name: 'Post-response',
                content: DEFAULT_POST_RESPONSE_SCRIPT_SKELETON,
                isDefault: true,
                createdAt: now,
                updatedAt: now
            },
            {
                id: 'default_test_fallback',
                userId: 'virtual',
                type: 'Test',
                name: 'Test',
                content: DEFAULT_TEST_SCRIPT_SKELETON,
                isDefault: true,
                createdAt: now,
                updatedAt: now
            }
        ];
    }

    ensureDefaultScripts(userScripts: ScriptDto[]): ScriptDto[] {
        const builtIns = this.getBuiltInDefaultScripts();
        const result = [...userScripts];

        for (const builtIn of builtIns) {
            const existing = result.find(s => s.type === builtIn.type && s.name.toLowerCase() === builtIn.name.toLowerCase());
            if (!existing) {
                result.push({ ...builtIn });
            } else {
                // If the default script exists in the list but has empty or blank content,
                // populate it immediately with the standard skeleton from script.management.service
                if (!existing.content || !existing.content.trim()) {
                    existing.content = builtIn.content;
                }
                if (existing.isDefault === undefined) {
                    existing.isDefault = true;
                }
            }
        }

        return result;
    }

    async fetchMyScripts(): Promise<void> {
        if (!this.authService.isLoggedIn()) {
            this.loadOfflineScripts();
            return;
        }
        
        this.isLoading.set(true);
        try {
            const res = await firstValueFrom(
                this.http.get<ApiResponse<ScriptDto[]>>(`${API_BASE_URL}/scripts`)
            );
            if (res && res.data) {
                let userScripts = res.data;
                
                // Merge any currently loaded offline scripts that aren't on backend
                const offlineScripts = this.scripts().filter(s => s.id && !s.id.startsWith('default_') && !s.isDefault);
                const mergedScripts = [...userScripts];
                offlineScripts.forEach(os => {
                    if (!mergedScripts.find(ms => ms.id === os.id || ms.name === os.name)) {
                        mergedScripts.push(os);
                    }
                });

                // Always ensure default scripts for Encryption, Decryption, Pre-request, Post-response, Test
                // are populated with their standard skeletons
                const normalized = this.ensureDefaultScripts(mergedScripts);
                this.scripts.set(normalized);
            }
        } catch (err) {
            console.error('Failed to fetch scripts', err);
            this.loadOfflineScripts();
        } finally {
            this.isLoading.set(false);
        }
    }

    private loadOfflineScripts(): void {
        const saved = this.localStorageService.getItem('onsteroids_offline_scripts');
        let scriptsToLoad: ScriptDto[] = [];
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    scriptsToLoad = parsed;
                }
            } catch (e) { }
        }
        
        const normalized = this.ensureDefaultScripts(scriptsToLoad);
        this.scripts.set(normalized);
        this.saveOfflineScripts();
    }

    private saveOfflineScripts(): void {
        if (!this.authService.isLoggedIn()) {
            this.localStorageService.setItem('onsteroids_offline_scripts', JSON.stringify(this.scripts()));
        }
    }

    async createScript(type: string, name: string, content: string): Promise<ScriptDto | null> {
        if (!this.authService.isLoggedIn()) {
            const script = { 
                id: generateUUID(), 
                userId: 'offline', 
                type, 
                name, 
                content, 
                isDefault: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            } as ScriptDto;
            this.scripts.update(s => [...s, script]);
            this.saveOfflineScripts();
            this.notificationService.notify('Script created locally (offline)');
            return script;
        }

        try {
            const script = { type, name, content } as ScriptDto;
            const res = await firstValueFrom(
                this.http.post<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts`, script)
            );
            if (res && res.data) {
                this.scripts.update(s => [...s, res.data]);
                this.notificationService.notify('Script created successfully');
                return res.data;
            }
        } catch (err) {
            console.error('Failed to create script', err);
            this.notificationService.notify('Failed to create script');
        }
        return null;
    }

    async updateScript(id: string, name: string, content: string): Promise<ScriptDto | null> {
        let isVirtual = id === 'default_encrypt_fallback' || id === 'default_decrypt_fallback';

        if (!this.authService.isLoggedIn()) {
            let updatedScript: ScriptDto | null = null;
            this.scripts.update(s => s.map(x => {
                if (x.id === id) {
                    updatedScript = { ...x, name, content, updatedAt: new Date().toISOString() };
                    return updatedScript;
                }
                return x;
            }));
            this.saveOfflineScripts();
            this.notificationService.notify('Script updated locally (offline)');
            return updatedScript;
        }
        
        if (isVirtual && this.authService.isLoggedIn()) {
            // It's a virtual fallback, but user is logged in and modified it.
            // We should create it on the backend.
            return this.createScript('Encryption', name, content);
        }

        try {
            const script = { name, content } as ScriptDto;
            const res = await firstValueFrom(
                this.http.put<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts/${id}`, script)
            );
            if (res && res.data) {
                this.scripts.update(s => s.map(x => x.id === id ? res.data : x));
                this.notificationService.notify('Script updated successfully');
                return res.data;
            }
        } catch (err) {
            console.error('Failed to update script', err);
            this.notificationService.notify('Failed to update script');
        }
        return null;
    }

    async deleteScript(id: string): Promise<boolean> {
        const target = this.scripts().find(s => s.id === id);
        if (id.startsWith('default_') || target?.isDefault) {
            this.notificationService.notify('Cannot delete built-in default scripts.');
            return false;
        }

        if (!this.authService.isLoggedIn()) {
            this.scripts.update(s => s.filter(x => x.id !== id));
            this.saveOfflineScripts();
            this.notificationService.notify('Script deleted locally (offline)');
            return true;
        }

        try {
            await firstValueFrom(
                this.http.delete<ApiResponse<boolean>>(`${API_BASE_URL}/scripts/${id}`)
            );
            this.scripts.update(s => s.filter(x => x.id !== id));
            this.notificationService.notify('Script deleted successfully');
            return true;
        } catch (err) {
            console.error('Failed to delete script', err);
            this.notificationService.notify('Failed to delete script');
            return false;
        }
    }

    async resetScript(id: string): Promise<ScriptDto | null> {
        const isVirtual = id.startsWith('default_');
        const targetScript = this.scripts().find(s => s.id === id);
        if (!targetScript) return null;

        const defaultContent = this.getDefaultContentForScript(targetScript.type, targetScript.name);

        if (!this.authService.isLoggedIn() || isVirtual) {
            let updatedScript: ScriptDto | null = null;
            this.scripts.update(s => s.map(x => {
                if (x.id === id) {
                    updatedScript = { ...x, content: defaultContent, updatedAt: new Date().toISOString() };
                    return updatedScript;
                }
                return x;
            }));
            
            if (!this.authService.isLoggedIn()) {
                this.saveOfflineScripts();
                this.notificationService.notify('Script reset locally (offline)');
            } else if (isVirtual) {
                this.notificationService.notify('Script reset successfully');
            }
            return updatedScript;
        }

        // For real backend scripts, force the correct default content via an update
        // instead of relying on the backend /reset endpoint which might have outdated skeletons.
        try {
            const script = { name: targetScript.name, content: defaultContent } as ScriptDto;
            const res = await firstValueFrom(
                this.http.put<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts/${id}`, script)
            );
            if (res && res.data) {
                this.scripts.update(s => s.map(x => x.id === id ? res.data : x));
                this.notificationService.notify('Script reset to default successfully');
                return res.data;
            }
        } catch (err) {
            console.error('Failed to reset script', err);
            this.notificationService.notify('Failed to reset script');
        }
        return null;
    }
}
