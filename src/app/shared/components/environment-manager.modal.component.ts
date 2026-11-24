import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { EnvironmentService, ApiEnvironment, EnvironmentVariableItem } from '../services/environment.service';
import { VariableService } from '../services/variable.service';
import { NotificationService } from '../services/notification.service';
import { DialogService } from '../services/dialog.service';
import { BodyPortalDirective } from '../directives/body-portal.directive';
import { generateUUID } from '../utils/uuid.util';

@Component({
  selector: 'app-environment-manager-modal',
  imports: [FormsModule, MatIcon, BodyPortalDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)'
  },
  template: `
    @if (isOpen()) {
      <div appBodyPortal class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4" (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="env-mgr-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[min(86dvh,calc(100dvh-28px))]"
             (click)="stopDialogClick($event)">

          <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50">
            <div class="flex items-center gap-2.5">
              <div class="size-7 rounded-lg bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                <mat-icon class="text-[17px]! size-[17px]!">layers</mat-icon>
              </div>
              <div>
                <h3 id="env-mgr-title" class="text-sm font-bold text-(--postonsteroids-text-primary)">Environments &amp; Variables Manager</h3>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">Variable keys sync across environments; edit contextual values per environment or copy selected values across DEV / SIT / UAT / PROD.</p>
              </div>
            </div>
            <button type="button" (click)="close()" class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
              <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
            </button>
          </div>

          @if (!envService.isEnvironmentFeatureEnabled()) {
            <div class="p-8 flex flex-col items-center justify-center text-center gap-3">
              <div class="size-12 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
                <mat-icon class="text-[26px]! size-[26px]!">lock</mat-icon>
              </div>
              <h4 class="text-sm font-bold text-(--postonsteroids-text-primary)">Environments Require Pro or Enterprise</h4>
              <p class="text-xs text-(--postonsteroids-text-muted) max-w-md">
                Multi-environment presets (DEV, SIT, UAT, PROD), contextual variable overrides, and cross-environment variable copying are exclusive to Pro and Enterprise plans.
              </p>
              <button type="button" (click)="close()" class="px-4 py-1.5 rounded-lg bg-(--postonsteroids-accent) text-white text-xs font-semibold cursor-pointer">
                Close
              </button>
            </div>
          } @else {
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
                  <div (click)="selectEnv(env.id)"
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

                <!-- Batch Selection Toolbar -->
                @if (selectedVars().length > 0) {
                  <div class="px-3 py-2 rounded-lg bg-(--postonsteroids-accent)/10 border border-(--postonsteroids-accent)/30 flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2 text-xs font-semibold text-(--postonsteroids-text-primary)">
                      <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-accent)">check_box</mat-icon>
                      <span>{{ selectedVars().length }} selected</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <div class="relative">
                        <button type="button" (click)="toggleBatchCopyMenu($event)"
                                class="px-2.5 py-1 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) hover:border-(--postonsteroids-accent) text-xs font-semibold text-(--postonsteroids-text-primary) flex items-center gap-1 cursor-pointer">
                          <mat-icon class="text-[14px]! size-[14px]! text-(--postonsteroids-accent)">content_copy</mat-icon>
                          <span>Copy Selected to Env</span>
                          <mat-icon class="text-[14px]! size-[14px]!">arrow_drop_down</mat-icon>
                        </button>
                        @if (showBatchCopyMenu()) {
                          <div (click)="$event.stopPropagation()"
                               class="absolute right-0 top-full mt-1 w-48 bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-lg shadow-xl py-1 z-50 text-xs">
                            @for (env of envService.environments(); track env.id) {
                              <button type="button" (click)="copySelectedVarsToEnv(current, env.id)"
                                      class="w-full text-left px-3 py-1.5 hover:bg-(--postonsteroids-bg-hover) flex items-center gap-2 text-(--postonsteroids-text-primary) cursor-pointer">
                                <span class="size-2 rounded-full shrink-0" [style.background-color]="env.color"></span>
                                <span class="truncate">{{ env.name }}</span>
                              </button>
                            }
                            <div class="my-1 border-t border-(--postonsteroids-border)/50"></div>
                            <button type="button" (click)="copySelectedVarsToEnv(current, '__all__')"
                                    class="w-full text-left px-3 py-1.5 hover:bg-(--postonsteroids-bg-hover) font-semibold text-(--postonsteroids-accent) cursor-pointer">
                              All Environments
                            </button>
                          </div>
                        }
                      </div>
                      <button type="button" (click)="deleteSelectedVars(current)"
                              class="px-2.5 py-1 rounded-lg bg-status-danger/15 border border-status-danger/35 text-status-danger hover:bg-status-danger/25 text-xs font-semibold flex items-center gap-1 cursor-pointer">
                        <mat-icon class="text-[14px]! size-[14px]!">delete</mat-icon>
                        <span>Delete Selected</span>
                      </button>
                    </div>
                  </div>
                }

                <table class="w-full text-xs border-collapse">
                  <thead>
                    <tr class="text-(--postonsteroids-text-muted) border-b border-(--postonsteroids-border)/50">
                      <th class="w-7 py-1.5 text-center">
                        <input type="checkbox" [checked]="allVarsSelected()" (change)="toggleSelectAllVars(current)"
                               title="Select all environment variables"
                               class="accent-(--postonsteroids-accent) cursor-pointer" />
                      </th>
                      <th class="w-8 py-1.5 text-center">On</th>
                      <th class="w-1/3 py-1.5 px-2 text-left">Variable</th>
                      <th class="py-1.5 px-2 text-left">Value</th>
                      <th class="w-24 py-1.5 px-2 text-left">Type</th>
                      <th class="w-16 text-right px-1">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (v of current.variables; track v.id) {
                      <tr class="border-b border-(--postonsteroids-border)/25 hover:bg-(--postonsteroids-bg-hover)/25">
                        <td class="py-1.5 text-center">
                          <input type="checkbox" [checked]="isVarSelected(v.id)" (change)="toggleVarSelection(v.id)"
                                 title="Select row for batch actions"
                                 class="accent-(--postonsteroids-accent) cursor-pointer" />
                        </td>
                        <td class="py-1.5 text-center">
                          <input type="checkbox" [checked]="v.enabled" (change)="updateVar(current, v.id, { enabled: $any($event.target).checked })"
                                 class="accent-emerald-500 cursor-pointer" />
                        </td>
                        <td class="py-1.5 px-2">
                          <input type="text" [ngModel]="v.key"
                                 (blur)="renameOrSyncKey(current, v, $any($event.target).value)"
                                 (keydown.enter)="renameOrSyncKey(current, v, $any($event.target).value)"
                                 placeholder="variableName"
                                 class="w-full bg-transparent outline-none font-mono text-(--postonsteroids-text-primary)" />
                        </td>
                        <td class="py-1.5 px-2">
                          <input [type]="v.type === 'secret' ? 'password' : 'text'" [ngModel]="v.value"
                                 (ngModelChange)="updateVar(current, v.id, { value: $event, enabled: $event !== '' ? true : v.enabled })"
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
                        <td class="py-1.5 px-1 text-right">
                          <div class="flex items-center justify-end gap-0.5 relative">
                            <button type="button" (click)="toggleRowCopyMenu($event, v.id)" title="Copy variable to another environment"
                                    class="p-1 rounded hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-accent) cursor-pointer">
                              <mat-icon class="text-[14px]! size-[14px]!">content_copy</mat-icon>
                            </button>
                            @if (rowCopyMenuId() === v.id) {
                              <div (click)="$event.stopPropagation()"
                                   class="absolute right-0 top-full mt-1 w-44 bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-lg shadow-xl py-1 z-50 text-xs text-left">
                                <div class="px-2.5 py-1 text-[10px] font-bold uppercase text-(--postonsteroids-text-muted)">Copy to Env</div>
                                @for (env of envService.environments(); track env.id) {
                                  <button type="button" (click)="copySingleVarToEnv(current, v, env.id)"
                                          class="w-full text-left px-2.5 py-1.5 hover:bg-(--postonsteroids-bg-hover) flex items-center gap-2 text-(--postonsteroids-text-primary) cursor-pointer">
                                    <span class="size-2 rounded-full shrink-0" [style.background-color]="env.color"></span>
                                    <span class="truncate">{{ env.name }}</span>
                                  </button>
                                }
                                <div class="my-1 border-t border-(--postonsteroids-border)/50"></div>
                                <button type="button" (click)="copySingleVarToEnv(current, v, '__all__')"
                                        class="w-full text-left px-2.5 py-1.5 hover:bg-(--postonsteroids-bg-hover) font-semibold text-(--postonsteroids-accent) cursor-pointer">
                                  All Environments
                                </button>
                              </div>
                            }
                            <button type="button" (click)="removeVar(current, v.id)" title="Delete variable"
                                    class="p-1 text-(--postonsteroids-text-muted) hover:text-status-danger cursor-pointer">
                              <mat-icon class="text-[15px]! size-[15px]!">close</mat-icon>
                            </button>
                          </div>
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
          }
        </div>
      </div>
    }
  `
})
export class EnvironmentManagerModalComponent {
  envService = inject(EnvironmentService);
  private variableService = inject(VariableService);
  private notification = inject(NotificationService);
  private dialog = inject(DialogService);

