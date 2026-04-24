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

    private initializeSandbox() {
        this.iframe = document.createElement('iframe');
        // Using allow-scripts but NOT allow-same-origin ensures the iframe runs in an opaque origin context
        this.iframe.setAttribute('sandbox', 'allow-scripts');
        this.iframe.style.display = 'none';
        document.body.appendChild(this.iframe);

        // sandbox environment script
        const sandboxHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <script>
          window.addEventListener('message', async (event) => {
            const { id, code, context } = event.data;
            if (!id) return;

            let logs = [];
            const originalConsoleLog = console.log;
            console.log = (...args) => {
              logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
              originalConsoleLog(...args);
            };

            let pm = { ...context }; // Mocked pm object
            
            try {
              // Wrap execution in an async IIFE to support await
              const executeInSandbox = new Function('pm', \`
                return (async () => {
                  \${code}
                })();
              \`);

              await executeInSandbox(pm);

              // Send back mutated context and logs
              parent.postMessage({ id, success: true, context: pm, logs: logs.join('\n') }, '*');
            } catch (err) {
              parent.postMessage({ id, success: false, error: err.toString(), logs: logs.join('\n') }, '*');
            } finally {
              console.log = originalConsoleLog;
            }
          });
        </script>
      </head>
      <body></body>
      </html>
    `;

        const blob = new Blob([sandboxHtml], { type: 'text/html' });
        this.iframe.src = URL.createObjectURL(blob);
    }

    executeScript(code: string, context: any): Promise<SandboxResult> {
        return new Promise((resolve) => {
            if (!isPlatformBrowser(this.platformId) || !this.iframe?.contentWindow) {
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
