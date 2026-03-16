import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { VariableService } from '../../services/variable.service';
import { IGlobalVariable } from '../../../interfaces/services/IVariableService';

@Component({
    standalone: true,
    selector: 'app-variable-modal',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './variable.modal.component.html',
    styleUrl: './variable.modal.component.css',
})
export class VariableModalComponent {
    variableService = inject(VariableService);
    isOpen = signal(false);

    close() {
        this.isOpen.set(false);
    }

    stopProp(event: Event) {
        event.stopPropagation();
    }

    addVar() {
        this.variableService.addVariable();
    }

    updateVar(v: IGlobalVariable) {
        this.variableService.updateVariable(v);
    }

    removeVar(id: string) {
        this.variableService.removeVariable(id);
    }

    toggleEnabled(v: IGlobalVariable) {
        this.variableService.updateVariable({ ...v, enabled: !v.enabled });
    }
}