  isOpen = input<boolean>(false);
  closed = output<void>();

  selectedEnvId = signal<string | null>(null);
  selectedVarIds = signal<Set<string>>(new Set());
  showBatchCopyMenu = signal(false);
  rowCopyMenuId = signal<string | null>(null);

  selectedEnv = computed<ApiEnvironment | null>(() => {
    const envs = this.envService.environments();
    const sel = this.selectedEnvId() || this.envService.activeEnvironmentId();
    return envs.find(e => e.id === sel) || envs[0] || null;
  });

  activeSelectedEnvId = computed(() => this.selectedEnv()?.id ?? null);

  selectedVars = computed<EnvironmentVariableItem[]>(() => {
    const env = this.selectedEnv();
    if (!env) return [];
    const sel = this.selectedVarIds();
    return env.variables.filter(v => sel.has(v.id));
  });

  allVarsSelected = computed<boolean>(() => {
    const env = this.selectedEnv();
    if (!env || env.variables.length === 0) return false;
    const sel = this.selectedVarIds();
    return env.variables.every(v => sel.has(v.id));
  });

  onEscape(event: Event): void {
    if (!this.isOpen()) return;
    event.preventDefault();
    this.close();
  }

  close(): void {
    this.selectedVarIds.set(new Set());
    this.showBatchCopyMenu.set(false);
    this.rowCopyMenuId.set(null);
    this.closed.emit();
  }

