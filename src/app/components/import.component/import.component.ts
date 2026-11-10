import { Component, ChangeDetectionStrategy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState, RequestGroup } from '../../shared/services/tab.state.service';
import { AuthService } from '../../shared/services/auth.service';
import { SwaggerImportModalComponent } from '../../shared/components/swagger-import.modal.component/swagger-import.modal.component';
import { IGlobalVariable } from '../../interfaces/services/IVariableService';
import { extractPostmanVariables, extractRequestsVariables } from '../../shared/utils/import-variable.util';

interface ParsedCapsuleGroup {
    name: string;
    autoAuthEnabled?: string;
    autoAuthEndpointId?: string | null;
    requests: (Partial<RequestState> & { __folderName?: string })[];
    groups?: any[];
    requestOrder?: string[];
    variables?: IGlobalVariable[];
    variableSources?: Record<string, any>;
}

export interface PendingImport {
    fileName: string;
    capsulesCount: number;
    requestsCount: number;
    variablesCount: number;
    capsuleNames: string[];
    payload: {
        capsules: {
            id: string;
            name: string;
            autoAuthEnabled?: string;
            autoAuthEndpointId?: string | null;
            variables: IGlobalVariable[];
            variableSources?: Record<string, any>;
            requests: RequestState[];
            groups?: RequestGroup[];
            requestOrder?: string[];
        }[];
        variables: IGlobalVariable[];
    };
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
    authService = inject(AuthService);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    
    importStatus = signal<string>('');
    importError = signal<boolean>(false);
    isImporting = signal<boolean>(false);
    private importStatusTimeout: number | null = null;

    showShareUrlModal = signal<boolean>(false);
    shareUrlInput = signal<string>('');

    showSavePrompt = signal<boolean>(false);
    pendingImport = signal<PendingImport | null>(null);

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

        reader.onload = (e) => {
            try {
                const content = e.target?.result as string;
                const data = JSON.parse(content);
                const pending = this.prepareImportData(data, file.name);
                
                this.pendingImport.set(pending);
                this.showSavePrompt.set(true);
            } catch (err: any) {
                console.error('Import validation failed:', err);
                const msg = err?.message || 'Invalid file format. Please upload an OnSteroid export file or a Postman Collection JSON.';
                this.showStatus(msg, true);
            } finally {
                input.value = '';
            }
        };

        reader.onerror = () => {
            this.showStatus('Failed to read the file.', true);
            input.value = '';
        };

