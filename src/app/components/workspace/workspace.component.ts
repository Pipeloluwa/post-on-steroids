import { Component, signal, computed, inject, effect, PLATFORM_ID, ViewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RequestTabsComponent } from './request-tabs.component/request-tabs.component';
import { RequestDetailsComponent } from './request-details.component/request-details.component';
import { RequestUrlComponent } from './request-url.component/request-url.component';
import { PayloadTypesComponent } from './payload.types.component/payload.types.component';
import { CreateCapsuleModalComponent } from '../../shared/components/create-capsule.modal.component/create-capsule.modal.component';
import { TransferCapsuleModalComponent } from '../../shared/components/transfer-capsule.modal.component';
import { CurlModalComponent } from '../../shared/components/curl-modal.component';

import { ResponseViewerComponent } from './response-viewer.component/response-viewer.component';
import { MatIcon } from '@angular/material/icon';
import { AuthService } from '../../shared/services/auth.service';
import { NotificationService } from '../../shared/services/notification.service';
import { LocalStorageService } from '../../shared/services/local.storage.service';
import { TabStateService, RequestGroup, RequestState } from '../../shared/services/tab.state.service';
import { DialogService } from '../../shared/services/dialog.service';
import { getHttpMethodColor } from '../../shared/utils/http-method.util';
import { RequestExecutionService } from '../../shared/services/request.execution.service';
import { TerminalService } from '../../shared/services/terminal.service';

