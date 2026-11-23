export interface JsonSchemaNode {
    $schema?: string;
    type?: string | string[];
    format?: string;
    description?: string;
    properties?: Record<string, JsonSchemaNode>;
    required?: string[];
    items?: JsonSchemaNode;
    additionalProperties?: boolean;
    nullable?: boolean;
}

export interface SchemaValidationError {
    path: string;
    message: string;
}

export interface SchemaValidationResult {
    valid: boolean;
    errors: SchemaValidationError[];
}

export interface ResponseDiffLine {
    type: 'same' | 'added' | 'removed';
    text: string;
    leftLine?: number;
    rightLine?: number;
}

export interface ResponseDiffResult {
    added: number;
    removed: number;
    unchanged: number;
    identical: boolean;
    lines: ResponseDiffLine[];
}

function detectStringFormat(val: string): string | undefined {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i.test(trimmed)) {
        return 'date-time';
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
        return 'uuid';
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'email';
    if (/^https?:\/\/[^\s]+$/i.test(trimmed)) return 'uri';
    return undefined;
}

function mergeTypes(a: string | string[] | undefined, b: string | string[] | undefined): string | string[] | undefined {
    const set = new Set<string>();
    const add = (t: string | string[] | undefined) => {
        if (!t) return;
        if (Array.isArray(t)) t.forEach(x => set.add(x));
        else set.add(t);
    };
    add(a);
    add(b);
    if (set.has('integer') && set.has('number')) {
        set.delete('integer');
    }
    const list = Array.from(set);
    if (list.length === 0) return undefined;
    return list.length === 1 ? list[0] : list;
}

function mergeSchemas(a: JsonSchemaNode, b: JsonSchemaNode): JsonSchemaNode {
    const mergedType = mergeTypes(a.type, b.type);
    const out: JsonSchemaNode = {};
    if (mergedType !== undefined) out.type = mergedType;

    if (a.format && a.format === b.format) {
        out.format = a.format;
    }

    if (a.properties || b.properties) {
        const props: Record<string, JsonSchemaNode> = {};
        const allKeys = new Set<string>([
            ...Object.keys(a.properties || {}),
            ...Object.keys(b.properties || {})
        ]);
        for (const k of allKeys) {
            const pa = a.properties?.[k];
            const pb = b.properties?.[k];
            if (pa && pb) props[k] = mergeSchemas(pa, pb);
            else if (pa) props[k] = { ...pa };
            else if (pb) props[k] = { ...pb };
        }
        out.properties = props;

        const reqA = new Set(a.required || []);
        const reqB = new Set(b.required || []);
        const req = Array.from(allKeys).filter(k => reqA.has(k) && reqB.has(k));
        if (req.length > 0) out.required = req;
    }

    if (a.items && b.items) {
        out.items = mergeSchemas(a.items, b.items);
    } else if (a.items || b.items) {
        out.items = a.items || b.items;
    }

    return out;
}

function inferNode(value: unknown, depth = 0): JsonSchemaNode {
    if (depth > 10) return {};
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return { type: 'array', items: {} };
        }
        let itemSchema = inferNode(value[0], depth + 1);
        for (let i = 1; i < Math.min(value.length, 200); i++) {
            itemSchema = mergeSchemas(itemSchema, inferNode(value[i], depth + 1));
        }
        return { type: 'array', items: itemSchema };
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        const properties: Record<string, JsonSchemaNode> = {};
        const required: string[] = [];
        for (const [k, v] of entries) {
            properties[k] = inferNode(v, depth + 1);
            if (v !== undefined) required.push(k);
        }
        return {
            type: 'object',
            properties,
            ...(required.length > 0 ? { required } : {})
        };
    }
    if (typeof value === 'number') {
        return { type: Number.isInteger(value) ? 'integer' : 'number' };
    }
    if (typeof value === 'boolean') {
        return { type: 'boolean' };
    }
    if (typeof value === 'string') {
        const format = detectStringFormat(value);
        return format ? { type: 'string', format } : { type: 'string' };
    }
    return {};
}

export function inferJsonSchema(value: unknown): JsonSchemaNode {
    const body = inferNode(value, 0);
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        ...body
    };
}

function matchesSingleType(val: unknown, expectedType: string): boolean {
    switch (expectedType) {
        case 'null': return val === null;
        case 'boolean': return typeof val === 'boolean';
        case 'integer': return typeof val === 'number' && Number.isInteger(val);
        case 'number': return typeof val === 'number' && Number.isFinite(val);
        case 'string': return typeof val === 'string';
        case 'array': return Array.isArray(val);
        case 'object': return val !== null && typeof val === 'object' && !Array.isArray(val);
        default: return true;
    }
}

