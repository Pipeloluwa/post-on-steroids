import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { RequestGroup, TabStateService } from '../services/tab.state.service';
import { NotificationService } from '../services/notification.service';

@Component({
    selector: 'app-transfer-capsule-modal',
    imports: [FormsModule, MatIcon],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:keydown.escape)': 'onEscape($event)'
    },
    template: `
        @if (isOpen()) {
            <div class="fixed inset-0 z-100 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 animate-in fade-in duration-150"
                 (click)="close()">
                <div role="dialog"
                     aria-modal="true"
                     aria-labelledby="transfer-capsule-title"
                     class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
                     (click)="$event.stopPropagation()">

                    <!-- Header -->
                    <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50">
                        <div class="flex items-center gap-x-2.5 min-w-0">
                            <div class="size-7 rounded-lg bg-(--postonsteroids-accent)/15 text-(--postonsteroids-accent) flex items-center justify-center shrink-0">
                                <mat-icon class="text-[17px]! size-[17px]!">{{ mode() === 'copy' ? 'content_copy' : 'drive_file_move' }}</mat-icon>
                            </div>
                            <div class="min-w-0">
                                <h3 id="transfer-capsule-title" class="text-[14px] font-bold text-(--postonsteroids-text-primary) leading-tight">
                                    {{ mode() === 'copy' ? 'Copy to Capsule' : 'Move to Capsule' }}
                                </h3>
                                <p class="text-[11px] text-(--postonsteroids-text-muted) truncate">
                                    {{ requestSummaryText() }}
                                </p>
                            </div>
                        </div>
                        <button type="button"
                                (click)="close()"
                                [disabled]="isSubmitting()"
                                aria-label="Close transfer modal"
                                class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) transition-colors cursor-pointer disabled:opacity-50">
                            <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
                        </button>
                    </div>

                    <!-- Body -->
                    <div class="p-5 flex flex-col gap-4">
                        <!-- Copy / Move Switch -->
                        <div class="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border)">
                            <button type="button"
                                    (click)="mode.set('copy')"
                                    [class.bg-(--postonsteroids-accent)]="mode() === 'copy'"
                                    [class.text-white]="mode() === 'copy'"
                                    [class.text-(--postonsteroids-text-secondary)]="mode() !== 'copy'"
                                    class="py-1.5 px-3 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
                                <mat-icon class="text-[15px]! size-[15px]!">content_copy</mat-icon>
                                <span>Copy</span>
                            </button>
                            <button type="button"
                                    (click)="mode.set('move')"
                                    [class.bg-(--postonsteroids-accent)]="mode() === 'move'"
                                    [class.text-white]="mode() === 'move'"
                                    [class.text-(--postonsteroids-text-secondary)]="mode() !== 'move'"
                                    class="py-1.5 px-3 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
                                <mat-icon class="text-[15px]! size-[15px]!">drive_file_move</mat-icon>
                                <span>Move</span>
                            </button>
                        </div>

                        @if (mode() === 'move') {
                            <div class="px-3 py-2 rounded-lg bg-status-warning/10 border border-status-warning/30 text-[11px] text-status-warning flex items-start gap-2">
                                <mat-icon class="text-[15px]! size-[15px]! shrink-0 mt-0.5">info</mat-icon>
                                <span>Moving copies request configuration to the destination capsule first, then removes it from <strong>{{ sourceCapsuleName() }}</strong>.</span>
                            </div>
                        }

                        <!-- Target Capsule -->
                        <div>
                            <label for="targetCapsuleSelect" class="block text-[12px] font-semibold text-(--postonsteroids-text-secondary) mb-1.5">
                                Destination Capsule
                            </label>
                            <select id="targetCapsuleSelect"
                                    [ngModel]="selectedCapsuleId()"
                                    (ngModelChange)="onCapsuleSelected($event)"
                                    class="w-full px-3 py-2 rounded-xl bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) text-[12.5px] outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
                                @for (c of otherCapsules(); track c.id) {
                                    <option [value]="c.id" class="bg-(--postonsteroids-bg-secondary) text-(--postonsteroids-text-primary)">
                                        {{ c.name }}
                                    </option>
                                }
                                <option value="__new__" class="bg-(--postonsteroids-bg-secondary) text-(--postonsteroids-accent) font-semibold">
                                    + Create New Capsule...
                                </option>
                            </select>
                        </div>

                        <!-- New Capsule Name (if creating new) -->
                        @if (selectedCapsuleId() === '__new__') {
                            <div>
                                <label for="newTargetCapsuleInput" class="block text-[12px] font-semibold text-(--postonsteroids-text-secondary) mb-1.5">
                                    New Capsule Name
                                </label>
                                <input id="newTargetCapsuleInput"
                                       type="text"
                                       [ngModel]="newCapsuleName()"
                                       (ngModelChange)="newCapsuleName.set($event)"
                                       (keydown.enter)="submit()"
                                       placeholder="e.g. Production APIs"
                                       class="w-full px-3 py-2 rounded-xl bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) text-[12.5px] outline-none focus:border-(--postonsteroids-accent)" />
                            </div>
                        }

                        <!-- Optional Folder inside Destination Capsule -->
                        @if (selectedCapsuleId() !== '__new__' && (targetGroups().length > 0 || isLoadingGroups())) {
                            <div>
                                <label for="targetFolderSelect" class="block text-[12px] font-semibold text-(--postonsteroids-text-secondary) mb-1.5">
                                    Destination Folder (Optional)
                                </label>
                                @if (isLoadingGroups()) {
                                    <div class="flex items-center gap-2 text-[11.5px] text-(--postonsteroids-text-muted) py-1.5">
                                        <mat-icon class="text-[14px]! size-[14px]! animate-spin text-(--postonsteroids-accent)">progress_activity</mat-icon>
                                        <span>Checking folders in destination capsule...</span>
                                    </div>
                                } @else {
                                    <select id="targetFolderSelect"
                                            [ngModel]="targetGroupId()"
                                            (ngModelChange)="targetGroupId.set($event)"
                                            class="w-full px-3 py-2 rounded-xl bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) text-[12.5px] outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
                                        <option value="" class="bg-(--postonsteroids-bg-secondary) text-(--postonsteroids-text-primary)">
                                            Capsule Root (No Folder)
                                        </option>
                                        @for (g of targetGroups(); track g.id) {
                                            <option [value]="g.id" class="bg-(--postonsteroids-bg-secondary) text-(--postonsteroids-text-primary)">
                                                📁 {{ g.name }}
                                            </option>
                                        }
                                    </select>
                                }
                            </div>
                        }

                        <!-- Switch option -->
                        <label class="flex items-center gap-2 text-[12px] text-(--postonsteroids-text-secondary) cursor-pointer select-none">
                            <input type="checkbox"
                                   [ngModel]="switchAfterTransfer()"
                                   (ngModelChange)="switchAfterTransfer.set($event)"
                                   class="accent-(--postonsteroids-accent) cursor-pointer" />
                            <span>Open destination capsule after {{ mode() === 'copy' ? 'copying' : 'moving' }}</span>
                        </label>

                        @if (errorMsg()) {
                            <div class="px-3 py-2 rounded-lg bg-status-danger/10 border border-status-danger/30 text-[11.5px] text-status-danger">
                                {{ errorMsg() }}
                            </div>
                        }
                    </div>

                    <!-- Footer -->
                    <div class="px-5 py-3.5 bg-(--postonsteroids-bg-tertiary)/40 border-t border-(--postonsteroids-border) flex items-center justify-end gap-2.5">
                        <button type="button"
                                (click)="close()"
                                [disabled]="isSubmitting()"
                                class="px-4 py-1.5 rounded-lg text-[12px] font-medium text-(--postonsteroids-text-secondary) hover:bg-(--postonsteroids-bg-hover) transition-colors cursor-pointer disabled:opacity-50">
                            Cancel
                        </button>
                        <button type="button"
                                (click)="submit()"
                                [disabled]="isSubmitting() || !canSubmit()"
                                class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white text-[12px] font-semibold shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                            @if (isSubmitting()) {
                                <mat-icon class="text-[15px]! size-[15px]! animate-spin">sync</mat-icon>
                                <span>{{ mode() === 'copy' ? 'Copying...' : 'Moving...' }}</span>
                            } @else {
                                <mat-icon class="text-[15px]! size-[15px]!">{{ mode() === 'copy' ? 'content_copy' : 'drive_file_move' }}</mat-icon>
                                <span>{{ mode() === 'copy' ? 'Copy Request(s)' : 'Move Request(s)' }}</span>
                            }
                        </button>
                    </div>
                </div>
            </div>
        }
    `
})
export class TransferCapsuleModalComponent {
    private tabStateService = inject(TabStateService);
    private notificationService = inject(NotificationService);

