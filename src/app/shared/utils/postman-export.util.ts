export interface PostmanCollectionExportOptions {
    collectionName?: string;
    description?: string;
    schemaUrl?: string;
}

const POSTMAN_V21_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

function parsePostmanUrlObject(rawUrl: string, params: any[] = []): any {
    const cleanUrl = (rawUrl || '').trim();
    const activeParams = (params || [])
        .filter((p: any) => p && p.key)
        .map((p: any) => ({
            key: String(p.key),
            value: p.value !== undefined && p.value !== null ? String(p.value) : '',
            disabled: p.enabled === false
        }));

    if (!cleanUrl) {
        return {
            raw: '',
            query: activeParams.length > 0 ? activeParams : undefined
        };
    }

    const result: any = { raw: cleanUrl };

    // Extract protocol cleanly even when host starts with {{var}}
    let remainder = cleanUrl;
    const protoMatch = remainder.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
    if (protoMatch) {
        result.protocol = protoMatch[1].toLowerCase();
        remainder = remainder.slice(protoMatch[0].length);
    }

    // Split query string before splitting host/path
    const qIdx = remainder.indexOf('?');
    let rawQuery = '';
    if (qIdx !== -1) {
        rawQuery = remainder.slice(qIdx + 1);
        remainder = remainder.slice(0, qIdx);
    }

    const slashIdx = remainder.indexOf('/');
    const hostPortPart = slashIdx === -1 ? remainder : remainder.slice(0, slashIdx);
    const pathPart = slashIdx === -1 ? '' : remainder.slice(slashIdx + 1);

    if (hostPortPart) {
        // Support host containing {{var}} cleanly
        if (hostPortPart.startsWith('{{') && hostPortPart.includes('}}')) {
            const closeIdx = hostPortPart.indexOf('}}');
            const afterVar = hostPortPart.slice(closeIdx + 2);
            if (afterVar.startsWith(':')) {
                result.host = [hostPortPart.slice(0, closeIdx + 2)];
                result.port = afterVar.slice(1);
            } else {
                result.host = [hostPortPart];
            }
        } else {
            const colonIdx = hostPortPart.lastIndexOf(':');
            if (colonIdx !== -1 && /^\d+$/.test(hostPortPart.slice(colonIdx + 1))) {
                result.host = hostPortPart.slice(0, colonIdx).split('.');
                result.port = hostPortPart.slice(colonIdx + 1);
            } else {
                result.host = hostPortPart.includes('{{') ? [hostPortPart] : hostPortPart.split('.');
            }
        }
    }

    if (pathPart) {
        result.path = pathPart.split('/').filter(Boolean);
    }

    if (activeParams.length > 0) {
        result.query = activeParams;
    } else if (rawQuery) {
        result.query = rawQuery.split('&').filter(Boolean).map(pair => {
            const eq = pair.indexOf('=');
            if (eq === -1) return { key: decodeSafe(pair), value: '' };
            return { key: decodeSafe(pair.slice(0, eq)), value: decodeSafe(pair.slice(eq + 1)) };
        });
    }

    return result;
}

function decodeSafe(val: string): string {
    try {
        return decodeURIComponent(val);
    } catch {
        return val;
    }
}

function resolveRawBodyText(req: any): { content: string; language: 'json' | 'xml' | 'text' } {
    const rawType = String(req?.rawType || 'JSON');
    let content = '';
    let language: 'json' | 'xml' | 'text' = 'json';

    if (rawType.includes('XML')) {
        language = 'xml';
        content = req?.rawBodyXml || req?.rawBody || '';
    } else if (rawType.toLowerCase() === 'text') {
        language = 'text';
        content = req?.rawBodyText || req?.rawBody || '';
    } else {
        language = 'json';
        content = req?.rawBodyJson || req?.rawBody || '';
    }

    return { content: typeof content === 'string' ? content : JSON.stringify(content, null, 2), language };
}

