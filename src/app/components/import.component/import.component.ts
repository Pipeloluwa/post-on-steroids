import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState } from '../../shared/services/tab.state.service';
import { SwaggerImportModalComponent } from '../../shared/components/swagger-import.modal.component/swagger-import.modal.component';

@Component({
    selector: 'app-import-component',
    imports: [CommonModule, MatIcon, SwaggerImportModalComponent],
    templateUrl: './import.component.html',
    styleUrl: './import.component.css'
})
export class ImportComponent {
    tabStateService = inject(TabStateService);
    
    importStatus = signal<string>('');
    importError = signal<boolean>(false);
    private importStatusTimeout: number | null = null;

    onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (!input.files?.length) return;

        const file = input.files[0];
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const data = JSON.parse(content);
                
                this.processImportData(data);
                
                this.showStatus('Import successful! Your capsules and requests have been loaded.', false);
            } catch (err) {
                console.error('Import failed:', err);
                this.showStatus('Invalid file format. Please upload a valid OnSteroids JSON export file.', true);
            }
            
            // Reset input so the same file can be selected again if needed
            input.value = '';
        };

        reader.onerror = () => {
            this.showStatus('Failed to read the file.', true);
        };

        reader.readAsText(file);
    }

    onSwaggerImportStatus(event: { message: string; isError: boolean }) {
        this.showStatus(event.message, event.isError);
    }

    private showStatus(message: string, isError: boolean) {
        if (this.importStatusTimeout) {
            window.clearTimeout(this.importStatusTimeout);
        }
        this.importStatus.set(message);
        this.importError.set(isError);
        this.importStatusTimeout = window.setTimeout(() => {
            this.importStatus.set('');
            this.importError.set(false);
            this.importStatusTimeout = null;
        }, 10000);
    }

    private processImportData(data: any) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid JSON structure');
        }

        let importedRequests: RequestState[] = [];

        // Support both export formats from ExportComponent
        if (data.capsules && Array.isArray(data.capsules)) {
            data.capsules.forEach((capsule: any) => {
                if (capsule.requests && Array.isArray(capsule.requests)) {
                    importedRequests.push(...capsule.requests);
                }
            });
        }

        if (importedRequests.length > 0) {
            this.tabStateService.savedCapsules.update(existing => {
                // simple merge, avoiding duplicates by ID
                const existingMap = new Map(existing.map(r => [r.id, r]));
                importedRequests.forEach(req => {
                    // Overwrite if exists, otherwise add
                    existingMap.set(req.id, req);
                });
                return Array.from(existingMap.values());
            });
        }
    }
}
