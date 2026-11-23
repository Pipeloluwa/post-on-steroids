import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { isElectronApp } from '../utils/url.util';

export interface InstalledSandboxPackage {
  name: string;
  version: string;
  description?: string;
  code: string;
  sizeBytes: number;
  installedAt: number;
}

const SANDBOX_PKGS_STORAGE_KEY = 'onsteroids_sandbox_npm_packages';

@Injectable({
  providedIn: 'root'
})
export class SandboxPackagesService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private http = inject(HttpClient);

  packages = signal<InstalledSandboxPackage[]>(this.loadFromStorage());

  private loadFromStorage(): InstalledSandboxPackage[] {
    if (!this.isBrowser) return [];
    try {
      const raw = localStorage.getItem(SANDBOX_PKGS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private persist(list: InstalledSandboxPackage[]): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(SANDBOX_PKGS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage quota errors
    }
  }

  getPackageCodeMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const pkg of this.packages()) {
      if (pkg.name && pkg.code) {
        out[pkg.name] = pkg.code;
      }
    }
    return out;
  }

  private async fetchText(url: string): Promise<string> {
    const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    if (isElectronApp() && electronApi?.executeHttpRequest) {
      const res = await electronApi.executeHttpRequest({
        url,
        method: 'GET',
        headers: { Accept: '*/*' },
        verifySsl: false,
        followRedirects: true,
        timeoutMs: 30000
      });
      if (!res?.ok || (res.statusCode && res.statusCode >= 400)) {
        throw new Error(res?.errorMessage || `HTTP ${res?.statusCode || 0}`);
      }
      return String(res.body || '');
    }

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    } catch {
      const proxyRes: any = await firstValueFrom(
        this.http.post(environment.proxyUrl, {
          url,
          method: 'GET',
          headers: { Accept: '*/*' },
          verifySsl: false,
          timeoutMs: 30000
        })
      );
      const data = proxyRes?.data ?? proxyRes;
      if (data?.statusCode && data.statusCode >= 400) {
        throw new Error(`HTTP ${data.statusCode}`);
      }
      return String(data?.body ?? data ?? '');
    }
  }

  async installPackage(rawSpec: string): Promise<InstalledSandboxPackage> {
    const spec = (rawSpec || '').trim().replace(/^['"]|['"]$/g, '');
    if (!spec) throw new Error('Package name is required.');

    // Parse scoped (@org/pkg@1.2.3) vs unscoped (lodash@4.17.21)
    let pkgName = spec;
    let requestedVer = 'latest';
    const lastAt = spec.lastIndexOf('@');
    if (lastAt > 0) {
      pkgName = spec.slice(0, lastAt);
      requestedVer = spec.slice(lastAt + 1) || 'latest';
    }

    // 1. Resolve version + description from npm registry
    let resolvedVersion = requestedVer === 'latest' ? '' : requestedVer;
    let description = '';
    try {
      const metaUrl = requestedVer === 'latest'
        ? `https://registry.npmjs.org/${pkgName}/latest`
        : `https://registry.npmjs.org/${pkgName}/${requestedVer}`;
      const metaRaw = await this.fetchText(metaUrl);
      const meta = JSON.parse(metaRaw);
      resolvedVersion = String(meta?.version || resolvedVersion || 'latest');
      description = String(meta?.description || '');
    } catch {
      if (!resolvedVersion) resolvedVersion = 'latest';
    }

    const versionSlug = resolvedVersion === 'latest' ? '' : `@${resolvedVersion}`;
    const cdnCandidates = [
      `https://esm.sh/${pkgName}${versionSlug}?bundle`,
      `https://cdn.jsdelivr.net/npm/${pkgName}${versionSlug}/+esm`
    ];

    let bundleCode = '';
    let lastErr: unknown = null;
    for (const url of cdnCandidates) {
      try {
        const txt = await this.fetchText(url);
        if (txt && txt.trim().length > 20 && !txt.trim().startsWith('<!DOCTYPE')) {
          bundleCode = txt;
          break;
        }
      } catch (err) {
        lastErr = err;
      }
    }

    if (!bundleCode) {
      throw new Error(
        `Could not download ESM bundle for "${pkgName}"${resolvedVersion ? `@${resolvedVersion}` : ''}: ${
          lastErr instanceof Error ? lastErr.message : 'Network error'
        }`
      );
    }

    const item: InstalledSandboxPackage = {
      name: pkgName,
      version: resolvedVersion,
      description,
      code: bundleCode,
      sizeBytes: new Blob([bundleCode]).size,
      installedAt: Date.now()
    };

    this.packages.update(curr => {
      const next = [item, ...curr.filter(p => p.name.toLowerCase() !== pkgName.toLowerCase())];
      this.persist(next);
      return next;
    });

    return item;
  }

  uninstallPackage(rawName: string): boolean {
    const clean = (rawName || '').trim().toLowerCase();
    if (!clean) return false;
    let removed = false;
    this.packages.update(curr => {
      const next = curr.filter(p => {
        const match = p.name.toLowerCase() === clean;
        if (match) removed = true;
        return !match;
      });
      if (removed) this.persist(next);
      return next;
    });
    return removed;
  }
}
