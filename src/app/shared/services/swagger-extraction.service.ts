import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * Service for extracting OpenAPI/Swagger specifications from various sources
 * Uses a multi-method approach with fallbacks for maximum compatibility
 */
@Injectable({
    providedIn: 'root'
})
export class SwaggerExtractionService {
    private http = inject(HttpClient);
    private proxyUrl = 'https://localhost:7131/api/v1/Proxy';
    private proxyFallbackUrl = 'http://localhost:5131/api/v1/Proxy';

    /**
     * Extracts OpenAPI spec from a Swagger URL
     * Tries multiple methods: direct endpoints first, then HTML parsing as fallback
     */
    async extractSwaggerSpec(swaggerUrl: string): Promise<Record<string, any>> {
        const baseUrl = this.normalizeSwaggerUrl(swaggerUrl);

        const directJson = await this.tryDirectJsonEndpoints(baseUrl);
        if (directJson) {
            return directJson;
        }

        const htmlJson = await this.extractFromHtml(swaggerUrl);
        if (htmlJson) {
            return htmlJson;
        }

        throw new Error(
            `Unable to extract Swagger spec from ${swaggerUrl}. ` +
            'Tried common direct JSON endpoints and inspected Swagger UI assets (index.html / index.js). ' +
            'If this is a Swagger UI build, verify the app is reachable and includes a URL ending with .json.'
        );
    }

    /**
     * Fetches a resource through the local OnSteroids proxy to bypass CORS restrictions.
     * Falls back to direct HTTP get if proxy is unavailable.
     */
    private async fetchWithProxy(targetUrl: string, accept = 'application/json'): Promise<{ ok: boolean; status: number; text: string; json: any }> {
        const proxyEndpoints = [this.proxyUrl, this.proxyFallbackUrl];
        for (const proxyEndpoint of proxyEndpoints) {
            try {
                const proxyPayload = {
                    url: targetUrl,
                    method: 'GET',
                    headers: { 'Accept': accept }
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
                // Try next proxy endpoint
            }
        }

        // Direct fetch fallback in case proxy is offline or target is local
        try {
            const rawText = await firstValueFrom(
                this.http.get(targetUrl, {
                    responseType: 'text' as const,
                    headers: { 'Accept': accept }
                })
            );
            let parsedJson: any = null;
            try {
                parsedJson = JSON.parse(rawText);
            } catch { }

            return {
                ok: true,
                status: 200,
                text: rawText,
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

    /**
     * Tries common direct JSON endpoints (most reliable method) using proxy to avoid CORS
     */
    private async tryDirectJsonEndpoints(baseUrl: string): Promise<Record<string, any> | null> {
        const endpoints = [
            '/swagger/v1/swagger.json',
            '/api-docs',
            '/openapi.json',
            '/v1/openapi.json',
            '/swagger.json',
            '/swagger/index.json',
        ];

        for (const endpoint of endpoints) {
            try {
                const jsonUrl = new URL(endpoint, baseUrl).toString();
                const res = await this.fetchWithProxy(jsonUrl, 'application/json');

                if (res.ok && res.json && (res.json['openapi'] || res.json['swagger'])) {
                    return res.json;
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
        // If it ends with /swagger/index.html, return the base
        if (url.endsWith('/swagger/index.html')) {
            return url.replace(/\/swagger\/index\.html$/i, '');
        }

        // If it ends with /index.html, return the parent directory
        if (url.endsWith('/index.html')) {
            return url.replace(/\/index\.html$/i, '');
        }

        // Return as-is if already base URL
        return url;
    }
}
