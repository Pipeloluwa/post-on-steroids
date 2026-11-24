import { Component, ChangeDetectionStrategy, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { VariableService } from '../../services/variable.service';
import { EnvironmentService } from '../../services/environment.service';
import { TabStateService } from '../../services/tab.state.service';
import { NotificationService } from '../../services/notification.service';
import { BodyPortalDirective } from '../../directives/body-portal.directive';

@Component({
    selector: 'app-add-variable-modal-component',
    imports: [CommonModule, FormsModule, MatIcon, BodyPortalDirective],
    templateUrl: './add-variable.modal.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddVariableModalComponent {
    variableService = inject(VariableService);
    envService = inject(EnvironmentService);
    tabStateService = inject(TabStateService);
    private notificationService = inject(NotificationService);

    saveScope = signal<'environment' | 'capsule'>('capsule');

    constructor() {
        effect(() => {
            if (this.variableService.showAddModal()) {
                const hasEnv = !!this.envService.activeEnvironment();
                this.saveScope.set(hasEnv && this.variableService.modalType() !== 'path' ? 'environment' : 'capsule');
            }
        });
    }

    isDuplicateKey = computed(() => {
        const key = this.variableService.modalKey().trim().toLowerCase();
        if (!key) return false;
        if (this.saveScope() === 'environment') {
            const env = this.envService.activeEnvironment();
            return !!env?.variables.some(v => v.key.trim().toLowerCase() === key);
        }
        return this.variableService.variables().some(v => v.key.trim().toLowerCase() === key);
    });

    close() {
        this.variableService.closeAddModal();
    }

    save() {
        const key = this.variableService.modalKey().trim();
        const value = this.variableService.modalValue();

        if (!key) {
            this.notificationService.notify('Please provide a variable key name.', 'warning');
            return;
        }

        const isUpdate = this.isDuplicateKey();
        if (this.saveScope() === 'environment' && this.variableService.modalType() !== 'path') {
            this.envService.setActiveVariable(key, value, this.variableService.modalSource());
            const envName = this.envService.activeEnvironment()?.name || 'Active Environment';
            this.notificationService.notify(
                isUpdate
                    ? `Updated "${key}" in Environment "${envName}".`
                    : `Added "${key}" to Environment "${envName}" (switches with environments).`
            );
            this.close();
            return;
        }

        this.variableService.addVariable(key, value, this.variableService.modalSource(), this.variableService.modalType());
        if (isUpdate) {
            this.notificationService.notify(`Updated ${this.variableService.modalType()} variable "${key}" in Capsule Variables.`);
        } else {
            this.notificationService.notify(
                `Added "${key}" to Capsule Variables (${this.tabStateService.activeCapsuleName() || 'Capsule'}).`
            );
        }
        this.close();
    }
}
