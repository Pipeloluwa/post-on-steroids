import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestGroup, RequestState } from '../../shared/services/tab.state.service';
import { RequestExecutionService } from '../../shared/services/request.execution.service';
import { NotificationService } from '../../shared/services/notification.service';
import { BodyPortalDirective } from '../../shared/directives/body-portal.directive';
import { RunnerSchedulerService, CollectionScheduleTarget } from '../../shared/services/runner-scheduler.service';
import { getHttpMethodColor } from '../../shared/utils/http-method.util';
import { copyTextToClipboard } from '../../shared/utils/clipboard.util';

interface RunnerResultRow {
  id: string;
  iteration: number;
  capsuleId?: string;
  requestId: string;
  requestName: string;
  method: string;
  url?: string;
  status: number;
  responseTime: number;
  testsPassed: number;
  testsFailed: number;
  dataRowLabel?: string;
  responseHeaders?: any[];
  responseBody?: any;
  testResults?: Array<{ name: string; passed: boolean; error?: string }>;
  error?: string;
}

interface InspectedExecutionDetail {
  sourceLabel: string;
  timestamp?: number;
  method: string;
  requestName: string;
  requestId?: string;
  url?: string;
  status: number;
  durationMs: number;
  testsPassed: number;
  testsFailed: number;
  responseHeaders?: any[];
  responseBody?: any;
  testResults?: Array<{ name: string; passed: boolean; error?: string }>;
  error?: string;
}

interface CapsuleTreeGroupNode {
  group: RequestGroup;
  requests: RequestState[];
}

interface CapsuleTreeNode {
  capsule: { id: string; name: string };
  totalRequests: RequestState[];
  groups: CapsuleTreeGroupNode[];
  rootRequests: RequestState[];
}

