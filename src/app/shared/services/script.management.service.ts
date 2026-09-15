import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../constants/api.constants';
import { AuthService } from './auth.service';
import { NotificationService } from './notification.service';
import { catchError, map } from 'rxjs/operators';
import { of, firstValueFrom } from 'rxjs';

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

    // Store scripts globally
    scripts = signal<ScriptDto[]>([]);
    isLoading = signal<boolean>(false);

    constructor() {
        if (this.authService.isLoggedIn()) {
            this.fetchMyScripts();
        }

        // Fetch scripts when user logs in
        this.authService.onLogin.subscribe(() => {
            this.fetchMyScripts();
        });

        // Clear scripts on logout
        this.authService.onLogout.subscribe(() => {
            this.scripts.set([]);
        });
    }

    async fetchMyScripts(): Promise<void> {
        if (!this.authService.isLoggedIn()) return;
        
        this.isLoading.set(true);
        try {
            const res = await firstValueFrom(
                this.http.get<ApiResponse<ScriptDto[]>>(`${API_BASE_URL}/scripts`)
            );
            if (res && res.data) {
                this.scripts.set(res.data);
            }
        } catch (err) {
            console.error('Failed to fetch scripts', err);
        } finally {
            this.isLoading.set(false);
        }
    }

    async createScript(type: string, name: string, content: string): Promise<ScriptDto | null> {
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
