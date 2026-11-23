

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { Request, Response } from 'express';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

interface ProxyMultipartPart {
  name: string;
  fileName?: string;
  contentType?: string;
  data: Buffer;
}

interface ProxyForwardOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  multipartParts?: ProxyMultipartPart[];
  verifySsl?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface ProxyForwardResponse {
  ok: true;
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  responseTimeMs: number;
}

interface ProxyForwardError {
  ok: false;
  isTimeout: boolean;
  message: string;
  responseTimeMs: number;
}

function readRawRequestBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseIncomingMultipart(rawBody: Buffer, contentType: string): {
  fields: Record<string, string>;
  userParts: ProxyMultipartPart[];
} {
  const fields: Record<string, string> = {};
  const userParts: ProxyMultipartPart[] = [];
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]) : '';
  if (!boundary) {
    return { fields, userParts };
  }

  const controlNames = new Set(['url', 'method', 'verifySsl', 'headers', 'bodyType', 'timeoutMs']);
  const delimiter = Buffer.from(`--${boundary}`);
  const headerSep = Buffer.from('\r\n\r\n');
  let cursor = rawBody.indexOf(delimiter);

  while (cursor !== -1) {
    const afterDelimiter = cursor + delimiter.length;
    if (rawBody.subarray(afterDelimiter, afterDelimiter + 2).equals(Buffer.from('--'))) {
      break;
    }
    const partStart = rawBody[afterDelimiter] === 13 && rawBody[afterDelimiter + 1] === 10
      ? afterDelimiter + 2
      : afterDelimiter;
    const nextDelimiter = rawBody.indexOf(delimiter, partStart);
    if (nextDelimiter === -1) break;

    // Trim trailing CRLF right before the next boundary
    const partEnd = nextDelimiter >= 2 && rawBody[nextDelimiter - 2] === 13 && rawBody[nextDelimiter - 1] === 10
      ? nextDelimiter - 2
      : nextDelimiter;
    const partBuffer = rawBody.subarray(partStart, partEnd);
    const sepIdx = partBuffer.indexOf(headerSep);

    if (sepIdx !== -1) {
      const headerText = partBuffer.subarray(0, sepIdx).toString('utf8');
      const data = partBuffer.subarray(sepIdx + headerSep.length);
      const nameMatch = headerText.match(/Content-Disposition:[^\r\n]*;\s*name="([^"]+)"/i);
      const fileMatch = headerText.match(/Content-Disposition:[^\r\n]*;\s*filename="([^"]*)"/i);
      const ctMatch = headerText.match(/^Content-Type:\s*([^\r\n]+)/im);
      const fieldName = nameMatch?.[1] || '';

      if (fieldName) {
        if (!fileMatch && controlNames.has(fieldName)) {
          fields[fieldName] = data.toString('utf8');
        } else {
          userParts.push({
            name: fieldName,
            ...(fileMatch ? { fileName: fileMatch[1] } : {}),
            ...(ctMatch ? { contentType: ctMatch[1].trim() } : {}),
            data
          });
        }
      }
    }
    cursor = nextDelimiter;
  }

  return { fields, userParts };
}

