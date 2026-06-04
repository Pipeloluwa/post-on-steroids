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

    createCapsule() {
        if (!this.newCapsuleName().trim()) return;
        const newId = Math.random().toString(36).substring(7);
        this.tabStateService.capsules.update(c => [...c, {
            id: newId,
            name: this.newCapsuleName(),
            createdAt: Date.now()
        }]);
        this.newCapsuleName.set('');
    }

    deleteCapsule(id: string) {
        this.tabStateService.capsules.update(c => c.filter(item => item.id !== id));
    }

    startEdit(item: Capsule) {
        this.editingId.set(item.id);
        this.editNameValue.set(item.name);
    }

    saveEdit() {
        if (!this.editingId()) return;
        this.tabStateService.capsules.update(c => c.map(item =>
            item.id === this.editingId() ? { ...item, name: this.editNameValue() } : item
        ));
        this.editingId.set(null);
    }

    cancelEdit() {
        this.editingId.set(null);
    }
}
