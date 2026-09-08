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
    
    capsules = this.tabStateService.capsules;

    selectedCapsules = signal<Set<string>>(new Set());

    toggleSelection(id: string) {
        this.selectedCapsules.update(set => {
            const newSet = new Set(set);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }

    exportSelected() {
        const selectedIds = this.selectedCapsules();
        const selectedData = this.capsules().filter(c => selectedIds.has(c.id));
        const activeId = this.tabStateService.activeCapsuleId();
        const activeRequests = this.tabStateService.savedCapsules();
        
        const exportData = {
            version: "1.0.0",
            exportedAt: new Date().toISOString(),
            capsules: selectedData.map(c => ({
                id: c.id,
                name: c.name,
                requests: c.id === activeId
                    ? activeRequests
                    : activeRequests.filter(r => r.capsuleId === c.id)
            }))
        };

        this.downloadJson(exportData, `capsules_export_${new Date().getTime()}.json`);
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
            name: "OnSteroids-Export",
            exportedAt: new Date().toISOString(),
            capsules: []
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `onsteroids_export_${new Date().getTime()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }
}