    isOpen = input<boolean>(false);
    requestIds = input<string[]>([]);
    initialMode = input<'copy' | 'move'>('copy');

    closed = output<void>();
    completed = output<{
        mode: 'copy' | 'move';
        transferredCount: number;
        targetCapsuleId: string;
        targetCapsuleName: string;
        switched: boolean;
    }>();

    mode = signal<'copy' | 'move'>('copy');
    selectedCapsuleId = signal<string>('');
    newCapsuleName = signal<string>('');
    targetGroupId = signal<string>('');
    switchAfterTransfer = signal<boolean>(false);
    targetGroups = signal<RequestGroup[]>([]);
    isLoadingGroups = signal<boolean>(false);
    isSubmitting = signal<boolean>(false);
    errorMsg = signal<string | null>(null);

    sourceCapsuleName = computed(() => this.tabStateService.activeCapsuleName() || 'Current Capsule');
    otherCapsules = computed(() =>
        this.tabStateService.capsules().filter(c => c.id !== this.tabStateService.activeCapsuleId())
    );

    requestSummaryText = computed(() => {
        const ids = this.requestIds();
        if (ids.length === 1) {
            const req = this.tabStateService.getState(ids[0])
                || this.tabStateService.allCapsuleRequests().find(r => r.id === ids[0]);
            if (req) {
                return `${(req.method || 'GET').toUpperCase()} · ${this.tabStateService.resolveRequestTitle(req.name, req.url)}`;
            }
            return '1 selected request';
        }
        return `${ids.length} selected requests from "${this.sourceCapsuleName()}"`;
    });

