import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { generateUUID } from '../utils/uuid.util';
import { isLocalhostOrLoopbackUrl } from '../utils/url.util';
import { sanitizeJsonBodyForScripts } from '../utils/format.utils';
import { environment } from '../../../environments/environment';

export interface SandboxResult {
  success: boolean;
  error?: string;
  logs?: string;
  context: any; // Mutated variables or other state returned from the sandbox
}

/** Network request issued by a script inside the sandbox iframe and forwarded to the parent app. */
interface SandboxFetchRequest {
  type: '__osb_fetch__';
  fetchId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Network response returned from the parent app back to the sandbox iframe. */
interface SandboxFetchResult {
  type: '__osb_fetch_result__';
  fetchId: string;
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string | null;
  error?: string;
}

type FetchOutcome = Omit<SandboxFetchResult, 'type' | 'fetchId'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? v.map(x => String(x)).join(', ') : String(v);
  }
  return out;
}

function stringifyBody(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

@Injectable({
  providedIn: 'root'
})
export class SandboxExecutionService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpClient);
  private iframe: HTMLIFrameElement | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeSandbox();
    }
  }

  private readyPromise!: Promise<void>;

  /**
   * Scripts run in an iframe sandboxed with `allow-scripts` only (no `allow-same-origin`),
   * which gives it an opaque origin. Any request sent directly from inside the iframe carries
   * `Origin: null` and is rejected by the proxy's CORS policy. Instead, the sandbox forwards
   * every fetch / XHR / pm.sendRequest call to this parent window, which performs it from the
   * real app origin — exactly like the normal request tabs do — and posts the result back.
   */
  private readonly onSandboxMessage = (event: MessageEvent): void => {
    if (!this.iframe || event.source !== this.iframe.contentWindow) return;
    const data: unknown = event.data;
    if (!isRecord(data) || data['type'] !== '__osb_fetch__' || typeof data['fetchId'] !== 'string') return;
    void this.handleSandboxFetch(data as unknown as SandboxFetchRequest);
  };

  private initializeSandbox() {
    window.addEventListener('message', this.onSandboxMessage);

    this.readyPromise = new Promise((resolve) => {
      this.iframe = document.createElement('iframe');
      this.iframe.setAttribute('sandbox', 'allow-scripts');
      this.iframe.style.display = 'none';

      this.iframe.onload = () => resolve();

      document.body.appendChild(this.iframe);

      const sandboxScript = `
// ── Network bridge: all requests are executed by the parent app (real origin) ──
const __osbPending = new Map();
let __osbSeq = 0;

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const d = event.data;
  if (!d || d.type !== "__osb_fetch_result__") return;
  const entry = __osbPending.get(d.fetchId);
  if (!entry) return;
  __osbPending.delete(d.fetchId);
  clearTimeout(entry.timer);
  if (d.ok) {
    entry.resolve(d);
  } else {
    entry.reject(new Error(d.error || "Request failed"));
  }
});

function __osbBridgeFetch(payload) {
  return new Promise((resolve, reject) => {
    const fetchId = "f" + Date.now().toString(36) + "_" + (++__osbSeq);
    const timer = setTimeout(() => {
      __osbPending.delete(fetchId);
      reject(new Error("Request timed out: " + payload.url));
    }, 120000);
    __osbPending.set(fetchId, { resolve: resolve, reject: reject, timer: timer });
    window.parent.postMessage(Object.assign({ type: "__osb_fetch__", fetchId: fetchId }, payload), "*");
  });
}

window.addEventListener("message", async (event) => {
  if (event.source !== window.parent) return;
  const { id, code, context } = event.data || {};
  if (!id) return;

  let logs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "));
    originalConsoleLog(...args);
  };

  async function _proxyFetch(input, init) {
    let targetUrl = '';
    let options = init || {};

    if (typeof input === 'string') {
      targetUrl = input;
    } else if (input && typeof input === 'object') {
      targetUrl = input.url || String(input);
      options = Object.assign({}, input, options);
    } else {
      targetUrl = String(input || '');
    }

    const method = (options.method || 'GET').toUpperCase();

    const headersObj = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function' && !Array.isArray(options.headers)) {
        options.headers.forEach((v, k) => { headersObj[k] = String(v); });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([k, v]) => { headersObj[k] = String(v); });
      } else if (typeof options.headers === 'object') {
        Object.entries(options.headers).forEach(([k, v]) => { headersObj[k] = String(v); });
      }
    }

    let bodyPayload = options.body;
    if (bodyPayload !== undefined && bodyPayload !== null && typeof bodyPayload !== 'string') {
      if (typeof URLSearchParams !== 'undefined' && bodyPayload instanceof URLSearchParams) {
        bodyPayload = bodyPayload.toString();
      } else {
        try {
          bodyPayload = JSON.stringify(bodyPayload);
        } catch {
          bodyPayload = String(bodyPayload);
        }
      }
    }

    const result = await __osbBridgeFetch({
      url: targetUrl,
      method: method,
      headers: headersObj,
      body: (bodyPayload === undefined || bodyPayload === null) ? null : bodyPayload
    });

    let status = Number(result.status) || 200;
    if (status < 200) status = 200;
    if (status > 599) status = 599;
    const nullBodyStatus = status === 204 || status === 205 || status === 304;

    const resHeaders = new Headers();
    Object.entries(result.headers || {}).forEach(([k, v]) => {
      try { resHeaders.append(k, String(v)); } catch {}
    });

    return new Response(nullBodyStatus ? null : (result.body == null ? '' : String(result.body)), {
      status: status,
      statusText: result.statusText || String(status),
      headers: resHeaders
    });
  }

  window.fetch = _proxyFetch;

  if (typeof XMLHttpRequest !== 'undefined') {
    window.XMLHttpRequest = function() {
      let _method = 'GET';
      let _url = '';
      let _headers = {};
      const _listeners = {};

      const xhr = {
        readyState: 0,
        status: 0,
        statusText: '',
        responseText: '',
        response: '',
        onreadystatechange: null,
        onload: null,
        onerror: null,
        open: function(m, u) {
          _method = m || 'GET';
          _url = u || '';
          this.readyState = 1;
        },
        setRequestHeader: function(k, v) {
          _headers[k] = v;
        },
        send: function(body) {
          _proxyFetch(_url, { method: _method, headers: _headers, body: body })
            .then(async res => {
              const text = await res.text();
              this.status = res.status;
              this.statusText = res.statusText;
              this.responseText = text;
              this.response = text;
              this.readyState = 4;
              if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
              if (typeof this.onload === 'function') this.onload();
              if (_listeners['load']) _listeners['load'].forEach(f => f());
            })
            .catch(err => {
              this.status = 0;
              this.statusText = '';
              this.readyState = 4;
              if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
              if (typeof this.onerror === 'function') this.onerror(err);
              if (_listeners['error']) _listeners['error'].forEach(f => f(err));
            });
        },
        addEventListener: function(type, fn) {
          if (!_listeners[type]) _listeners[type] = [];
          _listeners[type].push(fn);
        }
      };
      return xhr;
    };
  }

  let pm = { ...context };

  pm.sendRequest = function(req, callback) {
    let url = typeof req === 'string' ? req : (req && req.url);
    let method = (req && req.method) || 'GET';
    let headers = (req && (req.headers || req.header)) || {};
    let body = req && req.body;
    if (body && typeof body === 'object' && body.raw) {
      body = body.raw;
    }
    if (Array.isArray(headers)) {
      const hObj = {};
      headers.forEach(h => { if (h && h.key) hObj[h.key] = h.value; });
      headers = hObj;
    }

    const promise = _proxyFetch(url, { method, headers, body })
      .then(async res => {
        const rawText = await res.text();
        let parsedJson = null;
        try { parsedJson = JSON.parse(rawText); } catch {}
        const responseObj = {
          code: res.status,
          status: res.statusText,
          headers: res.headers,
          text: () => rawText,
          json: () => parsedJson,
          body: rawText
        };
        if (typeof callback === 'function') {
          callback(null, responseObj);
        }
        return responseObj;
      })
      .catch(err => {
        if (typeof callback === 'function') {
          callback(err, null);
        } else {
          throw err;
        }
      });

    return promise;
  };

  try {
    const contextKeys = Object.keys(context);
    
    // Declare all context keys as local variables
    const paramDeclarations = contextKeys.map(k => 
      "let " + k + " = context['" + k + "'];"
    ).join(String.fromCharCode(10));

    // Write back any mutations to pm
    const paramWriteBack = contextKeys.map(k => 
      "pm['" + k + "'] = " + k + ";"
    ).join(String.fromCharCode(10));

    let testResults = [];
    let testPassed = true;
    const test = (name, fn) => {
      try {
        const res = typeof fn === 'function' ? fn() : fn;
        if (res === false) {
          testResults.push({ name, passed: false, error: 'Assertion failed' });
          testPassed = false;
        } else {
          testResults.push({ name, passed: true });
        }
      } catch (err) {
        testResults.push({ name, passed: false, error: String(err) });
        testPassed = false;
      }
    };

    const fnBodyLines = [
      "return (async () => {",
      "const fetch = _proxyFetch;",
      paramDeclarations,
      code,
      "if (typeof preScript === 'function') { const _preReturn = await preScript(headers, body, params); if (_preReturn !== undefined) { body = _preReturn; } }",
      "if (typeof postScript === 'function') { await postScript(responseHeaders || responseHeader, responseBody, headers, body, params); }",
      "if (typeof testScript === 'function') { const _testReturn = await testScript(responseStatus, responseTime, responseBody, responseHeaders || responseHeader); if (_testReturn !== undefined) { testPassed = !!_testReturn; } }",
      "if (typeof encryptScript === 'function') { const _encReturn = await encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths); if (_encReturn !== undefined) { body = _encReturn; } }",
      "if (typeof decryptScript === 'function') { const _decReturn = await decryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths); if (_decReturn !== undefined) { body = _decReturn; } }",
      paramWriteBack,
      "})();"
    ];
    const fnBody = fnBodyLines.join(String.fromCharCode(10));
      
    const executeInSandbox = new Function("pm", "context", "test", "_proxyFetch", fnBody);
    await executeInSandbox(pm, context, test, _proxyFetch);

    // Extract test results from PASS/FAIL console logs if any
    for (const log of logs) {
      const match = log.match(/^(PASS|FAIL):\\s*(.*)/i);
      if (match) {
        const logName = match[2].trim();
        if (!testResults.some(t => t.name === logName)) {
          testResults.push({
            name: logName,
            passed: match[1].toUpperCase() === 'PASS'
          });
        }
      }
    }

    pm['testResults'] = testResults;
    pm['testPassed'] = testPassed;

    delete pm.sendRequest;
    const cleanContext = {};
    for (const key of Object.keys(pm)) {
      if (typeof pm[key] !== 'function') {
        try {
          cleanContext[key] = JSON.parse(JSON.stringify(pm[key]));
        } catch {
          cleanContext[key] = String(pm[key]);
        }
      }
    }

    parent.postMessage({ id, success: true, context: cleanContext, logs: logs.join("\\n") }, "*");
  } catch (err) {
    parent.postMessage({ id, success: false, error: err ? (err.message || err.toString()) : "Execution error", logs: logs.join("\\n") }, "*");
  } finally {
    console.log = originalConsoleLog;
  }
});`;

      const sandboxHtml = '<!DOCTYPE html><html><head><script>' + sandboxScript + '<\/script></head><body></body></html>';

      const blob = new Blob([sandboxHtml], { type: 'text/html' });
      this.iframe.src = URL.createObjectURL(blob);
    });
  }

  /**
   * Executes a network request on behalf of a sandboxed script using the same routing rules
   * as the normal request tabs (proxy for remote URLs on web, direct for loopback / Electron).
   */
  private async handleSandboxFetch(req: SandboxFetchRequest): Promise<void> {
    let outcome: FetchOutcome;
    try {
      const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);
      const useDirect = isElectron || isLocalhostOrLoopbackUrl(req.url);
      outcome = useDirect ? await this.directFetch(req) : await this.proxyFetch(req);
    } catch (err) {
      outcome = {
        ok: false,
        status: 0,
        statusText: '',
        headers: {},
        body: null,
        error: err instanceof Error ? err.message : `Request failed for: ${req.url}`
      };
    }

    const result: SandboxFetchResult = { type: '__osb_fetch_result__', fetchId: req.fetchId, ...outcome };
    this.iframe?.contentWindow?.postMessage(result, '*');
  }

  private async directFetch(req: SandboxFetchRequest): Promise<FetchOutcome> {
    const method = (req.method || 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD' && req.body !== null;
    const res = await fetch(req.url, {
      method,
      headers: req.headers || {},
      body: hasBody ? req.body : undefined
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    const body = await res.text();
    return { ok: true, status: res.status, statusText: res.statusText, headers, body };
  }

  private async proxyFetch(req: SandboxFetchRequest): Promise<FetchOutcome> {
    const proxyPayload = {
      url: req.url,
      method: (req.method || 'GET').toUpperCase(),
      headers: req.headers || {},
      body: req.body,
      verifySsl: false
    };

    const endpoints = Array.from(new Set([environment.proxyUrl, environment.proxyFallbackUrl].filter(Boolean)));
    let lastError: unknown = null;

    for (let i = 0; i < endpoints.length; i++) {
      const isLast = i === endpoints.length - 1;
      try {
        const res = await firstValueFrom(
          this.http.post<unknown>(endpoints[i], proxyPayload, {
            headers: new HttpHeaders({ 'Content-Type': 'application/json' }),
            observe: 'response'
          })
        );
        return this.unwrapProxyEnvelope(res.body, res.status);
      } catch (err) {
        if (err instanceof HttpErrorResponse) {
          // Connection failure, or server error with another endpoint left to try
          if (err.status === 0 || (err.status >= 500 && !isLast)) {
            lastError = err;
            continue;
          }
          return this.unwrapProxyEnvelope(err.error, err.status);
        }
        lastError = err;
      }
    }

    const reason = lastError instanceof HttpErrorResponse
      ? (lastError.message || 'network error')
      : lastError instanceof Error ? lastError.message : 'network error';
    throw new Error(`Proxy request failed for: ${req.url} (${reason})`);
  }

  /** Converts the proxy's `{ data: { statusCode, headers, body } }` envelope into a plain response. */
  private unwrapProxyEnvelope(raw: unknown, httpStatus: number): FetchOutcome {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    }

    const envelope = isRecord(parsed) ? parsed : null;
    const data = envelope && isRecord(envelope['data']) ? envelope['data'] : envelope;

    if (data && ('statusCode' in data || 'body' in data)) {
      return {
        ok: true,
        status: Number(data['statusCode']) || httpStatus || 200,
        statusText: typeof data['statusDescription'] === 'string' ? data['statusDescription'] : '',
        headers: normalizeHeaders(data['headers']),
        body: stringifyBody(data['body'])
      };
    }

    return {
      ok: true,
      status: httpStatus || 200,
      statusText: '',
      headers: {},
      body: stringifyBody(raw)
    };
  }

  async executeScript(code: string, context: any): Promise<SandboxResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return { success: false, error: 'Sandbox not available', context };
    }
    await this.readyPromise;

    return new Promise((resolve) => {
      if (!this.iframe?.contentWindow) {
        resolve({ success: false, error: 'Sandbox not available', context });
        return;
      }

      const executionId = generateUUID();

      // Setup one-time listener
      const listener = (event: MessageEvent) => {
        if (event.data?.id === executionId) {
          window.removeEventListener('message', listener);
          resolve({
            success: event.data.success,
            error: event.data.error,
            logs: event.data.logs,
            context: event.data.context
          });
        }
      };

      window.addEventListener('message', listener);

      let safeContext = context;
      try {
        safeContext = JSON.parse(JSON.stringify(context || {}));
      } catch {
        safeContext = {};
        if (context && typeof context === 'object') {
          for (const k of Object.keys(context)) {
            if (typeof context[k] !== 'function') {
              try {
                safeContext[k] = JSON.parse(JSON.stringify(context[k]));
              } catch {
                safeContext[k] = String(context[k]);
              }
            }
          }
        }
      }

      if (safeContext && typeof safeContext.body === 'string' && safeContext.body.trim()) {
        const trimmedBody = safeContext.body.trim();
        if (trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
          safeContext.body = sanitizeJsonBodyForScripts(safeContext.body);
        }
      }

      if (safeContext && Array.isArray(safeContext.headers)) {
        const encHeaders: string[] = Array.isArray(safeContext.encryptedHeaders)
          ? [...safeContext.encryptedHeaders]
          : [];
        safeContext.headers = safeContext.headers.map((h: any) => {
          if (!h || typeof h !== 'object') return h;
          const enabled = h.enabled !== false;
          const key = typeof h.key === 'string' ? h.key : String(h.key ?? '');
          let value = typeof h.value === 'string' ? h.value : String(h.value ?? '');
          const isEncryptedHeader =
            !!safeContext.autoEncryptHeaders ||
            encHeaders.some(ek => typeof ek === 'string' && ek.trim().toLowerCase() === key.trim().toLowerCase());
          if (isEncryptedHeader && key && !encHeaders.includes(key)) {
            encHeaders.push(key);
          }
          if (isEncryptedHeader && value) {
            const qm = value.trim().match(/^["'](.*)["']\s*,?$/s);
            if (qm) {
              value = qm[1].trim();
            }
          }
          return { ...h, enabled, key, value };
        });
        if (Array.isArray(safeContext.encryptedHeaders)) {
          safeContext.encryptedHeaders = encHeaders;
        }
      }

      // Upgrade any naive comment-stripping regex inside user scripts so `/` (`//` or `/*`) inside
      // encrypted Base64 string values is never mistaken for a comment and stripped.
      const safeCode = (code || '')
        .split(".replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, '')")
        .join('.replace(/"(?:[^"\\\\]|\\\\.)*"|(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*)/g, (m, c) => c ? \'\' : m)')
        .split('.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, "")')
        .join('.replace(/"(?:[^"\\\\]|\\\\.)*"|(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*)/g, (m, c) => c ? "" : m)');

      // Send code to the sandbox
      // The origin is '*' because a sandboxed iframe without allow-same-origin has an opaque origin
      this.iframe.contentWindow.postMessage({
        id: executionId,
        code: safeCode,
        context: safeContext
      }, '*');
    });
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('message', this.onSandboxMessage);
    }
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
  }
}
