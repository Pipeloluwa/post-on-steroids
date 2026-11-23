import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TabStateService, RequestState } from '../../shared/services/tab.state.service';
import { RequestExecutionService, ClientCertConfig } from '../../shared/services/request.execution.service';
import { VariableService } from '../../shared/services/variable.service';
import { AuthService } from '../../shared/services/auth.service';
import { generateUUID } from '../../shared/utils/uuid.util';
import { isLocalhostOrLoopbackUrl } from '../../shared/utils/url.util';

export type EnterpriseRole = 'Admin' | 'Editor' | 'Viewer';

export interface GovernanceFinding {
  id: string;
  requestId: string;
  requestName: string;
  severity: 'critical' | 'warning' | 'info';
  rule: string;
  message: string;
}

export interface VaultSecretItem {
  id: string;
  key: string;
  value: string;
  description?: string;
  updatedAt: number;
}

export interface StoredClientCert extends ClientCertConfig {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  actor: string;
  role: EnterpriseRole;
  category: 'execution' | 'governance' | 'vault' | 'rbac';
  action: string;
  details: string;
  status?: number;
  durationMs?: number;
}

const VAULT_STORAGE_KEY = 'onsteroids_ent_vault_secrets';
const VAULT_CRYPTO_KEY = 'onsteroids_ent_vault_master';
const MTLS_STORAGE_KEY = 'onsteroids_ent_mtls_certs';
const ROLE_STORAGE_KEY = 'onsteroids_ent_rbac_role';
const LOCKED_CAPSULES_KEY = 'onsteroids_ent_locked_capsules';
const AUDIT_LOGS_KEY = 'onsteroids_ent_audit_logs';

