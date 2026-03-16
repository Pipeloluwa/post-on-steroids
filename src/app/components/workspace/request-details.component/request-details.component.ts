import { Component, effect, input, output, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { ShareModalComponent } from '../../../shared/components/share.modal.component/share.modal.component';
import { TabStateService } from '../../../shared/services/tab.state.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { inject } from '@angular/core';

@Component({
    selector: 'app-request-details-component',
    imports: [FormsModule, ScrollableSelectComponent, MatIcon, CommonModule, ShareModalComponent],
    templateUrl: './request-details.component.html',
    styleUrl: './request-details.component.css',
})
export class RequestDetailsComponent {
    isLoggedIn = input<boolean>(false);
    onAuthRequired = output<void>();
    onNotify = output<string>();

    waitingForAuth = signal<boolean>(false);
    tabStateService = inject(TabStateService);
    notificationService = inject(NotificationService);

    isSaving = computed(() => this.tabStateService.isSaving());

    constructor() {
        effect(() => {
            if (this.isLoggedIn() && this.waitingForAuth()) {
                this.waitingForAuth.set(false);
                // Small delay to ensure modal is closed and UI is ready
                setTimeout(() => this.shareCollection(), 500);
            }
        });

        effect(() => {
            const state = this.tabStateService.activeTabState();
            if (state) {
                this.requestName.set(state.name);
            }
        });
    }

    requestName = signal<string>('');

    onNameChange(newName: string) {
        const id = this.tabStateService.activeTabId();
        if (id) {
            this.tabStateService.updateState(id, { name: newName });
        }
    }
    collections = signal<string[]>(['My Collection', 'API Project A', 'Personal Sandbox', 'Team Workspace']);
    selectedCollection = signal<string>('My Collection');
    saveOptions = ['Save As...'];

    showShareModal = signal<boolean>(false);
    generatedLink = signal<string>('');

    setCollection(collection: string) {
        this.selectedCollection.set(collection);
        this.tabStateService.fetchCollectionData(collection);
    }

    shareCollection() {
        if (!this.isLoggedIn()) {
            this.waitingForAuth.set(true);
            this.onAuthRequired.emit();
            return;
        }

        const shareLink = `https://postonsteroids.app/share/${Math.random().toString(36).substring(7)}`;
        this.generatedLink.set(shareLink);
        this.showShareModal.set(true);
    }

    copyLink() {
        navigator.clipboard.writeText(this.generatedLink()).then(() => {
            this.showShareModal.set(false);
            this.onNotify.emit('Collection link copied to clipboard!');
        });
    }

    onSaveOptionSelected(option: string) {
        if (option === 'Save As...') {
            alert('Save As clicked!');
        }
    }

    async saveRequest() {
        const id = this.tabStateService.activeTabId();
        if (!id) return;
        await this.tabStateService.saveToCollection(id);
        this.onNotify.emit('Request saved successfully!');
    }
}
