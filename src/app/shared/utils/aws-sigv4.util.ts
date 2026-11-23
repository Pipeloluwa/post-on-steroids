export interface AwsSigV4SignParams {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  sessionToken?: string;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return toHex(hash);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array | string, message: string): Promise<ArrayBuffer> {
  const rawKey = typeof key === 'string'
    ? new TextEncoder().encode(key)
    : key instanceof ArrayBuffer
      ? new Uint8Array(key)
      : key;
  const keyBytes = Uint8Array.from(rawKey);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Generates AWS Signature Version 4 headers (`Authorization`, `X-Amz-Date`, and optional `X-Amz-Security-Token`)
 * using browser / Electron Web Crypto API (`crypto.subtle`).
 */
export async function generateAwsSigV4Headers(params: AwsSigV4SignParams): Promise<Record<string, string>> {
  const parsed = new URL(params.url);
  const method = (params.method || 'GET').toUpperCase();
  const region = (params.region || 'us-east-1').trim();
  const service = (params.service || 'execute-api').trim();

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = parsed.pathname
    .split('/')
    .map(seg => encodeRfc3986(decodeURIComponent(seg)))
    .join('/') || '/';

  const queryPairs: [string, string][] = [];
  parsed.searchParams.forEach((v, k) => {
    queryPairs.push([encodeRfc3986(k), encodeRfc3986(v)]);
  });
  queryPairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const canonicalQuery = queryPairs.map(([k, v]) => `${k}=${v}`).join('&');

  const signedHeaderMap = new Map<string, string>();
  for (const [k, v] of Object.entries(params.headers || {})) {
    const lk = k.toLowerCase();
    if (lk === 'authorization') continue;
    signedHeaderMap.set(lk, String(v ?? '').trim().replace(/\s+/g, ' '));
  }
  signedHeaderMap.set('host', parsed.host);
  signedHeaderMap.set('x-amz-date', amzDate);
  if (params.sessionToken) {
    signedHeaderMap.set('x-amz-security-token', params.sessionToken.trim());
  }

  const sortedHeaderKeys = Array.from(signedHeaderMap.keys()).sort();
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${signedHeaderMap.get(k)}\n`).join('');
  const signedHeadersStr = sortedHeaderKeys.join(';');

  const payloadHash = await sha256Hex(params.body || '');
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeadersStr,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest)
  ].join('\n');

  const signingKey = await getSignatureKey(params.secretKey, dateStamp, region, service);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${params.accessKey}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

  const out: Record<string, string> = {
    'X-Amz-Date': amzDate,
    'Authorization': authorization
  };
  if (params.sessionToken) {
    out['X-Amz-Security-Token'] = params.sessionToken.trim();
  }
  return out;
}
