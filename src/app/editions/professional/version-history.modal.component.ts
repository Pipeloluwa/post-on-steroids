import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState } from '../../shared/services/tab.state.service';
import { NotificationService } from '../../shared/services/notification.service';
import { generateUUID } from '../../shared/utils/uuid.util';
import { BodyPortalDirective } from '../../shared/directives/body-portal.directive';

export interface RequestVersionSnapshot {
  id: string;
  requestId: string;
  requestName: string;
  label: string;
  createdAt: number;
  state: Partial<RequestState>;
}

const SNAPSHOT_STORAGE_KEY = 'onsteroids_pro_snapshots';

@Component({
  selector: 'app-version-history-modal',
  imports: [FormsModule, MatIcon, DatePipe, BodyPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)'
  },
  template: `
    @if (isOpen()) {
      <div appBodyPortal class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4" (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="ver-hist-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col h-[min(86dvh,calc(100dvh-28px))] max-h-[calc(100dvh-28px)]"
             (click)="$event.stopPropagation()">

          <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50">
            <div class="flex items-center gap-2.5">
              <div class="size-7 rounded-lg bg-cyan-500/15 text-cyan-500 flex items-center justify-center">
                <mat-icon class="text-[17px]! size-[17px]!">restore</mat-icon>
              </div>
              <div>
                <h3 id="ver-hist-title" class="text-sm font-bold text-(--postonsteroids-text-primary)">Request Version Snapshots &amp; Diff Rollback</h3>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">Save point-in-time snapshots of any request and restore earlier payloads, headers, auth, or scripts</p>
              </div>
            </div>
            <button type="button" (click)="close()" class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
              <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
            </button>
          </div>

          <div class="p-4 border-b border-(--postonsteroids-border)/70 flex flex-wrap items-center gap-2 bg-(--postonsteroids-bg-primary)/30 text-xs">
            <input type="text" [ngModel]="snapshotLabel()" (ngModelChange)="snapshotLabel.set($event)"
                   placeholder="Snapshot label (e.g. Before payload refactor)"
                   class="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent)" />
            <button type="button" (click)="captureSnapshot()" [disabled]="!activeRequest()"
                    class="px-3.5 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white font-semibold cursor-pointer disabled:opacity-50">
              Save Current Snapshot
            </button>
          </div>

          <div class="flex flex-1 min-h-0 overflow-hidden text-xs">
            <!-- Snapshot List -->
            <div class="w-64 border-r border-(--postonsteroids-border) overflow-y-auto p-3 space-y-1.5 shrink-0">
              @for (snap of activeRequestSnapshots(); track snap.id) {
                <div (click)="selectedSnapshotId.set(snap.id)"
                     class="p-2.5 rounded-lg border cursor-pointer transition-colors"
                     [class.bg-(--postonsteroids-bg-tertiary)]="activeSnapshotId() === snap.id"
                     [class.border-(--postonsteroids-accent)/50]="activeSnapshotId() === snap.id"
                     [class.border-transparent]="activeSnapshotId() !== snap.id">
                  <div class="font-semibold text-(--postonsteroids-text-primary) truncate">{{ snap.label }}</div>
                  <div class="text-[10px] text-(--postonsteroids-text-muted) mt-0.5">{{ snap.createdAt | date:'short' }}</div>
                </div>
              } @empty {
                <div class="py-8 text-center text-(--postonsteroids-text-muted) italic">No snapshots saved for this request yet.</div>
              }
            </div>

            <!-- Diff Preview -->
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
              @if (selectedSnapshot(); as sel) {
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-bold text-sm text-(--postonsteroids-text-primary)">{{ sel.label }}</div>
                    <div class="text-[11px] text-(--postonsteroids-text-muted)">{{ sel.state.method }} {{ sel.state.url }}</div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button type="button" (click)="restoreSnapshot(sel)"
                            class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer">
                      Restore This Version
                    </button>
                    <button type="button" (click)="deleteSnapshot(sel.id)"
                            class="px-2.5 py-1.5 rounded-lg border border-status-danger/30 text-status-danger hover:bg-status-danger/10 cursor-pointer">
                      Delete
                    </button>
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div class="text-[11px] font-bold text-(--postonsteroids-text-muted) mb-1">Snapshot Payload</div>
                    <pre class="p-3 rounded-lg bg-(--postonsteroids-bg-darker) border border-(--postonsteroids-border) font-mono text-[11px] max-h-72 overflow-auto">{{ formatSnapshotPreview(sel.state) }}</pre>
                  </div>
                  <div>
                    <div class="text-[11px] font-bold text-(--postonsteroids-text-muted) mb-1">Current Live Request</div>
                    <pre class="p-3 rounded-lg bg-(--postonsteroids-bg-darker) border border-(--postonsteroids-border) font-mono text-[11px] max-h-72 overflow-auto">{{ formatSnapshotPreview(activeRequest() || {}) }}</pre>
                  </div>
                </div>
              } @else {
                <div class="py-12 text-center text-(--postonsteroids-text-muted)">Select a snapshot on the left to inspect or restore.</div>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `
})
export class VersionHistoryModalComponent {
  private tabState = inject(TabStateService);
  private notification = inject(NotificationService);