function buildOutgoingMultipart(parts: ProxyMultipartPart[]): { boundary: string; buffer: Buffer } {
  const boundary = '----PostOnSteroidsProxyBoundary' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const safeName = String(part.name || 'field').replace(/[\r\n"]/g, '');
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    if (part.fileName !== undefined) {
      const safeFileName = String(part.fileName || 'file').replace(/[\r\n"]/g, '');
      const mime = String(part.contentType || 'application/octet-stream').replace(/[\r\n]/g, '');
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${safeName}"; filename="${safeFileName}"\r\n`, 'utf8'));
      chunks.push(Buffer.from(`Content-Type: ${mime}\r\n\r\n`, 'utf8'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${safeName}"\r\n\r\n`, 'utf8'));
    }
    chunks.push(part.data);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { boundary, buffer: Buffer.concat(chunks) };
}

function forwardProxyHttpRequest(
  opts: ProxyForwardOptions,
  redirectCount = 0
): Promise<ProxyForwardResponse | ProxyForwardError> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(opts.url);
    } catch {
      resolve({ ok: false, isTimeout: false, message: `Invalid target URL: "${opts.url}"`, responseTimeMs: 0 });
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      resolve({ ok: false, isTimeout: false, message: 'Only http:// and https:// URLs are supported.', responseTimeMs: 0 });
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const method = (opts.method || 'GET').trim().toUpperCase();
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.headers || {})) {
      const cleanKey = k.trim().replace(/[\r\n]+/g, '');
      if (!cleanKey) continue;
      const lower = cleanKey.toLowerCase();
      if (lower === 'host' || lower === 'content-length' || lower === 'transfer-encoding') continue;
      outHeaders[cleanKey] = String(v ?? '').trim().replace(/[\r\n]+/g, '');
    }

    let bodyBuffer: Buffer | null = null;
    if (method !== 'GET' && method !== 'HEAD') {
      if (opts.multipartParts !== undefined) {
        const mp = buildOutgoingMultipart(opts.multipartParts);
        bodyBuffer = mp.buffer;
        for (const k of Object.keys(outHeaders)) {
          if (k.toLowerCase() === 'content-type') delete outHeaders[k];
        }
        outHeaders['Content-Type'] = `multipart/form-data; boundary=${mp.boundary}`;
      } else if (opts.body !== null && opts.body !== undefined && opts.body !== '') {
        bodyBuffer = Buffer.from(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body), 'utf8');
      } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        bodyBuffer = Buffer.alloc(0);
      }
      if (bodyBuffer !== null) {
        outHeaders['Content-Length'] = String(bodyBuffer.length);
      }
    }

    const resolvedTimeoutMs =
      typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0
        ? Math.floor(opts.timeoutMs)
        : 0;

    // Dedicated agent with keepAlive: false and timeout: 0 avoids Node globalAgent's 5000ms timeout
    const agent = isHttps
      ? new https.Agent({ rejectUnauthorized: opts.verifySsl === true, maxCachedSessions: 0, keepAlive: false, timeout: 0 })
      : new http.Agent({ keepAlive: false, timeout: 0 });

    const reqOpts: http.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method,
      headers: outHeaders,
      agent
    };

    let settled = false;
    let hardTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimeoutTriggered = false;
    let upstreamReq: http.ClientRequest | null = null;

    const cleanupSignal = () => {
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onClientAbort);
      }
    };

    const finish = (result: ProxyForwardResponse | ProxyForwardError) => {
      if (settled) return;
      settled = true;
      if (hardTimeoutTimer) {
        clearTimeout(hardTimeoutTimer);
        hardTimeoutTimer = null;
      }
      cleanupSignal();
      resolve(result);
    };

    const onClientAbort = () => {
      if (upstreamReq) {
        upstreamReq.destroy(new Error('CLIENT_ABORTED'));
      }
      finish({ ok: false, isTimeout: false, message: 'Client aborted request', responseTimeMs: Date.now() - startTime });
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        finish({ ok: false, isTimeout: false, message: 'Client aborted request', responseTimeMs: 0 });
        return;
      }
      opts.signal.addEventListener('abort', onClientAbort, { once: true });
    }

    upstreamReq = transport.request(reqOpts, (upstreamRes) => {
      const statusCode = upstreamRes.statusCode || 0;
      const location = upstreamRes.headers['location'];
      const isRedirect = [301, 302, 303, 307, 308].includes(statusCode) && !!location;

      if (isRedirect && redirectCount < 10) {
        if (hardTimeoutTimer) {
          clearTimeout(hardTimeoutTimer);
          hardTimeoutTimer = null;
        }
        cleanupSignal();
        upstreamRes.resume();
        let nextUrl = location;
        try {
          nextUrl = new URL(location, parsedUrl).toString();
        } catch {}
        const switchToGet = [301, 302, 303].includes(statusCode) && method !== 'GET' && method !== 'HEAD';
        const nextMethod = switchToGet ? 'GET' : method;
        const nextHeaders = { ...(opts.headers || {}) };
        if (switchToGet) {
          for (const k of Object.keys(nextHeaders)) {
            if (k.toLowerCase() === 'content-type' || k.toLowerCase() === 'content-length') {
              delete nextHeaders[k];
            }
          }
        }
        const remainingTimeoutMs = resolvedTimeoutMs > 0
          ? Math.max(1, resolvedTimeoutMs - (Date.now() - startTime))
          : 0;
        forwardProxyHttpRequest(
          {
            ...opts,
            url: nextUrl,
            method: nextMethod,
            headers: nextHeaders,
            body: switchToGet ? null : opts.body,
            multipartParts: switchToGet ? undefined : opts.multipartParts,
            timeoutMs: remainingTimeoutMs
          },
          redirectCount + 1
        ).then(finish);
        return;
      }

      const chunks: Buffer[] = [];
      upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
      upstreamRes.on('error', (err) => {
        finish({
          ok: false,
          isTimeout: hardTimeoutTriggered,
          message: hardTimeoutTriggered
            ? `Request timed out after ${resolvedTimeoutMs} ms while waiting for a response from ${opts.url}.`
            : (err?.message || `Unable to reach ${opts.url}`),
          responseTimeMs: Date.now() - startTime
        });
      });
      upstreamRes.on('end', () => {
        const resHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(upstreamRes.headers || {})) {
          if (v !== undefined) {
            resHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
          }
        }
        finish({
          ok: true,
          statusCode,
          statusText: upstreamRes.statusMessage || '',
          headers: resHeaders,
          body: Buffer.concat(chunks).toString('utf8'),
          responseTimeMs: Date.now() - startTime
        });
      });
    });

    upstreamReq.on('socket', (socket) => {
      try {
        socket.setTimeout(0);
        socket.setKeepAlive(true, 15000);
      } catch {}
    });
    upstreamReq.setTimeout(0);

    if (resolvedTimeoutMs > 0) {
      hardTimeoutTimer = setTimeout(() => {
        hardTimeoutTriggered = true;
        upstreamReq?.destroy(Object.assign(new Error('Request timed out'), { code: 'ERR_REQUEST_TIMEOUT' }));
      }, resolvedTimeoutMs);
    }

    upstreamReq.on('timeout', () => {
      if (resolvedTimeoutMs === 0) {
        try {
          upstreamReq?.socket?.setTimeout(0);
        } catch {}
        return;
      }
      hardTimeoutTriggered = true;
      upstreamReq?.destroy(Object.assign(new Error('Request timed out'), { code: 'ERR_REQUEST_TIMEOUT' }));
    });

    upstreamReq.on('error', (err: NodeJS.ErrnoException) => {
      const isTimeout = err?.code === 'ERR_REQUEST_TIMEOUT' || hardTimeoutTriggered;
      finish({
        ok: false,
        isTimeout,
        message: isTimeout
          ? `Request timed out after ${resolvedTimeoutMs} ms while waiting for a response from ${opts.url}.`
          : (err?.message || `Unable to reach ${opts.url}`),
        responseTimeMs: Date.now() - startTime
      });
    });

    if (bodyBuffer && bodyBuffer.length > 0) {
      upstreamReq.write(bodyBuffer);
    }
    upstreamReq.end();
  });
}

