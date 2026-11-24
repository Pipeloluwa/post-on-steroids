import { Component, signal, computed, inject, effect, ViewChild, viewChild, ElementRef, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/components/scrollable.select.component/scrollable.select.component';
import { TabStateService } from '../../../shared/services/tab.state.service';
import { MonacoEditorComponent } from '../../../shared/components/monaco-editor.component/monaco-editor.component';
import { TerminalDrawerComponent } from '../../../shared/components/terminal-drawer.component';
import { TerminalService } from '../../../shared/services/terminal.service';
import { APP_EDITION } from '../../../../environments/edition';

import { VariableService } from '../../../shared/services/variable.service';
import { NotificationService } from '../../../shared/services/notification.service';
import { DialogService } from '../../../shared/services/dialog.service';

import { WrapStyle, WRAP_STYLE_OPTIONS, formatBodyByStyle } from '../../../shared/utils/format.utils';
import {
    buildPreviewTree,
    PreviewTreeResult,
    PreviewPropertyNode,
    formatPreviewCellText,
    getPreviewScalarType,
    PreviewScalarType
} from '../../../shared/utils/response-preview.util';
import {
    inferJsonSchema,
    validateAgainstJsonSchema,
    computeResponseLineDiff,
    SchemaValidationResult,
    ResponseDiffResult
} from '../../../shared/utils/json-schema.util';

@Component({
    selector: 'app-response-viewer-component',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [CommonModule, FormsModule, MatIcon, ScrollableSelectComponent, MonacoEditorComponent, TerminalDrawerComponent],
    templateUrl: './response-viewer.component.html',
    styleUrl: './response-viewer.component.css',
    host: {
        '(document:mousemove)': 'onRightPanelResizeMove($event)',
        '(document:mouseup)': 'stopResizingRightPanel()'
    }
})
export class ResponseViewerComponent {
    tabStateService = inject(TabStateService);
    terminalService = inject(TerminalService);
    readonly appEdition = APP_EDITION;
    private variableService = inject(VariableService);
    private notificationService = inject(NotificationService);
    private sanitizer = inject(DomSanitizer);

    activeTab = signal('Body');

    constructor() {
        effect(() => {
            if (this.terminalService.isOpen()) {
                this.activeTab.set('Terminal');
            } else if (this.activeTab() === 'Terminal') {
                this.activeTab.set('Body');
            }
        });

        effect(() => {
            const schemaJson = this.inferredSchemaText();
            if (!this.isCustomSchemaEdited()) {
                this.editableSchemaText.set(schemaJson);
            }
        });
    }
    activeMode = computed<'Pretty' | 'Raw' | 'Preview'>(() => {
        const stateMode = this.tabState()?.responseActiveMode;
        if (stateMode === 'Preview' || stateMode === 'Visualize') return 'Preview';
        if (stateMode === 'Pretty' || stateMode === 'Raw') return stateMode;
        return 'Pretty';
    });
    visualizerFilter = signal<string>('');
    visualizerSortCol = signal<string>('');
    visualizerSortAsc = signal<boolean>(true);
    collapsedPreviewPaths = signal<Set<string>>(new Set());
    expandedPreviewCells = signal<Set<string>>(new Set());
    activeRightPanel = signal<'none' | 'schema' | 'compare'>('none');
    isCustomSchemaEdited = signal<boolean>(false);
    editableSchemaText = signal<string>('{}');
    selectedCompareExampleId = signal<string>('__baseline__');
    pinnedBaselineText = signal<string>('');
    responseSplitContainer = viewChild<ElementRef<HTMLElement>>('responseSplitContainer');
    rightPanelPercent = signal<number>(this.loadSavedRightPanelPercent());
    isResizingRightPanel = signal<boolean>(false);

    private loadSavedRightPanelPercent(): number {
        if (typeof localStorage === 'undefined') return 42;
        const saved = Number(localStorage.getItem('onsteroids_response_right_panel_pct'));
        return Number.isFinite(saved) && saved >= 20 && saved <= 75 ? saved : 42;
    }

    startResizingRightPanel(event: MouseEvent): void {
        event.preventDefault();
        this.isResizingRightPanel.set(true);
    }

    onRightPanelResizeMove(event: MouseEvent): void {
        if (!this.isResizingRightPanel()) return;
        const containerEl = this.responseSplitContainer()?.nativeElement;
        if (!containerEl) return;
        const rect = containerEl.getBoundingClientRect();
        if (rect.width <= 0) return;
        const rightPct = ((rect.right - event.clientX) / rect.width) * 100;
        this.rightPanelPercent.set(Math.max(20, Math.min(72, Math.round(rightPct * 10) / 10)));
    }

    stopResizingRightPanel(): void {
        if (!this.isResizingRightPanel()) return;
        this.isResizingRightPanel.set(false);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('onsteroids_response_right_panel_pct', String(this.rightPanelPercent()));
        }
    }
    manualResponseType = signal<string | null>(null);
    responseTypes = signal(['JSON', 'XML']);
    responseType = computed(() => {
        const manual = this.manualResponseType();
        if (manual) return manual;

        const body = this.responseBody();
        if (typeof body === 'string') {
            const trimmed = body.trim();
            if (trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && !trimmed.toLowerCase().startsWith('<!doctype'))) {
                return 'XML';
            }
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                return 'JSON';
            }
        }

        const headers = this.responseHeaders();
        const ctHeader = headers.find(h => h.key.toLowerCase() === 'content-type');
        if (ctHeader) {
            const val = ctHeader.value.toLowerCase();
            if (val.includes('xml') || val.includes('soap')) return 'XML';
            if (val.includes('json')) return 'JSON';
        }

        const reqRawType = (this.tabState()?.rawType || '').toUpperCase();
        if (reqRawType.includes('XML') || reqRawType.includes('SOAP')) {
            return 'XML';
        }

        return 'JSON';
    });
    
    wrapStyles = WRAP_STYLE_OPTIONS;
    wrapStyle = computed<WrapStyle>(() => {
        const stateStyle = this.tabState()?.responseWrapStyle as WrapStyle | undefined;
        if (stateStyle) return stateStyle;
        if (typeof localStorage !== 'undefined') {
            const saved = localStorage.getItem('onsteroids_response_wrap_style') as WrapStyle | null;
            if (saved && ['pretty', 'key-field', 'word-wrap', 'collapsed'].includes(saved)) return saved;
        }
        return 'word-wrap';
    });
    isWordWrap = computed(() => this.wrapStyle() === 'word-wrap' || this.wrapStyle() === 'collapsed');
    wrapResponse = computed(() => this.isWordWrap());
    wrapConsole = computed<boolean>(() => {
        const stateWrap = this.tabState()?.consoleWrap;
        if (stateWrap !== undefined) return stateWrap;
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('onsteroids_console_wrap') === 'true';
        }
        return false;
    });

    tabId = input.required<string>();
    tabState = computed(() => this.tabStateService.getState(this.tabId()));
    isLoading = computed(() => this.tabState()?.isLoading ?? false);

    // ── Derived from active tab state ──────────────────────────────────────
    responseBody = computed(() => this.tabState()?.responseBody ?? null);

    formattedResponseBody = computed(() => {
        const body = this.responseBody();
        if (body === null || body === undefined) {
            return '';
        }

        const style = this.wrapStyle();
        const type = this.responseType();
        
        if (style === 'pretty' || style === 'word-wrap') {
            return formatBodyByStyle(body, 'pretty', type);
        } else {
            const pretty = formatBodyByStyle(body, 'pretty', type);
            return formatBodyByStyle(pretty, style, type);
        }
    });
    responseStatus = computed(() => this.tabState()?.responseStatus ?? null);
    responseTime = computed(() => this.tabState()?.responseTime ?? null);
    responseSize = computed(() => this.tabState()?.responseSize ?? null);
    responseCookies = computed(() => this.tabState()?.responseCookies ?? []);
    responseHeaders = computed(() => this.tabState()?.responseHeaders ?? []);
    testResults = computed(() => this.tabState()?.testResults ?? []);

    hasResponse = computed(() => this.responseStatus() !== null);

    passedTests = computed(() => this.testResults().filter(t => t.passed).length);
    failedTests = computed(() => this.testResults().filter(t => !t.passed).length);

    encryptionConsole = computed(() => this.tabState()?.scripts?.encryptionConsole ?? '');

    tabs = computed(() => [
        { name: 'Body', count: null },
        { name: 'Cookies', count: this.responseCookies().length || null },
        { name: 'Headers', count: this.responseHeaders().filter(h => h.enabled).length || null },
        { name: 'Test', count: this.testResults().length || null },
        { name: 'Encryption', count: null },
        { name: 'Script', count: null },
        { name: 'Terminal', count: this.terminalService.lines().length || null },
    ]);

    // Script Console tab state
    activeScriptConsoleTab = signal<'preRequest' | 'postResponse'>('postResponse');
    scriptConsoleOptions = ['Pre-request Script', 'Post-response Script'];
    displayScriptConsoleTab = computed(() => this.activeScriptConsoleTab() === 'preRequest' ? 'Pre-request Script' : 'Post-response Script');
    activeScriptConsoleOutput = computed(() => {
        const scripts = this.tabState()?.scripts;
        if (!scripts) return '';
        return this.activeScriptConsoleTab() === 'preRequest' ? scripts.preRequestConsole : scripts.postResponseConsole;
    });

    setScriptConsoleTab(option: string) {
        if (option === 'Pre-request Script') this.activeScriptConsoleTab.set('preRequest');
        else if (option === 'Post-response Script') this.activeScriptConsoleTab.set('postResponse');
    }

    statusColor = computed(() => {
        const s = this.responseStatus();
        if (s === null) return '';
        if (s >= 200 && s < 300) return 'text-status-success bg-status-success/12';
        if (s >= 300 && s < 400) return 'text-status-warning bg-status-warning/12';
        if (s >= 400 && s < 500) return 'text-status-orange bg-status-orange/12';
        return 'text-status-danger bg-status-danger/12';
    });

    statusLabel = computed(() => {
        const s = this.responseStatus();
        if (s === null) return '';
        const labels: Record<number, string> = {
            0: 'Unreachable',
            200: 'OK', 201: 'Created', 204: 'No Content',
            301: 'Moved', 302: 'Found', 304: 'Not Modified',
            400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
            405: 'Method Not Allowed', 408: 'Request Timeout', 422: 'Unprocessable', 429: 'Too Many Requests',
            500: 'Server Error', 502: 'Bad Gateway', 503: 'Unavailable', 504: 'Gateway Timeout',
        };
        return `${s} ${labels[s] ?? ''}`.trim();
    });

    formattedSize = computed(() => {
        const b = this.responseSize();
        if (b === null) return '';
        if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
        if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
        return `${b} B`;
    });

    setTab(tab: string) {
        this.activeTab.set(tab);
        if (tab === 'Terminal') {
            this.terminalService.open();
        } else if (this.terminalService.isOpen()) {
            this.terminalService.close();
        }
    }
    setMode(mode: 'Pretty' | 'Raw' | 'Preview' | 'Visualize') {
        const normalized: 'Pretty' | 'Raw' | 'Preview' = mode === 'Visualize' ? 'Preview' : mode;
        if (typeof localStorage !== 'undefined' && normalized !== 'Preview') {
            localStorage.setItem('onsteroids_response_active_mode', normalized);
        }
        const id = this.tabId();
        if (id) {
            this.tabStateService.updateState(id, { responseActiveMode: normalized }, false);
        }
    }

    parsedResponseValue = computed<any>(() => {
        const body = this.responseBody();
        if (body === null || body === undefined) return null;
        if (typeof body === 'object') return body;
        if (typeof body === 'string') {
            const trimmed = body.trim();
            if (!trimmed) return null;
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    return JSON.parse(trimmed);
                } catch {
                    return null;
                }
            }
            if ((trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && !/^<!doctype\s+html|^<html\b/i.test(trimmed)))
                && typeof DOMParser !== 'undefined') {
                try {
                    const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
                    if (!doc.querySelector('parsererror') && doc.documentElement) {
                        return { [doc.documentElement.nodeName]: this.xmlElementToObject(doc.documentElement) };
                    }
                } catch { }
            }
        }
        return null;
    });

    private xmlElementToObject(el: Element): unknown {
        const children = Array.from(el.children);
        if (children.length === 0) {
            return (el.textContent ?? '').trim();
        }
        const result: Record<string, unknown> = {};
        for (const child of children) {
            const val = this.xmlElementToObject(child);
            const name = child.nodeName;
            if (name in result) {
                const existing = result[name];
                if (Array.isArray(existing)) {
                    existing.push(val);
                } else {
                    result[name] = [existing, val];
                }
            } else {
                result[name] = val;
            }
        }
        return result;
    }

    isHtmlResponse = computed<boolean>(() => {
        if (this.parsedResponseValue() !== null) return false;
        const body = this.responseBody();
        if (typeof body !== 'string') return false;
        const trimmed = body.trim().toLowerCase();
        return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || (trimmed.startsWith('<') && trimmed.includes('</') && !trimmed.startsWith('<?xml'));
    });

    sanitizedHtmlPreview = computed<SafeHtml>(() => {
        const body = this.responseBody();
        const html = typeof body === 'string' ? body : '';
        return this.sanitizer.bypassSecurityTrustHtml(html);
    });

    previewTree = computed<PreviewTreeResult>(() => {
        return buildPreviewTree(
            this.parsedResponseValue(),
            this.visualizerFilter(),
            this.visualizerSortCol(),
            this.visualizerSortAsc()
        );
    });

    togglePreviewNode(path: string) {
        this.collapsedPreviewPaths.update(set => {
            const next = new Set(set);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }

    isPreviewNodeCollapsed(path: string): boolean {
        return this.collapsedPreviewPaths().has(path);
    }

    collapseAllPreviewNodes() {
        const next = new Set<string>();
        const collect = (nodes: PreviewPropertyNode[]) => {
            for (const n of nodes) {
                if (n.kind !== 'scalar') {
                    next.add(n.path);
                    if (n.children) collect(n.children);
                }
            }
        };
        collect(this.previewTree().nodes);
        this.collapsedPreviewPaths.set(next);
    }

    expandAllPreviewNodes() {
        this.collapsedPreviewPaths.set(new Set());
        this.expandedPreviewCells.set(new Set());
    }

    togglePreviewCellExpand(cellKey: string, event: Event) {
        event.stopPropagation();
        this.expandedPreviewCells.update(set => {
            const next = new Set(set);
            if (next.has(cellKey)) next.delete(cellKey);
            else next.add(cellKey);
            return next;
        });
    }

    isPreviewCellExpanded(cellKey: string): boolean {
        return this.expandedPreviewCells().has(cellKey);
    }

    getCellScalarType(val: unknown): PreviewScalarType {
        return getPreviewScalarType(val);
    }

    isCellExpandable(val: unknown): boolean {
        return val !== null && typeof val === 'object';
    }

    getCellSummaryLabel(val: unknown): string {
        if (Array.isArray(val)) return `[${val.length}]`;
        if (val !== null && typeof val === 'object') return `{${Object.keys(val as object).length}}`;
        return formatPreviewCellText(val);
    }

    formatCellDisplay(val: unknown): string {
        return formatPreviewCellText(val);
    }

    getObjectEntriesList(val: unknown): Array<{ key: string; value: unknown; text: string; type: PreviewScalarType; isObject: boolean }> {
        if (Array.isArray(val)) {
            return val.slice(0, 50).map((item, idx) => ({
                key: String(idx),
                value: item,
                text: formatPreviewCellText(item),
                type: getPreviewScalarType(item),
                isObject: item !== null && typeof item === 'object'
            }));
        }
        if (val !== null && typeof val === 'object') {
            return Object.entries(val as Record<string, unknown>).slice(0, 50).map(([k, v]) => ({
                key: k,
                value: v,
                text: formatPreviewCellText(v),
                type: getPreviewScalarType(v),
                isObject: v !== null && typeof v === 'object'
            }));
        }
        return [];
    }

    // ── JSON Schema Inference & Validation ─────────────────────────────
    inferredSchema = computed(() => {
        const parsed = this.parsedResponseValue();
        if (parsed === null || parsed === undefined) return null;
        return inferJsonSchema(parsed);
    });

    inferredSchemaText = computed(() => {
        const schema = this.inferredSchema();
        if (!schema) return '{}';
        return JSON.stringify(schema, null, 2);
    });

    schemaValidationResult = computed<SchemaValidationResult & { parseError?: string }>(() => {
        const parsed = this.parsedResponseValue();
        if (parsed === null || parsed === undefined) {
            return { valid: false, errors: [], parseError: 'Response body is not valid JSON/XML' };
        }
        try {
            const schemaObj = JSON.parse(this.editableSchemaText() || '{}');
            return validateAgainstJsonSchema(parsed, schemaObj);
        } catch (err: any) {
            return {
                valid: false,
                errors: [],
                parseError: `Invalid JSON Schema syntax: ${err?.message || 'Parse error'}`
            };
        }
    });

    toggleSchemaPanel() {
        if (this.activeRightPanel() === 'schema') {
            this.activeRightPanel.set('none');
            return;
        }
        if (!this.isCustomSchemaEdited()) {
            this.editableSchemaText.set(this.inferredSchemaText());
        }
        this.activeRightPanel.set('schema');
    }

    onSchemaTextChange(val: string) {
        this.isCustomSchemaEdited.set(true);
        this.editableSchemaText.set(val ?? '{}');
    }

    resetToInferredSchema() {
        this.isCustomSchemaEdited.set(false);
        this.editableSchemaText.set(this.inferredSchemaText());
    }

    copySchema() {
        this.copyToClipboard(this.editableSchemaText(), 'JSON Schema copied to clipboard', 'schema');
    }

    // ── Response Compare / Diff ────────────────────────────────────────
    savedExamples = computed<Array<{ id: string; name: string; status: number | null; bodyText: string }>>(() => {
        const state = this.tabState();
        const reqId = state?.id || this.tabId();
        const rawList = reqId ? (this.tabStateService.requestExamplesMap().get(reqId) || []) : [];
        return rawList.map(ex => {
            let snap: any = {};
            try {
                snap = typeof ex.requestSnapshot === 'string' ? JSON.parse(ex.requestSnapshot) : (ex.requestSnapshot || {});
            } catch { }
            const rb = snap.responseBody;
            let bodyText = '';
            if (rb !== null && rb !== undefined) {
                bodyText = typeof rb === 'string' ? rb : JSON.stringify(rb, null, 2);
                try {
                    const parsed = typeof rb === 'string' ? JSON.parse(rb) : rb;
                    bodyText = JSON.stringify(parsed, null, 2);
                } catch { }
            }
            return {
                id: String(ex.id),
                name: String(ex.name || 'Example'),
                status: snap.responseStatus ?? null,
                bodyText
            };
        });
    });

    toggleComparePanel() {
        if (this.activeRightPanel() === 'compare') {
            this.activeRightPanel.set('none');
            return;
        }
        const reqId = this.tabState()?.id || this.tabId();
        if (reqId) {
            this.tabStateService.getExamples(reqId).catch(() => { });
        }
        const examples = this.savedExamples();
        if (examples.length > 0 && this.selectedCompareExampleId() === '__baseline__' && !this.pinnedBaselineText()) {
            this.selectedCompareExampleId.set(examples[0].id);
        }
        this.activeRightPanel.set('compare');
    }

    pinCurrentAsBaseline() {
        const text = this.formattedResponseBody() || (typeof this.responseBody() === 'string' ? String(this.responseBody()) : JSON.stringify(this.responseBody() ?? '', null, 2));
        this.pinnedBaselineText.set(text);
        this.selectedCompareExampleId.set('__baseline__');
        this.notificationService.notify('Pinned current response as compare baseline');
    }

    compareBaselineText = computed<string>(() => {
        const selectedId = this.selectedCompareExampleId();
        if (selectedId === '__baseline__') {
            return this.pinnedBaselineText();
        }
        const match = this.savedExamples().find(ex => ex.id === selectedId);
        return match?.bodyText ?? '';
    });

    responseDiff = computed<ResponseDiffResult>(() => {
        const expected = this.compareBaselineText();
        const parsed = this.parsedResponseValue();
        const actual = parsed !== null && parsed !== undefined
            ? JSON.stringify(parsed, null, 2)
            : (this.formattedResponseBody() || '');
        return computeResponseLineDiff(expected, actual);
    });

    closeRightPanel() {
        this.activeRightPanel.set('none');
    }

    visualizerData = computed<{
        kind: 'table' | 'kv' | 'empty';
        columns: string[];
        rows: Record<string, string>[];
        totalCount: number;
        sourceLabel: string;
    }>(() => {
        const parsed = this.parsedResponseValue();
        if (parsed === null || parsed === undefined) {
            return { kind: 'empty', columns: [], rows: [], totalCount: 0, sourceLabel: '' };
        }

        const formatCell = (val: any): string => {
            if (val === null) return 'null';
            if (val === undefined) return '';
            if (typeof val === 'object') {
                const s = JSON.stringify(val);
                return s.length > 180 ? `${s.slice(0, 177)}...` : s;
            }
            return String(val);
        };

        let targetArr: any[] | null = null;
        let sourceLabel = 'Root Array';

        if (Array.isArray(parsed)) {
            targetArr = parsed;
        } else if (typeof parsed === 'object') {
            const preferredKeys = ['data', 'items', 'results', 'records', 'value', 'rows', 'list'];
            for (const key of preferredKeys) {
                if (Array.isArray(parsed[key])) {
                    targetArr = parsed[key];
                    sourceLabel = `data.${key}`.replace(/^data\./, '');
                    break;
                }
            }
            if (!targetArr) {
                const firstArrayEntry = Object.entries(parsed).find(([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object');
                if (firstArrayEntry) {
                    targetArr = firstArrayEntry[1] as any[];
                    sourceLabel = firstArrayEntry[0];
                }
            }
        }

        const filter = this.visualizerFilter().trim().toLowerCase();
        const sortCol = this.visualizerSortCol();
        const sortAsc = this.visualizerSortAsc();

        if (targetArr && targetArr.length > 0) {
            const colSet = new Set<string>();
            const isObjectItems = targetArr.some(item => item !== null && typeof item === 'object' && !Array.isArray(item));
            const rawRows: Record<string, string>[] = [];

            if (isObjectItems) {
                for (const item of targetArr.slice(0, 500)) {
                    if (item && typeof item === 'object' && !Array.isArray(item)) {
                        for (const k of Object.keys(item)) colSet.add(k);
                    }
                }
                const cols = Array.from(colSet);
                for (const item of targetArr.slice(0, 500)) {
                    const row: Record<string, string> = {};
                    for (const c of cols) {
                        row[c] = item && typeof item === 'object' ? formatCell(item[c]) : formatCell(item);
                    }
                    rawRows.push(row);
                }
                const filtered = filter
                    ? rawRows.filter(r => cols.some(c => (r[c] || '').toLowerCase().includes(filter)))
                    : rawRows;
                const sorted = sortCol && cols.includes(sortCol)
                    ? [...filtered].sort((a, b) => {
                        const cmp = (a[sortCol] || '').localeCompare(b[sortCol] || '', undefined, { numeric: true });
                        return sortAsc ? cmp : -cmp;
                    })
                    : filtered;
                return { kind: 'table', columns: cols, rows: sorted, totalCount: targetArr.length, sourceLabel };
            }

            const cols = ['Index', 'Value', 'Type'];
            for (let i = 0; i < Math.min(targetArr.length, 500); i++) {
                const item = targetArr[i];
                rawRows.push({
                    Index: String(i),
                    Value: formatCell(item),
                    Type: item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item
                });
            }
            const filtered = filter
                ? rawRows.filter(r => cols.some(c => (r[c] || '').toLowerCase().includes(filter)))
                : rawRows;
            return { kind: 'table', columns: cols, rows: filtered, totalCount: targetArr.length, sourceLabel };
        }

        if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            const cols = ['Key', 'Value', 'Type'];
            const entries = Object.entries(parsed).map(([k, v]) => ({
                Key: k,
                Value: formatCell(v),
                Type: v === null ? 'null' : Array.isArray(v) ? `array (${v.length})` : typeof v
            }));
            const filtered = filter
                ? entries.filter(r => r.Key.toLowerCase().includes(filter) || r.Value.toLowerCase().includes(filter))
                : entries;
            const sorted = sortCol && cols.includes(sortCol)
                ? [...filtered].sort((a, b) => {
                    const key = sortCol as keyof typeof a;
                    const cmp = a[key].localeCompare(b[key], undefined, { numeric: true });
                    return sortAsc ? cmp : -cmp;
                })
                : filtered;
            return { kind: 'kv', columns: cols, rows: sorted, totalCount: entries.length, sourceLabel: 'JSON Object' };
        }

        return { kind: 'empty', columns: [], rows: [], totalCount: 0, sourceLabel: '' };
    });

    onVisualizerFilterChange(val: string) {
        this.visualizerFilter.set(val || '');
    }

    toggleVisualizerSort(col: string) {
        if (this.visualizerSortCol() === col) {
            this.visualizerSortAsc.update(v => !v);
        } else {
            this.visualizerSortCol.set(col);
            this.visualizerSortAsc.set(true);
        }
    }
    setResponseType(type: string) { this.manualResponseType.set(type); }

    clearResponseBody() {
        const id = this.tabId();
        if (!id) return;
        this.manualResponseType.set(null);
        this.tabStateService.clearCachedResponseFields(id, { body: true });
    }

    clearCookies() {
        const id = this.tabId();
        if (!id) return;
        this.tabStateService.clearCachedResponseFields(id, { cookies: true });
    }

    clearHeaders() {
        const id = this.tabId();
        if (!id) return;
        this.tabStateService.clearCachedResponseFields(id, { headers: true });
    }

    clearTestResults() {
        const id = this.tabId();
        if (!id) return;
        this.tabStateService.clearCachedResponseFields(id, { testResults: true });
    }

    clearEncryptionConsole() {
        const id = this.tabId();
        if (!id) return;
        this.tabStateService.clearCachedResponseFields(id, { encryptionConsole: true });
    }

    clearScriptConsole() {
        const id = this.tabId();
        if (!id) return;
        const isPre = this.activeScriptConsoleTab() === 'preRequest';
        this.tabStateService.clearCachedResponseFields(id, isPre ? { preRequestConsole: true } : { postResponseConsole: true });
    }


    @ViewChild(MonacoEditorComponent) monacoEditor?: MonacoEditorComponent;

    private setWrapStyle(style: WrapStyle) {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('onsteroids_response_wrap_style', style);
        }
        const id = this.tabId();
        if (id) {
            this.tabStateService.updateState(id, { responseWrapStyle: style }, false);
        }
    }

    wrapPretty() {
        this.setWrapStyle('pretty');
    }

    wrapKeyField() {
        this.setWrapStyle('key-field');
    }

    wrapSoft() {
        this.setWrapStyle('word-wrap');
    }

    wrapCollapsed() {
        this.setWrapStyle('collapsed');
    }

    addResponseToVariable() {
        // Extract key & value from cursor position or text selection in Monaco editor
        const extracted = this.monacoEditor?.extractCurrentKeyValue()
            || MonacoEditorComponent.lastFocusedEditor?.extractCurrentKeyValue();

        let key = extracted?.key || '';
        let value = extracted?.value || '';
        const body = this.responseBody();

        // If no key extracted from cursor, fallback to sensible defaults
        if (!key) {
            if (typeof body === 'object' && body !== null) {
                const keys = Object.keys(body);
                if (keys.length > 0) {
                    key = keys[0];
                    const val = (body as any)[key];
                    value = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
                } else {
                    key = 'responseBody';
                    value = JSON.stringify(body);
                }
            } else if (body !== null && body !== undefined) {
                key = 'response';
                value = String(body);
            } else {
                key = 'responseVar';
                value = '';
            }
        }

        const fullPath = this.findPathInObject(body, key, value);
        const state = this.tabState();
        this.variableService.openAddModal(key, value, {
            tabId: this.tabId(),
            requestId: state?.id,
            requestName: state?.name,
            requestUrl: state?.url,
            type: 'response',
            propertyKey: fullPath || key
        });
    }

    private findPathInObject(obj: any, targetKey: string, targetVal?: string): string | null {
        if (!obj || typeof obj !== 'object' || !targetKey) return null;
        let parsed = obj;
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { return null; }
        }
        if (!parsed || typeof parsed !== 'object') return null;

        const lowerKey = targetKey.toLowerCase();

        function search(curr: any, path: string[], matchValue: boolean): string | null {
            if (!curr || typeof curr !== 'object') return null;

            if (Array.isArray(curr)) {
                for (let i = 0; i < curr.length; i++) {
                    const res = search(curr[i], [...path, String(i)], matchValue);
                    if (res) return res;
                }
                return null;
            }

            for (const k of Object.keys(curr)) {
                if (k.toLowerCase() === lowerKey) {
                    if (matchValue && targetVal !== undefined && targetVal !== '') {
                        const v = curr[k];
                        const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
                        if (s === targetVal) {
                            return [...path, k].join('.');
                        }
                    } else {
                        return [...path, k].join('.');
                    }
                }
            }

            for (const k of Object.keys(curr)) {
                const child = curr[k];
                if (child && typeof child === 'object') {
                    const res = search(child, [...path, k], matchValue);
                    if (res) return res;
                }
            }

            return null;
        }

        return search(parsed, [], true) || search(parsed, [], false);
    }

    dialogService = inject(DialogService);

    async saveAsExample() {
        const defaultName = `Example - ${new Date().toLocaleTimeString()}`;
        const name = await this.dialogService.prompt('Enter name for this request/response example:', defaultName);
        if (!name || !name.trim()) return;

        const state = this.tabState();
        if (!state) return;

        try {
            await this.tabStateService.createExample(this.tabId(), name.trim(), {
                method: state.method,
                url: state.url,
                params: state.params,
                headers: state.headers,
                rawBody: state.rawBody,
                responseBody: this.responseBody(),
                responseStatus: this.responseStatus(),
                responseTime: this.responseTime(),
                responseSize: this.responseSize(),
                responseHeaders: this.responseHeaders()
            });
            // Intentionally silent on success as requested
        } catch (e: any) {
            this.notificationService.notify(`Failed to save example: ${e.message || 'Error'}`);
        }
    }

    copyResponse() {
        const formatted = this.formattedResponseBody();
        const raw = this.responseBody();
        const data = formatted || (raw !== null && raw !== undefined ? (typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)) : '');
        this.copyToClipboard(data, 'Response copied to clipboard', 'response');
    }

    copyEncryptionConsole() {
        this.copyToClipboard(this.encryptionConsole(), 'Encryption console copied to clipboard', 'encryption-console');
    }

    copyScriptConsole() {
        this.copyToClipboard(this.activeScriptConsoleOutput(), 'Script console copied to clipboard', 'script-console');
    }

    copyTestResults() {
        const results = this.testResults().map(t => `${t.passed ? '✓' : '✗'} ${t.name}`).join('\n');
        this.copyToClipboard(results, 'Test results copied to clipboard', 'test-results');
    }

    copyHeaders() {
        const hdrs = this.responseHeaders().filter(h => h.enabled).map(h => `${h.key}: ${h.value}`).join('\n');
        this.copyToClipboard(hdrs, 'Headers copied to clipboard', 'headers');
    }

    copyCookies() {
        const cks = this.responseCookies().map(c => `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}; Expires=${c.expires}`).join('\n');
        this.copyToClipboard(cks, 'Cookies copied to clipboard', 'cookies');
    }

    copiedButton = signal<string | null>(null);
    private copiedTimeout: any = null;

    private setCopiedButton(key?: string) {
        if (!key) return;
        if (this.copiedTimeout) {
            clearTimeout(this.copiedTimeout);
        }
        this.copiedButton.set(key);
        this.copiedTimeout = setTimeout(() => {
            this.copiedButton.set(null);
            this.copiedTimeout = null;
        }, 2000);
    }

    private copyToClipboard(text: string, message = 'Copied to clipboard', key?: string) {
        if (!text) {
            this.notificationService.notify('Nothing to copy');
            return;
        }
        navigator.clipboard.writeText(text);
        this.notificationService.notify(message);
        this.setCopiedButton(key);
    }

    toggleConsoleWrap() {
        const next = !this.wrapConsole();
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('onsteroids_console_wrap', String(next));
        }
        const id = this.tabId();
        if (id) {
            this.tabStateService.updateState(id, { consoleWrap: next }, false);
        }
    }
}
