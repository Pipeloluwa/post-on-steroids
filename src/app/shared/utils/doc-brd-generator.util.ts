import type { RequestState, TriggerFlowConfig } from '../services/tab.state.service';

export interface DocBrdVariable {
    key: string;
    value: string;
}

export interface DocBrdOptions {
    mode: 'api-doc' | 'brd';
    scope: 'endpoint' | 'collection';
    projectTitle: string;
    version: string;
    author: string;
    organization: string;
    capsuleName: string;
    requests: RequestState[];
    variables?: DocBrdVariable[];
}

export interface GeneratedDocResult {
    title: string;
    markdown: string;
    html: string;
    wordHtml: string;
}

interface DataFieldRow {
    endpoint: string;
    path: string;
    type: string;
    location: 'Query' | 'Header' | 'Body' | 'FormData' | 'Response';
    encrypted: boolean;
    sample: string;
}

function escapeHtml(text: string): string {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeMdCell(text: string): string {
    return String(text ?? '')
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
}

function isSensitiveKey(key: string): boolean {
    return /(secret|password|passwd|token|api[-_]?key|private[-_]?key|authorization)/i.test(key || '');
}

function maskIfSensitive(key: string, val: string): string {
    const clean = String(val ?? '');
    if (!clean) return '(empty)';
    if (isSensitiveKey(key)) {
        return clean.length <= 6 ? '******' : `${clean.slice(0, 2)}••••••${clean.slice(-2)}`;
    }
    return clean;
}

function describeAuth(req: RequestState): string {
    const auth = req.auth;
    if (!auth || auth.type === 'none') return 'None';
    switch (auth.type) {
        case 'bearer':
            return 'Bearer Token (Authorization header)';
        case 'basic':
            return `Basic Auth (${auth.username ? `User: ${auth.username}` : 'Credentials'})`;
        case 'apikey':
            return `API Key (${auth.apiKeyName || 'X-API-Key'} in ${auth.apiKeyIn || 'header'})`;
        case 'oauth2':
            return `OAuth 2.0 (${auth.oauth2?.grantType || 'token'}, prefix: ${auth.oauth2?.headerPrefix || 'Bearer'})`;
        case 'aws-sigv4':
            return `AWS SigV4 (${auth.awsSigV4?.service || 'service'} / ${auth.awsSigV4?.region || 'region'})`;
        default:
            return String(auth.type);
    }
}

function getRequestBodyPreview(req: RequestState): { language: string; content: string } {
    if (req.bodyType === 'none') {
        return { language: 'text', content: '' };
    }
    if (req.bodyType === 'raw') {
        const raw = req.rawType === 'JSON' ? (req.rawBodyJson || req.rawBody || '') : (req.rawBody || '');
        const lang = req.rawType === 'JSON' ? 'json' : req.rawType === 'XML' ? 'xml' : 'text';
        return { language: lang, content: raw.trim() };
    }
    if (req.bodyType === 'graphql') {
        const q = (req.graphqlQuery || '').trim();
        const v = (req.graphqlVariables || '').trim();
        return {
            language: 'graphql',
            content: v ? `${q}\n\n# Variables\n${v}` : q
        };
    }
    if (req.bodyType === 'form-data') {
        const rows = (req.formData || []).filter(r => r.enabled && r.key);
        const obj: Record<string, string> = {};
        for (const r of rows) {
            obj[r.key] = r.type === 'file' ? '<binary file>' : r.value;
        }
        return { language: 'json', content: rows.length ? JSON.stringify(obj, null, 2) : '' };
    }
    if (req.bodyType === 'x-www-form-urlencoded') {
        const rows = (req.urlEncodedData || []).filter(r => r.enabled && r.key);
        const lines = rows.map(r => `${r.key}=${r.value}`);
        return { language: 'text', content: lines.join('&') };
    }
    return { language: 'text', content: '' };
}

function collectJsonFields(
    value: any,
    prefix: string,
    endpointName: string,
    location: 'Body' | 'Response',
    encryptedPaths: Set<string>,
    out: DataFieldRow[],
    depth: number = 0
): void {
    if (depth > 4 || out.length > 200) return;
    if (Array.isArray(value)) {
        const arrPath = prefix ? `${prefix}[]` : '[]';
        if (value.length === 0) {
            out.push({
                endpoint: endpointName,
                path: arrPath,
                type: 'array',
                location,
                encrypted: encryptedPaths.has(arrPath) || encryptedPaths.has(prefix),
                sample: '[]'
            });
            return;
        }
        collectJsonFields(value[0], arrPath, endpointName, location, encryptedPaths, out, depth + 1);
        return;
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0 && prefix) {
            out.push({
                endpoint: endpointName,
                path: prefix,
                type: 'object',
                location,
                encrypted: encryptedPaths.has(prefix),
                sample: '{}'
            });
            return;
        }
        for (const [k, v] of entries) {
            const nextPath = prefix ? `${prefix}.${k}` : k;
            const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
            const isEnc = encryptedPaths.has(nextPath) || encryptedPaths.has(k);
            if (v !== null && typeof v === 'object') {
                out.push({
                    endpoint: endpointName,
                    path: nextPath,
                    type: t,
                    location,
                    encrypted: isEnc,
                    sample: Array.isArray(v) ? `[${v.length} item(s)]` : '{...}'
                });
                collectJsonFields(v, nextPath, endpointName, location, encryptedPaths, out, depth + 1);
            } else {
                out.push({
                    endpoint: endpointName,
                    path: nextPath,
                    type: t,
                    location,
                    encrypted: isEnc,
                    sample: maskIfSensitive(k, String(v ?? ''))
                });
            }
        }
    }
}