@Component({
  selector: 'app-collection-runner-modal',
  imports: [CommonModule, FormsModule, MatIcon, DatePipe, BodyPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)'
  },
  template: `
    @if (isOpen()) {
      <div appBodyPortal class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4" (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="runner-modal-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col h-[min(86dvh,calc(100dvh-28px))] max-h-[calc(100dvh-28px)] relative"
             (click)="$event.stopPropagation()">

          <!-- Header with Consolidated Runner & Scheduled Tasks Tabs -->
          <div class="px-5 py-3 border-b border-(--postonsteroids-border) flex flex-wrap items-center justify-between gap-3 bg-(--postonsteroids-bg-tertiary) shrink-0">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-xl bg-(--postonsteroids-accent)/15 border border-(--postonsteroids-accent)/30 flex items-center justify-center text-(--postonsteroids-accent)">
                <mat-icon class="text-[20px]! size-[20px]!">play_circle</mat-icon>
              </div>
              <div>
                <h2 id="runner-modal-title" class="text-[14px] font-bold text-(--postonsteroids-text-primary)">
                  Collection Runner &amp; Scheduled Tasks
                </h2>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">
                  Select any capsules, folders, or requests to run now, schedule recurring jobs, and inspect execution responses.
                </p>
              </div>
            </div>

            <!-- Unified View Switcher -->
            <div class="flex items-center gap-2">
              <div class="flex items-center p-0.5 rounded-xl bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-[11.5px]">
                <button type="button" (click)="activeView.set('runner')"
                        class="px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                        [class.bg-(--postonsteroids-accent)]="activeView() === 'runner'"
                        [class.text-white]="activeView() === 'runner'"
                        [class.text-(--postonsteroids-text-secondary)]="activeView() !== 'runner'">
                  <mat-icon class="text-[14px]! size-[14px]!">checklist</mat-icon>
                  <span>Runner &amp; Selection</span>
                </button>
                <button type="button" (click)="activeView.set('scheduled')"
                        class="px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                        [class.bg-amber-600]="activeView() === 'scheduled'"
                        [class.text-white]="activeView() === 'scheduled'"
                        [class.text-(--postonsteroids-text-secondary)]="activeView() !== 'scheduled'">
                  <mat-icon class="text-[14px]! size-[14px]!">schedule</mat-icon>
                  <span>Scheduled Tasks &amp; Activity</span>
                  @if (runnerScheduler.activeTotalCount() > 0) {
                    <span class="px-1.5 py-0 rounded-full text-[10px] font-bold"
                          [class.bg-white/25]="activeView() === 'scheduled'"
                          [class.text-white]="activeView() === 'scheduled'"
                          [class.bg-amber-500/20]="activeView() !== 'scheduled'"
                          [class.text-amber-300]="activeView() !== 'scheduled'">
                      {{ runnerScheduler.activeTotalCount() }}
                    </span>
                  }
                </button>
              </div>

              <button type="button" (click)="close()" aria-label="Close Runner"
                      class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
                <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
              </button>
            </div>
          </div>

          <!-- VIEW 1: MULTI-CAPSULE SELECTION TREE, CONFIG & LIVE RESULTS -->
          @if (activeView() === 'runner') {
            <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
              <!-- Left Column: Multi-Capsule Hierarchical Selection Tree -->
              <div class="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary)/40 flex flex-col min-h-[200px] overflow-hidden">
                <div class="px-3.5 py-2 border-b border-(--postonsteroids-border) flex items-center justify-between gap-2 bg-(--postonsteroids-bg-tertiary)/50 shrink-0">
                  <div class="text-[11.5px] font-bold text-(--postonsteroids-text-primary) flex items-center gap-1.5">
                    <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-accent)">account_tree</mat-icon>
                    <span>Capsules, Folders &amp; Requests</span>
                  </div>
                  <div class="flex items-center gap-1.5 text-[10.5px]">
                    <button type="button" (click)="selectActiveCapsuleAll()"
                            class="px-2 py-0.5 rounded bg-(--postonsteroids-bg-secondary) hover:bg-(--postonsteroids-bg-hover) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) font-medium cursor-pointer">
                      Active All
                    </button>
                    <button type="button" (click)="clearTargetSelection()" [disabled]="selectedRequestIds().size === 0"
                            class="px-2 py-0.5 rounded bg-(--postonsteroids-bg-secondary) hover:bg-(--postonsteroids-bg-hover) border border-(--postonsteroids-border) text-(--postonsteroids-text-muted) disabled:opacity-40 cursor-pointer">
                      Clear
                    </button>
                  </div>
                </div>

                <!-- Scrollable Tree -->
                <div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1 text-[11.5px]">
                  @for (capNode of capsuleTreeNodes(); track capNode.capsule.id) {
                    <div class="rounded-lg border border-(--postonsteroids-border)/50 bg-(--postonsteroids-bg-secondary)/60 overflow-hidden">
                      <!-- Capsule Row -->
                      <div class="flex items-center gap-1.5 px-2 py-1.5 hover:bg-(--postonsteroids-bg-hover)/60 transition-colors">
                        <button type="button" (click)="toggleCapsuleExpand(capNode.capsule.id)"
                                class="p-0.5 rounded text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) cursor-pointer flex items-center justify-center">
                          <mat-icon class="text-[15px]! size-[15px]! transition-transform"
                                    [class.rotate-90]="expandedCapsuleIds().has(capNode.capsule.id)">chevron_right</mat-icon>
                        </button>
                        <input type="checkbox"
                               [checked]="isCapsuleAllSelected(capNode)"
                               [indeterminate]="isCapsulePartialSelected(capNode)"
                               (change)="toggleCapsuleSelection(capNode, $any($event.target).checked)"
                               class="accent-(--postonsteroids-accent) cursor-pointer shrink-0" />
                        <button type="button" (click)="toggleCapsuleExpand(capNode.capsule.id)"
                                class="flex-1 min-w-0 flex items-center justify-between gap-2 text-left cursor-pointer">
                          <span class="flex items-center gap-1.5 min-w-0">
                            <mat-icon class="text-[14px]! size-[14px]! text-(--postonsteroids-accent) shrink-0">inventory_2</mat-icon>
                            <span class="font-bold text-(--postonsteroids-text-primary) truncate">{{ capNode.capsule.name }}</span>
                            @if (capNode.capsule.id === tabState.activeCapsuleId()) {
                              <span class="px-1 py-0 rounded text-[9px] font-bold bg-(--postonsteroids-accent)/15 text-(--postonsteroids-accent) shrink-0">Active</span>
                            }
                          </span>
                          <span class="text-[10px] font-mono text-(--postonsteroids-text-muted) shrink-0">
                            {{ countSelectedInCapsule(capNode) }}/{{ capNode.totalRequests.length }}
                          </span>
                        </button>
                      </div>

                      <!-- Capsule Children (Folders + Root Requests) -->
                      @if (expandedCapsuleIds().has(capNode.capsule.id)) {
                        <div class="pl-5 pr-1.5 pb-1.5 pt-0.5 border-t border-(--postonsteroids-border)/30 space-y-1">
                          @if (loadingCapsuleIds().has(capNode.capsule.id)) {
                            <div class="px-2 py-1.5 text-[10.5px] text-(--postonsteroids-text-muted) flex items-center gap-1.5">
                              <mat-icon class="text-[13px]! size-[13px]! animate-spin text-(--postonsteroids-accent)">sync</mat-icon>
                              <span>Loading capsule requests...</span>
                            </div>
                          } @else if (capNode.totalRequests.length === 0) {
                            <div class="px-2 py-1 text-[10.5px] text-(--postonsteroids-text-muted) italic">
                              No requests in this capsule.
                            </div>
                          } @else {
                            <!-- Folders -->
                            @for (grpNode of capNode.groups; track grpNode.group.id) {
                              <div class="rounded border border-(--postonsteroids-border)/35 bg-(--postonsteroids-bg-primary)/40">
                                <div class="flex items-center gap-1.5 px-2 py-1 hover:bg-(--postonsteroids-bg-hover)/50">
                                  <button type="button" (click)="toggleGroupExpand(grpNode.group.id)"
                                          class="p-0.5 rounded text-(--postonsteroids-text-muted) cursor-pointer flex items-center justify-center">
                                    <mat-icon class="text-[14px]! size-[14px]! transition-transform"
                                              [class.rotate-90]="expandedGroupIds().has(grpNode.group.id)">chevron_right</mat-icon>
                                  </button>
                                  <input type="checkbox"
                                         [disabled]="grpNode.requests.length === 0"
                                         [checked]="isGroupAllSelected(grpNode)"
                                         [indeterminate]="isGroupPartialSelected(grpNode)"
                                         (change)="toggleGroupSelection(grpNode, $any($event.target).checked)"
                                         class="accent-(--postonsteroids-accent) cursor-pointer shrink-0" />
                                  <button type="button" (click)="toggleGroupExpand(grpNode.group.id)"
                                          class="flex-1 min-w-0 flex items-center justify-between gap-2 text-left cursor-pointer">
                                    <span class="flex items-center gap-1.5 min-w-0">
                                      <mat-icon class="text-[14px]! size-[14px]! text-amber-400 shrink-0">folder</mat-icon>
                                      <span class="font-semibold text-(--postonsteroids-text-primary) truncate">{{ grpNode.group.name }}</span>
                                    </span>
                                    <span class="text-[9.5px] font-mono text-(--postonsteroids-text-muted) shrink-0">
                                      {{ countSelectedInList(grpNode.requests) }}/{{ grpNode.requests.length }}
                                    </span>
                                  </button>
                                </div>

                                @if (expandedGroupIds().has(grpNode.group.id)) {
                                  <div class="pl-5 pr-1 pb-1 space-y-0.5">
                                    @for (req of grpNode.requests; track req.id) {
                                      <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-(--postonsteroids-bg-hover)/55 cursor-pointer">
                                        <input type="checkbox"
                                               [checked]="selectedRequestIds().has(req.id)"
                                               (change)="toggleRequestSelection(req.capsuleId || capNode.capsule.id, req.id, $any($event.target).checked)"
                                               class="accent-(--postonsteroids-accent) cursor-pointer shrink-0" />
                                        <span class="text-[9.5px] font-mono font-bold w-9 shrink-0" [style.color]="getMethodColor(req.method)">
                                          {{ req.method }}
                                        </span>
                                        <span class="truncate text-(--postonsteroids-text-primary)">{{ req.name || req.url }}</span>
                                      </label>
                                    }
                                  </div>
                                }
                              </div>
                            }

                            <!-- Standalone / Root Requests -->
                            @for (req of capNode.rootRequests; track req.id) {
                              <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-(--postonsteroids-bg-hover)/55 cursor-pointer">
                                <input type="checkbox"
                                       [checked]="selectedRequestIds().has(req.id)"
                                       (change)="toggleRequestSelection(req.capsuleId || capNode.capsule.id, req.id, $any($event.target).checked)"
                                       class="accent-(--postonsteroids-accent) cursor-pointer shrink-0" />
                                <span class="text-[9.5px] font-mono font-bold w-9 shrink-0" [style.color]="getMethodColor(req.method)">
                                  {{ req.method }}
                                </span>
                                <span class="truncate text-(--postonsteroids-text-primary)">{{ req.name || req.url }}</span>
                              </label>
                            }
                          }
                        </div>
                      }
                    </div>
                  }
                </div>

                <!-- Selection Count Footer -->
                <div class="px-3.5 py-2 border-t border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) text-[11px] flex items-center justify-between shrink-0">
                  <span class="text-(--postonsteroids-text-secondary)">
                    Selected: <b class="text-(--postonsteroids-text-primary)">{{ targetRequests().length }}</b> request(s) across <b class="text-(--postonsteroids-text-primary)">{{ selectedCapsuleCount() }}</b> capsule(s)
                  </span>
                </div>
              </div>

              <!-- Right Column: Run Options, Schedule & Live Results -->
              <div class="lg:col-span-7 flex flex-col min-h-0 overflow-hidden">
                <!-- Controls -->
                <div class="px-4 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary)/30 flex flex-wrap items-end justify-between gap-2 text-xs shrink-0">
                  <div class="flex flex-wrap items-end gap-2.5">
                    <div>
                      <label class="block text-[10px] font-semibold uppercase text-(--postonsteroids-text-muted) mb-1">Iterations</label>
                      <input type="number" min="1" max="500" [ngModel]="iterations()" (ngModelChange)="iterations.set(Math.max(1, +$event || 1))"
                             [disabled]="dataRows().length > 0"
                             class="w-20 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none" />
                    </div>
                    <div>
                      <label class="block text-[10px] font-semibold uppercase text-(--postonsteroids-text-muted) mb-1">Delay (ms)</label>
                      <input type="number" min="0" max="60000" step="50" [ngModel]="delayMs()" (ngModelChange)="delayMs.set(Math.max(0, +$event || 0))"
                             class="w-24 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none" />
                    </div>
                    <div>
                      <input #dataFileInput type="file" accept=".csv,.json" class="hidden" (change)="onDataFileSelected($event)" />
                      <button type="button" (click)="dataFileInput.click()" [disabled]="isRunning()"
                              title="Import CSV or JSON test data file for sequential iterations"
                              class="px-3 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-primary) font-semibold cursor-pointer inline-flex items-center gap-1.5">
                        <mat-icon class="text-[15px]! size-[15px]! text-sky-400">upload_file</mat-icon>
                        <span>{{ dataRows().length > 0 ? 'Data: ' + dataRows().length + ' rows' : 'Import CSV / JSON Data' }}</span>
                      </button>
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    @if (!isRunning()) {
                      <button type="button" (click)="startRun()" [disabled]="targetRequests().length === 0"
                              class="px-4 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:opacity-90 disabled:opacity-40 text-white font-semibold cursor-pointer flex items-center gap-1.5">
                        <mat-icon class="text-[15px]! size-[15px]!">play_arrow</mat-icon>
                        <span>Run Selected ({{ targetRequests().length }})</span>
                      </button>
                    } @else {
                      <button type="button" (click)="stopRun()"
                              class="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer flex items-center gap-1.5">
                        <mat-icon class="text-[15px]! size-[15px]!">stop</mat-icon>
                        <span>Stop</span>
                      </button>
                    }
                  </div>
                </div>

                <!-- Schedule Bar -->
                <div class="px-4 py-2 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/80 flex flex-wrap items-center justify-between gap-2.5 text-[11px] shrink-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
                      <mat-icon class="text-[14px]! size-[14px]!">schedule</mat-icon>
                      <span>Schedule</span>
                    </span>
                    <label class="flex items-center gap-1 text-(--postonsteroids-text-muted)">
                      <span>Start:</span>
                      <input type="datetime-local" [ngModel]="scheduleStartAt()" (ngModelChange)="scheduleStartAt.set($event)"
                             class="px-1.5 py-1 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) font-mono outline-none" />
                    </label>
                    <label class="flex items-center gap-1 text-(--postonsteroids-text-muted)">
                      <span>End:</span>
                      <input type="datetime-local" [ngModel]="scheduleEndAt()" (ngModelChange)="scheduleEndAt.set($event)"
                             class="px-1.5 py-1 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) font-mono outline-none" />
                    </label>
                    <label class="flex items-center gap-1 text-(--postonsteroids-text-muted)">
                      <span>Repeat (s):</span>
                      <input type="number" min="0" [ngModel]="scheduleRepeatSeconds()" (ngModelChange)="scheduleRepeatSeconds.set(Math.max(0, +$event || 0))"
                             class="w-16 px-1.5 py-1 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none" />
                    </label>
                  </div>
                  <div class="flex items-center gap-2">
                    @if (isScheduled()) {
                      <span class="text-amber-400 font-mono font-semibold">{{ scheduledStatusLabel() }}</span>
                      <button type="button" (click)="cancelScheduledRun()"
                              class="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer">
                        Cancel Schedule
                      </button>
                    } @else {
                      <button type="button" (click)="scheduleRunner()" [disabled]="isRunning() || targetRequests().length === 0 || !scheduleStartAt()"
                              class="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-45">
                        Add to Schedule
                      </button>
                    }
                  </div>
                </div>

                <!-- Summary & Results Toolbar -->
                <div class="px-4 py-2 border-b border-(--postonsteroids-border)/70 flex items-center justify-between text-[11px] bg-(--postonsteroids-bg-tertiary)/40 shrink-0">
                  <div class="flex items-center gap-3 flex-wrap">
                    <span>Executed: <b>{{ results().length }}</b></span>
                    <span class="text-emerald-500">2xx/3xx: <b>{{ summaryStats().okCount }}</b></span>
                    <span class="text-red-400">4xx/Err: <b>{{ summaryStats().failCount }}</b></span>
                    <span class="text-blue-400">Tests: <b>{{ summaryStats().testsPassed }}</b> / {{ summaryStats().testsPassed + summaryStats().testsFailed }}</span>
                    <span>Avg: <b>{{ summaryStats().avgTime }} ms</b></span>
                  </div>
                  <div class="flex items-center gap-3">
                    <button type="button" (click)="clearResults()" [disabled]="results().length === 0 || isRunning()"
                            class="text-status-danger hover:underline font-semibold cursor-pointer disabled:opacity-40 flex items-center gap-1">
                      <mat-icon class="text-[13px]! size-[13px]!">delete_sweep</mat-icon>
                      <span>Clear Results</span>
                    </button>
                    <button type="button" (click)="exportReport()" [disabled]="results().length === 0"
                            class="text-(--postonsteroids-accent) hover:underline font-semibold cursor-pointer disabled:opacity-40">
                      Export JSON
                    </button>
                  </div>
                </div>

                <!-- Results Table (Click any row to view response/details) -->
                <div class="flex-1 overflow-y-auto custom-scrollbar bg-(--postonsteroids-bg-primary)">
                  @if (results().length === 0) {
                    <div class="py-12 text-center text-xs text-(--postonsteroids-text-muted) px-4">
                      Select one or more capsules, folders, or requests on the left and click <b>Run Selected</b> or <b>Add to Schedule</b>.<br />
                      <span class="text-[10.5px] opacity-80">Click any executed result row to inspect its full response, headers, and assertions.</span>
                    </div>
                  } @else {
                    <table class="w-full text-left text-xs border-collapse">
                      <thead class="sticky top-0 bg-(--postonsteroids-bg-secondary) border-b border-(--postonsteroids-border) text-[10px] uppercase text-(--postonsteroids-text-muted)">
                        <tr>
                          <th class="py-2 px-3">Iter</th>
                          <th class="py-2 px-3">Request</th>
                          <th class="py-2 px-3">Status</th>
                          <th class="py-2 px-3">Tests</th>
                          <th class="py-2 px-3 text-right">Time</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-(--postonsteroids-border)/50">
                        @for (row of results(); track row.id) {
                          <tr (click)="inspectRunnerRow(row)"
                              title="Click to inspect full response & details"
                              class="hover:bg-(--postonsteroids-bg-hover)/60 cursor-pointer transition-colors">
                            <td class="py-2 px-3 font-mono text-(--postonsteroids-text-muted)">#{{ row.iteration }}</td>
                            <td class="py-2 px-3">
                              <div class="flex items-center gap-1.5">
                                <span class="text-[10px] font-mono font-bold text-(--postonsteroids-accent)">{{ row.method }}</span>
                                <span class="font-medium text-(--postonsteroids-text-primary) truncate max-w-[230px]">{{ row.requestName }}</span>
                              </div>
                            </td>
                            <td class="py-2 px-3 font-mono font-bold"
                                [class.text-emerald-500]="row.status >= 200 && row.status < 300"
                                [class.text-amber-500]="row.status >= 300 && row.status < 400"
                                [class.text-red-500]="row.status >= 400 || row.status === 0">
                              {{ row.status || 'ERR' }}
                            </td>
                            <td class="py-2 px-3">
                              <span [class.text-emerald-500]="row.testsFailed === 0" [class.text-red-400]="row.testsFailed > 0">
                                {{ row.testsPassed }} passed / {{ row.testsFailed }} failed
                              </span>
                            </td>
                            <td class="py-2 px-3 text-right font-mono text-(--postonsteroids-text-muted)">
                              {{ row.responseTime }} ms
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

          <!-- VIEW 2: CONSOLIDATED SCHEDULED TASKS & ACTIVITY LOGS -->
          @if (activeView() === 'scheduled') {
            <div class="flex-1 overflow-y-auto custom-scrollbar p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 bg-(--postonsteroids-bg-primary)">
              <!-- Left Column: Active & Recent Schedules -->
              <div class="flex flex-col gap-4">
                <!-- Collection Schedules -->
                <section class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden">
                  <div class="px-3.5 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) flex items-center justify-between">
                    <div class="flex items-center gap-2 text-[12px] font-bold text-(--postonsteroids-text-primary)">
                      <mat-icon class="text-[16px]! size-[16px]! text-sky-400">play_circle</mat-icon>
                      <span>Collection Runner Schedules</span>
                    </div>
                    <span class="text-[10px] font-mono text-(--postonsteroids-text-muted)">{{ runnerScheduler.jobs().length }} total</span>
                  </div>

                  @if (runnerScheduler.jobs().length === 0) {
                    <div class="p-6 text-center text-[11px] text-(--postonsteroids-text-muted)">
                      No collection schedules configured yet. Switch to <b>Runner &amp; Selection</b> to select targets and schedule a run.
                    </div>
                  } @else {
                    <div class="divide-y divide-(--postonsteroids-border)/50 max-h-[30vh] overflow-y-auto custom-scrollbar">
                      @for (job of runnerScheduler.jobs(); track job.id) {
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
                                <button type="button" (click)="runnerScheduler.triggerJobNow(job.id)" title="Trigger immediately"
                                        class="px-2 py-1 rounded text-[10px] font-semibold bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/30 cursor-pointer">
                                  Run Now
                                </button>
                                <button type="button" (click)="runnerScheduler.cancelJob(job.id)" title="Stop schedule"
                                        class="px-2 py-1 rounded text-[10px] font-semibold bg-red-600/20 hover:bg-red-600/35 text-red-300 border border-red-500/30 cursor-pointer">
                                  Stop
                                </button>
                              } @else {
                                <button type="button" (click)="runnerScheduler.removeJob(job.id)" title="Dismiss entry"
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

                <!-- Trigger Flow Schedules -->
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
                            <button type="button" (click)="focusRequestTab(item.tabId)"
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

              <!-- Right Column: Combined Activity Feed (Click any item to inspect full response) -->
              <section class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden flex flex-col min-h-[260px]">
                <div class="px-3.5 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) flex items-center justify-between shrink-0">
                  <div class="flex items-center gap-2 text-[12px] font-bold text-(--postonsteroids-text-primary)">
                    <mat-icon class="text-[16px]! size-[16px]! text-emerald-400">history</mat-icon>
                    <span>Scheduled Execution Activity</span>
                  </div>
                  <button type="button" (click)="clearAllActivityLogs()" [disabled]="combinedLogs().length === 0"
                          class="text-[10.5px] font-semibold text-status-danger hover:underline disabled:opacity-40 cursor-pointer flex items-center gap-1">
                    <mat-icon class="text-[13px]! size-[13px]!">delete_sweep</mat-icon>
                    <span>Clear Logs</span>
                  </button>
                </div>

                @if (combinedLogs().length === 0) {
                  <div class="flex-1 flex flex-col items-center justify-center p-6 text-center text-[11px] text-(--postonsteroids-text-muted)">
                    <mat-icon class="text-[28px]! size-[28px]! opacity-35 mb-2">playlist_play</mat-icon>
                    No scheduled executions recorded yet.
                  </div>
                } @else {
                  <div class="flex-1 overflow-y-auto custom-scrollbar divide-y divide-(--postonsteroids-border)/50">
                    @for (log of combinedLogs(); track log.id) {
                      <div (click)="inspectActivityLog(log)"
                           title="Click to inspect request response & details"
                           class="px-3 py-2.5 flex items-center justify-between gap-2 text-[11px] hover:bg-(--postonsteroids-bg-hover)/60 cursor-pointer transition-colors">
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
                          <mat-icon class="text-[14px]! size-[14px]! text-(--postonsteroids-text-muted)">chevron_right</mat-icon>
                        </div>
                      </div>
                    }
                  </div>
                }
              </section>
            </div>
          }

          <!-- EXECUTION RESPONSE & REQUEST DETAILS INSPECTOR OVERLAY -->
          @if (inspectedDetail(); as detail) {
            <div class="absolute inset-0 z-30 bg-black/65 backdrop-blur-xs flex items-center justify-center p-4"
                 (click)="inspectedDetail.set(null)">
              <div class="w-full max-w-3xl max-h-[calc(100%-1rem)] rounded-2xl bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) shadow-2xl flex flex-col overflow-hidden"
                   (click)="$event.stopPropagation()">
                <div class="px-4 py-3 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) flex items-center justify-between gap-3 shrink-0">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-(--postonsteroids-accent)/15 text-(--postonsteroids-accent)">
                        {{ detail.method }}
                      </span>
                      <span class="font-bold text-[13px] text-(--postonsteroids-text-primary) truncate">{{ detail.requestName }}</span>
                      <span class="px-2 py-0.5 rounded text-[10.5px] font-mono font-bold"
                            [class.bg-emerald-500/15]="detail.status >= 200 && detail.status < 300"
                            [class.text-emerald-400]="detail.status >= 200 && detail.status < 300"
                            [class.bg-red-500/15]="detail.status === 0 || detail.status >= 400"
                            [class.text-red-400]="detail.status === 0 || detail.status >= 400"
                            [class.bg-amber-500/15]="detail.status >= 300 && detail.status < 400"
                            [class.text-amber-400]="detail.status >= 300 && detail.status < 400">
                        {{ detail.status || 'ERR' }} &middot; {{ detail.durationMs }} ms
                      </span>
                    </div>
                    <div class="text-[11px] font-mono text-(--postonsteroids-text-muted) truncate mt-0.5">
                      {{ detail.sourceLabel }} @if (detail.url) { &middot; {{ detail.url }} }
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    @if (detail.requestId) {
                      <button type="button" (click)="openInspectedRequestTab(detail.requestId)"
                              class="px-2.5 py-1 rounded-lg bg-(--postonsteroids-bg-secondary) hover:bg-(--postonsteroids-bg-hover) border border-(--postonsteroids-border) text-[11px] font-semibold text-(--postonsteroids-text-primary) cursor-pointer">
                        Open Tab
                      </button>
                    }
                    <button type="button" (click)="copyInspectedBody()"
                            class="px-2.5 py-1 rounded-lg bg-(--postonsteroids-bg-secondary) hover:bg-(--postonsteroids-bg-hover) border border-(--postonsteroids-border) text-[11px] font-semibold text-(--postonsteroids-text-primary) cursor-pointer">
                      Copy Body
                    </button>
                    <button type="button" (click)="inspectedDetail.set(null)"
                            class="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
                      <mat-icon class="text-[17px]! size-[17px]!">close</mat-icon>
                    </button>
                  </div>
                </div>

                <div class="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 text-xs bg-(--postonsteroids-bg-primary)">
                  @if (detail.error) {
                    <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/35 text-red-300 font-mono text-[11px]">
                      {{ detail.error }}
                    </div>
                  }

                  @if (detail.testResults && detail.testResults.length > 0) {
                    <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden">
                      <div class="px-3 py-1.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) font-bold text-[11px]">
                        Test Assertions ({{ detail.testsPassed }} passed / {{ detail.testsFailed }} failed)
                      </div>
                      <div class="divide-y divide-(--postonsteroids-border)/40">
                        @for (t of detail.testResults; track $index) {
                          <div class="px-3 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                            <span class="text-(--postonsteroids-text-primary)">{{ t.name }}</span>
                            <span class="font-bold font-mono" [class.text-emerald-400]="t.passed" [class.text-red-400]="!t.passed">
                              {{ t.passed ? 'PASS' : 'FAIL' }}
                            </span>
                          </div>
                        }
                      </div>
                    </div>
                  }

                  @if (detail.responseHeaders && detail.responseHeaders.length > 0) {
                    <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden">
                      <div class="px-3 py-1.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) font-bold text-[11px]">
                        Response Headers ({{ detail.responseHeaders.length }})
                      </div>
                      <div class="max-h-36 overflow-y-auto divide-y divide-(--postonsteroids-border)/40 font-mono text-[10.5px]">
                        @for (h of detail.responseHeaders; track $index) {
                          <div class="px-3 py-1 flex gap-3">
                            <span class="font-semibold text-(--postonsteroids-accent) w-44 shrink-0 truncate">{{ h.key }}</span>
                            <span class="text-(--postonsteroids-text-secondary) break-all">{{ h.value }}</span>
                          </div>
                        }
                      </div>
                    </div>
                  }

                  <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden">
                    <div class="px-3 py-1.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) font-bold text-[11px]">
                      Response Body
                    </div>
                    <pre class="p-3 text-[11px] font-mono text-(--postonsteroids-text-primary) whitespace-pre-wrap break-words max-h-64 overflow-y-auto custom-scrollbar">{{ formattedInspectedBody() }}</pre>
                  </div>
                </div>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `
})
export class CollectionRunnerModalComponent {
  tabState = inject(TabStateService);
  requestExecutor = inject(RequestExecutionService);
  runnerScheduler = inject(RunnerSchedulerService);
  private notification = inject(NotificationService);
  protected Math = Math;

