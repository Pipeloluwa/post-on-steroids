import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { VariableService } from '../../services/variable.service';
import { EnvironmentService, EnvironmentVariableItem } from '../../services/environment.service';
import { TabStateService } from '../../services/tab.state.service';
import { NotificationService } from '../../services/notification.service';
import { DialogService } from '../../services/dialog.service';
import { BodyPortalDirective } from '../../directives/body-portal.directive';
import { IGlobalVariable, VariableSource } from '../../../interfaces/services/IVariableService';

export interface UnifiedVariableRow {
    rowId: string;
    key: string;
    type: 'global' | 'path';
    enabled: boolean;
    contextualValue: string;
    capsuleValue: string;
    envType: 'default' | 'secret';
    capVar: IGlobalVariable | null;
    envVar: EnvironmentVariableItem | null;
    source?: VariableSource;
    liveDynamicValue?: string;
}

@Component({
    selector: 'app-variable-modal',
    imports: [CommonModule, FormsModule, MatIcon, BodyPortalDirective],
    templateUrl: './variable.modal.component.html',
    styleUrl: './variable.modal.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:keydown.escape)': 'onEscape($event)'
    }
})
export class VariableModalComponent {
    variableService = inject(VariableService);
    envService = inject(EnvironmentService);
    tabStateService = inject(TabStateService);
    private notification = inject(NotificationService);
    private dialog = inject(DialogService);

    isOpen = signal(false);
    selectedRowIds = signal<Set<string>>(new Set());
    batchCopyTargetEnvId = signal<string>('');
    showBatchCopyMenu = signal(false);
    rowCopyMenuId = signal<string | null>(null);

    readonly unifiedRows = computed<UnifiedVariableRow[]>(() => {
        const capVars = this.variableService.variables().filter(v => !(v.key || '').startsWith('__'));
        const isEnvEnabled = this.envService.isEnvironmentFeatureEnabled();
        const activeEnv = isEnvEnabled ? this.envService.activeEnvironment() : null;
        const rows: UnifiedVariableRow[] = [];
        const seenKeys = new Map<string, number>();

        for (const cv of capVars) {
            const cleanKey = (cv.key || '').trim();
            const lower = cleanKey.toLowerCase();
            const envMatch = activeEnv && cleanKey
                ? activeEnv.variables.find(ev => (ev.key || '').trim().toLowerCase() === lower) || null
                : null;
            const row: UnifiedVariableRow = {
                rowId: cv.id,
                key: cv.key,
                type: cv.type || 'global',
                enabled: activeEnv ? (envMatch ? envMatch.enabled : false) : cv.enabled,
                contextualValue: activeEnv ? (envMatch ? envMatch.value : '') : (cv.source ? this.variableService.getVariableValue(cv) : cv.value),
                capsuleValue: cv.source ? this.variableService.getVariableValue(cv) : cv.value,
                envType: envMatch?.type || 'default',
                capVar: cv,
                envVar: envMatch,
                source: envMatch?.source ?? cv.source,
                liveDynamicValue: cv.source ? this.variableService.getVariableValue(cv) : undefined
            };
            if (lower) {
                seenKeys.set(lower, rows.length);
            }
            rows.push(row);
        }

        // Also surface keys defined in active environment (or other environments when Pro/Ent) that are not yet in capsule baseline
        if (isEnvEnabled) {
            const orderedEnvs = activeEnv
                ? [activeEnv, ...this.envService.environments().filter(e => e.id !== activeEnv.id)]
                : this.envService.environments();

            for (const env of orderedEnvs) {
                for (const ev of env.variables) {
                    const cleanKey = (ev.key || '').trim();
                    const lower = cleanKey.toLowerCase();
                    if (!cleanKey || seenKeys.has(lower)) continue;
                    const activeMatch = activeEnv
                        ? activeEnv.variables.find(x => (x.key || '').trim().toLowerCase() === lower) || null
                        : null;
                    seenKeys.set(lower, rows.length);
                    rows.push({
                        rowId: `envrow_${lower}`,
                        key: cleanKey,
                        type: 'global',
                        enabled: activeEnv ? (activeMatch ? activeMatch.enabled : false) : false,
                        contextualValue: activeEnv ? (activeMatch ? activeMatch.value : '') : '',
                        capsuleValue: '',
                        envType: activeMatch?.type || ev.type || 'default',
                        capVar: null,
                        envVar: activeMatch,
                        source: activeMatch?.source ?? ev.source
                    });
                }
            }
        }

        return rows;
    });

