import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TabStateService } from '../../shared/services/tab.state.service';
import { NotificationService } from '../../shared/services/notification.service';
import { isElectronApp } from '../../shared/utils/url.util';

export interface MockRouteEntry {
  method: string;
  path: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  exampleName: string;
  requestName: string;
}

@Component({
  selector: 'app-mock-server-modal',
  imports: [FormsModule, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)'
  },
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 z-110 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4" (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="mock-mgr-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[86vh]"
             (click)="$event.stopPropagation()">

          <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50">
            <div class="flex items-center gap-2.5">
              <div class="size-7 rounded-lg bg-purple-500/15 text-purple-500 flex items-center justify-center">
                <mat-icon class="text-[17px]! size-[17px]!">dns</mat-icon>
              </div>
              <div>
                <h3 id="mock-mgr-title" class="text-sm font-bold text-(--postonsteroids-text-primary)">Mock Server from Saved Examples</h3>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">Serve saved request Examples locally on Desktop App (or simulate routes directly in Browser)</p>
              </div>
            </div>
            <button type="button" (click)="close()" class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
              <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
            </button>
          </div>

          <div class="p-4 border-b border-(--postonsteroids-border)/70 flex flex-wrap items-center justify-between gap-3 bg-(--postonsteroids-bg-primary)/30 text-xs">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-(--postonsteroids-text-muted)">Port:</span>
              <input type="number" min="1024" max="65535" [ngModel]="port()" (ngModelChange)="port.set(+$event || 4050)"
                     [disabled]="serverRunning()"
                     class="w-24 px-2 py-1 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) font-mono outline-none" />
              <button type="button" (click)="refreshRoutes()"
                      class="px-2.5 py-1 rounded border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) cursor-pointer">
                Scan Examples ({{ routes().length }})
              </button>
            </div>

            <div class="flex items-center gap-2">
              @if (isElectron) {
                @if (!serverRunning()) {
                  <button type="button" (click)="startServer()" [disabled]="routes().length === 0"
                          class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold cursor-pointer disabled:opacity-50">
                    Start Local Mock Server
                  </button>
                } @else {
                  <span class="text-emerald-500 font-mono font-bold">http://localhost:{{ port() }}</span>
                  <button type="button" (click)="stopServer()"
                          class="px-3.5 py-1.5 rounded-lg bg-status-danger text-white font-semibold cursor-pointer">
                    Stop Server
                  </button>
                }
              } @else {
                <span class="text-[11px] italic text-(--postonsteroids-text-muted)">Live port binding requires Desktop App; use Route Simulator below on Web.</span>
              }
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            <!-- Simulator -->
            <div class="p-3 rounded-xl bg-(--postonsteroids-bg-tertiary)/50 border border-(--postonsteroids-border) space-y-2">
              <div class="font-bold text-(--postonsteroids-text-primary)">In-App Mock Route Simulator</div>
              <div class="flex items-center gap-2">
                <select [ngModel]="simMethod()" (ngModelChange)="simMethod.set($event)"
                        class="px-2 py-1.5 rounded bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) font-mono font-bold">
                  <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option>
                </select>
                <input type="text" [ngModel]="simPath()" (ngModelChange)="simPath.set($event)" placeholder="/api/v1/resource"
                       class="flex-1 px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) font-mono outline-none" />
                <button type="button" (click)="runSimulation()"
                        class="px-3 py-1.5 rounded bg-(--postonsteroids-accent) text-white font-semibold cursor-pointer">
                  Simulate
                </button>
              </div>
              @if (simResult(); as res) {
                <pre class="p-2.5 rounded bg-(--postonsteroids-bg-darker) border border-(--postonsteroids-border) font-mono text-[11px] max-h-40 overflow-auto">{{ res }}</pre>
              }
            </div>

            <!-- Routes Table -->
            @if (routes().length === 0) {
              <div class="py-8 text-center text-(--postonsteroids-text-muted)">
                No saved Examples found in this capsule yet. Save responses via "Save as Example" on any request first.
              </div>
            } @else {
              <table class="w-full border-collapse">
                <thead>
                  <tr class="text-(--postonsteroids-text-muted) border-b border-(--postonsteroids-border)/50">
                    <th class="w-20 py-1.5 text-left">Method</th>
                    <th class="py-1.5 px-2 text-left">Path</th>
                    <th class="w-20 py-1.5 text-center">Status</th>
                    <th class="py-1.5 px-2 text-left">Source Request / Example</th>
                  </tr>
                </thead>
                <tbody>
                  @for (rt of routes(); track $index) {
                    <tr class="border-b border-(--postonsteroids-border)/25 hover:bg-(--postonsteroids-bg-hover)/25">
                      <td class="py-1.5 font-mono font-bold text-(--postonsteroids-accent)">{{ rt.method }}</td>
                      <td class="py-1.5 px-2 font-mono text-(--postonsteroids-text-primary)">{{ rt.path }}</td>
                      <td class="py-1.5 text-center font-mono font-bold text-status-success">{{ rt.statusCode }}</td>
                      <td class="py-1.5 px-2 text-(--postonsteroids-text-secondary)">{{ rt.requestName }} → <strong>{{ rt.exampleName }}</strong></td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </div>
      </div>
    }
  `
})
export class MockServerModalComponent {
  private tabState = inject(TabStateService);
  private notification = inject(NotificationService);
  isElectron = isElectronApp();

  isOpen = input<boolean>(false);
  closed = output<void>();

  port = signal<number>(4050);
  serverRunning = signal<boolean>(false);
  routes = signal<MockRouteEntry[]>([]);
  simMethod = signal<string>('GET');
  simPath = signal<string>('/');
  simResult = signal<string>('');

  onEscape(event: Event): void {
    if (!this.isOpen()) return;
    event.preventDefault();
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  async refreshRoutes(): Promise<void> {
    const reqs = this.tabState.allCapsuleRequests();
    const collected: MockRouteEntry[] = [];
    for (const r of reqs) {
      const examples = await this.tabState.getExamples(r.id).catch(() => []);
      for (const ex of examples) {
        let snap: any = {};
        try {
          snap = typeof ex.requestSnapshot === 'string' ? JSON.parse(ex.requestSnapshot) : (ex.requestSnapshot || {});
        } catch {}
        const rawUrl = snap.url || r.url || '/';
        let routePath = '/';
        try {
          const clean = rawUrl.replace(/\{\{[^}]+\}\}/g, 'https://mock.local');
          const u = clean.startsWith('http') ? new URL(clean) : new URL(clean, 'https://mock.local');
          routePath = u.pathname || '/';
        } catch {
          routePath = rawUrl.startsWith('/') ? rawUrl.split('?')[0] : `/${rawUrl}`;
        }
        const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
        for (const h of (snap.responseHeaders || [])) {
          if (h?.key) hdrs[String(h.key)] = String(h.value ?? '');
        }
        const statusMatch = String(snap.responseStatus || '200').match(/\d+/);
        const bodyStr = typeof snap.responseBody === 'string'
          ? snap.responseBody
          : JSON.stringify(snap.responseBody ?? {}, null, 2);

        collected.push({
          method: (snap.method || r.method || 'GET').toUpperCase(),
          path: routePath,
          statusCode: statusMatch ? Number(statusMatch[0]) : 200,
          headers: hdrs,
          body: bodyStr,
          exampleName: ex.name || 'Example',
          requestName: r.name || 'Request'
        });
      }
    }
    this.routes.set(collected);
    if (collected.length > 0 && this.simPath() === '/') {
      this.simMethod.set(collected[0].method);
      this.simPath.set(collected[0].path);
    }
  }

  runSimulation(): void {
    const m = this.simMethod().toUpperCase();
    const p = this.simPath().trim() || '/';
    const matched = this.routes().find(rt => rt.method === m && rt.path === p);
    if (!matched) {
      this.simResult.set(`404 Not Found: No saved Example matches ${m} ${p}`);
      return;
    }
    this.simResult.set(`HTTP ${matched.statusCode} (${matched.exampleName})\n\n${matched.body}`);
  }

  async startServer(): Promise<void> {
    await this.refreshRoutes();
    const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    if (!electronApi?.startMockServer) {
      this.notification.notify('Local Mock Server requires Desktop App runtime.', 'warning');
      return;
    }
    const res = await electronApi.startMockServer({ port: this.port(), routes: this.routes() });
    if (res?.ok) {
      this.serverRunning.set(true);
      this.notification.notify(`Mock Server running at http://localhost:${this.port()}`, 'success');
    } else {
      this.notification.notify(res?.error || 'Failed to start mock server.', 'error');
    }
  }

  async stopServer(): Promise<void> {
    const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    await electronApi?.stopMockServer?.();
    this.serverRunning.set(false);
    this.notification.notify('Mock Server stopped.', 'info');
  }
}