        reader.readAsText(file);
    }

    async confirmImport(saveToBackend: boolean) {
        const pending = this.pendingImport();
        if (!pending || this.isImporting()) return;

        this.showSavePrompt.set(false);
        this.isImporting.set(true);

        try {
            const count = await this.tabStateService.importData(pending.payload, { saveToBackend });
            const destination = saveToBackend ? 'and saved to cloud database' : 'into local workspace (not saved to cloud)';
            this.showStatus(`Import successful! Imported ${count.capsulesCount} capsule(s) and ${count.requestsCount} request(s) ${destination}.`, false);
        } catch (err: any) {
            console.error('Import failed:', err);
            const msg = err?.message || 'Failed to complete import.';
            this.showStatus(msg, true);
        } finally {
            this.isImporting.set(false);
            this.pendingImport.set(null);
        }
    }

    cancelImport() {
        this.showSavePrompt.set(false);
        this.pendingImport.set(null);
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

    private prepareImportData(data: any, fileName: string): PendingImport {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid JSON structure');
        }

        const groups: ParsedCapsuleGroup[] = [];

        // 1. Postman Collection Format (v2.0 / v2.1)
        if (data.info && Array.isArray(data.item)) {
            const collectionName = data.info.name || 'Imported Postman Collection';
            const postmanReqs = this.flattenPostmanItems(data.item);
            const mapped = postmanReqs.map(it => ({
                ...this.mapPostmanRequest(it),
                __folderName: it.folderName
            }));
            const extractedVars = extractPostmanVariables(data);
            groups.push({
                name: collectionName,
                requests: mapped,
                variables: extractedVars
            });
        }
        // 2. OnSteroid Multi-Capsule Format: data.capsules (array or object)
        else if (data.capsules && (Array.isArray(data.capsules) || typeof data.capsules === 'object')) {
            const capList = Array.isArray(data.capsules) ? data.capsules : [data.capsules];
            for (const cap of capList) {
                if (!cap) continue;
                const capName = cap.name || cap.collection || cap.capsule || cap.title || 'Imported Capsule';
                const reqs = Array.isArray(cap.requests) ? cap.requests : (Array.isArray(cap.items) ? cap.items : []);
                const explicitVars = cap.variables || cap.variable || data.variables || data.variable;
                const explicitSources = cap.variableSources || data.variableSources;
                const extractedVars = extractRequestsVariables(reqs, explicitVars, explicitSources);
                groups.push({
                    name: capName,
                    autoAuthEnabled: cap.autoAuthEnabled || data.autoAuthEnabled || 'off',
                    autoAuthEndpointId: cap.autoAuthEndpointId ?? data.autoAuthEndpointId ?? null,
                    requests: reqs,
                    groups: Array.isArray(cap.groups) ? cap.groups : (Array.isArray(data.groups) ? data.groups : undefined),
                    requestOrder: Array.isArray(cap.requestOrder) ? cap.requestOrder : (Array.isArray(data.requestOrder) ? data.requestOrder : undefined),
                    variables: extractedVars,
                    variableSources: explicitSources
                });
            }
        }
        // 3. Single Capsule Format with direct requests/items array
        else if (Array.isArray(data.requests) || Array.isArray(data.items)) {
            const reqs = Array.isArray(data.requests) ? data.requests : data.items;
            const capName = data.collection || data.capsule || data.capsuleName || data.collectionName || data.name || (data.capsule && data.capsule.name) || 'Imported Capsule';
            const explicitVars = data.variables || data.variable || (data.capsule && data.capsule.variables);
            const explicitSources = data.variableSources || (data.capsule && data.capsule.variableSources);
            const extractedVars = extractRequestsVariables(reqs, explicitVars, explicitSources);
            groups.push({
                name: typeof capName === 'string' ? capName : 'Imported Capsule',
                autoAuthEnabled: data.autoAuthEnabled || (data.capsule && data.capsule.autoAuthEnabled) || 'off',
                autoAuthEndpointId: data.autoAuthEndpointId ?? (data.capsule && data.capsule.autoAuthEndpointId) ?? null,
                requests: reqs,
                groups: Array.isArray(data.groups) ? data.groups : undefined,
                requestOrder: Array.isArray(data.requestOrder) ? data.requestOrder : undefined,
                variables: extractedVars,
                variableSources: explicitSources
            });
        }
        // 4. Nested capsule object: { capsule: { name: "...", requests: [...] } }
        else if (data.capsule && typeof data.capsule === 'object' && !Array.isArray(data.capsule)) {
            const cap = data.capsule;
            const capName = cap.name || cap.collection || 'Imported Capsule';
            const reqs = Array.isArray(cap.requests) ? cap.requests : (Array.isArray(cap.items) ? cap.items : []);
            const explicitVars = cap.variables || cap.variable || data.variables || data.variable;
            const explicitSources = cap.variableSources || data.variableSources;
            const extractedVars = extractRequestsVariables(reqs, explicitVars, explicitSources);
            groups.push({
                name: capName,
                autoAuthEnabled: cap.autoAuthEnabled || data.autoAuthEnabled || 'off',
                autoAuthEndpointId: cap.autoAuthEndpointId ?? data.autoAuthEndpointId ?? null,
                requests: reqs,
                groups: Array.isArray(cap.groups) ? cap.groups : undefined,
                requestOrder: Array.isArray(cap.requestOrder) ? cap.requestOrder : undefined,
                variables: extractedVars,
                variableSources: explicitSources
            });
        }
        // 5. Raw Array of Requests
        else if (Array.isArray(data)) {
            const extractedVars = extractRequestsVariables(data);
            groups.push({
                name: 'Imported Requests',
                requests: data,
                variables: extractedVars
            });
        }
        // 6. Single Endpoint / Request JSON (e.g. from "Export Endpoint")
        else if (data.url !== undefined && (data.method !== undefined || data.headers !== undefined)) {
            const extractedVars = extractRequestsVariables([data], data.variables, data.variableSources);
            groups.push({
                name: data.name || 'Imported Endpoint',
                requests: [data],
                variables: extractedVars,
                variableSources: data.variableSources
            });
        }
        else {
            throw new Error('Unrecognized format. Please provide an OnSteroid export JSON or a Postman Collection (v2.0/v2.1).');
        }

        const allExtractedVars = groups.flatMap(g => g.variables || []);

        const importPayload = {
            capsules: groups.map(group => {
                const capId = this.tabStateService.createId();
                const oldReqIdMap = new Map<string, string>();
                const folderNameMap = new Map<string, RequestGroup>();

                const normalizedRequests = group.requests.map(rawReq => {
                    const norm = this.normalizeImportedRequest(rawReq, capId);
                    if (rawReq?.id) {
                        oldReqIdMap.set(String(rawReq.id), norm.id);
                    }
                    const folderName = (rawReq as any)?.__folderName;
                    if (folderName) {
                        let fGrp = folderNameMap.get(folderName);
                        if (!fGrp) {
                            fGrp = {
                                id: 'grp_' + this.tabStateService.createId(),
                                name: folderName,
                                capsuleId: capId,
                                isExpanded: true,
                                requestIds: [],
                                createdAt: Date.now()
                            };
                            folderNameMap.set(folderName, fGrp);
                        }
                        fGrp.requestIds.push(norm.id);
                        norm.groupId = fGrp.id;
                    }
                    return norm;
                });

                // Second pass: remap postTriggerTabId across normalized requests
                for (const norm of normalizedRequests) {
                    if (norm.postTriggerTabId) {
                        norm.postTriggerTabId = oldReqIdMap.get(norm.postTriggerTabId) || norm.postTriggerTabId;
                    }
                }

                const remappedAutoAuthEndpointId = group.autoAuthEndpointId
                    ? (oldReqIdMap.get(group.autoAuthEndpointId) || group.autoAuthEndpointId)
                    : null;

                let finalGroups: RequestGroup[] = Array.from(folderNameMap.values());
                if (finalGroups.length === 0 && Array.isArray(group.groups) && group.groups.length > 0) {
                    finalGroups = group.groups.map((g: any) => ({
                        id: 'grp_' + this.tabStateService.createId(),
                        name: g.name || 'Folder',
                        capsuleId: capId,
                        isExpanded: g.isExpanded ?? true,
                        requestIds: (g.requestIds || []).map((oldId: string) => oldReqIdMap.get(oldId) || oldId),
                        createdAt: Date.now()
                    }));
                }

                const finalRequestOrder = Array.isArray(group.requestOrder)
                    ? group.requestOrder.map((oldId: string) => oldReqIdMap.get(oldId) || oldId)
                    : undefined;

                // Remap variable sources (tabId / requestId) using oldReqIdMap
                const remappedVarSources: Record<string, any> = {};
                if (group.variableSources && typeof group.variableSources === 'object') {
                    for (const [k, src] of Object.entries(group.variableSources)) {
                        if (src && typeof src === 'object') {
                            const clonedSrc = { ...src, capsuleId: capId };
                            if (clonedSrc.tabId) clonedSrc.tabId = oldReqIdMap.get(clonedSrc.tabId) || clonedSrc.tabId;
                            if (clonedSrc.requestId) clonedSrc.requestId = oldReqIdMap.get(clonedSrc.requestId) || clonedSrc.requestId;
                            remappedVarSources[k.toLowerCase()] = clonedSrc;
                        }
                    }
                }

                const remappedVars = (group.variables || []).map(v => {
                    const kLower = (v.key || '').trim().toLowerCase();
                    let src = v.source ? { ...v.source, capsuleId: capId } : remappedVarSources[kLower];
                    if (src) {
                        if (src.tabId) src.tabId = oldReqIdMap.get(src.tabId) || src.tabId;
                        if (src.requestId) src.requestId = oldReqIdMap.get(src.requestId) || src.requestId;
                        remappedVarSources[kLower] = src;
                    }
                    return { ...v, ...(src ? { source: src } : {}) };
                });

                return {
                    id: capId,
                    name: group.name,
                    autoAuthEnabled: group.autoAuthEnabled || 'off',
                    autoAuthEndpointId: remappedAutoAuthEndpointId,
                    variables: remappedVars,
                    variableSources: remappedVarSources,
                    requests: normalizedRequests,
                    groups: finalGroups,
                    requestOrder: finalRequestOrder
                };
            }),
            variables: allExtractedVars
        };

        const totalRequests = importPayload.capsules.reduce((sum, c) => sum + c.requests.length, 0);

        return {
            fileName,
            capsulesCount: importPayload.capsules.length,
            requestsCount: totalRequests,
            variablesCount: allExtractedVars.length,
            capsuleNames: importPayload.capsules.map(c => c.name),
            payload: importPayload
        };
    }

    private normalizeImportedRequest(rawReq: any, capId: string): RequestState {
        const reqId = this.tabStateService.createId();
        const baseState = this.tabStateService.getDefaultState(reqId);

        if (!rawReq || typeof rawReq !== 'object') {
            return baseState;
        }

        // Check if rawReq is in backend DTO format (e.g. paramKey, headerKey, preRequestScript)
        const isDto = (
            rawReq.paramKey !== undefined ||
            rawReq.headerKey !== undefined ||
            rawReq.preRequestScript !== undefined ||
            rawReq.authType !== undefined ||
            rawReq.encryptionAlgorithm !== undefined
        );

        if (isDto) {
            const state = this.tabStateService.mapDtoToState({ ...rawReq, capsuleId: capId });
            return {
                ...state,
                id: reqId,
                capsuleId: capId,
                isDirty: false
            };
        }

        // If postman-like raw item with request object: { name, request }
        if (rawReq.request) {
            const mapped = this.mapPostmanRequest(rawReq);
            return {
                ...baseState,
                ...mapped,
                id: reqId,
                capsuleId: capId,
                isDirty: false
            } as RequestState;
        }

        // Normalize params array
        const params = Array.isArray(rawReq.params)
            ? rawReq.params.map((p: any) => ({
                enabled: p.enabled ?? p.isEnabled ?? true,
                key: p.key ?? p.paramKey ?? '',
                value: p.value ?? p.paramValue ?? ''
            }))
            : baseState.params;

        // Normalize headers array
        const headers = Array.isArray(rawReq.headers)
            ? rawReq.headers.map((h: any) => ({
                enabled: h.enabled ?? h.isEnabled ?? true,
                key: h.key ?? h.headerKey ?? '',
                value: h.value ?? h.headerValue ?? ''
            }))
            : baseState.headers;

        // Normalize formData array
        const formData = Array.isArray(rawReq.formData)
            ? rawReq.formData.map((f: any) => ({
                enabled: f.enabled ?? f.isEnabled ?? true,
                key: f.key ?? '',
                value: f.value ?? '',
                type: f.type === 'file' ? 'file' : 'text'
            }))
            : baseState.formData;

        return {
            ...baseState,
            ...rawReq,
            id: reqId,
            capsuleId: capId,
            name: rawReq.name || 'Imported Request',
            url: rawReq.url || '',
            method: (rawReq.method || 'GET').toUpperCase(),
            params,
            headers,
            formData,
            auth: {
                type: rawReq.auth?.type || (rawReq.authType as any) || 'none',
                token: rawReq.auth?.token || rawReq.authToken || ''
            },
            scripts: {
                ...baseState.scripts,
                ...(rawReq.scripts || {}),
                preRequest: rawReq.scripts?.preRequest || rawReq.preRequestScript || '',
                postResponse: rawReq.scripts?.postResponse || rawReq.postResponseScript || '',
                testScript: rawReq.scripts?.testScript || rawReq.testScript || '',
                testScriptEnabled: rawReq.scripts?.testScriptEnabled ?? rawReq.testScriptEnabled ?? false
            },
            encryption: {
                ...baseState.encryption,
                ...(rawReq.encryption || {})
            },
            settings: {
                ...baseState.settings,
                ...(rawReq.settings || {}),
                ...(rawReq.followRedirects !== undefined ? { followRedirects: !!rawReq.followRedirects } : {}),
                ...(rawReq.verifySsl !== undefined ? { verifySsl: !!rawReq.verifySsl } : {}),
                ...(rawReq.enableCookies !== undefined ? { enableCookies: !!rawReq.enableCookies } : {}),
                ...(rawReq.bypassCors !== undefined ? { bypassCors: !!rawReq.bypassCors } : {})
            },
            postTriggerTabId: rawReq.postTriggerTabId || null,
            autoAuthEnabled: !!rawReq.autoAuthEnabled,
            bodyWrapStyle: rawReq.bodyWrapStyle || baseState.bodyWrapStyle,
            responseWrapStyle: rawReq.responseWrapStyle || baseState.responseWrapStyle,
            responseActiveMode: rawReq.responseActiveMode || baseState.responseActiveMode,
            consoleWrap: rawReq.consoleWrap ?? baseState.consoleWrap,
            isDirty: false
        } as RequestState;
    }

    private flattenPostmanItems(items: any[], parentFolder?: string): { name: string; request: any; folderName?: string }[] {
        const results: { name: string; request: any; folderName?: string }[] = [];

        for (const item of items) {
            if (item.request) {
                results.push({
                    name: item.name || 'Request',
                    request: item.request,
                    folderName: parentFolder
                });
            }
            if (Array.isArray(item.item) && item.item.length > 0) {
                const folderLabel = item.name ? (parentFolder ? `${parentFolder} / ${item.name}` : item.name) : parentFolder;
                results.push(...this.flattenPostmanItems(item.item, folderLabel));
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
