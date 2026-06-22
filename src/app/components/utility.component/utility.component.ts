import { Component, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
    selector: 'app-utility-component',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './utility.component.html',
    styleUrl: './utility.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UtilityComponent {
    private sanitizer = inject(DomSanitizer);

    activeTool = signal<string | null>(null);
    tools = [
        { id: 'uuid', name: 'UUID Generator', description: 'Generate random v4 UUIDs', icon: 'fingerprint' },
        { id: 'time', name: 'Timestamp & Epoch', description: 'Convert between epoch and readable dates', icon: 'schedule' },
        { id: 'json', name: 'JSON Formatter', description: 'Format and minify JSON payloads', icon: 'data_object' },
        { id: 'base64', name: 'Base64 Encoder', description: 'Encode and decode Base64 strings', icon: 'swap_horiz' },
        { id: 'url', name: 'URL Encoder', description: 'Encode and decode URL parameters', icon: 'link' },
        { id: 'hash', name: 'SHA-256 Hash', description: 'Generate SHA-256 hash from text', icon: 'lock' },
        { id: 'html', name: 'HTML Entities', description: 'Encode and decode HTML entities', icon: 'code' },
        { id: 'jwt', name: 'JWT Decoder', description: 'Decode JSON Web Tokens', icon: 'security' },
        { id: 'lorem', name: 'Lorem Ipsum', description: 'Generate dummy text paragraphs', icon: 'text_snippet' },
        { id: 'diff', name: 'Text Diff', description: 'Compare two text blocks line by line', icon: 'compare_arrows' },
        { id: 'regex', name: 'Regex Tester', description: 'Test regular expressions against text', icon: 'fact_check' },
        { id: 'color', name: 'Color Converter', description: 'Convert between HEX, RGB, and HSL', icon: 'palette' },
        { id: 'markdown', name: 'Markdown Preview', description: 'Live preview of markdown text', icon: 'description' },
        { id: 'url-parse', name: 'URL Parser', description: 'Parse URLs into their components', icon: 'account_tree' },
        { id: 'case', name: 'Text Case Converter', description: 'Convert text to camel, snake, kebab, etc.', icon: 'text_format' },
        { id: 'base', name: 'Number Base Converter', description: 'Convert numbers between bases', icon: '123' },
        { id: 'random-string', name: 'Random String', description: 'Generate secure random strings and passwords', icon: 'password' },
        { id: 'text-stat', name: 'Text Statistics', description: 'Count words, characters, and lines', icon: 'analytics' }
    ];

    setActiveTool(toolId: string | null) {
        this.activeTool.set(toolId);
    }

    uuidValue = signal('');
    now = signal(new Date());
    dateValue = signal(this.formatDateInput(this.now()));
    datetimeValue = signal(this.formatDatetimeLocal(this.now()));
    epochValue = signal('');
    jsonInput = signal('{\n  "hello": "world"\n}');
    jsonOutput = signal('');
    base64Input = signal('');
    base64Output = signal('');
    urlInput = signal('');
    urlOutput = signal('');
    hashInput = signal('');
    hashOutput = signal('');
    copyStatus = signal('');
    private copyTimer: number | null = null;

    // ── HTML Entity ──
    htmlEntityInput = signal('');
    htmlEntityOutput = signal('');

    // ── JWT Decoder ──
    jwtInput = signal('');
    jwtHeader = signal('');
    jwtPayload = signal('');
    jwtError = signal('');

    // ── Lorem Ipsum ──
    loremParagraphs = signal(3);
    loremOutput = signal('');

    // ── Text Diff ──
    diffTextA = signal('');
    diffTextB = signal('');
    diffResult = signal<{ type: 'same' | 'added' | 'removed'; text: string }[]>([]);

    // ── Regex Tester ──
    regexPattern = signal('');
    regexFlags = signal('g');
    regexInput = signal('');
    regexMatches = signal<{ match: string; index: number; groups: string[] }[]>([]);
    regexError = signal('');

    // ── Color Converter ──
    colorHex = signal('#3B82F6');
    colorRgb = computed(() => this.hexToRgb(this.colorHex()));
    colorHsl = computed(() => this.hexToHsl(this.colorHex()));

    // ── Markdown Preview ──
    markdownInput = signal('# Hello World\n\nThis is **bold** and *italic* text.\n\n- Item 1\n- Item 2\n- Item 3\n\n```js\nconsole.log("hello");\n```\n\n> A blockquote example\n\n[Example Link](https://example.com)');
    markdownHtml = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.renderMarkdown(this.markdownInput())));

    // ── URL Parser ──
    urlParseInput = signal('');
    urlParseResult = computed(() => {
        try {
            const urlStr = this.urlParseInput().trim();
            if (!urlStr) return null;
            return new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
        } catch {
            return null;
        }
    });

    // ── Text Case Converter ──
    textCaseInput = signal('');
    textCaseOutput = signal('');

    convertTextCase(format: 'upper' | 'lower' | 'camel' | 'snake' | 'kebab' | 'pascal'): void {
        const text = this.textCaseInput();
        if (!text) return;
        switch (format) {
            case 'upper': this.textCaseOutput.set(text.toUpperCase()); break;
            case 'lower': this.textCaseOutput.set(text.toLowerCase()); break;
            case 'camel': this.textCaseOutput.set(text.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())); break;
            case 'snake': this.textCaseOutput.set(text.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()); break;
            case 'kebab': this.textCaseOutput.set(text.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()); break;
            case 'pascal': this.textCaseOutput.set(text.toLowerCase().replace(/(?:^|[^a-zA-Z0-9]+)(.)/g, (_, chr) => chr.toUpperCase())); break;
        }
        this.setCopyStatus(`Converted to ${format} case`);
    }

    // ── Number Base Converter ──
    numberBaseInput = signal('');
    numberBaseFrom = signal<number>(10);
    numberBaseTo = signal<number>(16);
    numberBaseOutput = signal('');

    convertNumberBase(): void {
        try {
            const input = this.numberBaseInput().trim();
            if (!input) {
                this.numberBaseOutput.set('');
                return;
            }
            const parsed = parseInt(input, this.numberBaseFrom());
            if (isNaN(parsed)) {
                this.numberBaseOutput.set('Invalid number for the selected base');
                return;
            }
            this.numberBaseOutput.set(parsed.toString(this.numberBaseTo()).toUpperCase());
        } catch {
            this.numberBaseOutput.set('Conversion error');
        }
    }

    // ── Random String ──
    randomStringLength = signal(16);
    randomStringOutput = signal('');
    randomStringIncludes = signal({ upper: true, lower: true, num: true, sym: true });

    generateRandomString(): void {
        const chars = {
            upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            lower: 'abcdefghijklmnopqrstuvwxyz',
            num: '0123456789',
            sym: '!@#$%^&*()_+-=[]{}|;:,.<>?'
        };
        const activeChars = Object.entries(this.randomStringIncludes())
            .filter(([_, active]) => active)
            .map(([key]) => chars[key as keyof typeof chars])
            .join('');
            
        if (!activeChars) {
            this.randomStringOutput.set('');
            return;
        }

        let result = '';
        for (let i = 0; i < this.randomStringLength(); i++) {
            result += activeChars.charAt(Math.floor(Math.random() * activeChars.length));
        }
        this.randomStringOutput.set(result);
        this.setCopyStatus('Random string generated');
    }

    toggleRandomStringInclude(type: 'upper' | 'lower' | 'num' | 'sym') {
        this.randomStringIncludes.update(current => ({ ...current, [type]: !current[type] }));
    }

    // ── Text Statistics ──
    textStatInput = signal('');
    textStatResult = computed(() => {
        const text = this.textStatInput();
        return {
            chars: text.length,
            charsNoSpaces: text.replace(/\s+/g, '').length,
            words: text.trim() ? text.trim().split(/\s+/).length : 0,
            lines: text ? text.split(/\r\n|\r|\n/).length : 0,
            bytes: new Blob([text]).size
        };
    });

    currentIso = computed(() => this.now().toISOString());
    currentLocal = computed(() => this.now().toLocaleString());
    currentEpochMs = computed(() => this.now().getTime());
    currentEpochSec = computed(() => Math.floor(this.now().getTime() / 1000));
    dateEpochMs = computed(() => this.toEpochMs(this.dateValue()));
    dateEpochSec = computed(() => Math.floor(this.toEpochMs(this.dateValue()) / 1000));
    datetimeEpochMs = computed(() => this.toEpochMs(this.datetimeValue()));
    datetimeEpochSec = computed(() => Math.floor(this.toEpochMs(this.datetimeValue()) / 1000));
    epochToDate = computed(() => this.convertEpochToDate(this.epochValue()));

    generateUuid(): void {
        const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : this.uuidFallback();
        this.uuidValue.set(uuid);
        this.setCopyStatus('UUID generated');
    }

    refreshNow(): void {
        const now = new Date();
        this.now.set(now);
        this.dateValue.set(this.formatDateInput(now));
        this.datetimeValue.set(this.formatDatetimeLocal(now));
        this.setCopyStatus('Timestamp refreshed');
    }

    copyText(value: string): void {
        if (!value) {
            this.setCopyStatus('Nothing to copy');
            return;
        }
        navigator.clipboard.writeText(value).then(() => {
            this.setCopyStatus('Copied to clipboard');
        }).catch(() => {
            this.setCopyStatus('Copy failed');
        });
    }

    updateEpochValue(value: string): void {
        this.epochValue.set(value.trim());
    }

    updateJsonInput(value: string): void {
        this.jsonInput.set(value);
    }

    formatJson(): void {
        try {
            const parsed: unknown = JSON.parse(this.jsonInput());
            this.jsonOutput.set(JSON.stringify(parsed, null, 2));
            this.setCopyStatus('JSON formatted');
        } catch {
            this.jsonOutput.set('Invalid JSON');
            this.setCopyStatus('JSON could not be parsed');
        }
    }

    minifyJson(): void {
        try {
            const parsed: unknown = JSON.parse(this.jsonInput());
            this.jsonOutput.set(JSON.stringify(parsed));
            this.setCopyStatus('JSON minified');
        } catch {
            this.jsonOutput.set('Invalid JSON');
            this.setCopyStatus('JSON could not be parsed');
        }
    }

    updateBase64Input(value: string): void {
        this.base64Input.set(value);
    }

    encodeBase64(): void {
        try {
            this.base64Output.set(btoa(unescape(encodeURIComponent(this.base64Input()))));
            this.setCopyStatus('Base64 encoded');
        } catch {
            this.base64Output.set('Unable to encode value');
        }
    }

    decodeBase64(): void {
        try {
            this.base64Output.set(decodeURIComponent(escape(atob(this.base64Input().trim()))));
            this.setCopyStatus('Base64 decoded');
        } catch {
            this.base64Output.set('Invalid Base64 value');
        }
    }

    updateUrlInput(value: string): void {
        this.urlInput.set(value);
    }

    encodeUrl(): void {
        this.urlOutput.set(encodeURIComponent(this.urlInput()));
        this.setCopyStatus('URL encoded');
    }

    decodeUrl(): void {
        try {
            this.urlOutput.set(decodeURIComponent(this.urlInput()));
            this.setCopyStatus('URL decoded');
        } catch {
            this.urlOutput.set('Invalid encoded URL value');
        }
    }

    updateHashInput(value: string): void {
        this.hashInput.set(value);
    }

    async generateSha256(): Promise<void> {
        if (typeof crypto === 'undefined' || !crypto.subtle) {
            this.hashOutput.set('SHA-256 is not available in this browser context');
            return;
        }

        const data = new TextEncoder().encode(this.hashInput());
        const digest = await crypto.subtle.digest('SHA-256', data);
        const bytes = Array.from(new Uint8Array(digest));
        this.hashOutput.set(bytes.map(byte => byte.toString(16).padStart(2, '0')).join(''));
        this.setCopyStatus('SHA-256 generated');
    }

    // ── HTML Entity Encode/Decode ──────────────────────────────────────
    encodeHtmlEntities(): void {
        const input = this.htmlEntityInput();
        const encoded = input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        this.htmlEntityOutput.set(encoded);
        this.setCopyStatus('HTML entities encoded');
    }

    decodeHtmlEntities(): void {
        const input = this.htmlEntityInput();
        const decoded = input
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#x27;/g, "'")
            .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCharCode(parseInt(dec, 10)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        this.htmlEntityOutput.set(decoded);
        this.setCopyStatus('HTML entities decoded');
    }

    // ── JWT Decoder ────────────────────────────────────────────────────
    decodeJwt(): void {
        const token = this.jwtInput().trim();
        this.jwtError.set('');
        this.jwtHeader.set('');
        this.jwtPayload.set('');

        if (!token) {
            this.jwtError.set('Please enter a JWT token');
            return;
        }

        const parts = token.split('.');
        if (parts.length < 2) {
            this.jwtError.set('Invalid JWT format — expected at least 2 dot-separated parts');
            return;
        }

        try {
            const header = JSON.parse(atob(this.base64UrlDecode(parts[0])));
            this.jwtHeader.set(JSON.stringify(header, null, 2));
        } catch {
            this.jwtError.set('Failed to decode JWT header');
            return;
        }

        try {
            const payload = JSON.parse(atob(this.base64UrlDecode(parts[1])));
            this.jwtPayload.set(JSON.stringify(payload, null, 2));
        } catch {
            this.jwtError.set('Failed to decode JWT payload');
            return;
        }

        this.setCopyStatus('JWT decoded');
    }

    private base64UrlDecode(str: string): string {
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }
        return base64;
    }

    // ── Lorem Ipsum Generator ──────────────────────────────────────────
    private readonly loremSentences = [
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
        'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
        'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.',
        'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit.',
        'Nulla facilisi etiam dignissim diam quis enim lobortis scelerisque fermentum.',
        'Viverra accumsan in nisl nisi scelerisque eu ultrices vitae auctor.',
        'Amet volutpat consequat mauris nunc congue nisi vitae suscipit tellus.',
        'Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.',
        'Faucibus scelerisque eleifend donec pretium vulputate sapien nec sagittis aliquam.',
        'Eget nulla facilisi etiam dignissim diam quis enim lobortis.',
        'Donec ultrices tincidunt arcu non sodales neque sodales ut etiam.',
        'Morbi tempus iaculis urna id volutpat lacus laoreet non curabitur.',
        'Pretium quam vulputate dignissim suspendisse in est ante in nibh.',
        'Adipiscing elit pellentesque habitant morbi tristique senectus et netus.',
    ];

    generateLorem(): void {
        const count = Math.max(1, Math.min(10, this.loremParagraphs()));
        const paragraphs: string[] = [];
        for (let p = 0; p < count; p++) {
            const sentenceCount = 3 + Math.floor(Math.random() * 4);
            const sentences: string[] = [];
            for (let s = 0; s < sentenceCount; s++) {
                sentences.push(this.loremSentences[Math.floor(Math.random() * this.loremSentences.length)]);
            }
            paragraphs.push(sentences.join(' '));
        }
        this.loremOutput.set(paragraphs.join('\n\n'));
        this.setCopyStatus('Lorem Ipsum generated');
    }

    // ── Text Diff ──────────────────────────────────────────────────────
    computeDiff(): void {
        const linesA = this.diffTextA().split('\n');
        const linesB = this.diffTextB().split('\n');
        const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [];

        const maxLen = Math.max(linesA.length, linesB.length);
        // Simple line-by-line diff
        const setB = new Set(linesB);
        const setA = new Set(linesA);

        // Use a basic LCS-style approach for small inputs
        const lcs = this.computeLCS(linesA, linesB);
        let ai = 0;
        let bi = 0;
        let li = 0;

        while (ai < linesA.length || bi < linesB.length) {
            if (li < lcs.length && ai < linesA.length && linesA[ai] === lcs[li]) {
                if (bi < linesB.length && linesB[bi] === lcs[li]) {
                    result.push({ type: 'same', text: lcs[li] });
                    ai++;
                    bi++;
                    li++;
                } else if (bi < linesB.length) {
                    result.push({ type: 'added', text: linesB[bi] });
                    bi++;
                } else {
                    result.push({ type: 'removed', text: linesA[ai] });
                    ai++;
                }
            } else if (ai < linesA.length && (li >= lcs.length || linesA[ai] !== lcs[li])) {
                result.push({ type: 'removed', text: linesA[ai] });
                ai++;
            } else if (bi < linesB.length) {
                result.push({ type: 'added', text: linesB[bi] });
                bi++;
            }
        }

        this.diffResult.set(result);
        this.setCopyStatus('Diff computed');
    }

    private computeLCS(a: string[], b: string[]): string[] {
        const m = a.length;
        const n = b.length;
        // Limit LCS computation for performance on large inputs
        if (m > 500 || n > 500) {
            // Fallback: just return common lines in order
            const result: string[] = [];
            let j = 0;
            for (let i = 0; i < m && j < n; i++) {
                while (j < n && b[j] !== a[i]) j++;
                if (j < n) { result.push(a[i]); j++; }
            }
            return result;
        }

        const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }

        const result: string[] = [];
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i - 1] === b[j - 1]) {
                result.unshift(a[i - 1]);
                i--;
                j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        return result;
    }

    // ── Regex Tester ───────────────────────────────────────────────────
    testRegex(): void {
        this.regexError.set('');
        this.regexMatches.set([]);
        const pattern = this.regexPattern();
        if (!pattern) {
            this.regexError.set('Please enter a regex pattern');
            return;
        }

        try {
            const regex = new RegExp(pattern, this.regexFlags());
            const input = this.regexInput();
            const matches: { match: string; index: number; groups: string[] }[] = [];

            if (this.regexFlags().includes('g')) {
                let match: RegExpExecArray | null;
                let safety = 0;
                while ((match = regex.exec(input)) !== null && safety < 1000) {
                    matches.push({
                        match: match[0],
                        index: match.index,
                        groups: match.slice(1),
                    });
                    if (match[0].length === 0) regex.lastIndex++;
                    safety++;
                }
            } else {
                const match = regex.exec(input);
                if (match) {
                    matches.push({
                        match: match[0],
                        index: match.index,
                        groups: match.slice(1),
                    });
                }
            }

            this.regexMatches.set(matches);
            this.setCopyStatus(`${matches.length} match${matches.length !== 1 ? 'es' : ''} found`);
        } catch (e) {
            this.regexError.set(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // ── Color Converter ────────────────────────────────────────────────
    updateColorFromHex(hex: string): void {
        if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{3}$/.test(hex)) {
            this.colorHex.set(hex);
        }
    }

    updateColorFromRgb(r: number, g: number, b: number): void {
        const hex = '#' + [r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
        this.colorHex.set(hex);
    }

    private hexToRgb(hex: string): { r: number; g: number; b: number } {
        let h = hex.replace('#', '');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const num = parseInt(h, 16);
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    private hexToHsl(hex: string): { h: number; s: number; l: number } {
        const { r, g, b } = this.hexToRgb(hex);
        const rn = r / 255, gn = g / 255, bn = b / 255;
        const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
        const l = (max + min) / 2;
        if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h = 0;
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (max === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    // ── Markdown Preview ───────────────────────────────────────────────
    private renderMarkdown(md: string): string {
        let html = md
            // Code blocks (must be before inline code)
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="md-code-block"><code>$2</code></pre>')
            // Inline code
            .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
            // Headers
            .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            // Bold and italic
            .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            // Blockquotes
            .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
            // Unordered lists
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            // Horizontal rule
            .replace(/^---$/gm, '<hr>')
            // Line breaks
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>');

        // Wrap consecutive <li> elements in <ul>
        html = html.replace(/((?:<li>.*?<\/li>(?:<br>)?)+)/g, '<ul>$1</ul>');
        // Clean up <br> inside <ul>
        html = html.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, inner: string) =>
            '<ul>' + inner.replace(/<br>/g, '') + '</ul>'
        );

        return html;
    }

    private toEpochMs(value: string): number {
        if (!value) return 0;
        const date = value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00`);
        return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    }

    private convertEpochToDate(value: string): string {
        const normalized = value.trim();
        if (!normalized) return '';

        const numberValue = Number(normalized);
        if (!Number.isFinite(numberValue)) {
            return 'Invalid timestamp';
        }

        const milliseconds = normalized.length <= 10 ? numberValue * 1000 : numberValue;
        const date = new Date(milliseconds);
        if (Number.isNaN(date.getTime())) {
            return 'Invalid timestamp';
        }

        return `${date.toISOString()} (${date.toLocaleString()})`;
    }

    private formatDateInput(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    private formatDatetimeLocal(date: Date): string {
        return date.toISOString().slice(0, 19);
    }

    private setCopyStatus(message: string): void {
        this.copyStatus.set(message);
        if (this.copyTimer !== null) {
            window.clearTimeout(this.copyTimer);
        }
        this.copyTimer = window.setTimeout(() => {
            this.copyStatus.set('');
            this.copyTimer = null;
        }, 2500);
    }

    private uuidFallback(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}
