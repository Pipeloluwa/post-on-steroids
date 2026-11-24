import { PreviewPropertyNode } from './response-preview.util';

export type VisualizerChartType =
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'graph'
  | 'table'
  | 'kpi'
  | 'custom';

export interface VisualizerDataPoint {
  index: number;
  label: string;
  value: number;
  xValue?: number;
  rawRow: Record<string, any>;
  color: string;
}

export interface VisualizerKpiStat {
  field: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

export interface VisualizerGraphNode {
  id: string;
  label: string;
  sublabel: string;
  depth: number;
  x: number;
  y: number;
  kind: 'root' | 'array' | 'object' | 'field';
}

export interface VisualizerGraphEdge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface VisualizerExtractedDataset {
  sourcePath: string;
  availableArrays: { path: string; label: string; rows: Record<string, any>[] }[];
  rows: Record<string, any>[];
  columns: string[];
  categoricalFields: string[];
  numericFields: string[];
  kpiStats: VisualizerKpiStat[];
}

const CHART_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1'  // indigo
];

function isPlainRecord(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function parseVisualizerSourceData(rawBody: any): any {
  if (rawBody === null || rawBody === undefined) return null;
  if (typeof rawBody === 'object') return rawBody;
  if (typeof rawBody !== 'string') return rawBody;
  const trimmed = rawBody.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

function collectObjectArrays(
  node: any,
  path: string,
  out: { path: string; label: string; rows: Record<string, any>[] }[],
  depth = 0
): void {
  if (depth > 5 || node === null || node === undefined) return;

  if (Array.isArray(node)) {
    const objRows = node.filter(item => isPlainRecord(item)) as Record<string, any>[];
    if (objRows.length > 0) {
      out.push({
        path: path || 'root',
        label: path ? `${path} (${objRows.length})` : `Root Array (${objRows.length})`,
        rows: objRows
      });
    } else if (node.length > 0 && node.every(item => item === null || typeof item !== 'object')) {
      const scalarRows = node.map((v, idx) => ({ index: idx, label: `Item ${idx}`, value: v }));
      out.push({
        path: path || 'root',
        label: path ? `${path} (${scalarRows.length})` : `Root Values (${scalarRows.length})`,
        rows: scalarRows
      });
    }
    return;
  }

  if (isPlainRecord(node)) {
    for (const [k, v] of Object.entries(node)) {
      const childPath = path ? `${path}.${k}` : k;
      collectObjectArrays(v, childPath, out, depth + 1);
    }
  }
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const cleaned = val.trim().replace(/,/g, '');
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  if (typeof val === 'boolean') return val ? 1 : 0;
  return null;
}

export function extractVisualizerDataset(
  parsedData: any,
  preferredArrayPath?: string | null
): VisualizerExtractedDataset {
  const empty: VisualizerExtractedDataset = {
    sourcePath: '',
    availableArrays: [],
    rows: [],
    columns: [],
    categoricalFields: [],
    numericFields: [],
    kpiStats: []
  };

  if (parsedData === null || parsedData === undefined) return empty;

  const availableArrays: { path: string; label: string; rows: Record<string, any>[] }[] = [];
  collectObjectArrays(parsedData, '', availableArrays);

  // Also synthesize a key-value summary table for flat or top-level object metrics
  if (isPlainRecord(parsedData)) {
    const flatEntries = Object.entries(parsedData)
      .filter(([, v]) => v === null || typeof v !== 'object')
      .map(([k, v]) => ({ key: k, value: v }));
    if (flatEntries.length > 0 && availableArrays.length === 0) {
      availableArrays.push({
        path: '__object_fields__',
        label: `Response Fields (${flatEntries.length})`,
        rows: flatEntries
      });
    }
  }

  if (availableArrays.length === 0) return empty;

  const chosen =
    (preferredArrayPath && availableArrays.find(a => a.path === preferredArrayPath)) ||
    availableArrays[0];

  const rows = chosen.rows;
  const colSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) colSet.add(k);
  }
  const columns = Array.from(colSet);

  const numericFields: string[] = [];
  const categoricalFields: string[] = [];

  for (const col of columns) {
    let numericHits = 0;
    let nonEmptyHits = 0;
    for (const r of rows.slice(0, 60)) {
      const val = r[col];
      if (val !== undefined && val !== null && val !== '') {
        nonEmptyHits++;
        if (toFiniteNumber(val) !== null && typeof val !== 'boolean') {
          numericHits++;
        }
      }
    }
    if (nonEmptyHits > 0 && numericHits >= Math.ceil(nonEmptyHits * 0.6)) {
      numericFields.push(col);
    }
    categoricalFields.push(col);
  }

  const kpiStats: VisualizerKpiStat[] = numericFields.map(field => {
    const nums = rows
      .map(r => toFiniteNumber(r[field]))
      .filter((n): n is number => n !== null);
    const count = nums.length;
    const sum = nums.reduce((acc, n) => acc + n, 0);
    return {
      field,
      count,
      sum: Math.round(sum * 100) / 100,
      avg: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
      min: count > 0 ? Math.min(...nums) : 0,
      max: count > 0 ? Math.max(...nums) : 0
    };
  });

  return {
    sourcePath: chosen.path,
    availableArrays,
    rows,
    columns,
    categoricalFields,
    numericFields,
    kpiStats
  };
}

