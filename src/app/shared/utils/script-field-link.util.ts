import type { ScriptLanguage } from '../constants/script.snippets.constants';

export type RequestFieldTarget = 'body' | 'param' | 'query' | 'header';
export type RequestSourceSection =
    | 'response_body'
    | 'response_header'
    | 'request_body'
    | 'request_header'
    | 'request_param'
    | 'request_query';

export interface RequestFieldLinkMutation {
    target: RequestFieldTarget;
    field: string;
    value: unknown;
    request?: string;
}

export interface LinkableKeyValueRow {
    enabled: boolean;
    key: string;
    value: string;
}

export interface LinkableFormDataRow {
    enabled: boolean;
    key: string;
    value: string;
    type: 'text' | 'file';
    file?: unknown;
}

export interface LinkableRequestState {
    url?: string;
    method?: string;
    bodyType?: string;
    rawType?: string;
    rawBody?: string;
    rawBodyJson?: string;
    rawBodyXml?: string;
    rawBodyText?: string;
    params?: LinkableKeyValueRow[];
    headers?: LinkableKeyValueRow[];
    formData?: LinkableFormDataRow[];
    urlEncodedData?: LinkableKeyValueRow[];
    graphqlQuery?: string;
    graphqlVariables?: string;
}

export function normalizeFieldTarget(raw: string): RequestFieldTarget {
    const t = String(raw || '').trim().toLowerCase();
    if (t === 'header' || t === 'headers') return 'header';
    if (t === 'query' || t === 'querystring' || t === 'queryparams') return 'query';
    if (t === 'param' || t === 'params') return 'param';
    return 'body';
}

export function parsePathSegments(path: string): string[] {
    const cleaned = String(path || '')
        .trim()
        .replace(/^(?:\$\.|responseBody\.|response_body\.|body\.)/, '');
    if (!cleaned || cleaned === '$') return [];

    const segments: string[] = [];
    const regex = /[^.[\]]+|\[(?:'([^']*)'|"([^"]*)"|(\d+))\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(cleaned)) !== null) {
        const seg = match[1] ?? match[2] ?? match[3] ?? match[0];
        if (seg !== undefined && seg !== '') {
            segments.push(seg);
        }
    }
    return segments;
}

