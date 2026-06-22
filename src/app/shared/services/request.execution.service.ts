import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams, HttpResponse, HttpErrorResponse } from '@angular/common/http';
import { TabStateService, RequestState, FormDataRow } from './tab.state.service';
import { VariableService } from './variable.service';
import { SandboxExecutionService } from './sandbox.execution.service';
import { AutoAuthService } from './auto-auth.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class RequestExecutionService {
    private http = inject(HttpClient);
    private tabStateService = inject(TabStateService);
    private variableService = inject(VariableService);
    private sandboxService = inject(SandboxExecutionService);
    // Use injector for AutoAuthService to avoid circular dependency if needed, but here it might be fine.
    private autoAuthService = inject(AutoAuthService);

    private pendingRequests = new Map<string, () => void>();

    cancelRequest(tabId: string) {
        const cancelFn = this.pendingRequests.get(tabId);
        if (cancelFn) {
            cancelFn();
            this.pendingRequests.delete(tabId);
        }
    }

    async executeRequest(tabId: string, isAutoAuthRetry: boolean = false): Promise<void> {
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

            // Inject globally cached Auto-Auth token if no tab-level auth is configured
            const autoAuthEnabled = this.autoAuthService.isAutoAuthEnabled(tabId);
            if (autoAuthEnabled && !state.auth.token) {
                const cachedToken = this.autoAuthService.getCachedToken();
                if (cachedToken) {
                    const alreadyHasAuth = headers.some(h => h.key.toLowerCase() === 'authorization');
                    if (!alreadyHasAuth) {
                        headers.push({ key: 'Authorization', value: `Bearer ${cachedToken}` });
                    }
                }
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
                    body = state.formData.filter((f: FormDataRow) => f.enabled && f.key).map((f: FormDataRow) => ({ ...f }));
                }
            }

            // 5. Script Execution (Encryption -> Pre-Request)
            let preRequestLogs = '';

            // 5a. Encryption Script
            const encryptionScriptCode = state.encryption?.script;
            let encryptionLogs = '';
            if (encryptionScriptCode && encryptionScriptCode.trim()) {
                // Serialize body to JSON string for encryption script
                const bodyStr = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '');
                console.log('🔐 [Encryption] Initial body:', body);
                console.log('🔐 [Encryption] Serialized bodyStr:', bodyStr);

                const encContext = {
                    headers,
                    body: bodyStr,
                    params,
                    encryptedHeaders: state.encryption?.encryptedHeaders || [],
                    encryptedBodyPaths: state.encryption?.encryptedBodyPaths || [],
                    autoEncryptBody: state.encryption?.autoEncryptBody || false,
                    autoEncryptHeaders: state.encryption?.autoEncryptHeaders || false,
                    channelName: state.encryption?.channelName || ''
                };
                const encResult = await this.sandboxService.executeScript(encryptionScriptCode, encContext);
                encryptionLogs = encResult.logs || '';
                if (encResult.logs) preRequestLogs += 'Encryption Logs:\n' + encResult.logs + '\n\n';

                console.log('🔐 [Encryption] Script result:', encResult);
                console.log('🔐 [Encryption] Result context.body:', encResult.context?.body);

                if (encResult.success && encResult.context) {
                     headers = encResult.context.headers || headers;
                     // Parse body back to object if it was originally an object
                     const encryptedBodyStr = encResult.context.body != null ? encResult.context.body : bodyStr;
                     console.log('🔐 [Encryption] encryptedBodyStr to parse:', encryptedBodyStr);

                     try {
                         body = JSON.parse(encryptedBodyStr);
                         console.log('🔐 [Encryption] Parsed body to object:', body);
                     } catch (parseErr) {
                         body = encryptedBodyStr;
                         console.log('🔐 [Encryption] Using encryptedBodyStr as-is (not valid JSON):', body);
                     }
                     params = encResult.context.params || params;
                     console.log('🔐 [Encryption] Final body after encryption:', body);
                } else if (encResult.error) {
                    encryptionLogs = `Encryption Error: ${encResult.error}`;
                    preRequestLogs += `\nEncryption Error: ${encResult.error}\n\n`;
                    console.error('🔐 [Encryption] ERROR - Encryption script failed:', encResult.error);
                    console.warn('🔐 [Encryption] Using original body due to encryption error');
                }
            }

            // 5b. Pre-Request Script
            const preScriptCode = state.scripts?.preRequest;
            if (preScriptCode && preScriptCode.trim()) {
                const context = {
                    headers,
                    body,
                    params
                };
                const result = await this.sandboxService.executeScript(preScriptCode, context);
                preRequestLogs += result.logs || '';

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

            // Ensure Content-Type is application/json if body is an object or JSON string and not already set
            if (body && !httpHeaders.has('Content-Type')) {
                if (typeof body === 'object' || (typeof body === 'string' && body.trim().startsWith('{'))) {
                    httpHeaders = httpHeaders.set('Content-Type', 'application/json');
                }
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
            let finalUrl = resolvedUrl;

            // Bypass CORS if enabled and not calling a local network address
            if (state.settings?.bypassCors) {
                const isLocalhost = finalUrl.includes('localhost') || finalUrl.includes('127.0.0.1');
                if (!isLocalhost) {
                    finalUrl = `https://corsproxy.io/?${encodeURIComponent(finalUrl)}`;
                }
            }

            const startTime = performance.now();
            let httpResponse: HttpResponse<string> | HttpErrorResponse | null = null;

            console.log('📤 [HTTP Request] Method:', state.method);
            console.log('📤 [HTTP Request] URL:', finalUrl);
            console.log('📤 [HTTP Request] Body:', body);
            console.log('📤 [HTTP Request] Headers:', httpHeaders.keys().map(k => `${k}: ${httpHeaders.get(k)}`));

            try {
              let reqObservable: any;
              switch (state.method){
                case 'GET': reqObservable = this.http.get(finalUrl, reqOptions); break;
                case 'POST': 
                    console.log('📤 [HTTP] Sending POST with body:', body);
                    reqObservable = this.http.post(finalUrl, body, reqOptions); break;
                case 'PUT':
                    console.log('📤 [HTTP] Sending PUT with body:', body);
                    reqObservable = this.http.put(finalUrl, body, reqOptions); break;
                case 'DELETE': reqObservable = this.http.delete(finalUrl, reqOptions); break;
                case 'PATCH': reqObservable = this.http.patch(finalUrl, body, reqOptions); break;
                case 'HEAD': reqObservable = this.http.head(finalUrl, reqOptions); break;
                case 'OPTIONS': reqObservable = this.http.options(finalUrl, reqOptions); break;
                default: reqObservable = this.http.request(state.method, finalUrl, { ...reqOptions, body }); break;
              }

              httpResponse = await new Promise((resolve, reject) => {
                  const sub = reqObservable.subscribe({
                      next: (res: any) => resolve(res),
                      error: (err: any) => resolve(err)
                  });
                  this.pendingRequests.set(tabId, () => {
                      sub.unsubscribe();
                      reject(new Error('Request cancelled'));
                  });
              });
            } catch (err: any) {
                if (err.message === 'Request cancelled') {
                    console.log('🚫 [HTTP] Request cancelled by user');
                    this.tabStateService.updateState(tabId, { isLoading: false });
                    return; // Stop processing
                }
                httpResponse = err as HttpErrorResponse;
            } finally {
                this.pendingRequests.delete(tabId);
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
                    responseHeader: responseHeaders, // alias for backwards compatibility with default script
                    responseBody: responseBodyParsed,
                    headers, // provide request headers to post-script
                    body, // provide request body to post-script
                    params // provide request params to post-script
                };
                const result = await this.sandboxService.executeScript(postScriptCode, context);
                postResponseLogs = result.logs || '';

                if (result.success && result.context) {
                     // Allow scripts to read results
                } else if (result.error) {
                    postResponseLogs += `\nError: ${result.error}`;
                }
            }

            // 10. Auto Auth Check — only triggered on 401, never on initial request
            if (status === 401 && !isAutoAuthRetry && this.autoAuthService.isAutoAuthEnabled(tabId)) {
                const endpointId = this.autoAuthService.getAutoAuthEndpointId();
                if (endpointId) {
                    console.log('🔄 [Auto Auth] 401 Detected. Attempting auto authentication...');

                    // If a cached token existed but got 401, it has expired — clear it
                    if (this.autoAuthService.getCachedToken()) {
                        console.log('🔄 [Auto Auth] Cached token expired. Clearing and re-authenticating.');
                        this.autoAuthService.clearCachedToken();
                    }

                    // Remember original active tab
                    const originalTabId = this.tabStateService.activeTabId();

                    // Switch to auth tab and execute
                    this.tabStateService.setActiveTab(endpointId);
                    await this.executeRequest(endpointId, true); // true to prevent infinite loops

                    // Get token from auth response
                    const authState = this.tabStateService.getState(endpointId);
                    if (authState && authState.responseStatus === 200) {
                        const token = this.autoAuthService.extractAccessToken(authState.responseBody);
                        if (token) {
                            console.log('🔄 [Auto Auth] Token extracted & cached globally. Retrying original request...');

                            // Cache the token globally so all other tabs can reuse it
                            this.autoAuthService.setCachedToken(token);

                            // Also update this tab's auth state for explicit auth type tabs
                            const originalState = this.tabStateService.getState(tabId);
                            if (originalState && (originalState.auth.type === 'bearer' || originalState.auth.type === 'none')) {
                                this.tabStateService.updateState(tabId, {
                                    auth: {
                                        ...originalState.auth,
                                        type: 'bearer',
                                        token: token
                                    }
                                });
                            }

                            // Switch back and retry
                            this.tabStateService.setActiveTab(tabId);
                            await this.executeRequest(tabId, true);
                            return; // Exit here as retry will handle state update
                        } else {
                            console.warn('🔄 [Auto Auth] Could not extract token from auth response.');
                        }
                    } else {
                        console.warn('🔄 [Auto Auth] Auth request failed with status:', authState?.responseStatus);
                    }

                    // Restore original tab if auth failed
                    if (originalTabId) {
                        this.tabStateService.setActiveTab(originalTabId);
                    }
                }
            }

            // 11. Update Tab State
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
                    postResponseConsole: postResponseLogs,
                    encryptionConsole: encryptionLogs
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
