import { Component, ChangeDetectionStrategy, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-help-updates-modal-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './help-updates.modal.component.html',
    styleUrl: './help-updates.modal.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(keydown.escape)': 'onClose.emit()'
    }
})
export class HelpUpdatesModalComponent {
    show = input<boolean>(false);
    onClose = output<void>();

    activeTab = signal<'guide' | 'updates'>('guide');

    appVersion = 'v1.0.2-steroids';
}
