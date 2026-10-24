import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TabStateService } from '../../shared/services/tab.state.service';
import { VariableService } from '../../shared/services/variable.service';

@Component({
    selector: 'app-export-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './export.component.html',
    styleUrl: './export.component.css'
})
export class ExportComponent {
    tabStateService = inject(TabStateService);
    private variableService = inject(VariableService);
    
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

    isExporting = signal<boolean>(false);

    async exportSelected() {
        const selectedIds = this.selectedCapsules();
        const selectedData = this.capsules().filter(c => selectedIds.has(c.id));
        if (selectedData.length === 0 || this.isExporting()) return;

        this.isExporting.set(true);
        try {
            const exportedCapsules = [];
            for (const capsule of selectedData) {
                const requests = await this.tabStateService.getCapsuleRequests(capsule.id);
                const vars = capsule.id === this.tabStateService.activeCapsuleId()
                    ? this.variableService.variables()
                    : this.variableService.getCachedVariablesForCapsule(capsule.id);

                exportedCapsules.push({
                    id: capsule.id,
                    name: capsule.name,
                    requests,
                    variables: vars
                });
            }

            const allExtractedVars = exportedCapsules.flatMap(c => c.variables || []);

            if (exportedCapsules.length === 1) {
                const single = exportedCapsules[0];
                const exportData = {
                    version: "1.0.0",
                    collection: single.name,
                    capsule: single.name,
                    exportedAt: new Date().toISOString(),
                    capsules: [single],
                    requests: single.requests,
                    variables: single.variables
                };
                const safeName = single.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'capsule';
                this.downloadJson(exportData, `${safeName}_export_${Date.now()}.json`);
            } else {
                const exportData = {
                    version: "1.0.0",
                    exportedAt: new Date().toISOString(),
                    capsules: exportedCapsules,
                    variables: allExtractedVars
                };
                this.downloadJson(exportData, `onsteroid_capsules_export_${Date.now()}.json`);
            }
        } finally {
            this.isExporting.set(false);
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

    async exportAsJson() {
        const allCapsules = this.capsules();
        if (allCapsules.length === 0 || this.isExporting()) return;

        this.isExporting.set(true);
        try {
            const exportedCapsules = [];
            for (const capsule of allCapsules) {
                const requests = await this.tabStateService.getCapsuleRequests(capsule.id);
                const vars = capsule.id === this.tabStateService.activeCapsuleId()
                    ? this.variableService.variables()
                    : this.variableService.getCachedVariablesForCapsule(capsule.id);

                exportedCapsules.push({
                    id: capsule.id,
                    name: capsule.name,
                    requests,
                    variables: vars
                });
            }

            const allExtractedVars = exportedCapsules.flatMap(c => c.variables || []);

            const exportData = {
                version: "1.0.0",
                exportedAt: new Date().toISOString(),
                capsules: exportedCapsules,
                variables: allExtractedVars
            };

            this.downloadJson(exportData, `onsteroid_all_capsules_export_${Date.now()}.json`);
        } finally {
            this.isExporting.set(false);
        }
    }
}