    readonly allSelected = computed(() => {
        const rows = this.unifiedRows();
        if (rows.length === 0) return false;
        const sel = this.selectedRowIds();
        return rows.every(r => sel.has(r.rowId));
    });

    readonly selectedRows = computed(() => {
        const sel = this.selectedRowIds();
        return this.unifiedRows().filter(r => sel.has(r.rowId));
    });

    onEscape(event: Event): void {
        if (!this.isOpen()) return;
        event.preventDefault();
        this.close();
    }

    private ensureEditable(): boolean {
        const reason = this.tabStateService.getEditBlockReason(this.tabStateService.activeCapsuleId(), 'edit');
        if (reason) {
            this.notification.notify(reason, 'warning');
            return false;
        }
        return true;
    }

    close() {
        this.variableService.saveVariables();
        this.selectedRowIds.set(new Set());
        this.showBatchCopyMenu.set(false);
        this.rowCopyMenuId.set(null);
        this.isOpen.set(false);
    }

    stopProp(event: Event) {
        event.stopPropagation();
        this.showBatchCopyMenu.set(false);
        this.rowCopyMenuId.set(null);
    }

    selectScopeEnv(envId: string | null): void {
        if (!this.envService.isEnvironmentFeatureEnabled()) return;
        this.envService.setActiveEnvironment(envId);
        this.rowCopyMenuId.set(null);
    }

    isRowSelected(rowId: string): boolean {
        return this.selectedRowIds().has(rowId);
    }

    toggleRowSelection(rowId: string): void {
        this.selectedRowIds.update(prev => {
            const next = new Set(prev);
            if (next.has(rowId)) next.delete(rowId);
            else next.add(rowId);
            return next;
        });
    }

    toggleSelectAll(): void {
        const rows = this.unifiedRows();
        if (this.allSelected()) {
            this.selectedRowIds.set(new Set());
        } else {
            this.selectedRowIds.set(new Set(rows.map(r => r.rowId)));
        }
    }

    addVar() {
        if (!this.ensureEditable()) return;
        this.variableService.addVariable('', '', undefined, 'global');
    }

    onTypeChange(row: UnifiedVariableRow, nextType: 'global' | 'path') {
        if (!this.ensureEditable()) return;
        if (row.capVar) {
            this.variableService.updateVariable({ ...row.capVar, type: nextType });
        } else if (row.key.trim()) {
            this.variableService.addVariable(row.key.trim(), '', row.source, nextType);
        }
    }

    onKeyChange(row: UnifiedVariableRow, rawNewKey: string) {
        if (!this.ensureEditable()) return;
        const newKey = rawNewKey.trim();
        const oldKey = (row.key || '').trim();
        if (newKey === oldKey) return;

        if (row.capVar) {
            this.variableService.updateVariable({ ...row.capVar, key: newKey });
        } else if (newKey) {
            this.variableService.addVariable(newKey, '', row.source, row.type);
        }

        if (this.envService.isEnvironmentFeatureEnabled()) {
            if (oldKey && newKey) {
                this.envService.renameVariableKeyAcrossEnvironments(oldKey, newKey);
            } else if (newKey) {
                this.envService.ensureKeyAcrossEnvironments(newKey, row.contextualValue, row.source);
            }
        }
    }

    onValueChange(row: UnifiedVariableRow, newValue: string) {
        if (!this.ensureEditable()) return;
        const cleanKey = (row.key || '').trim();
        const activeEnv = this.envService.isEnvironmentFeatureEnabled() ? this.envService.activeEnvironment() : null;

        if (activeEnv && row.type !== 'path') {
            if (!cleanKey) {
                this.notification.notify('Enter a variable key name first before setting an environment value.', 'warning');
                return;
            }
            this.envService.setActiveVariable(cleanKey, newValue, row.source);
            // Register shared key schema in Capsule without clobbering baseline value
            if (!row.capVar) {
                this.variableService.addVariable(cleanKey, '', row.source, 'global');
            }
            return;
        }

        if (row.capVar) {
            this.variableService.updateVariable({ ...row.capVar, value: newValue });
            if (cleanKey && this.envService.isEnvironmentFeatureEnabled() && row.type !== 'path') {
                this.envService.ensureKeyAcrossEnvironments(cleanKey);
            }
        } else if (cleanKey) {
            this.variableService.addVariable(cleanKey, newValue, row.source, row.type);
            if (this.envService.isEnvironmentFeatureEnabled() && row.type !== 'path') {
                this.envService.ensureKeyAcrossEnvironments(cleanKey);
            }
        }
    }

