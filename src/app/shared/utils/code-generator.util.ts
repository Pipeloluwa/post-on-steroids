import { RequestState } from '../services/tab.state.service';
import { CurlBuildOptions, buildCurlCommand } from './curl-generator.util';
import { extractSoapActionFromXml } from './format.utils';

export type CodeLanguageId =
  | 'curl'
  | 'powershell'
  | 'javascript-fetch'
  | 'nodejs-axios'
  | 'python'
  | 'csharp'
  | 'java'
  | 'go';

export interface CodeLanguageOption {
  id: CodeLanguageId;
  label: string;
  extension: string;
}

export const CODE_LANGUAGE_OPTIONS: CodeLanguageOption[] = [
  { id: 'curl', label: 'cURL (Bash)', extension: 'sh' },
  { id: 'powershell', label: 'PowerShell (Invoke-RestMethod)', extension: 'ps1' },
  { id: 'javascript-fetch', label: 'JavaScript (Fetch)', extension: 'js' },
  { id: 'nodejs-axios', label: 'Node.js (Axios)', extension: 'js' },
  { id: 'python', label: 'Python (requests)', extension: 'py' },
  { id: 'csharp', label: 'C# (.NET HttpClient)', extension: 'cs' },
  { id: 'java', label: 'Java (OkHttp)', extension: 'java' },
  { id: 'go', label: 'Go (net/http)', extension: 'go' }
];

interface ResolvedRequestComponents {
  method: string;
  fullUrl: string;
  headers: { key: string; value: string }[];
  rawBody: string | null;
  urlEncodedPairs: { key: string; value: string }[];
  formDataRows: { key: string; value: string; isFile: boolean }[];
  bodyType: string;
}

function encodeBase64Safe(val: string): string {
  try {
    if (typeof btoa === 'function') {
      return btoa(unescape(encodeURIComponent(val)));
    }
    return Buffer.from(val, 'utf8').toString('base64');
  } catch {
    return val;
  }
}

