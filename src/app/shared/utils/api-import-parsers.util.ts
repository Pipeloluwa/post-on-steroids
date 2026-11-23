import type { IGlobalVariable } from '../../interfaces/services/IVariableService';
import type { RequestGroup, RequestState } from '../services/tab.state.service';
import { generateUUID } from './uuid.util';

export interface ParsedImportCollection {
    name: string;
    autoAuthEnabled?: string;
    autoAuthEndpointId?: string | null;
    requests: (Partial<RequestState> & { __folderName?: string })[];
    groups?: Partial<RequestGroup>[];
    requestOrder?: string[];
    variables?: IGlobalVariable[];
    variableSources?: Record<string, any>;
}

const KNOWN_UPPERCASE_ACRONYMS = new Set([
    'id', 'uuid', 'guid', 'url', 'uri', 'api', 'otp', 'pin', 'jwt', 'sso', 'mfa',
    'sms', 'xml', 'json', 'yaml', 'yml', 'pdf', 'csv', 'html', 'http', 'https',
    'soap', 'rest', 'grpc', 'b2b', 'b2c', 'kyc', 'aml', 'bvn', 'nin', 'tin',
    'usd', 'ngn', 'eur', 'gbp', 'ip', 'ipv4', 'ipv6', 'dns', 'ssl', 'tls',
    'aws', 'sql', 'rpc', 'qr', 'ui', 'ux', 'sdk', 'cli', 'rbac', 'crm', 'erp',
    'sku', 'vat', 'pos', 'atm', 'ach', 'iban', 'swift', 'bic', 'pan', 'cvv'
]);

const LOWERCASE_CONNECTORS = new Set([
    'by', 'of', 'for', 'to', 'in', 'on', 'with', 'from', 'and', 'or', 'the', 'a', 'an', 'via', 'per', 'at'
]);

const NOISE_PATH_PREFIXES = new Set(['api', 'apis', 'rest', 'service', 'services', 'public', 'internal', 'external', 'gateway']);

function splitIdentifierWords(raw: string): string[] {
    return raw
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/[_\-./:]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function formatHumanWords(words: string[]): string {
    return words
        .map((w, idx) => {
            const lower = w.toLowerCase();
            if (KNOWN_UPPERCASE_ACRONYMS.has(lower)) {
                return lower === 'oauth' ? 'OAuth' : lower.toUpperCase();
            }
            if (lower === 'oauth2') return 'OAuth2';
            if (lower === 'graphql') return 'GraphQL';
            if (idx > 0 && LOWERCASE_CONNECTORS.has(lower)) {
                return lower;
            }
            if (/^[A-Z0-9]{2,5}$/.test(w)) {
                return w;
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ')
        .trim();
}

function cleanHumanString(raw: string): string {
    let s = String(raw || '').trim();
    if (!s) return '';

    // Strip redundant leading HTTP method prefix like "GET - List Users" or "POST: Create Order"
    s = s.replace(/^(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*[-:–—|]+\s*/i, '').trim();

    // Collapse excess whitespace and remove trailing sentence period
    s = s.replace(/\s+/g, ' ').replace(/\.$/, '').trim();

    // If looks like a code identifier without spaces (e.g. createUserAccount or get_user_by_id)
    if (s && !s.includes(' ') && /[A-Z_-]/.test(s) && !/^https?:\/\//i.test(s)) {
        const cleanedId = stripOperationIdNoise(s);
        const words = splitIdentifierWords(cleanedId);
        if (words.length > 0) {
            return formatHumanWords(words);
        }
    }

    // Capitalize leading letter cleanly without mangling internal acronyms
    if (s && /^[a-z]/.test(s)) {
        s = s.charAt(0).toUpperCase() + s.slice(1);
    }
    return s;
}

function stripOperationIdNoise(opId: string): string {
    return String(opId || '')
        .trim()
        // Springfox / Swagger Codegen suffixes like UsingGET, UsingPOST_1
        .replace(/Using(?:GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)(?:_\d+)?$/i, '')
        // Controller/Service prefixes like UsersController_getUsers or AuthResource.login
        .replace(/^[A-Za-z0-9]+(?:Controller|Resource|Service|Endpoint|Handler)[_.:-]+/i, '')
        // Trailing framework suffixes
        .replace(/(?:Async|SoapIn|SoapOut|Handler)$/i, '')
        // Leading api_v1_ prefixes
        .replace(/^(?:api[_-])?v\d+[_-]+/i, '')
        .replace(/[_-]\d+$/, '')
        .trim();
}

function singularizeSimple(word: string): string {
    const lower = word.toLowerCase();
    if (lower.endsWith('ies') && word.length > 4) {
        return word.slice(0, -3) + 'y';
    }
    if (/(sses|xes|zes|ches|shes)$/i.test(word) && word.length > 4) {
        return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && word.length > 3) {
        return word.slice(0, -1);
    }
    return word;
}

function deriveTitleFromPath(method: string, rawPath: string): string {
    const verb = (method || 'GET').toUpperCase();
    let path = String(rawPath || '').trim()
        .replace(/^https?:\/\/[^/]+/i, '')
        .replace(/^\{\{[^}]+\}\}/, '')
        .split(/[?#]/)[0]
        .trim();

    const segments = path.split('/').filter(Boolean);
    while (segments.length > 0) {
        const first = segments[0].toLowerCase();
        if (NOISE_PATH_PREFIXES.has(first) || /^v\d+(?:\.\d+)?$/.test(first)) {
            segments.shift();
        } else {
            break;
        }
    }

    if (segments.length === 0) {
        const verbLabel: Record<string, string> = {
            GET: 'Get Root',
            POST: 'Submit Request',
            PUT: 'Update Root',
            PATCH: 'Patch Root',
            DELETE: 'Delete Root',
            HEAD: 'Check Headers',
            OPTIONS: 'Options'
        };
        return verbLabel[verb] || `${verb} Root`;
    }

    const lastSeg = segments[segments.length - 1];
    const endsWithParam = /^(\{[^}]+\}|:[A-Za-z0-9_]+|<[^>]+>)$/.test(lastSeg);

    const staticSegments = segments.filter(s => !/^(\{[^}]+\}|:[A-Za-z0-9_]+|<[^>]+>)$/.test(s));
    const paramNames = segments
        .filter(s => /^(\{[^}]+\}|:[A-Za-z0-9_]+|<[^>]+>)$/.test(s))
        .map(s => s.replace(/^[{:<]|[}>]$/g, ''));

    const humanResource = (seg: string, singular = false): string => {
        const words = splitIdentifierWords(singular ? singularizeSimple(seg) : seg);
        return formatHumanWords(words) || seg;
    };

    const primaryStatic = staticSegments[staticSegments.length - 1] || '';
    const parentStatic = staticSegments.length >= 2 ? staticSegments[staticSegments.length - 2] : '';

    if (!primaryStatic) {
        const paramLabel = formatHumanWords(splitIdentifierWords(paramNames[0] || 'Resource'));
        return `${verb.charAt(0) + verb.slice(1).toLowerCase()} by ${paramLabel}`;
    }

    // Sub-action endpoint like /orders/{id}/cancel or /users/{id}/verify-otp
    if (!endsWithParam && paramNames.length > 0 && parentStatic) {
        const actionWords = splitIdentifierWords(primaryStatic);
        const parentLabel = humanResource(parentStatic, true);
        const actionLabel = formatHumanWords(actionWords);
        const actionLower = actionLabel.toLowerCase();
        if (actionWords.length >= 1) {
            const startsWithVerb = /^(get|list|create|add|update|edit|patch|delete|remove|verify|confirm|cancel|approve|reject|send|reset|refresh|export|import|upload|download|sync|check|validate|submit|pay|refund|activate|deactivate|enable|disable)/i.test(actionLower);
            if (startsWithVerb) {
                return actionLower.includes(parentLabel.toLowerCase())
                    ? actionLabel
                    : `${actionLabel} (${parentLabel})`;
            }
            return `${parentLabel} — ${actionLabel}`;
        }
    }

    const resLabel = humanResource(primaryStatic, endsWithParam || verb === 'POST');
    const paramSuffix = endsWithParam && paramNames.length > 0
        ? ` by ${formatHumanWords(splitIdentifierWords(paramNames[paramNames.length - 1]))}`
        : '';

    switch (verb) {
        case 'GET':
            return endsWithParam ? `Get ${resLabel}${paramSuffix}` : `List ${humanResource(primaryStatic, false)}`;
        case 'POST':
            return endsWithParam
                ? `Create ${resLabel}${paramSuffix}`
                : (/^(login|logout|register|signin|signup|authenticate|auth|token|verify|search|query|export|import|webhook|callback)$/i.test(primaryStatic)
                    ? humanResource(primaryStatic, false)
                    : `Create ${resLabel}`);
        case 'PUT':
        case 'PATCH':
            return `Update ${resLabel}${paramSuffix}`;
        case 'DELETE':
            return `Delete ${resLabel}${paramSuffix}`;
        default:
            return `${verb.charAt(0) + verb.slice(1).toLowerCase()} ${resLabel}${paramSuffix}`;
    }
}

/**
 * Produces a concise, readable tab title for imported HTTP/OpenAPI/Insomnia/HAR/RAML requests.
 */
export function cleanEndpointTitle(opts: {
    summary?: string;
    operationId?: string;
    name?: string;
    method?: string;
    path?: string;
}): string {
    const rawSummary = (opts.summary || '').trim();
    const rawName = (opts.name || '').trim();
    const candidateText = rawSummary || rawName;

    const looksLikeRawRoute = (text: string) =>
        /^\/[A-Za-z0-9_./{}:-]*$/.test(text) ||
        /^(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\//i.test(text) ||
        /^https?:\/\//i.test(text);

    if (candidateText && !looksLikeRawRoute(candidateText)) {
        const cleaned = cleanHumanString(candidateText);
        if (cleaned) return cleaned;
    }

    if (opts.operationId && opts.operationId.trim()) {
        const stripped = stripOperationIdNoise(opts.operationId);
        const words = splitIdentifierWords(stripped);
        const formatted = formatHumanWords(words);
        if (formatted) return formatted;
    }

    const routeCandidate = opts.path || (looksLikeRawRoute(candidateText) ? candidateText.replace(/^(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i, '') : '');
    if (routeCandidate) {
        return deriveTitleFromPath(opts.method || 'GET', routeCandidate);
    }

    return candidateText ? cleanHumanString(candidateText) : 'Untitled Request';
}

/**
 * Produces a readable tab title for imported SOAP / WSDL / ASMX operations.
 */
export function cleanSoapOperationTitle(opName: string, serviceName?: string): string {
    let raw = String(opName || '').trim();
    if (!raw) return 'SOAP Request';

    // Handle disambiguated portType.OperationName format
    if (raw.includes('.')) {
        const parts = raw.split('.');
        raw = parts[parts.length - 1];
    }

    if (serviceName && serviceName.trim()) {
        const escaped = serviceName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        raw = raw.replace(new RegExp(`^${escaped}[_\\s-]+`, 'i'), '');
    }

    raw = raw.replace(/(?:SoapIn|SoapOut|Async|Request)$/i, '').trim() || raw;
    const words = splitIdentifierWords(raw);
    return formatHumanWords(words) || opName;
}

// ---------------------------------------------------------------------------
// Dependency-free YAML parser (handles OpenAPI 2/3, Insomnia v5, RAML specs)
// ---------------------------------------------------------------------------

interface YamlLine {
    indent: number;
    text: string;
}

function stripYamlComments(line: string): string {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (quote === '"' && ch === '\\') {
                i++;
                continue;
            }
            if (quote === "'" && ch === "'" && line[i + 1] === "'") {
                i++;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
            return line.slice(0, i);
        }
    }
    return line;
}

function splitYamlTopLevelComma(inner: string): string[] {
    const out: string[] = [];
    let buf = '';
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (quote) {
            buf += ch;
            if (quote === '"' && ch === '\\' && i + 1 < inner.length) {
                buf += inner[++i];
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            buf += ch;
            continue;
        }
        if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
            out.push(buf.trim());
            buf = '';
            continue;
        }
        buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}

function findUnquotedColonIndex(text: string): number {
    let quote: string | null = null;
    let braceDepth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (quote === '"' && ch === '\\') {
                i++;
                continue;
            }
            if (quote === "'" && ch === "'" && text[i + 1] === "'") {
                i++;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '{' || ch === '[') braceDepth++;
        else if (ch === '}' || ch === ']') braceDepth = Math.max(0, braceDepth - 1);
        else if (ch === ':' && braceDepth === 0 && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
            return i;
        }
    }
    return -1;
}

function unquoteYamlKey(key: string): string {
    const t = key.trim();
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
        return t.slice(1, -1);
    }
    return t;
}

function parseYamlScalar(raw: string, anchors: Map<string, any>): any {
    let val = raw.trim();
    if (!val || val === 'null' || val === '~') return null;

    if (val.startsWith('*')) {
        const aliasName = val.slice(1).trim();
        return anchors.has(aliasName) ? structuredClone(anchors.get(aliasName)) : val;
    }

    let anchorName: string | null = null;
    const anchorMatch = val.match(/^&([A-Za-z0-9_-]+)\s*(.*)$/);
    if (anchorMatch) {
        anchorName = anchorMatch[1];
        val = anchorMatch[2].trim();
        if (!val) return null;
    }

    let parsed: any;
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        try {
            parsed = JSON.parse(val);
        } catch {
            parsed = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
    } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
        parsed = val.slice(1, -1).replace(/''/g, "'");
    } else if (val === 'true') {
        parsed = true;
    } else if (val === 'false') {
        parsed = false;
    } else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(val)) {
        parsed = Number(val);
    } else if (val.startsWith('[') && val.endsWith(']')) {
        const inner = val.slice(1, -1).trim();
        parsed = inner ? splitYamlTopLevelComma(inner).map(part => parseYamlScalar(part, anchors)) : [];
    } else if (val.startsWith('{') && val.endsWith('}')) {
        const inner = val.slice(1, -1).trim();
        const obj: Record<string, any> = {};
        if (inner) {
            for (const pair of splitYamlTopLevelComma(inner)) {
                const ci = findUnquotedColonIndex(pair);
                if (ci > 0) {
                    const k = unquoteYamlKey(pair.slice(0, ci));
                    const v = parseYamlScalar(pair.slice(ci + 1), anchors);
                    obj[k] = v;
                }
            }
        }
        parsed = obj;
    } else {
        parsed = val;
    }

    if (anchorName) anchors.set(anchorName, parsed);
    return parsed;
}