function extractEndpointDataDictionary(req: RequestState): DataFieldRow[] {
    const out: DataFieldRow[] = [];
    const ep = `${req.method} ${req.name || req.url || 'Endpoint'}`;
    const encBodyPaths = new Set((req.encryption?.encryptedBodyPaths || []).filter(Boolean));
    const encHeaders = new Set((req.encryption?.encryptedHeaders || []).map(h => h.toLowerCase()));

    for (const p of (req.params || []).filter(r => r.enabled && r.key)) {
        out.push({
            endpoint: ep,
            path: p.key,
            type: 'string',
            location: 'Query',
            encrypted: false,
            sample: maskIfSensitive(p.key, p.value)
        });
    }
    for (const h of (req.headers || []).filter(r => r.enabled && r.key)) {
        out.push({
            endpoint: ep,
            path: h.key,
            type: 'string',
            location: 'Header',
            encrypted: encHeaders.has(h.key.toLowerCase()),
            sample: maskIfSensitive(h.key, h.value)
        });
    }
    if (req.bodyType === 'raw' && req.rawType === 'JSON') {
        const raw = (req.rawBodyJson || req.rawBody || '').trim();
        if (raw) {
            try {
                const parsed = JSON.parse(raw);
                collectJsonFields(parsed, '', ep, 'Body', encBodyPaths, out);
            } catch {
                // ignore invalid JSON while editing
            }
        }
    } else if (req.bodyType === 'form-data') {
        for (const r of (req.formData || []).filter(f => f.enabled && f.key)) {
            out.push({
                endpoint: ep,
                path: r.key,
                type: r.type === 'file' ? 'binary/file' : 'string',
                location: 'FormData',
                encrypted: encBodyPaths.has(r.key),
                sample: r.type === 'file' ? '<file>' : maskIfSensitive(r.key, r.value)
            });
        }
    }
    if (req.responseBody && typeof req.responseBody === 'object') {
        collectJsonFields(req.responseBody, '', ep, 'Response', new Set<string>(), out);
    }
    return out;
}

function resolveRequestName(id: string | null | undefined, allReqs: RequestState[]): string {
    if (!id) return 'None';
    if (id === '__script__') return 'Script-Controlled (pm.execution.setNextRequest)';
    const found = allReqs.find(r => r.id === id);
    return found ? `${found.method} ${found.name || found.url}` : id;
}