function buildPostmanBody(req: any): any | undefined {
    const bodyType = req?.bodyType || 'none';
    if (bodyType === 'none') return undefined;

    if (bodyType === 'form-data' || bodyType === 'formData') {
        const rows = (req?.formData || []).filter((r: any) => r && (r.key || r.value));
        return {
            mode: 'formdata',
            formdata: rows.map((r: any) => ({
                key: String(r.key || ''),
                value: r.type === 'file' ? undefined : String(r.value ?? ''),
                src: r.type === 'file' ? String(r.fileName || r.value || '') : undefined,
                type: r.type === 'file' ? 'file' : 'text',
                disabled: r.enabled === false
            }))
        };
    }

    if (bodyType === 'x-www-form-urlencoded') {
        const rows = (req?.urlEncodedData || []).filter((r: any) => r && (r.key || r.value));
        return {
            mode: 'urlencoded',
            urlencoded: rows.map((r: any) => ({
                key: String(r.key || ''),
                value: String(r.value ?? ''),
                type: 'text',
                disabled: r.enabled === false
            }))
        };
    }

    if (bodyType === 'graphql') {
        return {
            mode: 'graphql',
            graphql: {
                query: req?.graphqlQuery || '',
                variables: req?.graphqlVariables || ''
            }
        };
    }

    if (bodyType === 'raw') {
        const { content, language } = resolveRawBodyText(req);
        return {
            mode: 'raw',
            raw: content,
            options: {
                raw: { language }
            }
        };
    }

    return undefined;
}

function buildPostmanAuth(auth: any): any | undefined {
    if (!auth || !auth.type || auth.type === 'none') return undefined;
    if (auth.type === 'bearer') {
        return {
            type: 'bearer',
            bearer: [
                { key: 'token', value: String(auth.token || ''), type: 'string' }
            ]
        };
    }
    if (auth.type === 'basic') {
        let user = String(auth.username || '');
        let pass = String(auth.password || '');
        if (!user && !pass && auth.token && String(auth.token).includes(':')) {
            const idx = String(auth.token).indexOf(':');
            user = String(auth.token).slice(0, idx);
            pass = String(auth.token).slice(idx + 1);
        }
        return {
            type: 'basic',
            basic: [
                { key: 'username', value: user, type: 'string' },
                { key: 'password', value: pass, type: 'string' }
            ]
        };
    }
    if (auth.type === 'apikey') {
        return {
            type: 'apikey',
            apikey: [
                { key: 'key', value: String(auth.apiKeyName || auth.key || ''), type: 'string' },
                { key: 'value', value: String(auth.apiKeyValue ?? auth.value ?? auth.token ?? ''), type: 'string' },
                { key: 'in', value: String(auth.apiKeyIn || auth.in || 'header'), type: 'string' }
            ]
        };
    }
    if (auth.type === 'oauth2') {
        return {
            type: 'oauth2',
            oauth2: [
                { key: 'accessToken', value: String(auth.token || ''), type: 'string' },
                { key: 'grant_type', value: String(auth.oauth2?.grantType || 'client_credentials'), type: 'string' },
                { key: 'accessTokenUrl', value: String(auth.oauth2?.accessTokenUrl || ''), type: 'string' },
                { key: 'clientId', value: String(auth.oauth2?.clientId || ''), type: 'string' },
                { key: 'clientSecret', value: String(auth.oauth2?.clientSecret || ''), type: 'string' },
                { key: 'scope', value: String(auth.oauth2?.scope || ''), type: 'string' }
            ]
        };
    }
    if (auth.type === 'aws-sigv4' && auth.awsSigV4) {
        return {
            type: 'awsv4',
            awsv4: [
                { key: 'accessKey', value: String(auth.awsSigV4.accessKey || ''), type: 'string' },
                { key: 'secretKey', value: String(auth.awsSigV4.secretKey || ''), type: 'string' },
                { key: 'region', value: String(auth.awsSigV4.region || 'us-east-1'), type: 'string' },
                { key: 'service', value: String(auth.awsSigV4.service || 'execute-api'), type: 'string' },
                { key: 'sessionToken', value: String(auth.awsSigV4.sessionToken || ''), type: 'string' }
            ]
        };
    }
    return undefined;
}

