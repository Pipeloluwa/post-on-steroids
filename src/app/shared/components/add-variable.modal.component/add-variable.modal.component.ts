import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { VariableService } from '../../services/variable.service';
import { NotificationService } from '../../services/notification.service';

@Component({
    selector: 'app-add-variable-modal-component',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './add-variable.modal.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddVariableModalComponent {
    variableService = inject(VariableService);
    private notificationService = inject(NotificationService);

    close() {
        this.variableService.closeAddModal();
    }

    save() {
        const key = this.variableService.modalKey().trim();
        const value = this.variableService.modalValue();

        if (!key) {
            this.notificationService.notify('Please provide a variable key name.');
            return;
        }

        this.variableService.addVariable(key, value, this.variableService.modalSource());
        this.notificationService.notify(`Added variable "{{${key}}}" to Global Variables.`);
        this.close();
    }
}
