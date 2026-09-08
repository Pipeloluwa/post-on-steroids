import { Component, ChangeDetectionStrategy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState } from '../../shared/services/tab.state.service';
import { SwaggerImportModalComponent } from '../../shared/components/swagger-import.modal.component/swagger-import.modal.component';

interface ParsedCapsuleGroup {
    name: string;
    requests: Partial<RequestState>[];
}

@Component({
    selector: 'app-import-component',
    imports: [CommonModule, FormsModule, MatIcon, SwaggerImportModalComponent],
    templateUrl: './import.component.html',
    styleUrl: './import.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ImportComponent implements OnInit {
    tabStateService = inject(TabStateService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    
    importStatus = signal<string>('');
    importError = signal<boolean>(false);
    isImporting = signal<boolean>(false);
    private importStatusTimeout: number | null = null;

    showShareUrlModal = signal<boolean>(false);
    shareUrlInput = signal<string>('');

    ngOnInit() {
        this.route.queryParams.subscribe(params => {
            if (params['share']) {
                this.shareUrlInput.set(params['share']);
                this.showShareUrlModal.set(true);
            }
        });
    }

    async importFromShareLink() {
        const input = this.shareUrlInput().trim();
        if (!input || this.isImporting()) return;

        this.isImporting.set(true);
        try {
            const res = await this.tabStateService.importCapsuleFromUrl(input);
            this.showStatus(`Successfully imported capsule "${res.capsuleName}" with ${res.requestsCount} request(s)!`, false);
            this.showShareUrlModal.set(false);
            this.shareUrlInput.set('');
        } catch (err: any) {
            console.error('Import from share link failed:', err);
            this.showStatus(err?.message || 'Failed to import shared capsule. Link may be invalid or expired.', true);
        } finally {
            this.isImporting.set(false);
        }
    }

    onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (!input.files?.length) return;

        const file = input.files[0];
        const reader = new FileReader();

        reader.onload = async (e) => {
            try {
                this.isImporting.set(true);
                const content = e.target?.result as string;
                const data = JSON.parse(content);
                
                const count = await this.processImportData(data);
                
                this.showStatus(`Import successful! Imported ${count.capsules} capsule(s) and ${count.requests} request(s).`, false);
            } catch (err: any) {
                console.error('Import failed:', err);
                const msg = err?.message || 'Invalid file format. Please upload an OnSteroids export file or a Postman Collection JSON.';
                this.showStatus(msg, true);
            } finally {
                this.isImporting.set(false);
                input.value = '';
            }
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

    private async processImportData(data: any): Promise<{ capsules: number; requests: number }> {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid JSON structure');
        }

        const groups: ParsedCapsuleGroup[] = [];

        // 1. Postman Collection Format (v2.0 / v2.1)
        if (data.info && Array.isArray(data.item)) {
            const collectionName = data.info.name || 'Imported Postman Collection';
            const postmanReqs = this.flattenPostmanItems(data.item);
            const mapped = postmanReqs.map(it => this.mapPostmanRequest(it));
            groups.push({
                name: collectionName,
                requests: mapped
            });
        }
        // 2. OnSteroids Multi-Capsule Format
        else if (data.capsules && Array.isArray(data.capsules)) {
            for (const cap of data.capsules) {
                const capName = cap.name || 'Imported Capsule';
                const reqs = Array.isArray(cap.requests) ? cap.requests : [];
                groups.push({
                    name: capName,
                    requests: reqs
                });
            }
        }
        // 3. OnSteroids Single Capsule Format
        else if (data.collection && Array.isArray(data.requests)) {
            groups.push({
                name: data.collection,
                requests: data.requests
            });
        }
        // 4. Raw Array of Requests
        else if (Array.isArray(data)) {
            groups.push({
                name: 'Imported Requests',
                requests: data
            });
        }
        else {
            throw new Error('Unrecognized format. Please provide an OnSteroids export JSON or a Postman Collection (v2.0/v2.1).');
        }

        let totalRequests = 0;

        for (const group of groups) {
            // Create or switch to the capsule
            const createdCap = await this.tabStateService.createCapsule(group.name);
            const createdRequests: RequestState[] = [];

            for (const rawReq of group.requests) {
                const reqId = this.tabStateService.createId();
                const baseState = this.tabStateService.getDefaultState(reqId);
                
                const finalState: RequestState = {
                    ...baseState,
                    ...rawReq,
                    id: reqId,
                    capsuleId: createdCap.id,
                    name: rawReq.name || 'Imported Request',
                    url: rawReq.url || '',
                    method: (rawReq.method || 'GET').toUpperCase(),
                    isDirty: false
                };

                this.tabStateService.addOpenTab(finalState);
                createdRequests.push(finalState);
                totalRequests++;

                // Persist to backend if logged in
                await this.tabStateService.saveToCapsule(reqId);
            }

            if (createdRequests.length > 0) {
                this.tabStateService.savedCapsules.set(createdRequests);
                this.tabStateService.setActiveTab(createdRequests[0].id);
            }
        }

        return { capsules: groups.length, requests: totalRequests };
    }

    private flattenPostmanItems(items: any[]): { name: string; request: any }[] {
        const results: { name: string; request: any }[] = [];

        for (const item of items) {
            if (item.request) {
                results.push({
                    name: item.name || 'Request',
                    request: item.request
                });
            }
            if (Array.isArray(item.item) && item.item.length > 0) {
                results.push(...this.flattenPostmanItems(item.item));
            }
        }

        return results;
    }

    private mapPostmanRequest(item: { name: string; request: any }): Partial<RequestState> {
        const req = item.request;
        const method = typeof req === 'string' ? 'GET' : (req.method || 'GET').toUpperCase();

        // Extract URL
        let url = '';
        const params: { enabled: boolean; key: string; value: string }[] = [];

        if (typeof req === 'string') {
            url = req;
        } else if (typeof req?.url === 'string') {
            url = req.url;
        } else if (req?.url && typeof req.url === 'object') {
            url = req.url.raw || '';
            if (Array.isArray(req.url.query)) {
                for (const q of req.url.query) {
                    params.push({
                        enabled: !q.disabled,
                        key: q.key || '',
                        value: q.value || ''
                    });
                }
            }
        }

        if (params.length === 0) {
            params.push({ enabled: true, key: '', value: '' });
        }

        // Extract Headers
        const headers: { enabled: boolean; key: string; value: string }[] = [];
        if (Array.isArray(req?.header)) {
            for (const h of req.header) {
                headers.push({
                    enabled: !h.disabled,
                    key: h.key || '',
                    value: h.value || ''
                });
            }
        }
        if (headers.length === 0) {
            headers.push({ enabled: true, key: 'Accept', value: 'application/json' }, { enabled: true, key: '', value: '' });
        }

        // Extract Body
        let bodyType = 'none';
        let rawType = 'JSON';
        let rawBody = '{}';
        let rawBodyJson = '{}';
        let rawBodyXml = '';
        const formData: { enabled: boolean; key: string; value: string; type: 'text' | 'file' }[] = [];

        if (req?.body) {
            const mode = req.body.mode;
            if (mode === 'raw') {
                bodyType = 'raw';
                rawBody = req.body.raw || '';
                const lang = req.body.options?.raw?.language;
                if (lang === 'xml') {
                    rawType = 'XML';
                    rawBodyXml = rawBody;
                } else {
                    rawType = 'JSON';
                    rawBodyJson = rawBody;
                }
            } else if (mode === 'formdata' && Array.isArray(req.body.formdata)) {
                bodyType = 'formData';
                for (const f of req.body.formdata) {
                    formData.push({
                        enabled: !f.disabled,
                        key: f.key || '',
                        value: f.value || '',
                        type: f.type === 'file' ? 'file' : 'text'
                    });
                }
            }
        }

        if (formData.length === 0) {
            formData.push({ enabled: true, key: '', value: '', type: 'text' });
        }

        // Extract Auth
        let authType: 'none' | 'bearer' | 'basic' = 'none';
        let authToken = '';
        if (req?.auth) {
            if (req.auth.type === 'bearer') {
                authType = 'bearer';
                const tokenObj = req.auth.bearer?.find((b: any) => b.key === 'token') || req.auth.bearer?.[0];
                authToken = tokenObj?.value || '';
            } else if (req.auth.type === 'basic') {
                authType = 'basic';
            }
        }

        return {
            name: item.name,
            url,
            method,
            payloadType: 'params',
            params,
            headers,
            bodyType,
            rawType,
            rawBody,
            rawBodyJson,
            rawBodyXml,
            formData,
            auth: {
                type: authType,
                token: authToken
            }
        };
    }
}
