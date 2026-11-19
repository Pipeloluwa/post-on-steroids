import { parseJsonSafe, sanitizeJsonBodyForScripts } from './format.utils';

interface JsonFrame {
  type: 'object' | 'array';
  segment: string | null;
  pendingKey: string | null;
  expectValue: boolean;
  index: number;
  expectElement: boolean;
}

/**
 * Single-pass O(N) scanner returning the dot/index path for each line of a JSON-like document.
 * Supports top-level objects, root arrays, list primitive items (`items.0`), and deeply nested
 * objects/arrays inside lists (`orders.0.items.1.pin`), as well as unquoted `{{var}}` tokens
 * and `//` or `/* *\/` comments.
 */
export function getAllJsonPathsByLine(lines: string[]): (string | null)[] {
  const result: (string | null)[] = new Array(lines.length).fill(null);
  const stack: JsonFrame[] = [];
  let inBlockComment = false;

  const getPrefix = (): string[] =>
    stack.map(f => f.segment).filter((s): s is string => s !== null && s !== '');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx] || '';
    const len = rawLine.length;
    let linePath: string | null = null;
    let i = 0;

    while (i < len) {
      if (inBlockComment) {
        const endIdx = rawLine.indexOf('*/', i);
        if (endIdx === -1) {
          i = len;
          break;
        }
        inBlockComment = false;
        i = endIdx + 2;
        continue;
      }

      const ch = rawLine[i];

      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      if (ch === '/' && rawLine[i + 1] === '/') {
        break;
      }

      if (ch === '/' && rawLine[i + 1] === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }

      const top = stack[stack.length - 1];

      if (ch === '"' || ch === "'") {
        const quote = ch;
        let j = i + 1;
        let strVal = '';
        while (j < len) {
          const c = rawLine[j];
          if (c === '\\' && j + 1 < len) {
            strVal += rawLine[j + 1];
            j += 2;
            continue;
          }
          if (c === quote) {
            j++;
            break;
          }
          strVal += c;
          j++;
        }
        i = j;

        if (top && top.type === 'object' && !top.expectValue) {
          // Check if followed by ':' on this line (skipping whitespace)
          let k = i;
          while (k < len && /\s/.test(rawLine[k])) k++;
          if (rawLine[k] === ':') {
            top.pendingKey = strVal;
            if (linePath === null) {
              linePath = [...getPrefix(), strVal].join('.');
            }
          }
        } else if (top && top.type === 'object' && top.expectValue) {
          top.pendingKey = null;
          top.expectValue = false;
        } else if (top && top.type === 'array' && top.expectElement) {
          if (linePath === null) {
            linePath = [...getPrefix(), String(top.index)].join('.');
          }
          top.expectElement = false;
        }
        continue;
      }

      if (ch === '{') {
        if (top && top.type === 'array') {
          const seg = String(top.index);
          top.expectElement = false;
          stack.push({ type: 'object', segment: seg, pendingKey: null, expectValue: false, index: 0, expectElement: false });
        } else if (top && top.type === 'object' && top.expectValue) {
          const seg = top.pendingKey;
          top.pendingKey = null;
          top.expectValue = false;
          stack.push({ type: 'object', segment: seg, pendingKey: null, expectValue: false, index: 0, expectElement: false });
        } else {
          stack.push({ type: 'object', segment: null, pendingKey: null, expectValue: false, index: 0, expectElement: false });
        }
        i++;
        continue;
      }

      if (ch === '[') {
        if (top && top.type === 'array') {
          const seg = String(top.index);
          top.expectElement = false;
          stack.push({ type: 'array', segment: seg, pendingKey: null, expectValue: false, index: 0, expectElement: true });
        } else if (top && top.type === 'object' && top.expectValue) {
          const seg = top.pendingKey;
          top.pendingKey = null;
          top.expectValue = false;
          stack.push({ type: 'array', segment: seg, pendingKey: null, expectValue: false, index: 0, expectElement: true });
        } else {
          stack.push({ type: 'array', segment: null, pendingKey: null, expectValue: false, index: 0, expectElement: true });
        }
        i++;
        continue;
      }

      if (ch === ':') {
        if (top && top.type === 'object' && top.pendingKey !== null) {
          top.expectValue = true;
        }
        i++;
        continue;
      }

      if (ch === ',') {
        if (top && top.type === 'array') {
          top.index++;
          top.expectElement = true;
        } else if (top && top.type === 'object') {
          top.pendingKey = null;
          top.expectValue = false;
        }
        i++;
        continue;
      }

      if (ch === '}' || ch === ']') {
        if (stack.length > 0) {
          stack.pop();
        }
        i++;
        continue;
      }

      // Unquoted token (number, boolean, null, {{var}}, $utility, or unquoted key)
      let token = '';
      if (rawLine[i] === '{' && rawLine[i + 1] === '{') {
        const close = rawLine.indexOf('}}', i + 2);
        if (close !== -1) {
          token = rawLine.slice(i, close + 2);
          i = close + 2;
        }
      }
      if (!token) {
        let j = i;
        while (j < len && !/[\s,{}[\]:"']/.test(rawLine[j])) {
          j++;
        }
        token = rawLine.slice(i, j);
        i = j > i ? j : i + 1;
      }

      if (top && top.type === 'object' && !top.expectValue && token) {
        let k = i;
        while (k < len && /\s/.test(rawLine[k])) k++;
        if (rawLine[k] === ':') {
          top.pendingKey = token;
          if (linePath === null) {
            linePath = [...getPrefix(), token].join('.');
          }
          continue;
        }
      }

      if (top && top.type === 'array' && top.expectElement && token) {
        if (linePath === null) {
          linePath = [...getPrefix(), String(top.index)].join('.');
        }
        top.expectElement = false;
      } else if (top && top.type === 'object' && top.expectValue) {
        top.pendingKey = null;
        top.expectValue = false;
      }
    }

    result[lineIdx] = linePath;
  }

  return result;
}