  isOpen = input<boolean>(false);
  closed = output<void>();

  snapshots = signal<RequestVersionSnapshot[]>(this.loadAll());
  snapshotLabel = signal<string>('');
  selectedSnapshotId = signal<string | null>(null);

  activeRequest = computed(() => this.tabState.activeTabState());

  activeRequestSnapshots = computed(() => {
    const req = this.activeRequest();
    if (!req) return [];
    return this.snapshots().filter(s => s.requestId === req.id);
  });

  selectedSnapshot = computed(() => {
    const list = this.activeRequestSnapshots();
    const id = this.selectedSnapshotId();
    return list.find(s => s.id === id) || list[0] || null;
  });

  activeSnapshotId = computed(() => this.selectedSnapshot()?.id ?? null);

  private loadAll(): RequestVersionSnapshot[] {
    try {
      const raw = localStorage.getItem(SNAPSHOT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  private persist(list: RequestVersionSnapshot[]): void {
    try {
      localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(list));
    } catch {}
  }

  onEscape(event: Event): void {
    if (!this.isOpen()) return;
    event.preventDefault();
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  captureSnapshot(): void {
    const req = this.activeRequest();
    if (!req) return;
    const snap: RequestVersionSnapshot = {
      id: generateUUID(),
      requestId: req.id,
      requestName: req.name || 'Request',
      label: this.snapshotLabel().trim() || `Snapshot ${new Date().toLocaleTimeString()}`,
      createdAt: Date.now(),
      state: structuredClone({
        name: req.name,
        method: req.method,
        url: req.url,
        headers: req.headers,
        params: req.params,
        auth: req.auth,
        bodyType: req.bodyType,
        rawType: req.rawType,
        rawBody: req.rawBody,
        rawBodyJson: req.rawBodyJson,
        rawBodyXml: req.rawBodyXml,
        rawBodyText: req.rawBodyText,
        formData: req.formData,
        urlEncodedData: req.urlEncodedData,
        graphqlQuery: req.graphqlQuery,
        graphqlVariables: req.graphqlVariables,
        scripts: req.scripts,
        encryption: req.encryption,
        settings: req.settings
      })
    };
    this.snapshots.update(curr => {
      const next = [snap, ...curr].slice(0, 100);
      this.persist(next);
      return next;
    });
    this.selectedSnapshotId.set(snap.id);
    this.snapshotLabel.set('');
    this.notification.notify('Request snapshot saved.', 'success');
  }

  restoreSnapshot(snap: RequestVersionSnapshot): void {
    const req = this.activeRequest();
    if (!req) return;
    this.tabState.updateState(req.id, { ...snap.state });
    this.notification.notify(`Restored snapshot "${snap.label}".`, 'success');
    this.close();
  }

  deleteSnapshot(id: string): void {
    this.snapshots.update(curr => {
      const next = curr.filter(s => s.id !== id);
      this.persist(next);
      return next;
    });
  }

  formatSnapshotPreview(st: Partial<RequestState>): string {
    return JSON.stringify({
      method: st.method,
      url: st.url,
      headers: (st.headers || []).filter(h => h.key),
      bodyType: st.bodyType,
      rawType: st.rawType,
      body: st.rawType === 'XML' || st.rawType === 'XML (SOAP)' ? st.rawBodyXml : (st.rawBodyJson || st.rawBodyText || st.graphqlQuery)
    }, null, 2);
  }
}
