import { Injectable, inject } from '@angular/core';
import { TabStateService, RequestState } from './tab.state.service';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class AutoAuthService {
    private tabStateService = inject(TabStateService);
    private http = inject(HttpClient);

    isAutoAuthEnabled() {
        return this.tabStateService.autoAuthEnabled();
    }

    getAutoAuthEndpointId() {
        return this.tabStateService.autoAuthEndpointId();
    }

    setAutoAuthEnabled(enabled: boolean) {
        this.tabStateService.autoAuthEnabled.set(enabled);
    }

    setAutoAuthEndpointId(id: string | null) {
        this.tabStateService.autoAuthEndpointId.set(id);
    }

    /**
     * Intelligently scan open tabs to find one that looks like a login endpoint.
     */
    detectLoginEndpoint(): RequestState | null {
        // Try all open tabs
        const openTabs = this.tabStateService.getAllOpenTabs();
        
        // Match patterns in name or URL
        const loginPatterns = ['login', 'auth', 'signin', 'authenticate', 'token', 'oauth'];

        for (const tab of openTabs) {
            const nameMatch = loginPatterns.some(p => tab.name.toLowerCase().includes(p));
            const urlMatch = loginPatterns.some(p => tab.url.toLowerCase().includes(p));
            
            if (nameMatch || urlMatch) {
                return tab;
            }
        }
        
        // Return the first POST request if no explicit match, or just null
        return openTabs.find(t => t.method === 'POST') || null;
    }

    /**
     * Recursively walks an object to find an access token string.
     */
    extractAccessToken(responseBody: any): string | null {
        if (!responseBody || typeof responseBody !== 'object') return null;

        let fallbackToken: string | null = null;
        
        const searchForToken = (obj: any): string | null => {
            if (!obj || typeof obj !== 'object') return null;

            for (const key of Object.keys(obj)) {
                const val = obj[key];
                const keyLower = key.toLowerCase();
                
                // Match keys that sound like a token
                if (keyLower.includes('access') || keyLower.includes('token') || keyLower.includes('jwt') || keyLower.includes('bearer')) {
                    if (typeof val === 'string') {
                        // Priority 1: User specified "starts with e" (e.g. eyJ for JWT)
                        if (val.startsWith('e')) {
                            return val;
                        }
                        // Priority 2: Fallback to the first token-like string found
                        if (!fallbackToken) {
                            fallbackToken = val;
                        }
                    }
                }

                // Recurse into nested objects
                if (typeof val === 'object' && val !== null) {
                    const found = searchForToken(val);
                    if (found) return found;
                }
            }
            return null;
        };

        const token = searchForToken(responseBody);
        return token || fallbackToken;
    }

}
