import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import {
  TabStateService,
  RequestState,
  TriggerFlowCondition,
  TriggerFlowConfig
} from '../../shared/services/tab.state.service';
import { RequestExecutionService } from '../../shared/services/request.execution.service';
import { RunnerSchedulerService } from '../../shared/services/runner-scheduler.service';
import { NotificationService } from '../../shared/services/notification.service';
import { getHttpMethodColor } from '../../shared/utils/http-method.util';

type AutomationSection = 'triggers' | 'jobs' | 'logs';

interface UnifiedAutomationLog {
  id: string;
  timestamp: number;
  source: 'trigger' | 'collection';
  sourceLabel: string;
  method: string;
  requestName: string;
  url: string;
  status: number;
  durationMs: number;
  testsPassed: number;
  testsFailed: number;
  responseBody?: unknown;
  error?: string;
}

@Component({
  selector: 'app-automation',
  imports: [CommonModule, FormsModule, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="h-full w-full flex flex-col bg-(--postonsteroids-bg-primary) text-(--postonsteroids-text-primary) overflow-hidden">
      <!-- Header -->
      <div class="px-6 py-4 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-(--postonsteroids-accent)/15 border border-(--postonsteroids-accent)/30 flex items-center justify-center shrink-0">
            <mat-icon class="text-[22px]! size-[22px]! text-(--postonsteroids-accent)">alt_route</mat-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base font-bold tracking-tight truncate">Trigger &amp; Automation Studio</h1>
            <p class="text-xs text-(--postonsteroids-text-muted) truncate">
              Configure request chaining, conditional retries, recurring schedules, and monitor automation execution logs.
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="px-2.5 py-1 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) text-xs flex items-center gap-1.5">
            <span class="size-2 rounded-full"
                  [class.bg-emerald-400]="activeTotalScheduleCount() > 0"
                  [class.bg-(--postonsteroids-text-muted)]="activeTotalScheduleCount() === 0"></span>
            <span class="font-semibold tabular-nums">{{ activeTotalScheduleCount() }}</span>
            <span class="text-(--postonsteroids-text-muted)">Active Schedules</span>
          </div>

          <div class="px-2.5 py-1 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) text-xs flex items-center gap-1.5">
            <mat-icon class="text-[14px]! size-[14px]! text-(--postonsteroids-accent)">link</mat-icon>
            <span class="font-semibold tabular-nums">{{ chainedRequestCount() }}</span>
            <span class="text-(--postonsteroids-text-muted)">Chained Requests</span>
          </div>

          @if (activeTotalScheduleCount() > 0) {
            <button type="button" (click)="stopAllSchedules()"
                    class="px-3 py-1.5 rounded-lg bg-status-danger/15 border border-status-danger/35 text-status-danger hover:bg-status-danger/25 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
              <mat-icon class="text-[15px]! size-[15px]!">stop_circle</mat-icon>
              <span>Stop All</span>
            </button>
          }

          <button type="button" (click)="goToWorkspace()"
                  class="px-3 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-(--postonsteroids-accent)/60 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
            <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-accent)">open_in_new</mat-icon>
            <span>OnSteroid</span>
          </button>
        </div>
      </div>

      <!-- Sub-Navigation Tabs & Capsule Filter -->
      <div class="px-6 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border)">
          <button type="button" (click)="activeSection.set('triggers')"
                  class="px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                  [class.bg-(--postonsteroids-accent)]="activeSection() === 'triggers'"
                  [class.text-white]="activeSection() === 'triggers'"
                  [class.text-(--postonsteroids-text-secondary)]="activeSection() !== 'triggers'">
            <mat-icon class="text-[15px]! size-[15px]!">alt_route</mat-icon>
            <span>Request Chaining &amp; Schedules ({{ filteredRequests().length }})</span>
          </button>

          <button type="button" (click)="activeSection.set('jobs')"
                  class="px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                  [class.bg-(--postonsteroids-accent)]="activeSection() === 'jobs'"
                  [class.text-white]="activeSection() === 'jobs'"
                  [class.text-(--postonsteroids-text-secondary)]="activeSection() !== 'jobs'">
            <mat-icon class="text-[15px]! size-[15px]!">schedule</mat-icon>
            <span>Collection Runner Jobs ({{ runnerScheduler.jobs().length }})</span>
          </button>

          <button type="button" (click)="activeSection.set('logs')"
                  class="px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                  [class.bg-(--postonsteroids-accent)]="activeSection() === 'logs'"
                  [class.text-white]="activeSection() === 'logs'"
                  [class.text-(--postonsteroids-text-secondary)]="activeSection() !== 'logs'">
            <mat-icon class="text-[15px]! size-[15px]!">receipt_long</mat-icon>
            <span>Execution Logs ({{ unifiedLogs().length }})</span>
          </button>
        </div>

        @if (activeSection() === 'triggers') {
          <div class="flex flex-wrap items-center gap-2">
            <select aria-label="Filter by capsule"
                    [ngModel]="selectedCapsuleFilter()"
                    (ngModelChange)="selectedCapsuleFilter.set($event)"
                    class="bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
              @for (cap of tabState.capsules(); track cap.id) {
                <option [value]="cap.id" class="bg-(--postonsteroids-bg-secondary)">{{ cap.name }}</option>
              }
              <option value="__all__" class="bg-(--postonsteroids-bg-secondary)">All Capsules</option>
            </select>

            <label class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) text-xs cursor-pointer select-none">
              <input type="checkbox"
                     [checked]="onlyConfiguredFilter()"
                     (change)="onlyConfiguredFilter.set($any($event.target).checked)"
                     class="accent-(--postonsteroids-accent) cursor-pointer" />
              <span>Configured only</span>
            </label>

            <div class="relative">
              <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-text-muted) absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">search</mat-icon>
              <input type="text"
                     [ngModel]="searchQuery()"
                     (ngModelChange)="searchQuery.set($event)"
                     placeholder="Filter requests or URLs..."
                     class="pl-8 pr-3 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent) w-56" />
            </div>
          </div>
        }
      </div>

      <!-- Content Area -->
      <div class="flex-1 overflow-y-auto p-6 space-y-4">
        @if (activeSection() === 'triggers') {
          @if (filteredRequests().length === 0) {
            <div class="rounded-xl border border-dashed border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/40 p-10 text-center space-y-2">
              <mat-icon class="text-[36px]! size-[36px]! text-(--postonsteroids-text-muted)">alt_route</mat-icon>
              <p class="text-sm font-semibold">No matching requests found</p>
              <p class="text-xs text-(--postonsteroids-text-muted)">Create or import requests in a capsule, or clear active filters.</p>
            </div>
          } @else {
            <div class="space-y-3">
              @for (req of filteredRequests(); track req.id) {
                @let cfg = getTriggerConfig(req);
                @let sched = executionService.activeSchedules()[req.id] || null;
                @let capName = getCapsuleName(req.capsuleId);
                <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-3 transition-colors hover:border-(--postonsteroids-accent)/40">
                  <!-- Card Header -->
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center gap-2.5 min-w-0 flex-1">
                      <span class="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) shrink-0"
                            [style.color]="getMethodColor(req.method)">
                        {{ req.method }}
                      </span>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-semibold truncate">{{ tabState.resolveRequestTitle(req.name, req.url) }}</span>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) text-(--postonsteroids-text-muted) border border-(--postonsteroids-border) shrink-0">{{ capName }}</span>
                          @if (sched) {
                            <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/35 font-semibold flex items-center gap-1 shrink-0">
                              <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                              {{ sched.status === 'waiting' ? 'Scheduled' : 'Running' }} · #{{ sched.runCount }}
                            </span>
                          }
                        </div>
                        <div class="text-[11px] font-mono text-(--postonsteroids-text-muted) truncate">{{ req.url || 'No URL configured' }}</div>
                      </div>
                    </div>

                    <div class="flex items-center gap-1.5 shrink-0">
                      <button type="button" (click)="runRequestOnce(req)"
                              class="px-2.5 py-1 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-emerald-500/50 hover:text-emerald-400 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors">
                        <mat-icon class="text-[14px]! size-[14px]!">play_arrow</mat-icon>
                        <span>Run Now</span>
                      </button>

                      <button type="button" (click)="toggleRequestSchedule(req)"
                              class="px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                              [class.bg-emerald-500/15]="sched !== null"
                              [class.border-emerald-500/40]="sched !== null"
                              [class.text-emerald-400]="sched !== null"
                              [class.bg-(--postonsteroids-bg-tertiary)]="sched === null"
                              [class.border-(--postonsteroids-border)]="sched === null"
                              [class.text-(--postonsteroids-text-primary)]="sched === null">
                        <mat-icon class="text-[14px]! size-[14px]!">{{ sched ? 'stop' : 'schedule' }}</mat-icon>
                        <span>{{ sched ? 'Stop Schedule' : 'Start Schedule' }}</span>
                      </button>

                      @if (req.postTriggerTabId || (cfg.retryCountOnFail ?? 0) > 0) {
                        <button type="button" (click)="clearRequestAutomation(req)"
                                title="Reset trigger chain and retries"
                                class="px-2 py-1 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-status-danger/50 hover:text-status-danger text-xs cursor-pointer transition-colors">
                          Clear
                        </button>
                      }

                      <button type="button" (click)="openRequestInWorkspace(req)"
                              title="Open request in workspace"
                              class="px-2.5 py-1 rounded-lg bg-(--postonsteroids-accent)/15 border border-(--postonsteroids-accent)/40 text-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent)/25 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors">
                        <mat-icon class="text-[14px]! size-[14px]!">open_in_new</mat-icon>
                        <span>Open</span>
                      </button>
                    </div>
                  </div>

                  <!-- Trigger Flow Controls Grid -->
                  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-(--postonsteroids-border)/50 text-xs">
                    <div class="space-y-1">
                      <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">
                        Next Chained Request
                      </label>
                      <select aria-label="Next chained request"
                              [ngModel]="req.postTriggerTabId || ''"
                              (ngModelChange)="updateRequestChainTarget(req, $event)"
                              class="w-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
                        <option value="" class="bg-(--postonsteroids-bg-secondary)">None (Stop here)</option>
                        <option value="__script__" class="bg-(--postonsteroids-bg-secondary)">Script-Controlled (st.setNextRequest)</option>
                        @for (cand of getChainCandidates(req); track cand.id) {
                          <option [value]="cand.id" class="bg-(--postonsteroids-bg-secondary)">
                            {{ cand.method }} · {{ tabState.resolveRequestTitle(cand.name, cand.url) }}
                          </option>
                        }
                      </select>
                    </div>

                    <div class="space-y-1">
                      <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">
                        Trigger Condition
                      </label>
                      <div class="flex items-center gap-1.5">
                        <select aria-label="Trigger condition"
                                [ngModel]="cfg.condition"
                                (ngModelChange)="patchRequestTriggerConfig(req, { condition: $event })"
                                class="flex-1 bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
                          <option value="always" class="bg-(--postonsteroids-bg-secondary)">Always after response</option>
                          <option value="on-2xx" class="bg-(--postonsteroids-bg-secondary)">Only on 2xx Success</option>
                          <option value="on-tests-pass" class="bg-(--postonsteroids-bg-secondary)">Only when all Tests pass</option>
                          <option value="on-status-match" class="bg-(--postonsteroids-bg-secondary)">When HTTP Status ==</option>
                          <option value="script-only" class="bg-(--postonsteroids-bg-secondary)">Script Controlled</option>
                        </select>
                        @if (cfg.condition === 'on-status-match') {
                          <input type="number" min="100" max="599"
                                 aria-label="Expected HTTP status"
                                 [ngModel]="cfg.expectedStatus || 200"
                                 (ngModelChange)="patchRequestTriggerConfig(req, { expectedStatus: +$event || 200 })"
                                 class="w-16 bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1.5 text-xs font-mono text-center outline-none focus:border-(--postonsteroids-accent)" />
                        }
                      </div>
                    </div>

                    <div class="space-y-1">
                      <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">
                        Delay (ms) &amp; Retries
                      </label>
                      <div class="grid grid-cols-2 gap-1.5">
                        <div class="flex items-center bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1">
                          <span class="text-[10px] text-(--postonsteroids-text-muted) mr-1">Delay</span>
                          <input type="number" min="0" max="60000"
                                 aria-label="Chain delay ms"
                                 [ngModel]="cfg.delayMs"
                                 (ngModelChange)="patchRequestTriggerConfig(req, { delayMs: clampNonNeg($event, 60000) })"
                                 class="w-full bg-transparent outline-none text-xs font-mono text-right" />
                        </div>
                        <div class="flex items-center bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1">
                          <span class="text-[10px] text-(--postonsteroids-text-muted) mr-1">Retry</span>
                          <input type="number" min="0" max="20"
                                 aria-label="Retry count on failure"
                                 [ngModel]="cfg.retryCountOnFail ?? 0"
                                 (ngModelChange)="patchRequestTriggerConfig(req, { retryCountOnFail: clampNonNeg($event, 20) })"
                                 class="w-full bg-transparent outline-none text-xs font-mono text-right" />
                        </div>
                      </div>
                    </div>

                    <div class="space-y-1">
                      <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">
                        Recurring Interval &amp; Window
                      </label>
                      <div class="flex items-center gap-1.5">
                        <div class="flex items-center bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1 w-24 shrink-0">
                          <input type="number" min="1" max="86400"
                                 aria-label="Schedule interval seconds"
                                 [ngModel]="getScheduleSeconds(req)"
                                 (ngModelChange)="onScheduleSecondsChange(req, $event)"
                                 class="w-full bg-transparent outline-none text-xs font-mono text-right" />
                          <span class="text-[10px] text-(--postonsteroids-text-muted) ml-1">sec</span>
                        </div>
                        <input type="datetime-local"
                               aria-label="Schedule start time"
                               title="Optional Start Date &amp; Time"
                               [ngModel]="cfg.scheduleStartAt || ''"
                               (ngModelChange)="patchRequestTriggerConfig(req, { scheduleStartAt: ($event || '').trim() || null })"
                               class="flex-1 min-w-0 bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1 text-[11px] outline-none focus:border-(--postonsteroids-accent)" />
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        } @else if (activeSection() === 'jobs') {
          <!-- Quick Schedule Capsule Runner Builder -->
          <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <mat-icon class="text-[18px]! size-[18px]! text-(--postonsteroids-accent)">add_alarm</mat-icon>
                <h2 class="text-sm font-bold">Schedule Collection Run</h2>
              </div>
              <span class="text-[11px] text-(--postonsteroids-text-muted)">Runs capsule or folder automatically on interval or future start window</span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
              <div class="space-y-1">
                <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">Capsule</label>
                <select aria-label="Job Capsule"
                        [ngModel]="jobCapsuleId()"
                        (ngModelChange)="onJobCapsuleChange($event)"
                        class="w-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs outline-none cursor-pointer">
                  @for (cap of tabState.capsules(); track cap.id) {
                    <option [value]="cap.id" class="bg-(--postonsteroids-bg-secondary)">{{ cap.name }}</option>
                  }
                </select>
              </div>

              <div class="space-y-1">
                <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">Scope / Folder</label>
                <select aria-label="Job Scope"
                        [ngModel]="jobGroupId()"
                        (ngModelChange)="jobGroupId.set($event)"
                        class="w-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs outline-none cursor-pointer">
                  <option value="__all__" class="bg-(--postonsteroids-bg-secondary)">All Requests</option>
                  @for (grp of jobAvailableGroups(); track grp.id) {
                    <option [value]="grp.id" class="bg-(--postonsteroids-bg-secondary)">Folder: {{ grp.name }}</option>
                  }
                </select>
              </div>

              <div class="space-y-1">
                <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">Repeat (seconds)</label>
                <input type="number" min="0"
                       aria-label="Job repeat interval seconds"
                       [ngModel]="jobRepeatSeconds()"
                       (ngModelChange)="jobRepeatSeconds.set(clampNonNeg($event, 86400))"
                       placeholder="0 = once"
                       class="w-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none" />
              </div>

              <div class="space-y-1">
                <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">Iterations / Delay ms</label>
                <div class="grid grid-cols-2 gap-1.5">
                  <input type="number" min="1" max="500"
                         aria-label="Job iterations"
                         [ngModel]="jobIterations()"
                         (ngModelChange)="jobIterations.set(Math.max(1, +$event || 1))"
                         class="w-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1.5 text-xs font-mono outline-none" />
                  <input type="number" min="0" max="60000"
                         aria-label="Job delay ms"
                         [ngModel]="jobDelayMs()"
                         (ngModelChange)="jobDelayMs.set(clampNonNeg($event, 60000))"
                         class="w-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1.5 text-xs font-mono outline-none" />
                </div>
              </div>

              <div class="space-y-1">
                <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted)">Start At (Optional)</label>
                <input type="datetime-local"
                       aria-label="Job start datetime"
                       [ngModel]="jobStartAt()"
                       (ngModelChange)="jobStartAt.set($event)"
                       class="w-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1.5 text-[11px] outline-none" />
              </div>

              <div class="flex items-end">
                <button type="button" (click)="createScheduledJob()"
                        class="w-full py-1.5 px-3 rounded-lg bg-(--postonsteroids-accent) hover:brightness-110 text-white font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all">
                  <mat-icon class="text-[15px]! size-[15px]!">play_circle</mat-icon>
                  <span>Schedule Run</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Active & Past Collection Jobs -->
          @if (runnerScheduler.jobs().length === 0) {
            <div class="rounded-xl border border-dashed border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/40 p-10 text-center space-y-2">
              <mat-icon class="text-[36px]! size-[36px]! text-(--postonsteroids-text-muted)">event_busy</mat-icon>
              <p class="text-sm font-semibold">No scheduled runner jobs yet</p>
              <p class="text-xs text-(--postonsteroids-text-muted)">Use the scheduler form above or open Collection Runner inside Workspace to schedule automated capsule runs.</p>
            </div>
          } @else {
            <div class="space-y-2.5">
              @for (job of runnerScheduler.jobs(); track job.id) {
                <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div class="space-y-1 min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-sm truncate">{{ job.capsuleName }}</span>
                      <span class="px-2 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-[11px]">{{ job.scopeLabel }}</span>
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                            [class.bg-emerald-500/15]="job.status === 'running'"
                            [class.text-emerald-400]="job.status === 'running'"
                            [class.bg-amber-500/15]="job.status === 'waiting'"
                            [class.text-amber-400]="job.status === 'waiting'"
                            [class.bg-(--postonsteroids-bg-tertiary)]="job.status === 'completed' || job.status === 'cancelled'"
                            [class.text-(--postonsteroids-text-muted)]="job.status === 'completed' || job.status === 'cancelled'">
                        {{ job.status }}
                      </span>
                    </div>
                    <div class="text-[11px] text-(--postonsteroids-text-muted) flex flex-wrap gap-x-4 gap-y-0.5">
                      <span>Runs: <b>{{ job.runCount }}</b></span>
                      <span>Repeat: <b>{{ job.repeatMs > 0 ? (job.repeatMs / 1000) + 's' : 'Once' }}</b></span>
                      <span>Summary: <b>{{ job.lastSummary || 'Pending' }}</b></span>
                      @if (job.nextRunAt) {
                        <span>Next: <b>{{ job.nextRunAt | date:'medium' }}</b></span>
                      }
                    </div>
                  </div>

                  <div class="flex items-center gap-1.5 shrink-0">
                    <button type="button" (click)="runnerScheduler.triggerJobNow(job.id)"
                            class="px-2.5 py-1 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-emerald-500/50 text-xs font-semibold flex items-center gap-1 cursor-pointer">
                      <mat-icon class="text-[14px]! size-[14px]! text-emerald-400">play_arrow</mat-icon>
                      <span>Run Now</span>
                    </button>
                    @if (job.status === 'running' || job.status === 'waiting') {
                      <button type="button" (click)="runnerScheduler.cancelJob(job.id)"
                              class="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/35 text-amber-300 hover:bg-amber-500/25 text-xs font-semibold cursor-pointer">
                        Stop
                      </button>
                    }
                    <button type="button" (click)="runnerScheduler.removeJob(job.id)"
                            class="p-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-status-danger/50 hover:text-status-danger cursor-pointer"
                            title="Remove job">
                      <mat-icon class="text-[14px]! size-[14px]!">delete</mat-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        } @else {
          <!-- Automation Activity Logs -->
          <div class="flex items-center justify-between">
            <span class="text-xs text-(--postonsteroids-text-muted)">
              Unified stream of triggered request chains and scheduled runner executions ({{ unifiedLogs().length }} entries).
            </span>
            @if (unifiedLogs().length > 0) {
              <button type="button" (click)="clearAllLogs()"
                      class="px-3 py-1 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) hover:border-status-danger/50 hover:text-status-danger text-xs font-semibold flex items-center gap-1 cursor-pointer">
                <mat-icon class="text-[14px]! size-[14px]!">delete_sweep</mat-icon>
                <span>Clear Logs</span>
              </button>
            }
          </div>

          @if (unifiedLogs().length === 0) {
            <div class="rounded-xl border border-dashed border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/40 p-10 text-center space-y-2">
              <mat-icon class="text-[36px]! size-[36px]! text-(--postonsteroids-text-muted)">receipt_long</mat-icon>
              <p class="text-sm font-semibold">No automation execution logs yet</p>
              <p class="text-xs text-(--postonsteroids-text-muted)">Start a recurring trigger schedule or run a collection job to inspect live execution history here.</p>
            </div>
          } @else {
            <div class="space-y-2">
              @for (entry of unifiedLogs(); track entry.id) {
                <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-3 text-xs space-y-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="px-1.5 py-0.5 rounded font-mono font-bold bg-(--postonsteroids-bg-tertiary)"
                            [style.color]="getMethodColor(entry.method)">{{ entry.method }}</span>
                      <span class="font-semibold truncate">{{ entry.requestName }}</span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) text-(--postonsteroids-text-muted)">{{ entry.sourceLabel }}</span>
                    </div>
                    <div class="flex items-center gap-2.5 shrink-0 font-mono text-[11px]">
                      <span class="px-2 py-0.5 rounded font-bold"
                            [class.bg-emerald-500/15]="entry.status >= 200 && entry.status < 300"
                            [class.text-emerald-400]="entry.status >= 200 && entry.status < 300"
                            [class.bg-status-danger/15]="entry.status === 0 || entry.status >= 400"
                            [class.text-status-danger]="entry.status === 0 || entry.status >= 400">
                        {{ entry.status || 'ERR' }}
                      </span>
                      <span class="text-(--postonsteroids-text-muted)">{{ entry.durationMs }} ms</span>
                      @if (entry.testsPassed > 0 || entry.testsFailed > 0) {
                        <span class="text-emerald-400">{{ entry.testsPassed }} passed</span>
                        @if (entry.testsFailed > 0) {
                          <span class="text-status-danger">{{ entry.testsFailed }} failed</span>
                        }
                      }
                      <span class="text-(--postonsteroids-text-muted)">{{ entry.timestamp | date:'mediumTime' }}</span>
                      @if (entry.responseBody !== undefined || entry.error) {
                        <button type="button" (click)="toggleExpandedLog(entry.id)"
                                class="px-2 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-(--postonsteroids-accent)/60 text-[10.5px] cursor-pointer">
                          {{ expandedLogId() === entry.id ? 'Hide Details' : 'Details' }}
                        </button>
                      }
                    </div>
                  </div>
                  @if (expandedLogId() === entry.id) {
                    <pre class="p-2.5 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11px] max-h-48 overflow-auto whitespace-pre-wrap break-all">{{ formatLogDetail(entry) }}</pre>
                  }
                </div>
              }
            </div>
          }
        }
      </div>
    </div>
  `
})
export class AutomationComponent {
  tabState = inject(TabStateService);
  executionService = inject(RequestExecutionService);
  runnerScheduler = inject(RunnerSchedulerService);
  private notification = inject(NotificationService);
  private router = inject(Router);

  protected readonly Math = Math;

  activeSection = signal<AutomationSection>('triggers');
  selectedCapsuleFilter = signal<string>(this.tabState.activeCapsuleId() || '__all__');
  onlyConfiguredFilter = signal<boolean>(false);
  searchQuery = signal<string>('');
  expandedLogId = signal<string | null>(null);

  // Schedule new runner job form signals
  jobCapsuleId = signal<string>(this.tabState.activeCapsuleId() || '1');
  jobGroupId = signal<string>('__all__');
  jobRepeatSeconds = signal<number>(30);
  jobIterations = signal<number>(1);
  jobDelayMs = signal<number>(100);
  jobStartAt = signal<string>('');

  private allKnownRequests = computed<RequestState[]>(() => {
    const capFilter = this.selectedCapsuleFilter();
    const capsules = this.tabState.capsules();
    const out: RequestState[] = [];
    const seen = new Set<string>();
    const targetCaps = capFilter === '__all__'
      ? capsules
      : capsules.filter(c => c.id === capFilter);
    for (const c of targetCaps) {
      for (const req of this.tabState.getCapsuleRequestsSync(c.id)) {
        if (!seen.has(req.id)) {
          seen.add(req.id);
          out.push(req);
        }
      }
    }
    return out;
  });

  filteredRequests = computed<RequestState[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const onlyConfigured = this.onlyConfiguredFilter();
    const activeScheds = this.executionService.activeSchedules();

    return this.allKnownRequests().filter(req => {
      if (onlyConfigured) {
        const cfg = this.getTriggerConfig(req);
        const configured = !!req.postTriggerTabId || !!activeScheds[req.id] || (cfg.retryCountOnFail ?? 0) > 0;
        if (!configured) return false;
      }
      if (!q) return true;
      const title = this.tabState.resolveRequestTitle(req.name, req.url).toLowerCase();
      return title.includes(q) || (req.url || '').toLowerCase().includes(q) || (req.method || '').toLowerCase().includes(q);
    });
  });

  chainedRequestCount = computed(() =>
    this.allKnownRequests().filter(r => !!r.postTriggerTabId || (r.triggerConfig?.retryCountOnFail ?? 0) > 0).length
  );

  activeTotalScheduleCount = computed(() =>
    Object.keys(this.executionService.activeSchedules()).length + this.runnerScheduler.activeJobs().length
  );

  jobAvailableGroups = computed(() =>
    this.tabState.getGroupsForCapsule(this.jobCapsuleId())
  );

  unifiedLogs = computed<UnifiedAutomationLog[]>(() => {
    const triggerLogs: UnifiedAutomationLog[] = this.executionService.triggerScheduleLogs().map(l => ({
      id: `trg_${l.id}`,
      timestamp: l.timestamp,
      source: 'trigger',
      sourceLabel: 'Trigger Schedule',
      method: l.method,
      requestName: l.requestName,
      url: l.url || '',
      status: l.status,
      durationMs: l.durationMs,
      testsPassed: l.testsPassed || 0,
      testsFailed: l.testsFailed || 0,
      responseBody: l.responseBody,
      error: l.error
    }));

    const runnerLogs: UnifiedAutomationLog[] = this.runnerScheduler.executionLogs().map(l => ({
      id: `col_${l.id}`,
      timestamp: l.timestamp,
      source: 'collection',
      sourceLabel: l.jobName || 'Collection Job',
      method: l.method,
      requestName: l.requestName,
      url: l.url || '',
      status: l.status,
      durationMs: l.durationMs,
      testsPassed: l.testsPassed,
      testsFailed: l.testsFailed,
      responseBody: l.responseBody,
      error: l.error
    }));

    return [...triggerLogs, ...runnerLogs].sort((a, b) => b.timestamp - a.timestamp);
  });

  getMethodColor(method: string): string {
    return getHttpMethodColor(method);
  }

  getCapsuleName(capsuleId?: string): string {
    if (!capsuleId) return 'My Capsule';
    return this.tabState.capsules().find(c => c.id === capsuleId)?.name || 'Capsule';
  }

  getTriggerConfig(req: RequestState): TriggerFlowConfig {
    return req.triggerConfig || {
      condition: 'always',
      expectedStatus: 200,
      delayMs: 250,
      retryCountOnFail: 0,
      scheduleIntervalMs: 0,
      scheduleStartAt: null,
      scheduleEndAt: null
    };
  }

  getChainCandidates(req: RequestState): RequestState[] {
    const capId = req.capsuleId || this.tabState.activeCapsuleId() || '1';
    return this.tabState.getCapsuleRequestsSync(capId).filter(r => r.id !== req.id);
  }

  updateRequestChainTarget(req: RequestState, targetId: string): void {
    const cleanTarget = targetId || null;
    const cfg = this.getTriggerConfig(req);
    const nextCondition: TriggerFlowCondition = cleanTarget === '__script__'
      ? 'script-only'
      : (cfg.condition === 'script-only' ? 'always' : cfg.condition);
    this.tabState.updateState(req.id, {
      postTriggerTabId: cleanTarget,
      triggerConfig: { ...cfg, condition: nextCondition }
    });
  }

  patchRequestTriggerConfig(req: RequestState, patch: Partial<TriggerFlowConfig>): void {
    this.tabState.updateState(req.id, {
      triggerConfig: {
        ...this.getTriggerConfig(req),
        ...patch
      }
    });
  }

  clampNonNeg(raw: unknown, max: number): number {
    const num = Math.floor(Number(raw) || 0);
    return Math.max(0, Math.min(max, num));
  }

  getScheduleSeconds(req: RequestState): number {
    const ms = this.getTriggerConfig(req).scheduleIntervalMs || 10000;
    return Math.max(1, Math.round(ms / 1000));
  }

  onScheduleSecondsChange(req: RequestState, rawSeconds: unknown): void {
    const sec = Math.max(1, Math.min(86400, Math.round(Number(rawSeconds) || 10)));
    const ms = sec * 1000;
    this.patchRequestTriggerConfig(req, { scheduleIntervalMs: ms });
    if (this.executionService.isScheduleActive(req.id)) {
      const cfg = this.getTriggerConfig(req);
      this.executionService.startSchedule(req.id, ms, {
        startAt: cfg.scheduleStartAt ?? null,
        endAt: cfg.scheduleEndAt ?? null
      });
    }
  }

  toggleRequestSchedule(req: RequestState): void {
    const cfg = this.getTriggerConfig(req);
    const intervalMs = cfg.scheduleIntervalMs && cfg.scheduleIntervalMs > 0 ? cfg.scheduleIntervalMs : 10000;
    this.executionService.toggleSchedule(req.id, intervalMs, {
      startAt: cfg.scheduleStartAt ?? null,
      endAt: cfg.scheduleEndAt ?? null
    });
  }

  clearRequestAutomation(req: RequestState): void {
    this.executionService.stopSchedule(req.id, true);
    this.tabState.updateState(req.id, {
      postTriggerTabId: null,
      triggerConfig: {
        condition: 'always',
        expectedStatus: 200,
        delayMs: 250,
        retryCountOnFail: 0,
        scheduleIntervalMs: 0,
        scheduleStartAt: null,
        scheduleEndAt: null
      }
    });
    this.notification.notify(`Cleared automation configuration for "${this.tabState.resolveRequestTitle(req.name, req.url)}".`);
  }

  runRequestOnce(req: RequestState): void {
    if (!req.url?.trim()) {
      this.notification.notify('Please configure a URL for this request before running.', 'warning');
      return;
    }
    void this.executionService.executeRequest(req.id);
    this.notification.notify(`Triggered "${this.tabState.resolveRequestTitle(req.name, req.url)}"...`);
  }

  openRequestInWorkspace(req: RequestState): void {
    const cap = this.tabState.capsules().find(c => c.id === req.capsuleId);
    if (cap && cap.id !== this.tabState.activeCapsuleId()) {
      void this.tabState.switchCapsule(cap).then(() => {
        this.tabState.addOpenTab(req);
        this.tabState.setActiveTab(req.id);
      });
    } else {
      this.tabState.addOpenTab(req);
      this.tabState.setActiveTab(req.id);
    }
    void this.router.navigate(['/']);
  }

  stopAllSchedules(): void {
    const stoppedRequests = this.executionService.stopAllSchedules();
    const activeJobs = this.runnerScheduler.activeJobs();
    for (const job of activeJobs) {
      this.runnerScheduler.cancelJob(job.id, true);
    }
    this.notification.notify(`Stopped ${stoppedRequests} request schedule(s) and ${activeJobs.length} runner job(s).`);
  }

  onJobCapsuleChange(capId: string): void {
    this.jobCapsuleId.set(capId);
    this.jobGroupId.set('__all__');
  }

  createScheduledJob(): void {
    const capId = this.jobCapsuleId();
    const cap = this.tabState.capsules().find(c => c.id === capId);
    const groupId = this.jobGroupId();
    const grp = this.tabState.getGroupsForCapsule(capId).find(g => g.id === groupId);
    const startMs = this.runnerScheduler.parseLocalDateTimeMs(this.jobStartAt()) ?? Date.now();
    this.runnerScheduler.scheduleCollectionRun({
      capsuleId: capId,
      capsuleName: cap?.name || 'Capsule',
      groupId,
      scopeLabel: grp ? `Folder: ${grp.name}` : 'All Requests',
      startAtMs: startMs,
      endAtMs: null,
      repeatMs: this.jobRepeatSeconds() > 0 ? this.jobRepeatSeconds() * 1000 : 0,
      iterations: this.jobIterations(),
      delayMs: this.jobDelayMs(),
      dataRows: []
    });
  }

  clearAllLogs(): void {
    this.executionService.clearTriggerScheduleLogs();
    this.runnerScheduler.clearLogs();
    this.expandedLogId.set(null);
    this.notification.notify('Cleared all automation execution logs.');
  }

  toggleExpandedLog(id: string): void {
    this.expandedLogId.update(curr => curr === id ? null : id);
  }

  formatLogDetail(entry: UnifiedAutomationLog): string {
    if (entry.error) return entry.error;
    if (typeof entry.responseBody === 'string') return entry.responseBody;
    try {
      return JSON.stringify(entry.responseBody, null, 2);
    } catch {
      return String(entry.responseBody ?? '');
    }
  }

  goToWorkspace(): void {
    void this.router.navigate(['/']);
  }
}