interface XmlCounterNode {
  tagName: string;
  childCounts: Map<string, number>;
  children: XmlCounterNode[];
}

/**
 * Single-pass XML path resolver supporting unique tag hierarchies (`Envelope.Body.ApiKey`)
 * as well as repeated sibling list elements (`Items.Item.0`, `Items.Item.0.Pin`, `Items.Item.1.Pin`).
 */
export function getAllXmlPathsByLine(lines: string[]): (string | null)[] {
  const result: (string | null)[] = new Array(lines.length).fill(null);

  // Pass 1: count child occurrences under every element node to know which tags repeat
  const rootCounter: XmlCounterNode = { tagName: '__root__', childCounts: new Map(), children: [] };
  const countStack: XmlCounterNode[] = [rootCounter];
  const nodeByTagOpenSeq: XmlCounterNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] || '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '__CDATA__').trim();
    if (!l || l.startsWith('<!--') || l.startsWith('<?')) continue;
    const tagMatches = Array.from(l.matchAll(/<\/?([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?(\/?)>/g));
    for (const m of tagMatches) {
      const full = m[0];
      const tagName = m[1];
      if (tagName.startsWith('?') || tagName.startsWith('!')) continue;
      const isClosing = full.startsWith('</');
      const isSelfClosing = m[2] === '/' || full.endsWith('/>') || full.endsWith('/ >');

      if (isClosing) {
        if (countStack.length > 1 && countStack[countStack.length - 1].tagName === tagName) {
          countStack.pop();
        }
      } else {
        const parent = countStack[countStack.length - 1];
        parent.childCounts.set(tagName, (parent.childCounts.get(tagName) || 0) + 1);
        const node: XmlCounterNode = { tagName, childCounts: new Map(), children: [] };
        parent.children.push(node);
        nodeByTagOpenSeq.push(node);
        if (!isSelfClosing) {
          countStack.push(node);
        }
      }
    }
  }

  // Pass 2: assign path for each line using total sibling counts
  interface XmlPathFrame {
    segment: string;
    tagName: string;
    node: XmlCounterNode;
    seenChildCounts: Map<string, number>;
  }

  const pathStack: XmlPathFrame[] = [
    { segment: '', tagName: '__root__', node: rootCounter, seenChildCounts: new Map() }
  ];
  let seqIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] || '';
    const l = rawLine.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '__CDATA__').trim();
    if (!l || l.startsWith('<!--') || l.startsWith('<?')) continue;

    let firstPathOnLine: string | null = null;
    const tagMatches = Array.from(l.matchAll(/<\/?([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?(\/?)>/g));

    for (const m of tagMatches) {
      const full = m[0];
      const tagName = m[1];
      if (tagName.startsWith('?') || tagName.startsWith('!')) continue;
      const isClosing = full.startsWith('</');
      const isSelfClosing = m[2] === '/' || full.endsWith('/>') || full.endsWith('/ >');

      if (isClosing) {
        if (pathStack.length > 1 && pathStack[pathStack.length - 1].tagName === tagName) {
          pathStack.pop();
        }
      } else {
        const parent = pathStack[pathStack.length - 1];
        const node = nodeByTagOpenSeq[seqIdx++] || { tagName, childCounts: new Map(), children: [] };
        const totalOfTag = parent.node.childCounts.get(tagName) || 1;
        const idx = parent.seenChildCounts.get(tagName) || 0;
        parent.seenChildCounts.set(tagName, idx + 1);

        const seg = totalOfTag > 1 ? `${tagName}.${idx}` : tagName;
        const parentSegments = pathStack.slice(1).map(f => f.segment);
        const fullPath = [...parentSegments, seg].join('.');

        if (firstPathOnLine === null) {
          firstPathOnLine = fullPath;
        }

        if (!isSelfClosing) {
          pathStack.push({ segment: seg, tagName, node, seenChildCounts: new Map() });
        }
      }
    }

    result[i] = firstPathOnLine;
  }

  return result;
}

