export type WrapStyle = 'pretty' | 'key-field' | 'word-wrap' | 'collapsed';

export interface WrapStyleOption {
  id: WrapStyle;
  label: string;
  icon: string;
}

export const WRAP_STYLE_OPTIONS: WrapStyleOption[] = [
  { id: 'pretty', label: 'Pretty: Indented multi-line', icon: 'format_align_left' },
  { id: 'key-field', label: 'Key-Field: One line per field', icon: 'segment' },
  { id: 'word-wrap', label: 'Soft Wrap: Wrap long lines to viewport', icon: 'wrap_text' },
  { id: 'collapsed', label: 'Single Line: Collapse all to one line', icon: 'density_small' },
];

export function formatBodyByStyle(content: any, style: WrapStyle, type: 'JSON' | 'XML' | string): string {
  if (content === null || content === undefined) return '';
  const upper = (type || '').toUpperCase();
  const isXml = upper === 'XML' || upper.includes('XML') || upper.includes('SOAP');
  const str = typeof content === 'string' ? content : JSON.stringify(content);

  if (style === 'collapsed') {
    return isXml ? formatXmlCollapsed(str) : formatJsonCollapsed(content);
  }

  if (style === 'key-field') {
    return isXml ? formatXmlByField(str) : formatJsonKeyField(content);
  }

  // 'pretty' and 'word-wrap' both format with clean multi-line indentation
  return isXml ? formatXmlPretty(str) : formatJsonPretty(content);
}

const UNQUOTED_VAR_OR_STRING_REGEX = /"(?:[^"\\]|\\.)*"|((?<=^|[\s,{[\]}:])(?:\/\/.*|\/\*[\s\S]*?\*\/))|(\{\{[^{}\r\n]*\}\}|\$(?:guid|timestamp|randomInt|randomUUID|randomEmail|randomName|randomWord|randomColor|randomCity|randomStreetAddress|randomPhoneNumber|randomBoolean|randomAlphaNumeric|randomIPv4)\b)/gi;

/**
 * Safely strips single-line (//) and multi-line (/* *\/) comments from a JSON-like string
 * without corrupting `/`, `//`, or `/*` sequences inside quoted string values or unquoted Base64 tokens.
 */
export function stripJsonCommentsSafe(content: string): string {
  if (!content) return '';
  return content.replace(/"(?:[^"\\]|\\.)*"|((?<=^|[\s,{[\]}:])(?:\/\*[\s\S]*?\*\/|\/\/.*))/g, (match, comment) => {
    return comment ? '' : match;
  });
}

/**
 * Sanitizes a JSON body string so that encrypted/Base64 values containing `/`, `//`, `/*`, `+`, `=`,
 * unquoted ciphertext values, multi-line wrapped strings, comments, or trailing commas can be safely
 * parsed by `JSON.parse` in both the Angular app and sandboxed encryption/decryption scripts.
 */
export function sanitizeJsonBodyForScripts(content: string): string {
  if (!content || typeof content !== 'string') return content || '';
  const trimmed = content.trim();
  if (!trimmed) return '';

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Proceed with sanitization
  }

  // 1. Strip comments outside of double-quoted strings (and not in the middle of an unquoted token)
  let s = stripJsonCommentsSafe(trimmed);

  // 2. Remove raw line breaks inside double-quoted strings (e.g. multi-line pasted Base64 ciphertext)
  s = s.replace(/"(?:[^"\\]|\\.)*"/g, (quoted) => {
    if (!quoted.includes('\n') && !quoted.includes('\r')) return quoted;
    return quoted.replace(/\r?\n\s*/g, '');
  });

  // 3. Convert single-quoted property values to valid double-quoted JSON strings
  s = s.replace(/"(?:[^"\\]|\\.)*"|(:\s*)'([^'\\]*(?:\\.[^'\\]*)*)'/g, (match, colonPrefix, singleInner) => {
    if (!colonPrefix) return match;
    const unescaped = singleInner.replace(/\\'/g, "'");
    return `${colonPrefix}${JSON.stringify(unescaped)}`;
  });

  // 4. Auto-quote unquoted property values (such as unquoted encrypted/Base64 strings with `/`, `+`, `=`)
  s = s.replace(
    /"(?:[^"\\]|\\.)*"|(:\s*)([^\s,"'{}\[\]][^,\r\n}\]]*?)(?=\s*(?:,|}|\]|\r|\n|$))/g,
    (match, colonPrefix, rawVal) => {
      if (!colonPrefix) return match;
      const val = rawVal.trim();
      if (!val) return match;
      if (val === 'true' || val === 'false' || val === 'null') return match;
      if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(val)) return match;
      return `${colonPrefix}${JSON.stringify(val)}`;
    }
  );

  // 5. Remove trailing commas before closing `}` or `]` outside of strings
  s = s.replace(/"(?:[^"\\]|\\.)*"|(,)\s*(?=[}\]])/g, (match, comma) => {
    return comma ? '' : match;
  });

  return s.trim();
}

