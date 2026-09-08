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
    pendingAction = signal<'share' | 'save' | null>(null);
    tabStateService = inject(TabStateService);
    notificationService = inject(NotificationService);
    isSaving = computed(() => this.tabStateService.isSaving());

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

    async setCapsule(collectionName: string) {
        if (collectionName === '+ New Capsule...') {
            const name = prompt('Enter a name for the new capsule:', 'My New Capsule');
            if (name && name.trim()) {
                await this.tabStateService.createCapsule(name.trim());
                this.onNotify.emit(`Capsule "${name.trim()}" created successfully`);
            }
            return;
        }
        const capsule = this.tabStateService.capsules().find(c => c.name === collectionName);
        if (capsule) {
            await this.tabStateService.switchCapsule(capsule);
        }
    }

    shareCapsule() {
        if (!this.isLoggedIn()) {
            this.waitingForAuth.set(true);
            this.pendingAction.set('share');
            this.onAuthRequired.emit();
            this.onNotify.emit('Please sign in to share this capsule.');
            return;
        }

        const shareLink = `https://onsteroids.app/share/${Math.random().toString(36).substring(7)}`;
        this.generatedLink.set(shareLink);
        this.showShareModal.set(true);
    }

    copyLink() {
        navigator.clipboard.writeText(this.generatedLink()).then(() => {
            this.showShareModal.set(false);
            this.onNotify.emit('Capsule link copied to clipboard!');
        });
    }

    onSaveOptionSelected(option: string) {
        if (option === 'Export Endpoint') {
            const state = this.tabStateService.getState(this.tabId());
            if (!state) return;
            this.downloadJson(state, `request_${state.name || 'untitled'}.json`);
        } else if (option === 'Export Capsule') {
            const collectionName = this.selectedCapsule();
            const collectionRequests = this.tabStateService.savedCapsules();
            const exportData = {
                collection: collectionName,
                exportedAt: new Date().toISOString(),
                requests: collectionRequests
            };
            this.downloadJson(exportData, `capsule_${collectionName}.json`);
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
        if (!this.isLoggedIn()) {
            this.waitingForAuth.set(true);
            this.pendingAction.set('save');
            this.onAuthRequired.emit();
            this.onNotify.emit('Please sign in to save your request to a capsule.');
            return;
        }

        await this.tabStateService.saveToCapsule(this.tabId());
        this.onNotify.emit('Request saved successfully!');
    }
}
