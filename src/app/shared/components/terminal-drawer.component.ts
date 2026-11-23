import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TerminalService } from '../services/terminal.service';
import { APP_EDITION } from '../../../environments/edition';

@Component({
  selector: 'app-terminal-drawer',
  imports: [FormsModule, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onGlobalKeydown($event)'
  },
  template: `
    @if (terminal.isOpen()) {
      <div class="border-t border-(--postonsteroids-border) bg-(--postonsteroids-bg-darker) text-(--postonsteroids-text-primary) flex flex-col shrink-0 shadow-2xl z-40"
           style="height: 260px;">
        <!-- Header Bar -->
        <div class="h-8 px-3 border-b border-(--postonsteroids-border)/70 bg-(--postonsteroids-bg-secondary) flex items-center justify-between gap-3 shrink-0 text-[11px]">
          <div class="flex items-center gap-2 min-w-0">
            <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-accent)">terminal</mat-icon>
            <span class="font-bold">OnSteroid Terminal</span>
            <span class="px-1.5 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) text-[9.5px] font-semibold text-(--postonsteroids-text-muted)">
              {{ appEdition.label }}
            </span>
            @if (appEdition.isProOrHigher && terminal.packagesService.packages().length > 0) {
              <div class="hidden md:flex items-center gap-1 overflow-x-auto max-w-md">
                <span class="text-[10px] text-(--postonsteroids-text-muted)">Sandbox packages:</span>
                @for (pkg of terminal.packagesService.packages(); track pkg.name) {
                  <span class="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-mono text-[10px] border border-emerald-500/25">
                    {{ pkg.name }}@{{ pkg.version }}
                  </span>
                }
              </div>
            }
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <button type="button" (click)="runQuick('help')"
                    class="px-2 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[10px] font-mono cursor-pointer">
              help
            </button>
            <button type="button" (click)="runQuick('env')"
                    class="px-2 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[10px] font-mono cursor-pointer">
              env
            </button>
            @if (appEdition.isProOrHigher) {
              <button type="button" (click)="prefill('npm install crypto-js')"
                      class="px-2 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[10px] font-mono text-emerald-400 cursor-pointer">
                + crypto-js
              </button>
            }
            <button type="button" (click)="terminal.clear()" title="Clear Terminal"
                    class="p-1 rounded hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer flex items-center">
              <mat-icon class="text-[14px]! size-[14px]!">delete_sweep</mat-icon>
            </button>
            <button type="button" (click)="terminal.close()" title="Close Terminal (Ctrl+\`)"
                    class="p-1 rounded hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer flex items-center">
              <mat-icon class="text-[15px]! size-[15px]!">close</mat-icon>
            </button>
          </div>
        </div>

        <!-- Scrollable Output -->
        <div #outputPane class="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed space-y-1 select-text">
          @for (line of terminal.lines(); track line.id) {
            <div class="whitespace-pre-wrap break-words"
                 [class.text-(--postonsteroids-accent)]="line.kind === 'input'"
                 [class.font-semibold]="line.kind === 'input'"
                 [class.text-emerald-400]="line.kind === 'success'"
                 [class.text-red-400]="line.kind === 'error'"
                 [class.text-amber-400]="line.kind === 'warn'"
                 [class.text-(--postonsteroids-text-muted)]="line.kind === 'info'"
                 [class.text-(--postonsteroids-text-primary)]="line.kind === 'code'">{{ line.text }}</div>
          }
        </div>

        <!-- Prompt Input -->
        <form (submit)="submit($event)" class="h-8 px-3 border-t border-(--postonsteroids-border)/60 bg-(--postonsteroids-bg-secondary)/60 flex items-center gap-2 shrink-0">
          <span class="font-mono text-xs font-bold text-(--postonsteroids-accent)">$</span>
          <input #cmdInput type="text"
                 [ngModel]="inputCmd()"
                 (ngModelChange)="inputCmd.set($event)"
                 (keydown)="onInputKeydown($event)"
                 name="terminalCmd"
                 autocomplete="off"
                 spellcheck="false"
                 [placeholder]="appEdition.isProOrHigher ? 'Type command (help, env use PROD, ls, run 1, npm install crypto-js)...' : 'Type command (help, env use PROD, vars, set k=v, ls, run 1)...'"
                 class="flex-1 bg-transparent outline-none font-mono text-xs text-(--postonsteroids-text-primary) placeholder:text-(--postonsteroids-text-muted)" />
          @if (terminal.isBusy()) {
            <mat-icon class="text-[14px]! size-[14px]! animate-spin text-(--postonsteroids-accent)">sync</mat-icon>
          }
        </form>
      </div>
    }
  `
})
export class TerminalDrawerComponent {
  terminal = inject(TerminalService);
  readonly appEdition = APP_EDITION;

  @ViewChild('outputPane') outputPane?: ElementRef<HTMLDivElement>;
  @ViewChild('cmdInput') cmdInput?: ElementRef<HTMLInputElement>;

  inputCmd = signal('');
  private historyIdx = -1;

  constructor() {
    effect(() => {
      const _lines = this.terminal.lines();
      const open = this.terminal.isOpen();
      if (open) {
        setTimeout(() => {
          const el = this.outputPane?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        }, 0);
      }
    });
  }

  onGlobalKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === '`') {
      event.preventDefault();
      this.terminal.toggle();
      if (this.terminal.isOpen()) {
        setTimeout(() => this.cmdInput?.nativeElement?.focus(), 20);
      }
    }
  }

  onInputKeydown(event: KeyboardEvent): void {
    const hist = this.terminal.commandHistory();
    if (event.key === 'ArrowUp' && hist.length > 0) {
      event.preventDefault();
      this.historyIdx = Math.min(hist.length - 1, this.historyIdx + 1);
      this.inputCmd.set(hist[this.historyIdx]);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.historyIdx <= 0) {
        this.historyIdx = -1;
        this.inputCmd.set('');
      } else {
        this.historyIdx--;
        this.inputCmd.set(hist[this.historyIdx]);
      }
    }
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    const cmd = this.inputCmd();
    if (!cmd.trim()) return;
    this.inputCmd.set('');
    this.historyIdx = -1;
    await this.terminal.executeCommand(cmd);
  }

  runQuick(cmd: string): void {
    void this.terminal.executeCommand(cmd);
  }

  prefill(cmd: string): void {
    this.inputCmd.set(cmd);
    this.cmdInput?.nativeElement?.focus();
  }
}
