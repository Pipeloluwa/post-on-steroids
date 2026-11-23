import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { isLocalhostOrLoopbackUrl, isElectronApp } from '../utils/url.util';
import { getGlobalRequestTimeoutMs } from '../utils/request-timeout.util';
import { isWsdlXml, inspectAsmxOrSvcHtml, extractWsdlSchemaLocations } from '../utils/wsdl-parser.util';
import {
    parseYamlToObject,
    extractDocHtmlSpecReference,
    extractServiceBaseFromDocUrl
} from '../utils/api-import-parsers.util';

export type ExtractedApiSpecResult =
    | {
        kind: 'openapi';
        spec: Record<string, any>;
        sourceUrl: string;
    }
    | {
        kind: 'wsdl';
        wsdlXml: string;
        xsdXmls: string[];
        serviceUrl: string;
        asmxOps?: { opName: string; opHtml: string; pageUrl: string; serviceName: string }[];
    };

/**
 * Service for extracting OpenAPI/Swagger specifications from various sources
 * Uses a multi-method approach with fallbacks for maximum compatibility
 */
@Injectable({
    providedIn: 'root'
})
export class SwaggerExtractionService {
    private http = inject(HttpClient);
    private proxyUrl = environment.proxyUrl;
    private proxyFallbackUrl = environment.proxyFallbackUrl;

