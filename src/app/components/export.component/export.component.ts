import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-export-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './export.component.html',
    styleUrl: './export.component.css'
})
export class ExportComponent {
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