export function extractResolvedComponents(
  state: RequestState,
  options: CurlBuildOptions = {}
): ResolvedRequestComponents {
  const {
    resolveVariables = true,
    resolveText = (s: string) => s,
    resolveJson = (s: string) => s,
    autoAuthToken = null
  } = options;

  const resolveStr = (raw?: string): string => {
    const val = raw ?? '';
    return resolveVariables ? resolveText(val) : val;
  };

  const method = (state.method || 'GET').toUpperCase();
  const rawUrl = resolveStr(state.url || '').trim() || 'https://example.com';

  const enabledParams = (state.params || [])
    .filter(p => p.enabled && (p.key || '').trim() !== '')
    .map(p => ({ key: resolveStr(p.key).trim(), value: resolveStr(p.value) }))
    .filter(p => p.key !== '');

  // Add API Key if configured in query string
  if (state.auth?.type === 'apikey' && state.auth.apiKeyIn === 'query' && state.auth.apiKeyName) {
    const k = resolveStr(state.auth.apiKeyName).trim();
    const v = resolveStr(state.auth.apiKeyValue || state.auth.token || '');
    if (k && !enabledParams.some(p => p.key === k)) {
      enabledParams.push({ key: k, value: v });
    }
  }

  let fullUrl = rawUrl;
  if (enabledParams.length > 0) {
    const qs = enabledParams
      .map(p => resolveVariables ? `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}` : `${p.key}=${p.value}`)
      .join('&');
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + qs;
  }

  const headers: { key: string; value: string }[] = (state.headers || [])
    .filter(h => h.enabled && (h.key || '').trim() !== '')
    .map(h => ({
      key: resolveStr(h.key).trim().replace(/[\r\n]+/g, ''),
      value: resolveStr(h.value).trim().replace(/[\r\n]+/g, '')
    }))
    .filter(h => h.key !== '');

  const hasHeader = (name: string) => headers.some(h => h.key.toLowerCase() === name.toLowerCase());

  if ((state.auth?.type === 'bearer' || state.auth?.type === 'oauth2') && state.auth.token && !hasHeader('authorization')) {
    const token = resolveStr(state.auth.token).trim().replace(/[\r\n]+/g, '');
    const prefix = state.auth?.type === 'oauth2' ? (state.auth.oauth2?.headerPrefix || 'Bearer') : 'Bearer';
    if (token) headers.push({ key: 'Authorization', value: `${prefix} ${token}` });
  } else if (state.auth?.type === 'basic' && !hasHeader('authorization')) {
    if (state.auth.username !== undefined || state.auth.password !== undefined) {
      const creds = `${resolveStr(state.auth.username || '')}:${resolveStr(state.auth.password || '')}`;
      if (creds !== ':') {
        headers.push({ key: 'Authorization', value: `Basic ${encodeBase64Safe(creds)}` });
      }
    } else if (state.auth.token) {
      const rawTok = resolveStr(state.auth.token).trim().replace(/[\r\n]+/g, '');
      const encoded = rawTok.includes(':') ? encodeBase64Safe(rawTok) : rawTok;
      if (encoded) headers.push({ key: 'Authorization', value: `Basic ${encoded}` });
    }
  } else if (state.auth?.type === 'apikey' && (state.auth.apiKeyIn || 'header') === 'header' && state.auth.apiKeyName) {
    const k = resolveStr(state.auth.apiKeyName).trim();
    const v = resolveStr(state.auth.apiKeyValue || state.auth.token || '').trim();
    if (k && !hasHeader(k)) {
      headers.push({ key: k, value: v });
    }
  } else if (autoAuthToken && state.autoAuthEnabled && resolveVariables && !hasHeader('authorization')) {
    const cleanToken = autoAuthToken.trim().replace(/[\r\n]+/g, '');
    if (cleanToken) headers.push({ key: 'Authorization', value: `Bearer ${cleanToken}` });
  }

  let rawBody: string | null = null;
  const urlEncodedPairs: { key: string; value: string }[] = [];
  const formDataRows: { key: string; value: string; isFile: boolean }[] = [];
  const allowsBody = method !== 'GET' && method !== 'HEAD';

  if (allowsBody && state.bodyType === 'raw') {
    const isXml = state.rawType === 'XML' || state.rawType === 'XML (SOAP)' || state.rawType === 'SOAP';
    const isText = state.rawType === 'Text';
    const rawSource = isXml
      ? (state.rawBodyXml || '')
      : (isText ? (state.rawBodyText || state.rawBody || '') : (state.rawBodyJson || state.rawBody || ''));
    const resolvedBody = state.rawType === 'JSON'
      ? (resolveVariables ? resolveJson(rawSource) : rawSource)
      : resolveStr(rawSource);

    if (!hasHeader('content-type')) {
      if (state.rawType === 'JSON') headers.push({ key: 'Content-Type', value: 'application/json' });
      else if (isText) headers.push({ key: 'Content-Type', value: 'text/plain' });
      else if (isXml) {
        const isSoap = state.rawType === 'XML (SOAP)' || state.rawType === 'SOAP' || resolvedBody.includes('schemas.xmlsoap.org');
        const isSoap12 = isSoap && resolvedBody.includes('2003/05/soap-envelope');
        headers.push({ key: 'Content-Type', value: isSoap ? (isSoap12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8') : 'application/xml' });
        if (isSoap && !isSoap12 && !hasHeader('soapaction')) {
          const action = extractSoapActionFromXml(resolvedBody);
          headers.push({ key: 'SOAPAction', value: action ? `"${action}"` : '""' });
        }
      }
    }
    if (resolvedBody.trim()) rawBody = resolvedBody;
  } else if (allowsBody && state.bodyType === 'x-www-form-urlencoded') {
    if (!hasHeader('content-type')) {
      headers.push({ key: 'Content-Type', value: 'application/x-www-form-urlencoded' });
    }
    for (const row of (state.urlEncodedData || []).filter(r => r.enabled && (r.key || '').trim() !== '')) {
      urlEncodedPairs.push({ key: resolveStr(row.key).trim(), value: resolveStr(row.value || '') });
    }
  } else if (allowsBody && state.bodyType === 'graphql') {
    if (!hasHeader('content-type')) headers.push({ key: 'Content-Type', value: 'application/json' });
    const query = resolveStr(state.graphqlQuery || '');
    let variables: any = {};
    try {
      variables = JSON.parse((resolveVariables ? resolveJson(state.graphqlVariables || '{}') : state.graphqlVariables) || '{}');
    } catch {
      variables = {};
    }
    rawBody = JSON.stringify({ query, variables });
  } else if (allowsBody && state.bodyType === 'form-data') {
    for (const row of (state.formData || []).filter(f => f.enabled && (f.key || '').trim() !== '')) {
      const k = resolveStr(row.key).trim();
      if (!k) continue;
      if (row.type === 'file') {
        const fileName = row.file?.name || resolveStr(typeof row.value === 'string' ? row.value : '') || 'file.bin';
        formDataRows.push({ key: k, value: fileName, isFile: true });
      } else {
        formDataRows.push({ key: k, value: resolveStr(typeof row.value === 'string' ? row.value : ''), isFile: false });
      }
    }
  }

  return { method, fullUrl, headers, rawBody, urlEncodedPairs, formDataRows, bodyType: state.bodyType };
}

function escapeJsString(str: string): string {
  return JSON.stringify(str);
}

function escapeCSharpString(str: string): string {
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
}

function escapePowerShellString(str: string): string {
  return `'${str.replace(/'/g, "''")}'`;
}

export function buildCodeSnippet(
  language: CodeLanguageId,
  state: RequestState,
  options: CurlBuildOptions = {}
): string {
  if (language === 'curl') {
    return buildCurlCommand(state, options);
  }

  const c = extractResolvedComponents(state, options);
  const bodyStr = c.rawBody !== null
    ? c.rawBody
    : (c.urlEncodedPairs.length > 0
      ? c.urlEncodedPairs.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&')
      : null);

  switch (language) {
    case 'powershell': {
      const lines: string[] = ['$headers = @{'];
      for (const h of c.headers) {
        lines.push(`  ${escapePowerShellString(h.key)} = ${escapePowerShellString(h.value)}`);
      }
      lines.push('}');
      if (c.formDataRows.length > 0) {
        lines.push('$form = @{');
        for (const f of c.formDataRows) {
          lines.push(`  ${escapePowerShellString(f.key)} = ${f.isFile ? `Get-Item -Path ${escapePowerShellString(f.value)}` : escapePowerShellString(f.value)}`);
        }
        lines.push('}');
        lines.push(`$response = Invoke-RestMethod -Uri ${escapePowerShellString(c.fullUrl)} -Method ${c.method} -Headers $headers -Form $form`);
      } else if (bodyStr !== null) {
        lines.push(`$body = ${escapePowerShellString(bodyStr)}`);
        lines.push(`$response = Invoke-RestMethod -Uri ${escapePowerShellString(c.fullUrl)} -Method ${c.method} -Headers $headers -Body $body`);
      } else {
        lines.push(`$response = Invoke-RestMethod -Uri ${escapePowerShellString(c.fullUrl)} -Method ${c.method} -Headers $headers`);
      }
      lines.push('$response | ConvertTo-Json -Depth 10');
      return lines.join('\n');
    }

    case 'javascript-fetch': {
      const hdrEntries = c.headers.map(h => `  ${escapeJsString(h.key)}: ${escapeJsString(h.value)}`).join(',\n');
      const lines: string[] = [`const headers = {\n${hdrEntries}\n};`, ''];
      if (c.formDataRows.length > 0) {
        lines.push('const formData = new FormData();');
        for (const f of c.formDataRows) {
          lines.push(f.isFile
            ? `// formData.append(${escapeJsString(f.key)}, fileInput.files[0]);`
            : `formData.append(${escapeJsString(f.key)}, ${escapeJsString(f.value)});`);
        }
        lines.push('');
        lines.push(`const response = await fetch(${escapeJsString(c.fullUrl)}, {\n  method: ${escapeJsString(c.method)},\n  headers,\n  body: formData\n});`);
      } else {
        const bodyLine = bodyStr !== null ? `,\n  body: ${escapeJsString(bodyStr)}` : '';
        lines.push(`const response = await fetch(${escapeJsString(c.fullUrl)}, {\n  method: ${escapeJsString(c.method)},\n  headers${bodyLine}\n});`);
      }
      lines.push('const data = await response.text();\nconsole.log(response.status, data);');
      return lines.join('\n');
    }

    case 'nodejs-axios': {
      const hdrEntries = c.headers.map(h => `    ${escapeJsString(h.key)}: ${escapeJsString(h.value)}`).join(',\n');
      let dataBlock = '';
      if (c.urlEncodedPairs.length > 0) {
        const qsObj = c.urlEncodedPairs.map(p => `    ${escapeJsString(p.key)}: ${escapeJsString(p.value)}`).join(',\n');
        dataBlock = `  data: new URLSearchParams({\n${qsObj}\n  }),\n`;
      } else if (bodyStr !== null) {
        dataBlock = `  data: ${escapeJsString(bodyStr)},\n`;
      }
      return [
        `import axios from 'axios';`,
        '',
        `const response = await axios.request({`,
        `  method: ${escapeJsString(c.method)},`,
        `  url: ${escapeJsString(c.fullUrl)},`,
        `  headers: {\n${hdrEntries}\n  },`,
        ...(dataBlock ? [dataBlock.trimEnd()] : []),
        `});`,
        `console.log(response.status, response.data);`
      ].join('\n');
    }

    case 'python': {
      const lines: string[] = ['import requests', '', `url = ${JSON.stringify(c.fullUrl)}`, 'headers = {'];
      for (const h of c.headers) {
        lines.push(`    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)},`);
      }
      lines.push('}');
      if (c.formDataRows.length > 0) {
        lines.push('payload = {');
        for (const f of c.formDataRows.filter(x => !x.isFile)) {
          lines.push(`    ${JSON.stringify(f.key)}: ${JSON.stringify(f.value)},`);
        }
        lines.push('}');
        lines.push(`response = requests.request(${JSON.stringify(c.method)}, url, headers=headers, data=payload)`);
      } else if (c.urlEncodedPairs.length > 0) {
        lines.push('payload = {');
        for (const p of c.urlEncodedPairs) {
          lines.push(`    ${JSON.stringify(p.key)}: ${JSON.stringify(p.value)},`);
        }
        lines.push('}');
        lines.push(`response = requests.request(${JSON.stringify(c.method)}, url, headers=headers, data=payload)`);
      } else if (bodyStr !== null) {
        lines.push(`payload = ${JSON.stringify(bodyStr)}`);
        lines.push(`response = requests.request(${JSON.stringify(c.method)}, url, headers=headers, data=payload)`);
      } else {
        lines.push(`response = requests.request(${JSON.stringify(c.method)}, url, headers=headers)`);
      }
      lines.push('print(response.status_code, response.text)');
      return lines.join('\n');
    }

    case 'csharp': {
      const contentType = c.headers.find(h => h.key.toLowerCase() === 'content-type')?.value || 'application/json';
      const lines: string[] = [
        'using System.Net.Http;',
        'using System.Text;',
        '',
        'using var client = new HttpClient();',
        `using var request = new HttpRequestMessage(new HttpMethod("${c.method}"), ${escapeCSharpString(c.fullUrl)});`
      ];
      for (const h of c.headers) {
        if (h.key.toLowerCase() === 'content-type') continue;
        lines.push(`request.Headers.TryAddWithoutValidation(${escapeCSharpString(h.key)}, ${escapeCSharpString(h.value)});`);
      }
      if (bodyStr !== null) {
        lines.push(`request.Content = new StringContent(${escapeCSharpString(bodyStr)}, Encoding.UTF8, ${escapeCSharpString(contentType.split(';')[0].trim())});`);
      }
      lines.push('using var response = await client.SendAsync(request);');
      lines.push('var responseBody = await response.Content.ReadAsStringAsync();');
      lines.push('Console.WriteLine($"{(int)response.StatusCode}: {responseBody}");');
      return lines.join('\n');
    }

    case 'java': {
      const contentType = c.headers.find(h => h.key.toLowerCase() === 'content-type')?.value || 'application/json';
      const lines: string[] = [
        'OkHttpClient client = new OkHttpClient().newBuilder().build();',
        `MediaType mediaType = MediaType.parse(${JSON.stringify(contentType)});`
      ];
      if (bodyStr !== null) {
        lines.push(`RequestBody body = RequestBody.create(${JSON.stringify(bodyStr)}, mediaType);`);
      } else if (['POST', 'PUT', 'PATCH'].includes(c.method)) {
        lines.push('RequestBody body = RequestBody.create("", mediaType);');
      }
      lines.push('Request request = new Request.Builder()');
      lines.push(`  .url(${JSON.stringify(c.fullUrl)})`);
      if (bodyStr !== null || ['POST', 'PUT', 'PATCH'].includes(c.method)) {
        lines.push(`  .method(${JSON.stringify(c.method)}, body)`);
      } else {
        lines.push(`  .method(${JSON.stringify(c.method)}, null)`);
      }
      for (const h of c.headers) {
        lines.push(`  .addHeader(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`);
      }
      lines.push('  .build();');
      lines.push('try (Response response = client.newCall(request).execute()) {');
      lines.push('  System.out.println(response.code() + ": " + (response.body() != null ? response.body().string() : ""));');
      lines.push('}');
      return lines.join('\n');
    }

    case 'go': {
      const lines: string[] = [
        'package main',
        '',
        'import (',
        '  "fmt"',
        '  "io"',
        '  "net/http"',
        ...(bodyStr !== null ? ['  "strings"'] : []),
        ')',
        '',
        'func main() {'
      ];
      if (bodyStr !== null) {
        lines.push(`  payload := strings.NewReader(${JSON.stringify(bodyStr)})`);
        lines.push(`  req, _ := http.NewRequest(${JSON.stringify(c.method)}, ${JSON.stringify(c.fullUrl)}, payload)`);
      } else {
        lines.push(`  req, _ := http.NewRequest(${JSON.stringify(c.method)}, ${JSON.stringify(c.fullUrl)}, nil)`);
      }
      for (const h of c.headers) {
        lines.push(`  req.Header.Add(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`);
      }
      lines.push('  res, err := http.DefaultClient.Do(req)');
      lines.push('  if err != nil { panic(err) }');
      lines.push('  defer res.Body.Close()');
      lines.push('  body, _ := io.ReadAll(res.Body)');
      lines.push('  fmt.Println(res.StatusCode, string(body))');
      lines.push('}');
      return lines.join('\n');
    }
  }
}
