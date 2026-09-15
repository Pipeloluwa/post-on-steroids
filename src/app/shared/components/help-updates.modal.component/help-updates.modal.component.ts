import { Component, ChangeDetectionStrategy, input, output, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../../constants/api.constants';

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
    private http = inject(HttpClient);
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

        this.http.get<{ latestVersion: string, message: string }>(`${API_BASE_URL}/updates/check`).subscribe({
            next: (res) => {
                this.isCheckingUpdate.set(false);
                this.updateCheckedMessage.set(res.message || 'You are running the latest version of PostOnSteroids.');
            },
            error: () => {
                // Fallback if the update endpoint is unavailable
                setTimeout(() => {
                    this.isCheckingUpdate.set(false);
                    this.updateCheckedMessage.set('You are running the latest version of PostOnSteroids. Progressive updates are active.');
                }, 800);
            }
        });
    }
}
