import { IGlobalVariable } from '../../interfaces/services/IVariableService';
import { generateUUID } from './uuid.util';

/**
 * Strips whitespace, brackets, colons, and delimiters to get the raw variable key name.
 * e.g., "{{calendarId}}" -> "calendarId", ":ruleId" -> "ruleId", "{eventId}" -> "eventId"
 */
export function cleanVariableKey(rawKey: string): string {
    if (!rawKey) return '';
    let k = String(rawKey).trim();
    // Strip leading path/query delimiters if captured
    k = k.replace(/^[/?&=]+/, '');
    // Strip {{ and }}
    if (k.startsWith('{{') && k.endsWith('}}')) {
        k = k.substring(2, k.length - 2).trim();
    }
    // Strip leading :
    if (k.startsWith(':')) {
        k = k.substring(1).trim();
    }
    // Strip { and }
    if (k.startsWith('{') && k.endsWith('}')) {
        k = k.substring(1, k.length - 1).trim();
    }
    return k.trim();
}

/**
 * Normalizes a variable value, converting null/undefined/objects to strings
 * and avoiding self-referential placeholders like "{{key}}" or ":key".
 */
export function cleanVariableValue(rawVal: any, keyName?: string): string {
    if (rawVal === null || rawVal === undefined) return '';
    let strVal = '';
    if (typeof rawVal === 'string') {
        strVal = rawVal.trim();
    } else if (typeof rawVal === 'object') {
        try {
            strVal = JSON.stringify(rawVal);
        } catch {
            strVal = String(rawVal);
        }
    } else {
        strVal = String(rawVal).trim();
    }

    if (keyName) {
        const kLower = keyName.toLowerCase();
        if (strVal === `{{${keyName}}}` || strVal === `{{${kLower}}}` ||
            strVal === `:${keyName}` || strVal === `:${kLower}` ||
            strVal === `{${keyName}}` || strVal === `{${kLower}}`) {
            return '';
        }
    }

    return strVal;
}

/**
 * Extracts and consolidates all variables from a Postman collection JSON,
 * including collection-level variables, item/folder variables, request url.variable,
 * and tokens embedded inside URLs, headers, params, and bodies.
 */