export function parseJsonWithVariables(content: string): { parsed: any; restore: (formatted: string) => string } {
  const placeholders: string[] = [];
  const sanitized = content.replace(UNQUOTED_VAR_OR_STRING_REGEX, (match, comment, unquotedVar) => {
    if (comment) {
      return comment.replace(/[^\r\n]/g, ' ');
    }
    if (!unquotedVar) return match;
    const idx = placeholders.length;
    placeholders.push(unquotedVar);
    return `"__POS_VAR_PLACEHOLDER_${idx}__"`;
  });
  let parsed: any;
  try {
    parsed = JSON.parse(sanitized);
  } catch {
    parsed = JSON.parse(sanitizeJsonBodyForScripts(sanitized));
  }
  const restore = (formatted: string): string => {
    if (placeholders.length === 0) return formatted;
    return formatted.replace(/"__POS_VAR_PLACEHOLDER_(\d+)__"/g, (m, idxStr) => {
      const idx = parseInt(idxStr, 10);
      return placeholders[idx] ?? m;
    });
  };
  return { parsed, restore };
}

export function parseJsonSafe(content: any): any {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    try {
      return parseJsonWithVariables(content).parsed;
    } catch {
      return JSON.parse(sanitizeJsonBodyForScripts(content));
    }
  }
}

export function formatJsonPretty(content: any): string {
  try {
    if (typeof content === 'string') {
      const { parsed, restore } = parseJsonWithVariables(content);
      return restore(JSON.stringify(parsed, null, 2));
    }
    return JSON.stringify(content, null, 2);
  } catch {
    return typeof content === 'string' ? content : String(content);
  }
}

export function formatJsonKeyField(content: any): string {
  try {
    let parsed = content;
    let restore = (s: string) => s;
    if (typeof content === 'string') {
      const res = parseJsonWithVariables(content);
      parsed = res.parsed;
      restore = res.restore;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      if (Array.isArray(parsed)) {
        const items = parsed.map(item => '  ' + JSON.stringify(item));
        return restore('[\n' + items.join(',\n') + '\n]');
      }
      const entries = Object.entries(parsed);
      const lines = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
      return restore('{\n' + lines.join(',\n') + '\n}');
    }
    return restore(JSON.stringify(parsed));
  } catch {
    return typeof content === 'string' ? content : String(content);
  }
}

export function formatJsonCollapsed(content: any): string {
  try {
    if (typeof content === 'string') {
      const { parsed, restore } = parseJsonWithVariables(content);
      return restore(JSON.stringify(parsed));
    }
    return JSON.stringify(content);
  } catch {
    return typeof content === 'string'
      ? content.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim()
      : String(content);
  }
}

