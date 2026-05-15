import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

import { TabStateService } from '../../shared/services/tab.state.service';
import { inject } from '@angular/core';

interface Collection {
    id: string;
    name: string;
    createdAt: number;
}

@Component({
    selector: 'app-collections-component',
    imports: [CommonModule, MatIcon, FormsModule],
    templateUrl: './collections.component.html',
    styleUrl: './collections.component.css'
})
export class CollectionsComponent {
    tabStateService = inject(TabStateService);
    capsules = signal<Collection[]>([
        { id: '1', name: 'My Capsule', createdAt: Date.now() - 10000 },
        { id: '2', name: 'API Project A', createdAt: Date.now() - 5000 },
        { id: '3', name: 'Personal Sandbox', createdAt: Date.now() }
    ]);

    sortedCapsules = computed(() => {
        return [...this.capsules()].sort((a, b) => b.createdAt - a.createdAt);
    });

    newCapsuleName = signal<string>('');
    editingId = signal<string | null>(null);
    editNameValue = signal<string>('');

    createCapsule() {
        if (!this.newCapsuleName().trim()) return;
        const newId = Math.random().toString(36).substring(7);
        this.capsules.update(c => [...c, {
            id: newId,
            name: this.newCapsuleName(),
            createdAt: Date.now()
        }]);
        this.newCapsuleName.set('');
    }

    deleteCapsule(id: string) {
        this.capsules.update(c => c.filter(item => item.id !== id));
    }

    startEdit(item: Collection) {
        this.editingId.set(item.id);
        this.editNameValue.set(item.name);
    }

    saveEdit() {
        if (!this.editingId()) return;
        this.capsules.update(c => c.map(item =>
            item.id === this.editingId() ? { ...item, name: this.editNameValue() } : item
        ));
        this.editingId.set(null);
    }

    cancelEdit() {
        this.editingId.set(null);
    }
}
