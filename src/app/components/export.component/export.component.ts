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
        const allSavedRequests = this.tabStateService.savedCapsules();
        
        for (const capsule of selectedData) {
            const requests = capsule.id === activeId
                ? this.tabStateService.allCapsuleRequests()
                : allSavedRequests.filter(r => r.capsuleId === capsule.id);

            const exportData = {
                version: "1.0.0",
                exportedAt: new Date().toISOString(),
                capsules: [{
                    id: capsule.id,
                    name: capsule.name,
                    requests: requests
                }]
            };

            const safeName = capsule.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'capsule';
            this.downloadJson(exportData, `${safeName}_export_${new Date().getTime()}.json`);
        }
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
        const activeId = this.tabStateService.activeCapsuleId();
        const allSavedRequests = this.tabStateService.savedCapsules();
        
        for (const capsule of this.capsules()) {
            const requests = capsule.id === activeId
                ? this.tabStateService.allCapsuleRequests()
                : allSavedRequests.filter(r => r.capsuleId === capsule.id);

            const exportData = {
                version: "1.0.0",
                exportedAt: new Date().toISOString(),
                capsules: [{
                    id: capsule.id,
                    name: capsule.name,
                    requests: requests
                }]
            };

            const safeName = capsule.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'capsule';
            this.downloadJson(exportData, `${safeName}_export_${new Date().getTime()}.json`);
        }
    }
}