function extractTestCases(req: RequestState): string[] {
    const cases: string[] = [];
    if (Array.isArray(req.testResults) && req.testResults.length > 0) {
        for (const tr of req.testResults) {
            cases.push(`${tr.name} [${tr.passed ? 'PASS' : 'FAIL'}]`);
        }
    }
    const sources = [req.scripts?.testScript || '', req.scripts?.postResponse || ''];
    for (const src of sources) {
        const matches = src.matchAll(/(?:pm\.)?test\(\s*['"`]([^'"`]+)['"`]/g);
        for (const m of matches) {
            const label = m[1].trim();
            if (label && !cases.some(c => c.startsWith(label))) {
                cases.push(`${label} [Defined]`);
            }
        }
    }
    return cases;
}

function renderMarkdownTablesAndBlocks(md: string): string {
    const lines = md.split(/\r?\n/);
    const html: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Code block
        if (line.startsWith('```')) {
            const lang = line.slice(3).trim();
            const buf: string[] = [];
            i += 1;
            while (i < lines.length && !lines[i].startsWith('```')) {
                buf.push(lines[i]);
                i += 1;
            }
            html.push(
                `<pre class="code-block"><div class="code-lang">${escapeHtml(lang || 'text')}</div><code>${escapeHtml(buf.join('\n'))}</code></pre>`
            );
            i += 1;
            continue;
        }

        // Markdown table
        if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|[\s:-]+\|/.test(lines[i + 1].trim())) {
            const splitRow = (row: string) =>
                row
                    .trim()
                    .replace(/^\|/, '')
                    .replace(/\|$/, '')
                    .split(/(?<!\\)\|/)
                    .map(c => c.replace(/\\\|/g, '|').trim());

            const headers = splitRow(line);
            i += 2; // skip separator
            const bodyRows: string[][] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                bodyRows.push(splitRow(lines[i]));
                i += 1;
            }
            html.push('<table><thead><tr>');
            for (const h of headers) {
                html.push(`<th>${formatInline(h)}</th>`);
            }
            html.push('</tr></thead><tbody>');
            for (const row of bodyRows) {
                html.push('<tr>');
                for (let c = 0; c < headers.length; c++) {
                    html.push(`<td>${formatInline(row[c] ?? '')}</td>`);
                }
                html.push('</tr>');
            }
            html.push('</tbody></table>');
            continue;
        }

        // Horizontal rule
        if (/^---+$/.test(line.trim())) {
            html.push('<hr />');
            i += 1;
            continue;
        }

        // Headings
        const hMatch = line.match(/^(#{1,4})\s+(.*)$/);
        if (hMatch) {
            const lvl = hMatch[1].length;
            html.push(`<h${lvl}>${formatInline(hMatch[2])}</h${lvl}>`);
            i += 1;
            continue;
        }

        // Blockquote
        if (line.startsWith('> ')) {
            html.push(`<blockquote>${formatInline(line.slice(2))}</blockquote>`);
            i += 1;
            continue;
        }

        // Bullet lists
        if (/^[-*]\s+/.test(line)) {
            html.push('<ul>');
            while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
                html.push(`<li>${formatInline(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
                i += 1;
            }
            html.push('</ul>');
            continue;
        }

        if (!line.trim()) {
            i += 1;
            continue;
        }

        html.push(`<p>${formatInline(line)}</p>`);
        i += 1;
    }

    return html.join('\n');
}

function formatInline(raw: string): string {
    const escaped = escapeHtml(raw);
    return escaped
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function wrapDocumentHtml(title: string, bodyHtml: string, forWord: boolean): string {
    const styles = `
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; line-height: 1.55; margin: 32px auto; max-width: 960px; padding: 0 20px; }
        h1 { font-size: 24px; color: #0f172a; border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-top: 0; }
        h2 { font-size: 18px; color: #1d4ed8; margin-top: 28px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
        h3 { font-size: 15px; color: #0f172a; margin-top: 20px; }
        h4 { font-size: 13px; color: #334155; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 14px; }
        p { margin: 8px 0; font-size: 13.5px; }
        blockquote { border-left: 3px solid #3b82f6; background: #eff6ff; padding: 8px 12px; margin: 10px 0; color: #1e3a8a; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12.5px; }
        th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; vertical-align: top; }
        th { background: #f1f5f9; font-weight: 600; color: #0f172a; }
        tr:nth-child(even) td { background: #f8fafc; }
        code { font-family: Consolas, monospace; background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 12px; color: #0f172a; }
        pre.code-block { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
        pre.code-block code { background: transparent; color: inherit; padding: 0; }
        .code-lang { font-size: 10px; text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; }
        ul { margin: 6px 0 12px 20px; font-size: 13px; }
        hr { border: 0; border-top: 1px solid #cbd5e1; margin: 22px 0; }
        @media print { body { margin: 12px; max-width: 100%; } pre.code-block { white-space: pre-wrap; } }
    `;
    const htmlAttrs = forWord
        ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"'
        : '';
    return `<!DOCTYPE html><html${htmlAttrs}><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${bodyHtml}</body></html>`;
}

function buildApiDocMarkdown(options: DocBrdOptions, generatedIso: string): { title: string; markdown: string } {
    const reqs = options.requests;
    const scopeLabel = options.scope === 'endpoint' && reqs[0]
        ? `${reqs[0].method} ${reqs[0].name || reqs[0].url || 'Endpoint'}`
        : `${options.capsuleName || 'Collection'} (${reqs.length} Endpoints)`;
    const title = `${options.projectTitle || scopeLabel} — Technical API Documentation`;
    const md: string[] = [];

    md.push(`# ${title}`);
    md.push('');
    md.push(`> **Version:** ${options.version || '1.0.0'} | **Organization:** ${options.organization || 'Engineering'} | **Author:** ${options.author || 'API Team'} | **Generated:** ${generatedIso}`);
    md.push('');

    if (options.variables && options.variables.length > 0) {
        md.push('## Environment & Collection Variables');
        md.push('| Variable | Value / Placeholder |');
        md.push('| --- | --- |');
        for (const v of options.variables) {
            md.push(`| \`{{${escapeMdCell(v.key)}}}\` | \`${escapeMdCell(maskIfSensitive(v.key, v.value))}\` |`);
        }
        md.push('');
    }

    md.push('## Endpoint Index');
    md.push('| # | Method | Name | URL | Authentication | Trigger Next |');
    md.push('| --- | --- | --- | --- | --- | --- |');
    reqs.forEach((r, idx) => {
        const nextLabel = r.postTriggerTabId ? resolveRequestName(r.postTriggerTabId, reqs) : 'None';
        md.push(
            `| ${idx + 1} | **${escapeMdCell(r.method || 'GET')}** | ${escapeMdCell(r.name || 'Untitled Request')} | \`${escapeMdCell(r.url || '(none)')}\` | ${escapeMdCell(describeAuth(r))} | ${escapeMdCell(nextLabel)} |`
        );
    });
    md.push('');

    reqs.forEach((r, idx) => {
        md.push('---');
        md.push(`## ${idx + 1}. \`${r.method || 'GET'}\` ${r.name || 'Untitled Request'}`);
        md.push(`- **Endpoint URL:** \`${r.url || '(not set)'}\``);
        md.push(`- **Authentication:** ${describeAuth(r)}${r.autoAuthEnabled ? ' (Auto-Auth Enabled)' : ''}`);
        if (r.encryption?.algorithm && r.encryption.algorithm !== 'none') {
            md.push(`- **Field-Level Encryption:** \`${r.encryption.algorithm}\` (Body: ${r.encryption.autoEncryptBody ? 'Auto' : 'Custom'}, Headers: ${r.encryption.autoEncryptHeaders ? 'Auto' : 'Custom'})`);
        }
        const trig: TriggerFlowConfig | undefined = r.triggerConfig;
        if (r.postTriggerTabId || (trig?.retryCountOnFail ?? 0) > 0 || (trig?.scheduleIntervalMs ?? 0) > 0) {
            md.push(`- **Automation & Chaining:** Next=${resolveRequestName(r.postTriggerTabId, reqs)}, Condition=${trig?.condition || 'always'}, Delay=${trig?.delayMs ?? 250}ms, Retries=${trig?.retryCountOnFail ?? 0}, Schedule=${trig?.scheduleIntervalMs ? `${Math.round(trig.scheduleIntervalMs / 1000)}s` : 'Off'}`);
        }
        md.push('');

        const enabledParams = (r.params || []).filter(p => p.enabled && p.key);
        if (enabledParams.length > 0) {
            md.push('### Query Parameters');
            md.push('| Key | Sample Value |');
            md.push('| --- | --- |');
            for (const p of enabledParams) {
                md.push(`| \`${escapeMdCell(p.key)}\` | \`${escapeMdCell(maskIfSensitive(p.key, p.value))}\` |`);
            }
            md.push('');
        }

        const enabledHeaders = (r.headers || []).filter(h => h.enabled && h.key);
        if (enabledHeaders.length > 0) {
            md.push('### Request Headers');
            md.push('| Header | Value | Encrypted |');
            md.push('| --- | --- | --- |');
            const encSet = new Set((r.encryption?.encryptedHeaders || []).map(x => x.toLowerCase()));
            for (const h of enabledHeaders) {
                md.push(`| \`${escapeMdCell(h.key)}\` | \`${escapeMdCell(maskIfSensitive(h.key, h.value))}\` | ${encSet.has(h.key.toLowerCase()) ? 'Yes' : 'No'} |`);
            }
            md.push('');
        }

        const bodyPrev = getRequestBodyPreview(r);
        if (bodyPrev.content) {
            md.push(`### Request Payload (${r.bodyType}${r.bodyType === 'raw' ? ` / ${r.rawType}` : ''})`);
            md.push(`\`\`\`${bodyPrev.language}`);
            md.push(bodyPrev.content);
            md.push('```');
            md.push('');
        }

        if (r.responseStatus !== null && r.responseStatus !== undefined) {
            md.push(`### Sample / Latest Observed Response (HTTP ${r.responseStatus}${r.responseTime ? `, ${r.responseTime}ms` : ''})`);
            const respStr = typeof r.responseBody === 'string'
                ? r.responseBody
                : JSON.stringify(r.responseBody ?? null, null, 2);
            md.push('```json');
            md.push((respStr || '').slice(0, 4000));
            md.push('```');
            md.push('');
        }
    });

    return { title, markdown: md.join('\n') };
}

function buildBrdMarkdown(options: DocBrdOptions, generatedIso: string): { title: string; markdown: string } {
    const reqs = options.requests;
    const scopeSummary = options.scope === 'endpoint' && reqs[0]
        ? `Single Endpoint (${reqs[0].method} ${reqs[0].name || reqs[0].url})`
        : `Full Collection (${options.capsuleName || 'Workspace'} — ${reqs.length} Endpoint(s))`;
    const docTitle = `${options.projectTitle || options.capsuleName || 'API Integration'} — Business Requirements Document (BRD)`;
    const md: string[] = [];

    md.push(`# ${docTitle}`);
    md.push('');

    // Section 1: Document Control & Revision History
    md.push('## 1. Document Control & Revision History');
    md.push('| Attribute | Value |');
    md.push('| --- | --- |');
    md.push(`| Project / System | ${escapeMdCell(options.projectTitle || options.capsuleName || 'API Service Integration')} |`);
    md.push(`| Document Standard | Standard Enterprise BRD v1 |`);
    md.push(`| Document Version | ${escapeMdCell(options.version || '1.0.0')} |`);
    md.push(`| Organization | ${escapeMdCell(options.organization || 'Engineering & Product')} |`);
    md.push(`| Author | ${escapeMdCell(options.author || 'Solutions Architecture Team')} |`);
    md.push(`| Scope | ${escapeMdCell(scopeSummary)} |`);
    md.push(`| Generated Date | ${generatedIso} |`);
    md.push('');
    md.push('### Revision History');
    md.push('| Version | Date | Author | Description |');
    md.push('| --- | --- | --- | --- |');
    md.push(`| ${escapeMdCell(options.version || '1.0.0')} | ${generatedIso.slice(0, 10)} | ${escapeMdCell(options.author || 'Solutions Team')} | Baseline specification generated from validated API definitions. |`);
    md.push('');

    // Section 2: Executive Summary & Business Objectives
    md.push('## 2. Executive Summary & Business Objectives');
    md.push(
        `This Business Requirements Document defines functional contracts, security/encryption policies, workflow automation chains, and acceptance criteria for **${options.projectTitle || options.capsuleName || 'the API Workspace'}** covering **${reqs.length}** API endpoint(s).`
    );
    md.push('');
    md.push('- **Standardization:** Establish an unambiguous producer-consumer contract across development, SIT, UAT, and production environments.');
    md.push('- **Security & Compliance:** Document authentication controls, field-level payload encryption rules, and transport SSL requirements.');
    md.push('- **Operational Reliability:** Capture automated retries, conditional workflow chaining, and recurring health monitoring schedules.');
    md.push('');

    // Section 3: System Scope & Integration Architecture
    md.push('## 3. System Scope & Integration Architecture');
    md.push('### 3.1 Endpoint Scope Inventory');
    md.push('| Req ID | Method | Endpoint Name | Target URI | Auth Mechanism |');
    md.push('| --- | --- | --- | --- | --- |');
    reqs.forEach((r, idx) => {
        md.push(
            `| FR-${String(idx + 1).padStart(3, '0')} | **${escapeMdCell(r.method || 'GET')}** | ${escapeMdCell(r.name || 'Untitled Request')} | \`${escapeMdCell(r.url || '(none)')}\` | ${escapeMdCell(describeAuth(r))} |`
        );
    });
    md.push('');

    md.push('### 3.2 Chained Workflow & Automation Topology');
    md.push('| Source Endpoint | Condition | Delay (ms) | Retries | Schedule | Target / Next Action |');
    md.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of reqs) {
        const cfg = r.triggerConfig;
        const nextLabel = resolveRequestName(r.postTriggerTabId, reqs);
        md.push(
            `| ${escapeMdCell(r.name || r.url)} | \`${cfg?.condition || 'always'}\` | ${cfg?.delayMs ?? 250} | ${cfg?.retryCountOnFail ?? 0} | ${cfg?.scheduleIntervalMs ? `Every ${Math.round(cfg.scheduleIntervalMs / 1000)}s` : 'Manual'} | ${escapeMdCell(nextLabel)} |`
        );
    }
    md.push('');

    // Section 4: Functional Requirements & Data Dictionary
    md.push('## 4. Functional Requirements & API Data Dictionary');
    const allFields: DataFieldRow[] = [];
    reqs.forEach((r, idx) => {
        const frId = `FR-${String(idx + 1).padStart(3, '0')}`;
        md.push(`### 4.${idx + 1} [${frId}] ${r.method || 'GET'} — ${r.name || 'Untitled Request'}`);
        md.push(`- **Business Action:** Execute \`${r.method || 'GET'}\` call against \`${r.url || '(not set)'}\`.`);
        md.push(`- **Preconditions & Auth:** ${describeAuth(r)}${r.autoAuthEnabled ? '; Auto-Auth 401 refresh active' : ''}.`);
        if (r.scripts?.preRequest?.trim()) {
            md.push('- **Pre-Request Processing:** Executes custom sandbox script prior to dispatch.');
        }
        if (r.scripts?.postResponse?.trim()) {
            md.push('- **Post-Response Processing:** Executes response transformation / chaining script upon completion.');
        }
        const bodyPrev = getRequestBodyPreview(r);
        if (bodyPrev.content) {
            md.push(`- **Expected Payload Format:** \`${r.bodyType}${r.rawType ? ` / ${r.rawType}` : ''}\``);
            md.push(`\`\`\`${bodyPrev.language}`);
            md.push(bodyPrev.content);
            md.push('```');
        }
        md.push('');
        allFields.push(...extractEndpointDataDictionary(r));
    });

    md.push('### 4.X Consolidated Data Dictionary');
    if (allFields.length === 0) {
        md.push('_No structured JSON, query, header, or form fields detected on the selected endpoint(s)._');
    } else {
        md.push('| Endpoint | Field Path | Type | Location | Encrypted | Sample / Mask |');
        md.push('| --- | --- | --- | --- | --- | --- |');
        for (const f of allFields) {
            md.push(
                `| ${escapeMdCell(f.endpoint)} | \`${escapeMdCell(f.path)}\` | ${escapeMdCell(f.type)} | ${f.location} | ${f.encrypted ? 'Yes' : 'No'} | \`${escapeMdCell(f.sample)}\` |`
            );
        }
    }
    md.push('');

    // Section 5: Non-Functional Requirements, Security, Encryption & SLA Matrix
    md.push('## 5. Non-Functional Requirements, Security & SLA Matrix');
    md.push('| Category | Policy / Requirement | Configured Value |');
    md.push('| --- | --- | --- |');
    const verifySslAll = reqs.every(r => r.settings?.verifySsl !== false);
    const encAlgs = Array.from(new Set(reqs.map(r => r.encryption?.algorithm).filter(a => a && a !== 'none')));
    const maxRetries = Math.max(0, ...reqs.map(r => r.triggerConfig?.retryCountOnFail ?? 0));
    md.push(`| Transport Security | SSL Certificate Verification | ${verifySslAll ? 'Strict TLS Verification Enabled' : 'Mixed / Custom Per Endpoint'} |`);
    md.push(`| Payload Protection | Field-Level Encryption Algorithms | ${encAlgs.length > 0 ? encAlgs.join(', ') : 'Transport-Only (No Field Encryption)'} |`);
    md.push(`| Resilience & SLA | Automated Retry Policy on 5xx / Network Fault | Up to ${maxRetries} automatic retry attempt(s) |`);
    md.push(`| Cookie & Session State | Client Cookie Jar Persistence | ${reqs.some(r => r.settings?.enableCookies !== false) ? 'Enabled' : 'Disabled'} |`);
    md.push('');

    // Section 6: User Acceptance Testing (UAT) & Sign-Off Matrix
    md.push('## 6. User Acceptance Testing (UAT) & Verification Matrix');
    md.push('| UAT ID | Endpoint | Verification Case / Assertion | Expected Outcome |');
    md.push('| --- | --- | --- | --- |');
    let uatNum = 1;
    for (const r of reqs) {
        const ep = `${r.method} ${r.name || r.url}`;
        const tests = extractTestCases(r);
        if (tests.length === 0) {
            const expectedStatus = r.triggerConfig?.condition === 'on-status-match' ? (r.triggerConfig.expectedStatus ?? 200) : '2xx';
            md.push(`| UAT-${String(uatNum++).padStart(3, '0')} | ${escapeMdCell(ep)} | Request executes and returns valid HTTP status | HTTP ${expectedStatus}, valid response schema |`);
        } else {
            for (const t of tests) {
                md.push(`| UAT-${String(uatNum++).padStart(3, '0')} | ${escapeMdCell(ep)} | ${escapeMdCell(t)} | Assertion passes in automated runner |`);
            }
        }
    }
    md.push('');
    md.push('### Stakeholder Sign-Off');
    md.push('| Role | Reviewer Name | Signature / Date |');
    md.push('| --- | --- | --- |');
    md.push('| Product / Business Owner | _______________________ | _______________ |');
    md.push('| Engineering Lead | _______________________ | _______________ |');
    md.push('| QA / Release Lead | _______________________ | _______________ |');

    return { title: docTitle, markdown: md.join('\n') };
}

export function generateDocumentationOrBrd(options: DocBrdOptions): GeneratedDocResult {
    const generatedIso = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const cleanOptions: DocBrdOptions = {
        ...options,
        requests: options.scope === 'endpoint' ? options.requests.slice(0, 1) : options.requests
    };

    const built = cleanOptions.mode === 'brd'
        ? buildBrdMarkdown(cleanOptions, generatedIso)
        : buildApiDocMarkdown(cleanOptions, generatedIso);

    const bodyHtml = renderMarkdownTablesAndBlocks(built.markdown);
    return {
        title: built.title,
        markdown: built.markdown,
        html: wrapDocumentHtml(built.title, bodyHtml, false),
        wordHtml: wrapDocumentHtml(built.title, bodyHtml, true)
    };
}
