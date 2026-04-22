import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TabStateService } from '../../shared/services/tab.state.service';

@Component({
    selector: 'app-export-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './export.component.html',
    styleUrl: './export.component.css'
})
export class ExportComponent {
    tabStateService = inject(TabStateService);
    
    // Mock collections for UI - in real app would come from a service
    collections = signal([
        { id: '1', name: 'My Collection', createdAt: Date.now() - 10000 },
        { id: '2', name: 'API Project A', createdAt: Date.now() - 5000 },
        { id: '3', name: 'Personal Sandbox', createdAt: Date.now() }
    ]);

    selectedCollections = signal<Set<string>>(new Set());

    toggleSelection(id: string) {
        this.selectedCollections.update(set => {
            const newSet = new Set(set);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }

    exportSelected() {
        const selectedIds = this.selectedCollections();
        const selectedData = this.collections().filter(c => selectedIds.has(c.id));
        
        const exportData = {
            version: "1.0.0",
            exportedAt: new Date().toISOString(),
            collections: selectedData.map(c => ({
                id: c.id,
                name: c.name,
                requests: this.tabStateService.savedCollection().filter(r => r.name === c.name)
            }))
        };

        this.downloadJson(exportData, `collections_export_${new Date().getTime()}.json`);
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
    exportAsJson() {
        const data = {
            name: "PostOnSteroids-Export",
            exportedAt: new Date().toISOString(),
            collections: []
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `postonsteroids_export_${new Date().getTime()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }
}
