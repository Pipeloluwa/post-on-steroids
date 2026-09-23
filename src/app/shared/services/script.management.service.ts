import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../constants/api.constants';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { catchError, map } from 'rxjs/operators';
import { of, firstValueFrom } from 'rxjs';
import { LocalStorageService } from './local.storage.service';
import { generateUUID } from '../utils/uuid.util';

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

const DEFAULT_ENCRYPT_SCRIPT = String.raw`async function encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths) {
    //only code written within this code block will be executed
    function getNestedValue(obj, path) {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }
    function setNestedValue(obj, path, value) {
        const parts = path.split('.');
        const last = parts.pop();
        const target = parts.reduce((acc, part) => {
            if (!acc[part]) acc[part] = {};
            return acc[part];
        }, obj);
        if (target) target[last] = value;
    }
    function getPrimitivePaths(obj, currentPath = '') {
        let paths = [];
        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                const path = currentPath ? \`\${currentPath}.\${key}\` : key;
                if (obj[key] !== null && typeof obj[key] === 'object') {
                    paths = paths.concat(getPrimitivePaths(obj[key], path));
                } else {
                    paths.push(path);
                }
            }
        }
        return paths;
    }
    const parameters = {};
    const shouldEncryptAllHeaders = typeof autoEncryptHeaders !== 'undefined' ? autoEncryptHeaders : false;
    const encHeadersList = encryptedHeaders || [];
    for (let h of headers) {
        if (h.enabled && h.key) {
            if (shouldEncryptAllHeaders || encHeadersList.includes(h.key)) {
                parameters[h.key] = h.value;
            }
        }
    }
    let bodyObj = null;
    if (body) {
        try {
            const cleanedBody = body.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();
            bodyObj = JSON.parse(cleanedBody);
        } catch (e) {}
    }
    if (bodyObj) {
        const shouldEncryptAllBody = typeof autoEncryptBody !== 'undefined' ? autoEncryptBody : false;
        const encBodyPathsList = encryptedBodyPaths || [];
        if (shouldEncryptAllBody) {
            const allPaths = getPrimitivePaths(bodyObj);
            for (let path of allPaths) {
                const val = getNestedValue(bodyObj, path);
                if (val !== undefined && val !== null) {
                    parameters[path] = val;
                }
            }
        } else {
            for (let path of encBodyPathsList) {
                const val = getNestedValue(bodyObj, path);
                if (val !== undefined && val !== null) {
                    parameters[path] = val;
                }
            }
        }
    }
    if (Object.keys(parameters).length > 0) {
        try {
            const response = await fetch('https://localhost:7131/api/v1/auth/encrypt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    parameters: parameters
                })
            });
            if (response.ok) {
                const result = await response.json();
                const encryptedParams = result.parameters || result;
                for (let h of headers) {
                    if (h.key && encryptedParams[h.key] !== undefined) {
                        h.value = String(encryptedParams[h.key]);
                    }
                }
                if (bodyObj) {
                    for (let key in encryptedParams) {
                        if (encryptedParams.hasOwnProperty(key)) {
                            if (key.includes('.') || getNestedValue(bodyObj, key) !== undefined) {
                                setNestedValue(bodyObj, key, encryptedParams[key]);
                            }
                        }
                    }
                    body = JSON.stringify(bodyObj, null, 2);
                }
            }
        } catch (error) {
            console.error('Error during payload encryption:', error);
        }
    }
    return body;
}`;

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
                // If backend does not provide the default Encrypt script, inject a fallback
                if (!userScripts.find(s => s.name === 'Encrypt' && s.type === 'Encryption')) {
                    userScripts.push({
                        id: 'default_encrypt_fallback',
                        userId: 'virtual',
                        type: 'Encryption',
                        name: 'Encrypt',
                        content: DEFAULT_ENCRYPT_SCRIPT,
                        isDefault: true,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                }
                this.scripts.set(userScripts);
            }
        } catch (err) {
            console.error('Failed to fetch scripts', err);
        } finally {
            this.isLoading.set(false);
        }
    }

    private loadOfflineScripts(): void {
        const saved = this.localStorageService.getItem('onsteroids_offline_scripts');
        if (saved) {
            try {
                let userScripts = JSON.parse(saved);
                if (Array.isArray(userScripts)) {
                if (!userScripts.find(s => s.name === 'Encrypt' && s.type === 'Encryption')) {
                    userScripts.push({
                        id: 'default_encrypt_fallback',
                        userId: 'virtual',
                        type: 'Encryption',
                        name: 'Encrypt',
                        content: DEFAULT_ENCRYPT_SCRIPT,
                        isDefault: true,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                    }
                    this.scripts.set(userScripts);
                    return;
                }
            } catch (e) { }
        }
        
        // Load default fallback
        const defaultScripts: ScriptDto[] = [
            {
                id: generateUUID(),
                userId: 'offline',
                type: 'Encryption',
                name: 'Encrypt',
                content: DEFAULT_ENCRYPT_SCRIPT,
                isDefault: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ];
        this.scripts.set(defaultScripts);
        this.saveOfflineScripts(); // Ensure it gets saved so the UUID doesn't change on next load
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
        if (id === 'default_encrypt_fallback') {
            this.notificationService.notify('Cannot edit the virtual fallback script directly.');
            return null;
        }

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
        if (id === 'default_encrypt_fallback') {
            this.notificationService.notify('Cannot delete the virtual fallback script.');
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
        if (id === 'default_encrypt_fallback') {
            return null;
        }

        if (!this.authService.isLoggedIn()) {
            let updatedScript: ScriptDto | null = null;
            this.scripts.update(s => s.map(x => {
                if (x.id === id) {
                    updatedScript = { ...x, content: DEFAULT_ENCRYPT_SCRIPT, updatedAt: new Date().toISOString() };
                    return updatedScript;
                }
                return x;
            }));
            this.saveOfflineScripts();
            this.notificationService.notify('Script reset locally (offline)');
            return updatedScript;
        }

        try {
            const res = await firstValueFrom(
                this.http.post<ApiResponse<ScriptDto>>(`${API_BASE_URL}/scripts/${id}/reset`, {})
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
