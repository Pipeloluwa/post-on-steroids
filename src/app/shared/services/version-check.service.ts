import { Injectable, inject, PLATFORM_ID, NgZone } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { APP_VERSION_INFO } from '../../../environments/version';
import { getAppBaseUrl } from '../utils/url.util';

@Injectable({
  providedIn: 'root'
})
export class VersionCheckService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly ngZone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly isElectron =
    typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);

  private isUpdating = false;

  init(): void {
    if (!this.isBrowser || this.isElectron) {
      return;
    }

    // 1. Clean up temporary cache-busting query tokens from the URL bar after app bootstraps
    this.cleanUrlParams();

    // 2. Set up global error listener to recover automatically from chunk loading errors
    this.setupChunkErrorRecovery();

    // 3. Listen for window focus and tab visibility change to check for deployments
    this.setupLifecycleListeners();
  }

  /**
   * Cleans up _cb or _t query parameters from browser address bar without triggering reload
   */
  cleanUrlParams(): void {
    if (!this.isBrowser || this.isElectron) {
      return;
    }

    try {
      setTimeout(() => {
        const url = new URL(window.location.href);
        let modified = false;
        if (url.searchParams.has('_cb')) {
          url.searchParams.delete('_cb');
          modified = true;
        }
        if (url.searchParams.has('_t')) {
          url.searchParams.delete('_t');
          modified = true;
        }
        if (modified) {
          const query = url.searchParams.toString();
          const cleanUrl = url.pathname + (query ? `?${query}` : '') + url.hash;
          window.history.replaceState({}, document.title, cleanUrl);
        }
      }, 1200);
    } catch {
      // Ignore if URL or history manipulation fails
    }
  }

  /**
   * Fetches latest version metadata from the web server using a timestamp in the URL
   * to guarantee the version check itself is never cached by browser or proxy.
   */
  async checkForUpdates(): Promise<boolean> {
    if (!this.isBrowser || this.isElectron || this.isUpdating) {
      return false;
    }

    try {
      const baseUrl = getAppBaseUrl().replace(/\/+$/, '');
      const versionUrl = `${baseUrl ? `${baseUrl}/` : '/'}version.json?_t=${Date.now()}`;
      const response = await fetch(versionUrl, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as { buildTime?: number; version?: string };
      if (data && typeof data.buildTime === 'number') {
        if (data.buildTime > APP_VERSION_INFO.buildTime) {
          this.triggerUpdate(data.buildTime);
          return true;
        }
      }
    } catch {
      // Network check failed (e.g., offline); ignore silently
    }

    return false;
  }

  /**
   * Forces a browser reload to fetch the latest application build using the URL
   */
  triggerUpdate(newBuildTime: number): void {
    if (this.isUpdating) {
      return;
    }
    this.isUpdating = true;

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('_v', newBuildTime.toString());
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }

  /**
   * Automatically reloads the application if a lazy chunk fails to load due to a new deployment
   */
  private setupChunkErrorRecovery(): void {
    window.addEventListener('error', (event: ErrorEvent) => {
      const message = event.message || '';
      if (/Failed to fetch dynamically imported module|Loading chunk [\d]+ failed/i.test(message)) {
        this.recoverFromStaleChunk();
      }
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = typeof reason === 'string' ? reason : reason?.message || '';
      if (/Failed to fetch dynamically imported module|Loading chunk [\d]+ failed/i.test(message)) {
        this.recoverFromStaleChunk();
      }
    });
  }

  private recoverFromStaleChunk(): void {
    const key = '__onsteroid_chunk_reload__';
    const lastReload = sessionStorage.getItem(key);
    const now = Date.now();

    // Prevent endless reload loop if an error occurs repeatedly within 10 seconds
    if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
      sessionStorage.setItem(key, now.toString());
      const url = new URL(window.location.href);
      url.searchParams.set('_cb', now.toString());
      window.location.replace(url.toString());
    }
  }

  private setupLifecycleListeners(): void {
    // Run outside Angular zone so timer doesn't interfere with change detection / hydration
    this.ngZone.runOutsideAngular(() => {
      // Check for updates when user returns to tab
      window.addEventListener('focus', () => {
        void this.checkForUpdates();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void this.checkForUpdates();
        }
      });

      // Background periodic check every 15 minutes
      setInterval(() => {
        void this.checkForUpdates();
      }, 15 * 60 * 1000);

      // Initial check 5 seconds after launch to ensure server is reachable
      setTimeout(() => {
        void this.checkForUpdates();
      }, 5000);
    });
  }
}
