import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

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
  const { id, code, context } = event.data;
  if (!id) return;

  let logs = [];
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" "));
    originalConsoleLog(...args);
  };

  let pm = { ...context };

  try {
    const contextKeys = Object.keys(context);
    
    // Declare all context keys as local variables
    const paramDeclarations = contextKeys.map(k => 
      "let " + k + " = context['" + k + "'];"
    ).join("\\n");

    // Write back any mutations to pm
    const paramWriteBack = contextKeys.map(k => 
      "pm['" + k + "'] = " + k + ";"
    ).join("\\n");

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

    const fnBody = "return (async () => {\\n"
      + paramDeclarations + "\\n"
      + code + "\\n"
      + "if (typeof preScript === 'function') { const _preReturn = await preScript(headers, body, params); if (_preReturn !== undefined) { body = _preReturn; } }\\n"
      + "if (typeof postScript === 'function') { await postScript(responseHeaders || responseHeader, responseBody, headers, body, params); }\\n"
      + "if (typeof testScript === 'function') { const _testReturn = await testScript(responseStatus, responseTime, responseBody, responseHeaders || responseHeader); if (_testReturn !== undefined) { testPassed = !!_testReturn; } }\\n"
      + "if (typeof encryptScript === 'function') { const _encReturn = await encryptScript(headers, body, params, encryptedHeaders, encryptedBodyPaths); if (_encReturn !== undefined) { body = _encReturn; } }\\n"
      + paramWriteBack + "\\n"
      + "})();";
      
    const executeInSandbox = new Function("pm", "context", "test", fnBody);
    await executeInSandbox(pm, context, test);

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

    parent.postMessage({ id, success: true, context: pm, logs: logs.join("\\n") }, "*");
  } catch (err) {
    parent.postMessage({ id, success: false, error: err.toString(), logs: logs.join("\\n") }, "*");
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

      const executionId = crypto.randomUUID();

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

      // Send code to the sandbox
      // The origin is '*' because a sandboxed iframe without allow-same-origin has an opaque origin
      this.iframe.contentWindow.postMessage({ id: executionId, code, context }, '*');

      // Add a timeout to prevent hanging
      setTimeout(() => {
        window.removeEventListener('message', listener);
        resolve({ success: false, error: 'Execution timeout (5000ms)', context });
      }, 5000);
    });
  }

  ngOnDestroy() {
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
  }
}
