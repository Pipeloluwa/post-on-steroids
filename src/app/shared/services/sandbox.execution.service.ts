import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface SandboxResult {
    success: boolean;
    error?: string;
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

            let pm = { ...context }; // Mocked pm object
            
            try {
              // Wrap execution in an async IIFE to support await
              const executeInSandbox = new Function('pm', \`
                return (async () => {
                  \${code}
                })();
              \`);

              await executeInSandbox(pm);

              // Send back mutated context
               event.source.postMessage({ id, success: true, context: pm }, event.origin);
            } catch (err) {
               event.source.postMessage({ id, success: false, error: err.toString() }, event.origin);
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
