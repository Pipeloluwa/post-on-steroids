import { Component, ChangeDetectionStrategy, effect, input, output, signal, untracked } from '@angular/core';
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
    initialTab = input<'guide' | 'updates'>('guide');
    onClose = output<void>();

    activeTab = signal<'guide' | 'updates'>('guide');

    appVersion = 'v1.0.4-steroids';

    private wasShown = false;

    constructor() {
        effect(() => {
            const visible = this.show();
            if (visible && !this.wasShown) {
                this.wasShown = true;
                untracked(() => this.activeTab.set(this.initialTab()));
            } else if (!visible && this.wasShown) {
                this.wasShown = false;
            }
        });
    }
}
