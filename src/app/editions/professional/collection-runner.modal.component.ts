import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState } from '../../shared/services/tab.state.service';
import { RequestExecutionService } from '../../shared/services/request.execution.service';
import { NotificationService } from '../../shared/services/notification.service';
import { BodyPortalDirective } from '../../shared/directives/body-portal.directive';
import { RunnerSchedulerService } from '../../shared/services/runner-scheduler.service';

interface RunnerResultRow {
  iteration: number;
  requestId: string;
  requestName: string;
  method: string;
  status: number;
  responseTime: number;
  testsPassed: number;
  testsFailed: number;
  dataRowLabel?: string;
}

@Component({
  selector: 'app-collection-runner-modal',
  imports: [FormsModule, MatIcon, BodyPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)'
  },
  template: `
    @if (isOpen()) {
      <div appBodyPortal class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4" (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="runner-modal-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
             (click)="$event.stopPropagation()">

          <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50">
            <div class="flex items-center gap-2.5">
              <div class="size-7 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center">
                <mat-icon class="text-[17px]! size-[17px]!">play_circle</mat-icon>
              </div>
              <div>
                <h3 id="runner-modal-title" class="text-sm font-bold text-(--postonsteroids-text-primary)">Capsule &amp; Data-Driven Collection Runner</h3>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">Run all requests in {{ tabState.activeCapsuleName() }} or a specific folder sequentially with CSV/JSON test data iterations</p>
              </div>
            </div>
            <button type="button" (click)="close()" class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
              <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
            </button>
          </div>

          <!-- Controls -->
          <div class="p-4 border-b border-(--postonsteroids-border)/70 grid grid-cols-1 md:grid-cols-12 gap-3 items-end bg-(--postonsteroids-bg-primary)/30 text-xs">
            <div class="md:col-span-4">
              <label class="block text-[11px] font-semibold text-(--postonsteroids-text-muted) mb-1">Run Scope</label>
              <select [ngModel]="selectedGroupId()" (ngModelChange)="selectedGroupId.set($event)" [disabled]="isRunning()"
                      class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none">
                <option value="__all__">Entire Capsule ({{ tabState.allCapsuleRequests().length }} requests)</option>
                @for (g of capsuleGroups(); track g.id) {
                  <option [value]="g.id">Folder: {{ g.name }}</option>
                }
              </select>
            </div>

            <div class="md:col-span-2">
              <label class="block text-[11px] font-semibold text-(--postonsteroids-text-muted) mb-1">Iterations</label>
              <input type="number" min="1" max="500" [ngModel]="iterations()" (ngModelChange)="iterations.set(Math.max(1, +$event || 1))"
                     [disabled]="isRunning() || dataRows().length > 0"
                     class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none" />
            </div>

            <div class="md:col-span-2">
              <label class="block text-[11px] font-semibold text-(--postonsteroids-text-muted) mb-1">Delay (ms)</label>
              <input type="number" min="0" max="30000" [ngModel]="delayMs()" (ngModelChange)="delayMs.set(Math.max(0, +$event || 0))"
                     [disabled]="isRunning()"
                     class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none" />
            </div>

            <div class="md:col-span-4 flex items-center justify-end gap-2">
              <input #dataFileInput type="file" accept=".csv,.json" class="hidden" (change)="onDataFileSelected($event)" />
              <button type="button" (click)="dataFileInput.click()" [disabled]="isRunning()"
                      title="Import CSV or JSON test data file for sequential iterations"
                      class="px-3 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-primary) font-semibold cursor-pointer inline-flex items-center gap-1.5">
                <mat-icon class="text-[15px]! size-[15px]! text-sky-400">upload_file</mat-icon>
                <span>{{ dataRows().length > 0 ? 'Data: ' + dataRows().length + ' rows' : 'Import CSV / JSON Data' }}</span>
              </button>
              @if (dataRows().length > 0 && !isRunning()) {
                <button type="button" (click)="dataRows.set([])" class="text-[11px] text-status-danger hover:underline cursor-pointer">Clear</button>
              }
              @if (!isRunning()) {
                <button type="button" (click)="startRun()" [disabled]="targetRequests().length === 0"
                        class="px-4 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-1">
                  <mat-icon class="text-[15px]! size-[15px]!">play_arrow</mat-icon>
                  <span>Run</span>
                </button>
              } @else {
                <button type="button" (click)="stopRun()"
                        class="px-4 py-1.5 rounded-lg bg-status-danger text-white font-semibold cursor-pointer flex items-center gap-1">
                  <mat-icon class="text-[15px]! size-[15px]!">stop</mat-icon>
                  <span>Stop</span>
                </button>
              }
            </div>
          </div>

          <!-- Schedule Execution Date & Optional End Date Bar -->
          <div class="px-4 py-2.5 border-b border-(--postonsteroids-border)/50 flex flex-wrap items-center justify-between gap-2 bg-(--postonsteroids-bg-secondary)/50 text-[11px]">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-(--postonsteroids-text-muted) flex items-center gap-1">
                <mat-icon class="text-[14px]! size-[14px]! text-amber-400">event</mat-icon>
                <span>Schedule Flow (Local):</span>
              </span>
              <input type="datetime-local" aria-label="Runner execution start date time"
                     [ngModel]="scheduleStartAt()" (ngModelChange)="scheduleStartAt.set($event)"
                     [disabled]="isScheduled() || isRunning()"
                     class="px-2 py-1 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) font-mono text-(--postonsteroids-text-primary) outline-none" />
              <span class="text-(--postonsteroids-text-muted)">to</span>
              <input type="datetime-local" aria-label="Runner optional end date time"
                     [ngModel]="scheduleEndAt()" (ngModelChange)="scheduleEndAt.set($event)"
                     [disabled]="isScheduled() || isRunning()"
                     placeholder="Optional End"
                     class="px-2 py-1 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) font-mono text-(--postonsteroids-text-primary) outline-none" />
              <label class="flex items-center gap-1 text-(--postonsteroids-text-muted)">
                <span>Repeat (s):</span>
                <input type="number" min="0" max="86400"
                       [ngModel]="scheduleRepeatSeconds()" (ngModelChange)="scheduleRepeatSeconds.set(Math.max(0, +$event || 0))"
                       [disabled]="isScheduled() || isRunning()"
                       class="w-16 px-1.5 py-1 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) font-mono text-(--postonsteroids-text-primary) outline-none" />
              </label>
            </div>
            <div class="flex items-center gap-2">
              @if (isScheduled()) {
                <span class="text-amber-400 font-mono font-semibold">{{ scheduledStatusLabel() }}</span>
                <button type="button" (click)="cancelScheduledRun()"
                        class="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer">
                  Cancel Schedule
                </button>
              } @else {
                <button type="button" (click)="scheduleRunner()" [disabled]="isRunning() || targetRequests().length === 0 || !scheduleStartAt()"
                        class="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-45">
                  Schedule Execution
                </button>
              }
            </div>
          </div>

          <!-- Summary Stats -->
          @if (results().length > 0) {
            <div class="px-5 py-2.5 border-b border-(--postonsteroids-border)/50 flex flex-wrap items-center justify-between gap-3 bg-(--postonsteroids-bg-tertiary)/30 text-xs">
              <div class="flex items-center gap-4">
                <span>Runs: <strong class="tabular-nums">{{ results().length }}</strong></span>
                <span class="text-status-success">2xx/OK: <strong class="tabular-nums">{{ summaryStats().okCount }}</strong></span>
                <span class="text-status-danger">Errors/4xx/5xx: <strong class="tabular-nums">{{ summaryStats().failCount }}</strong></span>
                <span>Tests Passed: <strong class="text-status-success tabular-nums">{{ summaryStats().testsPassed }}</strong> / <strong class="text-status-danger tabular-nums">{{ summaryStats().testsFailed }}</strong> failed</span>
                <span>Avg Time: <strong class="tabular-nums">{{ summaryStats().avgTime }} ms</strong></span>
              </div>
              <button type="button" (click)="exportReport()"
                      class="px-2.5 py-1 rounded border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) hover:bg-(--postonsteroids-bg-hover) text-[11px] font-semibold cursor-pointer">
                Export JSON Report
              </button>
            </div>
          }

          <!-- Results Table -->
          <div class="flex-1 overflow-y-auto p-4">
            @if (results().length === 0) {
              <div class="py-10 text-center text-xs text-(--postonsteroids-text-muted)">
                Ready to run <strong>{{ targetRequests().length }}</strong> request(s) across <strong>{{ dataRows().length > 0 ? dataRows().length : iterations() }}</strong> iteration(s).
              </div>
            } @else {
              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr class="text-(--postonsteroids-text-muted) border-b border-(--postonsteroids-border)/50">
                    <th class="w-12 py-1.5 text-center">#</th>
                    <th class="w-16 py-1.5 text-left">Method</th>
                    <th class="py-1.5 px-2 text-left">Request</th>
                    <th class="w-24 py-1.5 text-center">Status</th>
                    <th class="w-24 py-1.5 text-right">Time</th>
                    <th class="w-28 py-1.5 text-center">Assertions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of results(); track $index) {
                    <tr class="border-b border-(--postonsteroids-border)/25">
                      <td class="py-1.5 text-center font-mono text-(--postonsteroids-text-muted)">{{ row.iteration }}</td>
                      <td class="py-1.5 font-mono font-bold text-(--postonsteroids-accent)">{{ row.method }}</td>
                      <td class="py-1.5 px-2 text-(--postonsteroids-text-primary)">{{ row.requestName }}</td>
                      <td class="py-1.5 text-center font-mono font-bold"
                          [class.text-status-success]="row.status >= 200 && row.status < 300"
                          [class.text-status-danger]="row.status === 0 || row.status >= 400">
                        {{ row.status || 'ERR' }}
                      </td>
                      <td class="py-1.5 text-right font-mono text-(--postonsteroids-text-secondary)">{{ row.responseTime }} ms</td>
                      <td class="py-1.5 text-center font-mono">
                        @if (row.testsPassed + row.testsFailed === 0) {
                          <span class="text-(--postonsteroids-text-muted)">—</span>
                        } @else {
                          <span class="text-status-success">{{ row.testsPassed }}P</span> /
                          <span [class.text-status-danger]="row.testsFailed > 0">{{ row.testsFailed }}F</span>
                        }
                      </td>
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
export class CollectionRunnerModalComponent {
  tabState = inject(TabStateService);
  private requestExecutor = inject(RequestExecutionService);
  private runnerScheduler = inject(RunnerSchedulerService);
  private notification = inject(NotificationService);
  protected Math = Math;

  isOpen = input<boolean>(false);
  closed = output<void>();

  selectedGroupId = signal<string>('__all__');
  iterations = signal<number>(1);
  delayMs = signal<number>(100);
  dataRows = signal<Record<string, string>[]>([]);
  isRunning = signal<boolean>(false);
  results = signal<RunnerResultRow[]>([]);

  scheduleStartAt = signal<string>('');
  scheduleEndAt = signal<string>('');
  scheduleRepeatSeconds = signal<number>(0);
  activeScheduleJobId = signal<string | null>(null);

  isScheduled = computed(() => {
    const jobId = this.activeScheduleJobId();
    if (!jobId) return false;
    return this.runnerScheduler.activeJobs().some(j => j.id === jobId);
  });

  scheduledStatusLabel = computed(() => {
    const jobId = this.activeScheduleJobId();
    if (!jobId) return '';
    const job = this.runnerScheduler.activeJobs().find(j => j.id === jobId);
    if (!job) return '';
    if (job.repeatMs > 0) {
      return `Active (${job.runCount} runs · every ${Math.round(job.repeatMs / 1000)}s)`;
    }
    return `Scheduled: ${new Date(job.startAtMs).toLocaleString()}`;
  });

  private stopRequested = false;

  capsuleGroups = computed(() => this.tabState.getGroupsForCapsule(this.tabState.activeCapsuleId()));

  targetRequests = computed<RequestState[]>(() => {
    const all = this.tabState.allCapsuleRequests();
    const gId = this.selectedGroupId();
    if (gId === '__all__') return all;
    return all.filter(r => r.groupId === gId);
  });

  summaryStats = computed(() => {
    const list = this.results();
    let okCount = 0;
    let failCount = 0;
    let testsPassed = 0;
    let testsFailed = 0;
    let totalTime = 0;
    for (const r of list) {
      if (r.status >= 200 && r.status < 400) okCount++;
      else failCount++;
      testsPassed += r.testsPassed;
      testsFailed += r.testsFailed;
      totalTime += r.responseTime || 0;
    }
    return {
      okCount,
      failCount,
      testsPassed,
      testsFailed,
      avgTime: list.length ? Math.round(totalTime / list.length) : 0
    };
  });

  onEscape(event: Event): void {
    if (!this.isOpen() || this.isRunning()) return;
    event.preventDefault();
    this.close();
  }

  scheduleRunner(): void {
    const startMs = this.runnerScheduler.parseLocalDateTimeMs(this.scheduleStartAt());
    const endMs = this.runnerScheduler.parseLocalDateTimeMs(this.scheduleEndAt());
    const now = Date.now();
    if (startMs === null) {
      this.notification.notify('Please select an execution start date & time.', 'warning');
      return;
    }
    if (endMs !== null && (endMs <= now || endMs <= startMs)) {
      this.notification.notify('Optional end date & time must be after start date & time and in the future.', 'warning');
      return;
    }
    const capsuleId = this.tabState.activeCapsuleId() || 'default';
    const capsuleName = this.tabState.activeCapsuleName() || 'Capsule';
    const gId = this.selectedGroupId();
    const grpName = gId === '__all__'
      ? 'All Requests'
      : (this.capsuleGroups().find(g => g.id === gId)?.name || 'Folder');
    const repeatMs = this.scheduleRepeatSeconds() > 0 ? Math.max(1000, this.scheduleRepeatSeconds() * 1000) : 0;

    const job = this.runnerScheduler.scheduleCollectionRun({
      capsuleId,
      capsuleName,
      groupId: gId,
      scopeLabel: grpName,
      startAtMs: startMs,
      endAtMs: endMs,
      repeatMs,
      iterations: this.iterations(),
      delayMs: this.delayMs(),
      dataRows: this.dataRows(),
      onBatchResults: (rows) => {
        this.results.set(rows.map(r => ({
          iteration: r.iteration,
          requestId: r.requestId,
          requestName: r.requestName,
          method: r.method,
          status: r.status,
          responseTime: r.responseTime,
          testsPassed: r.testsPassed,
          testsFailed: r.testsFailed,
          dataRowLabel: r.dataRowLabel
        })));
      }
    });
    this.activeScheduleJobId.set(job.id);
  }

  cancelScheduledRun(silent = false): void {
    const jobId = this.activeScheduleJobId();
    if (jobId) {
      this.runnerScheduler.cancelJob(jobId, silent);
      this.activeScheduleJobId.set(null);
    }
  }

  close(): void {
    this.stopRun();
    this.closed.emit();
  }

  stopRun(): void {
    this.stopRequested = true;
    this.isRunning.set(false);
  }

  onDataFileSelected(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '').trim();
        let rows: Record<string, string>[] = [];
        if (file.name.toLowerCase().endsWith('.json') || text.startsWith('[')) {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed)) {
            rows = parsed.map(item => {
              const out: Record<string, string> = {};
              if (item && typeof item === 'object') {
                for (const [k, v] of Object.entries(item)) out[k] = String(v ?? '');
              }
              return out;
            });
          }
        } else {
          const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
          if (lines.length >= 2) {
            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            for (let i = 1; i < lines.length; i++) {
              const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
              const row: Record<string, string> = {};
              headers.forEach((h, idx) => {
                if (h) row[h] = cols[idx] ?? '';
              });
              rows.push(row);
            }
          }
        }
        this.dataRows.set(rows);
        this.notification.notify(`Loaded ${rows.length} data iteration row(s) from ${file.name}.`, 'success');
      } catch {
        this.notification.notify('Failed to parse CSV/JSON data file.', 'error');
      }
      inputEl.value = '';
    };
    reader.readAsText(file);
  }

  async startRun(): Promise<void> {
    const queue = this.targetRequests();
    if (queue.length === 0) return;

    this.stopRequested = false;
    this.isRunning.set(true);
    this.results.set([]);

    const data = this.dataRows();
    const totalIterations = data.length > 0 ? data.length : this.iterations();

    try {
      for (let iter = 1; iter <= totalIterations; iter++) {
        if (this.stopRequested) break;
        const activeRowData = data.length > 0 ? data[iter - 1] : undefined;

        for (const req of queue) {
          if (this.stopRequested) break;
          this.tabState.addOpenTab(req);
          await this.requestExecutor.executeRequest(req.id, false, 0, 0, {
            overrideVars: activeRowData
          });
          const fresh = this.tabState.getState(req.id);
          const tests = fresh?.testResults || [];
          const passed = tests.filter(t => t.passed).length;
          const failed = tests.filter(t => !t.passed).length;

          this.results.update(curr => [
            ...curr,
            {
              iteration: iter,
              requestId: req.id,
              requestName: fresh?.name || req.name,
              method: fresh?.method || req.method,
              status: fresh?.responseStatus ?? 0,
              responseTime: Math.round(fresh?.responseTime ?? 0),
              testsPassed: passed,
              testsFailed: failed
            }
          ]);

          if (this.delayMs() > 0 && !this.stopRequested) {
            await new Promise(r => setTimeout(r, this.delayMs()));
          }
        }
      }
      if (!this.stopRequested) {
        this.notification.notify(`Collection run finished (${this.results().length} executions).`, 'success');
      }
    } finally {
      this.isRunning.set(false);
    }
  }

  exportReport(): void {
    const report = {
      capsule: this.tabState.activeCapsuleName(),
      generatedAt: new Date().toISOString(),
      summary: this.summaryStats(),
      results: this.results()
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `run_report_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
