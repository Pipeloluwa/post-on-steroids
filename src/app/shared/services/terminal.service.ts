import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { TabStateService } from './tab.state.service';
import { VariableService } from './variable.service';
import { EnvironmentService } from './environment.service';
import { RequestExecutionService } from './request.execution.service';
import { SandboxPackagesService } from './sandbox-packages.service';
import { APP_EDITION } from '../../../environments/edition';
import { isElectronApp } from '../utils/url.util';
import { generateUUID } from '../utils/uuid.util';

export interface TerminalLine {
  id: string;
  kind: 'input' | 'info' | 'success' | 'error' | 'warn' | 'code';
  text: string;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class TerminalService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  private tabState = inject(TabStateService);
  private variableService = inject(VariableService);
  private envService = inject(EnvironmentService);
  private requestExecutor = inject(RequestExecutionService);
  readonly packagesService = inject(SandboxPackagesService);

  isOpen = signal<boolean>(false);
  isBusy = signal<boolean>(false);
  commandHistory = signal<string[]>([]);
  lines = signal<TerminalLine[]>([
    {
      id: generateUUID(),
      kind: 'info',
      text: `OnSteroid Terminal (${APP_EDITION.label} Edition). Type "help" to list built-in workspace, request, schedule, and package commands.`,
      timestamp: Date.now()
    }
  ]);

  toggle(): void {
    this.isOpen.update(v => !v);
  }

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  clear(): void {
    this.lines.set([]);
  }

  appendLine(kind: TerminalLine['kind'], text: string): void {
    this.lines.update(curr => [
      ...curr.slice(-400),
      { id: generateUUID(), kind, text, timestamp: Date.now() }
    ]);
  }

