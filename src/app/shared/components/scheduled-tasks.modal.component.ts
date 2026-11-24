import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { BodyPortalDirective } from '../directives/body-portal.directive';
import { RunnerSchedulerService } from '../services/runner-scheduler.service';
import { RequestExecutionService } from '../services/request.execution.service';
import { TabStateService } from '../services/tab.state.service';

@Component({
  selector: 'app-scheduled-tasks-modal',
  imports: [CommonModule, MatIcon, DatePipe, BodyPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div appBodyPortal class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="scheduled-tasks-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[82vh] max-h-[82vh]"
             (click)="$event.stopPropagation()">
          <!-- Header -->
          <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary) shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-400">
                <mat-icon class="text-[20px]! size-[20px]!">schedule</mat-icon>
              </div>
              <div>
                <h2 id="scheduled-tasks-title" class="text-[14px] font-bold text-(--postonsteroids-text-primary)">
                  Scheduled Tasks &amp; Activity Monitor
                </h2>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">
                  Background schedules continue running concurrently even when Runner or request tabs are closed.
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-1 rounded-full text-[11px] font-bold"
                    [class.bg-amber-500/20]="scheduler.activeTotalCount() > 0"
                    [class.text-amber-300]="scheduler.activeTotalCount() > 0"
                    [class.bg-(--postonsteroids-bg-primary)]="scheduler.activeTotalCount() === 0"
                    [class.text-(--postonsteroids-text-muted)]="scheduler.activeTotalCount() === 0">
                {{ scheduler.activeTotalCount() }} Active
              </span>
              <button type="button" (click)="close()" aria-label="Close Scheduled Tasks"
                      class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
                <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
              </button>
            </div>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-y-auto custom-scrollbar p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 bg-(--postonsteroids-bg-primary)">
            <!-- Left Column: Active Schedules -->
            <div class="flex flex-col gap-4">
              <!-- Collection Schedules -->
              <section class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden">
                <div class="px-3.5 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) flex items-center justify-between">
                  <div class="flex items-center gap-2 text-[12px] font-bold text-(--postonsteroids-text-primary)">
                    <mat-icon class="text-[16px]! size-[16px]! text-sky-400">play_circle</mat-icon>
                    <span>Collection Runner Schedules</span>
                  </div>
                  <span class="text-[10px] font-mono text-(--postonsteroids-text-muted)">{{ scheduler.jobs().length }} total</span>
                </div>

                @if (scheduler.jobs().length === 0) {
                  <div class="p-6 text-center text-[11px] text-(--postonsteroids-text-muted)">
                    No collection schedules configured yet. Open Tools &rarr; Collection Runner to schedule a batch run.
                  </div>
                } @else {
                  <div class="divide-y divide-(--postonsteroids-border)/50 max-h-[28vh] overflow-y-auto custom-scrollbar">
                    @for (job of scheduler.jobs(); track job.id) {
                      <div class="p-3 flex flex-col gap-1.5 hover:bg-(--postonsteroids-bg-hover)/40 transition-colors">
                        <div class="flex items-center justify-between gap-2">
                          <div class="min-w-0">
                            <div class="text-[12px] font-semibold text-(--postonsteroids-text-primary) truncate">
                              {{ job.capsuleName }} &middot; {{ job.scopeLabel }}
                            </div>
                            <div class="text-[10px] text-(--postonsteroids-text-muted) flex items-center gap-2 flex-wrap">
                              <span class="px-1.5 py-0.5 rounded font-bold uppercase text-[9px]"
                                    [class.bg-amber-500/15]="job.status === 'waiting'"
                                    [class.text-amber-300]="job.status === 'waiting'"
                                    [class.bg-emerald-500/15]="job.status === 'running'"
                                    [class.text-emerald-400]="job.status === 'running'"
                                    [class.bg-sky-500/15]="job.status === 'completed'"
                                    [class.text-sky-400]="job.status === 'completed'"
                                    [class.bg-red-500/15]="job.status === 'cancelled'"
                                    [class.text-red-400]="job.status === 'cancelled'">
                                {{ job.status }}
                              </span>
                              <span>Runs: <b>{{ job.runCount }}</b></span>
                              <span>{{ job.iterations }} iter(s)</span>
                              @if (job.repeatMs > 0) {
                                <span>Every {{ Math.round(job.repeatMs / 1000) }}s</span>
                              } @else {
                                <span>One-time</span>
                              }
                            </div>
                          </div>
                          <div class="flex items-center gap-1 shrink-0">
                            @if (job.status === 'waiting' || job.status === 'running') {
                              <button type="button" (click)="scheduler.triggerJobNow(job.id)" title="Trigger immediately"
                                      class="px-2 py-1 rounded text-[10px] font-semibold bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/30 cursor-pointer">
                                Run Now
                              </button>
                              <button type="button" (click)="scheduler.cancelJob(job.id)" title="Stop schedule"
                                      class="px-2 py-1 rounded text-[10px] font-semibold bg-red-600/20 hover:bg-red-600/35 text-red-300 border border-red-500/30 cursor-pointer">
                                Stop
                              </button>
                            } @else {
                              <button type="button" (click)="scheduler.removeJob(job.id)" title="Dismiss entry"
                                      class="px-2 py-1 rounded text-[10px] font-semibold bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) border border-(--postonsteroids-border) cursor-pointer">
                                Clear
                              </button>
                            }
                          </div>
                        </div>
                        <div class="text-[10px] font-mono text-(--postonsteroids-text-muted) flex items-center justify-between gap-2">
                          <span class="truncate">{{ job.lastSummary }}</span>
                          @if (job.nextRunAt) {
                            <span class="shrink-0">Next: {{ job.nextRunAt | date:'shortTime' }}</span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }
              </section>

              <!-- Request Trigger Schedules -->
              <section class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden">
                <div class="px-3.5 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) flex items-center justify-between">
                  <div class="flex items-center gap-2 text-[12px] font-bold text-(--postonsteroids-text-primary)">
                    <mat-icon class="text-[16px]! size-[16px]! text-amber-400">bolt</mat-icon>
                    <span>Trigger Flow Schedules</span>
                  </div>
                  <span class="text-[10px] font-mono text-(--postonsteroids-text-muted)">{{ triggerScheduleList().length }} active</span>
                </div>

                @if (triggerScheduleList().length === 0) {
                  <div class="p-6 text-center text-[11px] text-(--postonsteroids-text-muted)">
                    No active Trigger Flow schedules. Use the Trigger menu next to Send to schedule a request.
                  </div>
                } @else {
                  <div class="divide-y divide-(--postonsteroids-border)/50 max-h-[28vh] overflow-y-auto custom-scrollbar">
                    @for (item of triggerScheduleList(); track item.tabId) {
                      <div class="p-3 flex items-center justify-between gap-2 hover:bg-(--postonsteroids-bg-hover)/40 transition-colors">
                        <div class="min-w-0">
                          <div class="flex items-center gap-1.5">
                            <span class="text-[10px] font-mono font-bold text-(--postonsteroids-accent)">{{ item.method }}</span>
                            <span class="text-[12px] font-semibold text-(--postonsteroids-text-primary) truncate">{{ item.name }}</span>
                          </div>
                          <div class="text-[10px] text-(--postonsteroids-text-muted) flex items-center gap-2 flex-wrap mt-0.5">
                            <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                                  [class.bg-amber-500/15]="item.status === 'waiting'"
                                  [class.text-amber-300]="item.status === 'waiting'"
                                  [class.bg-emerald-500/15]="item.status === 'running'"
                                  [class.text-emerald-400]="item.status === 'running'">
                              {{ item.status }}
                            </span>
                            <span>Runs: <b>{{ item.runCount }}</b></span>
                            <span>Every {{ Math.round(item.intervalMs / 1000) }}s</span>
                            @if (item.nextRunAt) {
                              <span>Next: {{ item.nextRunAt | date:'shortTime' }}</span>
                            }
                          </div>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                          <button type="button" (click)="focusTab(item.tabId)"
                                  class="px-2 py-1 rounded text-[10px] font-semibold bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-primary) border border-(--postonsteroids-border) cursor-pointer">
                            Open
                          </button>
                          <button type="button" (click)="requestExecutor.stopSchedule(item.tabId)"
                                  class="px-2 py-1 rounded text-[10px] font-semibold bg-red-600/20 hover:bg-red-600/35 text-red-300 border border-red-500/30 cursor-pointer">
                            Stop
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </section>
            </div>

            <!-- Right Column: Combined Activity Feed -->
            <section class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden flex flex-col min-h-[260px]">
              <div class="px-3.5 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) flex items-center justify-between shrink-0">
                <div class="flex items-center gap-2 text-[12px] font-bold text-(--postonsteroids-text-primary)">
                  <mat-icon class="text-[16px]! size-[16px]! text-emerald-400">history</mat-icon>
                  <span>Background Execution Activity</span>
                </div>
                <button type="button" (click)="clearAllLogs()" [disabled]="combinedLogs().length === 0"
                        class="text-[10px] font-semibold text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) disabled:opacity-40 cursor-pointer">
                  Clear Logs
                </button>
              </div>

              @if (combinedLogs().length === 0) {
                <div class="flex-1 flex flex-col items-center justify-center p-6 text-center text-[11px] text-(--postonsteroids-text-muted)">
                  <mat-icon class="text-[28px]! size-[28px]! opacity-35 mb-2">playlist_play</mat-icon>
                  No background executions recorded yet.
                </div>
              } @else {
                <div class="flex-1 overflow-y-auto custom-scrollbar divide-y divide-(--postonsteroids-border)/50">
                  @for (log of combinedLogs(); track log.id) {
                    <div class="px-3 py-2 flex items-center justify-between gap-2 text-[11px] hover:bg-(--postonsteroids-bg-hover)/30">
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                          <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                                [class.bg-sky-500/15]="log.sourceType === 'collection'"
                                [class.text-sky-400]="log.sourceType === 'collection'"
                                [class.bg-amber-500/15]="log.sourceType === 'trigger'"
                                [class.text-amber-300]="log.sourceType === 'trigger'">
                            {{ log.sourceType }}
                          </span>
                          <span class="font-mono font-bold text-(--postonsteroids-accent)">{{ log.method }}</span>
                          <span class="font-medium text-(--postonsteroids-text-primary) truncate">{{ log.requestName }}</span>
                        </div>
                        <div class="text-[10px] text-(--postonsteroids-text-muted) truncate mt-0.5">
                          {{ log.jobName }} &middot; {{ log.timestamp | date:'mediumTime' }}
                          @if (log.error) {
                            <span class="text-red-400 ml-1">{{ log.error }}</span>
                          }
                        </div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                        @if (log.testsPassed > 0 || log.testsFailed > 0) {
                          <span [class.text-emerald-400]="log.testsFailed === 0" [class.text-amber-400]="log.testsFailed > 0">
                            {{ log.testsPassed }}/{{ log.testsPassed + log.testsFailed }} tests
                          </span>
                        }
                        <span class="text-(--postonsteroids-text-muted)">{{ log.durationMs }}ms</span>
                        <span class="px-1.5 py-0.5 rounded font-bold"
                              [class.bg-emerald-500/15]="log.status >= 200 && log.status < 300"
                              [class.text-emerald-400]="log.status >= 200 && log.status < 300"
                              [class.bg-red-500/15]="log.status === 0 || log.status >= 400"
                              [class.text-red-400]="log.status === 0 || log.status >= 400"
                              [class.bg-amber-500/15]="log.status >= 300 && log.status < 400"
                              [class.text-amber-400]="log.status >= 300 && log.status < 400">
                          {{ log.status || 'ERR' }}
                        </span>
                      </div>
                    </div>
                  }
                </div>
              }
            </section>
          </div>
        </div>
      </div>
    }
  `
})
export class ScheduledTasksModalComponent {
  readonly Math = Math;
  isOpen = input<boolean>(false);
  closed = output<void>();

  scheduler = inject(RunnerSchedulerService);
  requestExecutor = inject(RequestExecutionService);
  private tabState = inject(TabStateService);

  triggerScheduleList = computed(() => {
    const map = this.requestExecutor.activeSchedules();
    return Object.entries(map).map(([tabId, info]) => {
      const req = this.tabState.getState(tabId);
      return {
        tabId,
        name: req?.name || req?.url || 'Scheduled Request',
        method: req?.method || 'GET',
        ...info
      };
    });
  });

  combinedLogs = computed(() => {
    const colLogs = this.scheduler.executionLogs();
    const trigLogs = this.requestExecutor.triggerScheduleLogs().map(t => ({
      id: t.id,
      timestamp: t.timestamp,
      sourceType: 'trigger' as const,
      jobId: t.tabId,
      jobName: t.requestName,
      method: t.method,
      requestName: t.requestName,
      status: t.status,
      durationMs: t.durationMs,
      testsPassed: t.testsPassed,
      testsFailed: t.testsFailed,
      error: t.error
    }));
    return [...colLogs, ...trigLogs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 200);
  });

  focusTab(tabId: string): void {
    const req = this.tabState.getState(tabId);
    if (req) {
      this.tabState.addOpenTab(req);
      this.tabState.setActiveTab(req.id);
    }
    this.close();
  }

  clearAllLogs(): void {
    this.scheduler.clearLogs();
    this.requestExecutor.clearTriggerScheduleLogs();
  }

  close(): void {
    this.closed.emit();
  }
}
