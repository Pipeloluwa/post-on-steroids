import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { generateUUID } from '../utils/uuid.util';
import { environment } from '../../../environments/environment';

export interface SandboxResult {
  success: boolean;
  error?: string;
  logs?: string;
  context: any; // Mutated variables or other state returned from the sandbox
}

@Injectable({
  providedIn: 'root'
})
export class SandboxExecutionService {
  private platformId = inject(PLATFORM_ID);
  private iframe: HTMLIFrameElement | null = null;
  private messageListener: ((evt: MessageEvent) => void) | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeSandbox();
    }
  }

  private readyPromise!: Promise<void>;

  private initializeSandbox() {
    this.readyPromise = new Promise((resolve) => {
      this.iframe = document.createElement('iframe');
      this.iframe.setAttribute('sandbox', 'allow-scripts');
      this.iframe.style.display = 'none';

      this.iframe.onload = () => resolve();

      document.body.appendChild(this.iframe);

      const sandboxScript = `
window.addEventListener("message", async (event) => {
  const { id, code, context, proxyUrl, proxyFallbackUrl, isElectron } = event.data;
  if (!id) return;

  let logs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "));
    originalConsoleLog(...args);
  };

  const _rawFetch = window.fetch ? window.fetch.bind(window) : null;

  function isLocalhostOrLoopbackUrl(url) {
    if (!url) return false;
    var trimmed = String(url).trim().toLowerCase();
    try {
      var parsed = new URL(trimmed.includes('://') ? trimmed : 'http://' + trimmed);
      var hostname = parsed.hostname.toLowerCase();
      return hostname === 'localhost' ||
             hostname.endsWith('.localhost') ||
             hostname === '::1' ||
             hostname === '[::1]' ||
             /^127\.\d+\.\d+\.\d+$/.test(hostname);
    } catch (e) {
      return /(^|[/:@])(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)(:\d+)?([/?#]|$)/i.test(trimmed);
    }
  }

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

    if ((isElectron || isLocalhostOrLoopbackUrl(targetUrl)) && _rawFetch) {
      return _rawFetch(input, init);
    }

    const method = (options.method || 'GET').toUpperCase();

    const headersObj = {};
    if (options.headers) {
      if (typeof options.headers.forEach === 'function') {
        options.headers.forEach((v, k) => { headersObj[k] = String(v); });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([k, v]) => { headersObj[k] = String(v); });
      } else if (typeof options.headers === 'object') {
        Object.entries(options.headers).forEach(([k, v]) => { headersObj[k] = String(v); });
      }
    }

    let bodyPayload = options.body;
    if (bodyPayload !== undefined && bodyPayload !== null && typeof bodyPayload !== 'string') {
      try {
        bodyPayload = JSON.stringify(bodyPayload);
      } catch {
        bodyPayload = String(bodyPayload);
      }
    }

    const proxyPayload = {
      url: targetUrl,
      method: method,
      headers: headersObj,
      body: bodyPayload,
      verifySsl: false
    };

    const endpoints = [proxyUrl, proxyFallbackUrl].filter(Boolean);
    const uniqueEndpoints = Array.from(new Set(endpoints));
    let lastError = null;

    for (const ep of uniqueEndpoints) {
      try {
        const fetchFn = _rawFetch || window.fetch;
        const res = await fetchFn(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(proxyPayload)
        });

        if (!res.ok && res.status >= 500 && uniqueEndpoints.length > 1) {
          continue;
        }

        const json = await res.json();
        const data = (json && json.data) ? json.data : json;
        const status = (data && data.statusCode) || res.status || 200;
        const resBody = (data && data.body != null) ? String(data.body) : '';
        const resHeaders = new Headers((data && data.headers) || {});

        return new Response(resBody, {
          status: status,
          statusText: String(status),
          headers: resHeaders
        });
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error('Proxy request failed for: ' + targetUrl);
  }

  window.fetch = _proxyFetch;

  if (!isElectron && typeof XMLHttpRequest !== 'undefined') {
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
      const match = log.match(/^(PASS|FAIL):\s*(.*)/i);
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

      const isElectron = typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);

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

      // Send code to the sandbox
      // The origin is '*' because a sandboxed iframe without allow-same-origin has an opaque origin
      this.iframe.contentWindow.postMessage({
        id: executionId,
        code,
        context: safeContext,
        proxyUrl: environment.proxyUrl,
        proxyFallbackUrl: environment.proxyFallbackUrl,
        isElectron
      }, '*');
    });
  }

  ngOnDestroy() {
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
  }
}
