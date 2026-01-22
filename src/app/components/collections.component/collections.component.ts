import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

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
    collections = signal<Collection[]>([
        { id: '1', name: 'My Collection', createdAt: Date.now() - 10000 },
        { id: '2', name: 'API Project A', createdAt: Date.now() - 5000 },
        { id: '3', name: 'Personal Sandbox', createdAt: Date.now() }
    ]);

    sortedCollections = computed(() => {
        return [...this.collections()].sort((a, b) => b.createdAt - a.createdAt);
    });

    newCollectionName = signal<string>('');
    editingId = signal<string | null>(null);
    editNameValue = signal<string>('');

    createCollection() {
        if (!this.newCollectionName().trim()) return;
        const newId = Math.random().toString(36).substring(7);
        this.collections.update(c => [...c, {
            id: newId,
            name: this.newCollectionName(),
            createdAt: Date.now()
        }]);
        this.newCollectionName.set('');
    }

    deleteCollection(id: string) {
        this.collections.update(c => c.filter(item => item.id !== id));
    }

    startEdit(item: Collection) {
        this.editingId.set(item.id);
        this.editNameValue.set(item.name);
    }

    saveEdit() {
        if (!this.editingId()) return;
        this.collections.update(c => c.map(item =>
            item.id === this.editingId() ? { ...item, name: this.editNameValue() } : item
        ));
        this.editingId.set(null);
    }

    cancelEdit() {
        this.editingId.set(null);
    }
}
