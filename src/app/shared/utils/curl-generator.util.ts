import { RequestState } from '../services/tab.state.service';

export interface CurlBuildOptions {
    resolveVariables?: boolean;
    multiline?: boolean;
    includeInsecureFlag?: boolean;
    resolveText?: (input: string) => string;
    resolveJson?: (input: string) => string;
    autoAuthToken?: string | null;
}

/**
 * Escapes an argument safely using POSIX single-quoting so it can be pasted into bash/zsh/sh
 * and cleanly re-parsed by parseCurlCommand.
 */
function quoteShellArg(value: string): string {
    const clean = (value ?? '').replace(/\0/g, '');
    return `'${clean.replace(/'/g, `'\\''`)}'`;
}

function appendQueryParams(baseUrl: string, params: { key: string; value: string }[], encodeValues: boolean): string {
    if (!params.length) return baseUrl;
    const encodedPairs = params.map(p => {
        if (!encodeValues) {
            return `${p.key}=${p.value}`;
        }
        return `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`;
    });
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}${encodedPairs.join('&')}`;
}

/**
 * Converts a RequestState into an executable cURL command string.
 */
export function buildCurlCommand(state: RequestState, options: CurlBuildOptions = {}): string {
    const {
        resolveVariables = true,
        multiline = true,
        includeInsecureFlag = false,
        resolveText = (s: string) => s,
        resolveJson = (s: string) => s,
        autoAuthToken = null
    } = options;

    const resolveStr = (raw?: string): string => {
        const val = raw ?? '';
        return resolveVariables ? resolveText(val) : val;
    };

    const method = (state.method || 'GET').toUpperCase();
    const rawUrl = resolveStr(state.url || '').trim() || 'https://example.com';

    const enabledParams = (state.params || [])
        .filter(p => p.enabled && (p.key || '').trim() !== '')
        .map(p => ({
            key: resolveStr(p.key).trim(),
            value: resolveStr(p.value)
        }))
        .filter(p => p.key !== '');

    const fullUrl = appendQueryParams(rawUrl, enabledParams, resolveVariables);

    const headers: { key: string; value: string }[] = (state.headers || [])
        .filter(h => h.enabled && (h.key || '').trim() !== '')
        .map(h => ({
            key: resolveStr(h.key).trim().replace(/[\r\n]+/g, ''),
            value: resolveStr(h.value).trim().replace(/[\r\n]+/g, '')
        }))
        .filter(h => h.key !== '');

    const hasHeader = (name: string) =>
        headers.some(h => h.key.toLowerCase() === name.toLowerCase());

    if (state.auth?.type === 'bearer' && state.auth.token && !hasHeader('authorization')) {
        const token = resolveStr(state.auth.token).trim().replace(/[\r\n]+/g, '');
        if (token) headers.push({ key: 'Authorization', value: `Bearer ${token}` });
    } else if (state.auth?.type === 'basic' && state.auth.token && !hasHeader('authorization')) {
        const token = resolveStr(state.auth.token).trim().replace(/[\r\n]+/g, '');
        if (token) headers.push({ key: 'Authorization', value: `Basic ${token}` });
    } else if (autoAuthToken && state.autoAuthEnabled && resolveVariables && !hasHeader('authorization')) {
        const cleanToken = autoAuthToken.trim().replace(/[\r\n]+/g, '');
        if (cleanToken) headers.push({ key: 'Authorization', value: `Bearer ${cleanToken}` });
    }

    const bodyFlags: string[] = [];
    const allowsBody = method !== 'GET' && method !== 'HEAD';

    if (allowsBody && state.bodyType === 'raw') {
        const isXml = state.rawType === 'XML' || state.rawType === 'XML (SOAP)' || state.rawType === 'SOAP';
        const rawSource = isXml
            ? (state.rawBodyXml || '')
            : (state.rawBodyJson || state.rawBody || '');

        const resolvedBody = state.rawType === 'JSON'
            ? (resolveVariables ? resolveJson(rawSource) : rawSource)
            : resolveStr(rawSource);

        if (!hasHeader('content-type')) {
            if (state.rawType === 'JSON') {
                headers.push({ key: 'Content-Type', value: 'application/json' });
            } else if (isXml) {
                const isSoap = state.rawType === 'XML (SOAP)' || state.rawType === 'SOAP' || (resolvedBody && (resolvedBody.includes('soap:Envelope') || resolvedBody.includes('soap12:Envelope') || resolvedBody.includes('schemas.xmlsoap.org')));
                const isSoap12 = isSoap && resolvedBody && resolvedBody.includes('2003/05/soap-envelope');
                headers.push({ key: 'Content-Type', value: isSoap ? (isSoap12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8') : 'application/xml' });
                if (isSoap && !isSoap12 && !hasHeader('soapaction')) {
                    headers.push({ key: 'SOAPAction', value: '""' });
                }
            }
        }

        if (resolvedBody && resolvedBody.trim() !== '') {
            bodyFlags.push(`--data-raw ${quoteShellArg(resolvedBody)}`);
        }
    } else if (allowsBody && state.bodyType === 'form-data') {
        const formRows = (state.formData || []).filter(f => f.enabled && (f.key || '').trim() !== '');
        for (const row of formRows) {
            const k = resolveStr(row.key).trim();
            if (!k) continue;
            if (row.type === 'file') {
                const fileName = row.file?.name || resolveStr(typeof row.value === 'string' ? row.value : '') || 'file';
                bodyFlags.push(`-F ${quoteShellArg(`${k}=@${fileName}`)}`);
            } else {
                const v = resolveStr(typeof row.value === 'string' ? row.value : '');
                bodyFlags.push(`-F ${quoteShellArg(`${k}=${v}`)}`);
            }
        }
    }

    const parts: string[] = [`curl -X ${method} ${quoteShellArg(fullUrl)}`];
    if (includeInsecureFlag && state.settings?.verifySsl === false) {
        parts[0] = `curl -k -X ${method} ${quoteShellArg(fullUrl)}`;
    }

    for (const h of headers) {
        parts.push(`-H ${quoteShellArg(`${h.key}: ${h.value}`)}`);
    }
    for (const bf of bodyFlags) {
        parts.push(bf);
    }

    return multiline ? parts.join(' \\\n  ') : parts.join(' ');
}
