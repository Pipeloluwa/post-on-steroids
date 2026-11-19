export interface RegexMatchDetail {
    match: string;
    index: number;
    endIndex: number;
    groups: string[];
    namedGroups: Record<string, string>;
}

export interface RegexEvaluationResult {
    isValid: boolean | null;
    error: string;
    matches: RegexMatchDetail[];
    replacedText: string;
}

const VALID_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);

/**
 * Sanitizes a regex flags string to unique valid JavaScript RegExp flags,
 * resolving mutual exclusion between 'u' and 'v'.
 */
export function sanitizeRegexFlags(rawFlags: string): string {
    if (!rawFlags) return '';
    const seen = new Set<string>();
    for (const ch of rawFlags) {
        if (VALID_REGEX_FLAGS.has(ch)) {
            if (ch === 'v' && seen.has('u')) seen.delete('u');
            if (ch === 'u' && seen.has('v')) seen.delete('v');
            seen.add(ch);
        }
    }
    return Array.from(seen).join('');
}

/**
 * Evaluates a regular expression against input text and computes matches + replacement preview safely.
 */
export function evaluateRegex(
    pattern: string,
    rawFlags: string,
    input: string,
    replaceWith = '',
    maxMatches = 1000
): RegexEvaluationResult {
    if (!pattern) {
        return { isValid: null, error: '', matches: [], replacedText: input || '' };
    }

    const flags = sanitizeRegexFlags(rawFlags);
    let regex: RegExp;
    try {
        regex = new RegExp(pattern, flags);
    } catch (e) {
        return {
            isValid: false,
            error: e instanceof Error ? e.message : String(e),
            matches: [],
            replacedText: input || ''
        };
    }

    if (!input) {
        return { isValid: true, error: '', matches: [], replacedText: '' };
    }

    const matches: RegexMatchDetail[] = [];
    if (flags.includes('g') || flags.includes('y')) {
        const execRe = new RegExp(pattern, flags);
        let m: RegExpExecArray | null;
        let safety = 0;
        while ((m = execRe.exec(input)) !== null && safety < maxMatches) {
            const namedGroups: Record<string, string> = {};
            if (m.groups && typeof m.groups === 'object') {
                for (const [k, v] of Object.entries(m.groups)) {
                    namedGroups[k] = v ?? '';
                }
            }
            matches.push({
                match: m[0],
                index: m.index,
                endIndex: m.index + m[0].length,
                groups: m.slice(1).map(g => g ?? ''),
                namedGroups
            });
            if (m[0].length === 0) {
                if (execRe.lastIndex >= input.length) break;
                execRe.lastIndex++;
            }
            safety++;
        }
    } else {
        const m = regex.exec(input);
        if (m) {
            const namedGroups: Record<string, string> = {};
            if (m.groups && typeof m.groups === 'object') {
                for (const [k, v] of Object.entries(m.groups)) {
                    namedGroups[k] = v ?? '';
                }
            }
            matches.push({
                match: m[0],
                index: m.index,
                endIndex: m.index + m[0].length,
                groups: m.slice(1).map(g => g ?? ''),
                namedGroups
            });
        }
    }

    let replacedText = input;
    try {
        const replaceRe = new RegExp(pattern, flags);
        replacedText = input.replace(replaceRe, replaceWith);
    } catch {
        replacedText = input;
    }

    return {
        isValid: true,
        error: '',
        matches,
        replacedText
    };
}

/**
 * Formats a pattern and flags into a valid JavaScript RegExp literal `/pattern/flags`.
 */
export function formatRegexLiteral(pattern: string, flags: string): string {
    const safeFlags = sanitizeRegexFlags(flags);
    if (!pattern) return `/(?:)/${safeFlags}`;
    // Escape unescaped forward slashes (including consecutive //)
    const escaped = pattern.replace(/(?<!\\)(?:\\\\)*\//g, match => {
        return match.slice(0, -1) + '\\/';
    });
    return `/${escaped}/${safeFlags}`;
}

/**
 * Splits any identifier or phrase into words across camelCase, PascalCase, acronyms (XMLHttp),
 * numbers, spaces, hyphens, underscores, dots, and slashes.
 */