function tryParseJson(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"'))) {
        return value;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractXmlValue(xmlText: string, path: string): string | undefined {
    const segments = parsePathSegments(path);
    if (segments.length === 0) return xmlText;

    let currentXml = xmlText;
    for (let i = 0; i < segments.length; i++) {
        const tag = escapeRegExp(segments[i]);
        const rx = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, 'i');
        const m = rx.exec(currentXml);
        if (!m) {
            // Fall back to direct leaf match across full XML when intermediate wrapper tags are omitted
            if (i === 0 && segments.length === 1) return undefined;
            const leafTag = escapeRegExp(segments[segments.length - 1]);
            const leafRx = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${leafTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${leafTag}>`, 'i');
            const leafMatch = leafRx.exec(xmlText);
            return leafMatch ? leafMatch[1].trim() : undefined;
        }
        currentXml = m[1];
    }
    return currentXml.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim();
}

export function extractValueByPath(source: unknown, path: string): unknown {
    const cleanPath = String(path || '').trim();
    if (!cleanPath || cleanPath === '$' || cleanPath === 'responseBody' || cleanPath === 'response_body') {
        return tryParseJson(source);
    }

    const parsed = tryParseJson(source);

    // Header/KV array lookup support: [{ key, value }]
    if (
        Array.isArray(parsed) &&
        !cleanPath.startsWith('[') &&
        !/^\d+(?:\.|$)/.test(cleanPath) &&
        parsed.length > 0 &&
        parsed.every(item => item && typeof item === 'object' && 'key' in item && 'value' in item)
    ) {
        const targetKey = cleanPath.replace(/^(?:responseHeaders\.|response_headers\.|headers\.)/i, '').toLowerCase();
        const found = parsed.find(item => String((item as any).key || '').trim().toLowerCase() === targetKey);
        return found ? (found as any).value : undefined;
    }

    if (typeof parsed === 'string') {
        const trimmed = parsed.trim();
        if (trimmed.startsWith('<')) {
            return extractXmlValue(trimmed, cleanPath);
        }
        return undefined;
    }

    const segments = parsePathSegments(cleanPath);
    if (segments.length === 0) return parsed;

    let current: any = parsed;
    for (const seg of segments) {
        if (current === null || current === undefined) return undefined;
        if (Array.isArray(current) && /^\d+$/.test(seg)) {
            current = current[Number(seg)];
        } else if (typeof current === 'object') {
            current = current[seg];
        } else {
            return undefined;
        }
    }
    return current;
}

function escapeXmlValue(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function replaceXmlTagValue(xmlText: string, fieldPath: string, value: unknown): string {
    const strVal = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    const safeVal = /<!\[CDATA\[|<[a-zA-Z]/.test(strVal) ? strVal : escapeXmlValue(strVal);
    const segments = parsePathSegments(fieldPath);
    if (segments.length === 0) return strVal;

    const targetTag = escapeRegExp(segments[segments.length - 1]);
    const rx = new RegExp(`(<(?:[a-zA-Z0-9_-]+:)?${targetTag}(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/(?:[a-zA-Z0-9_-]+:)?${targetTag}>)`, 'i');
    if (rx.test(xmlText)) {
        return xmlText.replace(rx, `$1${safeVal}$3`);
    }
    const selfClosingRx = new RegExp(`(<(?:[a-zA-Z0-9_-]+:)?${targetTag}(?:\\s[^>]*)?)\\/>`, 'i');
    if (selfClosingRx.test(xmlText)) {
        return xmlText.replace(selfClosingRx, `$1>${safeVal}</${segments[segments.length - 1]}>`);
    }
    const closeRootIdx = xmlText.lastIndexOf('</');
    if (closeRootIdx !== -1) {
        const rawTag = segments[segments.length - 1];
        return `${xmlText.slice(0, closeRootIdx)}  <${rawTag}>${safeVal}</${rawTag}>\n${xmlText.slice(closeRootIdx)}`;
    }
    return `<${segments[segments.length - 1]}>${safeVal}</${segments[segments.length - 1]}>`;
}

function setDeepJsonProperty(target: any, segments: string[], value: unknown): any {
    if (segments.length === 0) return value;
    const isRootArray = Array.isArray(target) || /^\d+$/.test(segments[0]);
    const root: any = (target && typeof target === 'object')
        ? (Array.isArray(target) ? [...target] : { ...target })
        : (isRootArray ? [] : {});

    let cursor: any = root;
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        const nextIsIndex = /^\d+$/.test(segments[i + 1]);
        const key: any = Array.isArray(cursor) && /^\d+$/.test(seg) ? Number(seg) : seg;
        const existing = cursor[key];
        if (existing && typeof existing === 'object') {
            cursor[key] = Array.isArray(existing) ? [...existing] : { ...existing };
        } else {
            cursor[key] = nextIsIndex ? [] : {};
        }
        cursor = cursor[key];
    }

    const lastSeg = segments[segments.length - 1];
    const lastKey: any = Array.isArray(cursor) && /^\d+$/.test(lastSeg) ? Number(lastSeg) : lastSeg;
    cursor[lastKey] = value;
    return root;
}

export function applyFieldLinkToBody(
    currentBody: unknown,
    bodyType: string,
    rawType: string,
    fieldPath: string,
    value: unknown
): unknown {
    const cleanField = String(fieldPath || '').trim().replace(/^(?:body\.|\$\.)/, '');
    const bt = String(bodyType || 'raw').toLowerCase();
    const rt = String(rawType || 'JSON').toUpperCase();

    if (bt === 'form-data' || bt === 'x-www-form-urlencoded') {
        const rows = Array.isArray(currentBody) ? [...currentBody] : [];
        const strVal = typeof value === 'string' ? value : (value === undefined || value === null ? '' : JSON.stringify(value));
        const keyLower = cleanField.toLowerCase();
        const existingIdx = rows.findIndex(r => r && String(r.key || '').trim().toLowerCase() === keyLower);
        if (existingIdx !== -1) {
            rows[existingIdx] = { ...rows[existingIdx], enabled: true, value: strVal };
        } else if (cleanField) {
            const newRow = bt === 'form-data'
                ? { enabled: true, key: cleanField, value: strVal, type: 'text' as const }
                : { enabled: true, key: cleanField, value: strVal };
            const blankIdx = rows.findIndex(r => r && !r.key && !r.value);
            if (blankIdx !== -1) rows[blankIdx] = newRow;
            else rows.push(newRow);
        }
        return rows;
    }

    if (bt === 'graphql') {
        const gqlObj = (currentBody && typeof currentBody === 'object' && !Array.isArray(currentBody))
            ? { ...(currentBody as Record<string, any>) }
            : { query: '', variables: {} };
        let vars = gqlObj['variables'];
        if (typeof vars === 'string') {
            try { vars = JSON.parse(vars || '{}'); } catch { vars = {}; }
        }
        const segments = parsePathSegments(cleanField);
        const updatedVars = setDeepJsonProperty(vars || {}, segments, value);
        return { ...gqlObj, variables: updatedVars };
    }

    if (bt === 'raw' && (rt === 'XML' || rt === 'XML (SOAP)' || rt === 'SOAP')) {
        const xmlText = typeof currentBody === 'string' ? currentBody : String(currentBody ?? '');
        return replaceXmlTagValue(xmlText, cleanField, value);
    }

    if (bt === 'raw' && rt === 'TEXT') {
        return typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
    }

    // Default JSON object body
    const wasString = typeof currentBody === 'string';
    let jsonObj: any = currentBody;
    if (typeof currentBody === 'string') {
        const trimmed = currentBody.trim();
        if (!trimmed) {
            jsonObj = {};
        } else {
            try { jsonObj = JSON.parse(trimmed); } catch { jsonObj = {}; }
        }
    } else if (!jsonObj || typeof jsonObj !== 'object') {
        jsonObj = {};
    }

    const segments = parsePathSegments(cleanField);
    const updated = setDeepJsonProperty(jsonObj, segments, value);
    return wasString ? JSON.stringify(updated, null, 2) : updated;
}

function upsertKeyValueRow(rows: LinkableKeyValueRow[], key: string, value: string): LinkableKeyValueRow[] {
    const cleanKey = key.trim();
    if (!cleanKey) return rows;
    const list = [...rows];
    const targetLower = cleanKey.toLowerCase();
    const existingIdx = list.findIndex(r => (r.key || '').trim().toLowerCase() === targetLower);
    if (existingIdx !== -1) {
        list[existingIdx] = { ...list[existingIdx], enabled: true, key: cleanKey, value };
        return list;
    }
    const emptyIdx = list.findIndex(r => !(r.key || '').trim() && !(r.value || '').trim());
    if (emptyIdx !== -1) {
        list[emptyIdx] = { enabled: true, key: cleanKey, value };
        return list;
    }
    list.push({ enabled: true, key: cleanKey, value });
    return list;
}

export function setQueryParamOnUrl(rawUrl: string, key: string, value: string): string {
    const urlStr = String(rawUrl || '').trim();
    const cleanKey = String(key || '').trim();
    if (!cleanKey || !urlStr) return rawUrl;

    const hashIdx = urlStr.indexOf('#');
    const baseAndQuery = hashIdx >= 0 ? urlStr.slice(0, hashIdx) : urlStr;
    const hashSuffix = hashIdx >= 0 ? urlStr.slice(hashIdx) : '';

    const qIdx = baseAndQuery.indexOf('?');
    if (qIdx === -1) {
        return `${baseAndQuery}?${encodeURIComponent(cleanKey)}=${value}${hashSuffix}`;
    }

    const base = baseAndQuery.slice(0, qIdx);
    const existingQuery = baseAndQuery.slice(qIdx + 1);
    const pairs = existingQuery ? existingQuery.split('&').filter(Boolean) : [];
    const encodedKey = encodeURIComponent(cleanKey).toLowerCase();
    let replaced = false;

    const nextPairs = pairs.map(pair => {
        const eqIdx = pair.indexOf('=');
        const kRaw = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair;
        let kDecoded = kRaw;
        try { kDecoded = decodeURIComponent(kRaw); } catch {}
        if (kDecoded.toLowerCase() === cleanKey.toLowerCase() || kRaw.toLowerCase() === encodedKey) {
            replaced = true;
            return `${kRaw}=${value}`;
        }
        return pair;
    });

    if (!replaced) {
        nextPairs.push(`${encodeURIComponent(cleanKey)}=${value}`);
    }
    return `${base}?${nextPairs.join('&')}${hashSuffix}`;
}

export function applyRequestFieldLinksToTabState<T extends LinkableRequestState>(
    state: T,
    links: RequestFieldLinkMutation[]
): Partial<T> {
    if (!Array.isArray(links) || links.length === 0) return {};

    const patch: Partial<T> = {};
    let nextUrl = state.url ?? '';
    let nextParams = Array.isArray(state.params) ? [...state.params] : [];
    let nextHeaders = Array.isArray(state.headers) ? [...state.headers] : [];
    let nextBodyType = state.bodyType || 'none';
    let nextRawType = state.rawType || 'JSON';
    let nextRawBodyJson = state.rawBodyJson ?? '{}';
    let nextRawBodyXml = state.rawBodyXml ?? '';
    let nextRawBodyText = state.rawBodyText ?? '';
    let nextRawBody = state.rawBody ?? '';
    let nextFormData = Array.isArray(state.formData) ? [...state.formData] : [];
    let nextUrlEncoded = Array.isArray(state.urlEncodedData) ? [...state.urlEncodedData] : [];
    let nextGqlVars = state.graphqlVariables ?? '{}';

    let touchedUrl = false;
    let touchedParams = false;
    let touchedHeaders = false;
    let touchedBody = false;

    for (const link of links) {
        if (!link) continue;
        const target = normalizeFieldTarget(link.target);
        const field = String(link.field || '').trim();
        const strVal = typeof link.value === 'string'
            ? link.value
            : (link.value === undefined || link.value === null ? '' : JSON.stringify(link.value));

        if (target === 'header') {
            nextHeaders = upsertKeyValueRow(nextHeaders, field, strVal);
            touchedHeaders = true;
        } else if (target === 'param') {
            nextParams = upsertKeyValueRow(nextParams, field, strVal);
            touchedParams = true;
        } else if (target === 'query') {
            nextParams = upsertKeyValueRow(nextParams, field, strVal);
            touchedParams = true;
            if (nextUrl && nextUrl.trim()) {
                nextUrl = setQueryParamOnUrl(nextUrl, field, strVal);
                touchedUrl = true;
            }
        } else if (target === 'body') {
            if (nextBodyType === 'none') {
                nextBodyType = 'raw';
                nextRawType = 'JSON';
            }
            touchedBody = true;

            if (nextBodyType === 'form-data') {
                nextFormData = applyFieldLinkToBody(nextFormData, 'form-data', nextRawType, field, link.value) as LinkableFormDataRow[];
            } else if (nextBodyType === 'x-www-form-urlencoded') {
                nextUrlEncoded = applyFieldLinkToBody(nextUrlEncoded, 'x-www-form-urlencoded', nextRawType, field, link.value) as LinkableKeyValueRow[];
            } else if (nextBodyType === 'graphql') {
                const updatedGql = applyFieldLinkToBody({ query: state.graphqlQuery || '', variables: nextGqlVars }, 'graphql', nextRawType, field, link.value) as any;
                nextGqlVars = typeof updatedGql?.variables === 'string'
                    ? updatedGql.variables
                    : JSON.stringify(updatedGql?.variables ?? {}, null, 2);
            } else if (nextRawType === 'XML' || nextRawType === 'XML (SOAP)' || nextRawType === 'SOAP') {
                nextRawBodyXml = String(applyFieldLinkToBody(nextRawBodyXml, 'raw', nextRawType, field, link.value) ?? '');
                nextRawBody = nextRawBodyXml;
            } else if (nextRawType === 'Text') {
                nextRawBodyText = String(applyFieldLinkToBody(nextRawBodyText, 'raw', 'Text', field, link.value) ?? '');
                nextRawBody = nextRawBodyText;
            } else {
                nextRawBodyJson = String(applyFieldLinkToBody(nextRawBodyJson, 'raw', 'JSON', field, link.value) ?? '{}');
                nextRawBody = nextRawBodyJson;
            }
        }
    }

    if (touchedUrl) patch.url = nextUrl;
    if (touchedParams) patch.params = nextParams;
    if (touchedHeaders) patch.headers = nextHeaders;
    if (touchedBody) {
        patch.bodyType = nextBodyType;
        patch.rawType = nextRawType;
        patch.rawBody = nextRawBody;
        patch.rawBodyJson = nextRawBodyJson;
        patch.rawBodyXml = nextRawBodyXml;
        patch.rawBodyText = nextRawBodyText;
        patch.formData = nextFormData;
        patch.urlEncodedData = nextUrlEncoded;
        patch.graphqlVariables = nextGqlVars;
    }

    return patch;
}

export function collectJsonFieldPaths(value: unknown, prefix = '', max = 40): string[] {
    const parsed = tryParseJson(value);
    if (!parsed || typeof parsed !== 'object') return [];

    const out: string[] = [];
    const visit = (node: any, curPrefix: string) => {
        if (out.length >= max || node === null || node === undefined) return;
        if (Array.isArray(node)) {
            if (curPrefix) out.push(curPrefix);
            if (node.length > 0 && typeof node[0] === 'object') {
                visit(node[0], `${curPrefix}[0]`);
            }
            return;
        }
        if (typeof node === 'object') {
            for (const key of Object.keys(node)) {
                if (out.length >= max) break;
                const nextPath = curPrefix ? `${curPrefix}.${key}` : key;
                const child = node[key];
                out.push(nextPath);
                if (child && typeof child === 'object') {
                    visit(child, nextPath);
                }
            }
        }
    };

    visit(parsed, prefix);
    return Array.from(new Set(out));
}

export function extractRequestBodySource(state: LinkableRequestState | null | undefined): unknown {
    if (!state) return undefined;
    const bt = (state.bodyType || 'none').toLowerCase();
    const rt = (state.rawType || 'JSON').toUpperCase();
    if (bt === 'form-data') {
        const obj: Record<string, string> = {};
        for (const r of state.formData || []) {
            if (r && r.enabled !== false && (r.key || '').trim()) {
                obj[r.key.trim()] = r.value ?? '';
            }
        }
        return obj;
    }
    if (bt === 'x-www-form-urlencoded') {
        const obj: Record<string, string> = {};
        for (const r of state.urlEncodedData || []) {
            if (r && r.enabled !== false && (r.key || '').trim()) {
                obj[r.key.trim()] = r.value ?? '';
            }
        }
        return obj;
    }
    if (bt === 'graphql') {
        const varsParsed = tryParseJson(state.graphqlVariables || '{}');
        return varsParsed && typeof varsParsed === 'object' ? varsParsed : state.graphqlVariables;
    }
    if (bt === 'raw') {
        if (rt === 'XML' || rt === 'XML (SOAP)' || rt === 'SOAP') return state.rawBodyXml || state.rawBody || '';
        if (rt === 'TEXT') return state.rawBodyText || state.rawBody || '';
        return tryParseJson(state.rawBodyJson || state.rawBody || '');
    }
    return tryParseJson(state.rawBodyJson || state.rawBody || '');
}

export function extractRequestQueryPairs(state: LinkableRequestState | null | undefined): LinkableKeyValueRow[] {
    if (!state) return [];
    const seen = new Set<string>();
    const out: LinkableKeyValueRow[] = [];
    for (const p of state.params || []) {
        const k = (p?.key || '').trim();
        if (p && p.enabled !== false && k) {
            seen.add(k.toLowerCase());
            out.push({ enabled: true, key: k, value: p.value ?? '' });
        }
    }
    const rawUrl = String(state.url || '').trim();
    const qIdx = rawUrl.indexOf('?');
    if (qIdx >= 0) {
        const hashIdx = rawUrl.indexOf('#', qIdx);
        const qs = hashIdx >= 0 ? rawUrl.slice(qIdx + 1, hashIdx) : rawUrl.slice(qIdx + 1);
        for (const pair of qs.split('&').filter(Boolean)) {
            const eqIdx = pair.indexOf('=');
            const rawKey = eqIdx >= 0 ? pair.slice(0, eqIdx) : pair;
            const rawVal = eqIdx >= 0 ? pair.slice(eqIdx + 1) : '';
            let key = rawKey;
            let value = rawVal;
            try { key = decodeURIComponent(rawKey); } catch {}
            try { value = decodeURIComponent(rawVal); } catch {}
            if (key.trim() && !seen.has(key.trim().toLowerCase())) {
                seen.add(key.trim().toLowerCase());
                out.push({ enabled: true, key: key.trim(), value });
            }
        }
    }
    return out;
}

export function extractFromRequestSource(
    state: (LinkableRequestState & { responseBody?: unknown; responseHeaders?: LinkableKeyValueRow[] }) | null | undefined,
    sourceSection: RequestSourceSection,
    sourcePath: string
): unknown {
    if (!state) return undefined;
    switch (sourceSection) {
        case 'response_header':
            return extractValueByPath(state.responseHeaders || [], sourcePath);
        case 'request_body':
            return extractValueByPath(extractRequestBodySource(state), sourcePath);
        case 'request_header':
            return extractValueByPath(state.headers || [], sourcePath);
        case 'request_param':
            return extractValueByPath(state.params || [], sourcePath);
        case 'request_query':
            return extractValueByPath(extractRequestQueryPairs(state), sourcePath);
        case 'response_body':
        default:
            return extractValueByPath(state.responseBody, sourcePath);
    }
}

export function collectSuggestionsForSource(
    state: (LinkableRequestState & { responseBody?: unknown; responseHeaders?: LinkableKeyValueRow[] }) | null | undefined,
    sourceSection: RequestSourceSection
): string[] {
    if (!state) return [];
    switch (sourceSection) {
        case 'response_header':
            return Array.from(new Set((state.responseHeaders || []).map(h => (h?.key || '').trim()).filter(Boolean)));
        case 'request_body':
            return collectJsonFieldPaths(extractRequestBodySource(state), '', 35);
        case 'request_header':
            return Array.from(new Set((state.headers || []).map(h => (h?.key || '').trim()).filter(Boolean)));
        case 'request_param':
            return Array.from(new Set((state.params || []).map(p => (p?.key || '').trim()).filter(Boolean)));
        case 'request_query':
            return Array.from(new Set(extractRequestQueryPairs(state).map(q => q.key).filter(Boolean)));
        case 'response_body':
        default:
            return collectJsonFieldPaths(state.responseBody, '', 35);
    }
}

export function buildTabPayloadsLookup(
    allRequests: Array<LinkableRequestState & { id: string; name?: string; responseBody?: unknown; responseHeaders?: LinkableKeyValueRow[] }>,
    resolveTitle: (name?: string, url?: string) => string
): Array<Record<string, any>> {
    return (allRequests || []).map(req => ({
        id: req.id,
        title: resolveTitle(req.name, req.url),
        body: extractRequestBodySource(req),
        headers: req.headers || [],
        params: req.params || [],
        query: extractRequestQueryPairs(req),
        responseBody: req.responseBody ?? null,
        responseHeaders: req.responseHeaders || []
    }));
}

export function buildFieldLinkCodeSnippet(opts: {
    target: RequestFieldTarget;
    field: string;
    sourceExpr: string;
    language: ScriptLanguage;
    sourceSection?: RequestSourceSection;
    sourceRequest?: string;
    targetRequest?: string;
}): string {
    const field = (opts.field || 'token').trim();
    const sourceSection: RequestSourceSection = opts.sourceSection || 'response_body';
    const rawSource = (opts.sourceExpr || 'data.token').trim();
    const cleanPath = rawSource.replace(/^(?:responseBody\.|response_body\.|body\.|\$\.)/, '');
    const cleanSrcReq = (opts.sourceRequest || '').trim();
    const cleanTargetReq = (opts.targetRequest || '').trim();

    if (sourceSection !== 'response_body' || cleanSrcReq) {
        const pathArg = cleanPath && cleanPath !== '$' ? cleanPath : '';
        if (opts.language === 'python') {
            const args = [
                JSON.stringify(sourceSection),
                JSON.stringify(pathArg),
                JSON.stringify(opts.target),
                JSON.stringify(field)
            ];
            if (cleanSrcReq || cleanTargetReq) args.push(JSON.stringify(cleanSrcReq));
            if (cleanTargetReq) args.push(JSON.stringify(cleanTargetReq));
            return `st.link_request_to_request(${args.join(', ')})`;
        }
        const args = [
            JSON.stringify(sourceSection),
            JSON.stringify(pathArg),
            JSON.stringify(opts.target),
            JSON.stringify(field)
        ];
        if (cleanSrcReq || cleanTargetReq) args.push(cleanSrcReq ? JSON.stringify(cleanSrcReq) : 'undefined');
        if (cleanTargetReq) args.push(JSON.stringify(cleanTargetReq));
        return `st.linkRequestToRequest(${args.join(', ')});`;
    }

    const targetReqArg = cleanTargetReq ? `, ${JSON.stringify(cleanTargetReq)}` : '';

    if (opts.language === 'python') {
        const pyFnMap: Record<RequestFieldTarget, string> = {
            body: 'st.set_body_field',
            param: 'st.set_param',
            query: 'st.set_query',
            header: 'st.set_header'
        };
        if (!cleanPath || cleanPath === '$' || cleanPath === 'responseBody' || cleanPath === 'response_body') {
            return `${pyFnMap[opts.target]}(${JSON.stringify(field)}, st.response_body${targetReqArg})`;
        }
        return `st.link_response_to_request(${JSON.stringify(cleanPath)}, ${JSON.stringify(opts.target)}, ${JSON.stringify(field)}${targetReqArg ? `, st.response_body${targetReqArg}` : ''})`;
    }

    const jsFnMap: Record<RequestFieldTarget, string> = {
        body: 'st.setBodyField',
        param: 'st.setParam',
        query: 'st.setQuery',
        header: 'st.setHeader'
    };
    if (!cleanPath || cleanPath === '$' || cleanPath === 'responseBody' || cleanPath === 'response_body') {
        return `${jsFnMap[opts.target]}(${JSON.stringify(field)}, st.responseBody${targetReqArg});`;
    }
    return `st.linkResponseToRequest(${JSON.stringify(cleanPath)}, ${JSON.stringify(opts.target)}, ${JSON.stringify(field)}${targetReqArg ? `, st.responseBody${targetReqArg}` : ''});`;
}
