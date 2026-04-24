import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { TabStateService, RequestState } from './tab.state.service';
import { VariableService } from './variable.service';
import { SandboxExecutionService } from './sandbox.execution.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class RequestExecutionService {
    private http = inject(HttpClient);
    private tabStateService = inject(TabStateService);
    private variableService = inject(VariableService);
    private sandboxService = inject(SandboxExecutionService);

    async executeRequest(tabId: string): Promise<void> {
        const state = this.tabStateService.activeTabState();
        if (!state || state.id !== tabId) return;

        // Set Tab to Loading
        this.tabStateService.updateState(tabId, { isLoading: true });

        try {
            // 1. Resolve URL
            const resolvedUrl = this.variableService.resolve(state.url);

            // 2. Prepare Headers
            let headers = state.headers
                .filter(h => h.enabled && h.key)
                .map(h => ({
                    key: this.variableService.resolve(h.key),
                    value: this.variableService.resolve(h.value)
                }));

            // Inject Auth Header if applicable
            if (state.auth.type === 'bearer' && state.auth.token) {
                headers.push({ key: 'Authorization', value: `Bearer ${this.variableService.resolve(state.auth.token)}` });
            } else if (state.auth.type === 'basic' && state.auth.token) {
                // In Post-on-Steroids MVP, the 'token' field holds the entire base64 string or we assume it's just the token part
                headers.push({ key: 'Authorization', value: `Basic ${this.variableService.resolve(state.auth.token)}` });
            }

            // 3. Prepare Params
            let params = state.params
                .filter(p => p.enabled && p.key)
                .map(p => ({
                    key: this.variableService.resolve(p.key),
                    value: this.variableService.resolve(p.value)
                }));

            // 4. Prepare Body
            let body: any = null;
            if (state.method !== 'GET' && state.method !== 'HEAD') {
                if (state.bodyType === 'raw') {
                    const resolvedRaw = this.variableService.resolve(state.rawBody || '');
                    try {
                        body = JSON.parse(resolvedRaw);
                    } catch {
                        body = resolvedRaw;
                    }
                } else if (state.bodyType === 'form-data') {
                    // For Sandbox passing we can pass form-data as array
                    body = state.formData.filter(f => f.enabled && f.key).map(f => ({ ...f }));
                }
            }

            // 5. Pre-Request Script Execution
            const preScriptCode = state.scripts?.preRequest;
            let preRequestLogs = '';
            if (preScriptCode && preScriptCode.trim()) {
                const context = { 
                    headers, 
                    body, 
                    params 
                };
                const result = await this.sandboxService.executeScript(preScriptCode, context);
                preRequestLogs = result.logs || '';
                
                if (result.success && result.context) {
                     headers = result.context.headers || headers;
                     body = result.context.body !== undefined ? result.context.body : body;
                     params = result.context.params || params;
                } else if (result.error) {
                    preRequestLogs += `\nError: ${result.error}`;
                }
            }

            // 6. Build Http headers and params
            let httpHeaders = new HttpHeaders();
            headers.forEach(h => {
                httpHeaders = httpHeaders.set(h.key, h.value);
            });

            // XML Support: ensure Content-Type is set if raw type is XML
            if (state.bodyType === 'raw' && state.rawType === 'XML' && !httpHeaders.has('Content-Type')) {
                httpHeaders = httpHeaders.set('Content-Type', 'application/xml');
            }

            let httpParams = new HttpParams();
            params.forEach(p => {
                httpParams = httpParams.append(p.key, p.value);
            });

            const reqOptions = {
                headers: httpHeaders,
                params: httpParams,
                observe: 'response' as const,
                responseType: 'text' as const 
            };

            // 7. Make the Call
            // ... (keep current call logic) ...
            const startTime = performance.now();
            let httpResponse: HttpResponse<string> | HttpErrorResponse | null = null;
            
            try {
                if (state.method === 'GET') {
                    httpResponse = await firstValueFrom(this.http.get(resolvedUrl, reqOptions));
                } else if (state.method === 'POST') {
                    httpResponse = await firstValueFrom(this.http.post(resolvedUrl, body, reqOptions));
                } else if (state.method === 'PUT') {
                    httpResponse = await firstValueFrom(this.http.put(resolvedUrl, body, reqOptions));
                } else if (state.method === 'DELETE') {
                    httpResponse = await firstValueFrom(this.http.delete(resolvedUrl, reqOptions));
                } else if (state.method === 'PATCH') {
                    httpResponse = await firstValueFrom(this.http.patch(resolvedUrl, body, reqOptions));
                } else if (state.method === 'HEAD') {
                    httpResponse = await firstValueFrom(this.http.head(resolvedUrl, reqOptions)) as any;
                } else if (state.method === 'OPTIONS') {
                    httpResponse = await firstValueFrom(this.http.options(resolvedUrl, reqOptions));
                } else {
                    httpResponse = await firstValueFrom(this.http.request(state.method, resolvedUrl, { ...reqOptions, body }));
                }
            } catch (err: any) {
                httpResponse = err as HttpErrorResponse;
            }

            const endTime = performance.now();
            const responseTime = Math.floor(endTime - startTime);

            // 8. Process Response
            const status = httpResponse?.status || 0;
            let rawResponseBody = (httpResponse as any)?.error || (httpResponse as HttpResponse<string>)?.body || '';
            let responseSize = 0;

            if (typeof rawResponseBody === 'string') {
                responseSize = new Blob([rawResponseBody]).size;
            } else if (rawResponseBody) {
                const str = JSON.stringify(rawResponseBody);
                responseSize = new Blob([str]).size;
            }

            const responseHeaders: { key: string, value: string }[] = [];
            httpResponse?.headers?.keys().forEach(key => {
                responseHeaders.push({ key, value: httpResponse!.headers.get(key) || '' });
            });

            let responseBodyParsed = rawResponseBody;
            if (typeof rawResponseBody === 'string') {
                try {
                    responseBodyParsed = JSON.parse(rawResponseBody);
                } catch {
                    responseBodyParsed = rawResponseBody;
                }
            }

            // 9. Post-Response Script Execution
            const postScriptCode = state.scripts?.postResponse;
            let postResponseLogs = '';
            if (postScriptCode && postScriptCode.trim()) {
                const context = { 
                    responseHeaders, 
                    responseBody: responseBodyParsed 
                };
                const result = await this.sandboxService.executeScript(postScriptCode, context);
                postResponseLogs = result.logs || '';
                
                if (result.success && result.context) {
                     // Allow scripts to read results
                } else if (result.error) {
                    postResponseLogs += `\nError: ${result.error}`;
                }
            }

            // 10. Update Tab State
            this.tabStateService.updateState(tabId, {
                isLoading: false,
                responseBody: responseBodyParsed,
                responseStatus: status,
                responseTime,
                responseSize,
                responseHeaders: responseHeaders.map(rh => ({ enabled: true, key: rh.key, value: rh.value })),
                scripts: {
                    ...state.scripts,
                    preRequestConsole: preRequestLogs,
                    postResponseConsole: postResponseLogs
                }
            });

        } catch (globalErr: any) {
            console.error("Critical Execution Error:", globalErr);
            this.tabStateService.updateState(tabId, {
                isLoading: false,
                responseStatus: 0,
                responseBody: `Error connecting: ${globalErr.message || globalErr}`
            });
        }
    }
}