export function splitTextIntoWords(input: string): string[] {
    if (!input || !input.trim()) return [];
    const normalized = input
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/([A-Za-z])(\d)/g, '$1 $2')
        .replace(/(\d)([A-Za-z])/g, '$1 $2');
    return normalized
        .split(/[^A-Za-z0-9]+/)
        .map(w => w.trim())
        .filter(Boolean);
}

export interface AllTextCaseConversions {
    camel: string;
    pascal: string;
    snake: string;
    constant: string;
    kebab: string;
    dot: string;
    path: string;
    title: string;
    sentence: string;
    upper: string;
    lower: string;
}

export function convertAllTextCases(input: string): AllTextCaseConversions {
    const words = splitTextIntoWords(input);
    if (words.length === 0) {
        return {
            camel: '',
            pascal: '',
            snake: '',
            constant: '',
            kebab: '',
            dot: '',
            path: '',
            title: '',
            sentence: '',
            upper: input ? input.toUpperCase() : '',
            lower: input ? input.toLowerCase() : ''
        };
    }

    const lowerWords = words.map(w => w.toLowerCase());
    const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

    return {
        camel: lowerWords[0] + lowerWords.slice(1).map(cap).join(''),
        pascal: lowerWords.map(cap).join(''),
        snake: lowerWords.join('_'),
        constant: lowerWords.map(w => w.toUpperCase()).join('_'),
        kebab: lowerWords.join('-'),
        dot: lowerWords.join('.'),
        path: lowerWords.join('/'),
        title: lowerWords.map(cap).join(' '),
        sentence: cap(lowerWords[0]) + (lowerWords.length > 1 ? ' ' + lowerWords.slice(1).join(' ') : ''),
        upper: input.toUpperCase(),
        lower: input.toLowerCase()
    };
}

export interface NumberBaseConversionResult {
    isValid: boolean;
    error: string;
    binary: string;
    octal: string;
    decimal: string;
    hex: string;
    custom: string;
}

const BASE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Strictly validates and converts an integer string of arbitrary precision between bases 2..36 using BigInt.
 */
export function convertNumberBases(rawInput: string, fromBase: number, toBase: number): NumberBaseConversionResult {
    const empty: NumberBaseConversionResult = {
        isValid: false,
        error: '',
        binary: '',
        octal: '',
        decimal: '',
        hex: '',
        custom: ''
    };

    const trimmed = (rawInput || '').trim().replace(/[\s_]/g, '');
    if (!trimmed) return empty;

    if (!Number.isInteger(fromBase) || fromBase < 2 || fromBase > 36) {
        return { ...empty, error: 'From Base must be between 2 and 36' };
    }
    if (!Number.isInteger(toBase) || toBase < 2 || toBase > 36) {
        return { ...empty, error: 'To Base must be between 2 and 36' };
    }

    let sign = 1n;
    let body = trimmed;
    if (body.startsWith('-')) {
        sign = -1n;
        body = body.slice(1);
    } else if (body.startsWith('+')) {
        body = body.slice(1);
    }

    // Strip standard prefix if it matches fromBase
    if (fromBase === 16 && /^0x/i.test(body)) body = body.slice(2);
    else if (fromBase === 2 && /^0b/i.test(body)) body = body.slice(2);
    else if (fromBase === 8 && /^0o/i.test(body)) body = body.slice(2);

    if (!body) {
        return { ...empty, error: 'Please enter a valid number' };
    }

    const upper = body.toUpperCase();
    const bFrom = BigInt(fromBase);
    let acc = 0n;

    for (let i = 0; i < upper.length; i++) {
        const ch = upper[i];
        const digit = BASE_ALPHABET.indexOf(ch);
        if (digit === -1 || digit >= fromBase) {
            return {
                ...empty,
                error: `Invalid digit "${body[i]}" for base ${fromBase}`
            };
        }
        acc = acc * bFrom + BigInt(digit);
    }

    const value = acc * sign;
    const formatBigInt = (val: bigint, radix: number): string => {
        if (val === 0n) return '0';
        const isNeg = val < 0n;
        let n = isNeg ? -val : val;
        const b = BigInt(radix);
        let out = '';
        while (n > 0n) {
            const rem = Number(n % b);
            out = BASE_ALPHABET[rem] + out;
            n = n / b;
        }
        return isNeg ? '-' + out : out;
    };

    return {
        isValid: true,
        error: '',
        binary: formatBigInt(value, 2),
        octal: formatBigInt(value, 8),
        decimal: formatBigInt(value, 10),
        hex: formatBigInt(value, 16),
        custom: formatBigInt(value, toBase)
    };
}

