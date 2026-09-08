import { Component, ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

import { TabStateService, Capsule } from '../../shared/services/tab.state.service';
import { NotificationService } from '../../shared/services/notification.service';
import { inject } from '@angular/core';

@Component({
    selector: 'app-collections-component',
    imports: [CommonModule, MatIcon, FormsModule],
    templateUrl: './collections.component.html',
    styleUrl: './collections.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CollectionsComponent {
    tabStateService = inject(TabStateService);
    private notificationService = inject(NotificationService);

    sortedCapsules = computed(() => {
        return [...this.tabStateService.capsules()].sort((a, b) => b.createdAt - a.createdAt);
    });

    newCapsuleName = signal<string>('');
    editingId = signal<string | null>(null);
    editNameValue = signal<string>('');
    deletingCapsuleId = signal<string | null>(null);

    selectedCapsuleIds = signal<Set<string>>(new Set());
    isBatchDeleting = signal<boolean>(false);

    isAllSelected = computed(() => {
        const list = this.sortedCapsules();
        return list.length > 0 && this.selectedCapsuleIds().size === list.length;
    });

    toggleSelectCapsule(id: string) {
        const next = new Set(this.selectedCapsuleIds());
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        this.selectedCapsuleIds.set(next);
    }

    toggleSelectAll() {
        if (this.isAllSelected()) {
            this.selectedCapsuleIds.set(new Set());
        } else {
            this.selectedCapsuleIds.set(new Set(this.sortedCapsules().map(c => c.id)));
        }
    }

    async deleteSelectedCapsules() {
        const ids = Array.from(this.selectedCapsuleIds());
        if (ids.length === 0 || this.isBatchDeleting()) return;

        const count = ids.length;
        const confirmMsg = `Are you sure you want to delete ${count} selected capsule${count > 1 ? 's' : ''}? This action cannot be undone.`;
        if (!window.confirm(confirmMsg)) return;

        this.isBatchDeleting.set(true);
        try {
            await this.tabStateService.batchDeleteCapsules(ids);
            this.selectedCapsuleIds.set(new Set());
            this.notificationService.notify(`Successfully deleted ${count} capsule${count > 1 ? 's' : ''}.`);
        } catch (e: any) {
            this.notificationService.notify(`Failed to delete capsules: ${e?.message || 'Unknown error'}`);
        } finally {
            this.isBatchDeleting.set(false);
        }
    }

    async createCapsule() {
        const name = this.newCapsuleName().trim();
        if (!name) return;
        await this.tabStateService.createCapsule(name);
        this.notificationService.notify(`Capsule "${name}" created successfully.`);
        this.newCapsuleName.set('');
    }

    async deleteCapsule(item: Capsule) {
        if (this.deletingCapsuleId()) return;

        const isActive = item.id === this.tabStateService.activeCapsuleId();
        const isLast = this.tabStateService.capsules().length <= 1;

        let confirmMsg = `Are you sure you want to delete capsule "${item.name}"?`;
        if (isActive && isLast) {
            confirmMsg = `Are you sure you want to delete "${item.name}"? It is currently open and the only remaining capsule.`;
        } else if (isActive) {
            confirmMsg = `Capsule "${item.name}" is currently open and active. Are you sure you want to delete it?`;
        } else if (isLast) {
            confirmMsg = `Are you sure you want to delete "${item.name}"? This is your last remaining capsule.`;
        }

        if (!window.confirm(confirmMsg)) {
            return;
        }

        this.deletingCapsuleId.set(item.id);
        try {
            await this.tabStateService.deleteCapsule(item.id);
            this.notificationService.notify(`Capsule "${item.name}" deleted successfully.`);
        } catch (e: any) {
            this.notificationService.notify(`Failed to delete capsule: ${e?.message || 'Unknown error'}`);
        } finally {
            this.deletingCapsuleId.set(null);
        }
    }

    startEdit(item: Capsule) {
        this.editingId.set(item.id);
        this.editNameValue.set(item.name);
    }

    async saveEdit() {
        const id = this.editingId();
        const newName = this.editNameValue().trim();
        if (!id || !newName) return;
        await this.tabStateService.renameCapsule(id, newName);
        this.editingId.set(null);
    }

    cancelEdit() {
        this.editingId.set(null);
    }
}