/**
 * Checks if a JSON or XML path is protected either directly, by an ancestor container path,
 * or by an unqualified field name (never matching bare numeric list indices like "0" globally).
 */
export function resolvePathMatch(path: string, encryptedPaths: string[], autoEncrypt: boolean): boolean {
  if (autoEncrypt) return true;
  if (!path || !encryptedPaths || encryptedPaths.length === 0) return false;

  if (encryptedPaths.includes(path)) return true;

  for (const encPath of encryptedPaths) {
    if (!encPath) continue;
    if (path.startsWith(encPath + '.')) return true;
  }

  const lastPart = path.includes('.') ? path.split('.').pop()! : path;
  if (!/^\d+$/.test(lastPart) && encryptedPaths.includes(lastPart)) {
    return true;
  }

  return false;
}

/**
 * Collects all primitive leaf paths from a parsed JSON object/array, including numeric
 * array indices and nested objects within lists.
 */
export function getPrimitivePaths(obj: any, currentPath = ''): string[] {
  if (obj === null || typeof obj !== 'object') {
    return currentPath ? [currentPath] : [];
  }
  let paths: string[] = [];
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const p = currentPath ? `${currentPath}.${i}` : String(i);
      paths = paths.concat(getPrimitivePaths(obj[i], p));
    }
    return paths;
  }
  for (const key of Object.keys(obj)) {
    const p = currentPath ? `${currentPath}.${key}` : key;
    paths = paths.concat(getPrimitivePaths(obj[key], p));
  }
  return paths;
}

/**
 * Extracts all encryptable leaf paths for JSON or XML payloads.
 */
