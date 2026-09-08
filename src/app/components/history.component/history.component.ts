import { Component, ChangeDetectionStrategy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { TabStateService, RequestState } from '../../shared/services/tab.state.service';
import { AuthService } from '../../shared/services/auth.service';
import { NotificationService } from '../../shared/services/notification.service';
import { API_BASE_URL } from '../../shared/constants/api.constants';

export interface HistoryItem {
    id: string;
    method: string;
    url: string;
    time?: string;
    createdAt?: string;
    responseStatus?: number;
    responseTime?: number;
    responseSize?: number;
    requestSnapshot?: string;
}

@Component({
    selector: 'app-history-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './history.component.html',
    styleUrl: './history.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HistoryComponent implements OnInit {
    private http = inject(HttpClient);
    private router = inject(Router);
    private tabStateService = inject(TabStateService);
    private authService = inject(AuthService);
    private notificationService = inject(NotificationService);

    history = signal<HistoryItem[]>([]);
    isLoading = signal<boolean>(false);
    deletingId = signal<string | null>(null);

    async ngOnInit() {
        await this.loadHistory();
    }

    async loadHistory() {
        this.isLoading.set(true);
        let items: HistoryItem[] = [];

        // 1. Load from local cache first for instant feedback
        try {
            const raw = localStorage.getItem('onsteroids_history');
            if (raw) {
                items = JSON.parse(raw);
            }
        } catch { }

        // 2. Fetch from backend if logged in
        if (this.authService.isLoggedIn()) {
            try {
                const res = await firstValueFrom(
                    this.http.get<{ data: any[] }>(`${API_BASE_URL}/History?limit=100`)
                );
                if (res?.data && Array.isArray(res.data)) {
                    items = res.data.map(d => ({
                        id: String(d.id),
                        method: d.method || 'GET',
                        url: d.url || '',
                        requestSnapshot: d.requestSnapshot,
                        responseStatus: d.responseStatus,
                        responseTime: d.responseTime,
                        responseSize: d.responseSize,
                        createdAt: d.createdAt,
                        time: this.formatTime(d.createdAt)
                    }));
                    // Sync backend history to localStorage
                    try {
                        localStorage.setItem('onsteroids_history', JSON.stringify(items));
                    } catch { }
                }
            } catch (err) {
                console.warn('Could not fetch history from backend, using local copy', err);
            }
        }

        // Format times if not set
        items = items.map(item => ({
            ...item,
            time: item.time || this.formatTime(item.createdAt)
        }));

        this.history.set(items);
        this.isLoading.set(false);
    }

    getMethodColor(method: string): string {
        switch (method.toUpperCase()) {
            case 'GET': return '#00BF8E';
            case 'POST': return '#FFB400';
            case 'PUT': return '#097BED';
            case 'PATCH': return '#A855F7';
            case 'DEL':
            case 'DELETE': return '#FF5233';
            default: return 'var(--postonsteroids-text-primary)';
        }
    }

    formatTime(dateStr?: string): string {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) return `${diffHours}h ago`;
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays < 7) return `${diffDays}d ago`;
            return date.toLocaleDateString();
        } catch {
            return dateStr;
        }
    }

    async restoreHistoryItem(item: HistoryItem) {
        try {
            let parsedSnapshot: Partial<RequestState> = {};
            if (item.requestSnapshot) {
                try {
                    parsedSnapshot = JSON.parse(item.requestSnapshot);
                } catch { }
            }

            const newId = this.tabStateService.createId();
            const baseState = this.tabStateService.getDefaultState(newId);

            const restoredState: RequestState = {
                ...baseState,
                ...parsedSnapshot,
                id: newId,
                name: parsedSnapshot.name || this.tabStateService.resolveRequestTitle(undefined, item.url),
                url: item.url || parsedSnapshot.url || '',
                method: (item.method || parsedSnapshot.method || 'GET').toUpperCase(),
                responseBody: parsedSnapshot.responseBody ?? null,
                responseStatus: item.responseStatus ?? parsedSnapshot.responseStatus ?? null,
                responseTime: item.responseTime ?? parsedSnapshot.responseTime ?? null,
                responseSize: item.responseSize ?? parsedSnapshot.responseSize ?? null,
                responseHeaders: parsedSnapshot.responseHeaders ?? [],
                responseCookies: parsedSnapshot.responseCookies ?? [],
                testResults: parsedSnapshot.testResults ?? [],
                isDirty: false
            };

            // Cache response if available
            if (restoredState.responseBody || restoredState.responseStatus) {
                this.tabStateService.cacheResponse(newId, restoredState.url, {
                    responseBody: restoredState.responseBody,
                    responseStatus: restoredState.responseStatus,
                    responseTime: restoredState.responseTime,
                    responseSize: restoredState.responseSize,
                    responseHeaders: restoredState.responseHeaders,
                    responseCookies: restoredState.responseCookies,
                    testResults: restoredState.testResults
                });
            }

            this.tabStateService.addOpenTab(restoredState);
            this.tabStateService.setActiveTab(newId);
            this.notificationService.notify(`Restored "${restoredState.name}" into workspace.`);
            this.router.navigate(['/workspace']);
        } catch (err: any) {
            console.error('Failed to restore history item:', err);
            this.notificationService.notify('Could not restore request from history.');
        }
    }

    async deleteItem(item: HistoryItem, event: MouseEvent) {
        event.stopPropagation();
        if (!window.confirm('Delete this history record?')) return;

        this.deletingId.set(item.id);
        try {
            if (this.authService.isLoggedIn()) {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/History/${item.id}`)
                );
            }

            // Remove from local storage
            const updated = this.history().filter(h => h.id !== item.id);
            this.history.set(updated);
            try {
                localStorage.setItem('onsteroids_history', JSON.stringify(updated));
            } catch { }

            this.notificationService.notify('History record deleted.');
        } catch (err: any) {
            console.error('Failed to delete history item:', err);
            this.notificationService.notify('Could not delete history record.');
        } finally {
            this.deletingId.set(null);
        }
    }

    async clearHistory() {
        if (this.history().length === 0) return;
        if (!window.confirm('Are you sure you want to clear all history records?')) return;

        try {
            if (this.authService.isLoggedIn()) {
                await firstValueFrom(
                    this.http.delete(`${API_BASE_URL}/History/clear`)
                );
            }

            this.history.set([]);
            try {
                localStorage.removeItem('onsteroids_history');
            } catch { }

            this.notificationService.notify('All history records cleared.');
        } catch (err: any) {
            console.error('Failed to clear history:', err);
            this.notificationService.notify('Could not clear history.');
        }
    }
}