export function buildChartSeries(
  dataset: VisualizerExtractedDataset,
  labelField: string,
  valueField: string,
  maxPoints = 32
): VisualizerDataPoint[] {
  if (!dataset || dataset.rows.length === 0) return [];
  const lField = labelField || dataset.categoricalFields[0] || dataset.columns[0] || '';
  const vField = valueField || dataset.numericFields[0] || '';

  return dataset.rows.slice(0, maxPoints).map((row, idx) => {
    const rawLabel = lField ? row[lField] : `#${idx + 1}`;
    const label =
      rawLabel === null || rawLabel === undefined || rawLabel === ''
        ? `#${idx + 1}`
        : String(rawLabel);

    const parsedVal = vField ? toFiniteNumber(row[vField]) : null;
    const value = parsedVal !== null ? parsedVal : 1;
    const parsedX = lField ? toFiniteNumber(row[lField]) : idx;

    return {
      index: idx,
      label: label.length > 20 ? label.slice(0, 18) + '..' : label,
      value,
      xValue: parsedX !== null ? parsedX : idx,
      rawRow: row,
      color: CHART_PALETTE[idx % CHART_PALETTE.length]
    };
  });
}

export function buildResponseRelationshipGraph(parsedData: any): {
  nodes: VisualizerGraphNode[];
  edges: VisualizerGraphEdge[];
  width: number;
  height: number;
} {
  const nodes: VisualizerGraphNode[] = [];
  const edges: VisualizerGraphEdge[] = [];
  if (parsedData === null || parsedData === undefined) {
    return { nodes, edges, width: 640, height: 300 };
  }

  let rowCursor = 0;
  const colSpacing = 210;
  const rowSpacing = 44;

  const walk = (
    val: any,
    label: string,
    depth: number,
    parentId: string | null,
    idPrefix: string
  ): number => {
    if (nodes.length >= 42 || depth > 3) return rowCursor;
    const nodeId = idPrefix;

    let kind: VisualizerGraphNode['kind'] = depth === 0 ? 'root' : 'field';
    let sublabel = '';
    if (Array.isArray(val)) {
      kind = 'array';
      sublabel = `Array [${val.length}]`;
    } else if (isPlainRecord(val)) {
      kind = depth === 0 ? 'root' : 'object';
      sublabel = `{ ${Object.keys(val).length} keys }`;
    } else {
      kind = 'field';
      const str = val === null ? 'null' : String(val);
      sublabel = str.length > 26 ? str.slice(0, 24) + '..' : str;
    }

    const startRow = rowCursor;
    const myIdx = nodes.length;
    nodes.push({
      id: nodeId,
      label: label.length > 24 ? label.slice(0, 22) + '..' : label,
      sublabel,
      depth,
      x: 24 + depth * colSpacing,
      y: 28 + startRow * rowSpacing,
      kind
    });

    if (depth < 3 && isPlainRecord(val)) {
      const entries = Object.entries(val).slice(0, 12);
      if (entries.length === 0) {
        rowCursor++;
      } else {
        for (const [k, childVal] of entries) {
          walk(childVal, k, depth + 1, nodeId, `${nodeId}.${k}`);
        }
        const firstChild = nodes.find(n => n.id === `${nodeId}.${entries[0][0]}`);
        const lastChild = nodes.filter(n => n.depth === depth + 1).slice(-1)[0];
        if (firstChild && lastChild) {
          nodes[myIdx].y = Math.round((firstChild.y + lastChild.y) / 2);
        }
      }
    } else if (depth < 3 && Array.isArray(val)) {
      const sample = val.slice(0, 6);
      if (sample.length === 0) {
        rowCursor++;
      } else {
        sample.forEach((item, idx) => {
          walk(item, `[${idx}]`, depth + 1, nodeId, `${nodeId}[${idx}]`);
        });
        const firstChild = nodes.find(n => n.id === `${nodeId}[0]`);
        const lastChild = nodes.filter(n => n.depth === depth + 1).slice(-1)[0];
        if (firstChild && lastChild) {
          nodes[myIdx].y = Math.round((firstChild.y + lastChild.y) / 2);
        }
      }
    } else {
      rowCursor++;
    }

    if (parentId) {
      const pNode = nodes.find(n => n.id === parentId);
      const cNode = nodes[myIdx];
      if (pNode && cNode) {
        edges.push({
          fromX: pNode.x + 150,
          fromY: pNode.y + 16,
          toX: cNode.x,
          toY: cNode.y + 16
        });
      }
    }

    return rowCursor;
  };

  walk(parsedData, Array.isArray(parsedData) ? 'Response Array' : 'Response Root', 0, null, 'root');
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + 52), 260);
  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + 190), 680);

  return { nodes, edges, width: maxX, height: maxY };
}