@Injectable({
  providedIn: 'root'
})
export class EnterpriseGovernanceService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private tabState = inject(TabStateService);
  private requestExecutor = inject(RequestExecutionService);
  private variableService = inject(VariableService);
  private authService = inject(AuthService);

  role = signal<EnterpriseRole>(this.loadRole());
  lockedCapsuleIds = signal<string[]>(this.loadLockedCapsules());
  vaultSecrets = signal<VaultSecretItem[]>([]);
  clientCerts = signal<StoredClientCert[]>(this.loadClientCerts());
  auditLogs = signal<AuditLogEntry[]>(this.loadAuditLogs());
  governanceFindings = signal<GovernanceFinding[]>([]);
  lastAuditScore = signal<number | null>(null);

  isActiveCapsuleLocked = computed(() => {
    const capId = this.tabState.activeCapsuleId();
    return Boolean(capId && this.lockedCapsuleIds().includes(capId));
  });

  constructor() {
    void this.initVaultFromStorage();

    // 1. Resolve {{vault:secretKey}} dynamically at request/script resolution time
    this.variableService.registerExternalResolver((rawKey: string) => {
      const clean = rawKey.trim();
      if (!clean.toLowerCase().startsWith('vault:')) return undefined;
      const secretName = clean.slice(6).trim().toLowerCase();
      const match = this.vaultSecrets().find(s => s.key.trim().toLowerCase() === secretName);
      return match ? match.value : undefined;
    });

    // 2. Enforce RBAC Viewer read-only mode & Capsule Lock on TabStateService
    this.tabState.registerEditGuard((capsuleId: string) => {
      if (this.role() === 'Viewer') {
        return 'Enterprise RBAC (Viewer role): workspace is read-only. Switch to Editor/Admin in Enterprise Suite to edit.';
      }
      if (capsuleId && this.lockedCapsuleIds().includes(capsuleId)) {
        return 'Capsule is Governance-Locked. Unlock it in Enterprise Suite -> RBAC & Locks before editing.';
      }
      return null;
    });

    // 3. Domain-matched mTLS Client Certificate resolver for Electron HTTPS dispatch
    this.requestExecutor.registerClientCertProvider((targetUrl: string) => {
      try {
        const host = new URL(targetUrl).hostname.toLowerCase();
        const match = this.clientCerts().find(c => {
          if (!c.enabled || !c.host) return false;
          const pattern = c.host.trim().toLowerCase();
          if (pattern === host) return true;
          if (pattern.startsWith('*.')) {
            const suffix = pattern.slice(1);
            return host.endsWith(suffix) || host === pattern.slice(2);
          }
          return false;
        });
        return match || null;
      } catch {
        return null;
      }
    });

    // 4. Immutable Compliance Execution Audit Logger
    this.requestExecutor.registerExecutionObserver((ev) => {
      this.appendAuditLog({
        category: 'execution',
        action: `${ev.method} ${ev.requestName}`,
        details: ev.url,
        status: ev.status,
        durationMs: Math.round(ev.responseTimeMs)
      });
    });
  }

  private loadRole(): EnterpriseRole {
    if (!this.isBrowser) return 'Admin';
    const raw = localStorage.getItem(ROLE_STORAGE_KEY);
    return raw === 'Viewer' || raw === 'Editor' || raw === 'Admin' ? raw : 'Admin';
  }

  private loadLockedCapsules(): string[] {
    if (!this.isBrowser) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCKED_CAPSULES_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private loadClientCerts(): StoredClientCert[] {
    if (!this.isBrowser) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(MTLS_STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private loadAuditLogs(): AuditLogEntry[] {
    if (!this.isBrowser) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(AUDIT_LOGS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  setRole(nextRole: EnterpriseRole): void {
    this.role.set(nextRole);
    if (this.isBrowser) localStorage.setItem(ROLE_STORAGE_KEY, nextRole);
    this.appendAuditLog({
      category: 'rbac',
      action: 'Role Switched',
      details: `Active RBAC workspace role changed to ${nextRole}`
    });
  }

  toggleCapsuleLock(capsuleId: string): void {
    if (!capsuleId) return;
    let lockedNow = false;
    this.lockedCapsuleIds.update(list => {
      const exists = list.includes(capsuleId);
      lockedNow = !exists;
      const next = exists ? list.filter(id => id !== capsuleId) : [...list, capsuleId];
      if (this.isBrowser) localStorage.setItem(LOCKED_CAPSULES_KEY, JSON.stringify(next));
      return next;
    });
    this.appendAuditLog({
      category: 'rbac',
      action: lockedNow ? 'Capsule Locked' : 'Capsule Unlocked',
      details: `Capsule ${capsuleId}`
    });
  }

  // ── AES-256-GCM Encrypted Local Vault ─────────────────────────────────
  private async getOrCreateVaultCryptoKey(): Promise<CryptoKey | null> {
    if (!this.isBrowser || !crypto?.subtle) return null;
    try {
      let rawB64 = localStorage.getItem(VAULT_CRYPTO_KEY);
      if (!rawB64) {
        const keyBytes = crypto.getRandomValues(new Uint8Array(32));
        rawB64 = btoa(String.fromCharCode(...keyBytes));
        localStorage.setItem(VAULT_CRYPTO_KEY, rawB64);
      }
      const rawBytes = Uint8Array.from(atob(rawB64), c => c.charCodeAt(0));
      return crypto.subtle.importKey('raw', rawBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    } catch {
      return null;
    }
  }

  private async initVaultFromStorage(): Promise<void> {
    if (!this.isBrowser) return;
    try {
      const raw = localStorage.getItem(VAULT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.iv && parsed?.cipher) {
        const key = await this.getOrCreateVaultCryptoKey();
        if (!key) return;
        const iv = Uint8Array.from(atob(parsed.iv), c => c.charCodeAt(0));
        const cipher = Uint8Array.from(atob(parsed.cipher), c => c.charCodeAt(0));
        const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
        const list = JSON.parse(new TextDecoder().decode(plainBuf));
        if (Array.isArray(list)) this.vaultSecrets.set(list);
      } else if (Array.isArray(parsed)) {
        this.vaultSecrets.set(parsed);
      }
    } catch {
      this.vaultSecrets.set([]);
    }
  }

  private async persistVault(list: VaultSecretItem[]): Promise<void> {
    if (!this.isBrowser) return;
    try {
      const key = await this.getOrCreateVaultCryptoKey();
      if (key) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(JSON.stringify(list));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        localStorage.setItem(
          VAULT_STORAGE_KEY,
          JSON.stringify({
            iv: btoa(String.fromCharCode(...iv)),
            cipher: btoa(String.fromCharCode(...new Uint8Array(cipher)))
          })
        );
      } else {
        localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(list));
      }
    } catch {}
  }

  upsertVaultSecret(key: string, value: string, description = ''): void {
    const cleanKey = key.trim().replace(/^vault:/i, '');
    if (!cleanKey) return;
    this.vaultSecrets.update(list => {
      const idx = list.findIndex(s => s.key.toLowerCase() === cleanKey.toLowerCase());
      const entry: VaultSecretItem = {
        id: idx !== -1 ? list[idx].id : generateUUID(),
        key: cleanKey,
        value,
        description,
        updatedAt: Date.now()
      };
      const next = [...list];
      if (idx !== -1) next[idx] = entry;
      else next.unshift(entry);
      void this.persistVault(next);
      return next;
    });
    this.appendAuditLog({
      category: 'vault',
      action: 'Vault Secret Saved',
      details: `Updated encrypted vault key "{{vault:${cleanKey}}}"`
    });
  }

  deleteVaultSecret(id: string): void {
    this.vaultSecrets.update(list => {
      const next = list.filter(s => s.id !== id);
      void this.persistVault(next);
      return next;
    });
  }

  // ── mTLS Client Certificates ──────────────────────────────────────────
  upsertClientCert(cert: Omit<StoredClientCert, 'id' | 'updatedAt'> & { id?: string }): void {
    const host = (cert.host || '').trim().toLowerCase();
    if (!host) return;
    this.clientCerts.update(list => {
      const entry: StoredClientCert = {
        ...cert,
        id: cert.id || generateUUID(),
        host,
        updatedAt: Date.now()
      };
      const next = [entry, ...list.filter(c => c.id !== entry.id)];
      if (this.isBrowser) localStorage.setItem(MTLS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    this.appendAuditLog({
      category: 'governance',
      action: 'mTLS Certificate Added',
      details: `Configured ${cert.type.toUpperCase()} certificate for ${host}`
    });
  }

  toggleClientCert(id: string): void {
    this.clientCerts.update(list => {
      const next = list.map(c => (c.id === id ? { ...c, enabled: !c.enabled, updatedAt: Date.now() } : c));
      if (this.isBrowser) localStorage.setItem(MTLS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  deleteClientCert(id: string): void {
    this.clientCerts.update(list => {
      const next = list.filter(c => c.id !== id);
      if (this.isBrowser) localStorage.setItem(MTLS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  // ── API Governance & Security Audit Engine ────────────────────────────
  runGovernanceAudit(): { score: number; findings: GovernanceFinding[] } {
    const requests: RequestState[] = this.tabState.allCapsuleRequests();
    const findings: GovernanceFinding[] = [];
    const sensitiveFieldRegex = /\b(password|pin|bvn|cvv|cardnumber|secret|token|apikey|ssn|passcode)\b/i;
    const hardcodedJwtRegex = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./;

    let penalty = 0;

    for (const req of requests) {
      const reqName = req.name || req.url || 'Untitled Request';
      const rawUrl = (req.url || '').trim();
      const method = (req.method || 'GET').toUpperCase();

      // Rule 1: HTTPS enforcement for remote URLs
      if (rawUrl.toLowerCase().startsWith('http://') && !isLocalhostOrLoopbackUrl(rawUrl)) {
        findings.push({
          id: generateUUID(),
          requestId: req.id,
          requestName: reqName,
          severity: 'critical',
          rule: 'HTTPS Required',
          message: `Insecure plain HTTP URL "${rawUrl}" should use HTTPS.`
        });
        penalty += 15;
      }

      // Rule 2: Auth check on mutating operations
      const hasAuthHeader = (req.headers || []).some(h => h.enabled && /authorization|x-api-key/i.test(h.key || ''));
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && req.auth?.type === 'none' && !hasAuthHeader) {
        findings.push({
          id: generateUUID(),
          requestId: req.id,
          requestName: reqName,
          severity: 'warning',
          rule: 'Auth Required on Write',
          message: `${method} endpoint has no Authorization configured.`
        });
        penalty += 6;
      }

      // Rule 3: Hardcoded credentials or JWT literals (suggest {{vault:...}})
      const tokenVal = req.auth?.token || req.auth?.apiKeyValue || req.auth?.password || '';
      const hasRawSecret =
        (tokenVal && !tokenVal.includes('{{') && hardcodedJwtRegex.test(tokenVal)) ||
        (req.headers || []).some(h => h.enabled && !h.value?.includes('{{') && hardcodedJwtRegex.test(h.value || ''));
      if (hasRawSecret) {
        findings.push({
          id: generateUUID(),
          requestId: req.id,
          requestName: reqName,
          severity: 'critical',
          rule: 'Exposed Hardcoded Token',
          message: `Hardcoded JWT/credential detected. Move it to Secret Vault as {{vault:key}}.`
        });
        penalty += 15;
      }

      // Rule 4: Sensitive fields without field-level encryption lock
      const bodySample = `${req.rawBodyJson || ''} ${req.rawBodyXml || ''}`;
      if (sensitiveFieldRegex.test(bodySample) && !req.encryption?.autoEncryptBody && (req.encryption?.encryptedBodyPaths?.length || 0) === 0) {
        findings.push({
          id: generateUUID(),
          requestId: req.id,
          requestName: reqName,
          severity: 'warning',
          rule: 'Sensitive Field Encryption',
          message: `Payload contains sensitive keys without gutter encryption lock (🔒) or Auto-encrypt enabled.`
        });
        penalty += 5;
      }

      // Rule 5: TLS verifySsl check for production HTTPS endpoints
      if (rawUrl.toLowerCase().startsWith('https://') && !isLocalhostOrLoopbackUrl(rawUrl) && req.settings?.verifySsl === false) {
        findings.push({
          id: generateUUID(),
          requestId: req.id,
          requestName: reqName,
          severity: 'info',
          rule: 'SSL Certificate Verification',
          message: `Validate SSL Certificate is OFF for external HTTPS endpoint.`
        });
        penalty += 2;
      }
    }

    const score = requests.length === 0 ? 100 : Math.max(0, Math.min(100, Math.round(100 - penalty / Math.max(1, requests.length / 2))));
    this.governanceFindings.set(findings);
    this.lastAuditScore.set(score);
    this.appendAuditLog({
      category: 'governance',
      action: 'API Governance Audit Run',
      details: `Score: ${score}% across ${requests.length} requests (${findings.length} finding(s))`
    });
    return { score, findings };
  }

  // ── Immutable Audit Log ───────────────────────────────────────────────
  appendAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp' | 'actor' | 'role'>): void {
    const actor = this.authService.currentUser()?.email || 'local-user';
    const item: AuditLogEntry = {
      id: generateUUID(),
      timestamp: Date.now(),
      actor,
      role: this.role(),
      ...entry
    };
    this.auditLogs.update(list => {
      const next = [item, ...list].slice(0, 500);
      if (this.isBrowser) {
        try {
          localStorage.setItem(AUDIT_LOGS_KEY, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }

  clearAuditLogs(): void {
    this.auditLogs.set([]);
    if (this.isBrowser) localStorage.removeItem(AUDIT_LOGS_KEY);
  }
}