export function validateAgainstJsonSchema(
    value: unknown,
    schema: any,
    path = '$',
    errors: SchemaValidationError[] = []
): SchemaValidationResult {
    if (!schema || typeof schema !== 'object') {
        return { valid: errors.length === 0, errors };
    }

    if (schema.type !== undefined) {
        const allowedTypes: string[] = Array.isArray(schema.type) ? schema.type : [String(schema.type)];
        if (schema.nullable === true && !allowedTypes.includes('null')) {
            allowedTypes.push('null');
        }
        const ok = allowedTypes.some(t => matchesSingleType(value, t));
        if (!ok) {
            const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
            errors.push({
                path,
                message: `Expected type ${allowedTypes.join(' | ')}, got ${actual}`
            });
            return { valid: false, errors };
        }
    }

    if (Array.isArray(schema.enum) && !schema.enum.some((e: unknown) => Object.is(e, value))) {
        errors.push({
            path,
            message: `Value ${JSON.stringify(value)} is not in enum [${schema.enum.map((e: unknown) => JSON.stringify(e)).join(', ')}]`
        });
    }

    if (typeof value === 'string') {
        if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
            errors.push({ path, message: `String length ${value.length} is less than minLength ${schema.minLength}` });
        }
        if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
            errors.push({ path, message: `String length ${value.length} exceeds maxLength ${schema.maxLength}` });
        }
    }

    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum) {
            errors.push({ path, message: `Value ${value} is less than minimum ${schema.minimum}` });
        }
        if (typeof schema.maximum === 'number' && value > schema.maximum) {
            errors.push({ path, message: `Value ${value} exceeds maximum ${schema.maximum}` });
        }
    }

    if (Array.isArray(value)) {
        if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
            errors.push({ path, message: `Array length ${value.length} is less than minItems ${schema.minItems}` });
        }
        if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
            errors.push({ path, message: `Array length ${value.length} exceeds maxItems ${schema.maxItems}` });
        }
        if (schema.items && typeof schema.items === 'object') {
            for (let i = 0; i < Math.min(value.length, 200); i++) {
                validateAgainstJsonSchema(value[i], schema.items, `${path}[${i}]`, errors);
                if (errors.length >= 100) break;
            }
        }
    } else if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (Array.isArray(schema.required)) {
            for (const reqKey of schema.required) {
                if (!(reqKey in obj)) {
                    errors.push({ path: `${path}.${reqKey}`, message: `Missing required property "${reqKey}"` });
                }
            }
        }
        if (schema.properties && typeof schema.properties === 'object') {
            for (const [k, propSchema] of Object.entries(schema.properties)) {
                if (k in obj) {
                    validateAgainstJsonSchema(obj[k], propSchema, `${path}.${k}`, errors);
                    if (errors.length >= 100) break;
                }
            }
            if (schema.additionalProperties === false) {
                for (const k of Object.keys(obj)) {
                    if (!(k in schema.properties)) {
                        errors.push({ path: `${path}.${k}`, message: `Unexpected additional property "${k}"` });
                    }
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

export function computeResponseLineDiff(expectedText: string, actualText: string): ResponseDiffResult {
    const leftLines = (expectedText ?? '').replace(/\r\n/g, '\n').split('\n');
    const rightLines = (actualText ?? '').replace(/\r\n/g, '\n').split('\n');

    // Guard against huge responses by capping LCS table at 600 lines per side
    const maxLcs = 600;
    if (leftLines.length > maxLcs || rightLines.length > maxLcs) {
        const out: ResponseDiffLine[] = [];
        const maxLen = Math.max(leftLines.length, rightLines.length);
        let added = 0;
        let removed = 0;
        let unchanged = 0;
        for (let i = 0; i < maxLen; i++) {
            const l = leftLines[i];
            const r = rightLines[i];
            if (l === r && l !== undefined) {
                unchanged++;
                out.push({ type: 'same', text: l, leftLine: i + 1, rightLine: i + 1 });
            } else {
                if (l !== undefined) {
                    removed++;
                    out.push({ type: 'removed', text: l, leftLine: i + 1 });
                }
                if (r !== undefined) {
                    added++;
                    out.push({ type: 'added', text: r, rightLine: i + 1 });
                }
            }
        }
        return { added, removed, unchanged, identical: added === 0 && removed === 0, lines: out };
    }

    const n = leftLines.length;
    const m = rightLines.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            if (leftLines[i] === rightLines[j]) {
                dp[i][j] = 1 + dp[i + 1][j + 1];
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    const lines: ResponseDiffLine[] = [];
    let i = 0;
    let j = 0;
    let added = 0;
    let removed = 0;
    let unchanged = 0;

    while (i < n && j < m) {
        if (leftLines[i] === rightLines[j]) {
            unchanged++;
            lines.push({ type: 'same', text: leftLines[i], leftLine: i + 1, rightLine: j + 1 });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            removed++;
            lines.push({ type: 'removed', text: leftLines[i], leftLine: i + 1 });
            i++;
        } else {
            added++;
            lines.push({ type: 'added', text: rightLines[j], rightLine: j + 1 });
            j++;
        }
    }
    while (i < n) {
        removed++;
        lines.push({ type: 'removed', text: leftLines[i], leftLine: i + 1 });
        i++;
    }
    while (j < m) {
        added++;
        lines.push({ type: 'added', text: rightLines[j], rightLine: j + 1 });
        j++;
    }

    return {
        added,
        removed,
        unchanged,
        identical: added === 0 && removed === 0,
        lines
    };
}
