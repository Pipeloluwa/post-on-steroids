import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    show = signal<boolean>(false);
    message = signal<string>('');
    type = signal<'success' | 'warning' | 'error' | 'info'>('success');
    private hideTimeout: any = null;

    notify(message: string, type: 'success' | 'warning' | 'error' | 'info' = 'success', durationMs: number = 6000) {
        clearTimeout(this.hideTimeout);
        this.message.set(message);
        this.type.set(type);
        this.show.set(true);
        this.hideTimeout = setTimeout(() => this.show.set(false), durationMs);
    }
}
