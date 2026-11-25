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
import { analyzeTriggerLoops, detectProposedTriggerLoop } from '../../shared/utils/trigger-graph.util';

type AutomationSection = 'triggers' | 'jobs' | 'logs';

interface TriggerCardEntry {
  cardId: string;
  request: RequestState;
  isDraft: boolean;
}

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
  testResults?: Array<{ name: string; passed: boolean; error?: string }>;
  error?: string;
}

@Component({
  selector: 'app-automation',
  imports: [CommonModule, FormsModule, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex-1 min-h-0 h-full flex flex-col overflow-hidden'
  },
  template: `
    <div class="flex-1 min-h-0 h-full w-full flex flex-col bg-(--postonsteroids-bg-primary) text-(--postonsteroids-text-primary) overflow-hidden">
      <!-- Header -->
      <div class="px-6 py-4 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-(--postonsteroids-accent)/15 border border-(--postonsteroids-accent)/30 flex items-center justify-center shrink-0">
            <mat-icon class="text-[22px]! size-[22px]! text-(--postonsteroids-accent)">alt_route</mat-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base font-bold tracking-tight truncate">Trigger &amp; Automation Studio</h1>
            <p class="text-xs text-(--postonsteroids-text-muted) truncate">
              Create targeted request triggers, conditional chains, recurring schedules, and inspect execution logs.
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
            <span class="text-(--postonsteroids-text-muted)">Configured Triggers</span>
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

      <!-- Sub-Navigation Tabs & Controls -->
      <div class="px-6 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border)">
          <button type="button" (click)="activeSection.set('triggers')"
                  class="px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                  [class.bg-(--postonsteroids-accent)]="activeSection() === 'triggers'"
                  [class.text-white]="activeSection() === 'triggers'"
                  [class.text-(--postonsteroids-text-secondary)]="activeSection() !== 'triggers'">
            <mat-icon class="text-[15px]! size-[15px]!">alt_route</mat-icon>
            <span>Request Triggers ({{ triggerCards().length }})</span>
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
                    (ngModelChange)="onCapsuleFilterChange($event)"
                    class="bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
              @for (cap of tabState.capsules(); track cap.id) {
                <option [value]="cap.id" class="bg-(--postonsteroids-bg-secondary)">{{ cap.name }}</option>
              }
              <option value="__all__" class="bg-(--postonsteroids-bg-secondary)">All Capsules</option>
            </select>

            <div class="relative">
              <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-text-muted) absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">search</mat-icon>
              <input type="text"
                     [ngModel]="searchQuery()"
                     (ngModelChange)="searchQuery.set($event)"
                     placeholder="Filter active triggers..."
                     class="pl-8 pr-3 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent) w-48" />
            </div>

            <button type="button" (click)="addTriggerCard()"
                    [disabled]="selectableSourceRequests().length === 0"
                    class="px-3 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:brightness-110 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-45 disabled:cursor-not-allowed">
              <mat-icon class="text-[15px]! size-[15px]!">add</mat-icon>
              <span>Create Trigger</span>
            </button>
          </div>
        }
      </div>

      <!-- Scrollable Content Area -->
      <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
        @if (activeSection() === 'triggers') {
          <!-- Trigger Loop Advisory + Live Cycle Detection Banner -->
          @if (cycleAnalysis().hasLoops) {
            <div class="rounded-xl border border-red-500/45 bg-red-500/10 p-3.5 flex items-start gap-3 text-xs">
              <mat-icon class="text-[20px]! size-[20px]! text-red-400 shrink-0 mt-0.5">warning</mat-icon>
              <div class="space-y-1 min-w-0 flex-1">
                <div class="font-bold text-red-300">
                  Circular Trigger Loop Detected ({{ cycleAnalysis().cycleDescriptions.length }})
                </div>
                <p class="text-red-200/90 leading-relaxed">
                  Two or more triggers point back to each other, which creates a trigger loop during chained execution. A runtime loop guard halts repeat visits automatically, or break one link below:
                </p>
                <div class="space-y-1 pt-0.5">
                  @for (desc of cycleAnalysis().cycleDescriptions; track desc) {
                    <div class="font-mono text-[11px] px-2.5 py-1 rounded bg-red-950/50 border border-red-500/30 text-red-200 break-all">
                      {{ desc }}
                    </div>
                  }
                </div>
              </div>
            </div>
          } @else {
            <div class="rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-amber-200/90">
              <mat-icon class="text-[17px]! size-[17px]! text-amber-400 shrink-0">info</mat-icon>
              <span>
                <strong>Tip:</strong> Only configured triggers appear here for fast loading. Click <strong>+ Create Trigger</strong> to add another rule. Avoid linking two requests mutually (e.g. A &rarr; B and B &rarr; A) or a trigger loop can occur.
              </span>
            </div>
          }

          @if (allKnownRequests().length === 0) {
            <div class="rounded-xl border border-dashed border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/40 p-10 text-center space-y-2">
              <mat-icon class="text-[36px]! size-[36px]! text-(--postonsteroids-text-muted)">alt_route</mat-icon>
              <p class="text-sm font-semibold">No requests available in this capsule</p>
              <p class="text-xs text-(--postonsteroids-text-muted)">Create or import requests in the Workspace first, then return here to wire automated triggers or schedules.</p>
            </div>
          } @else if (triggerCards().length === 0) {
            <div class="rounded-xl border border-dashed border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/40 p-10 text-center space-y-3">
              <mat-icon class="text-[36px]! size-[36px]! text-(--postonsteroids-text-muted)">filter_alt_off</mat-icon>
              <p class="text-sm font-semibold">No triggers match "{{ searchQuery() }}"</p>
              <div class="flex items-center justify-center gap-2">
                <button type="button" (click)="searchQuery.set('')"
                        class="px-3 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) text-xs font-semibold cursor-pointer">
                  Clear Filter
                </button>
                <button type="button" (click)="addTriggerCard()"
                        class="px-3 py-1.5 rounded-lg bg-(--postonsteroids-accent) text-white text-xs font-semibold cursor-pointer">
                  + Create Trigger
                </button>
              </div>
            </div>
          } @else {
            <div class="space-y-3">
              @for (card of triggerCards(); track card.cardId) {
                @let req = card.request;
                @let cfg = getTriggerConfig(req);
                @let sched = executionService.activeSchedules()[req.id] || null;
                @let capName = getCapsuleName(req.capsuleId);
                @let cardCycles = cycleAnalysis().requestCycleMessages.get(req.id) || [];
                @let isRunningThis = runningTriggerIds().has(req.id);
                <div class="rounded-xl border bg-(--postonsteroids-bg-secondary) p-4 space-y-3 transition-colors"
                     [class.border-red-500/60]="cardCycles.length > 0"
                     [class.border-(--postonsteroids-border)]="cardCycles.length === 0">

                  <!-- Card Header: Source Request Selector + Actions -->
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-2 min-w-0 flex-1">
                      <span class="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) shrink-0"
                            [style.color]="getMethodColor(req.method)">
                        {{ req.method }}
                      </span>

                      <div class="min-w-[220px] max-w-[420px] flex-1">
                        <label class="block text-[10px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted) mb-0.5">
                          Trigger Source Request ({{ capName }})
                        </label>
                        <select aria-label="Trigger source request"
                                [ngModel]="req.id"
                                (ngModelChange)="swapCardSourceRequest(card, $event)"
                                class="w-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs font-semibold text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
                          <option [value]="req.id" class="bg-(--postonsteroids-bg-secondary)">
                            {{ req.method }} · {{ tabState.resolveRequestTitle(req.name, req.url) }}
                          </option>
                          @for (cand of getSourceSwapCandidates(req.id); track cand.id) {
                            <option [value]="cand.id" class="bg-(--postonsteroids-bg-secondary)">
                              {{ cand.method }} · {{ tabState.resolveRequestTitle(cand.name, cand.url) }}
                            </option>
                          }
                        </select>
                      </div>

                      <div class="text-[11px] font-mono text-(--postonsteroids-text-muted) truncate max-w-md pt-3">
                        {{ req.url || 'No URL configured' }}
                      </div>

                      @if (sched) {
                        <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/35 font-semibold flex items-center gap-1 shrink-0 mt-3">
                          <span class="size-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          {{ sched.status === 'waiting' ? 'Scheduled' : 'Running' }} · #{{ sched.runCount }}
                        </span>
                      }
                    </div>

                    <div class="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button type="button" (click)="runRequestOnce(req)" [disabled]="isRunningThis"
                              class="px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-emerald-500/50 hover:text-emerald-400 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50">
                        @if (isRunningThis) {
                          <mat-icon class="text-[14px]! size-[14px]! animate-spin text-emerald-400">sync</mat-icon>
                          <span>Running...</span>
                        } @else {
                          <mat-icon class="text-[14px]! size-[14px]! text-emerald-400">play_arrow</mat-icon>
                          <span>Run Now</span>
                        }
                      </button>

                      <button type="button" (click)="toggleRequestSchedule(req)"
                              class="px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                              [class.bg-emerald-500/15]="sched !== null"
                              [class.border-emerald-500/40]="sched !== null"
                              [class.text-emerald-400]="sched !== null"
                              [class.bg-(--postonsteroids-bg-tertiary)]="sched === null"
                              [class.border-(--postonsteroids-border)]="sched === null"
                              [class.text-(--postonsteroids-text-primary)]="sched === null">
                        <mat-icon class="text-[14px]! size-[14px]!">{{ sched ? 'stop' : 'schedule' }}</mat-icon>
                        <span>{{ sched ? 'Stop Schedule' : 'Start Schedule' }}</span>
                      </button>

                      <button type="button" (click)="openRequestInWorkspace(req)"
                              title="Open request in OnSteroid workspace"
                              class="px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-accent)/15 border border-(--postonsteroids-accent)/40 text-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent)/25 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors">
                        <mat-icon class="text-[14px]! size-[14px]!">open_in_new</mat-icon>
                        <span>Open</span>
                      </button>

                      <button type="button" (click)="removeTriggerCard(card)"
                              title="Reset trigger rules and remove card"
                              class="px-2 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-status-danger/50 hover:text-status-danger text-xs cursor-pointer transition-colors flex items-center gap-1">
                        <mat-icon class="text-[14px]! size-[14px]!">delete</mat-icon>
                      </button>
                    </div>
                  </div>

                  <!-- Per-card Circular Loop Alert -->
                  @if (cardCycles.length > 0) {
                    <div class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 flex items-center gap-2 text-[11px] text-red-200">
                      <mat-icon class="text-[16px]! size-[16px]! text-red-400 shrink-0">loop</mat-icon>
                      <span>
                        <strong>Loop Warning:</strong> {{ cardCycles[0] }} — two or more requests trigger each other in a cycle.
                      </span>
                    </div>
                  }

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
                        <option value="" class="bg-(--postonsteroids-bg-secondary)">None (Stop here / Retry &amp; Schedule only)</option>
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
                        Recurring Interval &amp; Start Time
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
                               title="Optional Start Date &amp; Time (leave empty to run immediately)"
                               [ngModel]="cfg.scheduleStartAt || ''"
                               (ngModelChange)="patchRequestTriggerConfig(req, { scheduleStartAt: ($event || '').trim() || null })"
                               class="flex-1 min-w-0 bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2 py-1 text-[11px] outline-none focus:border-(--postonsteroids-accent)" />
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>

            <div class="pt-1 flex justify-center">
              <button type="button" (click)="addTriggerCard()"
                      [disabled]="selectableSourceRequests().length === 0"
                      class="px-4 py-2 rounded-xl border border-dashed border-(--postonsteroids-accent)/50 bg-(--postonsteroids-accent)/8 hover:bg-(--postonsteroids-accent)/15 text-(--postonsteroids-accent) text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-45 disabled:cursor-not-allowed">
                <mat-icon class="text-[16px]! size-[16px]!">add_circle_outline</mat-icon>
                <span>Create Another Trigger</span>
              </button>
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
              Unified stream of manual trigger runs, chained requests, and scheduled runner executions ({{ unifiedLogs().length }} entries).
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
              <p class="text-xs text-(--postonsteroids-text-muted)">Click Run Now on any trigger, start a recurring schedule, or run a collection job to inspect live execution history here.</p>
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
                      @if (entry.responseBody !== undefined || entry.error || (entry.testResults && entry.testResults.length > 0)) {
                        <button type="button" (click)="toggleExpandedLog(entry.id)"
                                class="px-2 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-(--postonsteroids-accent)/60 text-[10.5px] cursor-pointer">
                          {{ expandedLogId() === entry.id ? 'Hide Details' : 'Details' }}
                        </button>
                      }
                    </div>
                  </div>
                  @if (expandedLogId() === entry.id) {
                    <div class="space-y-1.5">
                      @if (entry.url) {
                        <div class="font-mono text-[11px] text-(--postonsteroids-text-muted) break-all">{{ entry.url }}</div>
                      }
                      <pre class="p-2.5 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11px] max-h-56 overflow-auto whitespace-pre-wrap break-all">{{ formatLogDetail(entry) }}</pre>
                    </div>
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
  searchQuery = signal<string>('');
  expandedLogId = signal<string | null>(null);
  runningTriggerIds = signal<Set<string>>(new Set());

  /** Explicit user-created trigger cards (starts empty, showing starter card when none are configured yet) */
  private draftTriggerRequestIds = signal<string[]>([]);
  private dismissedStarterWhenEmpty = signal<boolean>(false);

  // Schedule new runner job form signals
  jobCapsuleId = signal<string>(this.tabState.activeCapsuleId() || '1');
  jobGroupId = signal<string>('__all__');
  jobRepeatSeconds = signal<number>(30);
  jobIterations = signal<number>(1);
  jobDelayMs = signal<number>(100);
  jobStartAt = signal<string>('');

  readonly allKnownRequests = computed<RequestState[]>(() => {
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

  private isRequestConfigured(req: RequestState, activeScheds: Record<string, any>): boolean {
    const cfg = this.getTriggerConfig(req);
    return (
      !!req.postTriggerTabId ||
      !!activeScheds[req.id] ||
      (cfg.retryCountOnFail ?? 0) > 0 ||
      (cfg.scheduleIntervalMs ?? 0) > 0
    );
  }

  readonly cycleAnalysis = computed(() =>
    analyzeTriggerLoops(
      this.allKnownRequests(),
      r => this.tabState.resolveRequestTitle(r.name, r.url)
    )
  );

  readonly triggerCards = computed<TriggerCardEntry[]>(() => {
    const all = this.allKnownRequests();
    const activeScheds = this.executionService.activeSchedules();
    const drafts = this.draftTriggerRequestIds();
    const q = this.searchQuery().trim().toLowerCase();

    const byId = new Map(all.map(r => [r.id, r]));
    const cards: TriggerCardEntry[] = [];
    const includedIds = new Set<string>();

    // 1. Configured trigger/schedule requests
    for (const req of all) {
      if (this.isRequestConfigured(req, activeScheds)) {
        includedIds.add(req.id);
        cards.push({ cardId: `cfg_${req.id}`, request: req, isDraft: drafts.includes(req.id) });
      }
    }

    // 2. Explicitly added draft trigger cards
    for (const draftId of drafts) {
      const req = byId.get(draftId);
      if (req && !includedIds.has(req.id)) {
        includedIds.add(req.id);
        cards.push({ cardId: `draft_${req.id}`, request: req, isDraft: true });
      }
    }

    // 3. Default single starter card so the page opens cleanly with 1 editable trigger when empty
    if (cards.length === 0 && all.length > 0 && !this.dismissedStarterWhenEmpty()) {
      const activeId = this.tabState.activeTabId();
      const firstReq = (activeId && byId.get(activeId)) || all[0];
      cards.push({ cardId: `starter_${firstReq.id}`, request: firstReq, isDraft: true });
    }

    if (!q) return cards;
    return cards.filter(c => {
      const title = this.tabState.resolveRequestTitle(c.request.name, c.request.url).toLowerCase();
      return title.includes(q) || (c.request.url || '').toLowerCase().includes(q) || (c.request.method || '').toLowerCase().includes(q);
    });
  });

  readonly selectableSourceRequests = computed(() => {
    const displayedIds = new Set(this.triggerCards().map(c => c.request.id));
    return this.allKnownRequests().filter(r => !displayedIds.has(r.id));
  });

  chainedRequestCount = computed(() => {
    const activeScheds = this.executionService.activeSchedules();
    return this.allKnownRequests().filter(r => this.isRequestConfigured(r, activeScheds)).length;
  });

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
      sourceLabel: 'Trigger Execution',
      method: l.method,
      requestName: l.requestName,
      url: l.url || '',
      status: l.status,
      durationMs: l.durationMs,
      testsPassed: l.testsPassed || 0,
      testsFailed: l.testsFailed || 0,
      responseBody: l.responseBody,
      testResults: l.testResults,
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
      testResults: l.testResults,
      error: l.error
    }));

    return [...triggerLogs, ...runnerLogs].sort((a, b) => b.timestamp - a.timestamp);
  });

  onCapsuleFilterChange(capId: string): void {
    this.selectedCapsuleFilter.set(capId);
    this.draftTriggerRequestIds.set([]);
    this.dismissedStarterWhenEmpty.set(false);
  }

  addTriggerCard(): void {
    this.dismissedStarterWhenEmpty.set(false);
    // Preserve any visible starter/draft cards so adding a new card never drops an existing unconfigured card
    const currentCardIds = this.triggerCards().map(c => c.request.id);
    const available = this.selectableSourceRequests();
    if (available.length === 0) {
      this.notification.notify('All requests in the current scope already have a trigger card.', 'warning');
      return;
    }
    const nextReq = available[0];
    this.draftTriggerRequestIds.update(curr => {
      const merged = Array.from(new Set([...curr, ...currentCardIds, nextReq.id]));
      return merged;
    });
    this.notification.notify(`Added trigger card for "${this.tabState.resolveRequestTitle(nextReq.name, nextReq.url)}".`);
  }

  getSourceSwapCandidates(currentReqId: string): RequestState[] {
    const displayedOtherIds = new Set(
      this.triggerCards().map(c => c.request.id).filter(id => id !== currentReqId)
    );
    return this.allKnownRequests().filter(r => r.id !== currentReqId && !displayedOtherIds.has(r.id));
  }

  swapCardSourceRequest(card: TriggerCardEntry, newRequestId: string): void {
    if (!newRequestId || newRequestId === card.request.id) return;
    const prevCfg = this.getTriggerConfig(card.request);
    const prevTarget = card.request.postTriggerTabId || null;

    // Move draft slot from old request to the newly picked source request
    this.draftTriggerRequestIds.update(curr => [
      ...curr.filter(id => id !== card.request.id && id !== newRequestId),
      newRequestId
    ]);

    // If previous request only had draft state without schedule running, keep it clean unless configured
    if (!this.isRequestConfigured(card.request, this.executionService.activeSchedules()) && prevTarget) {
      this.tabState.updateState(newRequestId, {
        postTriggerTabId: prevTarget,
        triggerConfig: prevCfg
      });
    }
  }

  removeTriggerCard(card: TriggerCardEntry): void {
    const req = card.request;
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
    this.draftTriggerRequestIds.update(curr => curr.filter(id => id !== req.id));
    if (this.allKnownRequests().filter(r => r.id !== req.id && this.isRequestConfigured(r, this.executionService.activeSchedules())).length === 0) {
      this.dismissedStarterWhenEmpty.set(true);
    }
    this.notification.notify(`Removed trigger configuration for "${this.tabState.resolveRequestTitle(req.name, req.url)}".`);
  }

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

    this.draftTriggerRequestIds.update(curr => curr.includes(req.id) ? curr : [...curr, req.id]);
    const loopCheck = detectProposedTriggerLoop(
      this.allKnownRequests(),
      req.id,
      cleanTarget,
      r => this.tabState.resolveRequestTitle(r.name, r.url)
    );

    this.tabState.updateState(req.id, {
      postTriggerTabId: cleanTarget,
      triggerConfig: { ...cfg, condition: nextCondition }
    });

    if (loopCheck.hasLoop) {
      this.notification.notify(
        `Warning: Linking to this target creates a trigger loop (${loopCheck.descriptions[0]}).`,
        'warning'
      );
    }
  }

  patchRequestTriggerConfig(req: RequestState, patch: Partial<TriggerFlowConfig>): void {
    this.draftTriggerRequestIds.update(curr => curr.includes(req.id) ? curr : [...curr, req.id]);
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
        endAt: cfg.scheduleEndAt ?? null,
        runImmediately: false
      });
    }
  }

  toggleRequestSchedule(req: RequestState): void {
    this.draftTriggerRequestIds.update(curr => curr.includes(req.id) ? curr : [...curr, req.id]);
    const cfg = this.getTriggerConfig(req);
    const intervalMs = cfg.scheduleIntervalMs && cfg.scheduleIntervalMs > 0 ? cfg.scheduleIntervalMs : 10000;
    if (!cfg.scheduleIntervalMs || cfg.scheduleIntervalMs <= 0) {
      this.patchRequestTriggerConfig(req, { scheduleIntervalMs: intervalMs });
    }
    this.executionService.toggleSchedule(req.id, intervalMs, {
      startAt: cfg.scheduleStartAt ?? null,
      endAt: cfg.scheduleEndAt ?? null,
      runImmediately: true
    });
  }

  async runRequestOnce(req: RequestState): Promise<void> {
    if (!req.url?.trim()) {
      this.notification.notify('Please configure a URL for this request before running.', 'warning');
      return;
    }
    this.runningTriggerIds.update(s => new Set(s).add(req.id));
    this.notification.notify(`Running trigger "${this.tabState.resolveRequestTitle(req.name, req.url)}"...`);
    try {
      await this.executionService.executeRequest(req.id, false, 0, 0, {
        isolatedRun: true,
        recordTriggerLog: true,
        chainVisitedIds: [req.id],
        onComplete: (summary) => {
          this.executionService.recordTriggerExecutionLog(req.id, req, summary);
          if (summary.status >= 200 && summary.status < 300) {
            this.notification.notify(`Trigger completed (${summary.status} · ${Math.round(summary.durationMs)}ms).`, 'success');
          } else {
            this.notification.notify(`Trigger finished with status ${summary.status || 'Error'}.`, summary.status ? 'warning' : 'error');
          }
        }
      });
    } finally {
      this.runningTriggerIds.update(s => {
        const next = new Set(s);
        next.delete(req.id);
        return next;
      });
    }
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
    const parts: string[] = [];
    if (entry.error) parts.push(`Error: ${entry.error}`);
    if (entry.testResults && entry.testResults.length > 0) {
      parts.push(
        'Test Results:\n' +
          entry.testResults
            .map(t => `  [${t.passed ? 'PASS' : 'FAIL'}] ${t.name}${t.error ? ` — ${t.error}` : ''}`)
            .join('\n')
      );
    }
    if (entry.responseBody !== undefined && entry.responseBody !== null) {
      try {
        parts.push(
          typeof entry.responseBody === 'string'
            ? entry.responseBody
            : JSON.stringify(entry.responseBody, null, 2)
        );
      } catch {
        parts.push(String(entry.responseBody ?? ''));
      }
    }
    return parts.join('\n\n') || '(No details recorded)';
  }

  goToWorkspace(): void {
    void this.router.navigate(['/']);
  }
}
