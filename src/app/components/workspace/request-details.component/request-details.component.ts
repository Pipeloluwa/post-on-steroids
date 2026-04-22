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
    saveOptions = ['Export Endpoint', 'Export Collection'];

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
        if (option === 'Export Endpoint') {
            const state = this.tabStateService.activeTabState();
            if (!state) return;
            this.downloadJson(state, `request_${state.name || 'untitled'}.json`);
        } else if (option === 'Export Collection') {
            const collectionName = this.selectedCollection();
            const collectionRequests = this.tabStateService.savedCollection().filter(r => r.name === collectionName);
            const exportData = {
                collection: collectionName,
                exportedAt: new Date().toISOString(),
                requests: collectionRequests
            };
            this.downloadJson(exportData, `collection_${collectionName}.json`);
        }
    }

    private downloadJson(data: any, filename: string) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    async saveRequest() {
        const id = this.tabStateService.activeTabId();
        if (!id) return;
        await this.tabStateService.saveToCollection(id);
        this.onNotify.emit('Request saved successfully!');
    }
}