/**
 * Compiles a Postman-style HTML template + JSON payload into a safe standalone HTML document
 * supporting {{var}} substitution, simple {{#each items}}...{{/each}} loops, and pm.getData(cb).
 */
export function compilePostmanVisualizerHtml(template: string, data: any): string {
  const safeTemplate = String(template || '');
  const payload = isPlainRecord(data) || Array.isArray(data) ? data : { data };

  const resolvePath = (ctx: any, pathExpr: string): any => {
    const clean = pathExpr.trim();
    if (!clean || clean === 'this' || clean === '.') return ctx;
    let cur = ctx;
    for (const part of clean.split('.')) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  };

  const escapeHtml = (val: unknown): string =>
    String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const renderBlock = (tpl: string, ctx: any): string => {
    let out = tpl.replace(/\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, pathExpr, inner) => {
      const target = resolvePath(ctx, pathExpr);
      if (!Array.isArray(target)) return '';
      return target.map(item => renderBlock(inner, isPlainRecord(item) ? item : { this: item })).join('\n');
    });
    out = out.replace(/\{\{\{\s*([^}]+)\s*\}\}\}/g, (_m, pathExpr) => String(resolvePath(ctx, pathExpr) ?? ''));
    out = out.replace(/\{\{\s*([^#/][^}]*)\s*\}\}/g, (_m, pathExpr) => escapeHtml(resolvePath(ctx, pathExpr) ?? ''));
    return out;
  };

  const renderedBody = renderBlock(safeTemplate, payload);
  const serializedData = JSON.stringify(payload).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 12px; color: #e2e8f0; background: #0f172a; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #334155; padding: 6px 10px; text-align: left; }
  th { background: #1e293b; font-weight: 600; }
</style>
<script>
  window.__OS_VISUALIZER_DATA__ = ${serializedData};
  window.pm = window.pm || {};
  window.pm.getData = function(cb) {
    if (typeof cb === 'function') cb(null, window.__OS_VISUALIZER_DATA__);
    return window.__OS_VISUALIZER_DATA__;
  };
  window.st = window.st || { visualizer: {}, getData: window.pm.getData };
</script>
</head>
<body>
${renderedBody}
</body>
</html>`;
}
