import { Injectable, signal, PLATFORM_ID, inject, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NotificationService } from './notification.service';

@Injectable({
    providedIn: 'root'
})
export class NetworkService {
    private platformId = inject(PLATFORM_ID);
    private notificationService = inject(NotificationService);

    isOnline = signal<boolean>(true);
    wasOffline = false;

    constructor() {
        if (isPlatformBrowser(this.platformId)) {
            this.isOnline.set(navigator.onLine);

            window.addEventListener('online', () => {
                this.isOnline.set(true);
                if (this.wasOffline) {
                    this.notificationService.notify('Internet connection restored.');
                    this.wasOffline = false;
                }
            });

            window.addEventListener('offline', () => {
                this.isOnline.set(false);
                this.wasOffline = true;
                this.notificationService.notify('Internet connection lost. You are currently offline.');
            });
        }
    }
}
