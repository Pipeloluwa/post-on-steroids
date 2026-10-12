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

            // Scan URL string for embedded variable patterns
            const rawUrl = typeof req === 'string'
                ? req
                : (typeof req.url === 'string' ? req.url : (req.url?.raw || ''));
            scanTextForVariables(rawUrl, varMap);

            // Scan headers
            if (Array.isArray(req.header)) {
                for (const h of req.header) {
                    scanTextForVariables(h.value, varMap);
                }
            }

            // Scan body
            if (req.body?.mode === 'raw' && req.body.raw) {
                scanTextForVariables(req.body.raw, varMap);
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
export function extractRequestsVariables(requests: any[], explicitVars?: any[]): IGlobalVariable[] {
    const varMap = new Map<string, IGlobalVariable>();

    // 1. Register explicit variables
    if (Array.isArray(explicitVars)) {
        for (const v of explicitVars) {
            const key = cleanVariableKey(v.key || v.variableKey);
            if (!key) continue;
            const val = cleanVariableValue(v.value !== undefined ? v.value : v.variableValue, key);
            varMap.set(key.toLowerCase(), {
                id: v.id ? String(v.id) : generateUUID().substring(0, 7),
                key,
                value: val,
                type: v.type === 'path' ? 'path' : 'global',
                enabled: v.enabled !== undefined ? !!v.enabled : (v.isEnabled !== undefined ? !!v.isEnabled : true)
            });
        }
    }

    // 2. Scan each request
    if (Array.isArray(requests)) {
        for (const req of requests) {
            if (!req) continue;
            scanTextForVariables(req.url, varMap);

            if (Array.isArray(req.headers)) {
                for (const h of req.headers) {
                    scanTextForVariables(h?.value, varMap);
                }
            }

            if (Array.isArray(req.params)) {
                for (const p of req.params) {
                    scanTextForVariables(p?.value, varMap);
                }
            }

            const rawBody = req.rawBodyJson || req.rawBody || req.rawBodyXml;
            if (rawBody && typeof rawBody === 'string') {
                scanTextForVariables(rawBody, varMap);
            }
        }
    }

    return Array.from(varMap.values());
}

/**
 * Searches a string for {{key}}, :key, and {key} variable references
 * and adds any unrepresented keys to the map.
 */
function scanTextForVariables(text: any, varMap: Map<string, IGlobalVariable>): void {
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
