import { Component, ChangeDetectionStrategy, effect, input, output, signal, computed, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { ShareModalComponent } from '../../../shared/components/share.modal.component/share.modal.component';
import { CurlModalComponent } from '../../../shared/components/curl-modal.component';
import { TransferCapsuleModalComponent } from '../../../shared/components/transfer-capsule.modal.component';
import { TabStateService, RequestState } from '../../../shared/services/tab.state.service';
import { copyTextToClipboard } from '../../../shared/utils/clipboard.util';
import { NotificationService } from '../../../shared/services/notification.service';
import { VariableService } from '../../../shared/services/variable.service';
import { inject } from '@angular/core';

@Component({
    selector: 'app-request-details-component',
    imports: [FormsModule, ScrollableSelectComponent, MatIcon, CommonModule, ShareModalComponent, CurlModalComponent, TransferCapsuleModalComponent],
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
    variableService = inject(VariableService);
    isSaving = computed(() => this.tabStateService.isSaving());
    isSharing = signal<boolean>(false);
    isExporting = signal<boolean>(false);

    tabId = input.required<string>();
    
    requestName = computed(() => this.tabStateService.getState(this.tabId())?.name || '');

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
    saveOptions = ['Copy as cURL', 'View cURL...', 'Copy to Capsule...', 'Move to Capsule...', 'Export Endpoint', 'Export Capsule'];

    showShareModal = signal<boolean>(false);
    generatedLink = signal<string>('');
    isCurlModalOpen = signal<boolean>(false);
    isTransferModalOpen = signal<boolean>(false);
    transferMode = signal<'copy' | 'move'>('copy');

    currentRequestState = computed<RequestState | null>(() => {
        const id = this.tabId();
        return this.tabStateService.getState(id) || null;
    });

    openCurlModal(): void {
        if (!this.currentRequestState()) return;
        this.isCurlModalOpen.set(true);
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
            // Always save/sync the capsule, its requests, groups, triggers, auto-auth, and variables before sharing
            await this.tabStateService.saveToCapsule();

            const effectiveId = this.tabStateService.activeCapsuleId() || capsuleId;
            const shareUrl = await this.tabStateService.shareCapsule(effectiveId);
            this.generatedLink.set(shareUrl);
            this.showShareModal.set(true);
        } catch (e: any) {
            this.onNotify.emit(e?.message || 'Failed to share capsule.');
        } finally {
            this.isSharing.set(false);
        }
    }

    async copyLink() {
        const link = this.generatedLink();
        await copyTextToClipboard(link);
        this.showShareModal.set(false);
        this.onNotify.emit('Capsule link copied to clipboard!');
    }

    async onSaveOptionSelected(option: string) {
        this.isExporting.set(true);
        try {
            if (option === 'Copy as cURL') {
                await this.tabStateService.copyRequestAsCurl(this.tabId());
                return;
            } else if (option === 'View cURL...') {
                this.openCurlModal();
                return;
            } else if (option === 'Copy to Capsule...' || option === 'Move to Capsule...') {
                this.transferMode.set(option.startsWith('Move') ? 'move' : 'copy');
                this.isTransferModalOpen.set(true);
                return;
            } else if (option === 'Export Endpoint') {
                const state = this.tabStateService.getState(this.tabId());
                if (!state) return;
                const capId = state.capsuleId || this.tabStateService.activeCapsuleId();
                const varSources = this.variableService.getSourceMapForCapsule(capId);
                const vars = this.variableService.variables().map(v => {
                    const kLower = (v.key || '').trim().toLowerCase();
                    return { ...v, source: v.source ?? varSources[kLower] };
                });
                const endpointExport = {
                    ...state,
                    variables: vars,
                    variableSources: varSources
                };
                this.downloadJson(endpointExport, `request_${state.name || 'untitled'}.json`);
                this.onNotify.emit('Endpoint exported successfully.');
            } else if (option === 'Export Capsule') {
                const capsuleId = this.tabStateService.activeCapsuleId();
                const fullCapsule = this.tabStateService.getFullCapsuleExportDataSync(capsuleId);
                const collectionName = fullCapsule.name || 'My Capsule';
                const exportData = {
                    version: "1.0.0",
                    collection: collectionName,
                    capsule: collectionName,
                    autoAuthEnabled: fullCapsule.autoAuthEnabled,
                    autoAuthEndpointId: fullCapsule.autoAuthEndpointId,
                    exportedAt: new Date().toISOString(),
                    capsules: [fullCapsule],
                    requests: fullCapsule.requests,
                    groups: fullCapsule.groups,
                    requestOrder: fullCapsule.requestOrder,
                    variables: fullCapsule.variables,
                    variableSources: fullCapsule.variableSources
                };
                const safeName = collectionName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'capsule';
                this.downloadJson(exportData, `capsule_${safeName}.json`);
                this.onNotify.emit(`Capsule "${collectionName}" exported successfully (${fullCapsule.requests.length} request${fullCapsule.requests.length !== 1 ? 's' : ''}).`);
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

    cancelSave() {
        this.tabStateService.cancelSave();
    }

    async saveRequest() {
        try {
            await this.tabStateService.saveToCapsule(this.tabId());

            if (!this.isLoggedIn()) {
                this.waitingForAuth.set(true);
                this.pendingAction.set('save');
                this.onAuthRequired.emit();
                this.onNotify.emit('Saved locally! Sign in to sync with cloud.');
                return;
            }

            this.onNotify.emit('Capsule, requests, and variables saved successfully!');
        } catch (e: any) {
            console.error('Failed to save request/capsule:', e);
            this.onNotify.emit(e?.error?.message || e?.message || 'Failed to save capsule to cloud.');
        }
    }
}