export function parseYamlToObject(yamlText: string): any {
    if (!yamlText || typeof yamlText !== 'string') return null;
    const rawLines = yamlText.replace(/\r\n/g, '\n').split('\n');
    const lines: YamlLine[] = [];

    for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i];
        const withoutComment = stripYamlComments(raw);
        if (!withoutComment.trim()) continue;
        const trimmed = withoutComment.trim();
        if (trimmed === '---' || trimmed === '...' || trimmed.startsWith('%')) continue;
        const indent = withoutComment.search(/\S/);
        lines.push({ indent, text: trimmed });
    }

    if (lines.length === 0) return null;

    const anchors = new Map<string, any>();

    const parseBlockScalar = (startIdx: number, parentIndent: number, style: string): { value: string; nextIdx: number } => {
        const collected: { indent: number; text: string }[] = [];
        let idx = startIdx;
        let minIndent = Infinity;
        while (idx < lines.length && lines[idx].indent > parentIndent) {
            collected.push(lines[idx]);
            if (lines[idx].indent < minIndent) minIndent = lines[idx].indent;
            idx++;
        }
        const baseIndent = Number.isFinite(minIndent) ? minIndent : parentIndent + 2;
        const rawTextLines = collected.map(l => ' '.repeat(Math.max(0, l.indent - baseIndent)) + l.text);
        const joined = style.startsWith('>') ? rawTextLines.join(' ') : rawTextLines.join('\n');
        return { value: style.endsWith('-') ? joined : `${joined}\n`, nextIdx: idx };
    };

    const parseNode = (idx: number, minIndent: number): { value: any; nextIdx: number } => {
        if (idx >= lines.length || lines[idx].indent < minIndent) {
            return { value: null, nextIdx: idx };
        }
        const currentIndent = lines[idx].indent;
        if (lines[idx].text === '-' || lines[idx].text.startsWith('- ')) {
            return parseSequence(idx, currentIndent);
        }
        if (findUnquotedColonIndex(lines[idx].text) >= 0) {
            return parseMapping(idx, currentIndent);
        }
        return { value: parseYamlScalar(lines[idx].text, anchors), nextIdx: idx + 1 };
    };

    const parseSequence = (startIdx: number, seqIndent: number): { value: any[]; nextIdx: number } => {
        const arr: any[] = [];
        let idx = startIdx;
        while (idx < lines.length && lines[idx].indent === seqIndent && (lines[idx].text === '-' || lines[idx].text.startsWith('- '))) {
            const rest = lines[idx].text.slice(1).trim();
            if (!rest) {
                if (idx + 1 < lines.length && lines[idx + 1].indent > seqIndent) {
                    const child = parseNode(idx + 1, seqIndent + 1);
                    arr.push(child.value);
                    idx = child.nextIdx;
                } else {
                    arr.push(null);
                    idx++;
                }
                continue;
            }

            const colonIdx = findUnquotedColonIndex(rest);
            if (colonIdx > 0) {
                // Inline object item inside sequence e.g. `- name: foo` followed by sibling keys indented deeper than `-`
                const key = unquoteYamlKey(rest.slice(0, colonIdx));
                const afterColon = rest.slice(colonIdx + 1).trim();
                const obj: Record<string, any> = {};

                if (!afterColon) {
                    if (idx + 1 < lines.length && lines[idx + 1].indent > seqIndent + 2) {
                        const nestedVal = parseNode(idx + 1, seqIndent + 3);
                        obj[key] = nestedVal.value;
                        idx = nestedVal.nextIdx;
                    } else if (idx + 1 < lines.length && lines[idx + 1].indent > seqIndent && (lines[idx + 1].text === '-' || lines[idx + 1].text.startsWith('- '))) {
                        const nestedSeq = parseSequence(idx + 1, lines[idx + 1].indent);
                        obj[key] = nestedSeq.value;
                        idx = nestedSeq.nextIdx;
                    } else {
                        obj[key] = {};
                        idx++;
                    }
                } else if (afterColon === '|' || afterColon === '|-' || afterColon === '>' || afterColon === '>-') {
                    const scalarRes = parseBlockScalar(idx + 1, seqIndent, afterColon);
                    obj[key] = scalarRes.value;
                    idx = scalarRes.nextIdx;
                } else {
                    obj[key] = parseYamlScalar(afterColon, anchors);
                    idx++;
                }

                // Parse remaining properties belonging to this sequence item's map
                if (idx < lines.length && lines[idx].indent > seqIndent && findUnquotedColonIndex(lines[idx].text) > 0 && !lines[idx].text.startsWith('- ')) {
                    const siblingMap = parseMapping(idx, lines[idx].indent);
                    Object.assign(obj, siblingMap.value);
                    idx = siblingMap.nextIdx;
                }
                arr.push(obj);
            } else {
                arr.push(parseYamlScalar(rest, anchors));
                idx++;
            }
        }
        return { value: arr, nextIdx: idx };
    };

    const parseMapping = (startIdx: number, mapIndent: number): { value: Record<string, any>; nextIdx: number } => {
        const obj: Record<string, any> = {};
        let idx = startIdx;
        while (idx < lines.length && lines[idx].indent === mapIndent && !(lines[idx].text === '-' || lines[idx].text.startsWith('- '))) {
            const lineText = lines[idx].text;
            const colonIdx = findUnquotedColonIndex(lineText);
            if (colonIdx < 0) break;

            const rawKey = unquoteYamlKey(lineText.slice(0, colonIdx));
            const rawVal = lineText.slice(colonIdx + 1).trim();

            if (!rawVal) {
                if (idx + 1 < lines.length && lines[idx + 1].indent > mapIndent) {
                    const child = parseNode(idx + 1, mapIndent + 1);
                    obj[rawKey] = child.value;
                    idx = child.nextIdx;
                } else if (idx + 1 < lines.length && lines[idx + 1].indent === mapIndent && (lines[idx + 1].text === '-' || lines[idx + 1].text.startsWith('- '))) {
                    const seqChild = parseSequence(idx + 1, mapIndent);
                    obj[rawKey] = seqChild.value;
                    idx = seqChild.nextIdx;
                } else {
                    obj[rawKey] = {};
                    idx++;
                }
            } else if (rawVal === '|' || rawVal === '|-' || rawVal === '>' || rawVal === '>-') {
                const blockRes = parseBlockScalar(idx + 1, mapIndent, rawVal);
                obj[rawKey] = blockRes.value;
                idx = blockRes.nextIdx;
            } else {
                const anchorOnlyMatch = rawVal.match(/^&([A-Za-z0-9_-]+)$/);
                if (anchorOnlyMatch && idx + 1 < lines.length && lines[idx + 1].indent > mapIndent) {
                    const child = parseNode(idx + 1, mapIndent + 1);
                    anchors.set(anchorOnlyMatch[1], child.value);
                    obj[rawKey] = child.value;
                    idx = child.nextIdx;
                } else {
                    const parsedVal = parseYamlScalar(rawVal, anchors);
                    if (rawKey === '<<' && parsedVal && typeof parsedVal === 'object' && !Array.isArray(parsedVal)) {
                        Object.assign(obj, parsedVal);
                    } else {
                        obj[rawKey] = parsedVal;
                    }
                    idx++;
                }
            }
        }
        return { value: obj, nextIdx: idx };
    };

    return parseNode(0, lines[0].indent).value;
}

