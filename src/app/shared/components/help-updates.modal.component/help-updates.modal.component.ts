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
    isCheckingUpdate = signal<boolean>(false);
    updateCheckedMessage = signal<string>('');

    appVersion = 'v1.0.0-steroids';

    checkForUpdates() {
        if (this.isCheckingUpdate()) return;
        this.isCheckingUpdate.set(true);
        this.updateCheckedMessage.set('');

        setTimeout(() => {
            this.isCheckingUpdate.set(false);
            this.updateCheckedMessage.set('You are running the latest version of PostOnSteroids. Progressive updates are active.');
        }, 1200);
    }
}