    /**
     * Unified API documentation extractor supporting both OpenAPI/Swagger AND SOAP/WSDL/ASMX/SVC.
     */
    async extractApiSpec(inputUrl: string): Promise<ExtractedApiSpecResult> {
        const trimmedUrl = inputUrl.trim();
        const looksSoapFirst = /[?&](single)?wsdl(?:$|[&#])/i.test(trimmedUrl)
            || /\.(wsdl|asmx|svc)(?:$|[?#])/i.test(trimmedUrl);

        if (looksSoapFirst) {
            const soapRes = await this.tryExtractSoapSpec(trimmedUrl);
            if (soapRes) return soapRes;
            const openApiSpec = await this.extractSwaggerSpec(trimmedUrl);
            return { kind: 'openapi', spec: openApiSpec, sourceUrl: trimmedUrl };
        }

        // Check direct response first: might be OpenAPI JSON/YAML, Doc UI HTML (Redoc/Scalar/Stoplight/RapiDoc/Swagger), or WSDL XML
        try {
            const directRes = await this.fetchWithProxy(trimmedUrl, 'application/json,application/yaml,text/yaml,application/xml,text/xml,text/html,*/*');
            if (directRes.ok) {
                if (directRes.json && (directRes.json['openapi'] || directRes.json['swagger'] || directRes.json['paths'])) {
                    return { kind: 'openapi', spec: directRes.json, sourceUrl: trimmedUrl };
                }
                if (isWsdlXml(directRes.text)) {
                    const xsdXmls = await this.fetchWsdlImports(directRes.text, trimmedUrl);
                    return { kind: 'wsdl', wsdlXml: directRes.text, xsdXmls, serviceUrl: trimmedUrl };
                }
                if (directRes.text) {
                    const htmlSpec = await this.tryResolveDocFromHtmlContent(directRes.text, trimmedUrl);
                    if (htmlSpec) {
                        return { kind: 'openapi', spec: htmlSpec, sourceUrl: trimmedUrl };
                    }
                    const asmxCheck = inspectAsmxOrSvcHtml(directRes.text, trimmedUrl);
                    if (asmxCheck.wsdlUrls.length > 0 || asmxCheck.operationNames.length > 0) {
                        const soapRes = await this.tryExtractSoapSpec(trimmedUrl);
                        if (soapRes) return soapRes;
                    }
                }
            }
        } catch { }

        try {
            const openApiSpec = await this.extractSwaggerSpec(trimmedUrl);
            return { kind: 'openapi', spec: openApiSpec, sourceUrl: trimmedUrl };
        } catch (openApiErr) {
            const soapRes = await this.tryExtractSoapSpec(trimmedUrl);
            if (soapRes) return soapRes;
            throw openApiErr;
        }
    }

    private async fetchWsdlImports(wsdlXml: string, baseUrl: string): Promise<string[]> {
        const collectedXmls: string[] = [];
        const visitedUrls = new Set<string>([baseUrl]);
        let frontier: { xml: string; url: string }[] = [{ xml: wsdlXml, url: baseUrl }];
        const maxHops = 3;
        const maxDocs = 15;

        for (let hop = 0; hop < maxHops && frontier.length > 0 && collectedXmls.length < maxDocs; hop++) {
            const nextLocations: string[] = [];
            for (const item of frontier) {
                const locs = extractWsdlSchemaLocations(item.xml, item.url);
                for (const loc of locs) {
                    if (!visitedUrls.has(loc) && visitedUrls.size <= maxDocs) {
                        visitedUrls.add(loc);
                        nextLocations.push(loc);
                    }
                }
            }
            if (nextLocations.length === 0) break;

            const fetchedBatch = await Promise.all(
                nextLocations.map(async loc => {
                    try {
                        const res = await this.fetchWithProxy(loc, 'application/xml,text/xml,*/*');
                        return res.ok && res.text ? { xml: res.text, url: loc } : null;
                    } catch {
                        return null;
                    }
                })
            );

            frontier = [];
            for (const entry of fetchedBatch) {
                if (entry && entry.xml) {
                    collectedXmls.push(entry.xml);
                    frontier.push(entry);
                }
            }
        }

        return collectedXmls;
    }

    private async tryExtractSoapSpec(targetUrl: string): Promise<ExtractedApiSpecResult | null> {
        const cleanUrl = targetUrl.trim();
        const baseServiceUrl = cleanUrl.replace(/\?(single)?wsdl$/i, '');
        const candidateWsdlUrls: string[] = [];

        if (/[?&](single)?wsdl$/i.test(cleanUrl) || /\.wsdl$/i.test(cleanUrl)) {
            candidateWsdlUrls.push(cleanUrl);
        }
        candidateWsdlUrls.push(`${baseServiceUrl}?WSDL`, `${baseServiceUrl}?wsdl`, `${baseServiceUrl}?singleWsdl`);

        const visited = new Set<string>();
        for (const wsdlUrl of candidateWsdlUrls) {
            if (visited.has(wsdlUrl)) continue;
            visited.add(wsdlUrl);
            try {
                const res = await this.fetchWithProxy(wsdlUrl, 'application/xml,text/xml,*/*');
                if (res.ok && isWsdlXml(res.text)) {
                    const xsdXmls = await this.fetchWsdlImports(res.text, wsdlUrl);
                    return { kind: 'wsdl', wsdlXml: res.text, xsdXmls, serviceUrl: wsdlUrl };
                }
            } catch { }
        }

        // Inspect ASMX / SVC HTML page for WSDL links or ?op= Operation pages
        try {
            const htmlRes = await this.fetchWithProxy(baseServiceUrl, 'text/html,application/xhtml+xml,*/*');
            if (htmlRes.ok && htmlRes.text) {
                if (isWsdlXml(htmlRes.text)) {
                    const xsdXmls = await this.fetchWsdlImports(htmlRes.text, baseServiceUrl);
                    return { kind: 'wsdl', wsdlXml: htmlRes.text, xsdXmls, serviceUrl: baseServiceUrl };
                }

                const info = inspectAsmxOrSvcHtml(htmlRes.text, baseServiceUrl);
                for (const discoveredWsdl of info.wsdlUrls) {
                    if (visited.has(discoveredWsdl)) continue;
                    visited.add(discoveredWsdl);
                    try {
                        const wRes = await this.fetchWithProxy(discoveredWsdl, 'application/xml,text/xml,*/*');
                        if (wRes.ok && isWsdlXml(wRes.text)) {
                            const xsdXmls = await this.fetchWsdlImports(wRes.text, discoveredWsdl);
                            return { kind: 'wsdl', wsdlXml: wRes.text, xsdXmls, serviceUrl: discoveredWsdl };
                        }
                    } catch { }
                }

                // Fallback: ASMX ?op=OpName pages when ?WSDL is blocked on DMZ/firewall
                if (info.operationNames.length > 0) {
                    const opsToFetch = info.operationNames.slice(0, 40);
                    const asmxOps: { opName: string; opHtml: string; pageUrl: string; serviceName: string }[] = [];
                    const batchSize = 6;
                    for (let i = 0; i < opsToFetch.length; i += batchSize) {
                        const batch = opsToFetch.slice(i, i + batchSize);
                        const fetched = await Promise.all(
                            batch.map(async opName => {
                                const opUrl = `${baseServiceUrl}?op=${encodeURIComponent(opName)}`;
                                try {
                                    const opRes = await this.fetchWithProxy(opUrl, 'text/html,*/*');
                                    return {
                                        opName,
                                        opHtml: opRes.ok ? opRes.text : '',
                                        pageUrl: opUrl,
                                        serviceName: info.serviceName
                                    };
                                } catch {
                                    return { opName, opHtml: '', pageUrl: opUrl, serviceName: info.serviceName };
                                }
                            })
                        );
                        asmxOps.push(...fetched);
                    }
                    if (asmxOps.length > 0) {
                        return { kind: 'wsdl', wsdlXml: '', xsdXmls: [], serviceUrl: baseServiceUrl, asmxOps };
                    }
                }
            }
        } catch { }

        return null;
    }

    /**
     * Extracts OpenAPI spec from a Swagger URL
     * Tries multiple methods: direct endpoint check, common JSON endpoints, then HTML parsing as fallback
     */
    async extractSwaggerSpec(swaggerUrl: string): Promise<Record<string, any>> {
        const trimmedUrl = swaggerUrl.trim();

        // 1. Direct check: what if the provided URL is already a direct JSON/OpenAPI document?
        try {
            const directRes = await this.fetchWithProxy(trimmedUrl, 'application/json,text/plain,*/*');
            if (directRes.ok && directRes.json && (directRes.json['openapi'] || directRes.json['swagger'] || directRes.json['paths'])) {
                return directRes.json;
            }
        } catch { }

        // 2. Try common direct JSON endpoints against the normalized base URL
        const baseUrl = this.normalizeSwaggerUrl(trimmedUrl);
        const directJson = await this.tryDirectJsonEndpoints(baseUrl);
        if (directJson) {
            return directJson;
        }

        // Also try direct JSON endpoints against trimmedUrl if it has a sub-path different from baseUrl
        if (baseUrl !== trimmedUrl) {
            const directJsonFromOriginal = await this.tryDirectJsonEndpoints(trimmedUrl);
            if (directJsonFromOriginal) {
                return directJsonFromOriginal;
            }
        }

        // 3. Try HTML extraction from original URL
        try {
            const htmlJson = await this.extractFromHtml(trimmedUrl);
            if (htmlJson) {
                return htmlJson;
            }
        } catch { }

        // 4. Try HTML extraction with /swagger/index.html or /swagger if original didn't have it
        if (!trimmedUrl.toLowerCase().includes('/swagger')) {
            try {
                const swaggerHtml = await this.extractFromHtml(this.joinUrlPath(baseUrl, 'swagger/index.html'));
                if (swaggerHtml) {
                    return swaggerHtml;
                }
            } catch { }
        }

        throw new Error(
            `Unable to extract Swagger/OpenAPI spec from ${swaggerUrl}. ` +
            'Please verify that the API is online, CORS proxy is reachable, and the endpoint serves a valid Swagger UI or OpenAPI document.'
        );
    }

    /**
     * Fetches a resource through the local OnSteroid proxy to bypass CORS restrictions.
     * Falls back to direct HTTP get if proxy is unavailable.
     */
    private async fetchWithProxy(targetUrl: string, accept = 'application/json'): Promise<{ ok: boolean; status: number; text: string; json: any }> {
        const isElectron = isElectronApp();
        const isLoopback = isLocalhostOrLoopbackUrl(targetUrl);

        // Direct fetch for localhost or 127.* since cloud/remote proxy cannot reach local machine
        if (isLoopback) {
            try {
                const rawText = await firstValueFrom(
                    this.http.get(targetUrl, {
                        responseType: 'text' as const,
                        headers: { 'Accept': accept }
                    })
                );
                const parsedJson = this.parseStructuredSpecText(rawText);

                return {
                    ok: true,
                    status: 200,
                    text: typeof rawText === 'string' ? rawText : JSON.stringify(rawText),
                    json: parsedJson
                };
            } catch {
                return {
                    ok: false,
                    status: 0,
                    text: '',
                    json: null
                };
            }
        }

        // In browser version, route all non-loopback calls through proxy
        const timeoutMs = getGlobalRequestTimeoutMs();
        if (!isElectron) {
            const hasHttpOrigin = typeof window !== 'undefined' && /^https?:$/i.test(window.location?.protocol || '');
            const proxyEndpoints = Array.from(new Set([
                this.proxyUrl,
                this.proxyFallbackUrl,
                ...(hasHttpOrigin ? ['/api/v1/Proxy'] : [])
            ].filter(Boolean)));
            for (const proxyEndpoint of proxyEndpoints) {
                try {
                    const proxyPayload = {
                        url: targetUrl,
                        method: 'GET',
                        headers: { 'Accept': accept },
                        verifySsl: false,
                        timeoutMs: timeoutMs > 0 ? timeoutMs : 0
                    };

                    const res = await firstValueFrom(
                        this.http.post<any>(proxyEndpoint, proxyPayload, {
                            headers: { 'Content-Type': 'application/json' },
                            observe: 'response' as const
                        })
                    );

                    const data = res.body?.data || res.body;
                    if (data && data.statusCode >= 200 && data.statusCode < 400) {
                        const parsedJson = this.parseStructuredSpecText(data.body);

                        return {
                            ok: true,
                            status: data.statusCode,
                            text: typeof data.body === 'string' ? data.body : JSON.stringify(data.body),
                            json: parsedJson
                        };
                    }
                } catch {
                    // Continue to next proxy
                }
            }
        }

        // Direct fetch fallback only for Electron where web security is disabled.
        // Prefer electronAPI IPC handler so self-signed SSL certificates on internal/DMZ endpoints work reliably.
        if (isElectron) {
            const electronAPI = (typeof window !== 'undefined' ? (window as any).electronAPI : null);
            if (electronAPI?.executeHttpRequest) {
                try {
                    const eRes = await electronAPI.executeHttpRequest({
                        url: targetUrl,
                        method: 'GET',
                        headers: { 'Accept': accept },
                        verifySsl: false,
                        followRedirects: true,
                        timeoutMs
                    });
                    if (eRes && eRes.statusCode >= 200 && eRes.statusCode < 400) {
                        const text = typeof eRes.body === 'string' ? eRes.body : JSON.stringify(eRes.body ?? '');
                        const parsedJson = this.parseStructuredSpecText(text);
                        return {
                            ok: true,
                            status: eRes.statusCode,
                            text,
                            json: parsedJson
                        };
                    }
                } catch { }
            }

            try {
                const rawText = await firstValueFrom(
                    this.http.get(targetUrl, {
                        responseType: 'text' as const,
                        headers: { 'Accept': accept }
                    })
                );
                const parsedJson = this.parseStructuredSpecText(rawText);

                return {
                    ok: true,
                    status: 200,
                    text: typeof rawText === 'string' ? rawText : JSON.stringify(rawText),
                    json: parsedJson
                };
            } catch {
                return {
                    ok: false,
                    status: 0,
                    text: '',
                    json: null
                };
            }
        }

        return {
            ok: false,
            status: 0,
            text: 'CORS bypass failed through proxy',
            json: null
        };
    }

    private parseStructuredSpecText(raw: any): any {
        if (raw && typeof raw === 'object') return raw;
        if (typeof raw !== 'string') return null;
        const trimmed = raw.trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch {
            // Try YAML OpenAPI / Swagger fallback when text looks like YAML (not HTML/XML)
            if (!trimmed.startsWith('<') && /(?:^|\n)\s*(?:openapi|swagger|paths)\s*:/i.test(trimmed)) {
                try {
                    return parseYamlToObject(trimmed);
                } catch { }
            }
            return null;
        }
    }

    /**
     * Tries common direct JSON/YAML OpenAPI endpoints using proxy to avoid CORS
     */
    private async tryDirectJsonEndpoints(baseUrl: string): Promise<Record<string, any> | null> {
        const endpoints = [
            '/swagger/v1/swagger.json',
            '/v3/api-docs',
            '/v3/api-docs.yaml',
            '/v1/swagger.json',
            '/v2/swagger.json',
            '/api-docs',
            '/openapi.json',
            '/openapi.yaml',
            '/openapi.yml',
            '/v1/openapi.json',
            '/swagger.json',
            '/swagger.yaml',
            '/swagger.yml',
            '/swagger/index.json',
            '/api/swagger.json',
            '/api/v1/swagger.json',
            '/api/v1/openapi.json',
            '/api/openapi.yaml',
            '/docs/json',
            '/docs/yaml',
            '/api-doc.json',
            '/v3/api-docs/swagger-config'
        ];

        for (const endpoint of endpoints) {
            try {
                const jsonUrl = this.joinUrlPath(baseUrl, endpoint);
                const res = await this.fetchWithProxy(jsonUrl, 'application/json,application/yaml,text/yaml,*/*');

                if (res.ok && res.json) {
                    if (res.json['openapi'] || res.json['swagger'] || res.json['paths']) {
                        return res.json;
                    }
                    if (typeof res.json.url === 'string') {
                        const targetUrl = /^https?:\/\//i.test(res.json.url)
                            ? res.json.url
                            : this.joinUrlPath(baseUrl, res.json.url);
                        const subRes = await this.fetchWithProxy(targetUrl, 'application/json,application/yaml,text/yaml,*/*');
                        if (subRes.ok && subRes.json && (subRes.json['openapi'] || subRes.json['swagger'] || subRes.json['paths'])) {
                            return subRes.json;
                        }
                    }
                }
            } catch {
                // Continue to next endpoint
            }
        }

        return null;
    }

    private async tryResolveDocFromHtmlContent(html: string, pageUrl: string): Promise<Record<string, any> | null> {
        const match = extractDocHtmlSpecReference(html);
        if (!match) return null;
        if (match.kind === 'inline-spec') return match.spec;
        if (match.kind === 'spec-url') {
            return await this.resolveAndFetchSpec(match.url, pageUrl);
        }
        for (const scriptSrc of match.urls) {
            try {
                const scriptUrl = new URL(scriptSrc, pageUrl).toString();
                const scriptRes = await this.fetchWithProxy(scriptUrl, '*/*');
                if (!scriptRes.ok || !scriptRes.text) continue;
                const scriptRef = extractDocHtmlSpecReference(scriptRes.text);
                if (scriptRef?.kind === 'inline-spec') return scriptRef.spec;
                if (scriptRef?.kind === 'spec-url') {
                    const spec = await this.resolveAndFetchSpec(scriptRef.url, scriptUrl);
                    if (spec) return spec;
                }
            } catch { }
        }
        return null;
    }

    /**
     * Extracts OpenAPI spec from HTML shells used by Swagger UI, Redoc, Scalar, Stoplight Elements, and RapiDoc.
     */
    private async extractFromHtml(swaggerUrl: string): Promise<Record<string, any> | null> {
        try {
            const htmlRes = await this.fetchWithProxy(swaggerUrl, 'text/html,application/xhtml+xml,*/*');
            if (!htmlRes.ok || !htmlRes.text) {
                throw new Error(`Unable to load API docs content from ${swaggerUrl}.`);
            }
            const resolved = await this.tryResolveDocFromHtmlContent(htmlRes.text, swaggerUrl);
            if (!resolved) {
                throw new Error(
                    `Could not find an OpenAPI/Swagger specification in API docs HTML or assets for ${swaggerUrl}.`
                );
            }
            return resolved;
        } catch (error: any) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error('Unable to extract API specification from the provided URL.');
        }
    }

    private async fetchOpenApiSpec(absoluteUrl: string): Promise<Record<string, any> | null> {
        try {
            const res = await this.fetchWithProxy(absoluteUrl, 'application/json,application/yaml,text/yaml,*/*');
            if (res.ok && res.json && (res.json['openapi'] || res.json['swagger'] || res.json['paths'])) {
                return res.json;
            }
        } catch {
            // ignore and return null
        }

        return null;
    }

    private async resolveAndFetchSpec(jsonUrl: string, contextUrl: string): Promise<Record<string, any> | null> {
        if (/^https?:\/\//i.test(jsonUrl)) {
            return this.fetchOpenApiSpec(jsonUrl);
        }

        // 1. Try subpath-preserving join with normalized service base
        const serviceBase = this.normalizeSwaggerUrl(contextUrl);
        const subpathUrl = this.joinUrlPath(serviceBase, jsonUrl);
        try {
            const spec = await this.fetchOpenApiSpec(subpathUrl);
            if (spec) return spec;
        } catch { }

        // 2. Try standard URL resolution relative to contextUrl as fallback
        try {
            const absoluteUrl = new URL(jsonUrl, contextUrl).toString();
            if (absoluteUrl !== subpathUrl) {
                const spec = await this.fetchOpenApiSpec(absoluteUrl);
                if (spec) return spec;
            }
        } catch { }

        return null;
    }

    /**
     * Appends a sub-path or endpoint to a base URL without stripping existing base path segments
     */
    private joinUrlPath(baseUrl: string, endpointPath: string): string {
        const cleanBase = baseUrl.trim().replace(/\/+$/, '');
        const cleanEndpoint = endpointPath.trim().replace(/^\/+/, '');
        if (!cleanBase) return `/${cleanEndpoint}`;
        if (!cleanEndpoint) return cleanBase;
        return `${cleanBase}/${cleanEndpoint}`;
    }

    /**
     * Normalizes Swagger URL to base service URL.
     * Strips Swagger documentation and JSON suffixes while strictly preserving any
     * subpaths/suffixes after the domain name (e.g. /customer-service, /api/v1).
     */
    private normalizeSwaggerUrl(url: string): string {
        return extractServiceBaseFromDocUrl(url) || url.trim().replace(/\/+$/, '');
    }
}