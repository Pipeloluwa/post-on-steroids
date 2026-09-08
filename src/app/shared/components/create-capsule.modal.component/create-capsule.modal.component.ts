import { Component, ChangeDetectionStrategy, signal, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TabStateService } from '../../services/tab.state.service';
import { NotificationService } from '../../services/notification.service';

@Component({
    selector: 'app-create-capsule-modal',
    imports: [CommonModule, MatIcon],
    templateUrl: './create-capsule.modal.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CreateCapsuleModalComponent {
    private tabStateService = inject(TabStateService);
    private notificationService = inject(NotificationService);

    isOpen = signal<boolean>(false);
    capsuleName = signal<string>('');
    isCreating = signal<boolean>(false);
    errorMessage = signal<string>('');

    onCreated = output<string>();

    open(defaultName = ''): void {
        this.capsuleName.set(defaultName);
        this.errorMessage.set('');
        this.isCreating.set(false);
        this.isOpen.set(true);
    }

    close(): void {
        this.isOpen.set(false);
        this.errorMessage.set('');
        this.isCreating.set(false);
    }

    async create(): Promise<void> {
        const name = this.capsuleName().trim();
        if (!name) {
            this.errorMessage.set('Capsule name is required.');
            return;
        }

        try {
            this.isCreating.set(true);
            await this.tabStateService.createCapsule(name);
            this.notificationService.notify(`Capsule "${name}" created successfully`);
            this.onCreated.emit(name);
            this.close();
        } catch (err: any) {
            this.errorMessage.set(err?.message || 'Failed to create capsule. Please try again.');
        } finally {
            this.isCreating.set(false);
        }
    }
}
