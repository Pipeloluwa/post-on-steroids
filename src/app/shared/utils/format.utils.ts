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

        if (tagName && next1 && !next1.startsWith('<') && next2 === `</${tagName}>`) {
          // Compact single-line leaf node: <tag>text</tag>
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