export function formatXmlPretty(xml: string): string {
  if (!xml || typeof xml !== 'string') return '';
  const trimmed = xml.trim();
  if (!trimmed) return '';

  try {
    const tokens = trimmed.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[^>]*\?>|<[^>]+>|[^<]+/g) || [];
    const PADDING = '  ';
    let pad = 0;
    const lines: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].trim();
      if (!token) continue;

      // XML Declaration <?xml ... ?> or comment <!-- ... --> or DOCTYPE
      if (token.startsWith('<?') || token.startsWith('<!')) {
        lines.push(PADDING.repeat(pad) + token);
        continue;
      }

      // Closing tag </tag>
      if (token.startsWith('</')) {
        if (pad > 0) pad--;
        lines.push(PADDING.repeat(pad) + token);
        continue;
      }

      // Self-closing tag <tag ... />
      if (token.startsWith('<') && (token.endsWith('/>') || token.endsWith('/ >'))) {
        lines.push(PADDING.repeat(pad) + token);
        continue;
      }

      // Opening tag <tag ...>
      if (token.startsWith('<')) {
        const next1 = i + 1 < tokens.length ? tokens[i + 1].trim() : '';
        const next2 = i + 2 < tokens.length ? tokens[i + 2].trim() : '';

        const tagNameMatch = token.match(/^<([a-zA-Z0-9_\-:]+)/);
        const tagName = tagNameMatch ? tagNameMatch[1] : '';

        if (tagName && next1 && (!next1.startsWith('<') || next1.startsWith('<![CDATA[')) && next2 === `</${tagName}>`) {
          // Compact single-line leaf node: <tag>text</tag> or <tag><![CDATA[text]]></tag>
          lines.push(PADDING.repeat(pad) + token + next1 + next2);
          i += 2;
          continue;
        }

        if (tagName && next1 === `</${tagName}>`) {
          lines.push(PADDING.repeat(pad) + token + next1);
          i += 1;
          continue;
        }

        // Parent opening tag
        lines.push(PADDING.repeat(pad) + token);
        pad++;
        continue;
      }

      // Bare text content
      lines.push(PADDING.repeat(pad) + token);
    }

    return lines.join('\n');
  } catch {
    return xml;
  }
}

