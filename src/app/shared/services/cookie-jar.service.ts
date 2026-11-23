import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { generateUUID } from '../utils/uuid.util';

export interface ManagedCookie {
  id: string;
  domain: string;
  name: string;
  value: string;
  path: string;
  expires?: string;
  enabled: boolean;
  source: 'manual' | 'response';
  updatedAt: number;
}

const COOKIE_JAR_STORAGE_KEY = 'onsteroids_cookie_jar';

@Injectable({
  providedIn: 'root'
})
export class CookieJarService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  cookies = signal<ManagedCookie[]>(this.loadFromStorage());

  private loadFromStorage(): ManagedCookie[] {
    if (!this.isBrowser) return [];
    try {
      const raw = localStorage.getItem(COOKIE_JAR_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persist(list: ManagedCookie[]): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(COOKIE_JAR_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage quota errors
    }
  }

  upsertCookie(cookie: Omit<ManagedCookie, 'id' | 'updatedAt'> & { id?: string }): void {
    const cleanDomain = (cookie.domain || '').trim().toLowerCase().replace(/^\.+/, '');
    const cleanName = (cookie.name || '').trim();
    if (!cleanDomain || !cleanName) return;

    this.cookies.update(curr => {
      const idx = cookie.id
        ? curr.findIndex(c => c.id === cookie.id)
        : curr.findIndex(c => c.domain === cleanDomain && c.name === cleanName);

      const entry: ManagedCookie = {
        id: cookie.id || (idx !== -1 ? curr[idx].id : generateUUID()),
        domain: cleanDomain,
        name: cleanName,
        value: cookie.value ?? '',
        path: (cookie.path || '/').trim() || '/',
        expires: cookie.expires || '',
        enabled: cookie.enabled !== false,
        source: cookie.source || 'manual',
        updatedAt: Date.now()
      };

      const next = [...curr];
      if (idx !== -1) {
        next[idx] = entry;
      } else {
        next.unshift(entry);
      }
      this.persist(next);
      return next;
    });
  }

  captureResponseCookies(requestUrl: string, responseCookies: { name: string; value: string; domain?: string; path?: string; expires?: string }[]): void {
    if (!responseCookies?.length) return;
    let fallbackHost = '';
    try {
      fallbackHost = new URL(requestUrl).hostname;
    } catch {
      fallbackHost = '';
    }
    for (const c of responseCookies) {
      if (!c?.name) continue;
      this.upsertCookie({
        domain: c.domain || fallbackHost,
        name: c.name,
        value: c.value || '',
        path: c.path || '/',
        expires: c.expires || '',
        enabled: true,
        source: 'response'
      });
    }
  }

  toggleCookie(id: string): void {
    this.cookies.update(curr => {
      const next = curr.map(c => (c.id === id ? { ...c, enabled: !c.enabled, updatedAt: Date.now() } : c));
      this.persist(next);
      return next;
    });
  }

  deleteCookie(id: string): void {
    this.cookies.update(curr => {
      const next = curr.filter(c => c.id !== id);
      this.persist(next);
      return next;
    });
  }

  clearDomain(domain: string): void {
    const clean = domain.trim().toLowerCase();
    this.cookies.update(curr => {
      const next = curr.filter(c => c.domain !== clean);
      this.persist(next);
      return next;
    });
  }

  clearAll(): void {
    this.cookies.set([]);
    this.persist([]);
  }

  getCookieHeaderForUrl(targetUrl: string): string {
    if (!targetUrl) return '';
    let host = '';
    let path = '/';
    try {
      const parsed = new URL(targetUrl);
      host = parsed.hostname.toLowerCase();
      path = parsed.pathname || '/';
    } catch {
      return '';
    }
    const matching = this.cookies().filter(c => {
      if (!c.enabled || !c.name) return false;
      const domainMatch = host === c.domain || host.endsWith(`.${c.domain}`);
      const pathMatch = path.startsWith(c.path || '/');
      return domainMatch && pathMatch;
    });
    if (matching.length === 0) return '';
    return matching.map(c => `${c.name}=${c.value}`).join('; ');
  }
}
