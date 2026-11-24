import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { TabStateService, RequestState } from './tab.state.service';
import { RequestExecutionService } from './request.execution.service';
import { NotificationService } from './notification.service';
import { generateUUID } from '../utils/uuid.util';

export interface CollectionRunnerRowResult {
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

export interface CollectionScheduleTarget {
  capsuleId: string;
  requestId: string;
}

export interface CollectionScheduleJob {
  id: string;
  capsuleId: string;
  capsuleName: string;
  scopeLabel: string;
  groupId: string;
  selectedTargets?: CollectionScheduleTarget[];
  startAtMs: number;
  endAtMs: number | null;
  repeatMs: number;
  iterations: number;
  delayMs: number;
  dataRows: Record<string, string>[];
  status: 'waiting' | 'running' | 'completed' | 'cancelled';
  runCount: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastSummary: string;
}

export interface ScheduledExecutionLogEntry {
  id: string;
  timestamp: number;
  sourceType: 'collection' | 'trigger';
  jobId: string;
  jobName: string;
  capsuleId?: string;
  requestId?: string;
  method: string;
  requestName: string;
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

interface InternalJobTimers {
  startTimerId?: ReturnType<typeof setTimeout>;
  intervalId?: ReturnType<typeof setInterval>;
  endTimerId?: ReturnType<typeof setTimeout>;
  activeExecution: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class RunnerSchedulerService implements OnDestroy {
  private tabState = inject(TabStateService);
  private requestExecutor = inject(RequestExecutionService);
  private notification = inject(NotificationService);

  readonly jobs = signal<CollectionScheduleJob[]>([]);
  readonly executionLogs = signal<ScheduledExecutionLogEntry[]>([]);
  private timersMap = new Map<string, InternalJobTimers>();

  readonly activeJobs = computed(() =>
    this.jobs().filter(j => j.status === 'waiting' || j.status === 'running')
  );

  readonly activeTotalCount = computed(() => {
    const colCount = this.activeJobs().length;
    const reqCount = Object.keys(this.requestExecutor.activeSchedules()).length;
    return colCount + reqCount;
  });

  parseLocalDateTimeMs(value: string): number | null {
    const trimmed = (value || '').trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const [, y, m, d, hh, mm, ss] = match;
      const ms = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss || '0'), 0).getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    const ms = new Date(trimmed).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  private scheduleTimeoutSafe(fn: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const MAX_TIMEOUT_MS = 2_147_483_647;
    if (delayMs <= MAX_TIMEOUT_MS) {
      return setTimeout(fn, Math.max(0, delayMs));
    }
    return setTimeout(() => this.scheduleTimeoutSafe(fn, delayMs - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
  }

  appendLog(entry: Omit<ScheduledExecutionLogEntry, 'id'>): void {
    this.executionLogs.update(curr => [{ id: generateUUID(), ...entry }, ...curr].slice(0, 200));
  }

  clearLogs(): void {
    this.executionLogs.set([]);
  }

  scheduleCollectionRun(config: {
    capsuleId: string;
    capsuleName: string;
    groupId: string;
    scopeLabel: string;
    selectedTargets?: CollectionScheduleTarget[];
    startAtMs: number;
    endAtMs: number | null;
    repeatMs: number;
    iterations: number;
    delayMs: number;
    dataRows: Record<string, string>[];
    onBatchResults?: (rows: CollectionRunnerRowResult[]) => void;
  }): CollectionScheduleJob {
    const now = Date.now();
    const isFutureStart = config.startAtMs > now + 500;
    const job: CollectionScheduleJob = {
      id: `job_${generateUUID().slice(0, 8)}`,
      capsuleId: config.capsuleId,
      capsuleName: config.capsuleName,
      scopeLabel: config.scopeLabel,
      groupId: config.groupId,
      selectedTargets: config.selectedTargets ? [...config.selectedTargets] : undefined,
      startAtMs: config.startAtMs,
      endAtMs: config.endAtMs,
      repeatMs: config.repeatMs,
      iterations: Math.max(1, config.iterations || 1),
      delayMs: Math.max(0, config.delayMs || 0),
      dataRows: [...(config.dataRows || [])],
      status: isFutureStart ? 'waiting' : 'running',
      runCount: 0,
      nextRunAt: isFutureStart ? config.startAtMs : now,
      lastRunAt: null,
      lastSummary: isFutureStart ? `Scheduled for ${new Date(config.startAtMs).toLocaleString()}` : 'Starting...'
    };

    this.jobs.update(curr => [job, ...curr.slice(0, 49)]);

    const timers: InternalJobTimers = { activeExecution: false };
    this.timersMap.set(job.id, timers);

    const runTick = async () => {
      const currentJob = this.jobs().find(j => j.id === job.id);
      if (!currentJob || currentJob.status === 'cancelled' || currentJob.status === 'completed') {
        return;
      }
      if (currentJob.endAtMs !== null && Date.now() >= currentJob.endAtMs) {
        this.completeJob(job.id, 'Reached configured end date/time.');
        return;
      }
      if (timers.activeExecution) return;
      timers.activeExecution = true;

      const startedAt = Date.now();
      this.patchJob(job.id, {
        status: 'running',
        runCount: currentJob.runCount + 1,
        lastRunAt: startedAt,
        nextRunAt: currentJob.repeatMs > 0 ? startedAt + currentJob.repeatMs : null
      });

      try {
        const batchResults = await this.executeCollectionJobSnapshot(currentJob);
        if (config.onBatchResults) {
          config.onBatchResults(batchResults);
        }
        const okCount = batchResults.filter(r => r.status >= 200 && r.status < 300).length;
        const failCount = batchResults.length - okCount;
        this.patchJob(job.id, {
          lastSummary: `${okCount}/${batchResults.length} OK (${failCount} fail)`
        });
      } finally {
        timers.activeExecution = false;
        const latest = this.jobs().find(j => j.id === job.id);
        if (latest && latest.status !== 'cancelled') {
          if (latest.repeatMs <= 0) {
            this.completeJob(job.id, latest.lastSummary || 'One-time scheduled run completed.');
          } else if (latest.endAtMs !== null && Date.now() >= latest.endAtMs) {
            this.completeJob(job.id, 'Completed at configured end date/time.');
          }
        }
      }
    };

    if (config.endAtMs !== null) {
      timers.endTimerId = this.scheduleTimeoutSafe(() => {
        this.completeJob(job.id, 'Stopped at configured end date/time.');
        this.notification.notify(`Scheduled Collection "${config.capsuleName}" stopped at end date/time.`);
      }, Math.max(0, config.endAtMs - now));
    }

    const armInterval = () => {
      if (config.repeatMs > 0) {
        timers.intervalId = setInterval(() => {
          void runTick();
        }, config.repeatMs);
      }
    };

    if (isFutureStart) {
      timers.startTimerId = this.scheduleTimeoutSafe(() => {
        const latest = this.jobs().find(j => j.id === job.id);
        if (!latest || latest.status === 'cancelled') return;
        void runTick();
        armInterval();
      }, config.startAtMs - now);
      this.notification.notify(
        `Collection run scheduled for ${new Date(config.startAtMs).toLocaleString()}`,
        'success'
      );
    } else {
      void runTick();
      armInterval();
      this.notification.notify(
        `Scheduled collection run started (${config.repeatMs > 0 ? `every ${Math.round(config.repeatMs / 1000)}s` : 'immediate'}).`,
        'success'
      );
    }

    return job;
  }

  async triggerJobNow(jobId: string): Promise<void> {
    const job = this.jobs().find(j => j.id === jobId);
    if (!job) return;
    const timers = this.timersMap.get(jobId);
    if (timers?.activeExecution) {
      this.notification.notify(`Job "${job.capsuleName}" is already executing.`, 'warning');
      return;
    }
    this.patchJob(jobId, {
      status: 'running',
      runCount: job.runCount + 1,
      lastRunAt: Date.now()
    });
    const batch = await this.executeCollectionJobSnapshot(job);
    const okCount = batch.filter(r => r.status >= 200 && r.status < 300).length;
    this.patchJob(jobId, {
      status: job.repeatMs > 0 && (job.endAtMs === null || Date.now() < job.endAtMs) ? 'running' : 'completed',
      lastSummary: `${okCount}/${batch.length} OK`
    });
  }

  cancelJob(jobId: string, silent = false): void {
    const timers = this.timersMap.get(jobId);
    if (timers) {
      if (timers.startTimerId) clearTimeout(timers.startTimerId);
      if (timers.intervalId) clearInterval(timers.intervalId);
      if (timers.endTimerId) clearTimeout(timers.endTimerId);
      this.timersMap.delete(jobId);
    }
    const job = this.jobs().find(j => j.id === jobId);
    if (!job) return;
    this.patchJob(jobId, { status: 'cancelled', nextRunAt: null });
    if (!silent) {
      this.notification.notify(`Scheduled collection job "${job.capsuleName}" cancelled.`);
    }
  }

  removeJob(jobId: string): void {
    this.cancelJob(jobId, true);
    this.jobs.update(curr => curr.filter(j => j.id !== jobId));
  }

  private completeJob(jobId: string, summary: string): void {
    const timers = this.timersMap.get(jobId);
    if (timers) {
      if (timers.startTimerId) clearTimeout(timers.startTimerId);
      if (timers.intervalId) clearInterval(timers.intervalId);
      if (timers.endTimerId) clearTimeout(timers.endTimerId);
      this.timersMap.delete(jobId);
    }
    this.patchJob(jobId, { status: 'completed', nextRunAt: null, lastSummary: summary });
  }

  private patchJob(jobId: string, patch: Partial<CollectionScheduleJob>): void {
    this.jobs.update(curr => curr.map(j => (j.id === jobId ? { ...j, ...patch } : j)));
  }

  private resolveJobRequests(job: CollectionScheduleJob): RequestState[] {
    if (job.selectedTargets && job.selectedTargets.length > 0) {
      const capCache = new Map<string, RequestState[]>();
      const out: RequestState[] = [];
      const seen = new Set<string>();
      for (const target of job.selectedTargets) {
        if (seen.has(target.requestId)) continue;
        let match = this.tabState.getState(target.requestId);
        if (!match && target.capsuleId) {
          if (!capCache.has(target.capsuleId)) {
            capCache.set(target.capsuleId, this.tabState.getCapsuleRequestsSync(target.capsuleId));
          }
          match = capCache.get(target.capsuleId)?.find(r => r.id === target.requestId);
        }
        if (match) {
          seen.add(match.id);
          out.push(match);
        }
      }
      return out;
    }

    const all = this.tabState.getCapsuleRequestsSync(job.capsuleId);
    if (!job.groupId || job.groupId === '__all__') return all;
    const grp = this.tabState.getGroupsForCapsule(job.capsuleId).find(g => g.id === job.groupId);
    if (!grp) return [];
    const byId = new Map(all.map(r => [r.id, r]));
    return grp.requestIds.map(id => byId.get(id)).filter((r): r is RequestState => !!r);
  }

  private async executeCollectionJobSnapshot(job: CollectionScheduleJob): Promise<CollectionRunnerRowResult[]> {
    const queue = this.resolveJobRequests(job);
    const totalIterations = job.dataRows.length > 0 ? job.dataRows.length : job.iterations;
    const results: CollectionRunnerRowResult[] = [];

    for (let iter = 1; iter <= totalIterations; iter++) {
      const latestJob = this.jobs().find(j => j.id === job.id);
      if (!latestJob || latestJob.status === 'cancelled') break;
      const overrideVars = job.dataRows.length > 0 ? job.dataRows[iter - 1] : undefined;

      for (const req of queue) {
        const checkCancelled = this.jobs().find(j => j.id === job.id);
        if (!checkCancelled || checkCancelled.status === 'cancelled') break;

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
        } = { status: 0, responseTime: 0, testsPassed: 0, testsFailed: 0 };

        await this.requestExecutor.executeRequest(req.id, false, 0, 0, {
          isolatedRun: true,
          overrideVars,
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

        const row: CollectionRunnerRowResult = {
          iteration: iter,
          capsuleId: req.capsuleId,
          requestId: req.id,
          requestName: req.name || req.url,
          method: req.method,
          url: summary.url,
          status: summary.status,
          responseTime: summary.responseTime,
          testsPassed: summary.testsPassed,
          testsFailed: summary.testsFailed,
          responseHeaders: summary.responseHeaders,
          responseBody: summary.responseBody,
          testResults: summary.testResults,
          error: summary.error
        };
        results.push(row);

        this.appendLog({
          timestamp: Date.now(),
          sourceType: 'collection',
          jobId: job.id,
          jobName: `${job.capsuleName} (${job.scopeLabel})`,
          capsuleId: req.capsuleId,
          requestId: req.id,
          method: row.method,
          requestName: row.requestName,
          url: row.url,
          status: row.status,
          durationMs: row.responseTime,
          testsPassed: row.testsPassed,
          testsFailed: row.testsFailed,
          responseHeaders: row.responseHeaders,
          responseBody: row.responseBody,
          testResults: row.testResults,
          error: row.error
        });

        if (job.delayMs > 0) {
          await new Promise(r => setTimeout(r, job.delayMs));
        }
      }
    }

    return results;
  }

  ngOnDestroy(): void {
    for (const timers of this.timersMap.values()) {
      if (timers.startTimerId) clearTimeout(timers.startTimerId);
      if (timers.intervalId) clearInterval(timers.intervalId);
      if (timers.endTimerId) clearTimeout(timers.endTimerId);
    }
    this.timersMap.clear();
  }
}