@Component({
    selector: 'app-workspace',
    imports: [
        CommonModule,
        FormsModule,
        RequestTabsComponent,
        RequestDetailsComponent,
        RequestUrlComponent,
        PayloadTypesComponent,
        ResponseViewerComponent,
        CreateCapsuleModalComponent,
        TransferCapsuleModalComponent,
        CurlModalComponent,
        MatIcon
    ],
    templateUrl: './workspace.component.html',
    styleUrl: './workspace.component.css',
    host: {
        '(document:pointermove)': 'onPointerMove($event)',
        '(document:mousemove)': 'onMouseMove($event)',
        '(document:mouseup)': 'onMouseUp()',
        '(window:blur)': 'clearTreeDragState()',
        '(document:click)': 'onDocumentClick()',
        '(document:keydown)': 'handleKeyboardShortcuts($event)',
        '(window:beforeunload)': 'onBeforeUnload($event)',
        '(window:resize)': 'onWindowResize()'
    }
})
export class WorkspaceComponent {
    private localStorageService = inject(LocalStorageService);
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);

    authService = inject(AuthService);
    notificationService = inject(NotificationService);
    tabStateService = inject(TabStateService);
    dialogService = inject(DialogService);
    private executionService = inject(RequestExecutionService);
    private terminalService = inject(TerminalService);

    requestHeight = signal<number>(450); // Pixel height
    isResizing = signal<boolean>(false);

    sidebarWidth = signal<number>(250); // Pixel width
    isResizingSidebar = signal<boolean>(false);

    isSidebarOpen = signal<boolean>(true);

    constructor() {
        const savedHeight = this.localStorageService.getItem(LocalStorageService.JSON_RESIZE_HEIGHT);
        if (savedHeight) {
            const height = parseInt(savedHeight, 10);
            if (!isNaN(height)) {
                this.requestHeight.set(this.clampHeight(height));
            }
        } else if (this.isBrowser) {
            const sensibleDefault = Math.max(160, Math.min(450, Math.floor((window.innerHeight - 200) * 0.52)));
            this.requestHeight.set(sensibleDefault);
        }

        const savedSidebarWidth = this.localStorageService.getItem(LocalStorageService.SIDEBAR_RESIZE_WIDTH);
        if (savedSidebarWidth) {
            const width = parseInt(savedSidebarWidth, 10);
            if (!isNaN(width)) {
                this.sidebarWidth.set(this.clampSidebarWidth(width));
            }
        }

        let prevCapId: string | null = this.tabStateService.activeCapsuleId();
        effect(() => {
            const currentCapId = this.tabStateService.activeCapsuleId();
            if (prevCapId !== currentCapId) {
                prevCapId = currentCapId;
                this.selectedGroupIds.set(new Set());
                this.selectedRequestIds.set(new Set());
                this.lastSelectedRequestId.set(null);
            }
        });

        if (this.isBrowser) {
            const savedSidebarOpen = localStorage.getItem('onsteroids_workspace_sidebar_open');
            if (savedSidebarOpen !== null) {
                this.isSidebarOpen.set(savedSidebarOpen !== 'false');
            }

            const savedExpandedList = localStorage.getItem('onsteroids_expanded_example_reqs');
            if (savedExpandedList) {
                try {
                    const parsed = JSON.parse(savedExpandedList);
                    if (Array.isArray(parsed)) {
                        this.expandedExampleRequestIds.set(new Set(parsed));
                        if (parsed.length > 0) {
                            this.expandedExampleRequestId.set(parsed[parsed.length - 1]);
                        }
                        for (const reqId of parsed) {
                            this.tabStateService.getExamples(reqId).catch(() => {});
                        }
                    }
                } catch { }
            } else {
                const savedExpanded = localStorage.getItem('onsteroids_expanded_example_req');
                if (savedExpanded) {
                    this.expandedExampleRequestId.set(savedExpanded);
                    this.expandedExampleRequestIds.set(new Set([savedExpanded]));
                    this.tabStateService.getExamples(savedExpanded).catch(() => {});
                }
            }
        }
    }

    onWindowResize() {
        if (!this.isBrowser) return;
        this.requestHeight.update(h => this.clampHeight(h));
        this.sidebarWidth.update(w => this.clampSidebarWidth(w));
    }

    private clampHeight(height: number): number {
        const minHeight = 100; // Decreased to allow pulling the divider further up
        const screenHeight = this.isBrowser ? window.innerHeight : 1000;
        const maxHeight = Math.max(minHeight, screenHeight - 200);
        return Math.max(minHeight, Math.min(height, maxHeight));
    }

    private clampSidebarWidth(width: number): number {
        const minWidth = 160;
        const screenWidth = this.isBrowser ? window.innerWidth : 1200;
        const maxWidth = Math.max(minWidth, Math.min(600, screenWidth - 450));
        return Math.max(minWidth, Math.min(width, maxWidth));
    }

    startResizing(event: MouseEvent) {
        event.preventDefault();
        this.isResizing.set(true);
    }

    startResizingSidebar(event: MouseEvent) {
        event.preventDefault();
        this.isResizingSidebar.set(true);
    }

    lastPointerX = 0;
    lastPointerY = 0;

    onPointerMove(event: PointerEvent) {
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
    }

    onMouseMove(event: MouseEvent) {
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;

        if (this.pendingTreeDrag && this.isBrowser) {
            const dx = event.clientX - this.pendingTreeDrag.startX;
            const dy = event.clientY - this.pendingTreeDrag.startY;
            if (Math.hypot(dx, dy) >= this.TREE_DRAG_THRESHOLD_PX) {
                this.activatePendingTreeDrag(event.clientX, event.clientY);
            }
        }

        if ((this.isDraggingRequest() || this.isDraggingFolder()) && this.isBrowser) {
            this.dragGhostPos.set({ x: event.clientX, y: event.clientY });
            this.updateDragHoverTarget(event.clientX, event.clientY);
            this.autoScrollSidebarDuringDrag(event.clientY);
            return;
        }

        if (!this.isResizing() && !this.isResizingSidebar()) return;

        const container = document.querySelector('.workspace-container');
        if (container) {
            const rect = container.getBoundingClientRect();
            if (this.isResizing()) {
                const tabHeight = 32;
                const newHeight = event.clientY - rect.top - tabHeight;
                this.requestHeight.set(this.clampHeight(newHeight));
            }
            if (this.isResizingSidebar()) {
                const newWidth = event.clientX - rect.left;
                this.sidebarWidth.set(this.clampSidebarWidth(newWidth));
            }
        }
    }

    onMouseUp() {
        this.pendingTreeDrag = null;
        if (this.isDraggingRequest() || this.isDraggingFolder()) {
            this.commitTreeDragDrop();
        }
        if (this.isResizing()) {
            this.isResizing.set(false);
            this.localStorageService.setItem(LocalStorageService.JSON_RESIZE_HEIGHT, this.requestHeight().toString());
        }
        if (this.isResizingSidebar()) {
            this.isResizingSidebar.set(false);
            this.localStorageService.setItem(LocalStorageService.SIDEBAR_RESIZE_WIDTH, this.sidebarWidth().toString());
        }
    }

    triggerNotification(message: string) {
        this.notificationService.notify(message);
    }

    toggleAuthModal() {
        this.authService.openAuthModal();
    }

    toggleSidebar() {
        this.isSidebarOpen.update(v => {
            const next = !v;
            if (this.isBrowser) {
                localStorage.setItem('onsteroids_workspace_sidebar_open', String(next));
            }
            return next;
        });
    }

    @ViewChild('createCapsuleModal') createCapsuleModal?: CreateCapsuleModalComponent;

    async onCapsuleChange(capsuleId: string) {
        if (capsuleId === '__create_new__') {
            this.createCapsuleModal?.open();
            return;
        }
        const capsule = this.tabStateService.capsules().find(c => c.id === capsuleId);
        if (capsule) {
            await this.tabStateService.switchCapsule(capsule);
        }
    }

    isDuplicatingCapsule = signal<boolean>(false);
    isEditingCapsuleName = signal<boolean>(false);
    editingCapsuleName = signal<string>('');

    startEditingCapsuleName(event?: Event): void {
        event?.stopPropagation();
        const activeCapsule = this.tabStateService.capsules().find(c => c.id === this.tabStateService.activeCapsuleId());
        if (!activeCapsule) return;
        this.editingCapsuleName.set(activeCapsule.name);
        this.isEditingCapsuleName.set(true);
    }

    async saveCapsuleName(event?: Event): Promise<void> {
        event?.stopPropagation();
        if (!this.isEditingCapsuleName()) return;
        const activeCapsuleId = this.tabStateService.activeCapsuleId();
        const newName = this.editingCapsuleName().trim();
        if (activeCapsuleId && newName) {
            try {
                await this.tabStateService.renameCapsule(activeCapsuleId, newName);
                this.notificationService.notify(`Capsule renamed to "${newName}".`);
            } catch (e: any) {
                this.notificationService.notify(e?.message || 'Failed to rename capsule.');
            }
        }
        this.isEditingCapsuleName.set(false);
    }

    cancelEditingCapsuleName(event?: Event): void {
        event?.stopPropagation();
        this.isEditingCapsuleName.set(false);
    }

    async duplicateCurrentCapsule() {
        if (this.isDuplicatingCapsule()) return;
        const activeCapsuleId = this.tabStateService.activeCapsuleId();
        const activeCapsule = this.tabStateService.capsules().find(c => c.id === activeCapsuleId);
        if (!activeCapsule) {
            this.notificationService.notify('No active capsule found to duplicate.');
            return;
        }

        this.isDuplicatingCapsule.set(true);
        try {
            const duplicated = await this.tabStateService.duplicateCapsule(activeCapsule);
            await this.tabStateService.switchCapsule(duplicated);
            this.notificationService.notify(`Capsule "${activeCapsule.name}" duplicated as "${duplicated.name}".`);
        } catch (e: any) {
            console.error('Failed to duplicate capsule:', e);
            this.notificationService.notify(e?.message || 'Failed to duplicate capsule.');
        } finally {
            this.isDuplicatingCapsule.set(false);
        }
    }

    openCreateCapsuleModal() {
        this.createCapsuleModal?.open();
    }

    getShortMethod(method: string): string {
        const upper = (method || 'GET').toUpperCase();
        if (upper === 'DELETE') return 'DEL';
        if (upper === 'OPTIONS') return 'OPT';
        return upper;
    }

    getMethodColor(method: string): string {
        return getHttpMethodColor(method);
    }

    // Folder / Group & Drag state
    editingGroupId = signal<string | null>(null);
    editingGroupName = signal<string>('');
    moveMenuRequestId = signal<string | null>(null);
    groupSelectionMenuOpen = signal<boolean>(false);
    customGroupName = signal<string>('');
    folderContextMenu = signal<{
        isOpen: boolean;
        x: number;
        y: number;
        group: RequestGroup | null;
        requestCount: number;
    }>({ isOpen: false, x: 0, y: 0, group: null, requestCount: 0 });
    isTransferModalOpen = signal<boolean>(false);
    transferRequestIds = signal<string[]>([]);
    transferFolder = signal<RequestGroup | null>(null);
    transferInitialMode = signal<'copy' | 'move'>('copy');
    curlModalRequest = signal<RequestState | null>(null);

    // Request rename & sidebar right-click context menu state
    editingRequestId = signal<string | null>(null);
    editingRequestName = signal<string>('');
    sidebarContextMenu = signal<{
        isOpen: boolean;
        x: number;
        y: number;
        req: RequestState | null;
        groupId: string | null;
    }>({ isOpen: false, x: 0, y: 0, req: null, groupId: null });

    openSidebarRequestContextMenu(req: RequestState, groupId: string | null, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.moveMenuRequestId.set(null);
        this.groupSelectionMenuOpen.set(false);
        this.closeFolderContextMenu();
        const viewportW = this.isBrowser ? window.innerWidth : 1280;
        const viewportH = this.isBrowser ? window.innerHeight : 800;
        const menuW = 292;
        const menuH = 380;
        const x = Math.max(8, Math.min(event.clientX, viewportW - menuW - 8));
        const y = Math.max(8, Math.min(event.clientY, viewportH - menuH - 8));
        this.sidebarContextMenu.set({
            isOpen: true,
            x,
            y,
            req,
            groupId: groupId ?? req.groupId ?? null
        });
    }

    openFolderContextMenu(group: RequestGroup, requestCount: number, event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.closeSidebarRequestContextMenu();
        this.groupSelectionMenuOpen.set(false);
        const viewportW = this.isBrowser ? window.innerWidth : 1280;
        const viewportH = this.isBrowser ? window.innerHeight : 800;
        const menuW = 292;
        const menuH = 340;
        const x = Math.max(8, Math.min(event.clientX, viewportW - menuW - 8));
        const y = Math.max(8, Math.min(event.clientY, viewportH - menuH - 8));
        this.folderContextMenu.set({ isOpen: true, x, y, group, requestCount });
    }

    closeFolderContextMenu(): void {
        if (this.folderContextMenu().isOpen) {
            this.folderContextMenu.set({ isOpen: false, x: 0, y: 0, group: null, requestCount: 0 });
        }
    }

    availableParentFoldersForMenu = computed<RequestGroup[]>(() => {
        const grp = this.folderContextMenu().group;
        if (!grp) return [];
        const descendants = new Set(this.tabStateService.getDescendantGroupIds([grp.id]));
        return this.tabStateService.activeCapsuleGroups().filter(g => !descendants.has(g.id));
    });

    contextCreateSubfolder(event: Event): void {
        const grp = this.folderContextMenu().group;
        this.closeFolderContextMenu();
        if (grp) this.createSubfolder(grp.id, event);
    }

    contextMoveFolderToParent(parentId: string | null, event: Event): void {
        event.stopPropagation();
        const grp = this.folderContextMenu().group;
        this.closeFolderContextMenu();
        if (!grp) return;
        const ok = this.tabStateService.moveGroupToParentGroup(grp.id, parentId);
        if (ok) {
            this.scrollFolderIntoView(grp.id);
        }
    }

    contextRenameFolder(event: Event): void {
        const grp = this.folderContextMenu().group;
        this.closeFolderContextMenu();
        if (grp) this.startEditingGroup(grp, event);
    }

    contextUngroupFolder(event: Event): void {
        const ctx = this.folderContextMenu();
        this.closeFolderContextMenu();
        if (ctx.group) void this.ungroupFolder(ctx.group, event);
    }

    contextDeleteFolder(event: Event): void {
        const ctx = this.folderContextMenu();
        this.closeFolderContextMenu();
        if (ctx.group) void this.deleteFolder(ctx.group, ctx.requestCount, event);
    }

    closeSidebarRequestContextMenu(): void {
        if (this.sidebarContextMenu().isOpen) {
            this.sidebarContextMenu.set({ isOpen: false, x: 0, y: 0, req: null, groupId: null });
        }
    }

    contextOpenRequest(event: Event): void {
        event.stopPropagation();
        const req = this.sidebarContextMenu().req;
        this.closeSidebarRequestContextMenu();
        if (req) this.openRequest(req);
    }

    contextDuplicateRequest(event: Event): void {
        const req = this.sidebarContextMenu().req;
        this.closeSidebarRequestContextMenu();
        if (req) this.duplicateRequestFromSidebar(req.id, event);
    }

    contextRenameRequest(event: Event): void {
        const req = this.sidebarContextMenu().req;
        this.closeSidebarRequestContextMenu();
        if (req) this.startEditingRequest(req, event);
    }

    contextMoveToGroup(targetGroupId: string | null, event: Event): void {
        const req = this.sidebarContextMenu().req;
        this.closeSidebarRequestContextMenu();
        if (req) this.moveRequestToGroupFromMenu(req.id, targetGroupId, event);
    }

    contextMoveToNewGroup(event: Event): void {
        const req = this.sidebarContextMenu().req;
        this.closeSidebarRequestContextMenu();
        if (req) this.moveRequestToNewGroupFromMenu(req.id, event);
    }

    contextTransferCapsule(mode: 'copy' | 'move', event: Event): void {
        const req = this.sidebarContextMenu().req;
        this.closeSidebarRequestContextMenu();
        if (req) this.openTransferModalForRequest(req.id, mode, event);
    }

    contextOpenCurl(event: Event): void {
        const req = this.sidebarContextMenu().req;
        this.closeSidebarRequestContextMenu();
        if (req) this.openCurlModalFromMenu(req, event);
    }

    contextDeleteRequest(event: Event): void {
        const req = this.sidebarContextMenu().req;
        this.closeSidebarRequestContextMenu();
        if (req) void this.deleteRequestFromSidebar(req, event);
    }

    startEditingRequest(req: RequestState, event?: Event): void {
        event?.stopPropagation();
        this.editingRequestId.set(req.id);
        this.editingRequestName.set(req.name || '');
        this.tabStateService.setFocusedSidebarItem(null);
        if (this.isBrowser) {
            setTimeout(() => {
                const inputEl = document.querySelector<HTMLInputElement>(`[data-request-rename-input="${req.id}"]`);
                inputEl?.focus();
                inputEl?.select();
            }, 0);
        }
    }

    onRequestFocusTriggerBlur(reqId: string, event: FocusEvent): void {
        const nextFocused = event.relatedTarget as HTMLElement | null;
        if (nextFocused && nextFocused.closest(`[data-request-row-id="${reqId}"]`)) {
            return;
        }
        const currentFocus = this.tabStateService.focusedSidebarItem();
        if (currentFocus?.type === 'request' && currentFocus.id === reqId) {
            this.tabStateService.setFocusedSidebarItem(null);
        }
    }

    saveRequestName(reqId: string, event?: Event): void {
        event?.stopPropagation();
        if (this.editingRequestId() !== reqId) return;
        const newName = this.editingRequestName().trim();
        if (newName) {
            this.tabStateService.renameRequest(reqId, newName);
        }
        this.editingRequestId.set(null);
    }

    cancelEditingRequest(event?: Event): void {
        event?.stopPropagation();
        this.editingRequestId.set(null);
    }

    duplicateRequestFromSidebar(reqId: string, event?: Event): void {
        event?.stopPropagation();
        this.tabStateService.duplicateTab(reqId);
    }

    openTransferModalForFolder(group: RequestGroup, mode: 'copy' | 'move', event: Event): void {
        event.stopPropagation();
        this.transferFolder.set(group);
        this.transferRequestIds.set([]);
        this.transferInitialMode.set(mode);
        this.isTransferModalOpen.set(true);
    }

    lastSelectedRequestId = signal<string | null>(null);
    private readonly TREE_DRAG_THRESHOLD_PX = 8;
    private justFinishedTreeDrag = false;
    private pendingTreeDrag: {
        type: 'request' | 'group';
        id: string;
        groupId: string | null;
        startX: number;
        startY: number;
        req?: RequestState;
        group?: RequestGroup;
    } | null = null;

    isDraggingRequest = signal<boolean>(false);
    isDraggingFolder = signal<boolean>(false);
    draggedGroupId = signal<string | null>(null);
    draggedRequestIds = signal<string[]>([]);
    draggedSourceGroupId = signal<string | null>(null);
    dragGhostPos = signal<{ x: number; y: number } | null>(null);
    dragGhostLabel = signal<string>('');
    dragGhostMethod = signal<string | null>(null);

    dragDropTarget = signal<{
        targetType: 'root-top' | 'root-bottom' | 'group' | 'request';
        targetId: string | null;
        position: 'before' | 'inside' | 'after';
    } | null>(null);

    hoveredFolderIdDuringDrag = computed<string | null>(() => {
        const dt = this.dragDropTarget();
        return dt && dt.targetType === 'group' && dt.position === 'inside' ? dt.targetId : null;
    });

    hoveredFolderName = computed<string | null>(() => {
        const fId = this.hoveredFolderIdDuringDrag();
        if (!fId) return null;
        return this.tabStateService.activeCapsuleGroups().find(g => g.id === fId)?.name || null;
    });

    onTreeItemMouseDown(
        type: 'request' | 'group',
        item: RequestState | RequestGroup,
        groupId: string | null,
        event: MouseEvent
    ): void {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, [data-skip-drag="true"]')) {
            return;
        }
        if (type === 'group' && this.editingGroupId() === item.id) return;
        if (type === 'request' && this.editingRequestId() === item.id) return;
        this.pendingTreeDrag = {
            type,
            id: item.id,
            groupId,
            startX: event.clientX,
            startY: event.clientY,
            req: type === 'request' ? (item as RequestState) : undefined,
            group: type === 'group' ? (item as RequestGroup) : undefined
        };
    }

    private activatePendingTreeDrag(x: number, y: number): void {
        const p = this.pendingTreeDrag;
        this.pendingTreeDrag = null;
        if (!p) return;

        if (this.isBrowser) {
            window.getSelection()?.removeAllRanges?.();
        }

        if (p.type === 'group' && p.group) {
            this.draggedGroupId.set(p.group.id);
            this.draggedSourceGroupId.set(p.group.parentGroupId ?? null);
            this.dragGhostLabel.set(p.group.name || 'Folder');
            this.dragGhostMethod.set(null);
            this.isDraggingFolder.set(true);
        } else if (p.type === 'request' && p.req) {
            const effectiveIds = this.getEffectiveIdsForAction(p.req.id);
            this.draggedRequestIds.set(effectiveIds);
            this.draggedSourceGroupId.set(p.groupId ?? p.req.groupId ?? null);
            if (effectiveIds.length > 1) {
                this.dragGhostLabel.set(`Move ${effectiveIds.length} requests`);
                this.dragGhostMethod.set(null);
            } else {
                this.dragGhostLabel.set(this.tabStateService.resolveRequestTitle(p.req.name, p.req.url));
                this.dragGhostMethod.set(this.getShortMethod(p.req.method));
            }
            this.isDraggingRequest.set(true);
        }

        this.dragGhostPos.set({ x, y });
        this.updateDragHoverTarget(x, y);
    }

    private findElementAttrAtPoint(
        selector: string,
        attr: string,
        x: number,
        y: number,
        padX = 0,
        padTop = 0,
        padBottom = 0,
        excludeGroupIds?: Set<string>
    ): string | null {
        if (!this.isBrowser) return null;
        const elements = Array.from(document.querySelectorAll<HTMLElement>(selector)).reverse();
        for (const el of elements) {
            const val = el.getAttribute(attr);
            if (!val) continue;
            if (excludeGroupIds && excludeGroupIds.has(val)) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (
                x >= rect.left - padX &&
                x <= rect.right + padX &&
                y >= rect.top - padTop &&
                y <= rect.bottom + padBottom
            ) {
                return val;
            }
        }
        return null;
    }

    private updateDragHoverTarget(x: number, y: number): void {
        if ((!this.isDraggingRequest() && !this.isDraggingFolder()) || !this.isBrowser) return;
        this.lastPointerX = x;
        this.lastPointerY = y;

        const draggedGrp = this.isDraggingFolder() ? this.draggedGroupId() : null;
        const excludeIds = draggedGrp
            ? new Set(this.tabStateService.getDescendantGroupIds([draggedGrp]))
            : undefined;

        const scrollContainer = document.querySelector<HTMLElement>('[data-sidebar-scroll]');
        if (scrollContainer) {
            const cRect = scrollContainer.getBoundingClientRect();
            if (x < cRect.left - 24 || x > cRect.right + 24 || y < cRect.top - 12 || y > cRect.bottom + 24) {
                this.dragDropTarget.set(null);
                return;
            }
        }

        // Topmost root drop slot above first folder/request
        const topSlotEl = document.getElementById('sidebar-root-top-slot');
        if (topSlotEl) {
            const topRect = topSlotEl.getBoundingClientRect();
            if (y <= topRect.bottom + 3) {
                this.dragDropTarget.set({ targetType: 'root-top', targetId: null, position: 'before' });
                return;
            }
        }

        // Scan visible stacked tree rows (folders and requests) without overlapping placeholders
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-tree-row]'));
        let matchedRow: HTMLElement | null = null;
        let closestRow: HTMLElement | null = null;
        let closestDist = Infinity;

        for (const row of rows) {
            const rect = row.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (y >= rect.top - 2 && y <= rect.bottom + 2) {
                matchedRow = row;
                break;
            }
            const mid = (rect.top + rect.bottom) / 2;
            const dist = Math.abs(y - mid);
            if (dist < closestDist) {
                closestDist = dist;
                closestRow = row;
            }
        }

        const targetRow = matchedRow || (closestDist <= 14 ? closestRow : null);
        if (targetRow) {
            const tType = targetRow.getAttribute('data-tree-type');
            const tId = targetRow.getAttribute('data-tree-id');
            const rect = targetRow.getBoundingClientRect();
            const relY = Math.max(0, Math.min(1, (y - rect.top) / Math.max(rect.height, 1)));

            if (tType === 'group' && tId) {
                if (excludeIds?.has(tId)) {
                    this.dragDropTarget.set(null);
                    return;
                }
                const isExpanded = targetRow.getAttribute('data-folder-expanded') !== 'false';
                if (relY <= 0.24) {
                    this.dragDropTarget.set({ targetType: 'group', targetId: tId, position: 'before' });
                } else if (!isExpanded && relY >= 0.78) {
                    this.dragDropTarget.set({ targetType: 'group', targetId: tId, position: 'after' });
                } else {
                    this.dragDropTarget.set({ targetType: 'group', targetId: tId, position: 'inside' });
                }
                return;
            }

            if (tType === 'request' && tId) {
                const pos: 'before' | 'after' = relY < 0.5 ? 'before' : 'after';
                this.dragDropTarget.set({ targetType: 'request', targetId: tId, position: pos });
                return;
            }
        }

        // Empty expanded folder interior or child drop zone below requests
        const zoneId = this.findElementAttrAtPoint('[data-folder-zone-id]', 'data-folder-zone-id', x, y, 4, 4, 4, excludeIds);
        if (zoneId) {
            this.dragDropTarget.set({ targetType: 'group', targetId: zoneId, position: 'inside' });
            return;
        }

        this.dragDropTarget.set({ targetType: 'root-bottom', targetId: null, position: 'after' });
    }

    private autoScrollSidebarDuringDrag(pointerY: number): void {
        if (!this.isBrowser) return;
        const el = document.querySelector<HTMLElement>('[data-sidebar-scroll]');
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const edgeThreshold = 28;
        if (pointerY < rect.top + edgeThreshold) {
            el.scrollTop = Math.max(0, el.scrollTop - 8);
        } else if (pointerY > rect.bottom - edgeThreshold) {
            el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + 8);
        }
    }

    private commitTreeDragDrop(): void {
        const dt = this.dragDropTarget();
        const wasFolder = this.isDraggingFolder();
        const grpId = this.draggedGroupId();
        const reqIds = [...this.draggedRequestIds()];
        const sourceGrpId = this.draggedSourceGroupId();

        this.clearTreeDragState();
        this.justFinishedTreeDrag = true;
        setTimeout(() => {
            this.justFinishedTreeDrag = false;
        }, 60);

        if (!dt) return;

        if (wasFolder && grpId) {
            this.tabStateService.dropSidebarTreeItem({
                draggedType: 'group',
                draggedIds: [grpId],
                targetType: dt.targetType,
                targetId: dt.targetId,
                position: dt.position
            });
            return;
        }

        if (!wasFolder && reqIds.length > 0) {
            if (dt.targetType === 'request' && reqIds.length === 1 && dt.targetId === reqIds[0]) {
                return;
            }
            const moved = this.tabStateService.dropSidebarTreeItem({
                draggedType: 'request',
                draggedIds: reqIds,
                targetType: dt.targetType,
                targetId: dt.targetId,
                position: dt.position
            });
            if (moved && reqIds.length > 1 && (dt.targetType !== 'group' || dt.targetId !== sourceGrpId)) {
                this.selectedGroupIds.set(new Set());
                this.selectedRequestIds.set(new Set());
            }
        }
    }

    clearTreeDragState(): void {
        this.pendingTreeDrag = null;
        this.isDraggingFolder.set(false);
        this.isDraggingRequest.set(false);
        this.draggedGroupId.set(null);
        this.draggedRequestIds.set([]);
        this.draggedSourceGroupId.set(null);
        this.dragGhostPos.set(null);
        this.dragGhostLabel.set('');
        this.dragGhostMethod.set(null);
        this.dragDropTarget.set(null);
    }

    getVisibleOrderedRequestIds(): string[] {
        const ids: string[] = [];
        const childMap = this.tabStateService.childGroupsMap();
        const walkGroup = (group: RequestGroup, requests: RequestState[]) => {
            if (group.isExpanded === false) return;
            for (const r of requests) ids.push(r.id);
            for (const child of (childMap.get(group.id) || [])) {
                walkGroup(child.group, child.requests);
            }
        };
        for (const item of this.tabStateService.sidebarRootItems()) {
            if (item.type === 'group') {
                walkGroup(item.group, item.requests);
            } else {
                ids.push(item.request.id);
            }
        }
        return ids;
    }

    getAllOrderedRequestIds(): string[] {
        const ids: string[] = [];
        const childMap = this.tabStateService.childGroupsMap();
        const walkGroup = (group: RequestGroup, requests: RequestState[]) => {
            for (const r of requests) ids.push(r.id);
            for (const child of (childMap.get(group.id) || [])) {
                walkGroup(child.group, child.requests);
            }
        };
        for (const item of this.tabStateService.sidebarRootItems()) {
            if (item.type === 'group') {
                walkGroup(item.group, item.requests);
            } else {
                ids.push(item.request.id);
            }
        }
        return ids;
    }

    getEffectiveIdsForAction(primaryReqId: string): string[] {
        const selected = this.selectedRequestIds();
        if (selected.has(primaryReqId) && selected.size > 1) {
            const ordered = this.getAllOrderedRequestIds();
            const orderedSelected = ordered.filter(id => selected.has(id));
            return orderedSelected.length > 0 ? orderedSelected : Array.from(selected);
        }
        return [primaryReqId];
    }

    onDocumentClick() {
        if (this.moveMenuRequestId()) {
            this.moveMenuRequestId.set(null);
        }
        if (this.groupSelectionMenuOpen()) {
            this.groupSelectionMenuOpen.set(false);
        }
        if (this.editingRequestId()) {
            this.saveRequestName(this.editingRequestId()!);
        }
        this.closeSidebarRequestContextMenu();
        this.closeFolderContextMenu();
    }

    private scrollFolderIntoView(groupId: string): void {
        if (!this.isBrowser) return;
        setTimeout(() => {
            const headerEl = document.querySelector<HTMLElement>(`[data-folder-header-id="${groupId}"]`);
            headerEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            const inputEl = document.querySelector<HTMLInputElement>(`[data-folder-rename-input="${groupId}"]`);
            inputEl?.focus();
            inputEl?.select();
        }, 40);
    }

    createNewFolder(event?: Event) {
        event?.stopPropagation();
        const group = this.tabStateService.createRequestGroup('New Folder');
        this.editingGroupId.set(group.id);
        this.editingGroupName.set(group.name);
        this.scrollFolderIntoView(group.id);
    }

    createSubfolder(parentGroupId: string, event?: Event) {
        event?.stopPropagation();
        const group = this.tabStateService.createRequestGroup('New Subfolder', [], undefined, parentGroupId);
        this.editingGroupId.set(group.id);
        this.editingGroupName.set(group.name);
        this.scrollFolderIntoView(group.id);
    }

    toggleGroupSelectionMenu(event?: Event) {
        event?.stopPropagation();
        this.groupSelectionMenuOpen.update(v => !v);
        if (this.groupSelectionMenuOpen()) {
            this.customGroupName.set('');
        }
    }

    groupSelectedIntoNewFolder(customName?: string, event?: Event) {
        event?.stopPropagation();
        const selected = this.selectedRequestIds();
        if (selected.size === 0) return;
        const ordered = this.getAllOrderedRequestIds().filter(id => selected.has(id));
        const ids = ordered.length > 0 ? ordered : Array.from(selected);
        const name = (customName ?? this.customGroupName()).trim() || 'New Folder';
        const group = this.tabStateService.createRequestGroup(name, ids);
        this.selectedGroupIds.set(new Set());
        this.selectedRequestIds.set(new Set());
        this.groupSelectionMenuOpen.set(false);
        this.customGroupName.set('');
        if (!(customName ?? '').trim()) {
            this.editingGroupId.set(group.id);
            this.editingGroupName.set(group.name);
        }
        this.scrollFolderIntoView(group.id);
        this.notificationService.notify(`Grouped ${ids.length} request(s) into "${group.name}".`);
    }

    groupSelectedIntoExistingFolder(targetGroupId: string, event?: Event) {
        event?.stopPropagation();
        const selected = this.selectedRequestIds();
        if (selected.size === 0) return;
        const ordered = this.getAllOrderedRequestIds().filter(id => selected.has(id));
        const ids = ordered.length > 0 ? ordered : Array.from(selected);
        this.tabStateService.moveRequestsToGroup(ids, targetGroupId);
        this.selectedGroupIds.set(new Set());
        this.selectedRequestIds.set(new Set());
        this.groupSelectionMenuOpen.set(false);
        this.scrollFolderIntoView(targetGroupId);
        const pathName = this.tabStateService.getFolderFullPath(targetGroupId) || 'Folder';
        this.notificationService.notify(`Moved ${ids.length} request(s) into "${pathName}".`);
    }

    groupSelectedRequests(event?: Event) {
        this.toggleGroupSelectionMenu(event);
    }

    startEditingGroup(group: RequestGroup, event?: Event) {
        event?.stopPropagation();
        this.editingGroupId.set(group.id);
        this.editingGroupName.set(group.name);
    }

    saveGroupName(groupId: string, event?: Event) {
        event?.stopPropagation();
        if (this.editingGroupId() !== groupId) return;
        const trimmed = this.editingGroupName().trim();
        if (trimmed) {
            this.tabStateService.renameRequestGroup(groupId, trimmed);
        }
        this.editingGroupId.set(null);
    }

    cancelEditingGroup(event?: Event) {
        event?.stopPropagation();
        this.editingGroupId.set(null);
    }

    newRequestButtonTitle = computed<string>(() => {
        const groupName = this.tabStateService.focusedDirectoryGroupName();
        return groupName ? `New Request in "${groupName}"` : 'New Request in Capsule';
    });

    isGroupFocused(groupId: string): boolean {
        const focused = this.tabStateService.focusedSidebarItem();
        return focused?.type === 'group' && focused.id === groupId;
    }

    isRequestFocused(reqId: string): boolean {
        const focused = this.tabStateService.focusedSidebarItem();
        return focused?.type === 'request' && focused.id === reqId;
    }

    onFocusGroup(groupId: string): void {
        this.tabStateService.setFocusedSidebarItem({
            type: 'group',
            id: groupId,
            groupId
        });
    }

    onFocusRequest(reqId: string, groupId: string | null = null): void {
        this.tabStateService.setFocusedSidebarItem({
            type: 'request',
            id: reqId,
            groupId: groupId ?? null
        });
    }

    clearSidebarFocus(event?: Event): void {
        event?.stopPropagation();
        this.tabStateService.setFocusedSidebarItem(null);
        if (this.isBrowser && document.activeElement instanceof HTMLElement && document.activeElement.closest('.sidebar-focus-trigger')) {
            document.activeElement.blur();
        }
    }

    onSidebarBackgroundClick(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('[data-folder-header-id], [data-request-row-id], button, input, select, a')) {
            return;
        }
        this.tabStateService.setFocusedSidebarItem(null);
    }

    onFolderRowClick(groupId: string, event?: Event): void {
        if (this.justFinishedTreeDrag) return;
        this.onFocusGroup(groupId);
        (event?.currentTarget as HTMLElement | null)?.focus?.();
        this.toggleGroupExpanded(groupId, event);
    }

    onFolderContainerClick(groupId: string, event: MouseEvent): void {
        if (this.justFinishedTreeDrag) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, input')) return;
        this.onFocusGroup(groupId);
        const trigger = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('.sidebar-focus-trigger');
        trigger?.focus?.();
        this.toggleGroupExpanded(groupId, event);
    }

    onRequestRowContainerClick(req: any, event: MouseEvent, groupId: string | null = null): void {
        if (this.justFinishedTreeDrag) return;
        const target = event.target as HTMLElement | null;
        if (this.editingRequestId() && this.editingRequestId() !== req.id) {
            this.saveRequestName(this.editingRequestId()!);
        }
        if (target?.closest('button, input')) return;
        const trigger = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('.sidebar-focus-trigger');
        trigger?.focus?.();
        this.onRequestRowClick(req, event, groupId);
    }

    toggleGroupExpanded(groupId: string, event?: Event) {
        event?.stopPropagation();
        this.tabStateService.toggleGroupExpanded(groupId);
    }

    addNewRequestInGroup(groupId: string, event: Event) {
        event.stopPropagation();
        this.tabStateService.createAndOpenNewTab(undefined, groupId);
    }

    async ungroupFolder(group: RequestGroup, event: Event) {
        event.stopPropagation();
        await this.tabStateService.deleteRequestGroup(group.id, false);
        this.notificationService.notify(`Ungrouped folder "${group.name}".`);
    }

    async deleteFolder(group: RequestGroup, requestCount: number, event: Event) {
        event.stopPropagation();
        if (this.isDeletingRequests()) return;

        const descendantIds = this.tabStateService.getDescendantGroupIds([group.id]);
        const subFolderCount = Math.max(0, descendantIds.length - 1);
        const descSet = new Set(descendantIds);
        const totalNestedReqs = this.tabStateService.allCapsuleRequests().filter(r => r.groupId && descSet.has(r.groupId)).length;
        const effectiveReqCount = Math.max(requestCount, totalNestedReqs);

        const promptMsg = effectiveReqCount > 0 || subFolderCount > 0
            ? `Are you sure you want to delete folder "${group.name}"${subFolderCount > 0 ? `, its ${subFolderCount} subfolder(s)` : ''}${effectiveReqCount > 0 ? `, and its ${effectiveReqCount} request(s)` : ''}? (Tip: Use Ungroup to keep requests)`
            : `Are you sure you want to delete empty folder "${group.name}"?`;

        const confirmed = await this.dialogService.confirm(promptMsg);
        if (!confirmed) return;

        this.isDeletingRequests.set(true);
        try {
            const memberIds = new Set<string>(
                this.tabStateService.allCapsuleRequests().filter(r => r.groupId && descSet.has(r.groupId)).map(r => r.id)
            );
            for (const rId of (group.requestIds || [])) memberIds.add(rId);

            await this.tabStateService.deleteRequestGroup(group.id, true);
            this.selectedGroupIds.update(set => {
                const next = new Set(set);
                for (const dId of descendantIds) next.delete(dId);
                return next;
            });
            if (memberIds.size > 0) {
                this.selectedRequestIds.update(set => {
                    const next = new Set(set);
                    for (const rId of memberIds) next.delete(rId);
                    return next;
                });
            }
            this.notificationService.notify(
                effectiveReqCount > 0
                    ? `Deleted folder "${group.name}" and ${effectiveReqCount} request(s).`
                    : `Deleted folder "${group.name}".`
            );
        } catch (e: any) {
            this.notificationService.notify(`Failed to delete folder: ${e?.message || 'Error'}`);
        } finally {
            this.isDeletingRequests.set(false);
        }
    }

    private getGroupSubtreeRequestIds(groupId: string, directRequests: any[] = []): string[] {
        const descGroupSet = new Set(this.tabStateService.getDescendantGroupIds([groupId]));
        const reqIds = new Set<string>();
        for (const r of directRequests || []) {
            if (r?.id) reqIds.add(r.id);
        }
        for (const r of this.tabStateService.allCapsuleRequests()) {
            if (r?.id && r.groupId && descGroupSet.has(r.groupId)) {
                reqIds.add(r.id);
            }
        }
        return Array.from(reqIds);
    }

    isGroupSelected(groupId: string, requests: any[]): boolean {
        if (this.selectedGroupIds().has(groupId)) return true;
        const allSubtreeReqIds = this.getGroupSubtreeRequestIds(groupId, requests);
        const childGroups = this.tabStateService.activeCapsuleGroups().filter(g => (g.parentGroupId ?? null) === groupId);
        if (allSubtreeReqIds.length === 0 && childGroups.length === 0) return false;
        const reqSelected = this.selectedRequestIds();
        const groupSelected = this.selectedGroupIds();
        const allReqsSelected = allSubtreeReqIds.every(id => reqSelected.has(id));
        const allChildrenSelected = childGroups.every(cg => groupSelected.has(cg.id));
        return allReqsSelected && allChildrenSelected;
    }

    toggleSelectGroup(groupId: string, requests: any[], event: Event) {
        event.stopPropagation();
        const nextGroups = new Set(this.selectedGroupIds());
        const nextReqs = new Set(this.selectedRequestIds());
        const currentlySelected = this.isGroupSelected(groupId, requests);
        const descGroupIds = this.tabStateService.getDescendantGroupIds([groupId]);
        const subtreeReqIds = this.getGroupSubtreeRequestIds(groupId, requests);

        if (currentlySelected) {
            for (const gid of descGroupIds) {
                nextGroups.delete(gid);
            }
            for (const rid of subtreeReqIds) {
                nextReqs.delete(rid);
            }
            // Clear ancestor folders when a child folder/subtree is unchecked
            const groupsById = new Map(this.tabStateService.activeCapsuleGroups().map(g => [g.id, g]));
            let parentId = groupsById.get(groupId)?.parentGroupId ?? null;
            const visited = new Set<string>([groupId]);
            while (parentId && !visited.has(parentId)) {
                visited.add(parentId);
                nextGroups.delete(parentId);
                parentId = groupsById.get(parentId)?.parentGroupId ?? null;
            }
        } else {
            for (const gid of descGroupIds) {
                nextGroups.add(gid);
            }
            for (const rid of subtreeReqIds) {
                nextReqs.add(rid);
            }
        }
        this.selectedGroupIds.set(nextGroups);
        this.selectedRequestIds.set(nextReqs);
        this.syncGroupSelectionAfterRequestChange(nextReqs, nextGroups);
    }

    private syncGroupSelectionAfterRequestChange(nextReqSet: Set<string>, baseGroupSet?: Set<string>): void {
        const nextGroups = new Set(baseGroupSet ?? this.selectedGroupIds());
        const allGroups = this.tabStateService.activeCapsuleGroups();
        const allReqs = this.tabStateService.allCapsuleRequests();
        const directReqsByGroup = new Map<string, string[]>();
        const childGroupsByParent = new Map<string, string[]>();

        for (const r of allReqs) {
            if (r?.id && r.groupId) {
                const list = directReqsByGroup.get(r.groupId) ?? [];
                list.push(r.id);
                directReqsByGroup.set(r.groupId, list);
            }
        }
        for (const g of allGroups) {
            if (g.parentGroupId) {
                const children = childGroupsByParent.get(g.parentGroupId) ?? [];
                children.push(g.id);
                childGroupsByParent.set(g.parentGroupId, children);
            }
        }

        // Propagate bottom-up until stable so parent folders stay in sync across nested subfolders
        let changed = true;
        let guard = 0;
        while (changed && guard < 32) {
            changed = false;
            guard++;
            for (const g of allGroups) {
                const directReqs = directReqsByGroup.get(g.id) ?? [];
                const childGroups = childGroupsByParent.get(g.id) ?? [];
                if (directReqs.length === 0 && childGroups.length === 0) continue;

                const allDirectSelected = directReqs.every(id => nextReqSet.has(id));
                const allChildrenSelected = childGroups.every(cid => nextGroups.has(cid));
                const shouldBeSelected = allDirectSelected && allChildrenSelected;

                if (shouldBeSelected && !nextGroups.has(g.id)) {
                    nextGroups.add(g.id);
                    changed = true;
                } else if (!shouldBeSelected && nextGroups.has(g.id)) {
                    nextGroups.delete(g.id);
                    changed = true;
                }
            }
        }
        this.selectedGroupIds.set(nextGroups);
    }

    toggleMoveMenu(requestId: string, event: Event) {
        event.stopPropagation();
        this.moveMenuRequestId.update(cur => cur === requestId ? null : requestId);
    }

    moveRequestToGroupFromMenu(requestId: string, targetGroupId: string | null, event: Event) {
        event.stopPropagation();
        const ids = this.getEffectiveIdsForAction(requestId);
        this.tabStateService.moveRequestsToGroup(ids, targetGroupId);
        if (ids.length > 1) {
            this.selectedGroupIds.set(new Set());
            this.selectedRequestIds.set(new Set());
        }
        this.moveMenuRequestId.set(null);
    }

    moveRequestToNewGroupFromMenu(requestId: string, event: Event) {
        event.stopPropagation();
        const ids = this.getEffectiveIdsForAction(requestId);
        const group = this.tabStateService.createRequestGroup('New Folder', ids);
        if (ids.length > 1) {
            this.selectedGroupIds.set(new Set());
            this.selectedRequestIds.set(new Set());
        }
        this.moveMenuRequestId.set(null);
        this.editingGroupId.set(group.id);
        this.editingGroupName.set(group.name);
        this.scrollFolderIntoView(group.id);
    }

    getSelectedRequestIdsIncludingFolders(): string[] {
        const ids = new Set<string>(this.selectedRequestIds());
        const selectedGroups = Array.from(this.selectedGroupIds());
        if (selectedGroups.length > 0) {
            const expandedGroupSet = new Set(this.tabStateService.getDescendantGroupIds(selectedGroups));
            for (const req of this.tabStateService.allCapsuleRequests()) {
                if (req?.id && req.groupId && expandedGroupSet.has(req.groupId)) {
                    ids.add(req.id);
                }
            }
        }
        const ordered = this.getAllOrderedRequestIds().filter(id => ids.has(id));
        return ordered.length > 0 ? ordered : Array.from(ids);
    }

    openTransferModalForRequest(requestId: string, mode: 'copy' | 'move', event: Event): void {
        event.stopPropagation();
        this.moveMenuRequestId.set(null);
        this.transferFolder.set(null);
        const ids = this.getEffectiveIdsForAction(requestId);
        this.transferRequestIds.set(ids);
        this.transferInitialMode.set(mode);
        this.isTransferModalOpen.set(true);
    }

    openTransferModalFromSelection(mode: 'copy' | 'move' = 'copy', event?: Event): void {
        event?.stopPropagation();
        this.transferFolder.set(null);
        const ids = this.getSelectedRequestIdsIncludingFolders();
        if (ids.length === 0) {
            this.notificationService.notify('Select at least one non-empty folder or request.', 'warning');
            return;
        }
        this.transferRequestIds.set(ids);
        this.transferInitialMode.set(mode);
        this.isTransferModalOpen.set(true);
    }

    onTransferCompleted(res: { mode: 'copy' | 'move'; switched: boolean }): void {
        this.transferFolder.set(null);
        if (res.mode === 'move' || res.switched) {
            this.selectedGroupIds.set(new Set());
            this.selectedRequestIds.set(new Set());
        }
    }

    async copyRequestCurlFromMenu(requestId: string, event: Event): Promise<void> {
        event.stopPropagation();
        this.moveMenuRequestId.set(null);
        await this.tabStateService.copyRequestAsCurl(requestId);
    }

    openCurlModalFromMenu(req: RequestState, event: Event): void {
        event.stopPropagation();
        this.moveMenuRequestId.set(null);
        const latest = this.tabStateService.getState(req.id) || req;
        this.curlModalRequest.set(latest);
    }

    openRequest(request: any) {
        this.tabStateService.addOpenTab(request);
        this.tabStateService.setActiveTab(request.id);
    }

    onRequestRowClick(req: any, event: MouseEvent, groupId: string | null = null) {
        const resolvedGroupId = groupId !== undefined && groupId !== null ? groupId : (req?.groupId ?? null);
        this.onFocusRequest(req.id, resolvedGroupId);
        (event.currentTarget as HTMLElement | null)?.focus?.();

        const isCtrlOrCmd = event.ctrlKey || event.metaKey;
        const isShift = event.shiftKey;

        if (isShift) {
            event.preventDefault();
            event.stopPropagation();
            const visibleIds = this.getVisibleOrderedRequestIds();
            const anchorId = this.lastSelectedRequestId() || this.tabStateService.activeTabId() || req.id;
            const startIdx = visibleIds.indexOf(anchorId);
            const endIdx = visibleIds.indexOf(req.id);

            const next = new Set(isCtrlOrCmd ? this.selectedRequestIds() : []);
            if (startIdx !== -1 && endIdx !== -1) {
                const min = Math.min(startIdx, endIdx);
                const max = Math.max(startIdx, endIdx);
                for (let i = min; i <= max; i++) {
                    next.add(visibleIds[i]);
                }
            } else {
                next.add(req.id);
            }
            this.selectedRequestIds.set(next);
            this.syncGroupSelectionAfterRequestChange(next);
            if (!this.lastSelectedRequestId()) {
                this.lastSelectedRequestId.set(anchorId);
            }
            return;
        }

        if (isCtrlOrCmd) {
            event.preventDefault();
            event.stopPropagation();
            const next = new Set(this.selectedRequestIds());
            const anchorId = this.lastSelectedRequestId();
            if (next.size === 0 && anchorId && anchorId !== req.id) {
                next.add(anchorId);
            }
            if (next.has(req.id)) {
                next.delete(req.id);
            } else {
                next.add(req.id);
            }
            this.selectedRequestIds.set(next);
            this.syncGroupSelectionAfterRequestChange(next);
            this.lastSelectedRequestId.set(req.id);
            return;
        }

        this.lastSelectedRequestId.set(req.id);
        this.openRequest(req);
    }

    addNewRequest() {
        this.tabStateService.createAndOpenNewTab();
    }

    // Batch selection
    selectedRequestIds = signal<Set<string>>(new Set());
    selectedGroupIds = signal<Set<string>>(new Set());
    isDeletingRequests = signal<boolean>(false);

    isAllSidebarSelected = computed<boolean>(() => {
        const reqs = this.tabStateService.allCapsuleRequests();
        const groups = this.tabStateService.activeCapsuleGroups();
        if (reqs.length === 0 && groups.length === 0) return false;
        const allReqsSelected = reqs.every(r => this.selectedRequestIds().has(r.id));
        const allGroupsSelected = groups.every(g => this.selectedGroupIds().has(g.id));
        return allReqsSelected && allGroupsSelected;
    });

    batchDeleteCountLabel = computed<string>(() => {
        const grpCount = this.selectedGroupIds().size;
        const reqCount = this.selectedRequestIds().size;
        if (grpCount > 0 && reqCount > 0) return `${grpCount}F·${reqCount}`;
        if (grpCount > 0) return `${grpCount}F`;
        return `${reqCount}`;
    });

    toggleSelectRequest(id: string, event: MouseEvent) {
        event.stopPropagation();
        if (event.shiftKey) {
            const visibleIds = this.getVisibleOrderedRequestIds();
            const anchorId = this.lastSelectedRequestId() || this.tabStateService.activeTabId() || id;
            const startIdx = visibleIds.indexOf(anchorId);
            const endIdx = visibleIds.indexOf(id);
            const next = new Set(this.selectedRequestIds());
            if (startIdx !== -1 && endIdx !== -1) {
                const min = Math.min(startIdx, endIdx);
                const max = Math.max(startIdx, endIdx);
                for (let i = min; i <= max; i++) {
                    next.add(visibleIds[i]);
                }
                this.selectedRequestIds.set(next);
                this.syncGroupSelectionAfterRequestChange(next);
                return;
            }
        }

        const current = new Set(this.selectedRequestIds());
        if (current.has(id)) {
            current.delete(id);
        } else {
            current.add(id);
        }
        this.selectedRequestIds.set(current);
        this.syncGroupSelectionAfterRequestChange(current);
        this.lastSelectedRequestId.set(id);
    }

    toggleSelectAllRequests() {
        const allReqs = this.tabStateService.allCapsuleRequests();
        const allGroups = this.tabStateService.activeCapsuleGroups();
        if (this.isAllSidebarSelected()) {
            this.selectedRequestIds.set(new Set());
            this.selectedGroupIds.set(new Set());
        } else {
            this.selectedRequestIds.set(new Set(allReqs.map(r => r.id)));
            this.selectedGroupIds.set(new Set(allGroups.map(g => g.id)));
        }
    }

    async deleteRequestFromSidebar(request: any, event: Event) {
        event.stopPropagation();
        const displayName = this.tabStateService.resolveRequestTitle(request.name, request.url);
        const confirmMsg = `Are you sure you want to delete request "${displayName}"?`;
        const confirmed = await this.dialogService.confirm(confirmMsg);
        if (!confirmed) return;

        try {
            await this.tabStateService.deleteRequest(request.id);
            const next = new Set(this.selectedRequestIds());
            next.delete(request.id);
            this.selectedRequestIds.set(next);
            this.syncGroupSelectionAfterRequestChange(next);
            this.notificationService.notify(`Request "${displayName}" deleted.`);
        } catch (e: any) {
            this.notificationService.notify(`Failed to delete request: ${e.message || 'Error'}`);
        }
    }

    async batchDeleteSelectedRequests() {
        const groupIds = Array.from(this.selectedGroupIds());
        const requestIds = Array.from(this.selectedRequestIds());
        if ((groupIds.length === 0 && requestIds.length === 0) || this.isDeletingRequests()) return;

        const groupIdSet = new Set(groupIds);
        const totalReqIdSet = new Set<string>(requestIds);
        for (const item of this.tabStateService.groupedCapsuleRequests()) {
            if (groupIdSet.has(item.group.id)) {
                for (const r of item.requests) totalReqIdSet.add(r.id);
            }
        }

        let confirmMsg: string;
        if (groupIds.length > 0 && totalReqIdSet.size > 0) {
            confirmMsg = `Are you sure you want to delete ${groupIds.length} selected folder(s) and ${totalReqIdSet.size} request(s)?`;
        } else if (groupIds.length > 0) {
            confirmMsg = `Are you sure you want to delete ${groupIds.length} selected folder(s)?`;
        } else {
            confirmMsg = `Are you sure you want to delete ${totalReqIdSet.size} selected request(s)?`;
        }

        const confirmed = await this.dialogService.confirm(confirmMsg);
        if (!confirmed) return;

        this.isDeletingRequests.set(true);
        try {
            await this.tabStateService.deleteRequestGroupsAndRequests(groupIds, requestIds);
            this.selectedGroupIds.set(new Set());
            this.selectedRequestIds.set(new Set());
            if (groupIds.length > 0 && totalReqIdSet.size > 0) {
                this.notificationService.notify(`Deleted ${groupIds.length} folder(s) and ${totalReqIdSet.size} request(s) successfully.`);
            } else if (groupIds.length > 0) {
                this.notificationService.notify(`Deleted ${groupIds.length} folder(s) successfully.`);
            } else {
                this.notificationService.notify(`Deleted ${totalReqIdSet.size} request(s) successfully.`);
            }
        } catch (e: any) {
            this.notificationService.notify(`Failed to delete selected items: ${e.message || 'Error'}`);
        } finally {
            this.isDeletingRequests.set(false);
        }
    }

    // Request Examples
    expandedExampleRequestId = signal<string | null>(null);
    expandedExampleRequestIds = signal<Set<string>>(new Set());
    requestExamplesMap = this.tabStateService.requestExamplesMap;

    isRequestExpanded(requestId: string): boolean {
        return this.expandedExampleRequestIds().has(requestId) || this.expandedExampleRequestId() === requestId;
    }

    isExamplesLoading(requestId: string): boolean {
        return this.tabStateService.isExamplesLoading(requestId);
    }

    async toggleExamples(requestId: string, event: Event) {
        event.stopPropagation();
        const currentSet = new Set(this.expandedExampleRequestIds());
        if (currentSet.has(requestId) || this.expandedExampleRequestId() === requestId) {
            currentSet.delete(requestId);
            this.expandedExampleRequestIds.set(currentSet);
            const remaining = Array.from(currentSet);
            this.expandedExampleRequestId.set(remaining.length > 0 ? remaining[remaining.length - 1] : null);
            if (this.isBrowser) {
                localStorage.setItem('onsteroids_expanded_example_reqs', JSON.stringify(remaining));
                if (remaining.length > 0) {
                    localStorage.setItem('onsteroids_expanded_example_req', remaining[remaining.length - 1]);
                } else {
                    localStorage.removeItem('onsteroids_expanded_example_req');
                }
            }
            return;
        }
        currentSet.add(requestId);
        this.expandedExampleRequestIds.set(currentSet);
        this.expandedExampleRequestId.set(requestId);
        if (this.isBrowser) {
            const list = Array.from(currentSet);
            localStorage.setItem('onsteroids_expanded_example_reqs', JSON.stringify(list));
            localStorage.setItem('onsteroids_expanded_example_req', requestId);
        }
        await this.tabStateService.getExamples(requestId);
    }

    loadExample(example: any, event: Event) {
        event.stopPropagation();
        try {
            const snapshot = typeof example.requestSnapshot === 'string' ? JSON.parse(example.requestSnapshot) : example.requestSnapshot;
            const rawTargetId = example.requestId || this.tabStateService.activeTabId() || '';
            const targetId = this.tabStateService.resolveTabId(rawTargetId);
            if (targetId) {
                // 1. Cancel any active in-flight request execution for this tab so its live response won't clobber this example
                this.executionService.cancelRequest(targetId);
                // 2. Advance execution token to reject any trailing async responses
                this.tabStateService.nextExecutionToken(targetId);

                // 3. Load example snapshot with isLoading: false and isDirty: false
                this.tabStateService.updateState(targetId, {
                    ...snapshot,
                    isLoading: false,
                    isDirty: false
                });
                this.tabStateService.setActiveTab(targetId);
                this.notificationService.notify(`Loaded example "${example.name}".`);
            }
        } catch (e) {
            console.error('Failed to load example', e);
        }
    }

    async deleteExample(requestId: string, exampleId: string, event: Event) {
        event.stopPropagation();
        const confirmed = await this.dialogService.confirm('Are you sure you want to delete this example?');
        if (!confirmed) return;
        await this.tabStateService.deleteExample(requestId, exampleId);
        this.notificationService.notify('Example deleted.');
    }

    formatRequestName(name: string): string {
        if (name.includes(' — ')) {
            return name.split(' — ')[1];
        }
        return name;
    }

    handleKeyboardShortcuts(event: KeyboardEvent) {
        if (!this.isBrowser) return;

        if (event.key === 'Escape' && (this.isDraggingRequest() || this.isDraggingFolder())) {
            event.preventDefault();
            this.clearTreeDragState();
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key === '`') {
            event.preventDefault();
            this.terminalService.toggle();
            return;
        }

        const target = event.target as HTMLElement;
        
        if (target?.closest('.monaco-editor')) {
            return;
        }

        if (target?.closest('.cdk-overlay-container') || target?.closest('app-utility-component') || target?.closest('app-swagger-import-modal') || target?.closest('app-variable-modal')) {
            return;
        }

        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey;

        if (isCtrlOrCmd) {
            if (event.key.toLowerCase() === 's') {
                event.preventDefault();
                const activeId = this.tabStateService.activeTabId();
                if (activeId) {
                    this.tabStateService.saveToCapsule(activeId).then(() => {
                        if (!this.authService.isLoggedIn()) {
                            this.authService.openAuthModal();
                            this.notificationService.notify('Saved locally! Sign in to sync with cloud.');
                        } else {
                            this.notificationService.notify('Capsule, requests, and variables saved successfully!');
                        }
                    }).catch(e => {
                        console.error('Failed to save request/capsule:', e);
                        this.notificationService.notify(e?.error?.message || e?.message || 'Failed to save capsule to cloud.');
                    });
                }
            } else if (event.key.toLowerCase() === 'z') {
                if (this.isEditableTextInputTarget(target)) {
                    return;
                }
                if (event.shiftKey) {
                    this.tabStateService.redo();
                } else {
                    this.tabStateService.undo();
                }
                event.preventDefault();
            } else if (event.key.toLowerCase() === 'y' && !isMac) {
                if (this.isEditableTextInputTarget(target)) {
                    return;
                }
                this.tabStateService.redo();
                event.preventDefault();
            }
        }
    }

    private isEditableTextInputTarget(target: HTMLElement | null): boolean {
        if (!target) return false;
        if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
            return true;
        }
        const inputEl = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
            ? target as HTMLInputElement | HTMLTextAreaElement
            : target.closest('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
        if (!inputEl) return false;
        if (inputEl.tagName === 'TEXTAREA') return !inputEl.readOnly && !inputEl.disabled;
        const inputType = ((inputEl as HTMLInputElement).type || 'text').toLowerCase();
        const nonTextTypes = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'];
        return !nonTextTypes.includes(inputType) && !inputEl.readOnly && !inputEl.disabled;
    }

    onBeforeUnload(event: BeforeUnloadEvent) {
        if (!this.tabStateService.autoSaveEnabled() && this.authService.isLoggedIn()) {
            const hasDirty = this.tabStateService.getAllStates().some(s => s.isDirty);
            if (hasDirty) {
                event.preventDefault();
                event.returnValue = '';
            }
        }
    }
}