  async executeCommand(rawCmd: string): Promise<void> {
    const cmd = (rawCmd || '').trim();
    if (!cmd) return;

    this.commandHistory.update(hist => {
      const next = [cmd, ...hist.filter(h => h !== cmd)].slice(0, 80);
      return next;
    });
    this.appendLine('input', `$ ${cmd}`);

    const lower = cmd.toLowerCase();

    if (lower === 'clear' || lower === 'cls') {
      this.clear();
      return;
    }

    if (lower === 'help' || lower === '?') {
      this.printHelp();
      return;
    }

    // Environment commands (All Editions)
    if (lower === 'env' || lower === 'env list') {
      const activeId = this.envService.activeEnvironmentId();
      const envs = this.envService.environments();
      if (envs.length === 0) {
        this.appendLine('info', 'No environments configured.');
      } else {
        this.appendLine(
          'code',
          envs.map(e => `${e.id === activeId ? '* ' : '  '}${e.name} (${e.variables.length} vars)`).join('\n')
        );
      }
      return;
    }

    if (lower.startsWith('env use ')) {
      const name = cmd.slice(8).trim();
      const matched = this.envService.selectEnvironmentByName(name);
      if (matched) {
        this.appendLine('success', `Switched active environment to "${matched.name}".`);
      } else if (['none', 'off'].includes(name.toLowerCase())) {
        this.appendLine('info', 'Cleared active environment.');
      } else {
        this.appendLine('error', `Environment "${name}" not found.`);
      }
      return;
    }

    // Variable commands (All Editions)
    if (lower === 'vars' || lower === 'var list') {
      const vars = this.variableService.variables();
      if (vars.length === 0) {
        this.appendLine('info', 'No global capsule variables defined.');
      } else {
        this.appendLine(
          'code',
          vars.map(v => `${v.enabled ? '[on] ' : '[off]'} ${v.key} = ${v.value}`).join('\n')
        );
      }
      return;
    }

    if (lower.startsWith('set ')) {
      const rest = cmd.slice(4).trim();
      const eqIdx = rest.indexOf('=');
      if (eqIdx <= 0) {
        this.appendLine('error', 'Usage: set <key>=<value>');
        return;
      }
      const key = rest.slice(0, eqIdx).trim();
      const val = rest.slice(eqIdx + 1).trim();
      this.variableService.addVariable(key, val, undefined, 'global');
      this.appendLine('success', `Variable "${key}" set to "${val}".`);
      return;
    }

    // Request listing & running (All Editions)
    if (lower === 'ls' || lower === 'requests') {
      const reqs = this.tabState.allCapsuleRequests();
      if (reqs.length === 0) {
        this.appendLine('info', 'Active capsule has no requests.');
      } else {
        this.appendLine(
          'code',
          reqs.map((r, i) => `[${i + 1}] ${(r.method || 'GET').padEnd(6)} ${r.name || 'Untitled'} — ${r.url || '(no URL)'}`).join('\n')
        );
      }
      return;
    }

    if (lower.startsWith('run ')) {
      const target = cmd.slice(4).trim().replace(/^["']|["']$/g, '');
      const reqs = this.tabState.allCapsuleRequests();
      const idx = /^\d+$/.test(target) ? Number(target) - 1 : -1;
      const found =
        (idx >= 0 && idx < reqs.length ? reqs[idx] : null) ||
        reqs.find(r => (r.name || '').trim().toLowerCase() === target.toLowerCase()) ||
        reqs.find(r => (r.name || '').toLowerCase().includes(target.toLowerCase()));

      if (!found) {
        this.appendLine('error', `Request "${target}" not found. Type "ls" to see numbered requests.`);
        return;
      }

      this.isBusy.set(true);
      try {
        this.appendLine('info', `Executing ${found.method} ${found.name || found.url}...`);
        this.tabState.addOpenTab(found);
        this.tabState.setActiveTab(found.id);
        await this.requestExecutor.executeRequest(found.id);
        const latest = this.tabState.getState(found.id);
        const status = latest?.responseStatus ?? 0;
        const ms = Math.round(latest?.responseTime ?? 0);
        const preview = typeof latest?.responseBody === 'string'
          ? latest.responseBody.slice(0, 600)
          : JSON.stringify(latest?.responseBody ?? null, null, 2).slice(0, 600);
        this.appendLine(status >= 200 && status < 400 ? 'success' : 'warn', `Response: HTTP ${status} (${ms} ms)`);
        if (preview) this.appendLine('code', preview);
      } finally {
        this.isBusy.set(false);
      }
      return;
    }

    // Recurring automation schedule commands (All Editions)
    if (lower === 'schedule' || lower === 'schedule list' || lower === 'schedule ls') {
      const active = this.requestExecutor.activeSchedules();
      const entries = Object.entries(active);
      if (entries.length === 0) {
        this.appendLine('info', 'No active request schedules. Run e.g. "schedule 1 10" to run request [1] every 10s.');
      } else {
        this.appendLine(
          'code',
          entries
            .map(([id, info]) => {
              const name = this.tabState.getState(id)?.name || id;
              return `* ${name} — every ${Math.round(info.intervalMs / 1000)}s (runs: ${info.runCount})`;
            })
            .join('\n')
        );
      }
      return;
    }

    if (lower === 'schedule stop' || lower === 'schedule stop all') {
      const stopped = this.requestExecutor.stopAllSchedules();
      this.appendLine('info', stopped > 0 ? `Stopped ${stopped} active schedule(s).` : 'No active schedules to stop.');
      return;
    }

    if (lower.startsWith('schedule stop ')) {
      const target = cmd.slice(14).trim().replace(/^["']|["']$/g, '');
      const reqs = this.tabState.allCapsuleRequests();
      const idx = /^\d+$/.test(target) ? Number(target) - 1 : -1;
      const found =
        (idx >= 0 && idx < reqs.length ? reqs[idx] : null) ||
        reqs.find(r => (r.name || '').trim().toLowerCase() === target.toLowerCase()) ||
        reqs.find(r => (r.name || '').toLowerCase().includes(target.toLowerCase()));
      if (!found) {
        this.appendLine('error', `Request "${target}" not found.`);
        return;
      }
      this.requestExecutor.stopSchedule(found.id);
      this.appendLine('success', `Stopped schedule for "${found.name}".`);
      return;
    }

    if (lower.startsWith('schedule ')) {
      const rest = cmd.slice(9).trim();
      const m = rest.match(/^(.*?)\s+(\d+)$/);
      if (!m) {
        this.appendLine('error', 'Usage: schedule <request-name-or-index> <interval-seconds>');
        return;
      }
      const target = m[1].trim().replace(/^["']|["']$/g, '');
      const sec = Math.max(1, Number(m[2]));
      const reqs = this.tabState.allCapsuleRequests();
      const idx = /^\d+$/.test(target) ? Number(target) - 1 : -1;
      const found =
        (idx >= 0 && idx < reqs.length ? reqs[idx] : null) ||
        reqs.find(r => (r.name || '').trim().toLowerCase() === target.toLowerCase()) ||
        reqs.find(r => (r.name || '').toLowerCase().includes(target.toLowerCase()));
      if (!found) {
        this.appendLine('error', `Request "${target}" not found. Type "ls" to see numbered requests.`);
        return;
      }
      const prevCfg = found.triggerConfig || { condition: 'always', expectedStatus: 200, delayMs: 250, retryCountOnFail: 0 };
      this.tabState.updateState(found.id, {
        triggerConfig: { ...prevCfg, scheduleIntervalMs: sec * 1000 }
      });
      this.requestExecutor.startSchedule(found.id, sec * 1000);
      this.appendLine('success', `Scheduled "${found.name}" every ${sec}s. Run "schedule stop" to halt.`);
      return;
    }

    // npm sandbox package installation & management (Professional & Enterprise)
    if (lower === 'npm list' || lower === 'npm ls') {
      if (!APP_EDITION.isProOrHigher) {
        this.appendLine('warn', 'Sandbox npm packages require OnSteroid Professional or Enterprise edition.');
        return;
      }
      const list = this.packagesService.packages();
      if (list.length === 0) {
        this.appendLine('info', 'No sandbox npm packages installed yet. Run e.g. "npm install crypto-js" or "npm install lodash".');
      } else {
        this.appendLine(
          'code',
          list.map(p => `${p.name}@${p.version} (${(p.sizeBytes / 1024).toFixed(1)} KB)`).join('\n')
        );
      }
      return;
    }

    if (/^npm\s+(?:install|i)\s+/i.test(cmd)) {
      if (!APP_EDITION.isProOrHigher) {
        this.appendLine('warn', 'Sandbox `npm install` is restricted to Professional & Enterprise editions.');
        return;
      }
      const rawArgs = cmd.replace(/^npm\s+(?:install|i)\s+/i, '').trim().split(/\s+/).filter(a => !a.startsWith('-'));
      if (rawArgs.length === 0) {
        this.appendLine('error', 'Usage: npm install <package-name> [<package-2> ...]');
        return;
      }
      this.isBusy.set(true);
      try {
        for (const pkgSpec of rawArgs) {
          this.appendLine('info', `Installing ${pkgSpec} into script sandbox...`);
          const installed = await this.packagesService.installPackage(pkgSpec);
          this.appendLine(
            'success',
            `+ ${installed.name}@${installed.version} (${(installed.sizeBytes / 1024).toFixed(1)} KB) ready for \`import\` / \`require\` in scripts.`
          );
        }
      } catch (err: any) {
        this.appendLine('error', err?.message || 'Package installation failed.');
      } finally {
        this.isBusy.set(false);
      }
      return;
    }

    if (/^npm\s+(?:uninstall|rm|remove)\s+/i.test(cmd)) {
      if (!APP_EDITION.isProOrHigher) {
        this.appendLine('warn', 'Sandbox npm package management requires Professional or Enterprise edition.');
        return;
      }
      const target = cmd.replace(/^npm\s+(?:uninstall|rm|remove)\s+/i, '').trim();
      const ok = this.packagesService.uninstallPackage(target);
      this.appendLine(ok ? 'success' : 'warn', ok ? `Removed "${target}" from sandbox packages.` : `Package "${target}" is not installed.`);
      return;
    }

    // Native OS Shell fallback in Electron
    const electronApi = this.isBrowser ? (window as any).electronAPI : null;
    if (isElectronApp() && electronApi?.executeTerminalCommand) {
      this.isBusy.set(true);
      try {
        const res = await electronApi.executeTerminalCommand(cmd);
        if (res?.stdout) this.appendLine('code', res.stdout.trimEnd());
        if (res?.stderr) this.appendLine('error', res.stderr.trimEnd());
        if (!res?.stdout && !res?.stderr) {
          this.appendLine(res?.ok ? 'success' : 'error', `Exited with code ${res?.code ?? (res?.ok ? 0 : 1)}.`);
        }
      } catch (err: any) {
        this.appendLine('error', err?.message || 'OS shell command failed.');
      } finally {
        this.isBusy.set(false);
      }
      return;
    }

    this.appendLine(
      'warn',
      `Unknown command "${cmd}". Built-in commands: help, env, env use <name>, vars, set k=v, ls, run <req>, schedule <req> <sec>, schedule stop${
        APP_EDITION.isProOrHigher ? ', npm install <pkg>, npm list, npm uninstall <pkg>' : ''
      }. Full OS shell commands are available in Desktop (Electron).`
    );
  }

  private printHelp(): void {
    const lines = [
      'Workspace & Environment Commands (All Editions):',
      '  env                   List environments (DEV / SIT / UAT / PROD)',
      '  env use <name|none>   Switch active environment',
      '  vars                  List active capsule variables',
      '  set <key>=<value>     Add or update a capsule variable',
      '  ls | requests         List requests in active capsule',
      '  run <name|index>      Execute a request and show response preview',
      '  schedule <req> <sec>  Run a request automatically every <sec> seconds',
      '  schedule list|stop    List or stop recurring scheduled runs',
      '  clear                 Clear terminal screen'
    ];
    if (APP_EDITION.isProOrHigher) {
      lines.push(
        '',
        'Sandbox Package Commands (Professional & Enterprise):',
        '  npm install <pkg>     Install npm package (e.g. crypto-js, lodash, dayjs) for script import',
        '  npm list              Show installed sandbox packages',
        '  npm uninstall <pkg>   Remove a sandbox package'
      );
    }
    if (isElectronApp()) {
      lines.push('', 'Desktop Shell: Any other command runs natively via the Electron OS shell.');
    }
    this.appendLine('code', lines.join('\n'));
  }
}