// ---------------------------------------------------------------------------
// Swagger UI & Documentation Alternatives HTML/JS Extractors
// ---------------------------------------------------------------------------

export type HtmlDocExtractionMatch =
    | { kind: 'inline-spec'; spec: Record<string, any> }
    | { kind: 'spec-url'; url: string }
    | { kind: 'script-candidates'; urls: string[] };

function decodeHtmlAttr(raw: string): string {
    return raw
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

function extractBalancedJsonObject(source: string, openBraceIdx: number): Record<string, any> | null {
    if (openBraceIdx < 0 || source[openBraceIdx] !== '{') return null;
    let depth = 0;
    let quote: string | null = null;
    for (let i = openBraceIdx; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (quote === '"' && ch === '\\') {
                i++;
                continue;
            }
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                const candidate = source.slice(openBraceIdx, i + 1);
                try {
                    const parsed = JSON.parse(candidate);
                    if (parsed && typeof parsed === 'object') return parsed;
                } catch {
                    return null;
                }
                return null;
            }
        }
    }
    return null;
}

function tryParseInlineSpecText(rawText: string): Record<string, any> | null {
    const trimmed = decodeHtmlAttr(rawText).trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && (parsed['openapi'] || parsed['swagger'] || parsed['paths'])) {
                return parsed;
            }
        } catch { }
    }
    if (/^(?:openapi|swagger)\s*:/im.test(trimmed)) {
        try {
            const parsed = parseYamlToObject(trimmed);
            if (parsed && (parsed['openapi'] || parsed['swagger'] || parsed['paths'])) {
                return parsed;
            }
        } catch { }
    }
    return null;
}

/**
 * Extracts OpenAPI/Swagger spec references or inline specs from HTML shells used by
 * Swagger UI, Redoc, Scalar, Stoplight Elements, RapiDoc, and swagger-ui-init.js.
 */