  stopDialogClick(event: Event): void {
    event.stopPropagation();
    this.showBatchCopyMenu.set(false);
    this.rowCopyMenuId.set(null);
  }

  selectEnv(envId: string): void {
    this.selectedEnvId.set(envId);
    this.selectedVarIds.set(new Set());
    this.showBatchCopyMenu.set(false);
    this.rowCopyMenuId.set(null);
  }

  isVarSelected(varId: string): boolean {
    return this.selectedVarIds().has(varId);
  }

  toggleVarSelection(varId: string): void {
    this.selectedVarIds.update(prev => {
      const next = new Set(prev);
      if (next.has(varId)) next.delete(varId);
      else next.add(varId);
      return next;
    });
  }

  toggleSelectAllVars(env: ApiEnvironment): void {
    if (this.allVarsSelected()) {
      this.selectedVarIds.set(new Set());
    } else {
      this.selectedVarIds.set(new Set(env.variables.map(v => v.id)));
    }
  }

  toggleBatchCopyMenu(event: Event): void {
    event.stopPropagation();
    this.rowCopyMenuId.set(null);
    this.showBatchCopyMenu.update(v => !v);
  }

  toggleRowCopyMenu(event: Event, varId: string): void {
    event.stopPropagation();
    this.showBatchCopyMenu.set(false);
    this.rowCopyMenuId.update(curr => curr === varId ? null : varId);
  }

  addNewEnv(): void {
    const created = this.envService.createEnvironment('Custom Env');
    if (created) {
      this.selectEnv(created.id);
    }
  }

  duplicateEnv(id: string): void {
    const copy = this.envService.duplicateEnvironment(id);
    if (copy) this.selectEnv(copy.id);
  }

