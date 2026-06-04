import { Component, signal, inject, ChangeDetectionStrategy, output } from '@angular/core';
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

    onImportStatus = output<{ message: string; isError: boolean }>();

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

            this.tabStateService.closeAllTabs();
            this.tabStateService.setActiveCapsuleName(result.collectionName);
            this.tabStateService.savedCapsules.set(result.requests);
            result.requests.forEach(request => this.tabStateService.addOpenTab(request));
            this.tabStateService.setActiveTab(result.requests[0].id);

            const successMessage = `Imported ${result.requests.length} requests from ${result.collectionName}.`;
            this.onImportStatus.emit({ message: successMessage, isError: false });
            this.setStatus(successMessage, false);
            setTimeout(() => this.close(), 800);
        } catch (error: any) {
            console.error('Swagger import failed', error);
            const message = `Failed to import Swagger: ${error?.message || error}`;
            this.onImportStatus.emit({ message, isError: true });
            this.setStatus(message, true);
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

                const allParams = this.extractParameters(this.mergeParameters(pathObject.parameters, operation.parameters), openApi);
                const params = [...allParams.queryParams, { enabled: true, key: '', value: '' }];
                const headers = allParams.headerParams;
                const pathParams = allParams.pathParams;
                const body = this.extractRequestBody(operation.requestBody, openApi);
                const resolvedUrl = this.applyPathParameters(url, pathParams);

                const requestState: RequestState = {
                    ...this.tabStateService.getDefaultState(requestId),
                    id: requestId,
                    name: displayName,
                    url: resolvedUrl,
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

    private extractParameters(parameters: any, openApi: Record<string, any>): { queryParams: { enabled: boolean; key: string; value: string }[]; headerParams: { enabled: boolean; key: string; value: string }[]; pathParams: { enabled: boolean; key: string; value: string }[] } {
        const queryParams: { enabled: boolean; key: string; value: string }[] = [];
        const headerParams: { enabled: boolean; key: string; value: string }[] = [];
        const pathParams: { enabled: boolean; key: string; value: string }[] = [];

        if (!Array.isArray(parameters)) return { queryParams, headerParams, pathParams };

        for (const param of parameters) {
            if (!param || typeof param !== 'object' || !param.name) continue;
            const exampleValue = this.resolveExampleValue(param, openApi) ?? '';
            const entryValue = typeof exampleValue === 'object' ? JSON.stringify(exampleValue, null, 2) : String(exampleValue);
            const entry = { enabled: true, key: String(param.name), value: entryValue };

            if (param.in === 'query') {
                queryParams.push(entry);
            } else if (param.in === 'header') {
                headerParams.push(entry);
            } else if (param.in === 'path') {
                pathParams.push(entry);
            }
        }

        return { queryParams, headerParams, pathParams };
    }

    private mergeParameters(pathParameters: any, operationParameters: any): any[] {
        const merged: any[] = [];
        const canonical = new Map<string, any>();

        for (const param of Array.isArray(pathParameters) ? pathParameters : []) {
            if (param && typeof param === 'object' && param.name && param.in) {
                canonical.set(`${param.in}:${param.name}`, param);
            }
        }

        for (const param of Array.isArray(operationParameters) ? operationParameters : []) {
            if (param && typeof param === 'object' && param.name && param.in) {
                canonical.set(`${param.in}:${param.name}`, param);
            }
        }

        for (const value of canonical.values()) {
            merged.push(value);
        }

        return merged;
    }

    private extractRequestBody(requestBody: any, openApi: Record<string, any>): { rawBody: string; rawBodyJson: string; rawBodyXml: string; exampleBody: unknown } {
        if (!requestBody || typeof requestBody !== 'object') {
            return { rawBody: '', rawBodyJson: '{}', rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>', exampleBody: {} };
        }

        const content = this.findRequestBodyContent(requestBody);
        if (!content) {
            return { rawBody: '', rawBodyJson: '{}', rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>', exampleBody: {} };
        }

        const exampleFromContent = this.resolveExampleValue(content, openApi);
        const schema = content.schema;
        const exampleBody = exampleFromContent !== undefined && exampleFromContent !== null
            ? exampleFromContent
            : schema ? this.generateExampleFromSchema(schema, openApi) : {};

        const rawBody = typeof exampleBody === 'string'
            ? exampleBody
            : JSON.stringify(exampleBody, null, 2);

        return { rawBody, rawBodyJson: rawBody, rawBodyXml: '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n\n</root>', exampleBody };
    }

    private findRequestBodyContent(requestBody: any): any {
        if (!requestBody || typeof requestBody !== 'object' || !requestBody.content || typeof requestBody.content !== 'object') {
            return undefined;
        }

        const jsonContent = requestBody.content['application/json'] || requestBody.content['application/*+json'] || requestBody.content['text/json'];
        if (jsonContent) return jsonContent;

        const firstContentType = Object.keys(requestBody.content).find(key => typeof key === 'string');
        return firstContentType ? requestBody.content[firstContentType] : undefined;
    }

    private resolveExampleValue(source: any, openApi: Record<string, any>): unknown {
        if (!source || typeof source !== 'object') {
            return undefined;
        }

        if (source.$ref && typeof source.$ref === 'string') {
            const resolved = this.resolveRef(source.$ref, openApi);
            return this.resolveExampleValue(resolved, openApi);
        }

        if (source.example !== undefined) {
            return source.example;
        }

        if (source.default !== undefined) {
            return source.default;
        }

        if (source.examples && typeof source.examples === 'object') {
            const firstExample = Object.values(source.examples).find(example => example && typeof example === 'object' && 'value' in example);
            if (firstExample && typeof firstExample === 'object') {
                return (firstExample as any).value;
            }
        }

        if (source.schema && typeof source.schema === 'object') {
            return this.generateExampleFromSchema(source.schema, openApi);
        }

        if (source.type === 'object' || source.properties) {
            return this.generateExampleFromSchema(source, openApi);
        }

        return undefined;
    }

    private applyPathParameters(url: string, pathParams: { enabled: boolean; key: string; value: string }[]): string {
        return pathParams.reduce((currentUrl, param) => {
            if (!param.key) return currentUrl;
            const placeholder = `{${param.key}}`;
            return currentUrl.replaceAll(placeholder, param.value || placeholder);
        }, url);
    }

    private resolveRef(ref: string, openApi: Record<string, any>): any {
        if (!ref.startsWith('#/')) {
            return undefined;
        }

        const parts = ref.slice(2).split('/').map(part => decodeURIComponent(part));
        let target: any = openApi;
        for (const part of parts) {
            if (!target || typeof target !== 'object' || !(part in target)) {
                return undefined;
            }
            target = target[part];
        }
        return target;
    }

    private generateExampleFromSchema(schema: any, openApi: Record<string, any>): any {
        if (!schema || typeof schema !== 'object') {
            return null;
        }

        if (schema.$ref && typeof schema.$ref === 'string') {
            const resolved = this.resolveRef(schema.$ref, openApi);
            return this.generateExampleFromSchema(resolved, openApi);
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
                example[key] = this.generateExampleFromSchema(properties[key], openApi);
            }
            return example;
        }

        if (schema.type === 'array') {
            return [this.generateExampleFromSchema(schema.items || {}, openApi)];
        }

        if (schema.type === 'boolean') {
            return false;
        }

        if (schema.type === 'integer' || schema.type === 'number') {
            return 0;
        }

        if (schema.type === 'string') {
            return schema.format === 'date-time' ? new Date().toISOString() : '';
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