export function extractDocHtmlSpecReference(htmlOrJs: string): HtmlDocExtractionMatch | null {
    if (!htmlOrJs || typeof htmlOrJs !== 'string') return null;

    // 1. Scalar (<script id="api-reference" data-url="..." data-configuration='...'> or inline spec)
    const scalarUrl = htmlOrJs.match(/<script[^>]*id=["']api-reference["'][^>]*data-url=["']([^"']+)["']/i)
        || htmlOrJs.match(/<script[^>]*data-url=["']([^"']+)["'][^>]*id=["']api-reference["']/i)
        || htmlOrJs.match(/Scalar\.createApiReference\([\s\S]*?(?:url|specUrl)\s*:\s*["']([^"']+)["']/i);
    if (scalarUrl?.[1]) {
        return { kind: 'spec-url', url: decodeHtmlAttr(scalarUrl[1].trim()) };
    }

    const scalarConfig = htmlOrJs.match(/data-configuration=(["'])([\s\S]*?)\1/i);
    if (scalarConfig?.[2]) {
        try {
            const cfg = JSON.parse(decodeHtmlAttr(scalarConfig[2]));
            const cfgUrl = cfg?.url || cfg?.spec?.url;
            if (typeof cfgUrl === 'string' && cfgUrl.trim()) {
                return { kind: 'spec-url', url: cfgUrl.trim() };
            }
            const inlineContent = cfg?.content || cfg?.spec?.content;
            if (inlineContent && typeof inlineContent === 'object' && (inlineContent.openapi || inlineContent.swagger || inlineContent.paths)) {
                return { kind: 'inline-spec', spec: inlineContent };
            }
            if (typeof inlineContent === 'string') {
                const parsed = tryParseInlineSpecText(inlineContent);
                if (parsed) return { kind: 'inline-spec', spec: parsed };
            }
        } catch { }
    }

    const scalarInline = htmlOrJs.match(/<script[^>]*id=["']api-reference["'][^>]*>([\s\S]*?)<\/script>/i);
    if (scalarInline?.[1]) {
        const parsed = tryParseInlineSpecText(scalarInline[1]);
        if (parsed) return { kind: 'inline-spec', spec: parsed };
    }

    // 2. Stoplight Elements (<elements-api apiDescriptionUrl="..." | api-description-url="..." />)
    const stoplightUrl = htmlOrJs.match(/<elements-api[^>]*\b(?:api-description-url|apiDescriptionUrl)=["']([^"']+)["']/i);
    if (stoplightUrl?.[1]) {
        return { kind: 'spec-url', url: decodeHtmlAttr(stoplightUrl[1].trim()) };
    }
    const stoplightDoc = htmlOrJs.match(/<elements-api[^>]*\b(?:api-description-document|apiDescriptionDocument)=(["'])([\s\S]*?)\1/i);
    if (stoplightDoc?.[2]) {
        const parsed = tryParseInlineSpecText(stoplightDoc[2]);
        if (parsed) return { kind: 'inline-spec', spec: parsed };
    }

    // 3. Redoc (<redoc spec-url="...">, Redoc.init("..."), or __redoc_state = {...})
    const redocTagUrl = htmlOrJs.match(/<redoc[^>]*\bspec-url=["']([^"']+)["']/i)
        || htmlOrJs.match(/Redoc\.init\(\s*["']([^"']+)["']/i);
    if (redocTagUrl?.[1]) {
        return { kind: 'spec-url', url: decodeHtmlAttr(redocTagUrl[1].trim()) };
    }
    const redocStateIdx = htmlOrJs.search(/__redoc_state\s*=\s*\{/i);
    if (redocStateIdx !== -1) {
        const braceIdx = htmlOrJs.indexOf('{', redocStateIdx);
        const stateObj = extractBalancedJsonObject(htmlOrJs, braceIdx);
        const embeddedSpec = stateObj?.['spec']?.data;
        if (embeddedSpec && (embeddedSpec.openapi || embeddedSpec.swagger || embeddedSpec.paths)) {
            return { kind: 'inline-spec', spec: embeddedSpec };
        }
    }

    // 4. RapiDoc (<rapi-doc spec-url="...">)
    const rapidocUrl = htmlOrJs.match(/<rapi-doc[^>]*\bspec-url=["']([^"']+)["']/i);
    if (rapidocUrl?.[1]) {
        return { kind: 'spec-url', url: decodeHtmlAttr(rapidocUrl[1].trim()) };
    }

    // 5. Embedded Swagger UI / swagger-ui-init.js inline spec ("swaggerDoc": {...} or spec: {...})
    const swaggerDocMatch = htmlOrJs.match(/"swaggerDoc"\s*:\s*\{/);
    if (swaggerDocMatch && swaggerDocMatch.index !== undefined) {
        const braceIdx = htmlOrJs.indexOf('{', swaggerDocMatch.index);
        const doc = extractBalancedJsonObject(htmlOrJs, braceIdx);
        if (doc && (doc['openapi'] || doc['swagger'] || doc['paths'])) {
            return { kind: 'inline-spec', spec: doc };
        }
    }
    const inlineSpecMatch = htmlOrJs.match(/\bspec\s*:\s*\{\s*"(?:openapi|swagger)"/);
    if (inlineSpecMatch && inlineSpecMatch.index !== undefined) {
        const braceIdx = htmlOrJs.indexOf('{', inlineSpecMatch.index);
        const doc = extractBalancedJsonObject(htmlOrJs, braceIdx);
        if (doc && (doc['openapi'] || doc['swagger'] || doc['paths'])) {
            return { kind: 'inline-spec', spec: doc };
        }
    }

    // 6. Standard Swagger UI URL patterns (.json / .yaml / .yml)
    const swaggerUrlMatch = htmlOrJs.match(/url\s*:\s*["']([^"']+)["']/)
        || htmlOrJs.match(/urls\s*:\s*\[\s*\{\s*url\s*:\s*["']([^"']+)["']/);
    if (swaggerUrlMatch?.[1]) {
        return { kind: 'spec-url', url: swaggerUrlMatch[1].trim() };
    }

    const parseMatch = htmlOrJs.match(/JSON\.parse\(\s*["']([^"']*)["']\s*\)/);
    if (parseMatch?.[1]) {
        try {
            const unescaped = parseMatch[1].replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
            const cfg = JSON.parse(unescaped);
            if (Array.isArray(cfg?.urls)) {
                const entry = cfg.urls.find((e: any) => typeof e?.url === 'string');
                if (entry?.url) return { kind: 'spec-url', url: entry.url };
            }
            if (typeof cfg?.url === 'string') return { kind: 'spec-url', url: cfg.url };
        } catch { }
    }

    const jsonUrlMatch = htmlOrJs.match(/(["'])(\/?[^"']+\.(?:json|ya?ml))\1/i);
    if (jsonUrlMatch?.[2] && !jsonUrlMatch[2].endsWith('package.json')) {
        return { kind: 'spec-url', url: jsonUrlMatch[2] };
    }

    // 7. Collect external initializer scripts (<script src="...">) + defaults
    const scriptSrcs = new Set<string>();
    const scriptTagRegex = /<script[^>]+src=["']([^"']+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptTagRegex.exec(htmlOrJs)) !== null) {
        const src = m[1].trim();
        if (/(swagger-ui-init|swagger-initializer|index)\.js/i.test(src)) {
            scriptSrcs.add(src);
        }
    }
    scriptSrcs.add('swagger-ui-init.js');
    scriptSrcs.add('swagger-initializer.js');
    scriptSrcs.add('index.js');

    return { kind: 'script-candidates', urls: Array.from(scriptSrcs) };
}

// ---------------------------------------------------------------------------
// OpenAPI / Swagger Request Builder (JSON or YAML)
// ---------------------------------------------------------------------------

export function isOpenApiSpec(data: any): boolean {
    return Boolean(
        data &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        (typeof data['openapi'] === 'string' || typeof data['swagger'] === 'string') &&
        data['paths'] &&
        typeof data['paths'] === 'object'
    );
}

function resolveOpenApiRef(ref: string, root: Record<string, any>): any {
    if (!ref || typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
    const parts = ref.slice(2).split('/').map(p => decodeURIComponent(p.replace(/~1/g, '/').replace(/~0/g, '~')));
    let cur: any = root;
    for (const part of parts) {
        if (!cur || typeof cur !== 'object' || !(part in cur)) return undefined;
        cur = cur[part];
    }
    return cur;
}

function extractOpenApiExampleFromSchema(schema: any, root: Record<string, any>, depth = 0): any {
    if (!schema || typeof schema !== 'object' || depth > 6) return null;
    if (schema.allOf && Array.isArray(schema.allOf)) {
        let merged: any = {};
        for (const sub of schema.allOf) {
            const subVal = extractOpenApiExampleFromSchema(sub, root, depth + 1);
            if (subVal && typeof subVal === 'object' && !Array.isArray(subVal)) {
                merged = { ...merged, ...subVal };
            } else if (subVal !== undefined && subVal !== null) {
                merged = subVal;
            }
        }
        return merged;
    }
    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        return extractOpenApiExampleFromSchema(schema.anyOf[0], root, depth + 1);
    }
    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
        return extractOpenApiExampleFromSchema(schema.oneOf[0], root, depth + 1);
    }
    if (typeof schema.$ref === 'string') {
        const resolved = resolveOpenApiRef(schema.$ref, root);
        return extractOpenApiExampleFromSchema(resolved, root, depth + 1);
    }
    if (schema.example !== undefined) return schema.example;
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
    if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
        const obj: Record<string, any> = {};
        for (const [k, v] of Object.entries(schema.properties || {})) {
            obj[k] = extractOpenApiExampleFromSchema(v, root, depth + 1);
        }
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
            obj['additionalProp1'] = extractOpenApiExampleFromSchema(schema.additionalProperties, root, depth + 1);
        }
        return obj;
    }
    if (schema.type === 'array') {
        return [extractOpenApiExampleFromSchema(schema.items || {}, root, depth + 1)];
    }
    if (schema.type === 'boolean') return false;
    if (schema.type === 'integer' || schema.type === 'number') return 0;
    if (schema.type === 'string') return schema.format === 'date-time' ? new Date().toISOString() : '';
    return '';
}

function resolveOpenApiExampleValue(source: any, root: Record<string, any>): any {
    if (!source || typeof source !== 'object') return undefined;
    if (typeof source.$ref === 'string') {
        return resolveOpenApiExampleValue(resolveOpenApiRef(source.$ref, root), root);
    }
    if (source.example !== undefined) return source.example;
    if (source.default !== undefined) return source.default;
    if (source.examples && typeof source.examples === 'object') {
        const first: any = Object.values(source.examples).find((ex: any) => ex && typeof ex === 'object' && 'value' in ex);
        if (first) return first.value;
    }
    if (source.schema && typeof source.schema === 'object') {
        return extractOpenApiExampleFromSchema(source.schema, root);
    }
    if (source.type === 'object' || source.properties) {
        return extractOpenApiExampleFromSchema(source, root);
    }
    return undefined;
}

export function extractServiceBaseFromDocUrl(indexUrl: string): string {
    const trimmed = (indexUrl || '').trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) return '';
    try {
        const parsed = new URL(trimmed);
        let pathname = parsed.pathname;
        const patterns = [
            /\/swagger\/index\.html\/?$/i,
            /\/swagger\/v\d+\/swagger\.(?:json|ya?ml)\/?$/i,
            /\/swagger\/index\.(?:json|ya?ml)\/?$/i,
            /\/swagger\/[a-zA-Z0-9_.-]+\.(?:json|ya?ml)\/?$/i,
            /\/v\d+\/swagger\.(?:json|ya?ml)\/?$/i,
            /\/v\d+\/openapi\.(?:json|ya?ml)\/?$/i,
            /\/v3\/api-docs(?:\.ya?ml|\/[^/]+)?\/?$/i,
            /\/api-docs(?:\.ya?ml|\/[^/]+)?\/?$/i,
            /\/swagger\.(?:json|ya?ml)\/?$/i,
            /\/openapi\.(?:json|ya?ml)\/?$/i,
            /\/redoc(?:\/index\.html)?\/?$/i,
            /\/scalar(?:\/v\d+)?\/?$/i,
            /\/api-reference\/?$/i,
            /\/reference\/?$/i,
            /\/elements\/?$/i,
            /\/rapidoc\/?$/i,
            /\/docs\/(?:json|ya?ml)\/?$/i,
            /\/index\.html\/?$/i,
            /\/swagger\/?$/i,
            /\/docs\/?$/i
        ];
        for (const pattern of patterns) {
            if (pattern.test(pathname)) {
                pathname = pathname.replace(pattern, '');
                break;
            }
        }
        if (/\.(?:json|ya?ml)$/i.test(pathname)) {
            pathname = pathname.replace(/\/[^/]+\.(?:json|ya?ml)$/i, '');
        }
        pathname = pathname.replace(/\/+$/, '');
        return `${parsed.origin}${pathname}`;
    } catch {
        return '';
    }
}

export function buildOpenApiImportCollection(openApi: Record<string, any>, sourceUrl = ''): ParsedImportCollection {
    const collectionName = typeof openApi['info']?.title === 'string' && openApi['info'].title.trim()
        ? openApi['info'].title.trim()
        : 'OpenAPI Import';

    const serviceBase = extractServiceBaseFromDocUrl(sourceUrl);
    let baseServiceUrl = serviceBase;

    const servers = Array.isArray(openApi['servers']) ? openApi['servers'] : [];
    if (servers.length > 0 && typeof servers[0]?.url === 'string') {
        let serverUrl = servers[0].url.trim();
        if (serverUrl && servers[0].variables && typeof servers[0].variables === 'object') {
            for (const [k, def] of Object.entries(servers[0].variables)) {
                const v = (def as any)?.default ?? (Array.isArray((def as any)?.enum) ? (def as any).enum[0] : '');
                serverUrl = serverUrl.replaceAll(`{${k}}`, String(v ?? ''));
            }
        }
        if (!serverUrl || serverUrl === '/' || serverUrl === './') {
            baseServiceUrl = serviceBase || 'https://api.example.com';
        } else if (/^https?:\/\//i.test(serverUrl)) {
            try {
                const ps = new URL(serverUrl);
                if ((!ps.pathname || ps.pathname === '/') && serviceBase) {
                    const pb = new URL(serviceBase);
                    baseServiceUrl = (pb.pathname && pb.pathname !== '/')
                        ? `${ps.origin}${pb.pathname}`.replace(/\/+$/, '')
                        : serverUrl.replace(/\/+$/, '');
                } else {
                    baseServiceUrl = serverUrl.replace(/\/+$/, '');
                }
            } catch {
                baseServiceUrl = serverUrl.replace(/\/+$/, '');
            }
        } else if (serviceBase) {
            const rel = serverUrl.replace(/^\/+/, '').replace(/\/+$/, '');
            baseServiceUrl = serviceBase.endsWith(`/${rel}`) ? serviceBase : `${serviceBase}/${rel}`;
        } else {
            baseServiceUrl = serverUrl.replace(/\/+$/, '');
        }
    } else if (openApi['host']) {
        const scheme = (Array.isArray(openApi['schemes']) && openApi['schemes'][0]) || (serviceBase.startsWith('https') ? 'https' : 'http');
        const host = String(openApi['host']).trim().replace(/\/+$/, '');
        const basePath = typeof openApi['basePath'] === 'string' ? openApi['basePath'].trim().replace(/\/+$/, '') : '';
        baseServiceUrl = `${scheme}://${host}${basePath ? (basePath.startsWith('/') ? basePath : `/${basePath}`) : ''}`;
    }

    if (!baseServiceUrl) {
        baseServiceUrl = '{{baseUrl}}';
    }

    const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']);
    const paths = openApi['paths'] || {};
    const requests: (Partial<RequestState> & { __folderName?: string })[] = [];
    const groupsMap = new Map<string, Partial<RequestGroup>>();
    const explicitVars: IGlobalVariable[] = [];
    if (baseServiceUrl && !baseServiceUrl.startsWith('{{')) {
        explicitVars.push({ id: generateUUID().slice(0, 8), key: 'baseUrl', value: baseServiceUrl, type: 'global', enabled: true });
    }

    const isHeaderObjName = (n: string) =>
        ['headers', 'header', 'httpheaders', 'http_headers', 'customheaders', 'custom_headers', 'requestheaders', 'request_headers', 'x-headers'].includes((n || '').trim().toLowerCase());

    const formatScalar = (v: any) => v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));

    const extractJsonHeaderEntries = (rawHeaders: any): { enabled: boolean; key: string; value: string }[] => {
        if (!rawHeaders) return [];
        let target = rawHeaders;
        if (typeof target === 'string') {
            const tr = target.trim();
            if (!tr.startsWith('{') && !tr.startsWith('[')) return [];
            try { target = JSON.parse(tr); } catch { return []; }
        }
        if (target && typeof target === 'object' && target.$ref) {
            target = resolveOpenApiRef(target.$ref, openApi) || target;
        }
        if (Array.isArray(target)) {
            return target
                .filter((h: any) => h && (h.key || h.name))
                .map((h: any) => ({
                    enabled: h.enabled ?? true,
                    key: String(h.key || h.name),
                    value: formatScalar(h.value ?? h.example ?? resolveOpenApiExampleValue(h, openApi) ?? '')
                }));
        }
        if (target && typeof target === 'object') {
            const sourceObj = target.properties && typeof target.properties === 'object' ? target.properties : target;
            const out: { enabled: boolean; key: string; value: string }[] = [];
            for (const [k, v] of Object.entries(sourceObj)) {
                if (!k) continue;
                let resolved: any = v;
                if (resolved && typeof resolved === 'object' && !Array.isArray(resolved) &&
                    ('schema' in resolved || 'example' in resolved || 'default' in resolved || 'type' in resolved || '$ref' in resolved)) {
                    resolved = resolveOpenApiExampleValue(resolved, openApi) ?? '';
                }
                out.push({ enabled: true, key: k, value: formatScalar(resolved) });
            }
            return out;
        }
        return [];
    };

    for (const pathKey of Object.keys(paths)) {
        const pathObj = paths[pathKey];
        if (!pathObj || typeof pathObj !== 'object') continue;

        for (const methodKey of Object.keys(pathObj)) {
            if (!HTTP_METHODS.has(methodKey.toLowerCase())) continue;
            const operation = pathObj[methodKey];
            if (!operation || typeof operation !== 'object') continue;

            const method = methodKey.toUpperCase();
            const cleanTitle = cleanEndpointTitle({
                summary: typeof operation.summary === 'string' ? operation.summary : '',
                operationId: typeof operation.operationId === 'string' ? operation.operationId : '',
                method,
                path: pathKey
            });

            // Merge path-level and operation-level parameters
            const paramMap = new Map<string, any>();
            for (const list of [pathObj.parameters, operation.parameters]) {
                if (!Array.isArray(list)) continue;
                for (let p of list) {
                    if (p && typeof p === 'object' && typeof p.$ref === 'string') {
                        p = resolveOpenApiRef(p.$ref, openApi) || p;
                    }
                    if (p && typeof p === 'object' && p.in) {
                        const pName = p.name || (p.in === 'body' ? 'body' : '');
                        if (pName) paramMap.set(`${p.in}:${pName}`, p);
                    }
                }
            }
            const mergedParams = Array.from(paramMap.values());

            const queryParams: { enabled: boolean; key: string; value: string }[] = [];
            const headerParams: { enabled: boolean; key: string; value: string }[] = [];
            const pathParams: { enabled: boolean; key: string; value: string }[] = [];

            for (const p of mergedParams) {
                if (!p.name) continue;
                const resSchema = p.schema?.$ref ? (resolveOpenApiRef(p.schema.$ref, openApi) || p.schema) : p.schema;
                const exVal = resolveOpenApiExampleValue(p, openApi) ?? '';
                if (p.in === 'header') {
                    if (resSchema?.type === 'object' && resSchema?.properties) {
                        headerParams.push(...extractJsonHeaderEntries(resSchema));
                        continue;
                    }
                    if (exVal && typeof exVal === 'object' && !Array.isArray(exVal) && isHeaderObjName(String(p.name))) {
                        headerParams.push(...extractJsonHeaderEntries(exVal));
                        continue;
                    }
                    headerParams.push({ enabled: true, key: String(p.name), value: formatScalar(exVal) });
                } else if (p.in === 'query') {
                    queryParams.push({ enabled: true, key: String(p.name), value: formatScalar(exVal) });
                } else if (p.in === 'path') {
                    const entry = { enabled: true, key: String(p.name), value: formatScalar(exVal) };
                    pathParams.push(entry);
                    if (entry.key) {
                        explicitVars.push({ id: generateUUID().slice(0, 8), key: entry.key, value: entry.value || '', type: 'path', enabled: true });
                    }
                }
            }

            // Security headers
            const securityReqs = operation.security ?? openApi['security'];
            const schemes = openApi['components']?.securitySchemes || openApi['securityDefinitions'];
            const secHeaders: { enabled: boolean; key: string; value: string }[] = [];
            if (schemes && Array.isArray(securityReqs)) {
                for (const reqObj of securityReqs) {
                    if (!reqObj || typeof reqObj !== 'object') continue;
                    for (const schemeName of Object.keys(reqObj)) {
                        const s = schemes[schemeName];
                        if (!s || typeof s !== 'object') continue;
                        if (s.type === 'apiKey' && s.in === 'header' && s.name) {
                            secHeaders.push({ enabled: true, key: String(s.name), value: '' });
                        } else if (s.type === 'http' && String(s.scheme).toLowerCase() === 'bearer') {
                            secHeaders.push({ enabled: true, key: 'Authorization', value: 'Bearer {{token}}' });
                        }
                    }
                }
            }

            const dedupHeaders = new Map<string, { enabled: boolean; key: string; value: string }>();
            dedupHeaders.set('accept', { enabled: true, key: 'Accept', value: 'application/json' });
            for (const h of [
                ...headerParams,
                ...extractJsonHeaderEntries(pathObj['headers'] ?? pathObj['x-headers']),
                ...extractJsonHeaderEntries(operation['headers'] ?? operation['x-headers']),
                ...secHeaders
            ]) {
                if (h.key) dedupHeaders.set(h.key.toLowerCase(), h);
            }
            const headers = [...Array.from(dedupHeaders.values()), { enabled: true, key: '', value: '' }];
            const params = [...queryParams, { enabled: true, key: '', value: '' }];

            // Request body
            let bodySource = operation.requestBody;
            if (!bodySource) {
                bodySource = mergedParams.find(p => p.in === 'body');
            }
            if (bodySource && typeof bodySource.$ref === 'string') {
                bodySource = resolveOpenApiRef(bodySource.$ref, openApi) || bodySource;
            }

            let rawBody = '';
            if (bodySource && typeof bodySource === 'object') {
                let exampleBody: any = undefined;
                if (bodySource.content && typeof bodySource.content === 'object') {
                    const preferred = bodySource.content['application/json']
                        || bodySource.content['application/*+json']
                        || bodySource.content['text/json']
                        || Object.values(bodySource.content)[0];
                    if (preferred && typeof preferred === 'object') {
                        exampleBody = resolveOpenApiExampleValue(preferred, openApi);
                        if (exampleBody === undefined && preferred.schema) {
                            exampleBody = extractOpenApiExampleFromSchema(preferred.schema, openApi);
                        }
                    }
                } else if (bodySource.schema) {
                    exampleBody = resolveOpenApiExampleValue(bodySource, openApi);
                }
                if (exampleBody !== undefined) {
                    rawBody = typeof exampleBody === 'string' ? exampleBody : JSON.stringify(exampleBody, null, 2);
                }
            }

            const cleanBase = baseServiceUrl.trim().replace(/\/+$/, '');
            const cleanPath = pathKey.trim().replace(/^\/+/, '');
            let fullUrl = cleanBase ? (cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase) : `/${cleanPath}`;
            for (const pp of pathParams) {
                if (pp.key) {
                    fullUrl = fullUrl.replaceAll(`{${pp.key}}`, pp.value || `{${pp.key}}`);
                }
            }

            const requestId = generateUUID();
            const tagName = Array.isArray(operation.tags) && typeof operation.tags[0] === 'string'
                ? operation.tags[0].trim()
                : undefined;

            const reqObj: Partial<RequestState> & { __folderName?: string } = {
                id: requestId,
                name: cleanTitle,
                url: fullUrl,
                method,
                params,
                headers,
                bodyType: rawBody ? 'raw' : 'none',
                rawType: 'JSON',
                rawBody,
                rawBodyJson: rawBody,
                ...(tagName ? { __folderName: tagName } : {})
            };

            if (tagName) {
                let grp = groupsMap.get(tagName);
                if (!grp) {
                    grp = {
                        id: `grp_${generateUUID()}`,
                        name: tagName,
                        isExpanded: true,
                        requestIds: []
                    };
                    groupsMap.set(tagName, grp);
                }
                grp.requestIds!.push(requestId);
                reqObj.groupId = grp.id;
            }

            requests.push(reqObj);
        }
    }

    return {
        name: collectionName,
        requests,
        groups: Array.from(groupsMap.values()),
        variables: explicitVars
    };
}

// ---------------------------------------------------------------------------
// Insomnia v4 (resources) & v5 (YAML/JSON collection.insomnia.rest/5.0)
// ---------------------------------------------------------------------------

function normalizeInsomniaTemplateVars(input: any): string {
    if (input === null || input === undefined) return '';
    return String(input)
        .replace(/\{\{\s*_\.([A-Za-z0-9_.-]+)\s*\}\}/g, '{{$1}}')
        .replace(/\{\{\s*_\['([^']+)'\]\s*\}\}/g, '{{$1}}')
        .replace(/\{\{\s*_\["([^"]+)"\]\s*\}\}/g, '{{$1}}');
}

function mapInsomniaAuth(auth: any): any {
    if (!auth || typeof auth !== 'object' || auth.disabled) {
        return { type: 'none', token: '' };
    }
    if (auth.bearer && typeof auth.bearer === 'object') {
        return { type: 'bearer', token: normalizeInsomniaTemplateVars(auth.bearer.token || '') };
    }
    const t = String(auth.type || '').toLowerCase();
    if (t === 'bearer') {
        return { type: 'bearer', token: normalizeInsomniaTemplateVars(auth.token || '') };
    }
    if (t === 'basic') {
        return {
            type: 'basic',
            token: '',
            username: normalizeInsomniaTemplateVars(auth.username || ''),
            password: normalizeInsomniaTemplateVars(auth.password || '')
        };
    }
    if (t === 'apikey') {
        return {
            type: 'apikey',
            token: '',
            apiKeyName: auth.key || 'X-API-Key',
            apiKeyValue: normalizeInsomniaTemplateVars(auth.value || ''),
            apiKeyIn: auth.addTo === 'queryParams' ? 'query' : 'header'
        };
    }
    if (t === 'oauth2') {
        return {
            type: 'oauth2',
            token: '',
            oauth2: {
                grantType: auth.grantType || 'client_credentials',
                accessTokenUrl: normalizeInsomniaTemplateVars(auth.accessTokenUrl || ''),
                clientId: normalizeInsomniaTemplateVars(auth.clientId || ''),
                clientSecret: normalizeInsomniaTemplateVars(auth.clientSecret || ''),
                scope: normalizeInsomniaTemplateVars(auth.scope || ''),
                headerPrefix: auth.tokenPrefix || 'Bearer'
            }
        };
    }
    if (t === 'iam') {
        return {
            type: 'aws-sigv4',
            token: '',
            awsSigV4: {
                accessKey: normalizeInsomniaTemplateVars(auth.accessKeyId || ''),
                secretKey: normalizeInsomniaTemplateVars(auth.secretAccessKey || ''),
                region: normalizeInsomniaTemplateVars(auth.region || 'us-east-1'),
                service: normalizeInsomniaTemplateVars(auth.service || 'execute-api'),
                sessionToken: normalizeInsomniaTemplateVars(auth.sessionToken || '')
            }
        };
    }
    return { type: 'none', token: '' };
}

function mapInsomniaBody(body: any, fallbackMime?: string): Partial<RequestState> {
    if (!body || typeof body !== 'object') {
        return { bodyType: 'none', rawType: 'JSON', rawBody: '', rawBodyJson: '' };
    }
    const mime = String(body.mimeType || fallbackMime || '').toLowerCase();

    if (mime.includes('multipart/form-data') || Array.isArray(body.params) && mime.includes('multipart')) {
        const rows = (body.params || []).map((p: any) => ({
            enabled: !p.disabled,
            key: String(p.name || p.key || ''),
            value: normalizeInsomniaTemplateVars(p.value || ''),
            type: (p.type === 'file' ? 'file' : 'text') as 'text' | 'file',
            ...(p.fileName ? { fileName: String(p.fileName) } : {})
        }));
        return {
            bodyType: 'form-data',
            formData: rows.length > 0 ? rows : [{ enabled: true, key: '', value: '', type: 'text' }]
        };
    }

    if (mime.includes('x-www-form-urlencoded') || (Array.isArray(body.params) && !body.text)) {
        const rows = (body.params || []).map((p: any) => ({
            enabled: !p.disabled,
            key: String(p.name || p.key || ''),
            value: normalizeInsomniaTemplateVars(p.value || '')
        }));
        return {
            bodyType: 'x-www-form-urlencoded',
            urlEncodedData: rows.length > 0 ? rows : [{ enabled: true, key: '', value: '' }]
        };
    }

    const text = normalizeInsomniaTemplateVars(body.text || '');
    if (mime.includes('graphql')) {
        try {
            const parsedGql = JSON.parse(text);
            return {
                bodyType: 'graphql',
                graphqlQuery: parsedGql.query || text,
                graphqlVariables: parsedGql.variables ? JSON.stringify(parsedGql.variables, null, 2) : '{\n  \n}'
            };
        } catch {
            return { bodyType: 'graphql', graphqlQuery: text, graphqlVariables: '{\n  \n}' };
        }
    }

    if (mime.includes('xml') || text.trim().startsWith('<')) {
        return { bodyType: 'raw', rawType: 'XML', rawBody: text, rawBodyXml: text };
    }
    if (mime.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        return { bodyType: 'raw', rawType: 'JSON', rawBody: text, rawBodyJson: text };
    }
    if (text) {
        return { bodyType: 'raw', rawType: 'Text', rawBody: text, rawBodyText: text };
    }
    return { bodyType: 'none', rawType: 'JSON', rawBody: '', rawBodyJson: '' };
}

export function isInsomniaExport(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    if (data._type === 'export' && Array.isArray(data.resources)) return true;
    const typeStr = String(data.type || '');
    if (/\.insomnia\.rest\//i.test(typeStr)) return true;
    if (data.meta && (Array.isArray(data.collection) || (Array.isArray(data.requests) && Array.isArray(data.environments)))) return true;
    return false;
}

export function parseInsomniaToCollections(data: any): ParsedImportCollection[] {
    // 1. Insomnia v4 Export Format (`_type: 'export'`, flat `resources: [...]`)
    if (data._type === 'export' && Array.isArray(data.resources)) {
        const resources = data.resources as any[];
        const workspaces = resources.filter(r => r._type === 'workspace');
        const folderById = new Map<string, any>();
        for (const r of resources) {
            if (r._type === 'request_group' && r._id) {
                folderById.set(String(r._id), r);
            }
        }

        const resolveFolderPath = (parentId: string | null | undefined): { path?: string; rootWorkspaceId?: string } => {
            const parts: string[] = [];
            let curId = parentId ? String(parentId) : '';
            const seen = new Set<string>();
            while (curId && !seen.has(curId)) {
                seen.add(curId);
                const folder = folderById.get(curId);
                if (!folder) {
                    return { path: parts.length ? parts.join(' / ') : undefined, rootWorkspaceId: curId };
                }
                if (folder.name) parts.unshift(String(folder.name));
                curId = folder.parentId ? String(folder.parentId) : '';
            }
            return { path: parts.length ? parts.join(' / ') : undefined };
        };

        const workspacesList = workspaces.length > 0 ? workspaces : [{ _id: '', name: 'Insomnia Collection' }];
        const collections: ParsedImportCollection[] = [];

        for (const ws of workspacesList) {
            const wsId = String(ws._id || '');
            const wsVars: IGlobalVariable[] = [];
            const varSeen = new Set<string>();

            const envResources = resources.filter(r =>
                r._type === 'environment' && (!wsId || !r.parentId || r.parentId === wsId || folderById.has(r.parentId))
            );
            for (const env of envResources) {
                if (env.data && typeof env.data === 'object') {
                    for (const [k, v] of Object.entries(env.data)) {
                        if (!k || varSeen.has(k.toLowerCase())) continue;
                        varSeen.add(k.toLowerCase());
                        wsVars.push({
                            id: generateUUID().slice(0, 8),
                            key: k,
                            value: typeof v === 'string' ? v : JSON.stringify(v ?? ''),
                            type: 'global',
                            enabled: true
                        });
                    }
                }
            }

            const reqResources = resources.filter(r => r._type === 'request' || r._type === 'grpc_request' || r._type === 'websocket_request');
            const mappedRequests: (Partial<RequestState> & { __folderName?: string })[] = [];

            for (const req of reqResources) {
                const { path: folderPath, rootWorkspaceId } = resolveFolderPath(req.parentId);
                if (workspaces.length > 1 && wsId && rootWorkspaceId && rootWorkspaceId !== wsId) continue;

                const method = (req.method || (req._type === 'grpc_request' ? 'POST' : 'GET')).toUpperCase();
                const url = normalizeInsomniaTemplateVars(req.url || '');
                const headers = Array.isArray(req.headers)
                    ? req.headers.map((h: any) => ({
                        enabled: !h.disabled,
                        key: String(h.name || h.key || ''),
                        value: normalizeInsomniaTemplateVars(h.value || '')
                    }))
                    : [];
                const params = Array.isArray(req.parameters)
                    ? req.parameters.map((p: any) => ({
                        enabled: !p.disabled,
                        key: String(p.name || p.key || ''),
                        value: normalizeInsomniaTemplateVars(p.value || '')
                    }))
                    : [];

                const bodyPart = mapInsomniaBody(req.body, req.body?.mimeType);
                const auth = mapInsomniaAuth(req.authentication);
                const cleanName = cleanEndpointTitle({ name: req.name, method, path: url });

                mappedRequests.push({
                    id: generateUUID(),
                    name: cleanName,
                    url,
                    method,
                    headers: headers.length ? headers : [{ enabled: true, key: '', value: '' }],
                    params: params.length ? params : [{ enabled: true, key: '', value: '' }],
                    ...bodyPart,
                    auth,
                    scripts: {
                        preRequest: req.preRequestScript || '',
                        postResponse: req.afterResponseScript || '',
                        preRequestConsole: '',
                        postResponseConsole: '',
                        encryptionConsole: '',
                        testScript: '',
                        testScriptEnabled: false
                    },
                    ...(folderPath ? { __folderName: folderPath } : {})
                });
            }

            if (mappedRequests.length > 0 || workspacesList.length === 1) {
                collections.push({
                    name: ws.name || 'Insomnia Import',
                    requests: mappedRequests,
                    variables: wsVars
                });
            }
        }

        return collections;
    }

    // 2. Insomnia v5 Format (`type: collection.insomnia.rest/5.0` or nested tree)
    const collName = data.name || 'Insomnia v5 Collection';
    const vars: IGlobalVariable[] = [];
    const seenVarKeys = new Set<string>();

    const addEnvMap = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
            if (!k || seenVarKeys.has(k.toLowerCase())) continue;
            seenVarKeys.add(k.toLowerCase());
            vars.push({
                id: generateUUID().slice(0, 8),
                key: k,
                value: typeof v === 'string' ? v : JSON.stringify(v ?? ''),
                type: 'global',
                enabled: true
            });
        }
    };

    const rawEnvs = data.environments;
    if (Array.isArray(rawEnvs)) {
        for (const envEntry of rawEnvs) {
            if (!envEntry || typeof envEntry !== 'object') continue;
            if (envEntry.data || envEntry.value) {
                addEnvMap(envEntry.data || envEntry.value);
            } else {
                const subEntries = Object.values(envEntry);
                for (const sub of subEntries) {
                    if (sub && typeof sub === 'object') {
                        addEnvMap((sub as any).data || (sub as any).value || sub);
                    }
                }
            }
        }
    } else if (rawEnvs && typeof rawEnvs === 'object') {
        addEnvMap(rawEnvs.data || rawEnvs);
    }

    const mappedRequests: (Partial<RequestState> & { __folderName?: string })[] = [];

    const walkV5Nodes = (nodes: any[], parentFolder?: string) => {
        if (!Array.isArray(nodes)) return;
        for (const rawNode of nodes) {
            if (!rawNode || typeof rawNode !== 'object') continue;

            // Handle keyed entry syntax e.g. `- Login User: { method: POST, url: ... }`
            let nodeName = rawNode.name;
            let node = rawNode;
            if (!node.method && !node.url && !Array.isArray(node.children) && !Array.isArray(node.requests)) {
                const keys = Object.keys(rawNode);
                if (keys.length === 1 && rawNode[keys[0]] && typeof rawNode[keys[0]] === 'object') {
                    nodeName = keys[0];
                    node = rawNode[keys[0]];
                }
            }

            const children = node.children || node.requests;
            if (Array.isArray(children) && !node.url) {
                const nextFolder = nodeName ? (parentFolder ? `${parentFolder} / ${nodeName}` : String(nodeName)) : parentFolder;
                walkV5Nodes(children, nextFolder);
                continue;
            }

            if (node.url !== undefined || node.method !== undefined) {
                const method = String(node.method || 'GET').toUpperCase();
                const url = normalizeInsomniaTemplateVars(node.url || '');
                const rawHeaders = Array.isArray(node.headers) ? node.headers : [];
                const headers = rawHeaders.map((h: any) => ({
                    enabled: !h.disabled,
                    key: String(h.name || h.key || ''),
                    value: normalizeInsomniaTemplateVars(h.value || '')
                }));
                const rawParams = Array.isArray(node.parameters) ? node.parameters
                    : (Array.isArray(node.queryparams) ? node.queryparams : []);
                const params = rawParams.map((p: any) => ({
                    enabled: !p.disabled,
                    key: String(p.name || p.key || ''),
                    value: normalizeInsomniaTemplateVars(p.value || '')
                }));

                const bodyPart = mapInsomniaBody(node.body);
                const auth = mapInsomniaAuth(node.authentication);
                const scriptsObj = node.scripts || {};
                const cleanName = cleanEndpointTitle({ name: nodeName || node.name, method, path: url });

                mappedRequests.push({
                    id: generateUUID(),
                    name: cleanName,
                    url,
                    method,
                    headers: headers.length ? headers : [{ enabled: true, key: '', value: '' }],
                    params: params.length ? params : [{ enabled: true, key: '', value: '' }],
                    ...bodyPart,
                    auth,
                    scripts: {
                        preRequest: scriptsObj.preRequest || node.preRequestScript || '',
                        postResponse: scriptsObj.afterResponse || node.afterResponseScript || '',
                        preRequestConsole: '',
                        postResponseConsole: '',
                        encryptionConsole: '',
                        testScript: '',
                        testScriptEnabled: false
                    },
                    ...(parentFolder ? { __folderName: parentFolder } : {})
                });
            }
        }
    };

    if (Array.isArray(data.collection)) walkV5Nodes(data.collection);
    if (Array.isArray(data.requests)) walkV5Nodes(data.requests);

    return [{ name: collName, requests: mappedRequests, variables: vars }];
}

// ---------------------------------------------------------------------------
// Thunder Client / Hoppscotch / Bruno / HAR / WADL / RAML Parsers
// ---------------------------------------------------------------------------

export function isThunderClientExport(data: any): boolean {
    return Boolean(
        data &&
        typeof data === 'object' &&
        (data.client === 'Thunder Client' || (typeof data.collectionName === 'string' && Array.isArray(data.requests)))
    );
}

export function parseThunderClientToCollection(data: any): ParsedImportCollection {
    const foldersMap = new Map<string, string>();
    if (Array.isArray(data.folders)) {
        for (const f of data.folders) {
            if (f?._id && f?.name) foldersMap.set(String(f._id), String(f.name));
        }
    }

    const requests: (Partial<RequestState> & { __folderName?: string })[] = (data.requests || []).map((r: any) => {
        const method = String(r.method || 'GET').toUpperCase();
        const url = String(r.url || '');
        const headers = Array.isArray(r.headers)
            ? r.headers.map((h: any) => ({ enabled: !h.isDisabled, key: String(h.name || ''), value: String(h.value || '') }))
            : [{ enabled: true, key: '', value: '' }];
        const params = Array.isArray(r.params)
            ? r.params.map((p: any) => ({ enabled: !p.isDisabled, key: String(p.name || ''), value: String(p.value || '') }))
            : [{ enabled: true, key: '', value: '' }];

        let bodyPart: Partial<RequestState> = { bodyType: 'none', rawType: 'JSON', rawBody: '', rawBodyJson: '' };
        if (r.body && typeof r.body === 'object') {
            const bType = String(r.body.type || '').toLowerCase();
            if (bType === 'json') {
                bodyPart = { bodyType: 'raw', rawType: 'JSON', rawBody: r.body.raw || '', rawBodyJson: r.body.raw || '' };
            } else if (bType === 'xml') {
                bodyPart = { bodyType: 'raw', rawType: 'XML', rawBody: r.body.raw || '', rawBodyXml: r.body.raw || '' };
            } else if (bType === 'text') {
                bodyPart = { bodyType: 'raw', rawType: 'Text', rawBody: r.body.raw || '', rawBodyText: r.body.raw || '' };
            } else if (bType === 'formdata' && Array.isArray(r.body.form)) {
                bodyPart = {
                    bodyType: 'form-data',
                    formData: r.body.form.map((f: any) => ({
                        enabled: !f.isDisabled,
                        key: String(f.name || ''),
                        value: String(f.value || ''),
                        type: 'text' as const
                    }))
                };
            } else if (bType === 'formencoded' && Array.isArray(r.body.form)) {
                bodyPart = {
                    bodyType: 'x-www-form-urlencoded',
                    urlEncodedData: r.body.form.map((f: any) => ({
                        enabled: !f.isDisabled,
                        key: String(f.name || ''),
                        value: String(f.value || '')
                    }))
                };
            } else if (bType === 'graphql' && r.body.graphql) {
                bodyPart = {
                    bodyType: 'graphql',
                    graphqlQuery: r.body.graphql.query || '',
                    graphqlVariables: r.body.graphql.variables || '{\n  \n}'
                };
            }
        }

        let auth: any = { type: 'none', token: '' };
        if (r.auth?.type === 'bearer') auth = { type: 'bearer', token: r.auth.bearer || '' };
        else if (r.auth?.type === 'basic') auth = { type: 'basic', token: '', username: r.auth.basic?.username || '', password: r.auth.basic?.password || '' };

        const folderName = r.containerId ? foldersMap.get(String(r.containerId)) : undefined;
        return {
            id: generateUUID(),
            name: cleanEndpointTitle({ name: r.name, method, path: url }),
            url,
            method,
            headers,
            params,
            ...bodyPart,
            auth,
            ...(folderName ? { __folderName: folderName } : {})
        };
    });

    return { name: data.collectionName || 'Thunder Client Collection', requests };
}

export function isHoppscotchExport(data: any): boolean {
    return Boolean(
        data &&
        typeof data === 'object' &&
        data.v !== undefined &&
        Array.isArray(data.folders) &&
        Array.isArray(data.requests)
    );
}

export function parseHoppscotchToCollection(data: any): ParsedImportCollection {
    const out: (Partial<RequestState> & { __folderName?: string })[] = [];

    const mapReq = (r: any, folderName?: string) => {
        const method = String(r.method || 'GET').toUpperCase();
        const url = String(r.endpoint || r.url || '');
        const headers = Array.isArray(r.headers)
            ? r.headers.map((h: any) => ({ enabled: h.active !== false, key: String(h.key || ''), value: String(h.value || '') }))
            : [{ enabled: true, key: '', value: '' }];
        const params = Array.isArray(r.params)
            ? r.params.map((p: any) => ({ enabled: p.active !== false, key: String(p.key || ''), value: String(p.value || '') }))
            : [{ enabled: true, key: '', value: '' }];

        const ct = String(r.body?.contentType || '').toLowerCase();
        const rawText = typeof r.body?.body === 'string' ? r.body.body : '';
        let bodyPart: Partial<RequestState> = { bodyType: 'none', rawType: 'JSON', rawBody: '' };
        if (rawText) {
            if (ct.includes('xml')) bodyPart = { bodyType: 'raw', rawType: 'XML', rawBody: rawText, rawBodyXml: rawText };
            else if (ct.includes('json')) bodyPart = { bodyType: 'raw', rawType: 'JSON', rawBody: rawText, rawBodyJson: rawText };
            else bodyPart = { bodyType: 'raw', rawType: 'Text', rawBody: rawText, rawBodyText: rawText };
        }

        let auth: any = { type: 'none', token: '' };
        if (r.auth?.authType === 'bearer') auth = { type: 'bearer', token: r.auth.token || '' };
        else if (r.auth?.authType === 'basic') auth = { type: 'basic', token: '', username: r.auth.username || '', password: r.auth.password || '' };

        out.push({
            id: generateUUID(),
            name: cleanEndpointTitle({ name: r.name, method, path: url }),
            url,
            method,
            headers,
            params,
            ...bodyPart,
            auth,
            scripts: {
                preRequest: r.preRequestScript || '',
                postResponse: '',
                preRequestConsole: '',
                postResponseConsole: '',
                encryptionConsole: '',
                testScript: r.testScript || '',
                testScriptEnabled: Boolean(r.testScript)
            },
            ...(folderName ? { __folderName: folderName } : {})
        });
    };

    const walkFolders = (folders: any[], parent?: string) => {
        for (const f of folders || []) {
            const label = parent ? `${parent} / ${f.name}` : f.name;
            for (const req of f.requests || []) mapReq(req, label);
            if (Array.isArray(f.folders)) walkFolders(f.folders, label);
        }
    };

    for (const req of data.requests || []) mapReq(req);
    walkFolders(data.folders || []);

    return { name: data.name || 'Hoppscotch Collection', requests: out };
}

export function isBrunoCollectionExport(data: any): boolean {
    return Boolean(
        data &&
        typeof data === 'object' &&
        Array.isArray(data.items) &&
        data.items.some((i: any) => i && (i.type === 'http-request' || i.type === 'graphql-request' || i.type === 'folder'))
    );
}

export function parseBrunoToCollection(data: any): ParsedImportCollection {
    const out: (Partial<RequestState> & { __folderName?: string })[] = [];
    const vars: IGlobalVariable[] = [];

    for (const env of data.environments || []) {
        for (const v of env?.variables || []) {
            if (v?.name && v.enabled !== false) {
                vars.push({ id: generateUUID().slice(0, 8), key: String(v.name), value: String(v.value ?? ''), type: 'global', enabled: true });
            }
        }
    }

    const walkItems = (items: any[], folder?: string) => {
        for (const it of items || []) {
            if (!it) continue;
            if (it.type === 'folder' && Array.isArray(it.items)) {
                const label = folder ? `${folder} / ${it.name}` : it.name;
                walkItems(it.items, label);
                continue;
            }
            const req = it.request || {};
            const method = String(req.method || 'GET').toUpperCase();
            const url = String(req.url || '');
            const headers = Array.isArray(req.headers)
                ? req.headers.map((h: any) => ({ enabled: h.enabled !== false, key: String(h.name || ''), value: String(h.value || '') }))
                : [{ enabled: true, key: '', value: '' }];
            const params = Array.isArray(req.params)
                ? req.params.filter((p: any) => !p.type || p.type === 'query').map((p: any) => ({ enabled: p.enabled !== false, key: String(p.name || ''), value: String(p.value || '') }))
                : [{ enabled: true, key: '', value: '' }];

            let bodyPart: Partial<RequestState> = { bodyType: 'none', rawType: 'JSON', rawBody: '' };
            const b = req.body;
            if (b && typeof b === 'object') {
                if (b.mode === 'json' && b.json) bodyPart = { bodyType: 'raw', rawType: 'JSON', rawBody: b.json, rawBodyJson: b.json };
                else if (b.mode === 'xml' && b.xml) bodyPart = { bodyType: 'raw', rawType: 'XML', rawBody: b.xml, rawBodyXml: b.xml };
                else if (b.mode === 'text' && b.text) bodyPart = { bodyType: 'raw', rawType: 'Text', rawBody: b.text, rawBodyText: b.text };
                else if (b.mode === 'graphql' && b.graphql) bodyPart = { bodyType: 'graphql', graphqlQuery: b.graphql.query || '', graphqlVariables: b.graphql.variables || '{\n  \n}' };
                else if (b.mode === 'formUrlEncoded' && Array.isArray(b.formUrlEncoded)) {
                    bodyPart = {
                        bodyType: 'x-www-form-urlencoded',
                        urlEncodedData: b.formUrlEncoded.map((u: any) => ({ enabled: u.enabled !== false, key: String(u.name || ''), value: String(u.value || '') }))
                    };
                }
            }

            let auth: any = { type: 'none', token: '' };
            if (req.auth?.mode === 'bearer') auth = { type: 'bearer', token: req.auth.bearer?.token || '' };
            else if (req.auth?.mode === 'basic') auth = { type: 'basic', token: '', username: req.auth.basic?.username || '', password: req.auth.basic?.password || '' };

            out.push({
                id: generateUUID(),
                name: cleanEndpointTitle({ name: it.name, method, path: url }),
                url,
                method,
                headers,
                params,
                ...bodyPart,
                auth,
                ...(folder ? { __folderName: folder } : {})
            });
        }
    };

    walkItems(data.items || []);
    return { name: data.name || 'Bruno Collection', requests: out, variables: vars };
}

export function isHarExport(data: any): boolean {
    return Boolean(data && typeof data === 'object' && data.log && Array.isArray(data.log.entries));
}

export function parseHarToCollection(data: any, fileName = 'HAR Import'): ParsedImportCollection {
    const entries = (data.log?.entries || []) as any[];
    const staticAssetRx = /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|woff2?|ttf|eot|ico)(?:\?|$)/i;
    const apiEntries = entries.filter(e => e?.request?.url && !staticAssetRx.test(String(e.request.url)));
    const targetEntries = apiEntries.length > 0 ? apiEntries : entries;

    const requests: Partial<RequestState>[] = targetEntries
        .filter(e => e?.request?.url)
        .map(e => {
            const req = e.request;
            const method = String(req.method || 'GET').toUpperCase();
            const rawUrl = String(req.url || '');
            let cleanUrl = rawUrl;
            try {
                const u = new URL(rawUrl);
                cleanUrl = `${u.origin}${u.pathname}`;
            } catch { }

            const headers = (req.headers || [])
                .filter((h: any) => h?.name && !String(h.name).startsWith(':'))
                .map((h: any) => ({ enabled: true, key: String(h.name), value: String(h.value || '') }));
            const params = (req.queryString || [])
                .filter((p: any) => p?.name)
                .map((p: any) => ({ enabled: true, key: String(p.name), value: String(p.value || '') }));

            const postText = req.postData?.text || '';
            const mime = String(req.postData?.mimeType || '').toLowerCase();
            let bodyPart: Partial<RequestState> = { bodyType: 'none', rawType: 'JSON', rawBody: '' };
            if (Array.isArray(req.postData?.params) && req.postData.params.length > 0 && mime.includes('x-www-form-urlencoded')) {
                bodyPart = {
                    bodyType: 'x-www-form-urlencoded',
                    urlEncodedData: req.postData.params.map((p: any) => ({ enabled: true, key: String(p.name || ''), value: String(p.value || '') }))
                };
            } else if (postText) {
                if (mime.includes('xml') || postText.trim().startsWith('<')) bodyPart = { bodyType: 'raw', rawType: 'XML', rawBody: postText, rawBodyXml: postText };
                else if (mime.includes('json') || postText.trim().startsWith('{') || postText.trim().startsWith('[')) bodyPart = { bodyType: 'raw', rawType: 'JSON', rawBody: postText, rawBodyJson: postText };
                else bodyPart = { bodyType: 'raw', rawType: 'Text', rawBody: postText, rawBodyText: postText };
            }

            return {
                id: generateUUID(),
                name: cleanEndpointTitle({ method, path: cleanUrl }),
                url: cleanUrl,
                method,
                headers: headers.length ? headers : [{ enabled: true, key: '', value: '' }],
                params: params.length ? params : [{ enabled: true, key: '', value: '' }],
                ...bodyPart
            };
        });

    return { name: fileName.replace(/\.har$/i, '') || 'HAR Recording', requests };
}

export function isWadlXml(content: string): boolean {
    if (!content || typeof content !== 'string') return false;
    return /<(?:[a-z0-9_-]+:)?application\b/i.test(content) && /<(?:[a-z0-9_-]+:)?resources\b/i.test(content);
}

export function parseWadlToCollection(xml: string, fallbackName = 'WADL API'): ParsedImportCollection {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const resourcesEls = Array.from(doc.getElementsByTagName('*')).filter(el => el.localName === 'resources');
    const requests: Partial<RequestState>[] = [];

    const walkResource = (resEl: Element, baseUrl: string, parentPath: string) => {
        const ownPath = (resEl.getAttribute('path') || '').replace(/^\/+|\/+$/g, '');
        const fullRelPath = [parentPath.replace(/^\/+|\/+$/g, ''), ownPath].filter(Boolean).join('/');
        const fullUrl = fullRelPath ? `${baseUrl.replace(/\/+$/, '')}/${fullRelPath}` : baseUrl;

        const resourceParams = Array.from(resEl.children).filter(c => c.localName === 'param');
        const methodEls = Array.from(resEl.children).filter(c => c.localName === 'method');

        for (const mEl of methodEls) {
            const method = (mEl.getAttribute('name') || 'GET').toUpperCase();
            const opId = mEl.getAttribute('id') || '';
            const docEl = Array.from(mEl.children).find(c => c.localName === 'doc');
            const summary = docEl?.getAttribute('title') || docEl?.textContent?.trim() || '';

            const queryParams: { enabled: boolean; key: string; value: string }[] = [];
            const headerParams: { enabled: boolean; key: string; value: string }[] = [];

            const reqChild = Array.from(mEl.children).find(c => c.localName === 'request');
            const allParams = [
                ...resourceParams,
                ...(reqChild ? Array.from(reqChild.children).filter(c => c.localName === 'param') : [])
            ];
            for (const p of allParams) {
                const style = (p.getAttribute('style') || 'query').toLowerCase();
                const name = p.getAttribute('name') || '';
                const val = p.getAttribute('default') || '';
                if (!name) continue;
                if (style === 'header') headerParams.push({ enabled: true, key: name, value: val });
                else if (style === 'query') queryParams.push({ enabled: true, key: name, value: val });
            }

            requests.push({
                id: generateUUID(),
                name: cleanEndpointTitle({ summary, operationId: opId, method, path: `/${fullRelPath}` }),
                url: fullUrl,
                method,
                headers: headerParams.length ? headerParams : [{ enabled: true, key: '', value: '' }],
                params: queryParams.length ? queryParams : [{ enabled: true, key: '', value: '' }],
                bodyType: 'none',
                rawType: 'JSON'
            });
        }

        const nestedResources = Array.from(resEl.children).filter(c => c.localName === 'resource');
        for (const childRes of nestedResources) {
            walkResource(childRes, baseUrl, fullRelPath);
        }
    };

    for (const rGroup of resourcesEls) {
        const base = rGroup.getAttribute('base') || '{{baseUrl}}';
        for (const resEl of Array.from(rGroup.children).filter(c => c.localName === 'resource')) {
            walkResource(resEl, base, '');
        }
    }

    return { name: fallbackName.replace(/\.(wadl|xml)$/i, '') || 'WADL API', requests };
}

export function isRamlObject(data: any, rawText?: string): boolean {
    if (rawText && /^#%RAML\s+/i.test(rawText.trim())) return true;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    return typeof data['baseUri'] === 'string' && Object.keys(data).some(k => k.startsWith('/'));
}

export function parseRamlToCollection(data: any, fallbackName = 'RAML API'): ParsedImportCollection {
    const title = typeof data?.title === 'string' && data.title.trim() ? data.title.trim() : fallbackName;
    const baseUri = String(data?.baseUri || '{{baseUrl}}').replace(/\{version\}/g, String(data?.version || 'v1')).replace(/\/+$/, '');
    const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
    const requests: Partial<RequestState>[] = [];

    const walkRoutes = (node: Record<string, any>, prefixPath: string) => {
        for (const [k, v] of Object.entries(node)) {
            if (!v || typeof v !== 'object') continue;
            if (k.startsWith('/')) {
                walkRoutes(v, `${prefixPath}${k}`);
                continue;
            }
            if (HTTP_METHODS.has(k.toLowerCase())) {
                const method = k.toUpperCase();
                const fullUrl = `${baseUri}${prefixPath}`;
                const qParams: { enabled: boolean; key: string; value: string }[] = [];
                if (v.queryParameters && typeof v.queryParameters === 'object') {
                    for (const [pk, pv] of Object.entries<any>(v.queryParameters)) {
                        qParams.push({ enabled: true, key: pk, value: String(pv?.example ?? pv?.default ?? '') });
                    }
                }
                const hParams: { enabled: boolean; key: string; value: string }[] = [];
                if (v.headers && typeof v.headers === 'object') {
                    for (const [hk, hv] of Object.entries<any>(v.headers)) {
                        hParams.push({ enabled: true, key: hk, value: String(hv?.example ?? hv?.default ?? '') });
                    }
                }
                let rawBody = '';
                const jsonBody = v.body?.['application/json'] || v.body;
                if (jsonBody?.example !== undefined) {
                    rawBody = typeof jsonBody.example === 'string' ? jsonBody.example : JSON.stringify(jsonBody.example, null, 2);
                }

                requests.push({
                    id: generateUUID(),
                    name: cleanEndpointTitle({
                        summary: typeof v.displayName === 'string' ? v.displayName : (typeof v.description === 'string' ? v.description.split('\n')[0] : ''),
                        method,
                        path: prefixPath
                    }),
                    url: fullUrl,
                    method,
                    headers: hParams.length ? hParams : [{ enabled: true, key: '', value: '' }],
                    params: qParams.length ? qParams : [{ enabled: true, key: '', value: '' }],
                    bodyType: rawBody ? 'raw' : 'none',
                    rawType: 'JSON',
                    rawBody,
                    rawBodyJson: rawBody
                });
            }
        }
    };

    if (data && typeof data === 'object') {
        walkRoutes(data, '');
    }

    return { name: title, requests };
}
