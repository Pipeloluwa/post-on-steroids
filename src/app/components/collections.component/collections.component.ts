import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

import { TabStateService, Capsule } from '../../shared/services/tab.state.service';
import { inject } from '@angular/core';

@Component({
    selector: 'app-collections-component',
    imports: [CommonModule, MatIcon, FormsModule],
    templateUrl: './collections.component.html',
    styleUrl: './collections.component.css'
})
export class CollectionsComponent {
    tabStateService = inject(TabStateService);
    sortedCapsules = computed(() => {
        return [...this.tabStateService.capsules()].sort((a, b) => b.createdAt - a.createdAt);
    });

    newCapsuleName = signal<string>('');
    editingId = signal<string | null>(null);
    editNameValue = signal<string>('');

    async createCapsule() {
        const name = this.newCapsuleName().trim();
        if (!name) return;
        await this.tabStateService.createCapsule(name);
        this.newCapsuleName.set('');
    }

    async deleteCapsule(id: string) {
        await this.tabStateService.deleteCapsule(id);
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