export function extractPostmanVariables(collectionData: any): IGlobalVariable[] {
    const varMap = new Map<string, IGlobalVariable>();

    // 1. Collection-level variables
    if (Array.isArray(collectionData.variable)) {
        for (const v of collectionData.variable) {
            const key = cleanVariableKey(v.key);
            if (!key) continue;
            const val = cleanVariableValue(v.value, key);
            varMap.set(key.toLowerCase(), {
                id: generateUUID().substring(0, 7),
                key,
                value: val,
                type: v.type === 'path' ? 'path' : 'global',
                enabled: !v.disabled
            });
        }
    }

    // 2. Scan items recursively
    function scanItems(items: any[]) {
        if (!Array.isArray(items)) return;

        for (const item of items) {
            if (Array.isArray(item.item)) {
                scanItems(item.item);
            }

            // Folder/item level variables
            if (Array.isArray(item.variable)) {
                for (const v of item.variable) {
                    const key = cleanVariableKey(v.key);
                    if (!key) continue;
                    const lk = key.toLowerCase();
                    const val = cleanVariableValue(v.value, key);
                    if (!varMap.has(lk)) {
                        varMap.set(lk, {
                            id: generateUUID().substring(0, 7),
                            key,
                            value: val,
                            type: v.type === 'path' ? 'path' : 'global',
                            enabled: !v.disabled
                        });
                    } else if (val && !varMap.get(lk)!.value) {
                        varMap.get(lk)!.value = val;
                    }
                }
            }

            const req = item.request;
            if (!req) continue;

            // URL path variables defined in request.url.variable
            if (req.url && typeof req.url === 'object' && Array.isArray(req.url.variable)) {
                for (const pv of req.url.variable) {
                    const key = cleanVariableKey(pv.key);
                    if (!key) continue;
                    const lk = key.toLowerCase();
                    const val = cleanVariableValue(pv.value, key);
                    const existing = varMap.get(lk);

                    if (!existing) {
                        varMap.set(lk, {
                            id: generateUUID().substring(0, 7),
                            key,
                            value: val,
                            type: 'path',
                            enabled: !pv.disabled
                        });
                    } else {
                        // If existing was global and had no value or dummy value, or if this has a real value
                        if (!existing.value && val) {
                            existing.value = val;
                        }
                    }
                }
            }

            // Scan URL string (and structured host/path/query) for embedded variable patterns
            const rawUrl = typeof req === 'string'
                ? req
                : (typeof req.url === 'string'
                    ? req.url
                    : (req.url?.raw || [
                        Array.isArray(req.url?.host) ? req.url.host.join('.') : (req.url?.host || ''),
                        Array.isArray(req.url?.path) ? req.url.path.join('/') : (req.url?.path || '')
                    ].filter(Boolean).join('/')));
            scanTextForVariables(rawUrl, varMap, true);

            if (req.url && typeof req.url === 'object' && Array.isArray(req.url.query)) {
                for (const q of req.url.query) {
                    scanTextForVariables(q?.value, varMap, false);
                }
            }

            // Scan headers
            if (Array.isArray(req.header)) {
                for (const h of req.header) {
                    scanTextForVariables(h?.value, varMap, false);
                }
            }

            // Scan auth values
            if (req.auth && typeof req.auth === 'object') {
                for (const arr of [req.auth.bearer, req.auth.basic, req.auth.apikey]) {
                    if (Array.isArray(arr)) {
                        for (const entry of arr) {
                            scanTextForVariables(entry?.value, varMap, false);
                        }
                    }
                }
            }

            // Scan body across all Postman body modes
            if (req.body?.mode === 'raw' && req.body.raw) {
                scanTextForVariables(req.body.raw, varMap, false);
            }
            if (Array.isArray(req.body?.formdata)) {
                for (const fd of req.body.formdata) {
                    scanTextForVariables(fd?.value, varMap, false);
                }
            }
            if (Array.isArray(req.body?.urlencoded)) {
                for (const ue of req.body.urlencoded) {
                    scanTextForVariables(ue?.value, varMap, false);
                }
            }
            if (req.body?.graphql) {
                scanTextForVariables(req.body.graphql.query, varMap, false);
                scanTextForVariables(req.body.graphql.variables, varMap, false);
            }

            // Scan scripts & saved examples for global {{var}} references
            if (Array.isArray(item.event)) {
                for (const ev of item.event) {
                    const execStr = Array.isArray(ev?.script?.exec) ? ev.script.exec.join('\n') : ev?.script?.exec;
                    scanTextForVariables(execStr, varMap, false);
                }
            }
            if (Array.isArray(item.response)) {
                for (const resp of item.response) {
                    const orig = resp?.originalRequest;
                    if (orig) {
                        const origUrl = typeof orig.url === 'string' ? orig.url : orig.url?.raw;
                        scanTextForVariables(origUrl, varMap, false);
                        if (Array.isArray(orig.header)) {
                            for (const h of orig.header) scanTextForVariables(h?.value, varMap, false);
                        }
                        if (orig.body?.raw) scanTextForVariables(orig.body.raw, varMap, false);
                    }
                }
            }
        }
    }

    if (Array.isArray(collectionData.item)) {
        scanItems(collectionData.item);
    }

    return Array.from(varMap.values());
}

/**
 * Extracts and consolidates variables from generic request lists (OnSteroids capsules,
 * OpenAPI/Swagger operations, raw request arrays), incorporating any explicit variables.
 */