  deleteEnv(id: string): void {
    this.envService.deleteEnvironment(id);
    this.selectEnv(this.envService.environments()[0]?.id || '');
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

  renameOrSyncKey(env: ApiEnvironment, item: EnvironmentVariableItem, rawNewKey: string): void {
    const newKey = rawNewKey.trim();
    const oldKey = (item.key || '').trim();
    if (newKey === oldKey) return;

    this.updateVar(env, item.id, { key: newKey });
    if (oldKey && newKey) {
      this.envService.renameVariableKeyAcrossEnvironments(oldKey, newKey);
    } else if (newKey) {
      this.envService.ensureKeyAcrossEnvironments(newKey);
    }
    if (newKey) {
      const existsInCap = this.variableService.variables().some(
        v => (v.key || '').trim().toLowerCase() === newKey.toLowerCase()
      );
      if (!existsInCap) {
        this.variableService.addVariable(newKey, '', item.source, 'global');
      }
    }
  }

  updateVar(env: ApiEnvironment, varId: string, patch: Partial<EnvironmentVariableItem>): void {
    this.envService.updateEnvironment({
      ...env,
      variables: env.variables.map(v => (v.id === varId ? { ...v, ...patch } : v))
    });
  }

  copySingleVarToEnv(sourceEnv: ApiEnvironment, item: EnvironmentVariableItem, targetEnvId: string | '__all__'): void {
    this.rowCopyMenuId.set(null);
    if (!item.key.trim()) {
      this.notification.notify('Enter a variable key before copying to another environment.', 'warning');
      return;
    }
    const count = this.envService.copyVariablesToEnvironment(
      [{ key: item.key.trim(), value: item.value, type: item.type, source: item.source }],
      targetEnvId
    );
    if (count > 0) {
      const targetName = targetEnvId === '__all__'
        ? 'All Environments'
        : (this.envService.environments().find(e => e.id === targetEnvId)?.name || 'Environment');
      this.notification.notify(`Copied "${item.key.trim()}" from ${sourceEnv.name} to ${targetName}.`, 'success');
    }
  }

  copySelectedVarsToEnv(sourceEnv: ApiEnvironment, targetEnvId: string | '__all__'): void {
    this.showBatchCopyMenu.set(false);
    const items = this.selectedVars().filter(v => v.key.trim() !== '');
    if (items.length === 0) {
      this.notification.notify('Select at least one named variable to copy.', 'warning');
      return;
    }
    const count = this.envService.copyVariablesToEnvironment(
      items.map(v => ({ key: v.key.trim(), value: v.value, type: v.type, source: v.source })),
      targetEnvId
    );
    if (count > 0) {
      const targetName = targetEnvId === '__all__'
        ? 'All Environments'
        : (this.envService.environments().find(e => e.id === targetEnvId)?.name || 'Environment');
      this.notification.notify(`Copied ${items.length} variable${items.length === 1 ? '' : 's'} from ${sourceEnv.name} to ${targetName}.`, 'success');
    }
  }

  removeVar(env: ApiEnvironment, varId: string): void {
    const target = env.variables.find(v => v.id === varId);
    this.envService.updateEnvironment({
      ...env,
      variables: env.variables.filter(v => v.id !== varId)
    });
    if (target?.key?.trim()) {
      this.envService.removeKeyAcrossEnvironments(target.key.trim());
    }
    this.selectedVarIds.update(prev => {
      const next = new Set(prev);
      next.delete(varId);
      return next;
    });
  }

  async deleteSelectedVars(env: ApiEnvironment): Promise<void> {
    const items = this.selectedVars();
    if (items.length === 0) return;

    const confirmed = await this.dialog.confirm(
      `Delete ${items.length} selected variable${items.length === 1 ? '' : 's'} across environments?`,
      'Delete Environment Variables'
    );
    if (!confirmed) return;

    const idSet = new Set(items.map(v => v.id));
    this.envService.updateEnvironment({
      ...env,
      variables: env.variables.filter(v => !idSet.has(v.id))
    });
    for (const item of items) {
      if (item.key.trim()) {
        this.envService.removeKeyAcrossEnvironments(item.key.trim());
      }
    }
    this.selectedVarIds.set(new Set());
    this.notification.notify(`Deleted ${items.length} environment variable${items.length === 1 ? '' : 's'}.`, 'info');
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
        if (imported) {
          this.selectEnv(imported.id);
          this.notification.notify(`Imported environment "${imported.name}" (${imported.variables.length} variables).`, 'success');
        }
      } catch {
        this.notification.notify('Invalid Postman Environment JSON file.', 'error');
      }
      inputEl.value = '';
    };
    reader.readAsText(file);
  }
}