/**
 * UTF-8 safe Base64 and Base64URL encoder/decoder.
 */
export function encodeBase64Utf8(input: string, urlSafe = false): string {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const b64 = btoa(binary);
    return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

export function decodeBase64Utf8(input: string): string {
    let b64 = (input || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
        b64 += '=';
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export interface JwtDecodeResult {
    isValid: boolean;
    error: string;
    headerJson: string;
    payloadJson: string;
    signature: string;
    headerObj: Record<string, any> | null;
    payloadObj: Record<string, any> | null;
    isExpired: boolean | null;
    expiresAt: string;
    issuedAt: string;
}

export function decodeJwtToken(rawToken: string, nowMs = Date.now()): JwtDecodeResult {
    const empty: JwtDecodeResult = {
        isValid: false,
        error: '',
        headerJson: '',
        payloadJson: '',
        signature: '',
        headerObj: null,
        payloadObj: null,
        isExpired: null,
        expiresAt: '',
        issuedAt: ''
    };

    const cleaned = (rawToken || '').trim().replace(/^Bearer\s+/i, '').trim();
    if (!cleaned) return empty;

    const parts = cleaned.split('.');
    if (parts.length < 2) {
        return { ...empty, error: 'Invalid JWT format — expected at least 2 dot-separated parts (header.payload)' };
    }

    let headerObj: Record<string, any>;
    let payloadObj: Record<string, any>;

    try {
        headerObj = JSON.parse(decodeBase64Utf8(parts[0]));
    } catch {
        return { ...empty, error: 'Failed to decode JWT header (invalid Base64URL or JSON)' };
    }

    try {
        payloadObj = JSON.parse(decodeBase64Utf8(parts[1]));
    } catch {
        return { ...empty, error: 'Failed to decode JWT payload (invalid Base64URL or JSON)' };
    }

    let isExpired: boolean | null = null;
    let expiresAt = '';
    let issuedAt = '';

    if (typeof payloadObj?.['exp'] === 'number') {
        const expMs = payloadObj['exp'] * 1000;
        isExpired = nowMs >= expMs;
        expiresAt = new Date(expMs).toISOString();
    }
    if (typeof payloadObj?.['iat'] === 'number') {
        issuedAt = new Date(payloadObj['iat'] * 1000).toISOString();
    }

    return {
        isValid: true,
        error: '',
        headerJson: JSON.stringify(headerObj, null, 2),
        payloadJson: JSON.stringify(payloadObj, null, 2),
        signature: parts[2] || '',
        headerObj,
        payloadObj,
        isExpired,
        expiresAt,
        issuedAt
    };
}

/**
 * Formats a Date into local YYYY-MM-DD for <input type="date"> (avoiding UTC shift from toISOString).
 */
export function formatLocalDateInput(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Formats a Date into local YYYY-MM-DDTHH:mm:ss for <input type="datetime-local"> (avoiding UTC shift).
 */
export function formatLocalDatetimeInput(date: Date): string {
    const datePart = formatLocalDateInput(date);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${datePart}T${hh}:${mm}:${ss}`;
}

export interface EpochConversionDetail {
    isValid: boolean;
    error: string;
    detectedUnit: 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds' | '';
    utcIso: string;
    localString: string;
    relative: string;
    epochMs: number;
    epochSec: number;
}

export function parseEpochInput(rawEpoch: string, nowMs = Date.now()): EpochConversionDetail {
    const empty: EpochConversionDetail = {
        isValid: false,
        error: '',
        detectedUnit: '',
        utcIso: '',
        localString: '',
        relative: '',
        epochMs: 0,
        epochSec: 0
    };

    const trimmed = (rawEpoch || '').trim();
    if (!trimmed) return empty;

    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
        return { ...empty, error: 'Invalid numeric timestamp' };
    }

    const absDigits = trimmed.replace(/^[-+]/, '').split('.')[0].length;
    let ms = num;
    let detectedUnit: EpochConversionDetail['detectedUnit'] = 'milliseconds';

    if (absDigits <= 10) {
        ms = num * 1000;
        detectedUnit = 'seconds';
    } else if (absDigits <= 13) {
        ms = num;
        detectedUnit = 'milliseconds';
    } else if (absDigits <= 16) {
        ms = Math.floor(num / 1000);
        detectedUnit = 'microseconds';
    } else {
        ms = Math.floor(num / 1_000_000);
        detectedUnit = 'nanoseconds';
    }

    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
        return { ...empty, error: 'Timestamp out of valid Date range' };
    }

    const diffSec = Math.round((ms - nowMs) / 1000);
    const absSec = Math.abs(diffSec);
    let relative = 'just now';
    if (absSec >= 1) {
        let unitLabel = `${absSec}s`;
        if (absSec >= 86400) unitLabel = `${Math.round(absSec / 86400)}d`;
        else if (absSec >= 3600) unitLabel = `${Math.round(absSec / 3600)}h`;
        else if (absSec >= 60) unitLabel = `${Math.round(absSec / 60)}m`;
        relative = diffSec < 0 ? `${unitLabel} ago` : `in ${unitLabel}`;
    }

    return {
        isValid: true,
        error: '',
        detectedUnit,
        utcIso: date.toISOString(),
        localString: date.toLocaleString(),
        relative,
        epochMs: Math.round(ms),
        epochSec: Math.floor(ms / 1000)
    };
}

/**
 * Safely renders Markdown to HTML by escaping raw HTML first (preventing XSS)
 * and only permitting http/https/mailto anchor URLs.
 */
export function renderSafeMarkdown(md: string): string {
    if (!md) return '';

    const escapeHtml = (s: string) =>
        s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    // Extract fenced code blocks before line processing so their contents aren't markdown-formatted
    const codeBlocks: string[] = [];
    const withPlaceholders = md.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (_m, _lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(`<pre class="md-code-block"><code>${escapeHtml(code)}</code></pre>`);
        return `@@CODEBLOCK_${idx}@@`;
    });

    let html = escapeHtml(withPlaceholders);

    // Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');

    // Headings
    html = html
        .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold & italic
    html = html
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>');

    // Blockquotes (note `>` was escaped to `&gt;`)
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

    // Safe links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, rawUrl: string) => {
        const trimmedUrl = rawUrl.trim();
        if (/^(https?:\/\/|mailto:|\/|#)/i.test(trimmedUrl)) {
            return `<a href="${trimmedUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }
        return label;
    });

    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^---$/gm, '<hr>');

    html = html.replace(/\r?\n\r?\n/g, '<br><br>').replace(/\r?\n/g, '<br>');
    html = html.replace(/((?:<li>.*?<\/li>(?:<br>)?)+)/g, '<ul>$1</ul>');
    html = html.replace(/<ul>([\s\S]*?)<\/ul>/g, (_m, inner: string) => '<ul>' + inner.replace(/<br>/g, '') + '</ul>');

    // Restore code blocks
    html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (_m, idxStr) => codeBlocks[Number(idxStr)] || '');

    return html;
}

/**
 * Recursively sorts object keys alphabetically for canonical JSON formatting.
 */
export function sortJsonKeysDeep(val: unknown): unknown {
    if (Array.isArray(val)) {
        return val.map(sortJsonKeysDeep);
    }
    if (val && typeof val === 'object') {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(val as Record<string, unknown>).sort()) {
            sorted[k] = sortJsonKeysDeep((val as Record<string, unknown>)[k]);
        }
        return sorted;
    }
    return val;
}
