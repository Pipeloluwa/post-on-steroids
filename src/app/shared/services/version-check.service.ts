import { Injectable, inject, PLATFORM_ID, NgZone, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { APP_VERSION_INFO } from '../../../environments/version';
import { getAppBaseUrl } from '../utils/url.util';

const LAST_SEEN_VERSION_STORAGE_KEY = 'onsteroids_last_seen_version_info';

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
  private initialized = false;

  whatsNewModalRequested = signal<boolean>(false);

  consumeWhatsNewRequest(): void {
    this.whatsNewModalRequested.set(false);
  }

  init(): void {
    if (!this.isBrowser || this.initialized) {
      return;
    }
    this.initialized = true;

    // Detect newly installed updates (Electron updater, web installer overwrite, or web reload)
    void this.checkPostUpdateWhatsNew();

    if (this.isElectron) {
      return;
    }

    // 1. Clean up temporary cache-busting query tokens from the URL bar after app bootstraps
    this.cleanUrlParams();

    // 2. Set up global error listener to recover automatically from chunk loading errors
    this.setupChunkErrorRecovery();

    // 3. Listen for window focus and tab visibility change to check for deployments
    this.setupLifecycleListeners();
  }

  private compareSemver(a: string, b: string): number {
    const parse = (v: string) =>
      String(v || '')
        .trim()
        .replace(/^v/i, '')
        .replace(/-.*$/, '')
        .split('.')
        .map((n) => Number(n) || 0);
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  private async checkPostUpdateWhatsNew(): Promise<void> {
    if (!this.isBrowser) return;

    let shouldOpenWhatsNew = false;

    if (this.isElectron) {
      try {
        const electronApi = (window as any).electronAPI;
        if (electronApi && typeof electronApi.consumePendingWhatsNew === 'function') {
          const pending = await electronApi.consumePendingWhatsNew();
          if (pending) {
            shouldOpenWhatsNew = true;
          }
        }
      } catch {
        // Ignore IPC errors
      }
    }

    try {
      const hasReloadVersionParam =
        !this.isElectron && new URLSearchParams(window.location.search).has('_v');
      const rawPrev = localStorage.getItem(LAST_SEEN_VERSION_STORAGE_KEY);
      if (rawPrev) {
        const prev = JSON.parse(rawPrev) as { version?: string; buildTime?: number };
        const prevVer = prev?.version || '';
        const prevBuildTime = Number(prev?.buildTime || 0);
        const currVer = APP_VERSION_INFO.version;
        const currBuildTime = Number(APP_VERSION_INFO.buildTime || 0);

        if (this.compareSemver(currVer, prevVer) > 0) {
          shouldOpenWhatsNew = true;
        } else if (
          this.compareSemver(currVer, prevVer) === 0 &&
          currBuildTime > 0 &&
          prevBuildTime > 0 &&
          currBuildTime > prevBuildTime &&
          (this.isElectron || hasReloadVersionParam)
        ) {
          shouldOpenWhatsNew = true;
        }
      } else if (hasReloadVersionParam) {
        shouldOpenWhatsNew = true;
      }

      localStorage.setItem(
        LAST_SEEN_VERSION_STORAGE_KEY,
        JSON.stringify({
          version: APP_VERSION_INFO.version,
          buildTime: APP_VERSION_INFO.buildTime
        })
      );
    } catch {
      // Ignore storage errors
    }

    if (shouldOpenWhatsNew) {
      this.whatsNewModalRequested.set(true);
    }
  }

  /**
   * Cleans up _cb, _t, or _v query parameters from browser address bar without triggering reload
   */
  cleanUrlParams(): void {
    if (!this.isBrowser || this.isElectron) {
      return;
    }

    try {
      setTimeout(() => {
        const url = new URL(window.location.href);
        let modified = false;
        for (const param of ['_cb', '_t', '_v']) {
          if (url.searchParams.has(param)) {
            url.searchParams.delete(param);
            modified = true;
          }
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
