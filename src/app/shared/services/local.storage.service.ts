import { Injectable, PLATFORM_ID, inject } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";

@Injectable({
    providedIn: 'root'
})
export class LocalStorageService {
    static readonly JSON_RESIZE_HEIGHT = 'workspace_request_height';
    static readonly STORAGE_KEY = 'post_on_steroids_variables';
    
    private platformId = inject(PLATFORM_ID);

    setItem(key: string, value: string) {
        if (isPlatformBrowser(this.platformId)) {
            localStorage.setItem(key, value);
        }
    }

    getItem(key: string) {
        if (isPlatformBrowser(this.platformId)) {
            return localStorage.getItem(key);
        }
        return null;
    }

    removeItem(key: string) {
        if (isPlatformBrowser(this.platformId)) {
            localStorage.removeItem(key);
        }
    }

    clear() {
        if (isPlatformBrowser(this.platformId)) {
            localStorage.clear();
        }
    }
}