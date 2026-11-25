import { Component, ChangeDetectionStrategy, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState, RequestGroup } from '../../shared/services/tab.state.service';
import { AuthService } from '../../shared/services/auth.service';
import { SwaggerImportModalComponent } from '../../shared/components/swagger-import.modal.component/swagger-import.modal.component';
import { IGlobalVariable } from '../../interfaces/services/IVariableService';
import { extractPostmanVariables, extractRequestsVariables } from '../../shared/utils/import-variable.util';
import { isWsdlXml, parseWsdlToRequests } from '../../shared/utils/wsdl-parser.util';
import {
    parseYamlToObject,
    isOpenApiSpec,
    buildOpenApiImportCollection,
    isInsomniaExport,
    parseInsomniaToCollections,
    isThunderClientExport,
    parseThunderClientToCollection,
    isHoppscotchExport,
    parseHoppscotchToCollection,
    isBrunoCollectionExport,
    parseBrunoToCollection,
    isHarExport,
    parseHarToCollection,
    isWadlXml,
    parseWadlToCollection,
    isRamlObject,
    parseRamlToCollection,
    cleanEndpointTitle,
    cleanSoapOperationTitle
} from '../../shared/utils/api-import-parsers.util';

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
    importShareIntoActive = signal<boolean>(false);
    openShareInTabs = signal<boolean>(true);

    showSavePrompt = signal<boolean>(false);
    pendingImport = signal<PendingImport | null>(null);
    importFileIntoActive = signal<boolean>(false);
    openFileInTabs = signal<boolean>(true);
    hasActiveCapsule = computed(() => Boolean(this.tabStateService.activeCapsuleId()));
    activeCapsuleName = computed(() => this.tabStateService.activeCapsuleName() || 'Current Capsule');

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
            const targetCapId = this.importShareIntoActive() ? (this.tabStateService.activeCapsuleId() || null) : null;
            const res = await this.tabStateService.importCapsuleFromUrl(input, targetCapId, this.openShareInTabs());
            const actionLabel = targetCapId ? `into active capsule "${res.capsuleName}"` : `capsule "${res.capsuleName}"`;
            this.showStatus(`Successfully imported ${res.requestsCount} request(s) (${actionLabel})!`, false);
            this.showShareUrlModal.set(false);
            this.shareUrlInput.set('');
            this.importShareIntoActive.set(false);
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
                let data: any;
                if (isWsdlXml(content) || /\.wsdl$/i.test(file.name)) {
                    const parsedWsdl = parseWsdlToRequests(content, file.name);
                    if (parsedWsdl.requests.length === 0) {
                        throw new Error('No SOAP operations were found inside this WSDL file.');
                    }
                    const svcName = parsedWsdl.serviceName || file.name.replace(/\.wsdl$/i, '');
                    data = {
                        name: svcName,
                        requests: parsedWsdl.requests.map(r => ({
                            ...r,
                            name: cleanSoapOperationTitle(r.name, svcName)
                        }))
                    };
                } else if (isWadlXml(content) || /\.wadl$/i.test(file.name)) {
                    const parsedWadl = parseWadlToCollection(content, file.name);
                    if (parsedWadl.requests.length === 0) {
                        throw new Error('No endpoints were found inside this WADL file.');
                    }
                    data = { name: parsedWadl.name, requests: parsedWadl.requests };
                } else {
                    const trimmed = (content || '').trim();
                    const looksYaml = /\.(ya?ml|raml)$/i.test(file.name) || /^#%RAML/i.test(trimmed) || (!trimmed.startsWith('{') && !trimmed.startsWith('['));
                    if (looksYaml) {
                        const yamlParsed = parseYamlToObject(content);
                        if (isRamlObject(yamlParsed, content)) {
                            const raml = parseRamlToCollection(yamlParsed, file.name.replace(/\.(ya?ml|raml)$/i, ''));
                            data = { name: raml.name, requests: raml.requests };
                        } else {
                            data = yamlParsed;
                        }
                    } else {
                        data = JSON.parse(content);
                    }
                }
                const pending = this.prepareImportData(data, file.name);
                
                this.pendingImport.set(pending);
                this.importFileIntoActive.set(false);
                this.openFileInTabs.set(true);
                this.showSavePrompt.set(true);
            } catch (err: any) {
                console.error('Import validation failed:', err);
                const msg = err?.message || 'Invalid file format. Supported: OnSteroid, Postman, Insomnia, OpenAPI/Swagger (JSON/YAML), Thunder Client, Hoppscotch, Bruno, HAR, WSDL, WADL, or RAML.';
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
            const targetCapId = this.importFileIntoActive() ? (this.tabStateService.activeCapsuleId() || null) : null;
            const count = await this.tabStateService.importData(pending.payload, {
                saveToBackend,
                targetCapsuleId: targetCapId,
                openTabs: this.openFileInTabs()
            });
            const storageNote = saveToBackend ? 'and saved to cloud database' : 'into local workspace (not saved to cloud)';
            const summary = targetCapId
                ? `Import successful! Added ${count.requestsCount} request(s) into "${this.activeCapsuleName()}" ${storageNote}.`
                : `Import successful! Imported ${count.capsulesCount} capsule(s) and ${count.requestsCount} request(s) ${storageNote}.`;
            this.showStatus(summary, false);
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
            const postmanReqs = this.flattenPostmanItems(data.item, undefined, data.auth);
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
        // 1b. Insomnia Export (v4 resources or v5 collection.insomnia.rest/5.0)
        else if (isInsomniaExport(data)) {
            const cols = parseInsomniaToCollections(data);
            for (const c of cols) {
                const vars = extractRequestsVariables(c.requests, c.variables);
                groups.push({ name: c.name, requests: c.requests, variables: vars });
            }
        }
        // 1c. OpenAPI 3.x / Swagger 2.0 (JSON or YAML file)
        else if (isOpenApiSpec(data)) {
            const openApiCol = buildOpenApiImportCollection(data);
            const vars = extractRequestsVariables(openApiCol.requests, openApiCol.variables);
            groups.push({ name: openApiCol.name, requests: openApiCol.requests, variables: vars });
        }
        // 1d. Thunder Client Collection
        else if (isThunderClientExport(data)) {
            const tc = parseThunderClientToCollection(data);
            const vars = extractRequestsVariables(tc.requests);
            groups.push({ name: tc.name, requests: tc.requests, variables: vars });
        }
        // 1e. Hoppscotch Collection
        else if (isHoppscotchExport(data)) {
            const hop = parseHoppscotchToCollection(data);
            const vars = extractRequestsVariables(hop.requests);
            groups.push({ name: hop.name, requests: hop.requests, variables: vars });
        }
        // 1f. Bruno Collection
        else if (isBrunoCollectionExport(data)) {
            const br = parseBrunoToCollection(data);
            const vars = extractRequestsVariables(br.requests, br.variables);
            groups.push({ name: br.name, requests: br.requests, variables: vars });
        }
        // 1g. HAR 1.2 Archive
        else if (isHarExport(data)) {
            const har = parseHarToCollection(data, fileName);
            const vars = extractRequestsVariables(har.requests);
            groups.push({ name: har.name, requests: har.requests, variables: vars });
        }
        // 1h. RAML Spec Object
        else if (isRamlObject(data)) {
            const raml = parseRamlToCollection(data, fileName.replace(/\.(ya?ml|raml)$/i, ''));
            const vars = extractRequestsVariables(raml.requests);
            groups.push({ name: raml.name, requests: raml.requests, variables: vars });
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
                    finalGroups = group.groups.map((g: any) => {
                        const newGId = 'grp_' + this.tabStateService.createId();
                        if (g.id) {
                            oldReqIdMap.set(String(g.id), newGId);
                        }
                        return {
                            id: newGId,
                            name: g.name || 'Folder',
                            capsuleId: capId,
                            isExpanded: g.isExpanded ?? true,
                            requestIds: (g.requestIds || []).map((oldId: string) => oldReqIdMap.get(oldId) || oldId),
                            createdAt: Date.now()
                        };
                    });
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
                ...(Array.isArray(rawReq.examples) ? { examples: rawReq.examples } : {}),
                isDirty: false
            } as RequestState;
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

        // Normalize formData array (support both 'form-data' and legacy 'formData' bodyType)
        const formData = Array.isArray(rawReq.formData)
            ? rawReq.formData.map((f: any) => ({
                enabled: f.enabled ?? f.isEnabled ?? true,
                key: f.key ?? '',
                value: f.value ?? '',
                type: f.type === 'file' ? 'file' : 'text',
                ...(f.fileName ? { fileName: f.fileName } : {})
            }))
            : baseState.formData;

        const urlEncodedData = Array.isArray(rawReq.urlEncodedData)
            ? rawReq.urlEncodedData.map((u: any) => ({
                enabled: u.enabled ?? u.isEnabled ?? true,
                key: u.key ?? '',
                value: u.value ?? ''
            }))
            : baseState.urlEncodedData;

        const normalizedBodyType = rawReq.bodyType === 'formData' ? 'form-data' : (rawReq.bodyType || baseState.bodyType);

        return {
            ...baseState,
            ...rawReq,
            id: reqId,
            capsuleId: capId,
            name: rawReq.name || 'Imported Request',
            url: rawReq.url || '',
            method: (rawReq.method || 'GET').toUpperCase(),
            bodyType: normalizedBodyType,
            params,
            headers,
            formData,
            urlEncodedData,
            ...(Array.isArray(rawReq.examples) ? { examples: rawReq.examples } : {}),
            auth: {
                ...(rawReq.auth && typeof rawReq.auth === 'object' ? rawReq.auth : {}),
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

    private flattenPostmanItems(
        items: any[],
        parentFolder?: string,
        inheritedAuth?: any
    ): { name: string; request: any; response?: any[]; event?: any[]; auth?: any; folderName?: string }[] {
        const results: { name: string; request: any; response?: any[]; event?: any[]; auth?: any; folderName?: string }[] = [];

        for (const item of items) {
            const folderAuth = item.auth || inheritedAuth;
            if (item.request) {
                results.push({
                    name: item.name || 'Request',
                    request: item.request,
                    response: Array.isArray(item.response) ? item.response : [],
                    event: Array.isArray(item.event) ? item.event : [],
                    auth: folderAuth,
                    folderName: parentFolder
                });
            }
            if (Array.isArray(item.item) && item.item.length > 0) {
                const folderLabel = item.name ? (parentFolder ? `${parentFolder} / ${item.name}` : item.name) : parentFolder;
                results.push(...this.flattenPostmanItems(item.item, folderLabel, folderAuth));
            }
        }

        return results;
    }

    private extractPostmanUrlAndParams(urlData: any): {
        url: string;
        params: { enabled: boolean; key: string; value: string }[];
    } {
        let url = '';
        const params: { enabled: boolean; key: string; value: string }[] = [];

        if (typeof urlData === 'string') {
            url = urlData;
        } else if (urlData && typeof urlData === 'object') {
            url = urlData.raw || '';
            if (!url && (urlData.host || urlData.path)) {
                const proto = urlData.protocol ? `${urlData.protocol}://` : 'https://';
                const host = Array.isArray(urlData.host) ? urlData.host.join('.') : (urlData.host || '');
                const port = urlData.port ? `:${urlData.port}` : '';
                const pathParts = Array.isArray(urlData.path) ? urlData.path.join('/') : (urlData.path || '');
                url = `${proto}${host}${port}${pathParts ? '/' + pathParts.replace(/^\/+/, '') : ''}`;
            }
            if (Array.isArray(urlData.query)) {
                for (const q of urlData.query) {
                    params.push({
                        enabled: !q.disabled,
                        key: q.key || '',
                        value: q.value !== undefined && q.value !== null ? String(q.value) : ''
                    });
                }
            }
        }

        if (params.length === 0) {
            params.push({ enabled: true, key: '', value: '' });
        }

        return { url, params };
    }

    private extractPostmanBodyAndHeaders(req: any, inheritedAuth?: any): {
        headers: { enabled: boolean; key: string; value: string }[];
        bodyType: string;
        rawType: string;
        rawBody: string;
        rawBodyJson: string;
        rawBodyXml: string;
        rawBodyText: string;
        formData: { enabled: boolean; key: string; value: string; type: 'text' | 'file'; fileName?: string }[];
        urlEncodedData: { enabled: boolean; key: string; value: string }[];
        graphqlQuery: string;
        graphqlVariables: string;
        auth: any;
    } {
        const headers: { enabled: boolean; key: string; value: string }[] = [];
        if (Array.isArray(req?.header)) {
            for (const h of req.header) {
                headers.push({
                    enabled: !h.disabled,
                    key: h.key || '',
                    value: h.value !== undefined && h.value !== null ? String(h.value) : ''
                });
            }
        }

        // Extract Auth (request auth takes precedence over folder/collection auth)
        const resolvedAuth = req?.auth || inheritedAuth;
        let authObj: any = { type: 'none', token: '' };
        if (resolvedAuth && resolvedAuth.type !== 'noauth') {
            const getAuthParam = (arr: any[], key: string) => arr?.find((x: any) => x?.key === key)?.value ?? '';
            if (resolvedAuth.type === 'bearer') {
                const tokenObj = resolvedAuth.bearer?.find((b: any) => b.key === 'token') || resolvedAuth.bearer?.[0];
                authObj = { type: 'bearer', token: tokenObj?.value || '' };
            } else if (resolvedAuth.type === 'basic') {
                const username = String(getAuthParam(resolvedAuth.basic, 'username') || '');
                const password = String(getAuthParam(resolvedAuth.basic, 'password') || '');
                authObj = {
                    type: 'basic',
                    token: (username || password) ? `${username}:${password}` : '',
                    username,
                    password
                };
            } else if (resolvedAuth.type === 'apikey' && Array.isArray(resolvedAuth.apikey)) {
                const keyName = String(getAuthParam(resolvedAuth.apikey, 'key') || '');
                const valStr = String(getAuthParam(resolvedAuth.apikey, 'value') || '');
                const inStr = String(getAuthParam(resolvedAuth.apikey, 'in') || 'header') === 'query' ? 'query' : 'header';
                authObj = {
                    type: 'apikey',
                    token: valStr,
                    apiKeyName: keyName,
                    apiKeyValue: valStr,
                    apiKeyIn: inStr
                };
            } else if (resolvedAuth.type === 'oauth2' && Array.isArray(resolvedAuth.oauth2)) {
                authObj = {
                    type: 'oauth2',
                    token: String(getAuthParam(resolvedAuth.oauth2, 'accessToken') || ''),
                    oauth2: {
                        grantType: getAuthParam(resolvedAuth.oauth2, 'grant_type') === 'password' ? 'password' : 'client_credentials',
                        accessTokenUrl: String(getAuthParam(resolvedAuth.oauth2, 'accessTokenUrl') || ''),
                        clientId: String(getAuthParam(resolvedAuth.oauth2, 'clientId') || ''),
                        clientSecret: String(getAuthParam(resolvedAuth.oauth2, 'clientSecret') || ''),
                        scope: String(getAuthParam(resolvedAuth.oauth2, 'scope') || ''),
                        username: String(getAuthParam(resolvedAuth.oauth2, 'username') || ''),
                        password: String(getAuthParam(resolvedAuth.oauth2, 'password') || ''),
                        headerPrefix: String(getAuthParam(resolvedAuth.oauth2, 'headerPrefix') || 'Bearer')
                    }
                };
            } else if (resolvedAuth.type === 'awsv4' && Array.isArray(resolvedAuth.awsv4)) {
                authObj = {
                    type: 'aws-sigv4',
                    token: '',
                    awsSigV4: {
                        accessKey: String(getAuthParam(resolvedAuth.awsv4, 'accessKey') || ''),
                        secretKey: String(getAuthParam(resolvedAuth.awsv4, 'secretKey') || ''),
                        region: String(getAuthParam(resolvedAuth.awsv4, 'region') || 'us-east-1'),
                        service: String(getAuthParam(resolvedAuth.awsv4, 'service') || 'execute-api'),
                        sessionToken: String(getAuthParam(resolvedAuth.awsv4, 'sessionToken') || '')
                    }
                };
            }
        }

        if (headers.length === 0) {
            headers.push({ enabled: true, key: 'Accept', value: 'application/json' }, { enabled: true, key: '', value: '' });
        }

        let bodyType = 'none';
        let rawType = 'JSON';
        let rawBody = '{}';
        let rawBodyJson = '{}';
        let rawBodyXml = '';
        let rawBodyText = '';
        const formData: { enabled: boolean; key: string; value: string; type: 'text' | 'file'; fileName?: string }[] = [];
        const urlEncodedData: { enabled: boolean; key: string; value: string }[] = [];
        let graphqlQuery = '';
        let graphqlVariables = '';

        if (req?.body) {
            const mode = req.body.mode;
            if (mode === 'raw') {
                bodyType = 'raw';
                rawBody = req.body.raw || '';
                const lang = req.body.options?.raw?.language?.toLowerCase();
                const isSoap = rawBody.includes('soap:Envelope') || rawBody.includes('soapenv:Envelope') || rawBody.includes('soap12:Envelope') || rawBody.includes('schemas.xmlsoap.org');
                const isXml = lang === 'xml' || isSoap || rawBody.trim().startsWith('<?xml') || (rawBody.trim().startsWith('<') && rawBody.trim().endsWith('>'));
                if (isSoap) {
                    rawType = 'XML (SOAP)';
                    rawBodyXml = rawBody;
                } else if (isXml) {
                    rawType = 'XML';
                    rawBodyXml = rawBody;
                } else if (lang === 'text') {
                    rawType = 'Text';
                    rawBodyText = rawBody;
                } else {
                    rawType = 'JSON';
                    rawBodyJson = rawBody;
                }
            } else if (mode === 'formdata' && Array.isArray(req.body.formdata)) {
                bodyType = 'form-data';
                for (const f of req.body.formdata) {
                    const isFile = f.type === 'file';
                    formData.push({
                        enabled: !f.disabled,
                        key: f.key || '',
                        value: isFile ? (Array.isArray(f.src) ? f.src[0] || '' : (f.src || f.value || '')) : (f.value ?? ''),
                        type: isFile ? 'file' : 'text',
                        ...(isFile && (f.src || f.value) ? { fileName: Array.isArray(f.src) ? f.src[0] : (f.src || f.value) } : {})
                    });
                }
            } else if (mode === 'urlencoded' && Array.isArray(req.body.urlencoded)) {
                bodyType = 'x-www-form-urlencoded';
                for (const u of req.body.urlencoded) {
                    urlEncodedData.push({
                        enabled: !u.disabled,
                        key: u.key || '',
                        value: u.value !== undefined && u.value !== null ? String(u.value) : ''
                    });
                }
            } else if (mode === 'graphql' && req.body.graphql) {
                bodyType = 'graphql';
                graphqlQuery = req.body.graphql.query || '';
                graphqlVariables = typeof req.body.graphql.variables === 'string'
                    ? req.body.graphql.variables
                    : (req.body.graphql.variables ? JSON.stringify(req.body.graphql.variables, null, 2) : '');
            }
        }

        if (formData.length === 0) {
            formData.push({ enabled: true, key: '', value: '', type: 'text' });
        }
        if (urlEncodedData.length === 0) {
            urlEncodedData.push({ enabled: true, key: '', value: '' });
        }

        return {
            headers,
            bodyType,
            rawType,
            rawBody,
            rawBodyJson,
            rawBodyXml,
            rawBodyText,
            formData,
            urlEncodedData,
            graphqlQuery,
            graphqlVariables,
            auth: authObj
        };
    }

    private mapPostmanRequest(item: {
        name: string;
        request: any;
        response?: any[];
        event?: any[];
        auth?: any;
    }): Partial<RequestState> & { examples?: any[] } {
        const req = item.request;
        const method = typeof req === 'string' ? 'GET' : (req.method || 'GET').toUpperCase();
        const { url, params } = this.extractPostmanUrlAndParams(typeof req === 'string' ? req : req?.url);
        const bodyAndHeaders = this.extractPostmanBodyAndHeaders(req, item.auth);

        // Extract pre-request & test scripts from Postman events
        let preRequest = '';
        let testScript = '';
        if (Array.isArray(item.event)) {
            for (const ev of item.event) {
                const execLines = Array.isArray(ev?.script?.exec) ? ev.script.exec.join('\n') : (ev?.script?.exec || '');
                if (!execLines) continue;
                if (ev.listen === 'prerequest') {
                    preRequest = preRequest ? `${preRequest}\n${execLines}` : execLines;
                } else if (ev.listen === 'test') {
                    testScript = testScript ? `${testScript}\n${execLines}` : execLines;
                }
            }
        }

        // Map Postman saved examples (item.response[]) into OnSteroid examples
        const examples = Array.isArray(item.response)
            ? item.response.map((resp: any, idx: number) => {
                const orig = resp?.originalRequest;
                const origUrlParams = orig
                    ? this.extractPostmanUrlAndParams(typeof orig === 'string' ? orig : orig?.url)
                    : { url, params };
                const origBodyHeaders = orig
                    ? this.extractPostmanBodyAndHeaders(orig, item.auth)
                    : bodyAndHeaders;

                const respHeaders = Array.isArray(resp?.header)
                    ? resp.header
                        .filter((h: any) => h && h.key)
                        .map((h: any) => ({ key: String(h.key), value: String(h.value ?? '') }))
                    : [];

                let parsedRespBody: any = resp?.body ?? '';
                if (typeof parsedRespBody === 'string') {
                    const trimmed = parsedRespBody.trim();
                    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 0) {
                        try { parsedRespBody = JSON.parse(trimmed); } catch { /* keep raw string */ }
                    }
                }

                const statusStr = resp?.code
                    ? `${resp.code}${resp.status ? ' ' + resp.status : ''}`
                    : (resp?.status || '200 OK');
                const bodyByteLen = typeof resp?.body === 'string' ? resp.body.length : 0;

                const snapshot = {
                    method: (orig?.method || method).toUpperCase(),
                    url: origUrlParams.url || url,
                    params: origUrlParams.params,
                    headers: origBodyHeaders.headers,
                    bodyType: origBodyHeaders.bodyType,
                    rawType: origBodyHeaders.rawType,
                    rawBody: origBodyHeaders.rawBody,
                    rawBodyJson: origBodyHeaders.rawBodyJson,
                    rawBodyXml: origBodyHeaders.rawBodyXml,
                    rawBodyText: origBodyHeaders.rawBodyText,
                    formData: origBodyHeaders.formData,
                    urlEncodedData: origBodyHeaders.urlEncodedData,
                    graphqlQuery: origBodyHeaders.graphqlQuery,
                    graphqlVariables: origBodyHeaders.graphqlVariables,
                    responseBody: parsedRespBody,
                    responseStatus: statusStr,
                    responseTime: resp?.responseTime ?? 0,
                    responseSize: bodyByteLen ? `${bodyByteLen} B` : '0 B',
                    responseHeaders: respHeaders,
                    responseCookies: Array.isArray(resp?.cookie) ? resp.cookie : []
                };

                return {
                    name: String(resp?.name || `Example ${idx + 1}`),
                    requestSnapshot: snapshot
                };
            })
            : [];

        return {
            name: cleanEndpointTitle({ name: item.name, method, path: url }),
            url,
            method,
            payloadType: 'params',
            params,
            ...bodyAndHeaders,
            scripts: {
                preRequest,
                postResponse: '',
                testScript,
                testScriptEnabled: !!testScript,
                preRequestConsole: '',
                postResponseConsole: '',
                encryptionConsole: ''
            },
            ...(examples.length > 0 ? { examples } : {})
        };
    }
}