function buildPostmanHeaders(headers: any[]): any[] {
    return (headers || [])
        .filter((h: any) => h && h.key)
        .map((h: any) => ({
            key: String(h.key),
            value: h.value !== undefined && h.value !== null ? String(h.value) : '',
            type: 'text',
            disabled: h.enabled === false
        }));
}

function buildPostmanEvents(req: any): any[] | undefined {
    const events: any[] = [];
    if (req?.scripts?.preRequest && String(req.scripts.preRequest).trim()) {
        events.push({
            listen: 'prerequest',
            script: {
                type: 'text/javascript',
                exec: String(req.scripts.preRequest).split('\n')
            }
        });
    }
    const testScript = req?.scripts?.testScript || req?.scripts?.postResponse || '';
    if (testScript && String(testScript).trim()) {
        events.push({
            listen: 'test',
            script: {
                type: 'text/javascript',
                exec: String(testScript).split('\n')
            }
        });
    }
    return events.length > 0 ? events : undefined;
}

function parseStatusInfo(statusVal: any): { code?: number; statusText?: string } {
    if (statusVal === null || statusVal === undefined) return {};
    if (typeof statusVal === 'number') {
        return { code: statusVal, statusText: statusVal >= 200 && statusVal < 300 ? 'OK' : String(statusVal) };
    }
    const str = String(statusVal).trim();
    const match = str.match(/^(\d{3})(?:\s+(.*))?$/);
    if (match) {
        return {
            code: Number(match[1]),
            statusText: (match[2] || '').trim() || (Number(match[1]) >= 200 && Number(match[1]) < 300 ? 'OK' : match[1])
        };
    }
    return { statusText: str };
}

function buildPostmanResponseFromExample(ex: any, fallbackReq: any): any {
    let snap: any = ex?.requestSnapshot;
    if (typeof snap === 'string') {
        try {
            snap = JSON.parse(snap);
        } catch {
            snap = {};
        }
    }
    snap = snap && typeof snap === 'object' ? snap : {};

    const reqMethod = (snap.method || fallbackReq.method || 'GET').toUpperCase();
    const reqUrl = snap.url !== undefined ? snap.url : (fallbackReq.url || '');
    const reqParams = snap.params !== undefined ? snap.params : (fallbackReq.params || []);
    const reqHeaders = snap.headers !== undefined ? snap.headers : (fallbackReq.headers || []);
    const reqSource = {
        ...fallbackReq,
        ...snap,
        method: reqMethod,
        url: reqUrl,
        params: reqParams,
        headers: reqHeaders
    };

    const { code, statusText } = parseStatusInfo(snap.responseStatus);
    const respHeaders = Array.isArray(snap.responseHeaders)
        ? snap.responseHeaders
            .filter((h: any) => h && h.key)
            .map((h: any) => ({ key: String(h.key), value: String(h.value ?? '') }))
        : [];

    let respBodyStr = '';
    if (snap.responseBody !== null && snap.responseBody !== undefined) {
        respBodyStr = typeof snap.responseBody === 'string'
            ? snap.responseBody
            : JSON.stringify(snap.responseBody, null, 2);
    }

    let previewLang: 'json' | 'xml' | 'text' = 'text';
    const trimmed = respBodyStr.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) previewLang = 'json';
    else if (trimmed.startsWith('<')) previewLang = 'xml';

    const originalRequest: any = {
        method: reqMethod,
        header: buildPostmanHeaders(reqHeaders),
        url: parsePostmanUrlObject(reqUrl, reqParams)
    };
    const bodyObj = buildPostmanBody(reqSource);
    if (bodyObj) originalRequest.body = bodyObj;
    const authObj = buildPostmanAuth(reqSource.auth);
    if (authObj) originalRequest.auth = authObj;

    return {
        name: ex?.name || 'Example',
        originalRequest,
        status: statusText || 'OK',
        code: code ?? 200,
        _postman_previewlanguage: previewLang,
        header: respHeaders,
        cookie: Array.isArray(snap.responseCookies) ? snap.responseCookies : [],
        body: respBodyStr
    };
}