    onToggleEnabled(row: UnifiedVariableRow) {
        if (!this.ensureEditable()) return;
        const activeEnv = this.envService.isEnvironmentFeatureEnabled() ? this.envService.activeEnvironment() : null;
        if (activeEnv && row.key.trim() && row.type !== 'path') {
            const lower = row.key.trim().toLowerCase();
            const existingIdx = activeEnv.variables.findIndex(v => v.key.trim().toLowerCase() === lower);
            if (existingIdx !== -1) {
                this.envService.updateEnvironment({
                    ...activeEnv,
                    variables: activeEnv.variables.map((v, idx) => idx === existingIdx ? { ...v, enabled: !v.enabled } : v)
                });
            } else {
                this.envService.setActiveVariable(row.key.trim(), row.contextualValue || '', row.source);
            }
            return;
        }
        if (row.capVar) {
            this.variableService.updateVariable({ ...row.capVar, enabled: !row.capVar.enabled });
        }
    }

    toggleRowCopyMenu(event: Event, rowId: string): void {
        event.stopPropagation();
        this.showBatchCopyMenu.set(false);
        this.rowCopyMenuId.update(curr => curr === rowId ? null : rowId);
    }

    toggleBatchCopyMenu(event: Event): void {
        event.stopPropagation();
        this.rowCopyMenuId.set(null);
        this.showBatchCopyMenu.update(v => !v);
    }

    copySingleRowToEnv(row: UnifiedVariableRow, targetEnvId: string | '__all__'): void {
        this.rowCopyMenuId.set(null);
        if (!row.key.trim()) {
            this.notification.notify('Add a variable key before copying to another environment.', 'warning');
            return;
        }
        const val = row.contextualValue !== '' ? row.contextualValue : row.capsuleValue;
        const count = this.envService.copyVariablesToEnvironment(
            [{ key: row.key.trim(), value: val, type: row.envType, source: row.source }],
            targetEnvId
        );
        if (count > 0) {
            const targetName = targetEnvId === '__all__'
                ? 'All Environments'
                : (this.envService.environments().find(e => e.id === targetEnvId)?.name || 'Environment');
            this.notification.notify(`Copied "${row.key.trim()}" to ${targetName}.`, 'success');
        }
    }

    copySelectedToEnv(targetEnvId: string | '__all__'): void {
        this.showBatchCopyMenu.set(false);
        const rows = this.selectedRows().filter(r => r.key.trim() !== '');
        if (rows.length === 0) {
            this.notification.notify('Select at least one named variable to copy.', 'warning');
            return;
        }
        const payload = rows.map(r => ({
            key: r.key.trim(),
            value: r.contextualValue !== '' ? r.contextualValue : r.capsuleValue,
            type: r.envType,
            source: r.source
        }));
        const count = this.envService.copyVariablesToEnvironment(payload, targetEnvId);
        if (count > 0) {
            const targetName = targetEnvId === '__all__'
                ? 'All Environments'
                : (this.envService.environments().find(e => e.id === targetEnvId)?.name || 'Environment');
            this.notification.notify(`Copied ${rows.length} variable${rows.length === 1 ? '' : 's'} to ${targetName}.`, 'success');
        }
    }

    removeRow(row: UnifiedVariableRow) {
        if (!this.ensureEditable()) return;
        if (row.capVar) {
            this.variableService.removeVariable(row.capVar.id);
        }
        if (row.key.trim() && this.envService.isEnvironmentFeatureEnabled()) {
            this.envService.removeKeyAcrossEnvironments(row.key.trim());
        }
        this.selectedRowIds.update(prev => {
            const next = new Set(prev);
            next.delete(row.rowId);
            return next;
        });
    }

    async deleteSelected(): Promise<void> {
        if (!this.ensureEditable()) return;
        const rows = this.selectedRows();
        if (rows.length === 0) return;

        const confirmed = await this.dialog.confirm(
            `Delete ${rows.length} selected variable${rows.length === 1 ? '' : 's'} across Capsule and Environments? This action cannot be undone.`,
            'Delete Selected Variables'
        );
        if (!confirmed) return;

        for (const row of rows) {
            if (row.capVar) {
                this.variableService.removeVariable(row.capVar.id);
            }
            if (row.key.trim() && this.envService.isEnvironmentFeatureEnabled()) {
                this.envService.removeKeyAcrossEnvironments(row.key.trim());
            }
        }
        this.selectedRowIds.set(new Set());
        this.notification.notify(`Deleted ${rows.length} variable${rows.length === 1 ? '' : 's'}.`, 'info');
    }
}
