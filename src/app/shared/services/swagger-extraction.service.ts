import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { isLocalhostOrLoopbackUrl } from '../utils/url.util';

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
                const swaggerHtml = await this.extractFromHtml(`${baseUrl}/swagger/index.html`);
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
        const isElectron = /electron/i.test(navigator.userAgent);
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
        // In the browser, direct calls to external URLs fail due to CORS.
        if (isElectron) {
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
                const jsonUrl = new URL(endpoint, baseUrl).toString();
                const res = await this.fetchWithProxy(jsonUrl, 'application/json');

                if (res.ok && res.json) {
                    if (res.json['openapi'] || res.json['swagger'] || res.json['paths']) {
                        return res.json;
                    }
                    if (typeof res.json.url === 'string') {
                        const targetUrl = new URL(res.json.url, jsonUrl).toString();
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

                const absoluteUrl = new URL(jsonUrl, scriptUrl).toString();
                const spec = await this.fetchOpenApiSpec(absoluteUrl);
                if (!spec) {
                    throw new Error(`Failed to download OpenAPI spec from ${absoluteUrl}.`);
                }

                return spec;
            }

            const absoluteUrl = new URL(jsonUrl, swaggerUrl).toString();
            const spec = await this.fetchOpenApiSpec(absoluteUrl);
            if (!spec) {
                throw new Error(`Failed to download OpenAPI spec from ${absoluteUrl}.`);
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

    /**
     * Normalizes Swagger URL to base URL
     * Removes /swagger/index.html suffix if present
     */
    private normalizeSwaggerUrl(url: string): string {
        let normalized = url.trim();

        // If it ends with .json, return origin or base directory
        if (/\.json$/i.test(normalized)) {
            try {
                return new URL(normalized).origin;
            } catch {
                return normalized.replace(/\/[^/]+\.json$/i, '');
            }
        }

        // If it ends with /swagger/index.html
        if (/\/swagger\/index\.html\/?$/i.test(normalized)) {
            return normalized.replace(/\/swagger\/index\.html\/?$/i, '');
        }

        // If it ends with /index.html
        if (/\/index\.html\/?$/i.test(normalized)) {
            return normalized.replace(/\/index\.html\/?$/i, '');
        }

        // If it ends with /swagger
        if (/\/swagger\/?$/i.test(normalized)) {
            return normalized.replace(/\/swagger\/?$/i, '');
        }

        // Strip trailing slash
        if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    }
}