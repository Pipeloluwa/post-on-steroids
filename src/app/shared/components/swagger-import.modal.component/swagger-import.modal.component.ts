import { Component, signal, computed, inject, ChangeDetectionStrategy, output, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { generateUUID } from '../../utils/uuid.util';
import { isLocalhostOrLoopbackUrl } from '../../utils/url.util';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState, RequestGroup } from '../../services/tab.state.service';
import { SwaggerExtractionService } from '../../services/swagger-extraction.service';
import { IGlobalVariable } from '../../../interfaces/services/IVariableService';
import { extractRequestsVariables } from '../../utils/import-variable.util';
import { parseWsdlToRequests, parseAsmxOperationPageToRequest } from '../../utils/wsdl-parser.util';
import { buildOpenApiImportCollection, cleanSoapOperationTitle } from '../../utils/api-import-parsers.util';

@Component({
    selector: 'app-swagger-import-modal',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './swagger-import.modal.component.html',
    styleUrl: './swagger-import.modal.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwaggerImportModalComponent {
    private swaggerExtraction = inject(SwaggerExtractionService);
    private tabStateService = inject(TabStateService);

    onImportStatus = output<{ message: string; isError: boolean }>();
    @ViewChild('swaggerUrlInput') inputRef?: ElementRef<HTMLInputElement>;

    isOpen = signal(false);
    swaggerUrl = signal('');
    statusMessage = signal('');
    hasError = signal(false);
    isImporting = signal(false);
    saveToBackend = signal(true);
    importIntoActiveCapsule = signal(false);
    openInTabs = signal(false);
    hasActiveCapsule = computed(() => Boolean(this.tabStateService.activeCapsuleId()));
    activeCapsuleName = computed(() => this.tabStateService.activeCapsuleName() || 'Current Capsule');

    open() {
        this.isOpen.set(true);
        this.swaggerUrl.set('');
        this.statusMessage.set('');
        this.hasError.set(false);
        this.saveToBackend.set(true);
        this.importIntoActiveCapsule.set(false);
        this.openInTabs.set(false);
        setTimeout(() => this.inputRef?.nativeElement?.focus(), 150);
    }

    close() {
        this.isOpen.set(false);
    }

    async importFromSwagger() {
        let url = this.swaggerUrl().trim();
        if (!url) {
            this.setStatus('Please enter a Swagger, OpenAPI, Redoc, Scalar, Stoplight, RapiDoc, or WSDL/SOAP URL.', true);
            return;
        }

        // Auto-prepend http:// for localhost/127 or https:// if protocol is omitted
        if (!/^https?:\/\//i.test(url)) {
            url = (isLocalhostOrLoopbackUrl(url) ? 'http://' : 'https://') + url;
            this.swaggerUrl.set(url);
        }

        try {
            new URL(url);
        } catch {
            this.setStatus('Please enter a valid URL (e.g. https://example.com/swagger, /redoc, /scalar, or https://example.com/service.asmx?WSDL).', true);
            return;
        }

        this.isImporting.set(true);
        this.setStatus('Extracting API specification...', false);

        try {
            const extracted = await this.swaggerExtraction.extractApiSpec(url);
            const result = extracted.kind === 'wsdl'
                ? this.buildWsdlRequestStates(extracted)
                : this.buildRequestStates(extracted.spec, url);

            if (result.requests.length === 0) {
                this.setStatus('No operations found inside the API documentation.', true);
                return;
            }

            const activeCapId = this.importIntoActiveCapsule() ? (this.tabStateService.activeCapsuleId() || null) : null;
            const capId = activeCapId || this.tabStateService.createId();
            result.requests.forEach(req => req.capsuleId = capId);
            result.groups.forEach(grp => grp.capsuleId = capId);

            await this.tabStateService.importData({
                capsules: [{
                    id: capId,
                    name: result.collectionName,
                    requests: result.requests,
                    groups: result.groups,
                    variables: result.variables
                }],
                variables: result.variables
            }, {
                saveToBackend: this.saveToBackend(),
                targetCapsuleId: activeCapId,
                openTabs: this.openInTabs()
            });

            const destinationLabel = activeCapId ? this.activeCapsuleName() : result.collectionName;
            const successMessage = `Imported ${result.requests.length} requests into "${destinationLabel}".`;
            this.onImportStatus.emit({ message: successMessage, isError: false });
            this.setStatus(successMessage, false);
            setTimeout(() => this.close(), 800);
        } catch (error: any) {
            console.error('API specification import failed', error);
            const message = `Failed to import API documentation: ${error?.message || error}`;
            this.onImportStatus.emit({ message, isError: true });
            this.setStatus(message, true);
        } finally {
            this.isImporting.set(false);
        }
    }

    private buildWsdlRequestStates(extracted: {
        kind: 'wsdl';
        wsdlXml: string;
        xsdXmls: string[];
        serviceUrl: string;
        asmxOps?: { opName: string; opHtml: string; pageUrl: string; serviceName: string }[];
    }): { collectionName: string; requests: RequestState[]; groups: RequestGroup[]; variables: IGlobalVariable[] } {
        let collectionName = 'SOAP Service';
        let parsedReqs: any[] = [];

        if (extracted.wsdlXml) {
            const wsdlResult = parseWsdlToRequests(extracted.wsdlXml, extracted.serviceUrl, extracted.xsdXmls);
            collectionName = wsdlResult.serviceName || collectionName;
            parsedReqs = wsdlResult.requests;
        } else if (Array.isArray(extracted.asmxOps) && extracted.asmxOps.length > 0) {
            collectionName = extracted.asmxOps[0].serviceName || collectionName;
            const baseServiceUrl = extracted.serviceUrl.replace(/\?(single)?wsdl$/i, '');
            parsedReqs = extracted.asmxOps.map(op =>
                parseAsmxOperationPageToRequest(op.opName, op.opHtml, baseServiceUrl)
            );
        }

        const requests: RequestState[] = parsedReqs.map(pr => {
            const requestId = this.createId();
            return {
                ...this.tabStateService.getDefaultState(requestId),
                id: requestId,
                name: cleanSoapOperationTitle(pr.name, collectionName),
                url: pr.url,
                method: 'POST',
                isDirty: true,
                params: [{ enabled: true, key: '', value: '' }],
                headers: [...pr.headers, { enabled: true, key: '', value: '' }],
                bodyType: 'raw',
                rawType: 'XML (SOAP)',
                rawBody: pr.rawBody,
                rawBodyJson: '',
                rawBodyXml: pr.rawBodyXml
            } as RequestState;
        });

        const variables = extractRequestsVariables(requests);
        return { collectionName, requests, groups: [], variables };
    }

    private setStatus(message: string, isError: boolean) {
        this.statusMessage.set(message);
        this.hasError.set(isError);
    }

    private buildRequestStates(openApi: Record<string, any>, indexUrl: string): { collectionName: string; requests: RequestState[]; groups: RequestGroup[]; variables: IGlobalVariable[] } {
        const parsed = buildOpenApiImportCollection(openApi, indexUrl);
        const groupMap = new Map<string, RequestGroup>();
        const requests: RequestState[] = parsed.requests.map(pr => {
            const requestId = this.createId();
            const fullState: RequestState = {
                ...this.tabStateService.getDefaultState(requestId),
                ...pr,
                id: requestId,
                isDirty: true
            };
            const folderName = pr.__folderName;
            if (folderName) {
                let grp = groupMap.get(folderName);
                if (!grp) {
                    grp = {
                        id: `grp_${this.createId()}`,
                        name: folderName,
                        capsuleId: '',
                        isExpanded: true,
                        requestIds: [],
                        createdAt: Date.now()
                    };
                    groupMap.set(folderName, grp);
                }
                grp.requestIds.push(requestId);
                fullState.groupId = grp.id;
            }
            return fullState;
        });

        const explicitVars = (parsed.variables || []).map(v => ({
            key: v.key,
            value: v.value,
            type: v.type,
            enabled: v.enabled
        }));
        const variables = extractRequestsVariables(requests, explicitVars);
        return {
            collectionName: parsed.name,
            requests,
            groups: Array.from(groupMap.values()),
            variables
        };
    }

    private createId() {
        return generateUUID();
    }
}
