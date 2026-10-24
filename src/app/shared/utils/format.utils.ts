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
  const isXml = (type || '').toUpperCase() === 'XML';
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

const UNQUOTED_VAR_OR_STRING_REGEX = /"(?:[^"\\]|\\.)*"|(\/\/.*|\/\*[\s\S]*?\*\/)|(\{\{[^{}\r\n]*\}\}|\$(?:guid|timestamp|randomInt|randomUUID|randomEmail|randomName|randomWord|randomColor|randomCity|randomStreetAddress|randomPhoneNumber|randomBoolean|randomAlphaNumeric|randomIPv4)\b)/gi;

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
  const parsed = JSON.parse(sanitized);
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
    return parseJsonWithVariables(content).parsed;
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
  try {
    const PADDING = '  ';
    const reg = /(>)(<)(\/*)/g;
    const formatted = xml.replace(reg, '$1\r\n$2$3');
    let pad = 0;
    return formatted.split('\r\n').map((node) => {
      let indent = 0;
      if (node.match(/.+<\/\w[^>]*>$/)) {
        indent = 0;
      } else if (node.match(/^<\/\w/) && pad > 0) {
        pad -= 1;
      } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
        indent = 1;
      } else {
        indent = 0;
      }
      const padding = PADDING.repeat(pad);
      pad += indent;
      return padding + node;
    }).join('\n');
  } catch {
    return xml;
  }
}

export function formatXmlByField(xml: string): string {
  try {
    const clean = xml.replace(/>\s*</g, '><').trim();
    const rootMatch = clean.match(/^<([a-zA-Z0-9_\-:]+)([^>]*)>(.*)<\/\1>$/s);
    if (rootMatch) {
      const rootOpen = `<${rootMatch[1]}${rootMatch[2]}>`;
      const rootClose = `</${rootMatch[1]}>`;
      const inner = rootMatch[3];
      const childMatches = inner.match(/<([a-zA-Z0-9_\-:]+)[^>]*>.*?<\/\1>|<[^>]+\/>/g);
      if (childMatches && childMatches.length > 0) {
        return `${rootOpen}\n  ${childMatches.join('\n  ')}\n${rootClose}`;
      }
    }
    return clean;
  } catch {
    return xml;
  }
}

export function formatXmlCollapsed(xml: string): string {
  return xml.replace(/>\s*</g, '><').replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim();
}
