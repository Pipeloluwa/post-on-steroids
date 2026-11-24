import { Component, ChangeDetectionStrategy, effect, input, output, signal, computed, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { ShareModalComponent } from '../../../shared/components/share.modal.component/share.modal.component';
import { CurlModalComponent } from '../../../shared/components/curl-modal.component';
import { DocBrdGeneratorModalComponent } from '../../../shared/components/doc-brd-generator.modal.component';
import { CookieManagerModalComponent } from '../../../shared/components/cookie-manager.modal.component';
import { CookieJarService } from '../../../shared/services/cookie-jar.service';
import { TransferCapsuleModalComponent } from '../../../shared/components/transfer-capsule.modal.component';
import { BodyPortalDirective } from '../../../shared/directives/body-portal.directive';
import { TabStateService, RequestState, CapsuleLockMode } from '../../../shared/services/tab.state.service';
import { copyTextToClipboard } from '../../../shared/utils/clipboard.util';
import { convertCapsuleToPostmanCollection } from '../../../shared/utils/postman-export.util';
import { NotificationService } from '../../../shared/services/notification.service';
import { VariableService } from '../../../shared/services/variable.service';
import { inject } from '@angular/core';

@Component({
    selector: 'app-request-details-component',
    imports: [FormsModule, MatIcon, CommonModule, ShareModalComponent, CurlModalComponent, CookieManagerModalComponent, TransferCapsuleModalComponent, DocBrdGeneratorModalComponent, BodyPortalDirective],
    templateUrl: './request-details.component.html',
    styleUrl: './request-details.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:click)': 'closeHeaderMenus()'
    }
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
    cookieJarService = inject(CookieJarService);
    isSaving = computed(() => this.tabStateService.isSaving());
    isSharing = signal<boolean>(false);
    isExporting = signal<boolean>(false);
    isCookieModalOpen = signal<boolean>(false);
    cookieCount = computed(() => this.cookieJarService.cookies().length);

    tabId = input.required<string>();
    
    requestName = computed(() => this.tabStateService.getState(this.tabId())?.name || '');
    requestDescription = computed(() => this.tabStateService.getState(this.tabId())?.description || '');
    requestDocNotes = computed(() => this.tabStateService.getState(this.tabId())?.docNotes || '');
    requestTestRailPreconditions = computed(() => this.tabStateService.getState(this.tabId())?.testRailPreconditions || '');
    requestTestRailSteps = computed(() => this.tabStateService.getState(this.tabId())?.testRailSteps || '');
    requestTestRailExpected = computed(() => this.tabStateService.getState(this.tabId())?.testRailExpected || '');
    hasDocNotesContent = computed(() => Boolean(
        this.requestDescription().trim() ||
        this.requestDocNotes().trim() ||
        this.requestTestRailPreconditions().trim() ||
        this.requestTestRailSteps().trim() ||
        this.requestTestRailExpected().trim()
    ));
    isDocNotesModalOpen = signal<boolean>(false);
    isActionsMenuOpen = signal<boolean>(false);
    isSaveMenuOpen = signal<boolean>(false);
    docBrdInitialMode = signal<'api-doc' | 'brd' | 'testrail'>('api-doc');
    activeLockMode = computed<CapsuleLockMode>(() => this.tabStateService.activeCapsuleLockMode());
    readonly lockModeOptions: ReadonlyArray<{ id: CapsuleLockMode; label: string; title: string }> = [
        { id: 'unlocked', label: 'Unlocked', title: 'Full edit & delete access for you and shared receivers' },
        { id: 'read-only', label: 'Read-Only', title: 'Blocks all edits, structural changes, and deletes (enforced on shared link too)' },
        { id: 'edit-only', label: 'Edit-Only', title: 'Allows editing requests, blocks creating/deleting folders & deleting requests/capsule' },
        { id: 'locked', label: 'Locked', title: 'Completely locked — read-only & non-deletable' },
    ];

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
        const block = this.tabStateService.getEditBlockReason(undefined, 'edit');
        if (block) {
            this.notificationService.notify(block, 'warning');
            return;
        }
        this.tabStateService.updateState(this.tabId(), { name: newName });
    }

    onDocFieldChange(field: 'description' | 'docNotes' | 'testRailPreconditions' | 'testRailSteps' | 'testRailExpected', val: string) {
        const block = this.tabStateService.getEditBlockReason(undefined, 'edit');
        if (block) {
            this.notificationService.notify(block, 'warning');
            return;
        }
        this.tabStateService.updateState(this.tabId(), { [field]: val });
    }

    closeHeaderMenus(): void {
        this.isActionsMenuOpen.set(false);
        this.isSaveMenuOpen.set(false);
    }

    toggleActionsMenu(event: Event): void {
        event.stopPropagation();
        this.isSaveMenuOpen.set(false);
        this.isActionsMenuOpen.update(v => !v);
    }

    toggleSaveMenu(event: Event): void {
        event.stopPropagation();
        this.isActionsMenuOpen.set(false);
        this.isSaveMenuOpen.update(v => !v);
    }

    openDocNotesModal(): void {
        this.isActionsMenuOpen.set(false);
        this.isSaveMenuOpen.set(false);
        this.isDocNotesModalOpen.set(true);
    }

    onLockModeChange(mode: CapsuleLockMode): void {
        const capsuleId = this.tabStateService.activeCapsuleId();
        if (!capsuleId) {
            this.onNotify.emit('Select a capsule before setting a lock mode.');
            return;
        }
        this.tabStateService.setCapsuleLockMode(capsuleId, mode);
        const label = this.lockModeOptions.find((m) => m.id === mode)?.label || mode;
        this.notificationService.notify(`Capsule access set to ${label} (shared links inherit this setting).`);
    }
    saveOptions = ['Copy as cURL', 'View cURL...', 'Generate Docs / BRD...', 'Copy to Capsule...', 'Move to Capsule...', 'Export Endpoint', 'Export Capsule', 'Export as Postman'];

    showShareModal = signal<boolean>(false);
    generatedLink = signal<string>('');
    isCurlModalOpen = signal<boolean>(false);
    isDocBrdModalOpen = signal<boolean>(false);
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

    openDocBrdModal(mode: 'api-doc' | 'brd' | 'testrail' = 'api-doc'): void {
        this.docBrdInitialMode.set(mode);
        this.isDocBrdModalOpen.set(true);
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
            } else if (option === 'Generate Docs / BRD...') {
                this.openDocBrdModal();
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
                const examples = await this.tabStateService.getExamples(state.id).catch(() => []);
                const endpointExport = {
                    ...state,
                    ...(examples.length > 0 ? { examples } : {}),
                    variables: vars,
                    variableSources: varSources
                };
                this.downloadJson(endpointExport, `request_${state.name || 'untitled'}.json`);
                this.onNotify.emit('Endpoint exported successfully.');
            } else if (option === 'Export Capsule') {
                const capsuleId = this.tabStateService.activeCapsuleId();
                const fullCapsule = await this.tabStateService.getFullCapsuleExportData(capsuleId);
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
            } else if (option === 'Export as Postman') {
                const capsuleId = this.tabStateService.activeCapsuleId();
                const fullCapsule = await this.tabStateService.getFullCapsuleExportData(capsuleId);
                const collectionName = fullCapsule.name || 'My Capsule';
                const pmCollection = convertCapsuleToPostmanCollection(fullCapsule);
                const safeName = collectionName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'capsule';
                this.downloadJson(pmCollection, `${safeName}.postman_collection.json`);
                this.onNotify.emit(`Postman Collection "${collectionName}" exported (${fullCapsule.requests.length} request${fullCapsule.requests.length !== 1 ? 's' : ''}).`);
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
