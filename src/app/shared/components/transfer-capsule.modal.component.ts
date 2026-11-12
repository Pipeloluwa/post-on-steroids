import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
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
                     class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-md shadow-2xl overflow-visible flex flex-col"
                     (click)="$event.stopPropagation(); closeDropdowns()">

                    <!-- Header -->
                    <div class="px-5 py-3.5 rounded-t-2xl border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50">
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
                                    (click)="setMode('copy')"
                                    [disabled]="isSubmitting()"
                                    [attr.aria-pressed]="mode() === 'copy'"
                                    [class]="mode() === 'copy'
                                        ? 'py-1.5 px-3 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-(--postonsteroids-accent) text-white shadow-sm'
                                        : 'py-1.5 px-3 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer text-(--postonsteroids-text-secondary) hover:text-(--postonsteroids-text-primary) hover:bg-(--postonsteroids-bg-hover)/60'">
                                <mat-icon class="text-[15px]! size-[15px]!">content_copy</mat-icon>
                                <span>Copy</span>
                            </button>
                            <button type="button"
                                    (click)="setMode('move')"
                                    [disabled]="isSubmitting()"
                                    [attr.aria-pressed]="mode() === 'move'"
                                    [class]="mode() === 'move'
                                        ? 'py-1.5 px-3 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer bg-(--postonsteroids-accent) text-white shadow-sm'
                                        : 'py-1.5 px-3 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer text-(--postonsteroids-text-secondary) hover:text-(--postonsteroids-text-primary) hover:bg-(--postonsteroids-bg-hover)/60'">
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

                        <!-- Target Capsule (Custom Sleek Dropdown) -->
                        <div class="relative" (click)="$event.stopPropagation()">
                            <label class="block text-[12px] font-semibold text-(--postonsteroids-text-secondary) mb-1.5">
                                Destination Capsule
                            </label>
                            <button type="button"
                                    (click)="toggleCapsuleDropdown()"
                                    [disabled]="isSubmitting()"
                                    aria-haspopup="listbox"
                                    [attr.aria-expanded]="isCapsuleDropdownOpen()"
                                    class="w-full h-9.5 px-3 rounded-xl bg-(--postonsteroids-bg-tertiary) border text-(--postonsteroids-text-primary) text-[12.5px] flex items-center justify-between gap-2 transition-colors cursor-pointer disabled:opacity-50"
                                    [class.border-(--postonsteroids-accent)]="isCapsuleDropdownOpen()"
                                    [class.border-(--postonsteroids-border)]="!isCapsuleDropdownOpen()"
                                    [class.hover:border-(--postonsteroids-accent)/50]="!isCapsuleDropdownOpen()">
                                <div class="flex items-center gap-2 min-w-0">
                                    <mat-icon class="text-[16px]! size-[16px]! shrink-0"
                                              [class.text-(--postonsteroids-accent)]="selectedCapsuleId() === '__new__'"
                                              [class.text-(--postonsteroids-text-muted)]="selectedCapsuleId() !== '__new__'">
                                        {{ selectedCapsuleId() === '__new__' ? 'add_circle_outline' : 'inventory_2' }}
                                    </mat-icon>
                                    <span class="truncate font-medium">{{ selectedCapsuleLabel() }}</span>
                                </div>
                                <mat-icon class="text-[17px]! size-[17px]! text-(--postonsteroids-text-muted) shrink-0 transition-transform duration-150"
                                          [class.rotate-180]="isCapsuleDropdownOpen()">
                                    expand_more
                                </mat-icon>
                            </button>

                            @if (isCapsuleDropdownOpen()) {
                                <div role="listbox"
                                     class="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) shadow-2xl overflow-hidden animate-in fade-in duration-100">
                                    @if (otherCapsules().length > 0) {
                                        <div class="pt-2 pb-1.5 px-1.5 max-h-48 overflow-y-auto sidebar-scroll space-y-0.5">
                                            @for (c of otherCapsules(); track c.id) {
                                                <button type="button"
                                                        role="option"
                                                        [attr.aria-selected]="selectedCapsuleId() === c.id"
                                                        (click)="onCapsuleSelected(c.id)"
                                                        class="w-full text-left px-2.5 py-2 rounded-lg text-[12px] flex items-center justify-between gap-2 transition-colors cursor-pointer"
                                                        [class.bg-(--postonsteroids-accent)/12]="selectedCapsuleId() === c.id"
                                                        [class.text-(--postonsteroids-accent)]="selectedCapsuleId() === c.id"
                                                        [class.font-semibold]="selectedCapsuleId() === c.id"
                                                        [class.text-(--postonsteroids-text-primary)]="selectedCapsuleId() !== c.id"
                                                        [class.hover:bg-(--postonsteroids-bg-hover)]="selectedCapsuleId() !== c.id">
                                                    <div class="flex items-center gap-2 min-w-0">
                                                        <mat-icon class="text-[15px]! size-[15px]! shrink-0 opacity-75">inventory_2</mat-icon>
                                                        <span class="truncate">{{ c.name }}</span>
                                                    </div>
                                                    <div class="flex items-center gap-1.5 shrink-0">
                                                        @if (c.isLocalOnly) {
                                                            <span class="text-[9.5px] px-1.5 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) text-(--postonsteroids-text-muted) border border-(--postonsteroids-border)/70">
                                                                Local
                                                            </span>
                                                        }
                                                        @if (selectedCapsuleId() === c.id) {
                                                            <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-accent)">check</mat-icon>
                                                        }
                                                    </div>
                                                </button>
                                            }
                                        </div>
                                    }
                                    <div class="p-1.5 bg-(--postonsteroids-bg-tertiary)/40"
                                         [class.border-t]="otherCapsules().length > 0"
                                         [class.border-(--postonsteroids-border)/70]="otherCapsules().length > 0">
                                        <button type="button"
                                                role="option"
                                                [attr.aria-selected]="selectedCapsuleId() === '__new__'"
                                                (click)="onCapsuleSelected('__new__')"
                                                class="w-full text-left px-2.5 py-2 rounded-lg text-[12px] font-semibold flex items-center justify-between gap-2 transition-colors cursor-pointer text-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent)/10"
                                                [class.bg-(--postonsteroids-accent)/12]="selectedCapsuleId() === '__new__'">
                                            <div class="flex items-center gap-2">
                                                <mat-icon class="text-[15px]! size-[15px]!">add</mat-icon>
                                                <span>Create New Capsule...</span>
                                            </div>
                                            @if (selectedCapsuleId() === '__new__') {
                                                <mat-icon class="text-[15px]! size-[15px]!">check</mat-icon>
                                            }
                                        </button>
                                    </div>
                                </div>
                            }
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
                                       class="w-full h-9.5 px-3 rounded-xl bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) text-[12.5px] outline-none focus:border-(--postonsteroids-accent)" />
                            </div>
                        }

                        <!-- Destination Folder (Stable height, sleek dropdown) -->
                        @if (selectedCapsuleId() !== '__new__') {
                            <div class="relative" (click)="$event.stopPropagation()">
                                <label class="block text-[12px] font-semibold text-(--postonsteroids-text-secondary) mb-1.5">
                                    Destination Folder (Optional)
                                </label>
                                <button type="button"
                                        (click)="toggleFolderDropdown()"
                                        [disabled]="isSubmitting() || targetGroups().length === 0"
                                        aria-haspopup="listbox"
                                        [attr.aria-expanded]="isFolderDropdownOpen()"
                                        class="w-full h-9.5 px-3 rounded-xl bg-(--postonsteroids-bg-tertiary) border text-(--postonsteroids-text-primary) text-[12.5px] flex items-center justify-between gap-2 transition-colors disabled:cursor-default"
                                        [class.cursor-pointer]="targetGroups().length > 0"
                                        [class.border-(--postonsteroids-accent)]="isFolderDropdownOpen()"
                                        [class.border-(--postonsteroids-border)]="!isFolderDropdownOpen()"
                                        [class.hover:border-(--postonsteroids-accent)/50]="!isFolderDropdownOpen() && targetGroups().length > 0">
                                    <div class="flex items-center gap-2 min-w-0">
                                        <mat-icon class="text-[16px]! size-[16px]! shrink-0 text-(--postonsteroids-text-muted)">
                                            {{ targetGroupId() ? 'folder' : 'folder_open' }}
                                        </mat-icon>
                                        <span class="truncate font-medium"
                                              [class.text-(--postonsteroids-text-muted)]="!targetGroupId()">
                                            {{ selectedFolderLabel() }}
                                        </span>
                                    </div>
                                    <div class="flex items-center gap-1.5 shrink-0">
                                        @if (isLoadingGroups()) {
                                            <mat-icon class="text-[14px]! size-[14px]! animate-spin text-(--postonsteroids-accent)">progress_activity</mat-icon>
                                        } @else if (targetGroups().length === 0) {
                                            <span class="text-[10.5px] text-(--postonsteroids-text-muted)">No folders</span>
                                        }
                                        @if (targetGroups().length > 0) {
                                            <mat-icon class="text-[17px]! size-[17px]! text-(--postonsteroids-text-muted) transition-transform duration-150"
                                                      [class.rotate-180]="isFolderDropdownOpen()">
                                                expand_more
                                            </mat-icon>
                                        }
                                    </div>
                                </button>

                                @if (isFolderDropdownOpen() && targetGroups().length > 0) {
                                    <div role="listbox"
                                         class="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) shadow-2xl overflow-hidden animate-in fade-in duration-100">
                                        <div class="pt-2 pb-1.5 px-1.5 max-h-44 overflow-y-auto sidebar-scroll space-y-0.5">
                                            <button type="button"
                                                    role="option"
                                                    [attr.aria-selected]="!targetGroupId()"
                                                    (click)="onFolderSelected('')"
                                                    class="w-full text-left px-2.5 py-2 rounded-lg text-[12px] flex items-center justify-between gap-2 transition-colors cursor-pointer"
                                                    [class.bg-(--postonsteroids-accent)/12]="!targetGroupId()"
                                                    [class.text-(--postonsteroids-accent)]="!targetGroupId()"
                                                    [class.font-semibold]="!targetGroupId()"
                                                    [class.text-(--postonsteroids-text-primary)]="!!targetGroupId()"
                                                    [class.hover:bg-(--postonsteroids-bg-hover)]="!!targetGroupId()">
                                                <div class="flex items-center gap-2 min-w-0">
                                                    <mat-icon class="text-[15px]! size-[15px]! shrink-0 opacity-75">folder_open</mat-icon>
                                                    <span class="truncate">Capsule Root (No Folder)</span>
                                                </div>
                                                @if (!targetGroupId()) {
                                                    <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-accent) shrink-0">check</mat-icon>
                                                }
                                            </button>

                                            <div class="h-px bg-(--postonsteroids-border)/50 my-1 mx-1"></div>

                                            @for (g of targetGroups(); track g.id) {
                                                <button type="button"
                                                        role="option"
                                                        [attr.aria-selected]="targetGroupId() === g.id"
                                                        (click)="onFolderSelected(g.id)"
                                                        class="w-full text-left px-2.5 py-2 rounded-lg text-[12px] flex items-center justify-between gap-2 transition-colors cursor-pointer"
                                                        [class.bg-(--postonsteroids-accent)/12]="targetGroupId() === g.id"
                                                        [class.text-(--postonsteroids-accent)]="targetGroupId() === g.id"
                                                        [class.font-semibold]="targetGroupId() === g.id"
                                                        [class.text-(--postonsteroids-text-primary)]="targetGroupId() !== g.id"
                                                        [class.hover:bg-(--postonsteroids-bg-hover)]="targetGroupId() !== g.id">
                                                    <div class="flex items-center gap-2 min-w-0">
                                                        <mat-icon class="text-[15px]! size-[15px]! shrink-0 text-amber-500">folder</mat-icon>
                                                        <span class="truncate">{{ g.name }}</span>
                                                    </div>
                                                    <div class="flex items-center gap-1.5 shrink-0">
                                                        <span class="text-[10px] text-(--postonsteroids-text-muted)">{{ g.requestIds.length }}</span>
                                                        @if (targetGroupId() === g.id) {
                                                            <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-accent)">check</mat-icon>
                                                        }
                                                    </div>
                                                </button>
                                            }
                                        </div>
                                    </div>
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
                    <div class="px-5 py-3.5 rounded-b-2xl bg-(--postonsteroids-bg-tertiary)/40 border-t border-(--postonsteroids-border) flex items-center justify-end gap-2.5">
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
    isCapsuleDropdownOpen = signal<boolean>(false);
    isFolderDropdownOpen = signal<boolean>(false);
    isSubmitting = signal<boolean>(false);
    errorMsg = signal<string | null>(null);

    private wasOpen = false;
    private groupLoadSeq = 0;

    sourceCapsuleName = computed(() => this.tabStateService.activeCapsuleName() || 'Current Capsule');
    otherCapsules = computed(() =>
        this.tabStateService.capsules().filter(c => c.id !== this.tabStateService.activeCapsuleId())
    );

    selectedCapsuleLabel = computed(() => {
        const id = this.selectedCapsuleId();
        if (id === '__new__') return '+ Create New Capsule...';
        return this.otherCapsules().find(c => c.id === id)?.name || 'Select a capsule...';
    });

    selectedFolderLabel = computed(() => {
        const gId = this.targetGroupId();
        if (!gId) return 'Capsule Root (No Folder)';
        return this.targetGroups().find(g => g.id === gId)?.name || 'Capsule Root (No Folder)';
    });

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
            const open = this.isOpen();
            if (open && !this.wasOpen) {
                this.wasOpen = true;
                untracked(() => this.initializeOnOpen());
            } else if (!open && this.wasOpen) {
                this.wasOpen = false;
                untracked(() => this.resetTransientUi());
            }
        });
    }

    private initializeOnOpen(): void {
        this.mode.set(this.initialMode());
        this.errorMsg.set(null);
        this.targetGroupId.set('');
        this.newCapsuleName.set('');
        this.closeDropdowns();
        const others = this.otherCapsules();
        const initialTarget = others.length > 0 ? others[0].id : '__new__';
        this.selectedCapsuleId.set(initialTarget);
        if (initialTarget !== '__new__') {
            void this.loadGroups(initialTarget);
        } else {
            this.targetGroups.set([]);
            this.isLoadingGroups.set(false);
        }
    }

    private resetTransientUi(): void {
        this.groupLoadSeq++;
        this.isLoadingGroups.set(false);
        this.closeDropdowns();
    }

    setMode(nextMode: 'copy' | 'move'): void {
        if (this.isSubmitting()) return;
        this.mode.set(nextMode);
        this.closeDropdowns();
    }

    closeDropdowns(): void {
        this.isCapsuleDropdownOpen.set(false);
        this.isFolderDropdownOpen.set(false);
    }

    toggleCapsuleDropdown(): void {
        if (this.isSubmitting()) return;
        const next = !this.isCapsuleDropdownOpen();
        this.isFolderDropdownOpen.set(false);
        this.isCapsuleDropdownOpen.set(next);
    }

    toggleFolderDropdown(): void {
        if (this.isSubmitting() || this.targetGroups().length === 0) return;
        const next = !this.isFolderDropdownOpen();
        this.isCapsuleDropdownOpen.set(false);
        this.isFolderDropdownOpen.set(next);
    }

    onEscape(event: Event): void {
        if (!this.isOpen() || this.isSubmitting()) return;
        event.preventDefault();
        if (this.isCapsuleDropdownOpen() || this.isFolderDropdownOpen()) {
            this.closeDropdowns();
            return;
        }
        this.close();
    }

    onCapsuleSelected(capsuleId: string): void {
        this.isCapsuleDropdownOpen.set(false);
        this.isFolderDropdownOpen.set(false);
        this.selectedCapsuleId.set(capsuleId);
        this.targetGroupId.set('');
        this.errorMsg.set(null);
        if (capsuleId && capsuleId !== '__new__') {
            void this.loadGroups(capsuleId);
        } else {
            this.groupLoadSeq++;
            this.targetGroups.set([]);
            this.isLoadingGroups.set(false);
        }
    }

    onFolderSelected(groupId: string): void {
        this.targetGroupId.set(groupId);
        this.isFolderDropdownOpen.set(false);
    }

    private async loadGroups(capsuleId: string): Promise<void> {
        const seq = ++this.groupLoadSeq;
        // Fast-path: populate synchronously known groups immediately without flickering spinner
        const cached = this.tabStateService.getGroupsForCapsule(capsuleId);
        this.targetGroups.set(cached);
        if (cached.length > 0) {
            this.isLoadingGroups.set(false);
            return;
        }

        this.isLoadingGroups.set(true);
        try {
            const groups = await this.tabStateService.loadGroupsForCapsule(capsuleId);
            if (seq === this.groupLoadSeq && this.selectedCapsuleId() === capsuleId) {
                this.targetGroups.set(groups);
            }
        } catch {
            if (seq === this.groupLoadSeq && this.selectedCapsuleId() === capsuleId) {
                this.targetGroups.set([]);
            }
        } finally {
            if (seq === this.groupLoadSeq) {
                this.isLoadingGroups.set(false);
            }
        }
    }

    close(): void {
        if (this.isSubmitting()) return;
        this.closeDropdowns();
        this.closed.emit();
    }

    async submit(): Promise<void> {
        if (!this.canSubmit() || this.isSubmitting()) return;
        this.closeDropdowns();
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
