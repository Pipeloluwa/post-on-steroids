import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { EnvironmentService, ApiEnvironment, EnvironmentVariableItem } from '../services/environment.service';
import { NotificationService } from '../services/notification.service';
import { generateUUID } from '../utils/uuid.util';

@Component({
  selector: 'app-environment-manager-modal',
  imports: [FormsModule, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)'
  },
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 z-110 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4" (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="env-mgr-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[min(86dvh,calc(100dvh-28px))]"
             (click)="$event.stopPropagation()">

          <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50">
            <div class="flex items-center gap-2.5">
              <div class="size-7 rounded-lg bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                <mat-icon class="text-[17px]! size-[17px]!">layers</mat-icon>
              </div>
              <div>
                <h3 id="env-mgr-title" class="text-sm font-bold text-(--postonsteroids-text-primary)">Environments &amp; Variables Manager</h3>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">Switch DEV / SIT / UAT / PROD presets in one click across all editions. Active environment variables override Capsule globals.</p>
              </div>
            </div>
            <button type="button" (click)="close()" class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
              <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
            </button>
          </div>

          <div class="flex flex-1 min-h-0 overflow-hidden">
            <!-- Left Sidebar: Environments List -->
            <div class="w-60 border-r border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary)/30 flex flex-col p-3 gap-2 shrink-0">
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-bold uppercase tracking-wider text-(--postonsteroids-text-muted)">Environments</span>
                <div class="flex items-center gap-1">
                  <input #envFileInput type="file" accept=".json" class="hidden" (change)="onImportPostmanEnv($event)" />
                  <button type="button" (click)="envFileInput.click()" title="Import Postman Environment JSON"
                          class="p-1 rounded hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-accent) cursor-pointer">
                    <mat-icon class="text-[15px]! size-[15px]!">file_upload</mat-icon>
                  </button>
                  <button type="button" (click)="addNewEnv()" title="Create New Environment"
                          class="p-1 rounded bg-(--postonsteroids-accent)/15 text-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent)/25 cursor-pointer">
                    <mat-icon class="text-[15px]! size-[15px]!">add</mat-icon>
                  </button>
                </div>
              </div>

              <button type="button" (click)="envService.setActiveEnvironment(null)"
                      class="w-full text-left px-2.5 py-2 rounded-lg text-xs border transition-colors cursor-pointer flex items-center justify-between"
                      [class.border-(--postonsteroids-accent)]="!envService.activeEnvironmentId()"
                      [class.bg-(--postonsteroids-accent)/10]="!envService.activeEnvironmentId()"
                      [class.border-transparent]="!!envService.activeEnvironmentId()">
                <span class="text-(--postonsteroids-text-secondary)">No Active Environment</span>
                @if (!envService.activeEnvironmentId()) {
                  <mat-icon class="text-[14px]! size-[14px]! text-(--postonsteroids-accent)">check_circle</mat-icon>
                }
              </button>

              <div class="flex-1 overflow-y-auto space-y-1">
                @for (env of envService.environments(); track env.id) {
                  <div (click)="selectedEnvId.set(env.id)"
                       class="px-2.5 py-2 rounded-lg text-xs cursor-pointer border transition-colors flex items-center justify-between group"
                       [class.bg-(--postonsteroids-bg-tertiary)]="activeSelectedEnvId() === env.id"
                       [class.border-(--postonsteroids-accent)/50]="activeSelectedEnvId() === env.id"
                       [class.border-transparent]="activeSelectedEnvId() !== env.id">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="size-2.5 rounded-full shrink-0" [style.background-color]="env.color"></span>
                      <span class="font-semibold text-(--postonsteroids-text-primary) truncate">{{ env.name }}</span>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                      @if (envService.activeEnvironmentId() === env.id) {
                        <span class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500">Active</span>
                      } @else {
                        <button type="button" (click)="$event.stopPropagation(); envService.setActiveEnvironment(env.id)"
                                class="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 rounded bg-(--postonsteroids-accent) text-white cursor-pointer">
                          Use
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Right Panel: Environment Editor -->
            @if (selectedEnv(); as current) {
              <div class="flex-1 flex flex-col min-w-0 p-4 gap-3 overflow-y-auto">
                <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-(--postonsteroids-border)/50">
                  <div class="flex items-center gap-2 flex-1 min-w-[200px]">
                    <input type="color" [ngModel]="current.color" (ngModelChange)="updateEnvMeta(current, current.name, $event)"
                           class="size-7 rounded cursor-pointer border-0 bg-transparent" title="Environment badge color" />
                    <input type="text" [ngModel]="current.name" (ngModelChange)="updateEnvMeta(current, $event, current.color)"
                           class="px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-sm font-bold text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent)" />
                  </div>
                  <div class="flex items-center gap-2">
                    @if (envService.activeEnvironmentId() !== current.id) {
                      <button type="button" (click)="envService.setActiveEnvironment(current.id)"
                              class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer">
                        Set Active
                      </button>
                    }
                    <button type="button" (click)="exportPostmanEnv(current)" title="Export Postman Environment JSON"
                            class="px-2.5 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-xs font-medium text-(--postonsteroids-text-primary) cursor-pointer">
                      Export
                    </button>
                    <button type="button" (click)="duplicateEnv(current.id)" title="Duplicate Environment"
                            class="px-2.5 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-xs font-medium text-(--postonsteroids-text-primary) cursor-pointer">
                      Duplicate
                    </button>
                    <button type="button" (click)="deleteEnv(current.id)" title="Delete Environment"
                            class="px-2.5 py-1.5 rounded-lg border border-status-danger/30 bg-status-danger/10 text-status-danger hover:bg-status-danger/20 text-xs font-medium cursor-pointer">
                      Delete
                    </button>
                  </div>
                </div>

                <table class="w-full text-xs border-collapse">
                  <thead>
                    <tr class="text-(--postonsteroids-text-muted) border-b border-(--postonsteroids-border)/50">
                      <th class="w-8 py-1.5 text-center">On</th>
                      <th class="w-1/3 py-1.5 px-2 text-left">Variable</th>
                      <th class="py-1.5 px-2 text-left">Value</th>
                      <th class="w-24 py-1.5 px-2 text-left">Type</th>
                      <th class="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (v of current.variables; track v.id) {
                      <tr class="border-b border-(--postonsteroids-border)/25 hover:bg-(--postonsteroids-bg-hover)/25">
                        <td class="py-1.5 text-center">
                          <input type="checkbox" [checked]="v.enabled" (change)="updateVar(current, v.id, { enabled: $any($event.target).checked })"
                                 class="accent-(--postonsteroids-accent) cursor-pointer" />
                        </td>
                        <td class="py-1.5 px-2">
                          <input type="text" [ngModel]="v.key" (ngModelChange)="updateVar(current, v.id, { key: $event })"
                                 placeholder="variableName"
                                 class="w-full bg-transparent outline-none font-mono text-(--postonsteroids-text-primary)" />
                        </td>
                        <td class="py-1.5 px-2">
                          <input [type]="v.type === 'secret' ? 'password' : 'text'" [ngModel]="v.value" (ngModelChange)="updateVar(current, v.id, { value: $event })"
                                 placeholder="Value"
                                 class="w-full bg-transparent outline-none font-mono text-(--postonsteroids-text-primary)" />
                        </td>
                        <td class="py-1.5 px-2">
                          <select [ngModel]="v.type" (ngModelChange)="updateVar(current, v.id, { type: $event })"
                                  class="bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded px-1.5 py-0.5 text-[11px] outline-none">
                            <option value="default">Default</option>
                            <option value="secret">Secret</option>
                          </select>
                        </td>
                        <td class="py-1.5 text-center">
                          <button type="button" (click)="removeVar(current, v.id)" class="text-(--postonsteroids-text-muted) hover:text-status-danger cursor-pointer">
                            <mat-icon class="text-[15px]! size-[15px]!">close</mat-icon>
                          </button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>

                <button type="button" (click)="addVar(current)"
                        class="w-fit flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold text-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent)/10 cursor-pointer">
                  <mat-icon class="text-[15px]! size-[15px]!">add</mat-icon>
                  <span>Add Variable</span>
                </button>
              </div>
            } @else {
              <div class="flex-1 flex items-center justify-center text-xs text-(--postonsteroids-text-muted)">
                Select or create an environment on the left to manage its variables.
              </div>
            }
          </div>
        </div>
      </div>
    }
  `
})
export class EnvironmentManagerModalComponent {
  envService = inject(EnvironmentService);
  private notification = inject(NotificationService);

  isOpen = input<boolean>(false);
  closed = output<void>();

  selectedEnvId = signal<string | null>(null);

  selectedEnv = computed<ApiEnvironment | null>(() => {
    const envs = this.envService.environments();
    const sel = this.selectedEnvId() || this.envService.activeEnvironmentId();
    return envs.find(e => e.id === sel) || envs[0] || null;
  });

  activeSelectedEnvId = computed(() => this.selectedEnv()?.id ?? null);

  onEscape(event: Event): void {
    if (!this.isOpen()) return;
    event.preventDefault();
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  addNewEnv(): void {
    const created = this.envService.createEnvironment('Custom Env');
    this.selectedEnvId.set(created.id);
  }

  duplicateEnv(id: string): void {
    const copy = this.envService.duplicateEnvironment(id);
    if (copy) this.selectedEnvId.set(copy.id);
  }

  deleteEnv(id: string): void {
    this.envService.deleteEnvironment(id);
    this.selectedEnvId.set(this.envService.environments()[0]?.id || null);
  }

  updateEnvMeta(env: ApiEnvironment, name: string, color: string): void {
    this.envService.updateEnvironment({ ...env, name, color });
  }

  addVar(env: ApiEnvironment): void {
    this.envService.updateEnvironment({
      ...env,
      variables: [...env.variables, { id: generateUUID(), key: '', value: '', type: 'default', enabled: true }]
    });
  }

  updateVar(env: ApiEnvironment, varId: string, patch: Partial<EnvironmentVariableItem>): void {
    this.envService.updateEnvironment({
      ...env,
      variables: env.variables.map(v => (v.id === varId ? { ...v, ...patch } : v))
    });
  }

  removeVar(env: ApiEnvironment, varId: string): void {
    this.envService.updateEnvironment({
      ...env,
      variables: env.variables.filter(v => v.id !== varId)
    });
  }

  exportPostmanEnv(env: ApiEnvironment): void {
    const payload = this.envService.exportPostmanEnvironment(env.id);
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${env.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.postman_environment.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.notification.notify(`Exported "${env.name}" as Postman Environment.`, 'success');
  }

  onImportPostmanEnv(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = this.envService.importPostmanEnvironment(String(reader.result || ''));
        this.selectedEnvId.set(imported.id);
        this.notification.notify(`Imported environment "${imported.name}" (${imported.variables.length} variables).`, 'success');
      } catch {
        this.notification.notify('Invalid Postman Environment JSON file.', 'error');
      }
      inputEl.value = '';
    };
    reader.readAsText(file);
  }
}
