import { Component, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TabStateService, RequestState } from '../../services/tab.state.service';

@Component({
    selector: 'app-swagger-import-modal',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './swagger-import.modal.component.html',
    styleUrl: './swagger-import.modal.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwaggerImportModalComponent {
    private http = inject(HttpClient);
    private tabStateService = inject(TabStateService);

    isOpen = signal(false);
    swaggerUrl = signal('');
    statusMessage = signal('');
    hasError = signal(false);
    isImporting = signal(false);

    open() {
        this.isOpen.set(true);
        this.swaggerUrl.set('');
        this.statusMessage.set('');
        this.hasError.set(false);
    }

    close() {
        this.isOpen.set(false);
    }

    async importFromSwagger() {
        const url = this.swaggerUrl().trim();
        if (!url) {
            this.setStatus('Please enter a Swagger URL ending with /swagger/index.html.', true);
            return;
        }

        if (!url.endsWith('/swagger/index.html')) {
            this.setStatus('Swagger URL must end with /swagger/index.html.', true);
            return;
        }

        this.isImporting.set(true);
        this.setStatus('Fetching Swagger index page...', false);

        try {
            const html = await firstValueFrom(this.http.get(url, { responseType: 'text' as const }));
            const jsonUrl = this.resolveSwaggerJsonUrl(html, url);
            const openApi = await firstValueFrom(this.http.get<Record<string, unknown>>(jsonUrl));
            const result = this.buildRequestStates(openApi, url, jsonUrl);

            if (result.requests.length === 0) {
                this.setStatus('No operations found inside the Swagger document.', true);
                return;
            }

            result.requests.forEach(request => this.tabStateService.addOpenTab(request));
            this.tabStateService.setActiveTab(result.requests[0].id);

            this.setStatus(`Imported ${result.requests.length} requests from ${result.collectionName}.`, false);
            setTimeout(() => this.close(), 800);
        } catch (error: any) {
            console.error('Swagger import failed', error);
            this.setStatus(`Failed to import Swagger: ${error?.message || error}`, true);
        } finally {
            this.isImporting.set(false);
        }
    }

    private setStatus(message: string, isError: boolean) {
        this.statusMessage.set(message);
        this.hasError.set(isError);
    }

    private resolveSwaggerJsonUrl(html: string, indexUrl: string): string {
        const parseMatch = html.match(/JSON\.parse\(\s*'([\s\S]*?)'\s*\)/);
        if (!parseMatch || !parseMatch[1]) {
            throw new Error('Swagger configuration object not found in index.html.');
        }

        let configObject;
        try {
            configObject = JSON.parse(parseMatch[1]);
        } catch (err) {
            throw new Error('Could not parse Swagger configuration JSON.');
        }

        let jsonHref: string | undefined;
        if (Array.isArray(configObject.urls)) {
            jsonHref = configObject.urls.find((entry: any) => typeof entry?.url === 'string' && entry.url.trim().toLowerCase().endsWith('.json'))?.url;
        }

        if (!jsonHref && typeof configObject.url === 'string' && configObject.url.trim().toLowerCase().endsWith('.json')) {
            jsonHref = configObject.url;
        }

        if (!jsonHref) {
            throw new Error('No JSON swagger URL found in the Swagger configuration object.');
        }

        return new URL(jsonHref, indexUrl).toString();
    }

    private buildRequestStates(openApi: Record<string, any>, indexUrl: string, openApiUrl: string): { collectionName: string; requests: RequestState[] } {
        const collectionName = typeof openApi['info']?.title === 'string' && openApi['info'].title.trim()
            ? openApi['info'].title.trim()
            : 'Swagger Import';

        const baseServiceUrl = this.resolveServerBaseUrl(openApi, indexUrl);
        const paths = openApi['paths'] || {};
        const requests: RequestState[] = [];
        let operationCounter = 0;

        for (const pathKey of Object.keys(paths)) {
            const pathObject = paths[pathKey];
            if (!pathObject || typeof pathObject !== 'object') continue;

            for (const methodKey of Object.keys(pathObject)) {
                const operation = pathObject[methodKey];
                if (!operation || typeof operation !== 'object') continue;

                const method = methodKey.toUpperCase();
                const operationName = (operation.summary || operation.operationId || `${method} ${pathKey}`).trim();
                const displayName = `${collectionName} — ${operationName}`;
                const requestId = this.createId();
                const url = new URL(pathKey, baseServiceUrl).toString();

                const allParams = this.extractParameters(operation.parameters);
                const params = allParams.queryParams;
                const headers = allParams.headerParams;
                const body = this.extractRequestBody(operation.requestBody);

                const requestState: RequestState = {
                    ...this.tabStateService.getDefaultState(requestId),
                    id: requestId,
                    name: displayName,
                    url,
                    method,
                    isDirty: true,
                    params,
                    headers: [{ enabled: true, key: 'Accept', value: 'application/json' }, ...headers, { enabled: true, key: '', value: '' }],
                    bodyType: body.rawBody ? 'raw' : 'none',
                    rawType: 'JSON',
                    rawBody: body.rawBody,
                    rawBodyJson: body.rawBody,
                    rawBodyXml: body.rawBodyXml,
                    requestBody: body.exampleBody,
                };

                requests.push(requestState);
                operationCounter += 1;
            }
        }

        return { collectionName, requests };
    }

    private resolveServerBaseUrl(openApi: Record<string, any>, indexUrl: string): string {
        const servers = Array.isArray(openApi['servers']) ? openApi['servers'] : [];
        if (servers.length > 0 && typeof servers[0].url === 'string') {
            try {
                return new URL(servers[0].url, indexUrl).toString();
            } catch {
                return indexUrl;
            }
        }

        return indexUrl.replace(/\/swagger\/index\.html$/i, '/') || indexUrl;
    }

    private extractParameters(parameters: any): { queryParams: { enabled: boolean; key: string; value: string }[]; headerParams: { enabled: boolean; key: string; value: string }[] } {
        const queryParams: { enabled: boolean; key: string; value: string }[] = [];
        const headerParams: { enabled: boolean; key: string; value: string }[] = [];

        if (!Array.isArray(parameters)) return { queryParams, headerParams };

        for (const param of parameters) {
            if (!param || typeof param !== 'object' || !param.name) continue;
            const value = param.example ?? param.default ?? '';
            const entry = { enabled: true, key: String(param.name), value: String(value) };

            if (param.in === 'query') {
                queryParams.push(entry);
            } else if (param.in === 'header') {
                headerParams.push(entry);
            }
        }

        return { queryParams, headerParams };
    }

    private extractRequestBody(requestBody: any): { rawBody: string; rawBodyJson: string; rawBodyXml: string; exampleBody: unknown } {
        if (!requestBody || typeof requestBody !== 'object') {
            return { rawBody: '', rawBodyJson: '{}', rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>', exampleBody: {} };
        }

        const jsonContent = requestBody.content?.['application/json'] || requestBody.content?.['application/*+json'] || requestBody.content?.['text/json'];
        const schema = jsonContent?.schema;
        const exampleBody = schema ? this.generateExampleFromSchema(schema) : {};
        const rawBody = JSON.stringify(exampleBody, null, 2);

        return { rawBody, rawBodyJson: rawBody, rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>', exampleBody };
    }

    private generateExampleFromSchema(schema: any): any {
        if (!schema || typeof schema !== 'object') {
            return null;
        }

        if (schema.example !== undefined) {
            return schema.example;
        }

        if (schema.enum && Array.isArray(schema.enum)) {
            return schema.enum[0];
        }

        if (schema.type === 'object' || schema.properties) {
            const example: Record<string, unknown> = {};
            const properties = schema.properties || {};
            for (const key of Object.keys(properties)) {
                example[key] = this.generateExampleFromSchema(properties[key]);
            }
            return example;
        }

        if (schema.type === 'array') {
            return [this.generateExampleFromSchema(schema.items || {})];
        }

        if (schema.type === 'boolean') {
            return false;
        }

        if (schema.type === 'integer' || schema.type === 'number') {
            return 0;
        }

        return '';
    }

    private createId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `swagger-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }
}
