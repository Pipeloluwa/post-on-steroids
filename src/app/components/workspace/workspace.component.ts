import { Component, signal, computed, inject, effect, PLATFORM_ID, ViewChild } from '@angular/core';
import { DragDropModule, CdkDragDrop, CdkDrag } from '@angular/cdk/drag-drop';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RequestTabsComponent } from './request-tabs.component/request-tabs.component';
import { RequestDetailsComponent } from './request-details.component/request-details.component';
import { RequestUrlComponent } from './request-url.component/request-url.component';
import { PayloadTypesComponent } from './payload.types.component/payload.types.component';
import { CreateCapsuleModalComponent } from '../../shared/components/create-capsule.modal.component/create-capsule.modal.component';

import { ResponseViewerComponent } from './response-viewer.component/response-viewer.component';
import { MatIcon } from '@angular/material/icon';
import { AuthService } from '../../shared/services/auth.service';
import { NotificationService } from '../../shared/services/notification.service';
import { LocalStorageService } from '../../shared/services/local.storage.service';
import { TabStateService, RequestGroup } from '../../shared/services/tab.state.service';
import { DialogService } from '../../shared/services/dialog.service';
import { RequestExecutionService } from '../../shared/services/request.execution.service';

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
        MatIcon,
        DragDropModule
    ],
    templateUrl: './workspace.component.html',
    styleUrl: './workspace.component.css',
    host: {
        '(document:mousemove)': 'onMouseMove($event)',
        '(document:mouseup)': 'onMouseUp()',
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

    onMouseMove(event: MouseEvent) {
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;

        if (this.isDraggingRequest() && this.isBrowser) {
            const el = document.elementFromPoint(event.clientX, event.clientY);
            const folderHeaderEl = el?.closest('[data-folder-header-id]') as HTMLElement | null;
            this.hoveredFolderIdDuringDrag.set(folderHeaderEl?.getAttribute('data-folder-header-id') || null);
        }

        if (!this.isResizing() && !this.isResizingSidebar()) return;

        const container = document.querySelector('.workspace-container');
        if (container) {
            const rect = container.getBoundingClientRect();
            if (this.isResizing()) {
                const tabHeight = 38;
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
        switch (method.toUpperCase()) {
            case 'GET': return '#00BF8E';
            case 'POST': return '#FFB400';
            case 'PUT': return '#097BED';
            case 'DEL':
            case 'DELETE': return '#FF5233';
            default: return 'var(--postonsteroids-text-primary)';
        }
    }

    // Folder / Group & Drag state
    editingGroupId = signal<string | null>(null);
    editingGroupName = signal<string>('');
    moveMenuRequestId = signal<string | null>(null);

    lastSelectedRequestId = signal<string | null>(null);
    isDraggingRequest = signal<boolean>(false);
    isDraggingFolder = signal<boolean>(false);
    draggedRequestIds = signal<string[]>([]);
    hoveredFolderIdDuringDrag = signal<string | null>(null);

    folderDropListIds = computed<string[]>(() =>
        this.tabStateService.activeCapsuleGroups().map(g => 'folder-drop-' + g.id)
    );

    allRequestDropListIds = computed<string[]>(() => [
        ...this.folderDropListIds(),
        'sidebar-root-drop-list'
    ]);

    canEnterFolderDropList = (drag: CdkDrag): boolean => {
        return drag.data?.type !== 'group';
    };

    canEnterRootDropList = (drag: CdkDrag): boolean => {
        if (drag.data?.type === 'group') return true;
        if (!this.isBrowser) return true;
        const el = document.elementFromPoint(this.lastPointerX, this.lastPointerY);
        if (el?.closest('.folder-drop-zone')) {
            return false;
        }
        return true;
    };

    getVisibleOrderedRequestIds(): string[] {
        const ids: string[] = [];
        for (const item of this.tabStateService.sidebarRootItems()) {
            if (item.type === 'group') {
                if (item.group.isExpanded !== false) {
                    for (const r of item.requests) {
                        ids.push(r.id);
                    }
                }
            } else {
                ids.push(item.request.id);
            }
        }
        return ids;
    }

    getAllOrderedRequestIds(): string[] {
        const ids: string[] = [];
        for (const item of this.tabStateService.sidebarRootItems()) {
            if (item.type === 'group') {
                for (const r of item.requests) {
                    ids.push(r.id);
                }
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
    }

    onFolderDragStarted() {
        this.isDraggingFolder.set(true);
    }

    onFolderDragEnded() {
        this.isDraggingFolder.set(false);
    }

    onRequestDragStarted(req: any) {
        if (!req?.id) return;
        const effectiveIds = this.getEffectiveIdsForAction(req.id);
        this.draggedRequestIds.set(effectiveIds);
        this.isDraggingRequest.set(true);
        this.hoveredFolderIdDuringDrag.set(null);
    }

    onRequestDragEnded() {
        this.isDraggingRequest.set(false);
        this.draggedRequestIds.set([]);
        this.hoveredFolderIdDuringDrag.set(null);
    }

    onDropInRoot(event: CdkDragDrop<any>) {
        const dragData = event.item.data;
        if (!dragData) return;

        // Case 1: Repositioning a folder in any order in the root list
        if (dragData.type === 'group') {
            const groupId = dragData.groupId || dragData.group?.id;
            if (!groupId) return;
            this.tabStateService.reorderSidebarRootItem(groupId, event.previousIndex, event.currentIndex);
            return;
        }

        // Case 2: Dropping 1 or more requests
        const req = dragData.req || dragData;
        if (!req?.id) return;
        const movingIds = this.draggedRequestIds().length > 0
            ? this.draggedRequestIds()
            : this.getEffectiveIdsForAction(req.id);
        const sourceGroupId: string | null = dragData.groupId !== undefined ? dragData.groupId : (req.groupId ?? null);

        // If dropped directly onto a folder header, move request(s) into that folder
        let hoveredFolderId = this.hoveredFolderIdDuringDrag();
        if (!hoveredFolderId && this.isBrowser) {
            const el = document.elementFromPoint(this.lastPointerX, this.lastPointerY);
            const headerEl = el?.closest('[data-folder-header-id]') as HTMLElement | null;
            hoveredFolderId = headerEl?.getAttribute('data-folder-header-id') || null;
        }

        if (hoveredFolderId) {
            const targetGroupEntry = this.tabStateService.groupedCapsuleRequests().find(g => g.group.id === hoveredFolderId);
            const appendIndex = targetGroupEntry ? targetGroupEntry.requests.length : 999999;
            this.tabStateService.handleRequestDrop(
                movingIds,
                sourceGroupId,
                hoveredFolderId,
                event.previousIndex,
                appendIndex
            );
            if (movingIds.length > 1) {
                this.selectedGroupIds.set(new Set());
                this.selectedRequestIds.set(new Set());
            }
            this.hoveredFolderIdDuringDrag.set(null);
            return;
        }

        this.tabStateService.handleRequestDrop(
            movingIds,
            sourceGroupId,
            null,
            event.previousIndex,
            event.currentIndex
        );
    }

    onDropInFolder(event: CdkDragDrop<any>, targetGroupId: string) {
        const dragData = event.item.data;
        if (!dragData || dragData.type === 'group') return;

        const req = dragData.req || dragData;
        if (!req?.id) return;
        const movingIds = this.draggedRequestIds().length > 0
            ? this.draggedRequestIds()
            : this.getEffectiveIdsForAction(req.id);
        const sourceGroupId: string | null = dragData.groupId !== undefined ? dragData.groupId : (req.groupId ?? null);

        this.tabStateService.handleRequestDrop(
            movingIds,
            sourceGroupId,
            targetGroupId,
            event.previousIndex,
            event.currentIndex
        );
        if (movingIds.length > 1 && sourceGroupId !== targetGroupId) {
            this.selectedGroupIds.set(new Set());
            this.selectedRequestIds.set(new Set());
        }
        this.hoveredFolderIdDuringDrag.set(null);
    }

    createNewFolder(event?: Event) {
        event?.stopPropagation();
        const group = this.tabStateService.createRequestGroup('New Folder');
        this.editingGroupId.set(group.id);
        this.editingGroupName.set(group.name);
    }

    groupSelectedRequests(event?: Event) {
        event?.stopPropagation();
        const selected = this.selectedRequestIds();
        if (selected.size === 0) return;
        const ordered = this.getAllOrderedRequestIds().filter(id => selected.has(id));
        const ids = ordered.length > 0 ? ordered : Array.from(selected);
        const group = this.tabStateService.createRequestGroup('New Folder', ids);
        this.selectedGroupIds.set(new Set());
        this.selectedRequestIds.set(new Set());
        this.editingGroupId.set(group.id);
        this.editingGroupName.set(group.name);
        this.notificationService.notify(`Grouped ${ids.length} request(s) into folder.`);
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

        if (requestCount > 0) {
            const confirmed = await this.dialogService.confirm(
                `Are you sure you want to delete folder "${group.name}" and its ${requestCount} request(s)? (Tip: Use the ungroup button to keep requests)`
            );
            if (!confirmed) return;
        }

        this.isDeletingRequests.set(true);
        try {
            const memberIds = new Set<string>(group.requestIds || []);
            await this.tabStateService.deleteRequestGroup(group.id, requestCount > 0);
            this.selectedGroupIds.update(set => {
                const next = new Set(set);
                next.delete(group.id);
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
                requestCount > 0
                    ? `Deleted folder "${group.name}" and ${requestCount} request(s).`
                    : `Deleted folder "${group.name}".`
            );
        } catch (e: any) {
            this.notificationService.notify(`Failed to delete folder: ${e?.message || 'Error'}`);
        } finally {
            this.isDeletingRequests.set(false);
        }
    }

    isGroupSelected(groupId: string, requests: any[]): boolean {
        if (this.selectedGroupIds().has(groupId)) return true;
        return requests.length > 0 && requests.every(r => this.selectedRequestIds().has(r.id));
    }

    toggleSelectGroup(groupId: string, requests: any[], event: Event) {
        event.stopPropagation();
        const nextGroups = new Set(this.selectedGroupIds());
        const nextReqs = new Set(this.selectedRequestIds());
        const currentlySelected = this.isGroupSelected(groupId, requests);

        if (currentlySelected) {
            nextGroups.delete(groupId);
            for (const r of requests) {
                nextReqs.delete(r.id);
            }
        } else {
            nextGroups.add(groupId);
            for (const r of requests) {
                nextReqs.add(r.id);
            }
        }
        this.selectedGroupIds.set(nextGroups);
        this.selectedRequestIds.set(nextReqs);
    }

    private syncGroupSelectionAfterRequestChange(nextReqSet: Set<string>): void {
        const currentGroups = this.selectedGroupIds();
        if (currentGroups.size === 0) return;
        const nextGroups = new Set(currentGroups);
        const grouped = this.tabStateService.groupedCapsuleRequests();
        for (const gId of currentGroups) {
            const entry = grouped.find(item => item.group.id === gId);
            if (entry && entry.requests.length > 0 && entry.requests.some(r => !nextReqSet.has(r.id))) {
                nextGroups.delete(gId);
            }
        }
        if (nextGroups.size !== currentGroups.size) {
            this.selectedGroupIds.set(nextGroups);
        }
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
    }

    openRequest(request: any) {
        this.tabStateService.addOpenTab(request);
        this.tabStateService.setActiveTab(request.id);
    }

    onRequestRowClick(req: any, event: MouseEvent) {
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
                if (event.shiftKey) {
                    this.tabStateService.redo();
                } else {
                    this.tabStateService.undo();
                }
                event.preventDefault();
            } else if (event.key.toLowerCase() === 'y' && !isMac) {
                this.tabStateService.redo();
                event.preventDefault();
            }
        }
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
