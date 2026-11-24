import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { VariableService } from '../../services/variable.service';
import { EnvironmentService } from '../../services/environment.service';
import { TabStateService } from '../../services/tab.state.service';
import { NotificationService } from '../../services/notification.service';
import { IGlobalVariable } from '../../../interfaces/services/IVariableService';

@Component({
    selector: 'app-variable-modal',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './variable.modal.component.html',
    styleUrl: './variable.modal.component.css',
})
export class VariableModalComponent {
    variableService = inject(VariableService);
    envService = inject(EnvironmentService);
    tabStateService = inject(TabStateService);
    private notification = inject(NotificationService);
    isOpen = signal(false);

    readonly activeEnvOverrideKeys = computed(() => {
        const env = this.envService.activeEnvironment();
        const set = new Set<string>();
        if (env?.variables) {
            for (const v of env.variables) {
                if (v.enabled && v.key && v.key.trim()) {
                    set.add(v.key.trim().toLowerCase());
                }
            }
        }
        return set;
    });

    hasEnvOverride(key: string): boolean {
        const clean = (key || '').trim().toLowerCase();
        return Boolean(clean && this.activeEnvOverrideKeys().has(clean));
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
        this.isOpen.set(false);
    }

    stopProp(event: Event) {
        event.stopPropagation();
    }

    addVar() {
        if (!this.ensureEditable()) return;
        this.variableService.addVariable();
    }

    updateVar(v: IGlobalVariable) {
        if (!this.ensureEditable()) return;
        this.variableService.updateVariable(v);
    }

    removeVar(id: string) {
        if (!this.ensureEditable()) return;
        this.variableService.removeVariable(id);
    }

    toggleEnabled(v: IGlobalVariable) {
        if (!this.ensureEditable()) return;
        this.variableService.updateVariable({ ...v, enabled: !v.enabled });
    }
}
