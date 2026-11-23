export type PreviewScalarType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';

export interface PreviewPropertyNode {
    key: string;
    path: string;
    kind: 'scalar' | 'object-array' | 'scalar-array' | 'object';
    scalarValue?: unknown;
    scalarDisplay?: string;
    scalarType?: PreviewScalarType;
    itemCount?: number;
    columns?: string[];
    rows?: Record<string, unknown>[];
    scalarItems?: unknown[];
    children?: PreviewPropertyNode[];
}

export interface PreviewTreeResult {
    rootKind: 'object' | 'array' | 'scalar' | 'empty';
    nodes: PreviewPropertyNode[];
    totalNodes: number;
    rootScalar?: {
        value: unknown;
        display: string;
        type: PreviewScalarType;
    };
}

export function getPreviewScalarType(val: unknown): PreviewScalarType {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'boolean') return 'boolean';
    if (typeof val === 'number') return 'number';
    return 'string';
}

export function formatPreviewCellText(val: unknown): string {
    if (val === null) return 'null';
    if (val === undefined) return '';
    if (typeof val === 'object') {
        try {
            return JSON.stringify(val);
        } catch {
            return String(val);
        }
    }
    return String(val);
}

function matchesFilterText(val: unknown, filterLower: string): boolean {
    if (!filterLower) return true;
    if (val === null) return 'null'.includes(filterLower);
    if (val === undefined) return false;
    if (typeof val !== 'object') {
        return String(val).toLowerCase().includes(filterLower);
    }
    if (Array.isArray(val)) {
        return val.some(item => matchesFilterText(item, filterLower));
    }
    return Object.entries(val as Record<string, unknown>).some(
        ([k, v]) => k.toLowerCase().includes(filterLower) || matchesFilterText(v, filterLower)
    );
}

function sortRowsByColumn(
    rows: Record<string, unknown>[],
    sortCol: string,
    sortAsc: boolean
): Record<string, unknown>[] {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : (sortAsc ? 1 : -1);
        if (bv === null || bv === undefined) return sortAsc ? -1 : 1;
        if (typeof av === 'number' && typeof bv === 'number') {
            return sortAsc ? av - bv : bv - av;
        }
        const cmp = formatPreviewCellText(av).localeCompare(formatPreviewCellText(bv), undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
    });
}

function buildArrayNode(
    key: string,
    path: string,
    arr: unknown[],
    filterLower: string,
    sortCol: string,
    sortAsc: boolean
): PreviewPropertyNode {
    const capped = arr.slice(0, 500);
    const hasObjects = capped.some(item => item !== null && typeof item === 'object' && !Array.isArray(item));

    if (hasObjects) {
        const colSet = new Set<string>();
        for (const item of capped) {
            if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                for (const k of Object.keys(item as Record<string, unknown>)) {
                    colSet.add(k);
                }
            }
        }
        const columns = Array.from(colSet);
        const normalizedRows: Record<string, unknown>[] = capped.map(item => {
            if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                return item as Record<string, unknown>;
            }
            return { value: item };
        });
        if (!columns.length && normalizedRows.length > 0) {
            columns.push('value');
        }

        const filteredRows = filterLower && !key.toLowerCase().includes(filterLower)
            ? normalizedRows.filter(r =>
                columns.some(c => matchesFilterText(r[c], filterLower))
            )
            : normalizedRows;

        const sortedRows = sortCol && columns.includes(sortCol)
            ? sortRowsByColumn(filteredRows, sortCol, sortAsc)
            : filteredRows;

        return {
            key,
            path,
            kind: 'object-array',
            itemCount: arr.length,
            columns,
            rows: sortedRows
        };
    }

    const filteredItems = filterLower && !key.toLowerCase().includes(filterLower)
        ? capped.filter(item => matchesFilterText(item, filterLower))
        : capped;

    return {
        key,
        path,
        kind: 'scalar-array',
        itemCount: arr.length,
        scalarItems: filteredItems
    };
}

function buildObjectChildren(
    obj: Record<string, unknown>,
    parentPath: string,
    filterLower: string,
    sortCol: string,
    sortAsc: boolean,
    depth = 0
): PreviewPropertyNode[] {
    if (depth > 8) return [];
    const nodes: PreviewPropertyNode[] = [];

    for (const [key, val] of Object.entries(obj)) {
        const path = parentPath ? `${parentPath}.${key}` : key;
        if (Array.isArray(val)) {
            const arrNode = buildArrayNode(key, path, val, filterLower, sortCol, sortAsc);
            const hasMatches =
                !filterLower ||
                key.toLowerCase().includes(filterLower) ||
                (arrNode.rows && arrNode.rows.length > 0) ||
                (arrNode.scalarItems && arrNode.scalarItems.length > 0);
            if (hasMatches) {
                nodes.push(arrNode);
            }
        } else if (val !== null && typeof val === 'object') {
            const childEntries = Object.entries(val as Record<string, unknown>);
            const subChildren = buildObjectChildren(
                val as Record<string, unknown>,
                path,
                key.toLowerCase().includes(filterLower) ? '' : filterLower,
                sortCol,
                sortAsc,
                depth + 1
            );
            if (!filterLower || key.toLowerCase().includes(filterLower) || subChildren.length > 0) {
                nodes.push({
                    key,
                    path,
                    kind: 'object',
                    itemCount: childEntries.length,
                    children: subChildren
                });
            }
        } else {
            const display = formatPreviewCellText(val);
            if (!filterLower || key.toLowerCase().includes(filterLower) || display.toLowerCase().includes(filterLower)) {
                nodes.push({
                    key,
                    path,
                    kind: 'scalar',
                    scalarValue: val,
                    scalarDisplay: display,
                    scalarType: getPreviewScalarType(val)
                });
            }
        }
    }

    return nodes;
}

export function buildPreviewTree(
    data: unknown,
    filterText = '',
    sortCol = '',
    sortAsc = true
): PreviewTreeResult {
    if (data === null || data === undefined) {
        return { rootKind: 'empty', nodes: [], totalNodes: 0 };
    }

    const filterLower = (filterText || '').trim().toLowerCase();

    if (Array.isArray(data)) {
        const rootArrayNode = buildArrayNode('data', '$', data, filterLower, sortCol, sortAsc);
        return {
            rootKind: 'array',
            nodes: [rootArrayNode],
            totalNodes: data.length
        };
    }

    if (typeof data === 'object') {
        const entries = Object.entries(data as Record<string, unknown>);
        const nodes = buildObjectChildren(
            data as Record<string, unknown>,
            '',
            filterLower,
            sortCol,
            sortAsc
        );
        return {
            rootKind: 'object',
            nodes,
            totalNodes: entries.length
        };
    }

    return {
        rootKind: 'scalar',
        nodes: [],
        totalNodes: 1,
        rootScalar: {
            value: data,
            display: formatPreviewCellText(data),
            type: getPreviewScalarType(data)
        }
    };
}