    canSubmit = computed(() => {
        if (this.requestIds().length === 0) return false;
        if (this.selectedCapsuleId() === '__new__') {
            return this.newCapsuleName().trim().length > 0;
        }
        return Boolean(this.selectedCapsuleId());
    });

    constructor() {
        effect(() => {
            if (this.isOpen()) {
                this.mode.set(this.initialMode());
                this.errorMsg.set(null);
                this.targetGroupId.set('');
                this.newCapsuleName.set('');
                const others = this.otherCapsules();
                const initialTarget = others.length > 0 ? others[0].id : '__new__';
                this.selectedCapsuleId.set(initialTarget);
                if (initialTarget !== '__new__') {
                    void this.loadGroups(initialTarget);
                } else {
                    this.targetGroups.set([]);
                }
            }
        });
    }

    onEscape(event: Event): void {
        if (!this.isOpen() || this.isSubmitting()) return;
        event.preventDefault();
        this.close();
    }

    onCapsuleSelected(capsuleId: string): void {
        this.selectedCapsuleId.set(capsuleId);
        this.targetGroupId.set('');
        this.errorMsg.set(null);
        if (capsuleId && capsuleId !== '__new__') {
            void this.loadGroups(capsuleId);
        } else {
            this.targetGroups.set([]);
        }
    }

    private async loadGroups(capsuleId: string): Promise<void> {
        this.isLoadingGroups.set(true);
        try {
            const groups = await this.tabStateService.loadGroupsForCapsule(capsuleId);
            if (this.selectedCapsuleId() === capsuleId) {
                this.targetGroups.set(groups);
            }
        } catch {
            if (this.selectedCapsuleId() === capsuleId) {
                this.targetGroups.set([]);
            }
        } finally {
            this.isLoadingGroups.set(false);
        }
    }

    close(): void {
        if (this.isSubmitting()) return;
        this.closed.emit();
    }

    async submit(): Promise<void> {
        if (!this.canSubmit() || this.isSubmitting()) return;
        this.isSubmitting.set(true);
        this.errorMsg.set(null);

        try {
            let destinationCapsuleId = this.selectedCapsuleId();
            if (destinationCapsuleId === '__new__') {
                const created = await this.tabStateService.createCapsule(this.newCapsuleName().trim());
                destinationCapsuleId = created.id;
            }

            const chosenGroupId = this.targetGroupId().trim() || null;
            const currentMode = this.mode();
            const result = await this.tabStateService.transferRequestsToCapsule(
                this.requestIds(),
                destinationCapsuleId,
                currentMode,
                chosenGroupId
            );

            const shouldSwitch = this.switchAfterTransfer();
            if (shouldSwitch) {
                await this.tabStateService.switchCapsule({
                    id: result.targetCapsuleId,
                    name: result.targetCapsuleName
                });
                if (result.savedIds.length > 0) {
                    const firstId = result.savedIds[0];
                    const targetReq = this.tabStateService.getState(firstId);
                    if (targetReq) {
                        this.tabStateService.addOpenTab(targetReq);
                    }
                    this.tabStateService.setActiveTab(firstId);
                }
            }

            const verb = currentMode === 'copy' ? 'Copied' : 'Moved';
            this.notificationService.notify(
                `${verb} ${result.transferredCount} request${result.transferredCount !== 1 ? 's' : ''} to "${result.targetCapsuleName}".`,
                'success'
            );

            this.completed.emit({
                mode: currentMode,
                transferredCount: result.transferredCount,
                targetCapsuleId: result.targetCapsuleId,
                targetCapsuleName: result.targetCapsuleName,
                switched: shouldSwitch
            });
            this.closed.emit();
        } catch (err: any) {
            this.errorMsg.set(err?.error?.message || err?.message || 'Failed to transfer request(s).');
        } finally {
            this.isSubmitting.set(false);
        }
    }
}
