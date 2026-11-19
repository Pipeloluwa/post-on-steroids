import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { isLocalhostOrLoopbackUrl, isElectronApp } from '../utils/url.util';
import { isWsdlXml, inspectAsmxOrSvcHtml, extractWsdlSchemaLocations } from '../utils/wsdl-parser.util';

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

        // Check direct response first: might be OpenAPI JSON or WSDL XML
        try {
            const directRes = await this.fetchWithProxy(trimmedUrl, 'application/json,application/xml,text/xml,text/html,*/*');
            if (directRes.ok) {
                if (directRes.json && (directRes.json['openapi'] || directRes.json['swagger'] || directRes.json['paths'])) {
                    return { kind: 'openapi', spec: directRes.json, sourceUrl: trimmedUrl };
                }
                if (isWsdlXml(directRes.text)) {
                    const xsdXmls = await this.fetchWsdlImports(directRes.text, trimmedUrl);
                    return { kind: 'wsdl', wsdlXml: directRes.text, xsdXmls, serviceUrl: trimmedUrl };
                }
                const asmxCheck = inspectAsmxOrSvcHtml(directRes.text, trimmedUrl);
                if (asmxCheck.wsdlUrls.length > 0 || asmxCheck.operationNames.length > 0) {
                    const soapRes = await this.tryExtractSoapSpec(trimmedUrl);
                    if (soapRes) return soapRes;
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
        const schemaLocs = extractWsdlSchemaLocations(wsdlXml, baseUrl).slice(0, 8);
        if (schemaLocs.length === 0) return [];
        const results = await Promise.all(
            schemaLocs.map(async loc => {
                try {
                    const res = await this.fetchWithProxy(loc, 'application/xml,text/xml,*/*');
                    return res.ok && res.text ? res.text : '';
                } catch {
                    return '';
                }
            })
        );
        return results.filter(Boolean);
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
                let parsedJson: any = null;
                try {
                    parsedJson = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
                } catch { }

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
        if (!isElectron) {
            const proxyEndpoints = [this.proxyUrl, this.proxyFallbackUrl];
            for (const proxyEndpoint of proxyEndpoints) {
                try {
                    const proxyPayload = {
                        url: targetUrl,
                        method: 'GET',
                        headers: { 'Accept': accept },
                        verifySsl: false
                    };

                    const res = await firstValueFrom(
                        this.http.post<any>(proxyEndpoint, proxyPayload, {
                            headers: { 'Content-Type': 'application/json' },
                            observe: 'response' as const
                        })
                    );

                    const data = res.body?.data || res.body;
                    if (data && data.statusCode >= 200 && data.statusCode < 400) {
                        let parsedJson: any = null;
                        try {
                            parsedJson = typeof data.body === 'string' ? JSON.parse(data.body) : data.body;
                        } catch { }

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
                        followRedirects: true
                    });
                    if (eRes && eRes.statusCode >= 200 && eRes.statusCode < 400) {
                        const text = typeof eRes.body === 'string' ? eRes.body : JSON.stringify(eRes.body ?? '');
                        let parsedJson: any = null;
                        try {
                            parsedJson = JSON.parse(text);
                        } catch { }
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
                let parsedJson: any = null;
                try {
                    parsedJson = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
                } catch { }

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

    /**
     * Tries common direct JSON endpoints (most reliable method) using proxy to avoid CORS
     */
    private async tryDirectJsonEndpoints(baseUrl: string): Promise<Record<string, any> | null> {
        const endpoints = [
            '/swagger/v1/swagger.json',
            '/v3/api-docs',
            '/v1/swagger.json',
            '/v2/swagger.json',
            '/api-docs',
            '/openapi.json',
            '/v1/openapi.json',
            '/swagger.json',
            '/swagger/index.json',
            '/api/swagger.json',
            '/api/v1/swagger.json',
            '/api/v1/openapi.json',
            '/v3/api-docs/swagger-config'
        ];

        for (const endpoint of endpoints) {
            try {
                const jsonUrl = this.joinUrlPath(baseUrl, endpoint);
                const res = await this.fetchWithProxy(jsonUrl, 'application/json');

                if (res.ok && res.json) {
                    if (res.json['openapi'] || res.json['swagger'] || res.json['paths']) {
                        return res.json;
                    }
                    if (typeof res.json.url === 'string') {
                        const targetUrl = /^https?:\/\//i.test(res.json.url)
                            ? res.json.url
                            : this.joinUrlPath(baseUrl, res.json.url);
                        const subRes = await this.fetchWithProxy(targetUrl, 'application/json');
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

    /**
     * Extracts JSON endpoint from Swagger UI HTML or JavaScript fallback
     * Handles bundle-based HTML shells and index.js config content
     */
    private async extractFromHtml(swaggerUrl: string): Promise<Record<string, any> | null> {
        try {
            const htmlRes = await this.fetchWithProxy(swaggerUrl, 'text/html,application/xhtml+xml,*/*');
            if (!htmlRes.ok || !htmlRes.text) {
                throw new Error(`Unable to load Swagger UI content from ${swaggerUrl}.`);
            }
            const html = htmlRes.text;

            let jsonUrl =
                this.extractUrlFromSwaggerUIBundle(html) ||
                this.extractUrlFromJsonParse(html) ||
                this.extractUrlFromConfigObject(html);

            if (!jsonUrl) {
                const scriptUrl = new URL('index.js', swaggerUrl).toString();
                const scriptRes = await this.fetchWithProxy(scriptUrl, '*/*');
                if (!scriptRes.ok || !scriptRes.text) {
                    throw new Error(
                        `Unable to load Swagger UI script at ${scriptUrl}. ` +
                        'Ensure the Swagger UI bundle is served correctly and index.js is reachable.'
                    );
                }
                const script = scriptRes.text;

                jsonUrl =
                    this.extractUrlFromJsonParse(script) ||
                    this.extractUrlFromSwaggerUIBundle(script) ||
                    this.extractUrlFromConfigObject(script) ||
                    this.extractJsonUrlLiteral(script);

                if (!jsonUrl) {
                    throw new Error(
                        `Could not find an OpenAPI JSON URL in Swagger UI assets for ${swaggerUrl}. ` +
                        'Look for a configuration object containing a URL ending with .json in index.html or index.js.'
                    );
                }

                const spec = await this.resolveAndFetchSpec(jsonUrl, scriptUrl);
                if (!spec) {
                    throw new Error(`Failed to download OpenAPI spec for ${jsonUrl}.`);
                }

                return spec;
            }

            const spec = await this.resolveAndFetchSpec(jsonUrl, swaggerUrl);
            if (!spec) {
                throw new Error(`Failed to download OpenAPI spec for ${jsonUrl}.`);
            }

            return spec;
        } catch (error: any) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error('Unable to extract Swagger spec from the provided URL.');
        }
    }

    /**
     * Extract URL from SwaggerUIBundle configuration: url: "[url]"
     * Handles newer Swagger UI implementations
     */
    private extractUrlFromSwaggerUIBundle(html: string): string | null {
        // Pattern: url: "[url]" or url: '[url]'
        const match = html.match(/url\s*:\s*["']([^"']+)["']/);
        if (match && match[1]) {
            return match[1];
        }

        // Alternative pattern: urls: [{url: "[url]" ...}]
        const urlsMatch = html.match(/urls\s*:\s*\[\s*{[^}]*url\s*:\s*["']([^"']+)["']/);
        if (urlsMatch && urlsMatch[1]) {
            return urlsMatch[1];
        }

        return null;
    }

    /**
     * Extract URL from JSON.parse() pattern
     * Handles older Swagger UI implementations
     */
    private extractUrlFromJsonParse(html: string): string | null {
        // Pattern: JSON.parse('[json-string]')
        const parseMatch = html.match(/JSON\.parse\(\s*["']([^"']*)["']\s*\)/);
        if (!parseMatch || !parseMatch[1]) {
            return null;
        }

        try {
            // The matched string might be escaped, so we need to process it
            let jsonString = parseMatch[1];

            // Handle escaped characters
            jsonString = jsonString
                .replace(/\\"/g, '"')
                .replace(/\\'/g, "'")
                .replace(/\\\\/g, '\\');

            const configObject = JSON.parse(jsonString);

            // Extract URL from urls array or single url property
            if (Array.isArray(configObject.urls)) {
                const urlEntry = configObject.urls.find(
                    (entry: any) => typeof entry?.url === 'string' && entry.url.toLowerCase().endsWith('.json')
                );
                if (urlEntry?.url) {
                    return urlEntry.url;
                }
            }

            if (typeof configObject.url === 'string' && configObject.url.toLowerCase().endsWith('.json')) {
                return configObject.url;
            }
        } catch {
            return null;
        }

        return null;
    }

    /**
     * Extract URL from window.swaggerSpec or similar global config
     * Handles additional edge cases
     */
    private extractUrlFromConfigObject(html: string): string | null {
        // Pattern: "url":"[url]" (JSON in script tag)
        const jsonMatch = html.match(/"url"\s*:\s*"([^"]+)"/);
        if (jsonMatch && jsonMatch[1]) {
            return jsonMatch[1];
        }

        // Pattern: urls:[...] with JSON structure in HTML
        const urlsJsonMatch = html.match(/"urls"\s*:\s*\[\s*{\s*"url"\s*:\s*"([^"]+)"/);
        if (urlsJsonMatch && urlsJsonMatch[1]) {
            return urlsJsonMatch[1];
        }

        return null;
    }

    /**
     * Extract any .json URL literal from JavaScript content
     * This is the most reliable fallback when config is embedded inside index.js
     */
    private extractJsonUrlLiteral(source: string): string | null {
        const match = source.match(/(["'])(\/[^"']+\.json)\1/);
        if (match && match[2]) {
            return match[2];
        }

        const alternateMatch = source.match(/(["'])([^"']+\.json)\1/);
        return alternateMatch && alternateMatch[2] ? alternateMatch[2] : null;
    }

    private async fetchOpenApiSpec(absoluteUrl: string): Promise<Record<string, any> | null> {
        try {
            const res = await this.fetchWithProxy(absoluteUrl, 'application/json');
            if (res.ok && res.json && (res.json['openapi'] || res.json['swagger'])) {
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
        const normalized = url.trim();

        try {
            const parsed = new URL(normalized);
            let pathname = parsed.pathname;

            const swaggerSuffixPatterns = [
                /\/swagger\/index\.html\/?$/i,
                /\/swagger\/v\d+\/swagger\.json\/?$/i,
                /\/swagger\/index\.json\/?$/i,
                /\/swagger\/[a-zA-Z0-9_.-]+\.json\/?$/i,
                /\/v\d+\/swagger\.json\/?$/i,
                /\/v\d+\/openapi\.json\/?$/i,
                /\/v3\/api-docs(\/[^/]+)?\/?$/i,
                /\/api-docs(\/[^/]+)?\/?$/i,
                /\/swagger\.json\/?$/i,
                /\/openapi\.json\/?$/i,
                /\/index\.html\/?$/i,
                /\/swagger\/?$/i,
                /\/docs\/?$/i,
                /\/api-docs\/?$/i
            ];

            for (const pattern of swaggerSuffixPatterns) {
                if (pattern.test(pathname)) {
                    pathname = pathname.replace(pattern, '');
                    break;
                }
            }

            // If it still ends with any generic .json file (e.g. /myspec.json)
            if (/\.json$/i.test(pathname)) {
                pathname = pathname.replace(/\/[^/]+\.json$/i, '');
            }

            pathname = pathname.replace(/\/+$/, '');
            return `${parsed.origin}${pathname}`;
        } catch {
            return normalized
                .replace(/\/swagger\/index\.html\/?$/i, '')
                .replace(/\/swagger\/v\d+\/swagger\.json\/?$/i, '')
                .replace(/\/v\d+\/swagger\.json\/?$/i, '')
                .replace(/\/swagger\/?$/i, '')
                .replace(/\/index\.html\/?$/i, '')
                .replace(/\/[^/]+\.json\/?$/i, '')
                .replace(/\/+$/, '');
        }
    }
}