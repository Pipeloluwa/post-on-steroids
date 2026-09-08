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

export function formatJsonPretty(content: any): string {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return typeof content === 'string' ? content : String(content);
  }
}

export function formatJsonKeyField(content: any): string {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    if (typeof parsed === 'object' && parsed !== null) {
      if (Array.isArray(parsed)) {
        const items = parsed.map(item => '  ' + JSON.stringify(item));
        return '[\n' + items.join(',\n') + '\n]';
      }
      const entries = Object.entries(parsed);
      const lines = entries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
      return '{\n' + lines.join(',\n') + '\n}';
    }
    return JSON.stringify(parsed);
  } catch {
    return typeof content === 'string' ? content : String(content);
  }
}

export function formatJsonCollapsed(content: any): string {
  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    return JSON.stringify(parsed);
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
