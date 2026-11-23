import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { EnterpriseGovernanceService, EnterpriseRole } from './enterprise-governance.service';
import { TabStateService } from '../../shared/services/tab.state.service';
import { VariableService } from '../../shared/services/variable.service';
import { NotificationService } from '../../shared/services/notification.service';
import { isElectronApp } from '../../shared/utils/url.util';
import { environment } from '../../../environments/environment';
import { copyTextToClipboard } from '../../shared/utils/clipboard.util';

type EnterpriseTab = 'governance' | 'vault' | 'mtls' | 'rbac' | 'loadtest';

interface LoadTestSummary {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  rps: number;
  minMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

@Component({
  selector: 'app-enterprise-suite-modal',
  imports: [FormsModule, MatIcon, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)'
  },
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 z-115 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="ent-suite-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
             (click)="$event.stopPropagation()">

          <!-- Header -->
          <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/60">
            <div class="flex items-center gap-2.5">
              <div class="size-8 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center border border-amber-500/30">
                <mat-icon class="text-[18px]! size-[18px]!">admin_panel_settings</mat-icon>
              </div>
              <div>
                <h3 id="ent-suite-title" class="text-sm font-bold text-(--postonsteroids-text-primary)">Enterprise Control Center</h3>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">API Governance, Encrypted Secret Vault, mTLS Client Certificates, Team RBAC &amp; Audit Logs, and Load Testing</p>
              </div>
            </div>
            <button type="button" (click)="close()" class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
              <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
            </button>
          </div>

          <!-- Tab Navigation -->
          <div class="px-5 pt-2.5 border-b border-(--postonsteroids-border) flex items-center gap-2 overflow-x-auto bg-(--postonsteroids-bg-primary)/30 shrink-0 text-xs">
            <button type="button" (click)="activeTab.set('governance')"
                    class="px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                    [class.border-(--postonsteroids-accent)]="activeTab() === 'governance'"
                    [class.text-(--postonsteroids-accent)]="activeTab() === 'governance'"
                    [class.border-transparent]="activeTab() !== 'governance'"
                    [class.text-(--postonsteroids-text-muted)]="activeTab() !== 'governance'">
              <mat-icon class="text-[15px]! size-[15px]!">verified_user</mat-icon>
              <span>API Governance</span>
            </button>
            <button type="button" (click)="activeTab.set('vault')"
                    class="px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                    [class.border-(--postonsteroids-accent)]="activeTab() === 'vault'"
                    [class.text-(--postonsteroids-accent)]="activeTab() === 'vault'"
                    [class.border-transparent]="activeTab() !== 'vault'"
                    [class.text-(--postonsteroids-text-muted)]="activeTab() !== 'vault'">
              <mat-icon class="text-[15px]! size-[15px]!">enhanced_encryption</mat-icon>
              <span>Secret Vault ({{ gov.vaultSecrets().length }})</span>
            </button>
            <button type="button" (click)="activeTab.set('mtls')"
                    class="px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                    [class.border-(--postonsteroids-accent)]="activeTab() === 'mtls'"
                    [class.text-(--postonsteroids-accent)]="activeTab() === 'mtls'"
                    [class.border-transparent]="activeTab() !== 'mtls'"
                    [class.text-(--postonsteroids-text-muted)]="activeTab() !== 'mtls'">
              <mat-icon class="text-[15px]! size-[15px]!">badge</mat-icon>
              <span>mTLS Certificates ({{ gov.clientCerts().length }})</span>
            </button>
            <button type="button" (click)="activeTab.set('rbac')"
                    class="px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                    [class.border-(--postonsteroids-accent)]="activeTab() === 'rbac'"
                    [class.text-(--postonsteroids-accent)]="activeTab() === 'rbac'"
                    [class.border-transparent]="activeTab() !== 'rbac'"
                    [class.text-(--postonsteroids-text-muted)]="activeTab() !== 'rbac'">
              <mat-icon class="text-[15px]! size-[15px]!">security</mat-icon>
              <span>RBAC, Locks &amp; Audit</span>
            </button>
            <button type="button" (click)="activeTab.set('loadtest')"
                    class="px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                    [class.border-(--postonsteroids-accent)]="activeTab() === 'loadtest'"
                    [class.text-(--postonsteroids-accent)]="activeTab() === 'loadtest'"
                    [class.border-transparent]="activeTab() !== 'loadtest'"
                    [class.text-(--postonsteroids-text-muted)]="activeTab() !== 'loadtest'">
              <mat-icon class="text-[15px]! size-[15px]!">speed</mat-icon>
              <span>Load Tester</span>
            </button>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-y-auto p-5 text-xs space-y-4">

            <!-- TAB 1: API GOVERNANCE -->
            @if (activeTab() === 'governance') {
              <div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl bg-(--postonsteroids-bg-tertiary)/50 border border-(--postonsteroids-border)">
                <div>
                  <div class="text-sm font-bold text-(--postonsteroids-text-primary)">Capsule Security &amp; Compliance Audit</div>
                  <div class="text-[11px] text-(--postonsteroids-text-muted)">Checks HTTPS enforcement, authentication coverage, hardcoded tokens, PII encryption locks, and SSL policy across {{ tabState.allCapsuleRequests().length }} requests.</div>
                </div>
                <div class="flex items-center gap-3">
                  @if (gov.lastAuditScore() !== null) {
                    <div class="px-3 py-1 rounded-lg font-mono font-bold text-sm border"
                         [class.text-status-success]="(gov.lastAuditScore() ?? 0) >= 80"
                         [class.border-emerald-500/40]="(gov.lastAuditScore() ?? 0) >= 80"
                         [class.text-status-warning]="(gov.lastAuditScore() ?? 0) >= 50 && (gov.lastAuditScore() ?? 0) < 80"
                         [class.text-status-danger]="(gov.lastAuditScore() ?? 0) < 50">
                      Score: {{ gov.lastAuditScore() }}%
                    </div>
                  }
                  <button type="button" (click)="runAudit()"
                          class="px-4 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white font-semibold cursor-pointer">
                    Run Governance Audit
                  </button>
                </div>
              </div>

              @if (gov.governanceFindings().length === 0 && gov.lastAuditScore() !== null) {
                <div class="p-6 text-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 font-semibold">
                  100% Compliant — No security or governance issues detected in "{{ tabState.activeCapsuleName() }}".
                </div>
              } @else {
                <div class="space-y-2">
                  @for (f of gov.governanceFindings(); track f.id) {
                    <div class="p-3 rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary)/40 flex items-center justify-between gap-3">
                      <div class="space-y-0.5">
                        <div class="flex items-center gap-2">
                          <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase"
                                [class.bg-red-500/20]="f.severity === 'critical'" [class.text-status-danger]="f.severity === 'critical'"
                                [class.bg-amber-500/20]="f.severity === 'warning'" [class.text-status-warning]="f.severity === 'warning'"
                                [class.bg-blue-500/20]="f.severity === 'info'" [class.text-status-info]="f.severity === 'info'">
                            {{ f.severity }}
                          </span>
                          <span class="font-bold text-(--postonsteroids-text-primary)">{{ f.rule }}</span>
                          <span class="text-(--postonsteroids-text-muted)">in <strong>{{ f.requestName }}</strong></span>
                        </div>
                        <p class="text-(--postonsteroids-text-secondary)">{{ f.message }}</p>
                      </div>
                      <button type="button" (click)="openFindingRequest(f.requestId)"
                              class="px-2.5 py-1 rounded border border-(--postonsteroids-border) hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-accent) font-semibold cursor-pointer shrink-0">
                        Inspect
                      </button>
                    </div>
                  }
                </div>
              }
            }

            <!-- TAB 2: SECRET VAULT -->
            @if (activeTab() === 'vault') {
              <div class="p-4 rounded-xl bg-(--postonsteroids-bg-tertiary)/50 border border-(--postonsteroids-border) space-y-3">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="text-sm font-bold text-(--postonsteroids-text-primary)">AES-256-GCM Encrypted Local Vault</div>
                    <div class="text-[11px] text-(--postonsteroids-text-muted)">Vault secrets are encrypted at rest and never exported or synced to cloud capsules. Reference anywhere with <code class="font-mono text-(--postonsteroids-accent)">{{ '{{vault:keyName}}' }}</code>.</div>
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <input type="text" [ngModel]="vaultKeyInput()" (ngModelChange)="vaultKeyInput.set($event)" placeholder="Secret key (e.g. prodApiKey)"
                         class="md:col-span-4 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) font-mono outline-none" />
                  <input type="password" [ngModel]="vaultValInput()" (ngModelChange)="vaultValInput.set($event)" placeholder="Secret value"
                         class="md:col-span-4 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) font-mono outline-none" />
                  <input type="text" [ngModel]="vaultDescInput()" (ngModelChange)="vaultDescInput.set($event)" placeholder="Description (optional)"
                         class="md:col-span-2 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) outline-none" />
                  <button type="button" (click)="saveVaultSecret()"
                          class="md:col-span-2 px-3 py-1.5 rounded-lg bg-(--postonsteroids-accent) text-white font-semibold cursor-pointer">
                    + Store Secret
                  </button>
                </div>
              </div>

              <!-- HashiCorp Vault Connector -->
              <div class="p-3.5 rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary)/30 space-y-2">
                <div class="font-bold text-(--postonsteroids-text-primary)">Pull from External HashiCorp Vault KV v2</div>
                <div class="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <input type="text" [ngModel]="hcVaultUrl()" (ngModelChange)="hcVaultUrl.set($event)" placeholder="https://vault.internal:8200/v1/secret/data/app"
                         class="md:col-span-6 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) font-mono outline-none" />
                  <input type="password" [ngModel]="hcVaultToken()" (ngModelChange)="hcVaultToken.set($event)" placeholder="X-Vault-Token"
                         class="md:col-span-4 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) font-mono outline-none" />
                  <button type="button" (click)="syncHashicorpVault()" [disabled]="isSyncingVault()"
                          class="md:col-span-2 px-3 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) font-semibold cursor-pointer">
                    {{ isSyncingVault() ? 'Syncing...' : 'Fetch Secrets' }}
                  </button>
                </div>
              </div>

              <div class="space-y-1.5">
                @for (s of gov.vaultSecrets(); track s.id) {
                  <div class="px-3 py-2 rounded-lg border border-(--postonsteroids-border)/60 flex items-center justify-between bg-(--postonsteroids-bg-primary)/30">
                    <div>
                      <div class="font-mono font-bold text-(--postonsteroids-accent)">{{ '{{vault:' + s.key + '}}' }}</div>
                      @if (s.description) {
                        <div class="text-[10px] text-(--postonsteroids-text-muted)">{{ s.description }}</div>
                      }
                    </div>
                    <div class="flex items-center gap-2">
                      <button type="button" (click)="copyVaultRef(s.key)" class="px-2 py-1 rounded border border-(--postonsteroids-border) text-[11px] hover:bg-(--postonsteroids-bg-hover) cursor-pointer">Copy Ref</button>
                      <button type="button" (click)="gov.deleteVaultSecret(s.id)" class="text-status-danger p-1 cursor-pointer"><mat-icon class="text-[15px]! size-[15px]!">delete</mat-icon></button>
                    </div>
                  </div>
                }
              </div>
            }

            <!-- TAB 3: mTLS CLIENT CERTIFICATES -->
            @if (activeTab() === 'mtls') {
              <div class="p-4 rounded-xl bg-(--postonsteroids-bg-tertiary)/50 border border-(--postonsteroids-border) space-y-3">
                <div>
                  <div class="text-sm font-bold text-(--postonsteroids-text-primary)">Mutual TLS (mTLS) Client Certificates</div>
                  <div class="text-[11px] text-(--postonsteroids-text-muted)">Attach <code class="font-mono">.pfx</code> / <code class="font-mono">.p12</code> or PEM (<code class="font-mono">.crt</code> + <code class="font-mono">.key</code>) certificates per host/domain for Desktop App requests.</div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                  <input type="text" [ngModel]="certHost()" (ngModelChange)="certHost.set($event)" placeholder="Host (e.g. api.bank.internal or *.internal)"
                         class="md:col-span-4 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) font-mono outline-none" />
                  <select [ngModel]="certType()" (ngModelChange)="certType.set($event)"
                          class="md:col-span-2 px-2 py-1.5 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) outline-none">
                    <option value="pfx">PFX / P12</option>
                    <option value="pem">PEM (CRT + KEY)</option>
                  </select>
                  <input type="password" [ngModel]="certPassphrase()" (ngModelChange)="certPassphrase.set($event)" placeholder="Passphrase (optional)"
                         class="md:col-span-2 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) outline-none" />
                  @if (certType() === 'pfx') {
                    <input #pfxInput type="file" accept=".pfx,.p12" class="hidden" (change)="onPfxSelected($event)" />
                    <button type="button" (click)="pfxInput.click()"
                            class="md:col-span-2 px-2.5 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) cursor-pointer truncate">
                      {{ certPfxB64() ? 'PFX Loaded ✓' : 'Upload .pfx' }}
                    </button>
                  } @else {
                    <div class="md:col-span-2 flex gap-1">
                      <input #crtInput type="file" accept=".crt,.pem" class="hidden" (change)="onPemFileSelected($event, 'cert')" />
                      <input #keyInput type="file" accept=".key,.pem" class="hidden" (change)="onPemFileSelected($event, 'key')" />
                      <button type="button" (click)="crtInput.click()" class="flex-1 px-2 py-1.5 rounded border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) cursor-pointer">{{ certPem() ? 'CRT ✓' : '.crt' }}</button>
                      <button type="button" (click)="keyInput.click()" class="flex-1 px-2 py-1.5 rounded border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) cursor-pointer">{{ keyPem() ? 'KEY ✓' : '.key' }}</button>
                    </div>
                  }
                  <button type="button" (click)="saveClientCert()"
                          class="md:col-span-2 px-3 py-1.5 rounded-lg bg-(--postonsteroids-accent) text-white font-semibold cursor-pointer">
                    + Add Cert
                  </button>
                </div>
              </div>

              <div class="space-y-1.5">
                @for (c of gov.clientCerts(); track c.id) {
                  <div class="px-3 py-2 rounded-lg border border-(--postonsteroids-border)/60 flex items-center justify-between bg-(--postonsteroids-bg-primary)/30">
                    <div class="flex items-center gap-3">
                      <input type="checkbox" [checked]="c.enabled" (change)="gov.toggleClientCert(c.id)" class="accent-(--postonsteroids-accent) cursor-pointer" />
                      <span class="font-mono font-bold text-(--postonsteroids-text-primary)">{{ c.host }}</span>
                      <span class="px-1.5 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) font-mono uppercase text-[10px]">{{ c.type }}</span>
                    </div>
                    <button type="button" (click)="gov.deleteClientCert(c.id)" class="text-status-danger p-1 cursor-pointer">
                      <mat-icon class="text-[15px]! size-[15px]!">delete</mat-icon>
                    </button>
                  </div>
                }
              </div>
            }

            <!-- TAB 4: RBAC, LOCKS & AUDIT TRAIL -->
            @if (activeTab() === 'rbac') {
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="p-4 rounded-xl bg-(--postonsteroids-bg-tertiary)/50 border border-(--postonsteroids-border) space-y-2">
                  <div class="font-bold text-(--postonsteroids-text-primary)">Workspace Role (RBAC)</div>
                  <div class="flex items-center gap-2">
                    @for (r of roles; track r) {
                      <button type="button" (click)="gov.setRole(r)"
                              class="px-3 py-1.5 rounded-lg border font-semibold cursor-pointer transition-colors"
                              [class.bg-(--postonsteroids-accent)]="gov.role() === r"
                              [class.text-white]="gov.role() === r"
                              [class.border-(--postonsteroids-accent)]="gov.role() === r"
                              [class.border-(--postonsteroids-border)]="gov.role() !== r">
                        {{ r }}
                      </button>
                    }
                  </div>
                  <p class="text-[11px] text-(--postonsteroids-text-muted)">Setting role to <strong>Viewer</strong> enforces read-only protection on requests and payloads while still permitting test execution.</p>
                </div>

                <div class="p-4 rounded-xl bg-(--postonsteroids-bg-tertiary)/50 border border-(--postonsteroids-border) space-y-2">
                  <div class="font-bold text-(--postonsteroids-text-primary)">Capsule Freeze / Lock</div>
                  <div class="flex items-center justify-between">
                    <span>Active Capsule: <strong>{{ tabState.activeCapsuleName() }}</strong></span>
                    <button type="button" (click)="gov.toggleCapsuleLock(tabState.activeCapsuleId())"
                            class="px-3 py-1.5 rounded-lg font-semibold cursor-pointer flex items-center gap-1"
                            [class.bg-amber-600]="gov.isActiveCapsuleLocked()" [class.text-white]="gov.isActiveCapsuleLocked()"
                            [class.bg-(--postonsteroids-bg-secondary)]="!gov.isActiveCapsuleLocked()"
                            [class.border]="!gov.isActiveCapsuleLocked()" [class.border-(--postonsteroids-border)]="!gov.isActiveCapsuleLocked()">
                      <mat-icon class="text-[14px]! size-[14px]!">{{ gov.isActiveCapsuleLocked() ? 'lock' : 'lock_open' }}</mat-icon>
                      <span>{{ gov.isActiveCapsuleLocked() ? 'Locked (Click to Unlock)' : 'Lock Capsule' }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <span class="font-bold text-(--postonsteroids-text-primary)">Compliance Audit Trail ({{ gov.auditLogs().length }})</span>
                <div class="flex items-center gap-2">
                  <button type="button" (click)="exportAuditCsv()" class="px-2.5 py-1 rounded border border-(--postonsteroids-border) hover:bg-(--postonsteroids-bg-hover) cursor-pointer">Export CSV</button>
                  <button type="button" (click)="gov.clearAuditLogs()" class="px-2.5 py-1 rounded border border-status-danger/30 text-status-danger hover:bg-status-danger/10 cursor-pointer">Clear Logs</button>
                </div>
              </div>

              <div class="border border-(--postonsteroids-border) rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                <table class="w-full text-[11px] border-collapse">
                  <thead class="bg-(--postonsteroids-bg-tertiary)">
                    <tr class="text-(--postonsteroids-text-muted) border-b border-(--postonsteroids-border)">
                      <th class="py-1.5 px-2 text-left">Time</th>
                      <th class="py-1.5 px-2 text-left">Actor (Role)</th>
                      <th class="py-1.5 px-2 text-left">Action</th>
                      <th class="py-1.5 px-2 text-left">Details</th>
                      <th class="py-1.5 px-2 text-right">Status / ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (log of gov.auditLogs(); track log.id) {
                      <tr class="border-b border-(--postonsteroids-border)/30">
                        <td class="py-1 px-2 text-(--postonsteroids-text-muted) whitespace-nowrap">{{ log.timestamp | date:'short' }}</td>
                        <td class="py-1 px-2 font-mono">{{ log.actor }} ({{ log.role }})</td>
                        <td class="py-1 px-2 font-semibold">{{ log.action }}</td>
                        <td class="py-1 px-2 text-(--postonsteroids-text-secondary) truncate max-w-[240px]">{{ log.details }}</td>
                        <td class="py-1 px-2 text-right font-mono">{{ log.status ?? '—' }} {{ log.durationMs !== undefined ? '(' + log.durationMs + 'ms)' : '' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            <!-- TAB 5: LOAD / PERFORMANCE TESTER -->
            @if (activeTab() === 'loadtest') {
              <div class="p-4 rounded-xl bg-(--postonsteroids-bg-tertiary)/50 border border-(--postonsteroids-border) space-y-3">
                <div class="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div class="text-sm font-bold text-(--postonsteroids-text-primary)">Virtual-User Load &amp; Stress Test (Active Request)</div>
                    <div class="text-[11px] text-(--postonsteroids-text-muted)">Target: <strong class="font-mono">{{ tabState.activeTabState()?.method }} {{ tabState.activeTabState()?.url || 'No active request' }}</strong></div>
                  </div>
                  <div class="flex items-center gap-3">
                    <div>
                      <label class="block text-[10px] text-(--postonsteroids-text-muted)">Virtual Users (VUs)</label>
                      <input type="number" min="1" max="25" [ngModel]="loadVus()" (ngModelChange)="loadVus.set(Math.min(25, Math.max(1, +$event || 1)))"
                             [disabled]="isLoadTesting()" class="w-20 px-2 py-1 rounded bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) font-mono" />
                    </div>
                    <div>
                      <label class="block text-[10px] text-(--postonsteroids-text-muted)">Total Requests</label>
                      <input type="number" min="1" max="500" [ngModel]="loadTotal()" (ngModelChange)="loadTotal.set(Math.min(500, Math.max(1, +$event || 1)))"
                             [disabled]="isLoadTesting()" class="w-24 px-2 py-1 rounded bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) font-mono" />
                    </div>
                    <button type="button" (click)="runLoadTest()" [disabled]="isLoadTesting() || !tabState.activeTabState()?.url"
                            class="px-4 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white font-semibold cursor-pointer disabled:opacity-50">
                      {{ isLoadTesting() ? 'Running (' + loadCompleted() + '/' + loadTotal() + ')...' : 'Start Load Test' }}
                    </button>
                  </div>
                </div>
              </div>

              @if (loadSummary(); as s) {
                <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  <div class="p-3 rounded-xl bg-(--postonsteroids-bg-primary)/40 border border-(--postonsteroids-border)">
                    <div class="text-[10px] text-(--postonsteroids-text-muted) uppercase">Throughput</div>
                    <div class="text-lg font-bold font-mono text-(--postonsteroids-accent)">{{ s.rps }} req/s</div>
                  </div>
                  <div class="p-3 rounded-xl bg-(--postonsteroids-bg-primary)/40 border border-(--postonsteroids-border)">
                    <div class="text-[10px] text-(--postonsteroids-text-muted) uppercase">Success / Errors</div>
                    <div class="text-lg font-bold font-mono"><span class="text-status-success">{{ s.successCount }}</span> / <span class="text-status-danger">{{ s.errorCount }}</span></div>
                  </div>
                  <div class="p-3 rounded-xl bg-(--postonsteroids-bg-primary)/40 border border-(--postonsteroids-border)">
                    <div class="text-[10px] text-(--postonsteroids-text-muted) uppercase">p50 Median</div>
                    <div class="text-lg font-bold font-mono">{{ s.p50Ms }} ms</div>
                  </div>
                  <div class="p-3 rounded-xl bg-(--postonsteroids-bg-primary)/40 border border-(--postonsteroids-border)">
                    <div class="text-[10px] text-(--postonsteroids-text-muted) uppercase">p95 Latency</div>
                    <div class="text-lg font-bold font-mono text-status-warning">{{ s.p95Ms }} ms</div>
                  </div>
                  <div class="p-3 rounded-xl bg-(--postonsteroids-bg-primary)/40 border border-(--postonsteroids-border)">
                    <div class="text-[10px] text-(--postonsteroids-text-muted) uppercase">p99 / Max</div>
                    <div class="text-lg font-bold font-mono text-status-danger">{{ s.p99Ms }} / {{ s.maxMs }} ms</div>
                  </div>
                </div>
              }
            }
          </div>
        </div>
      </div>
    }
  `
})
export class EnterpriseSuiteModalComponent {
  gov = inject(EnterpriseGovernanceService);
  tabState = inject(TabStateService);
  private variableService = inject(VariableService);
  private notification = inject(NotificationService);
  protected Math = Math;

  isOpen = input<boolean>(false);
  closed = output<void>();

  activeTab = signal<EnterpriseTab>('governance');
  roles: EnterpriseRole[] = ['Admin', 'Editor', 'Viewer'];

  // Vault inputs
  vaultKeyInput = signal('');
  vaultValInput = signal('');
  vaultDescInput = signal('');
  hcVaultUrl = signal('');
  hcVaultToken = signal('');
  isSyncingVault = signal(false);

  // mTLS inputs
  certHost = signal('');
  certType = signal<'pfx' | 'pem'>('pfx');
  certPassphrase = signal('');
  certPfxB64 = signal('');
  certPem = signal('');
  keyPem = signal('');

  // Load test state
  loadVus = signal(5);
  loadTotal = signal(25);
  loadCompleted = signal(0);
  isLoadTesting = signal(false);
  loadSummary = signal<LoadTestSummary | null>(null);

  onEscape(event: Event): void {
    if (!this.isOpen() || this.isLoadTesting()) return;
    event.preventDefault();
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  runAudit(): void {
    const res = this.gov.runGovernanceAudit();
    this.notification.notify(`Governance audit complete: ${res.score}% score (${res.findings.length} finding(s)).`, 'info');
  }

  openFindingRequest(requestId: string): void {
    const req = this.tabState.allCapsuleRequests().find(r => r.id === requestId);
    if (req) {
      this.tabState.addOpenTab(req);
      this.tabState.setActiveTab(req.id);
      this.close();
    }
  }

  saveVaultSecret(): void {
    if (!this.vaultKeyInput().trim()) {
      this.notification.notify('Enter a Vault key name.', 'warning');
      return;
    }
    this.gov.upsertVaultSecret(this.vaultKeyInput(), this.vaultValInput(), this.vaultDescInput());
    this.vaultKeyInput.set('');
    this.vaultValInput.set('');
    this.vaultDescInput.set('');
    this.notification.notify('Secret encrypted and saved in local Vault.', 'success');
  }

  async copyVaultRef(key: string): Promise<void> {
    await copyTextToClipboard(`{{vault:${key}}}`);
    this.notification.notify(`Copied {{vault:${key}}}`, 'success');
  }

  async syncHashicorpVault(): Promise<void> {
    const url = this.hcVaultUrl().trim();
    const token = this.hcVaultToken().trim();
    if (!url || !token) {
      this.notification.notify('Enter both HashiCorp Vault URL and X-Vault-Token.', 'warning');
      return;
    }
    this.isSyncingVault.set(true);
    try {
      const res = await fetch(url, { headers: { 'X-Vault-Token': token } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const kv = json?.data?.data || json?.data || {};
      let count = 0;
      for (const [k, v] of Object.entries(kv)) {
        if (v !== undefined && v !== null) {
          this.gov.upsertVaultSecret(k, String(v), 'Synced from HashiCorp Vault');
          count++;
        }
      }
      this.notification.notify(`Imported ${count} secret(s) into local Vault.`, 'success');
    } catch (e: any) {
      this.notification.notify(`HashiCorp Vault sync failed: ${e?.message || e}`, 'error');
    } finally {
      this.isSyncingVault.set(false);
    }
  }

  onPfxSelected(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      this.certPfxB64.set(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  }

  onPemFileSelected(event: Event, part: 'cert' | 'key'): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (part === 'cert') this.certPem.set(String(reader.result || ''));
      else this.keyPem.set(String(reader.result || ''));
    };
    reader.readAsText(file);
  }

  saveClientCert(): void {
    if (!this.certHost().trim()) {
      this.notification.notify('Enter a target hostname (e.g. api.internal).', 'warning');
      return;
    }
    this.gov.upsertClientCert({
      name: this.certHost().trim(),
      host: this.certHost().trim(),
      type: this.certType(),
      pfxBase64: this.certType() === 'pfx' ? this.certPfxB64() : undefined,
      certPem: this.certType() === 'pem' ? this.certPem() : undefined,
      keyPem: this.certType() === 'pem' ? this.keyPem() : undefined,
      passphrase: this.certPassphrase() || undefined,
      enabled: true
    });
    this.certHost.set('');
    this.certPassphrase.set('');
    this.certPfxB64.set('');
    this.certPem.set('');
    this.keyPem.set('');
    this.notification.notify('mTLS Client Certificate saved.', 'success');
  }

  exportAuditCsv(): void {
    const rows = this.gov.auditLogs();
    const lines = ['timestamp,actor,role,category,action,details,status,durationMs'];
    for (const r of rows) {
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      lines.push([new Date(r.timestamp).toISOString(), r.actor, r.role, r.category, r.action, r.details, r.status ?? '', r.durationMs ?? ''].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `onsteroid_audit_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async runLoadTest(): Promise<void> {
    const req = this.tabState.activeTabState();
    if (!req?.url) return;

    this.isLoadTesting.set(true);
    this.loadCompleted.set(0);
    this.loadSummary.set(null);

    const targetUrl = this.variableService.resolve(req.url);
    const method = (req.method || 'GET').toUpperCase();
    const hdrs: Record<string, string> = {};
    for (const h of req.headers || []) {
      if (h.enabled && h.key) hdrs[this.variableService.resolve(h.key)] = this.variableService.resolve(h.value || '');
    }
    const body = method !== 'GET' && method !== 'HEAD' ? (req.rawType === 'XML' || req.rawType === 'XML (SOAP)' ? req.rawBodyXml : req.rawBodyJson) : undefined;
    const resolvedBody = body ? this.variableService.resolve(body) : undefined;

    const total = this.loadTotal();
    const vus = Math.min(this.loadVus(), total);
    const latencies: number[] = [];
    let successCount = 0;
    let errorCount = 0;
    let nextIdx = 0;
    const suiteStart = performance.now();

    const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    const useElectron = isElectronApp() && electronApi?.executeHttpRequest;
    const timeoutMs = this.tabState.requestTimeoutMs();

    const runOne = async () => {
      const t0 = performance.now();
      try {
        if (useElectron) {
          const r = await electronApi.executeHttpRequest({
            url: targetUrl,
            method,
            headers: hdrs,
            body: resolvedBody ?? null,
            verifySsl: req.settings?.verifySsl ?? false,
            timeoutMs
          });
          if (r?.ok && r.statusCode >= 200 && r.statusCode < 400) successCount++;
          else errorCount++;
        } else {
          const controller = timeoutMs > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
          try {
            const proxyUrl = environment.proxyUrl || '/api/v1/Proxy';
            const r = await fetch(proxyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: targetUrl,
                method,
                headers: hdrs,
                body: resolvedBody ?? null,
                verifySsl: false,
                timeoutMs: timeoutMs > 0 ? timeoutMs : 0
              }),
              ...(controller ? { signal: controller.signal } : {})
            });
            if (r.ok) successCount++;
            else errorCount++;
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
      } catch {
        errorCount++;
      } finally {
        latencies.push(performance.now() - t0);
        this.loadCompleted.update(n => n + 1);
      }
    };

    const workers = Array.from({ length: vus }, async () => {
      while (nextIdx < total) {
        nextIdx++;
        await runOne();
      }
    });

    await Promise.all(workers);
    const totalSec = Math.max(0.001, (performance.now() - suiteStart) / 1000);
    latencies.sort((a, b) => a - b);
    const pct = (p: number) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] || 0);
    const sumMs = latencies.reduce((a, b) => a + b, 0);

    this.loadSummary.set({
      totalRequests: total,
      successCount,
      errorCount,
      rps: Number((total / totalSec).toFixed(1)),
      minMs: Math.round(latencies[0] || 0),
      avgMs: Math.round(sumMs / Math.max(1, latencies.length)),
      p50Ms: pct(50),
      p95Ms: pct(95),
      p99Ms: pct(99),
      maxMs: Math.round(latencies[latencies.length - 1] || 0)
    });
    this.isLoadTesting.set(false);
    this.gov.appendAuditLog({
      category: 'execution',
      action: `Load Test (${vus} VUs x ${total})`,
      details: `${method} ${targetUrl} -> ${successCount} OK, ${errorCount} Err, p95=${pct(95)}ms`
    });
  }
}
