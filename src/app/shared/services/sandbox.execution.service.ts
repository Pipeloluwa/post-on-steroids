import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { generateUUID } from '../utils/uuid.util';
import { isLocalhostOrLoopbackUrl, isElectronApp } from '../utils/url.util';
import { getGlobalRequestTimeoutMs } from '../utils/request-timeout.util';
import { sanitizeJsonBodyForScripts } from '../utils/format.utils';
import { environment } from '../../../environments/environment';
import { SandboxPackagesService } from './sandbox-packages.service';
import { APP_EDITION } from '../../../environments/edition';

/**
 * Transforms ES module `import` statements inside user scripts (including inside boilerplate
 * async function bodies) into runtime `await __osbImport(...)` calls supported inside the sandbox.
 */
export function transformScriptImports(code: string): string {
  if (!code || typeof code !== 'string') return '';
  let importCounter = 0;

  // Match ES module imports line-by-line (default, namespace, named, combined, or side-effect)
  return code.replace(
    /^[ \t]*import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*\{\s*([^}]+)\s*\}|([A-Za-z_$][\w$]*)\s*,\s*\*\s+as\s+([A-Za-z_$][\w$]*)|\*\s+as\s+([A-Za-z_$][\w$]*)|\{\s*([^}]+)\s*\}|([A-Za-z_$][\w$]*))\s+from\s+['"]([^'"]+)['"]\s*;?|^[ \t]*import\s+['"]([^'"]+)['"]\s*;?/gm,
    (
      _full,
      defWithNamed,
      namedWithDef,
      defWithNs,
      nsWithDef,
      nsOnly,
      namedOnly,
      defOnly,
      pkgSpec,
      sideEffectPkg
    ) => {
      const targetPkg = (pkgSpec || sideEffectPkg || '').trim();
      if (!targetPkg) return _full;
      if (!pkgSpec && sideEffectPkg) {
        return `await __osbImport(${JSON.stringify(targetPkg)});`;
      }
      const modVar = `__osb_mod_${importCounter++}`;
      const stmts: string[] = [`const ${modVar} = await __osbImport(${JSON.stringify(targetPkg)});`];

      const defIdent = defWithNamed || defWithNs || defOnly;
      if (defIdent) {
        stmts.push(
          `const ${defIdent} = (${modVar} && ${modVar}.default !== undefined) ? ${modVar}.default : ${modVar};`
        );
      }

      const nsIdent = nsWithDef || nsOnly;
      if (nsIdent) {
        stmts.push(`const ${nsIdent} = ${modVar};`);
      }

      const namedRaw = namedWithDef || namedOnly;
      if (namedRaw) {
        const destructure = namedRaw
          .split(',')
          .map((part: string) => part.trim())
          .filter(Boolean)
          .map((part: string) => {
            const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
            return aliasMatch ? `${aliasMatch[1]}: ${aliasMatch[2]}` : part;
          })
          .join(', ');
        if (destructure) {
          stmts.push(`const { ${destructure} } = ${modVar} || {};`);
        }
      }

      return stmts.join(' ');
    }
  );
}

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
  private packagesService = inject(SandboxPackagesService);
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

  pm.traverseFields = async function(target, paths, transformFn, autoEncrypt) {
    const pathList = Array.isArray(paths) ? paths : [];
    const matchPath = (p) => {
      if (autoEncrypt) return true;
      if (!p) return false;
      if (pathList.includes(p)) return true;
      for (const ep of pathList) {
        if (ep && p.startsWith(ep + '.')) return true;
      }
      const last = p.includes('.') ? p.split('.').pop() : p;
      return !/^\d+$/.test(last) && pathList.includes(last);
    };
    const walk = async (node, currPath) => {
      if (node === null || node === undefined) return node;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          const itemPath = currPath ? currPath + '.' + i : String(i);
          if (node[i] !== null && typeof node[i] === 'object') {
            node[i] = await walk(node[i], itemPath);
          } else if (matchPath(itemPath)) {
            node[i] = await transformFn(node[i], itemPath);
          }
        }
        return node;
      }
      if (typeof node === 'object') {
        for (const key of Object.keys(node)) {
          const nextPath = currPath ? currPath + '.' + key : key;
          if (node[key] !== null && typeof node[key] === 'object') {
            node[key] = await walk(node[key], nextPath);
          } else if (matchPath(nextPath)) {
            node[key] = await transformFn(node[key], nextPath);
          }
        }
        return node;
      }
      if (matchPath(currPath || '__raw_text__')) {
        return await transformFn(node, currPath || '__raw_text__');
      }
      return node;
    };
    return await walk(target, '');
  };

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
    const installedPkgs = context.__installedPackages || {};
    const allowPackages = !!context.__allowSandboxPackages;
    const __osbLoadedModules = new Map();

    async function __osbImport(pkgName) {
      if (!allowPackages) {
        throw new Error('npm package imports in scripts require Professional or Enterprise edition.');
      }
      if (__osbLoadedModules.has(pkgName)) {
        return __osbLoadedModules.get(pkgName);
      }
      const codeStr = installedPkgs[pkgName];
      if (!codeStr) {
        throw new Error('Package "' + pkgName + '" is not installed. Open OnSteroid Terminal and run: npm install ' + pkgName);
      }
      const modBlob = new Blob([codeStr], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(modBlob);
      try {
        const mod = await import(blobUrl);
        const wrapped = Object.assign({}, mod);
        if (mod && mod.default !== undefined && wrapped.default === undefined) {
          wrapped.default = mod.default;
        }
        __osbLoadedModules.set(pkgName, wrapped);
        return wrapped;
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }

    const require = (pkgName) => {
      if (!allowPackages) {
        throw new Error('require() package loading requires Professional or Enterprise edition.');
      }
      if (__osbLoadedModules.has(pkgName)) {
        const m = __osbLoadedModules.get(pkgName);
        return (m && m.default !== undefined && Object.keys(m).length === 1) ? m.default : m;
      }
      throw new Error('Package "' + pkgName + '" is not loaded. Use import/require syntax or run npm install ' + pkgName + ' in Terminal.');
    };

    // Preload any installed packages that appear as require('...') calls so synchronous require() works too
    if (allowPackages && typeof code === 'string') {
      const reqMatches = code.matchAll(/require\\(\\s*['"]([^'"]+)['"]\\s*\\)/g);
      for (const m of reqMatches) {
        if (m[1] && installedPkgs[m[1]] && !__osbLoadedModules.has(m[1])) {
          await __osbImport(m[1]);
        }
      }
    }

    const envMap = Object.assign({}, context.__envVars || {});
    const globalMap = Object.assign({}, context.__capsuleVars || {});
    const __envSet = {};
    const __envUnset = [];
    const __varSet = {};
    let __nextRequest = undefined;

    pm.environment = {
      get: (k) => envMap[k],
      has: (k) => Object.prototype.hasOwnProperty.call(envMap, k),
      set: (k, v) => { const s = String(v ?? ''); envMap[k] = s; __envSet[k] = s; },
      unset: (k) => { delete envMap[k]; delete __envSet[k]; __envUnset.push(k); },
      toObject: () => Object.assign({}, envMap)
    };

    pm.variables = {
      get: (k) => Object.prototype.hasOwnProperty.call(envMap, k) ? envMap[k] : globalMap[k],
      has: (k) => Object.prototype.hasOwnProperty.call(envMap, k) || Object.prototype.hasOwnProperty.call(globalMap, k),
      set: (k, v) => { const s = String(v ?? ''); globalMap[k] = s; __varSet[k] = s; },
      replaceIn: (str) => String(str ?? '').replace(/\{\{([^}]+)\}\}/g, (m, k) => {
        const key = String(k || '').trim();
        if (Object.prototype.hasOwnProperty.call(envMap, key)) return String(envMap[key]);
        if (Object.prototype.hasOwnProperty.call(globalMap, key)) return String(globalMap[key]);
        return m;
      })
    };
    pm.globals = pm.variables;
    pm.collectionVariables = pm.variables;

    pm.request = {
      url: context.url || '',
      method: context.method || 'GET',
      headers: {
        get: (key) => {
          const kl = String(key || '').toLowerCase();
          const f = (context.headers || []).find(h => h && h.enabled !== false && String(h.key || '').toLowerCase() === kl);
          return f ? f.value : undefined;
        },
        add: (h) => {
          if (!h || !h.key) return;
          if (!Array.isArray(context.headers)) context.headers = [];
          context.headers.push({ enabled: true, key: String(h.key), value: String(h.value ?? '') });
        },
        upsert: (h) => {
          if (!h || !h.key) return;
          if (!Array.isArray(context.headers)) context.headers = [];
          const kl = String(h.key).toLowerCase();
          const ex = context.headers.find(x => x && String(x.key || '').toLowerCase() === kl);
          if (ex) { ex.value = String(h.value ?? ''); ex.enabled = true; }
          else context.headers.push({ enabled: true, key: String(h.key), value: String(h.value ?? '') });
        },
        remove: (key) => {
          const kl = String(key || '').toLowerCase();
          if (Array.isArray(context.headers)) {
            for (let i = context.headers.length - 1; i >= 0; i--) {
              const x = context.headers[i];
              if (!x || String(x.key || '').toLowerCase() === kl) {
                context.headers.splice(i, 1);
              }
            }
          }
        }
      }
    };

    const _rawRespText = typeof context.responseBody === 'string'
      ? context.responseBody
      : JSON.stringify(context.responseBody ?? '');

    pm.response = {
      code: Number(context.responseStatus) || 0,
      status: String(context.responseStatus || ''),
      responseTime: Number(context.responseTime) || 0,
      text: () => _rawRespText,
      json: () => (typeof context.responseBody === 'object' ? context.responseBody : JSON.parse(_rawRespText)),
      headers: {
        get: (key) => {
          const kl = String(key || '').toLowerCase();
          const f = (context.responseHeaders || []).find(h => h && String(h.key || '').toLowerCase() === kl);
          return f ? f.value : undefined;
        }
      },
      to: {
        have: {
          status: (expected) => {
            const actual = Number(context.responseStatus) || 0;
            if (actual !== expected) throw new Error('Expected status ' + expected + ' but got ' + actual);
          }
        }
      }
    };

    pm.expect = (actual) => {
      const check = (negate) => ({
        equal: (exp) => { const ok = actual === exp; if (negate ? ok : !ok) throw new Error('Expected ' + JSON.stringify(actual) + (negate ? ' not' : '') + ' to equal ' + JSON.stringify(exp)); },
        eql: (exp) => { const ok = JSON.stringify(actual) === JSON.stringify(exp); if (negate ? ok : !ok) throw new Error('Expected deep equal mismatch'); },
        include: (sub) => { const ok = typeof actual === 'string' || Array.isArray(actual) ? actual.includes(sub) : false; if (negate ? ok : !ok) throw new Error('Expected ' + JSON.stringify(actual) + ' to include ' + JSON.stringify(sub)); },
        match: (rx) => { const ok = rx.test(String(actual)); if (negate ? ok : !ok) throw new Error('Expected ' + JSON.stringify(actual) + ' to match ' + String(rx)); },
        above: (n) => { const ok = Number(actual) > n; if (negate ? ok : !ok) throw new Error('Expected ' + actual + ' > ' + n); },
        below: (n) => { const ok = Number(actual) < n; if (negate ? ok : !ok) throw new Error('Expected ' + actual + ' < ' + n); },
        property: (p, val) => { const has = actual != null && Object.prototype.hasOwnProperty.call(actual, p); const ok = arguments.length > 1 ? has && actual[p] === val : has; if (negate ? ok : !ok) throw new Error('Property assertion failed for "' + p + '"'); },
        lengthOf: (len) => { const ok = actual != null && actual.length === len; if (negate ? ok : !ok) throw new Error('Expected length ' + len); },
        a: (t) => { const ok = t === 'array' ? Array.isArray(actual) : typeof actual === t; if (negate ? ok : !ok) throw new Error('Expected type ' + t); },
        an: (t) => check(negate).a(t),
        get ok() { if (negate ? !!actual : !actual) throw new Error('Expected truthy value'); return true; },
        get true() { if (negate ? actual === true : actual !== true) throw new Error('Expected true'); return true; },
        get false() { if (negate ? actual === false : actual !== false) throw new Error('Expected false'); return true; },
        get null() { if (negate ? actual === null : actual !== null) throw new Error('Expected null'); return true; },
        get undefined() { if (negate ? actual === undefined : actual !== undefined) throw new Error('Expected undefined'); return true; }
      });
      return {
        to: Object.assign(check(false), { be: check(false), have: check(false), not: Object.assign(check(true), { be: check(true), have: check(true) }) })
      };
    };

    const setNextRequest = (target) => {
      __nextRequest = target === null ? null : String(target);
    };
    pm.setNextRequest = setNextRequest;
    pm.execution = { setNextRequest };
    const postman = { setNextRequest };

    const reservedContextKeys = new Set([
      '__installedPackages', '__allowSandboxPackages', '__envVars', '__capsuleVars',
      '__envSet', '__envUnset', '__varSet', '__nextRequest'
    ]);
    const contextKeys = Object.keys(context).filter(k => !reservedContextKeys.has(k));
    
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
    pm.test = test;

    const fnBodyLines = [
      "return (async () => {",
      "const fetch = _proxyFetch;",
      paramDeclarations,
      code,
      "if (typeof preScript === 'function') { const _preReturn = await preScript(headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText); if (_preReturn !== undefined) { body = _preReturn; } }",
      "if (typeof postScript === 'function') { await postScript(responseHeaders || responseHeader, responseBody, headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText); }",
      "if (typeof testScript === 'function') { const _testReturn = await testScript(responseStatus, responseTime, responseBody, responseHeaders || responseHeader, headers, body, params, bodyType, rawType, formData, urlEncodedData, graphql, rawText); if (_testReturn !== undefined) { testPassed = !!_testReturn; } }",
      "if (typeof encryptScript === 'function') { const _encReturn = await encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths, bodyType, rawType, formData, encryptedFormData, urlEncodedData, encryptedUrlEncodedData, graphql, encryptedGraphqlPaths, rawText, encryptRawText); if (_encReturn !== undefined) { body = _encReturn; } }",
      "if (typeof decryptScript === 'function') { const _decReturn = await decryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths, bodyType, rawType, formData, encryptedFormData, urlEncodedData, encryptedUrlEncodedData, graphql, encryptedGraphqlPaths, rawText, encryptRawText); if (_decReturn !== undefined) { body = _decReturn; } }",
      paramWriteBack,
      "})();"
    ];
    const fnBody = fnBodyLines.join(String.fromCharCode(10));
      
    const executeInSandbox = new Function("pm", "context", "test", "_proxyFetch", "__osbImport", "require", "postman", "setNextRequest", fnBody);
    await executeInSandbox(pm, context, test, _proxyFetch, __osbImport, require, postman, setNextRequest);

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
    pm['__envSet'] = __envSet;
    pm['__envUnset'] = __envUnset;
    pm['__varSet'] = __varSet;
    if (__nextRequest !== undefined) {
      pm['__nextRequest'] = __nextRequest;
    }

    delete pm.sendRequest;
    delete pm.traverseFields;
    delete pm.environment;
    delete pm.variables;
    delete pm.globals;
    delete pm.collectionVariables;
    delete pm.request;
    delete pm.response;
    delete pm.execution;
    delete pm.expect;
    delete pm.test;
    delete pm.setNextRequest;
    delete pm.__installedPackages;
    delete pm.__allowSandboxPackages;
    delete pm.__envVars;
    delete pm.__capsuleVars;
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
      const isElectron = isElectronApp();
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
    const timeoutMs = getGlobalRequestTimeoutMs();
    const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
    if (isElectronApp() && electronApi && typeof electronApi.executeHttpRequest === 'function') {
      const res = await electronApi.executeHttpRequest({
        url: req.url,
        method,
        headers: req.headers || {},
        body: req.body,
        verifySsl: false,
        followRedirects: true,
        timeoutMs
      });
      if (!res.ok) {
        throw new Error(res.errorMessage || `Request failed for: ${req.url}`);
      }
      return {
        ok: true,
        status: res.statusCode,
        statusText: res.statusText || '',
        headers: res.headers || {},
        body: res.body ?? ''
      };
    }

    const hasBody = method !== 'GET' && method !== 'HEAD' && req.body !== null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const res = await fetch(req.url, {
        method,
        headers: req.headers || {},
        body: hasBody ? req.body : undefined,
        ...(controller ? { signal: controller.signal } : {})
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      const body = await res.text();
      return { ok: true, status: res.status, statusText: res.statusText, headers, body };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs} ms for: ${req.url}`);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async proxyFetch(req: SandboxFetchRequest): Promise<FetchOutcome> {
    const timeoutMs = getGlobalRequestTimeoutMs();
    const proxyPayload = {
      url: req.url,
      method: (req.method || 'GET').toUpperCase(),
      headers: req.headers || {},
      body: req.body,
      verifySsl: false,
      timeoutMs
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

      // Ensure all script context parameters exist with safe defaults
      safeContext = {
        headers: [],
        body: '',
        params: [],
        encryptedHeaders: [],
        encryptedBodyPaths: [],
        bodyType: 'raw',
        rawType: 'JSON',
        formData: [],
        encryptedFormData: [],
        urlEncodedData: [],
        encryptedUrlEncodedData: [],
        graphql: { query: '', variables: {} },
        encryptedGraphqlPaths: [],
        rawText: '',
        encryptRawText: false,
        autoEncryptBody: false,
        autoEncryptHeaders: false,
        ...safeContext
      };

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

      // Transform `import ... from '...'` (inside or outside boilerplate functions) & upgrade naive comment regexes
      const importedCode = transformScriptImports(code || '');
      const safeCode = importedCode
        .split(".replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, '')")
        .join('.replace(/"(?:[^"\\\\]|\\\\.)*"|(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*)/g, (m, c) => c ? \'\' : m)')
        .split('.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, "")')
        .join('.replace(/"(?:[^"\\\\]|\\\\.)*"|(\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*)/g, (m, c) => c ? "" : m)');

      if (APP_EDITION.isProOrHigher) {
        safeContext.__allowSandboxPackages = true;
        safeContext.__installedPackages = this.packagesService.getPackageCodeMap();
      } else {
        safeContext.__allowSandboxPackages = false;
        safeContext.__installedPackages = {};
      }

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