export function extractRequestsVariables(
    requests: any[],
    explicitVars?: any[],
    explicitVarSources?: Record<string, any>
): IGlobalVariable[] {
    const varMap = new Map<string, IGlobalVariable>();

    // 1. Register explicit variables
    if (Array.isArray(explicitVars)) {
        for (const v of explicitVars) {
            const rawKeyName = v.key || v.variableKey || '';
            if (String(rawKeyName).trim().startsWith('__')) continue;
            const key = cleanVariableKey(rawKeyName);
            if (!key) continue;
            const keyLower = key.toLowerCase();
            const val = cleanVariableValue(v.value !== undefined ? v.value : v.variableValue, key);
            const resolvedSource = v.source ?? (explicitVarSources ? explicitVarSources[keyLower] : undefined);
            varMap.set(keyLower, {
                id: v.id ? String(v.id) : generateUUID().substring(0, 7),
                key,
                value: val,
                type: v.type === 'path' ? 'path' : 'global',
                enabled: v.enabled !== undefined ? !!v.enabled : (v.isEnabled !== undefined ? !!v.isEnabled : true),
                ...(resolvedSource ? { source: structuredClone(resolvedSource) } : {})
            });
        }
    }

    // 2. Scan each request
    if (Array.isArray(requests)) {
        for (const req of requests) {
            if (!req) continue;
            scanTextForVariables(req.url, varMap, true);

            if (Array.isArray(req.headers)) {
                for (const h of req.headers) {
                    scanTextForVariables(h?.value, varMap, false);
                }
            }

            if (Array.isArray(req.params)) {
                for (const p of req.params) {
                    scanTextForVariables(p?.value, varMap, false);
                }
            }

            if (Array.isArray(req.formData)) {
                for (const fd of req.formData) {
                    scanTextForVariables(fd?.value, varMap, false);
                }
            }

            if (Array.isArray(req.urlEncodedData)) {
                for (const ue of req.urlEncodedData) {
                    scanTextForVariables(ue?.value, varMap, false);
                }
            }

            const rawBody = req.rawBodyJson || req.rawBody || req.rawBodyXml || req.rawBodyText;
            if (rawBody && typeof rawBody === 'string') {
                scanTextForVariables(rawBody, varMap, false);
            }
            if (req.graphqlQuery) scanTextForVariables(req.graphqlQuery, varMap, false);
            if (req.graphqlVariables) scanTextForVariables(req.graphqlVariables, varMap, false);
            if (req.auth?.token) scanTextForVariables(req.auth.token, varMap, false);
        }
    }

    return Array.from(varMap.values());
}

/**
 * Searches a string for {{key}}, :key (URL path params), and {key} variable references
 * and adds any unrepresented keys to the map.
 */
function scanTextForVariables(
    text: any,
    varMap: Map<string, IGlobalVariable>,
    includePathSyntax: boolean = false
): void {
    if (!text || typeof text !== 'string') return;

    // 1. Postman global syntax: {{varName}}
    const globalMatches = text.match(/\{\{([^}]+)\}\}/g);
    if (globalMatches) {
        for (const m of globalMatches) {
            const key = cleanVariableKey(m);
            if (key && !varMap.has(key.toLowerCase())) {
                varMap.set(key.toLowerCase(), {
                    id: generateUUID().substring(0, 7),
                    key,
                    value: '',
                    type: 'global',
                    enabled: true
                });
            }
        }
    }

    if (!includePathSyntax) return;

    // 2. Path parameter syntax: :varName (preceded by start, /, ?, &, or =)
    const pathMatches = text.match(/(?:^|[/?&=]):([a-zA-Z0-9_-]+)/g);
    if (pathMatches) {
        for (const m of pathMatches) {
            const key = cleanVariableKey(m);
            if (key && !varMap.has(key.toLowerCase())) {
                varMap.set(key.toLowerCase(), {
                    id: generateUUID().substring(0, 7),
                    key,
                    value: '',
                    type: 'path',
                    enabled: true
                });
            }
        }
    }

    // 3. OpenAPI / Swagger path parameter syntax: {varName}
    const swaggerMatches = text.match(/(?:^|[/?&=])\{([a-zA-Z0-9_-]+)\}/g);
    if (swaggerMatches) {
        for (const m of swaggerMatches) {
            const key = cleanVariableKey(m);
            if (key && !varMap.has(key.toLowerCase())) {
                varMap.set(key.toLowerCase(), {
                    id: generateUUID().substring(0, 7),
                    key,
                    value: '',
                    type: 'path',
                    enabled: true
                });
            }
        }
    }
}