  isOpen = input<boolean>(false);
  initialTab = input<'runner' | 'scheduled'>('runner');
  closed = output<void>();

  activeView = signal<'runner' | 'scheduled'>('runner');
  expandedCapsuleIds = signal<Set<string>>(new Set());
  expandedGroupIds = signal<Set<string>>(new Set());
  loadingCapsuleIds = signal<Set<string>>(new Set());
  selectedTargetsMap = signal<Map<string, string>>(new Map()); // requestId -> capsuleId

  iterations = signal<number>(1);
  delayMs = signal<number>(100);
  dataRows = signal<Record<string, string>[]>([]);
  isRunning = signal<boolean>(false);
  results = signal<RunnerResultRow[]>([]);

  scheduleStartAt = signal<string>('');
  scheduleEndAt = signal<string>('');
  scheduleRepeatSeconds = signal<number>(0);
  activeScheduleJobId = signal<string | null>(null);
  inspectedDetail = signal<InspectedExecutionDetail | null>(null);

  private stopRequested = false;
  private initializedOnOpen = false;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          if (!this.initializedOnOpen) {
            this.initializedOnOpen = true;
            this.activeView.set(this.initialTab());
            const activeCapId = this.tabState.activeCapsuleId();
            if (activeCapId) {
              this.expandedCapsuleIds.update(curr => {
                const next = new Set(curr);
                next.add(activeCapId);
                return next;
              });
              if (this.selectedTargetsMap().size === 0) {
                this.selectActiveCapsuleAll();
              }
            }
          }
        });
      } else {
        this.initializedOnOpen = false;
      }
    });
  }

  selectedRequestIds = computed<Set<string>>(() => new Set(this.selectedTargetsMap().keys()));

  selectedCapsuleCount = computed<number>(() => new Set(this.selectedTargetsMap().values()).size);

  capsuleTreeNodes = computed<CapsuleTreeNode[]>(() => {
    this.tabState.runnerTreeVersion();
    const activeCapId = this.tabState.activeCapsuleId();
    const activeGroups = this.tabState.activeCapsuleGroups();
    const activeReqs = this.tabState.allCapsuleRequests();

    return this.tabState.capsules().map(cap => {
      const totalRequests = cap.id === activeCapId
        ? activeReqs
        : this.tabState.getCapsuleRequestsSync(cap.id);
      const groupsRaw = cap.id === activeCapId
        ? activeGroups
        : this.tabState.getGroupsForCapsule(cap.id);

      const reqById = new Map(totalRequests.map(r => [r.id, r]));
      const assignedIds = new Set<string>();
      const groups: CapsuleTreeGroupNode[] = groupsRaw.map(g => {
        const reqs: RequestState[] = [];
        for (const rId of (g.requestIds || [])) {
          const match = reqById.get(rId);
          if (match) {
            reqs.push(match);
            assignedIds.add(match.id);
          }
        }
        return { group: g, requests: reqs };
      });
      const rootRequests = totalRequests.filter(r => !assignedIds.has(r.id) && (!r.groupId || !groupsRaw.some(g => g.id === r.groupId)));

      return {
        capsule: { id: cap.id, name: cap.name },
        totalRequests,
        groups,
        rootRequests
      };
    });
  });

  targetRequests = computed<RequestState[]>(() => {
    const selected = this.selectedTargetsMap();
    if (selected.size === 0) return [];
    const nodes = this.capsuleTreeNodes();
    const ordered: RequestState[] = [];
    const seen = new Set<string>();
    for (const node of nodes) {
      for (const req of node.totalRequests) {
        if (selected.has(req.id) && !seen.has(req.id)) {
          seen.add(req.id);
          ordered.push(req);
        }
      }
    }
    return ordered;
  });

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
    const colLogs = this.runnerScheduler.executionLogs();
    const trigLogs = this.requestExecutor.triggerScheduleLogs().map(t => ({
      id: t.id,
      timestamp: t.timestamp,
      sourceType: 'trigger' as const,
      jobId: t.tabId,
      jobName: t.requestName,
      capsuleId: undefined,
      requestId: t.tabId,
      method: t.method,
      requestName: t.requestName,
      url: t.url,
      status: t.status,
      durationMs: t.durationMs,
      testsPassed: t.testsPassed,
      testsFailed: t.testsFailed,
      responseHeaders: t.responseHeaders,
      responseBody: t.responseBody,
      testResults: t.testResults,
      error: t.error
    }));
    return [...colLogs, ...trigLogs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 200);
  });

  formattedInspectedBody = computed(() => {
    const detail = this.inspectedDetail();
    if (!detail) return '';
    const body = detail.responseBody;
    if (body === null || body === undefined || body === '') return '(Empty response body)';
    if (typeof body === 'object') {
      try {
        return JSON.stringify(body, null, 2);
      } catch {
        return String(body);
      }
    }
    return String(body);
  });

  getMethodColor(method: string): string {
    return getHttpMethodColor(method);
  }

  toggleCapsuleExpand(capId: string): void {
    const next = new Set(this.expandedCapsuleIds());
    if (next.has(capId)) {
      next.delete(capId);
      this.expandedCapsuleIds.set(next);
      return;
    }
    next.add(capId);
    this.expandedCapsuleIds.set(next);
    const existing = this.tabState.getCapsuleRequestsSync(capId);
    if (existing.length === 0 && capId !== this.tabState.activeCapsuleId()) {
      this.loadingCapsuleIds.update(curr => {
        const s = new Set(curr);
        s.add(capId);
        return s;
      });
      void this.tabState.preloadCapsuleRequestsForRunner(capId).finally(() => {
        this.loadingCapsuleIds.update(curr => {
          const s = new Set(curr);
          s.delete(capId);
          return s;
        });
      });
    }
  }

  toggleGroupExpand(groupId: string): void {
    this.expandedGroupIds.update(curr => {
      const next = new Set(curr);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  countSelectedInList(reqs: RequestState[]): number {
    const sel = this.selectedRequestIds();
    return reqs.filter(r => sel.has(r.id)).length;
  }

  countSelectedInCapsule(capNode: CapsuleTreeNode): number {
    return this.countSelectedInList(capNode.totalRequests);
  }

  isCapsuleAllSelected(capNode: CapsuleTreeNode): boolean {
    return capNode.totalRequests.length > 0 && this.countSelectedInCapsule(capNode) === capNode.totalRequests.length;
  }

  isCapsulePartialSelected(capNode: CapsuleTreeNode): boolean {
    const count = this.countSelectedInCapsule(capNode);
    return count > 0 && count < capNode.totalRequests.length;
  }

  isGroupAllSelected(grpNode: CapsuleTreeGroupNode): boolean {
    return grpNode.requests.length > 0 && this.countSelectedInList(grpNode.requests) === grpNode.requests.length;
  }

  isGroupPartialSelected(grpNode: CapsuleTreeGroupNode): boolean {
    const count = this.countSelectedInList(grpNode.requests);
    return count > 0 && count < grpNode.requests.length;
  }

  async toggleCapsuleSelection(capNode: CapsuleTreeNode, checked: boolean): Promise<void> {
    let reqs = capNode.totalRequests;
    if (checked && reqs.length === 0 && capNode.capsule.id !== this.tabState.activeCapsuleId()) {
      this.expandedCapsuleIds.update(curr => new Set(curr).add(capNode.capsule.id));
      reqs = await this.tabState.preloadCapsuleRequestsForRunner(capNode.capsule.id);
    }
    this.selectedTargetsMap.update(curr => {
      const next = new Map(curr);
      for (const req of reqs) {
        if (checked) next.set(req.id, capNode.capsule.id);
        else next.delete(req.id);
      }
      return next;
    });
  }

  toggleGroupSelection(grpNode: CapsuleTreeGroupNode, checked: boolean): void {
    this.selectedTargetsMap.update(curr => {
      const next = new Map(curr);
      for (const req of grpNode.requests) {
        if (checked) next.set(req.id, req.capsuleId || this.tabState.activeCapsuleId() || '');
        else next.delete(req.id);
      }
      return next;
    });
  }

  toggleRequestSelection(capsuleId: string, requestId: string, checked: boolean): void {
    this.selectedTargetsMap.update(curr => {
      const next = new Map(curr);
      if (checked) next.set(requestId, capsuleId);
      else next.delete(requestId);
      return next;
    });
  }

  selectActiveCapsuleAll(): void {
    const capId = this.tabState.activeCapsuleId();
    if (!capId) return;
    const reqs = this.tabState.allCapsuleRequests();
    this.selectedTargetsMap.set(new Map(reqs.map(r => [r.id, capId])));
  }

  clearTargetSelection(): void {
    this.selectedTargetsMap.set(new Map());
  }

  onEscape(event: Event): void {
    if (!this.isOpen()) return;
    event.preventDefault();
    if (this.inspectedDetail()) {
      this.inspectedDetail.set(null);
      return;
    }
    if (!this.isRunning()) {
      this.close();
    }
  }

  private buildSelectedTargets(): CollectionScheduleTarget[] {
    return this.targetRequests().map(r => ({
      capsuleId: r.capsuleId || this.selectedTargetsMap().get(r.id) || this.tabState.activeCapsuleId() || '1',
      requestId: r.id
    }));
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
    const targets = this.buildSelectedTargets();
    if (targets.length === 0) {
      this.notification.notify('Select at least one capsule, folder, or request to schedule.', 'warning');
      return;
    }

    const capNames = Array.from(new Set(targets.map(t => this.tabState.capsules().find(c => c.id === t.capsuleId)?.name || 'Capsule')));
    const repeatMs = this.scheduleRepeatSeconds() > 0 ? Math.max(1000, this.scheduleRepeatSeconds() * 1000) : 0;

    const job = this.runnerScheduler.scheduleCollectionRun({
      capsuleId: targets[0].capsuleId,
      capsuleName: capNames.length > 1 ? `${capNames.length} Capsules` : capNames[0],
      groupId: '__selected__',
      scopeLabel: `${targets.length} selected request(s)`,
      selectedTargets: targets,
      startAtMs: startMs,
      endAtMs: endMs,
      repeatMs,
      iterations: this.iterations(),
      delayMs: this.delayMs(),
      dataRows: this.dataRows(),
      onBatchResults: (rows) => {
        this.results.set(rows.map((r, i) => ({
          id: `${r.iteration}_${r.requestId}_${i}_${Date.now()}`,
          iteration: r.iteration,
          capsuleId: r.capsuleId,
          requestId: r.requestId,
          requestName: r.requestName,
          method: r.method,
          url: r.url,
          status: r.status,
          responseTime: r.responseTime,
          testsPassed: r.testsPassed,
          testsFailed: r.testsFailed,
          dataRowLabel: r.dataRowLabel,
          responseHeaders: r.responseHeaders,
          responseBody: r.responseBody,
          testResults: r.testResults,
          error: r.error
        })));
      }
    });
    this.activeScheduleJobId.set(job.id);
    this.activeView.set('scheduled');
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
    this.inspectedDetail.set(null);
    this.closed.emit();
  }

  stopRun(): void {
    this.stopRequested = true;
    this.isRunning.set(false);
  }

  clearResults(): void {
    this.results.set([]);
    this.notification.notify('Runner execution results cleared.');
  }

  clearAllActivityLogs(): void {
    this.runnerScheduler.clearLogs();
    this.requestExecutor.clearTriggerScheduleLogs();
    this.notification.notify('Scheduled execution logs cleared.');
  }

  focusRequestTab(tabId: string): void {
    const req = this.tabState.getState(tabId);
    if (req) {
      this.tabState.addOpenTab(req);
      this.tabState.setActiveTab(req.id);
    }
    this.close();
  }

  openInspectedRequestTab(requestId: string): void {
    this.inspectedDetail.set(null);
    this.focusRequestTab(requestId);
  }

  inspectRunnerRow(row: RunnerResultRow): void {
    const fresh = this.tabState.getState(row.requestId);
    this.inspectedDetail.set({
      sourceLabel: `Collection Runner · Iteration #${row.iteration}`,
      method: row.method,
      requestName: row.requestName,
      requestId: row.requestId,
      url: row.url || fresh?.url,
      status: row.status,
      durationMs: row.responseTime,
      testsPassed: row.testsPassed,
      testsFailed: row.testsFailed,
      responseHeaders: row.responseHeaders ?? fresh?.responseHeaders,
      responseBody: row.responseBody !== undefined ? row.responseBody : fresh?.responseBody,
      testResults: row.testResults ?? fresh?.testResults,
      error: row.error
    });
  }

  inspectActivityLog(log: any): void {
    const fresh = log.requestId ? this.tabState.getState(log.requestId) : undefined;
    this.inspectedDetail.set({
      sourceLabel: `${log.sourceType === 'collection' ? 'Scheduled Collection' : 'Trigger Schedule'} · ${log.jobName}`,
      timestamp: log.timestamp,
      method: log.method,
      requestName: log.requestName,
      requestId: log.requestId,
      url: log.url || fresh?.url,
      status: log.status,
      durationMs: log.durationMs,
      testsPassed: log.testsPassed,
      testsFailed: log.testsFailed,
      responseHeaders: log.responseHeaders ?? fresh?.responseHeaders,
      responseBody: log.responseBody !== undefined ? log.responseBody : fresh?.responseBody,
      testResults: log.testResults ?? fresh?.testResults,
      error: log.error
    });
  }

  async copyInspectedBody(): Promise<void> {
    await copyTextToClipboard(this.formattedInspectedBody());
    this.notification.notify('Inspected response body copied to clipboard.');
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
              const obj: Record<string, string> = {};
              if (item && typeof item === 'object') {
                for (const [k, v] of Object.entries(item)) {
                  obj[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
                }
              }
              return obj;
            });
          }
        } else {
          const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
          if (lines.length >= 2) {
            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            rows = lines.slice(1).map(line => {
              const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
              const obj: Record<string, string> = {};
              headers.forEach((h, i) => {
                if (h) obj[h] = cells[i] ?? '';
              });
              return obj;
            });
          }
        }
        this.dataRows.set(rows);
        if (rows.length > 0) this.iterations.set(rows.length);
        this.notification.notify(`Loaded ${rows.length} iteration row(s) from ${file.name}.`);
      } catch (e: any) {
        this.notification.notify(`Failed to parse data file: ${e?.message || 'Invalid CSV/JSON'}`, 'warning');
      } finally {
        inputEl.value = '';
      }
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
          let summary: {
            status: number;
            responseTime: number;
            testsPassed: number;
            testsFailed: number;
            url?: string;
            responseHeaders?: any[];
            responseBody?: any;
            testResults?: Array<{ name: string; passed: boolean; error?: string }>;
            error?: string;
          } | null = null;

          await this.requestExecutor.executeRequest(req.id, false, 0, 0, {
            isolatedRun: true,
            overrideVars: activeRowData,
            onComplete: (res) => {
              summary = {
                status: res.status,
                responseTime: Math.round(res.durationMs || 0),
                testsPassed: res.testsPassed,
                testsFailed: res.testsFailed,
                url: res.url || req.url,
                responseHeaders: res.responseHeaders,
                responseBody: res.responseBody,
                testResults: res.testResults,
                error: res.error
              };
            }
          });

          const fresh = this.tabState.getState(req.id);
          const s = summary as any;
          this.results.update(curr => [
            ...curr,
            {
              id: `${iter}_${req.id}_${curr.length}`,
              iteration: iter,
              capsuleId: req.capsuleId,
              requestId: req.id,
              requestName: fresh?.name || req.name,
              method: fresh?.method || req.method,
              url: s?.url || fresh?.url || req.url,
              status: s ? s.status : (fresh?.responseStatus ?? 0),
              responseTime: s ? s.responseTime : Math.round(fresh?.responseTime ?? 0),
              testsPassed: s ? s.testsPassed : (fresh?.testResults || []).filter((t: any) => t.passed).length,
              testsFailed: s ? s.testsFailed : (fresh?.testResults || []).filter((t: any) => !t.passed).length,
              responseHeaders: s?.responseHeaders ?? fresh?.responseHeaders,
              responseBody: s?.responseBody !== undefined ? s.responseBody : fresh?.responseBody,
              testResults: s?.testResults ?? fresh?.testResults,
              error: s?.error
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