function buildPostmanRequestItem(req: any, displayName: string): any {
    const item: any = {
        name: displayName,
        request: {
            method: (req?.method || 'GET').toUpperCase(),
            header: buildPostmanHeaders(req?.headers || []),
            url: parsePostmanUrlObject(req?.url || '', req?.params || [])
        },
        response: Array.isArray(req?.examples)
            ? req.examples.map((ex: any) => buildPostmanResponseFromExample(ex, req))
            : []
    };

    const authObj = buildPostmanAuth(req?.auth);
    if (authObj) item.request.auth = authObj;

    const bodyObj = buildPostmanBody(req);
    if (bodyObj) item.request.body = bodyObj;

    const events = buildPostmanEvents(req);
    if (events) item.event = events;

    return item;
}

/**
 * Converts an OnSteroid exported capsule object `{ name, variables, requests }`
 * into a Postman Collection v2.1 JSON object (preserving folders via ` — `,
 * variables, headers, params, bodies, scripts, auth, and saved `examples` -> `response[]`).
 */
export function convertCapsuleToPostmanCollection(
    capsuleData: any,
    options: PostmanCollectionExportOptions = {}
): any {
    const collectionName = options.collectionName || capsuleData?.name || 'Exported Collection';
    const requests = Array.isArray(capsuleData?.requests) ? capsuleData.requests : [];
    const variables = Array.isArray(capsuleData?.variables) ? capsuleData.variables : [];

    const folderMap = new Map<string, { name: string; item: any[] }>();
    const rootItems: any[] = [];

    for (const req of requests) {
        const rawName = String(req?.name || 'Untitled Request');
        const sepIdx = rawName.indexOf(' — ');
        if (sepIdx !== -1) {
            const folderName = rawName.slice(0, sepIdx).trim();
            const requestName = rawName.slice(sepIdx + 3).trim() || rawName;
            if (folderName) {
                if (!folderMap.has(folderName)) {
                    const folderObj = { name: folderName, item: [] as any[] };
                    folderMap.set(folderName, folderObj);
                    rootItems.push(folderObj);
                }
                folderMap.get(folderName)!.item.push(buildPostmanRequestItem(req, requestName));
                continue;
            }
        }
        rootItems.push(buildPostmanRequestItem(req, rawName));
    }

    const postmanVars = variables
        .filter((v: any) => v && v.key)
        .map((v: any) => ({
            key: String(v.key),
            value: v.value !== undefined && v.value !== null ? String(v.value) : '',
            type: v.type === 'secret' ? 'secret' : 'string',
            disabled: v.enabled === false
        }));

    return {
        info: {
            _postman_id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `pos-${Date.now()}`,
            name: collectionName,
            description: options.description || 'Exported from Post on Steroids',
            schema: options.schemaUrl || POSTMAN_V21_SCHEMA
        },
        item: rootItems,
        variable: postmanVars
    };
}

/**
 * Converts a single OnSteroid RequestState + optional examples/variables into a Postman Collection v2.1 JSON object.
 */
export function convertSingleRequestToPostmanCollection(
    req: any,
    variables: any[] = [],
    collectionName?: string
): any {
    return convertCapsuleToPostmanCollection(
        {
            name: collectionName || req?.name || 'Exported Request',
            variables,
            requests: [req]
        },
        { collectionName: collectionName || req?.name || 'Exported Request' }
    );
}
