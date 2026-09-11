import { Component, ChangeDetectionStrategy, effect, input, output, signal, computed, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { ShareModalComponent } from '../../../shared/components/share.modal.component/share.modal.component';
import { CreateCapsuleModalComponent } from '../../../shared/components/create-capsule.modal.component/create-capsule.modal.component';
import { TabStateService } from '../../../shared/services/tab.state.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { inject } from '@angular/core';

@Component({
    selector: 'app-request-details-component',
    imports: [FormsModule, ScrollableSelectComponent, MatIcon, CommonModule, ShareModalComponent, CreateCapsuleModalComponent],
    templateUrl: './request-details.component.html',
    styleUrl: './request-details.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RequestDetailsComponent {
    isLoggedIn = input<boolean>(false);
    onAuthRequired = output<void>();
    onNotify = output<string>();

    waitingForAuth = signal<boolean>(false);
    pendingAction = signal<'share' | 'save' | null>(null);
    tabStateService = inject(TabStateService);
    notificationService = inject(NotificationService);
    isSaving = computed(() => this.tabStateService.isSaving());
    isSharing = signal<boolean>(false);
    isExporting = signal<boolean>(false);

    tabId = input.required<string>();
    
    requestName = computed(() => this.tabStateService.getState(this.tabId())?.name || '');
    capsules = computed(() => {
        const names = this.tabStateService.capsules().map(c => c.name);
        return [...names, '+ New Capsule...'];
    });
    
    selectedCapsule = computed(() => {
        const id = this.tabStateService.activeCapsuleId();
        const capsule = this.tabStateService.capsules().find(c => c.id === id);
        return capsule ? capsule.name : 'My Capsule';
    });

    constructor() {
        effect(() => {
            if (this.isLoggedIn() && this.waitingForAuth()) {
                const action = this.pendingAction();
                this.waitingForAuth.set(false);
                this.pendingAction.set(null);
                if (action === 'save') {
                    setTimeout(() => this.saveRequest(), 500);
                } else if (action === 'share') {
                    setTimeout(() => this.shareCapsule(), 500);
                }
            }
        });
    }

    onNameChange(newName: string) {
        this.tabStateService.updateState(this.tabId(), { name: newName });
    }
    saveOptions = ['Export Endpoint', 'Export Capsule'];

    showShareModal = signal<boolean>(false);
    generatedLink = signal<string>('');

    @ViewChild('createCapsuleModal') createCapsuleModal?: CreateCapsuleModalComponent;

    async setCapsule(collectionName: string) {
        if (collectionName === '+ New Capsule...') {
            this.createCapsuleModal?.open();
            return;
        }
        const capsule = this.tabStateService.capsules().find(c => c.name === collectionName);
        if (capsule) {
            await this.tabStateService.switchCapsule(capsule);
        }
    }

    async shareCapsule() {
        if (!this.isLoggedIn()) {
            this.waitingForAuth.set(true);
            this.pendingAction.set('share');
            this.onAuthRequired.emit();
            this.onNotify.emit('Please sign in to share this capsule.');
            return;
        }

        const capsuleId = this.tabStateService.activeCapsuleId();
        if (!capsuleId) {
            this.onNotify.emit('No active capsule selected to share.');
            return;
        }

        this.isSharing.set(true);
        try {
            const shareUrl = await this.tabStateService.shareCapsule(capsuleId);
            this.generatedLink.set(shareUrl);
            this.showShareModal.set(true);
        } catch (e: any) {
            this.onNotify.emit(e?.message || 'Failed to share capsule.');
        } finally {
            this.isSharing.set(false);
        }
    }

    copyLink() {
        navigator.clipboard.writeText(this.generatedLink()).then(() => {
            this.showShareModal.set(false);
            this.onNotify.emit('Capsule link copied to clipboard!');
        });
    }

    async onSaveOptionSelected(option: string) {
        this.isExporting.set(true);
        try {
            if (option === 'Export Endpoint') {
                const state = this.tabStateService.getState(this.tabId());
                if (!state) return;
                this.downloadJson(state, `request_${state.name || 'untitled'}.json`);
                this.onNotify.emit('Endpoint exported successfully.');
            } else if (option === 'Export Capsule') {
                const collectionName = this.selectedCapsule();
                const collectionRequests = this.tabStateService.savedCapsules();
                const exportData = {
                    collection: collectionName,
                    exportedAt: new Date().toISOString(),
                    requests: collectionRequests
                };
                this.downloadJson(exportData, `capsule_${collectionName}.json`);
                this.onNotify.emit(`Capsule "${collectionName}" exported successfully.`);
            }
        } finally {
            setTimeout(() => this.isExporting.set(false), 300);
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
        await this.tabStateService.saveToCapsule(this.tabId());

        if (!this.isLoggedIn()) {
            this.waitingForAuth.set(true);
            this.pendingAction.set('save');
            this.onAuthRequired.emit();
            this.onNotify.emit('Saved locally! Sign in to sync with cloud.');
            return;
        }

        this.onNotify.emit('Capsule, requests, and variables saved successfully!');
    }
}