export function extractAllBodyLeafPaths(bodyStr: string, isXml: boolean): string[] {
  if (!bodyStr || !bodyStr.trim()) return [];
  if (isXml) {
    const lines = bodyStr.split(/\r?\n/);
    const allPaths = getAllXmlPathsByLine(lines);
    const leafPaths: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '__CDATA__').trim();
      const leafMatch = l.match(/<([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?>([^<]*)<\/\1>|<([a-zA-Z0-9_\-:]+)(?:\s+[^>]*)?\/>/);
      if (leafMatch && allPaths[i] && !leafPaths.includes(allPaths[i]!)) {
        leafPaths.push(allPaths[i]!);
      }
    }
    return leafPaths;
  }

  try {
    const bodyObj = parseJsonSafe(bodyStr);
    if (bodyObj !== null && typeof bodyObj === 'object') {
      const paths = getPrimitivePaths(bodyObj);
      if (paths.length > 0) return paths;
    }
  } catch {
    // Fall back to line-by-line scanner when JSON contains partial syntax or variables
  }

  const lines = bodyStr.split(/\r?\n/);
  const linePaths = getAllJsonPathsByLine(lines);
  const collected: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const p = linePaths[i];
    if (!p) continue;
    const trimmed = lines[i].trim();
    const isContainerOnlyOpen = /:\s*[\[{]\s*$/.test(trimmed);
    if (!isContainerOnlyOpen && !collected.includes(p)) {
      collected.push(p);
    }
  }
  return collected;
}

export interface PreparedEncryptionContext {
  bodyType: string;
  rawType: string;
  body: string;
  formData: Array<{ enabled: boolean; key: string; value: string; type: 'text' | 'file' }>;
  encryptedFormData: string[];
  urlEncodedData: Array<{ enabled: boolean; key: string; value: string }>;
  encryptedUrlEncodedData: string[];
  graphql: { query: string; variables: Record<string, any> };
  encryptedGraphqlPaths: string[];
  rawText: string;
  encryptRawText: boolean;
  encryptedBodyPaths: string[];
  autoEncryptBody: boolean;
  initialRawText: string;
  initialFormDataJson: string;
  initialUrlEncodedJson: string;
  initialGraphqlJson: string;
  initialBodyStr: string;
}

/**
 * Normalizes any request body type (`raw` JSON/XML/Text, `form-data`, `x-www-form-urlencoded`,
 * `graphql`) into a unified, regularized encryption execution context compatible with both legacy
 * 5-argument scripts and the extended multi-type script parameters.
 */
export function buildEncryptionPayloadContext(params: {
  bodyType: string;
  rawType: string;
  rawBodyJson?: string;
  rawBodyXml?: string;
  rawBodyText?: string;
  rawBody?: string;
  formData?: Array<{ enabled?: boolean; key: string; value: any; type?: 'text' | 'file' }>;
  urlEncodedData?: Array<{ enabled?: boolean; key: string; value: any }>;
  graphqlQuery?: string;
  graphqlVariables?: any;
  encryptedBodyPaths?: string[];
  autoEncryptBody?: boolean;
}): PreparedEncryptionContext {
  const bodyType = params.bodyType || 'none';
  const rawType = params.rawType || 'JSON';
  const isXml = rawType === 'XML' || rawType === 'XML (SOAP)' || rawType === 'SOAP';
  const isText = rawType === 'Text';
  const autoEncryptBody = !!params.autoEncryptBody;
  const rawSelectedPaths = [...(params.encryptedBodyPaths || [])];

  const resolvedFormData = bodyType === 'form-data'
    ? (params.formData || [])
        .filter(r => r && r.enabled !== false && r.key)
        .map(r => ({
          enabled: true,
          key: String(r.key),
          value: typeof r.value === 'string' ? r.value : String(r.value ?? ''),
          type: (r.type || 'text') as 'text' | 'file'
        }))
    : [];

  const resolvedUrlEncoded = bodyType === 'x-www-form-urlencoded'
    ? (params.urlEncodedData || [])
        .filter(r => r && r.enabled !== false && r.key)
        .map(r => ({
          enabled: true,
          key: String(r.key),
          value: typeof r.value === 'string' ? r.value : String(r.value ?? '')
        }))
    : [];

  let parsedGraphqlVars: Record<string, any> = {};
  if (bodyType === 'graphql') {
    if (params.graphqlVariables && typeof params.graphqlVariables === 'object') {
      parsedGraphqlVars = params.graphqlVariables;
    } else if (typeof params.graphqlVariables === 'string' && params.graphqlVariables.trim()) {
      try {
        const sanitizedVars = sanitizeJsonBodyForScripts(params.graphqlVariables);
        parsedGraphqlVars = JSON.parse(sanitizedVars || '{}') || {};
      } catch {
        parsedGraphqlVars = {};
      }
    }
  }

  const graphqlObj = bodyType === 'graphql'
    ? { query: params.graphqlQuery || '', variables: parsedGraphqlVars }
    : { query: '', variables: {} };

  const rawTextVal = (bodyType === 'raw' && isText) ? (params.rawBodyText ?? params.rawBody ?? '') : '';

  let bodyStr = '';
  let encPaths: string[] = [];
  let encryptedFormData: string[] = [];
  let encryptedUrlEncodedData: string[] = [];
  let encryptedGraphqlPaths: string[] = [];
  let encryptRawText = false;

  if (bodyType === 'raw') {
    if (isXml) {
      bodyStr = (params.rawBodyXml ?? params.rawBody ?? '').trim();
      encPaths = [...rawSelectedPaths];
      if (autoEncryptBody) {
        const xmlLeafs = extractAllBodyLeafPaths(bodyStr, true);
        encPaths = Array.from(new Set([...encPaths, ...xmlLeafs]));
      }
    } else if (isText) {
      bodyStr = rawTextVal;
      encryptRawText = autoEncryptBody || rawSelectedPaths.includes('__raw_text__');
      encPaths = encryptRawText ? ['__raw_text__'] : [];
    } else {
      const rawJson = params.rawBodyJson ?? params.rawBody ?? '{}';
      bodyStr = sanitizeJsonBodyForScripts(rawJson);
      encPaths = [...rawSelectedPaths];
      if (autoEncryptBody) {
        const jsonLeafs = extractAllBodyLeafPaths(bodyStr, false);
        encPaths = Array.from(new Set([...encPaths, ...jsonLeafs]));
      }
    }
  } else if (bodyType === 'form-data') {
    const activeTextKeys = resolvedFormData.filter(r => r.type !== 'file').map(r => r.key);
    encryptedFormData = autoEncryptBody
      ? Array.from(new Set([...activeTextKeys, ...rawSelectedPaths.filter(p => activeTextKeys.some(k => p === k || p.startsWith(k + '.')))]))
      : rawSelectedPaths.filter(p => activeTextKeys.some(k => p === k || p.startsWith(k + '.')));
    encPaths = [...encryptedFormData];

    const kvMap: Record<string, any> = {};
    for (const row of resolvedFormData) {
      if (row.type === 'file') continue;
      const hasNestedTarget = encryptedFormData.some(p => p.startsWith(row.key + '.'));
      let mapVal: any = row.value;
      if (hasNestedTarget) {
        try {
          mapVal = JSON.parse(sanitizeJsonBodyForScripts(row.value));
        } catch {
          mapVal = row.value;
        }
      }
      if (Object.prototype.hasOwnProperty.call(kvMap, row.key)) {
        kvMap[row.key] = Array.isArray(kvMap[row.key]) ? [...kvMap[row.key], mapVal] : [kvMap[row.key], mapVal];
      } else {
        kvMap[row.key] = mapVal;
      }
    }
    bodyStr = JSON.stringify(kvMap);
  } else if (bodyType === 'x-www-form-urlencoded') {
    const activeKeys = resolvedUrlEncoded.map(r => r.key);
    encryptedUrlEncodedData = autoEncryptBody
      ? Array.from(new Set([...activeKeys, ...rawSelectedPaths.filter(p => activeKeys.some(k => p === k || p.startsWith(k + '.')))]))
      : rawSelectedPaths.filter(p => activeKeys.some(k => p === k || p.startsWith(k + '.')));
    encPaths = [...encryptedUrlEncodedData];

    const kvMap: Record<string, any> = {};
    for (const row of resolvedUrlEncoded) {
      const hasNestedTarget = encryptedUrlEncodedData.some(p => p.startsWith(row.key + '.'));
      let mapVal: any = row.value;
      if (hasNestedTarget) {
        try {
          mapVal = JSON.parse(sanitizeJsonBodyForScripts(row.value));
        } catch {
          mapVal = row.value;
        }
      }
      if (Object.prototype.hasOwnProperty.call(kvMap, row.key)) {
        kvMap[row.key] = Array.isArray(kvMap[row.key]) ? [...kvMap[row.key], mapVal] : [kvMap[row.key], mapVal];
      } else {
        kvMap[row.key] = mapVal;
      }
    }
    bodyStr = JSON.stringify(kvMap);
  } else if (bodyType === 'graphql') {
    bodyStr = JSON.stringify(graphqlObj);
    const varLeafs = getPrimitivePaths(parsedGraphqlVars);
    const cleanedSelected = rawSelectedPaths.map(p => p.startsWith('variables.') ? p.slice('variables.'.length) : p);
    encryptedGraphqlPaths = autoEncryptBody
      ? Array.from(new Set([...cleanedSelected, ...varLeafs]))
      : cleanedSelected;
    // Map clean variable paths onto `variables.*` in `encryptedBodyPaths` so legacy `body` scripts also match
    encPaths = Array.from(new Set(
      encryptedGraphqlPaths.map(p => (p.startsWith('variables.') || p === 'query') ? p : `variables.${p}`)
    ));
  }

  return {
    bodyType,
    rawType,
    body: bodyStr,
    formData: resolvedFormData,
    encryptedFormData,
    urlEncodedData: resolvedUrlEncoded,
    encryptedUrlEncodedData,
    graphql: graphqlObj,
    encryptedGraphqlPaths,
    rawText: rawTextVal,
    encryptRawText,
    encryptedBodyPaths: encPaths,
    autoEncryptBody,
    initialRawText: rawTextVal,
    initialFormDataJson: JSON.stringify(resolvedFormData),
    initialUrlEncodedJson: JSON.stringify(resolvedUrlEncoded),
    initialGraphqlJson: JSON.stringify(graphqlObj),
    initialBodyStr: bodyStr
  };
}

/**
 * Reconciles mutations from an executed encryption script back into the proper outgoing body
 * representation for every request body type, supporting mutations via either `body` (legacy)
 * or dedicated type parameters (`formData`, `urlEncodedData`, `graphql`, `rawText`).
 */
export function reconcileEncryptionResult(
  prepared: PreparedEncryptionContext,
  encContextOut: any
): any {
  const { bodyType, rawType } = prepared;
  const isXml = rawType === 'XML' || rawType === 'XML (SOAP)' || rawType === 'SOAP';
  const isText = rawType === 'Text';

  if (bodyType === 'raw') {
    if (isText) {
      const outRawText = encContextOut?.rawText;
      if (outRawText !== undefined && outRawText !== prepared.initialRawText) {
        return typeof outRawText === 'string' ? outRawText : String(outRawText);
      }
      return encContextOut?.body != null ? String(encContextOut.body) : prepared.initialRawText;
    }
    if (isXml) {
      return encContextOut?.body != null ? String(encContextOut.body) : prepared.initialBodyStr;
    }
    const rawOut = encContextOut?.body != null ? encContextOut.body : prepared.initialBodyStr;
    if (typeof rawOut === 'object') return rawOut;
    try {
      return JSON.parse(String(rawOut));
    } catch {
      return rawOut;
    }
  }

  if (bodyType === 'form-data') {
    const outForm = encContextOut?.formData;
    if (Array.isArray(outForm) && JSON.stringify(outForm) !== prepared.initialFormDataJson) {
      return outForm.map((r: any) => ({
        ...r,
        value: typeof r.value === 'object' && r.value !== null ? JSON.stringify(r.value) : String(r.value ?? '')
      }));
    }
    return applyBodyMapToRows(prepared.formData, encContextOut?.body);
  }

  if (bodyType === 'x-www-form-urlencoded') {
    const outUrlEnc = encContextOut?.urlEncodedData;
    if (Array.isArray(outUrlEnc) && JSON.stringify(outUrlEnc) !== prepared.initialUrlEncodedJson) {
      return outUrlEnc.map((r: any) => ({
        ...r,
        value: typeof r.value === 'object' && r.value !== null ? JSON.stringify(r.value) : String(r.value ?? '')
      }));
    }
    return applyBodyMapToRows(prepared.urlEncodedData, encContextOut?.body);
  }

  if (bodyType === 'graphql') {
    const outGql = encContextOut?.graphql;
    if (outGql && typeof outGql === 'object' && JSON.stringify(outGql) !== prepared.initialGraphqlJson) {
      return {
        query: outGql.query ?? prepared.graphql.query,
        variables: typeof outGql.variables === 'string'
          ? safeParseObject(outGql.variables)
          : (outGql.variables ?? prepared.graphql.variables)
      };
    }
    const outBody = encContextOut?.body;
    if (outBody && typeof outBody === 'object') {
      if ('query' in outBody || 'variables' in outBody) {
        return outBody;
      }
      return { query: prepared.graphql.query, variables: outBody };
    }
    if (typeof outBody === 'string') {
      try {
        const parsed = JSON.parse(outBody);
        if (parsed && typeof parsed === 'object') {
          if ('query' in parsed || 'variables' in parsed) return parsed;
          return { query: prepared.graphql.query, variables: parsed };
        }
      } catch {
        // Fall through
      }
    }
    return prepared.graphql;
  }

  return encContextOut?.body ?? prepared.initialBodyStr;
}

function safeParseObject(val: string): Record<string, any> {
  try {
    return JSON.parse(val) || {};
  } catch {
    return {};
  }
}

function applyBodyMapToRows<T extends { key: string; value: any; type?: string }>(
  originalRows: T[],
  bodyOut: any
): T[] {
  if (bodyOut === null || bodyOut === undefined) return originalRows;

  let parsed = bodyOut;
  if (typeof bodyOut === 'string') {
    const trimmed = bodyOut.trim();
    if (!trimmed) return originalRows;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return originalRows;
    }
  }

  if (Array.isArray(parsed)) {
    return parsed.map((item: any, idx: number) => ({
      ...(originalRows[idx] || {}),
      ...item,
      value: typeof item?.value === 'object' && item.value !== null ? JSON.stringify(item.value) : String(item?.value ?? '')
    }));
  }

  if (typeof parsed === 'object') {
    const keyCounter = new Map<string, number>();
    return originalRows.map(row => {
      if (row.type === 'file') return row;
      if (!Object.prototype.hasOwnProperty.call(parsed, row.key)) return row;

      const candidate = parsed[row.key];
      let nextVal: any;
      if (Array.isArray(candidate)) {
        const idx = keyCounter.get(row.key) || 0;
        keyCounter.set(row.key, idx + 1);
        nextVal = idx < candidate.length ? candidate[idx] : candidate[0];
      } else {
        nextVal = candidate;
      }

      return {
        ...row,
        value: typeof nextVal === 'object' && nextVal !== null ? JSON.stringify(nextVal) : String(nextVal ?? '')
      };
    });
  }

  return originalRows;
}