function sendProxyResult(res: Response, result: ProxyForwardResponse | ProxyForwardError) {
  if (res.writableEnded) return;
  if (result.ok) {
    res.status(200).json({
      status: 'Operation Successful',
      code: '01',
      message: 'Request forwarded successfully',
      data: {
        statusCode: result.statusCode,
        statusText: result.statusText,
        headers: result.headers,
        body: result.body,
        responseTimeMs: result.responseTimeMs
      }
    });
    return;
  }
  const status = result.isTimeout ? 408 : 422;
  res.status(status).json({
    status: result.isTimeout ? 'Request Timed Out' : 'Proxy Error',
    code: result.isTimeout ? 'ETIMEDOUT' : '04',
    message: result.message
  });
}

function createResponseAbortSignal(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
}

app.post('/api/v1/Proxy', express.json({ limit: '50mb' }), async (req: Request, res: Response) => {
  const payload = (req.body || {}) as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | null;
    verifySsl?: boolean;
    timeoutMs?: number;
  };
  if (!payload.url || typeof payload.url !== 'string') {
    res.status(400).json({ message: 'Url is required' });
    return;
  }
  const signal = createResponseAbortSignal(res);
  const result = await forwardProxyHttpRequest({
    url: payload.url,
    method: payload.method || 'GET',
    headers: payload.headers || {},
    body: payload.body ?? null,
    verifySsl: Boolean(payload.verifySsl),
    timeoutMs: typeof payload.timeoutMs === 'number' ? payload.timeoutMs : 0,
    signal
  });
  sendProxyResult(res, result);
});

app.post('/api/v1/Proxy/multipart', async (req: Request, res: Response) => {
  const contentType = String(req.headers['content-type'] || '');
  const rawBody = await readRawRequestBody(req);
  const { fields, userParts } = parseIncomingMultipart(rawBody, contentType);
  const targetUrl = fields['url'] || '';
  if (!targetUrl) {
    res.status(400).json({ message: 'Url is required' });
    return;
  }
  let parsedHeaders: Record<string, string> = {};
  if (fields['headers']) {
    try {
      parsedHeaders = JSON.parse(fields['headers']) || {};
    } catch {}
  }
  const parsedTimeout = Number(fields['timeoutMs']);
  const signal = createResponseAbortSignal(res);
  const result = await forwardProxyHttpRequest({
    url: targetUrl,
    method: fields['method'] || 'POST',
    headers: parsedHeaders,
    multipartParts: userParts,
    verifySsl: String(fields['verifySsl']).toLowerCase() === 'true',
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout >= 0 ? parsedTimeout : 0,
    signal
  });
  sendProxyResult(res, result);
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 5400;
  const server = app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
  server.requestTimeout = 0;
  server.timeout = 0;
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