export function formatXmlCollapsed(xml: string): string {
  if (!xml || typeof xml !== 'string') return '';
  return xml.replace(/>\s+</g, '><').replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatXmlByField(xml: string): string {
  if (!xml || typeof xml !== 'string') return '';
  const trimmed = xml.trim();
  if (!trimmed) return '';

  try {
    // Extract XML declaration if present
    let decl = '';
    let bodyContent = trimmed;
    const declMatch = bodyContent.match(/^<\?[^>]*\?>\s*/);
    if (declMatch) {
      decl = declMatch[0].trim() + '\n';
      bodyContent = bodyContent.slice(declMatch[0].length).trim();
    }

    // Parse root tag
    const rootOpenMatch = bodyContent.match(/^<([a-zA-Z0-9_\-:]+)([^>]*)>/);
    if (!rootOpenMatch) return formatXmlPretty(xml);

    const rootTag = rootOpenMatch[1];
    const rootCloseTag = `</${rootTag}>`;
    if (!bodyContent.endsWith(rootCloseTag)) return formatXmlPretty(xml);

    const rootOpen = rootOpenMatch[0];
    const innerContent = bodyContent.slice(rootOpen.length, bodyContent.length - rootCloseTag.length).trim();

    const children: string[] = [];
    let depth = 0;
    let currentChild = '';

    for (let i = 0; i < innerContent.length; i++) {
      const ch = innerContent[i];
      currentChild += ch;

      if (innerContent.slice(i, i + 9) === '<![CDATA[') {
        const endCdata = innerContent.indexOf(']]>', i + 9);
        if (endCdata !== -1) {
          currentChild += innerContent.slice(i + 1, endCdata + 3);
          i = endCdata + 2;
          continue;
        }
      }

      if (ch === '<') {
        if (innerContent[i + 1] === '/') {
          depth--;
        } else if (innerContent.slice(i, i + 4) === '<!--') {
          // comment
        } else if (innerContent[i + 1] !== '!' && innerContent[i + 1] !== '?') {
          depth++;
        }
      } else if (ch === '>') {
        if (innerContent[i - 1] === '/') {
          depth--;
        }
        if (depth === 0 && currentChild.trim()) {
          children.push(formatXmlCollapsed(currentChild.trim()));
          currentChild = '';
        }
      }
    }

    if (currentChild.trim()) {
      children.push(formatXmlCollapsed(currentChild.trim()));
    }

    if (children.length > 0) {
      return `${decl}${rootOpen}\n  ${children.join('\n  ')}\n${rootCloseTag}`;
    }

    return formatXmlPretty(xml);
  } catch {
    return xml;
  }
}

/**
 * Automatically extracts the SOAPAction operation URI from a SOAP XML envelope.
 * Supports:
 * 1. WS-Addressing <(?:w+:)?Action> in <soap:Header>
 * 2. Qualified operations <prefix:Operation> with prefix xmlns namespace in Envelope or element
 * 3. Unqualified operations <Operation xmlns="..."> with default namespace
 */
export function extractSoapActionFromXml(xml: string): string | null {
  if (!xml || typeof xml !== 'string') return null;
  try {
    // 1. WS-Addressing Action in Header
    const wsaMatch = xml.match(/<(?:\w+:)?Action[^>]*>([^<]+)<\/(?:\w+:)?Action>/i);
    if (wsaMatch && wsaMatch[1] && wsaMatch[1].trim()) {
      return wsaMatch[1].trim();
    }

    // 2. Locate the Body element
    const bodyMatch = xml.match(/<(?:\w+:)?Body[^>]*>([\s\S]*?)<\/(?:\w+:)?Body>/i);
    if (!bodyMatch || !bodyMatch[1]) return null;
    const bodyContent = bodyMatch[1].trim();

    // 3. Find first child element inside Body
    const firstTagMatch = bodyContent.match(/<([a-zA-Z0-9_\-]+(?::[a-zA-Z0-9_\-]+)?)([^>]*)>/);
    if (!firstTagMatch) return null;

    const fullTagName = firstTagMatch[1];
    const tagAttributes = firstTagMatch[2] || '';
    const parts = fullTagName.split(':');
    const prefix = parts.length > 1 ? parts[0] : null;
    const localName = parts.length > 1 ? parts[1] : parts[0];

    let nsUri: string | null = null;
    if (prefix) {
      const prefixNsRegex = new RegExp(`xmlns:${prefix}\\s*=\\s*["']([^"']+)["']`, 'i');
      const elemNsMatch = tagAttributes.match(prefixNsRegex);
      if (elemNsMatch && elemNsMatch[1]) {
        nsUri = elemNsMatch[1].trim();
      } else {
        const docNsMatch = xml.match(prefixNsRegex);
        if (docNsMatch && docNsMatch[1]) {
          nsUri = docNsMatch[1].trim();
        }
      }
    } else {
      const defaultNsMatch = tagAttributes.match(/xmlns\s*=\s*["']([^"']+)["']/i);
      if (defaultNsMatch && defaultNsMatch[1]) {
        nsUri = defaultNsMatch[1].trim();
      } else {
        const docDefNsMatch = xml.match(/<(?:\w+:)?Envelope[^>]*\sxmlns\s*=\s*["']([^"']+)["']/i);
        if (docDefNsMatch && docDefNsMatch[1]) {
          const candidateNs = docDefNsMatch[1].trim();
          const isSoapEnvNs =
            candidateNs.includes('schemas.xmlsoap.org/soap/envelope') ||
            candidateNs.includes('www.w3.org/2003/05/soap-envelope');
          if (!isSoapEnvNs) {
            nsUri = candidateNs;
          }
        }
      }
    }

    if (nsUri && localName) {
      const separator = (nsUri.endsWith('/') || nsUri.endsWith(':') || nsUri.endsWith('#')) ? '' : '/';
      return `${nsUri}${separator}${localName}`;
    } else if (localName) {
      return localName;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Pretty-formats GraphQL queries, mutations, subscriptions, and fragments with 2-space indentation.
 */
export function formatGraphqlPretty(gql: string): string {
  if (!gql || typeof gql !== 'string') return '';
  const trimmed = gql.trim();
  if (!trimmed) return '';

  try {
    const out: string[] = [];
    let indent = 0;
    let inString = false;
    let inBlockString = false;
    let inComment = false;
    let parenDepth = 0;
    let lineBuf = '';

    const pushLine = () => {
      const cleaned = lineBuf.trim();
      if (cleaned) {
        out.push('  '.repeat(Math.max(0, indent)) + cleaned);
      }
      lineBuf = '';
    };

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      const next3 = trimmed.slice(i, i + 3);

      if (inComment) {
        if (ch === '\n' || ch === '\r') {
          pushLine();
          inComment = false;
        } else {
          lineBuf += ch;
        }
        continue;
      }

      if (inBlockString) {
        lineBuf += ch;
        if (next3 === '"""') {
          lineBuf += '""';
          i += 2;
          inBlockString = false;
        }
        continue;
      }

      if (inString) {
        lineBuf += ch;
        if (ch === '\\' && i + 1 < trimmed.length) {
          lineBuf += trimmed[++i];
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (next3 === '"""') {
        lineBuf += '"""';
        i += 2;
        inBlockString = true;
        continue;
      }

      if (ch === '"') {
        lineBuf += ch;
        inString = true;
        continue;
      }

      if (ch === '#') {
        if (lineBuf.trim()) {
          lineBuf += ' ';
        }
        inComment = true;
        lineBuf += ch;
        continue;
      }

      if (ch === '(') {
        parenDepth++;
        lineBuf += ch;
        continue;
      }

      if (ch === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        lineBuf += ch;
        continue;
      }

      if (ch === '{' && parenDepth === 0) {
        const before = lineBuf.trim();
        lineBuf = before ? `${before} {` : '{';
        pushLine();
        indent++;
        continue;
      }

      if (ch === '}' && parenDepth === 0) {
        pushLine();
        indent = Math.max(0, indent - 1);
        out.push('  '.repeat(indent) + '}');
        continue;
      }

      if (ch === '\n' || ch === '\r') {
        if (parenDepth === 0) {
          pushLine();
        } else {
          lineBuf += ' ';
        }
        continue;
      }

      if (ch === ' ' || ch === '\t') {
        if (!lineBuf.endsWith(' ') && !lineBuf.endsWith('(')) {
          lineBuf += ' ';
        }
        continue;
      }

      lineBuf += ch;
    }

    pushLine();
    return out.join('\n').replace(/\{\s+\}/g, '{}').trim();
  } catch {
    return gql;
  }
}

/**
 * Expands single-line crammed JavaScript statements (e.g. `if(a){x=1;y=2;}`) onto separate lines
 * outside of string literals, regex literals, template literals, and `for (...)` headers.
 */
function expandCompactJsLines(source: string): string {
  let out = '';
  let quote: string | null = null;
  let parenDepth = 0;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += '/';
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < source.length) {
        out += source[++i];
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      out += '//';
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      out += '/*';
      i++;
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '(') {
      parenDepth++;
      out += ch;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      out += ch;
      continue;
    }

    if (ch === '{' && parenDepth === 0) {
      const restTrimmed = source.slice(i + 1).trimStart();
      if (restTrimmed.startsWith('}')) {
        out += '{}';
        i = source.indexOf('}', i + 1);
        continue;
      }
      out += '{\n';
      continue;
    }

    if (ch === '}' && parenDepth === 0) {
      if (!out.endsWith('\n')) out += '\n';
      out += '}';
      const after = source.slice(i + 1).trimStart();
      if (after && !after.startsWith('\n') && !/^(?:else|catch|finally|,|\)|;)/.test(after)) {
        out += '\n';
      }
      continue;
    }

    if (ch === ';' && parenDepth === 0) {
      out += ';';
      const rest = source.slice(i + 1);
      const nextNonSpaceIdx = rest.search(/\S/);
      if (nextNonSpaceIdx !== -1 && !rest.slice(0, nextNonSpaceIdx).includes('\n')) {
        const nextTwo = rest.slice(nextNonSpaceIdx, nextNonSpaceIdx + 2);
        if (nextTwo !== '//' && nextTwo !== '/*') {
          out += '\n';
        }
      }
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Formats JavaScript / TypeScript code with consistent 2-space indentation.
 * When `restrictToFunctionBody` is true, keeps leading import lines + outer function header/closing brace intact.
 */
export function formatJsPretty(code: string, restrictToFunctionBody = false): string {
  if (!code || typeof code !== 'string') return '';
  try {
    const rawLines = code.replace(/\r\n/g, '\n').split('\n');
    let startIdx = 0;
    let endIdx = rawLines.length - 1;
    const leadingPrefixLines: string[] = [];
    let prefixLine = '';
    let suffixLine = '';

    if (restrictToFunctionBody && rawLines.length >= 2) {
      let fnHeaderIdx = -1;
      for (let i = 0; i < rawLines.length; i++) {
        const t = rawLines[i].trim();
        if (!t || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || /^import\s+/.test(t) || /^const\s+\w+\s*=\s*require\(/.test(t)) {
          continue;
        }
        if (/^(?:async\s+)?function\s+\w+\s*\(.*\)\s*\{/.test(t)) {
          fnHeaderIdx = i;
        }
        break;
      }
      const lastTrim = rawLines[rawLines.length - 1].trim();
      if (fnHeaderIdx !== -1 && lastTrim === '}') {
        for (let k = 0; k < fnHeaderIdx; k++) {
          leadingPrefixLines.push(rawLines[k]);
        }
        prefixLine = rawLines[fnHeaderIdx];
        suffixLine = rawLines[rawLines.length - 1];
        startIdx = fnHeaderIdx + 1;
        endIdx = rawLines.length - 2;
      }
    }

    const bodySource = expandCompactJsLines(rawLines.slice(startIdx, endIdx + 1).join('\n'));
    const workLines = bodySource.split('\n');
    let braceDepth = restrictToFunctionBody && prefixLine ? 1 : 0;
    const formatted: string[] = [];
    let inBlockComment = false;

    for (let i = 0; i < workLines.length; i++) {
      const trimmed = workLines[i].trim();
      if (!trimmed) {
        if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
          formatted.push('');
        }
        continue;
      }

      if (inBlockComment) {
        formatted.push('  '.repeat(braceDepth) + trimmed);
        if (trimmed.includes('*/')) {
          inBlockComment = false;
        }
        continue;
      }

      // Count net brace change ignoring strings and comments
      let leadingClosers = 0;
      for (const ch of trimmed) {
        if (ch === '}' || ch === ']' || ch === ')') {
          leadingClosers++;
        } else {
          break;
        }
      }

      const effectiveDepth = Math.max(restrictToFunctionBody && prefixLine ? 1 : 0, braceDepth - leadingClosers);
      formatted.push('  '.repeat(effectiveDepth) + trimmed);

      // Strip strings, line comments, and inline block comments for depth tracking
      let sanitized = '';
      let quote: string | null = null;
      for (let j = 0; j < trimmed.length; j++) {
        const ch = trimmed[j];
        const next = trimmed[j + 1];
        if (quote) {
          if (ch === '\\') {
            j++;
            continue;
          }
          if (ch === quote) {
            quote = null;
          }
          continue;
        }
        if (ch === '/' && next === '/') break;
        if (ch === '/' && next === '*') {
          const endComment = trimmed.indexOf('*/', j + 2);
          if (endComment === -1) {
            inBlockComment = true;
            break;
          }
          j = endComment + 1;
          continue;
        }
        if (ch === '"' || ch === '\'' || ch === '`') {
          quote = ch;
          continue;
        }
        sanitized += ch;
      }

      for (const ch of sanitized) {
        if (ch === '{' || ch === '[' || ch === '(') braceDepth++;
        else if (ch === '}' || ch === ']' || ch === ')') {
          braceDepth = Math.max(restrictToFunctionBody && prefixLine ? 1 : 0, braceDepth - 1);
        }
      }
    }

    // Trim trailing blank lines inside body
    while (formatted.length > 0 && formatted[formatted.length - 1] === '') {
      formatted.pop();
    }

    if (restrictToFunctionBody && prefixLine) {
      return [...leadingPrefixLines, prefixLine, ...formatted, suffixLine].join('\n');
    }
    return formatted.join('\n');
  } catch {
    return code;
  }
}

/**
 * Formats Python scripts cleanly with 4-space indentation while preserving Python block indentation
 * (`def`, `if`, `elif`, `else`, `for`, `while`, `try`, `except`, `finally`, `with`) and blank lines.
 */
export function formatPythonPretty(code: string, _restrictToFunctionBody = false): string {
  if (!code || typeof code !== 'string') return '';
  try {
    const rawLines = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const formatted: string[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i].replace(/\t/g, '    ');
      const trimmed = raw.trim();
      if (!trimmed) {
        if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
          formatted.push('');
        }
        continue;
      }

      const leadingSpaces = (raw.match(/^[ ]*/) || [''])[0].length;
      const normalizedSpaces = Math.round(leadingSpaces / 4) * 4;
      formatted.push(' '.repeat(normalizedSpaces) + trimmed);
    }

    while (formatted.length > 0 && formatted[formatted.length - 1] === '') {
      formatted.pop();
    }
    return formatted.join('\n');
  } catch {
    return code;
  }
}

export function beautifyByLanguage(content: string, language: string, restrictToFunctionBody = false): string {
  const lang = (language || '').toLowerCase();
  if (!content || !content.trim()) return content || '';
  if (lang === 'json' || lang === 'jsonc') {
    return formatJsonPretty(content);
  }
  if (lang === 'xml' || lang === 'html') {
    return formatXmlPretty(content);
  }
  if (lang === 'graphql') {
    return formatGraphqlPretty(content);
  }
  if (lang === 'javascript' || lang === 'typescript') {
    return formatJsPretty(content, restrictToFunctionBody);
  }
  if (lang === 'python' || lang === 'py') {
    return formatPythonPretty(content, restrictToFunctionBody);
  }
  return content;
}
