import { KeyValue } from '../services/tab.state.service';

export interface BulkKeyValueLike {
    enabled: boolean;
    key: string;
    value: string;
    type?: 'text' | 'file';
}

export function stringifyBulkKeyValues(rows: BulkKeyValueLike[]): string {
    return (rows || [])
        .filter(r => r.type !== 'file' && (Boolean(r.key) || Boolean(r.value)))
        .map(r => {
            const line = `${r.key ?? ''}: ${r.value ?? ''}`;
            return r.enabled === false ? `//${line}` : line;
        })
        .join('\n');
}

export function parseBulkKeyValues(text: string): KeyValue[] {
    const lines = String(text ?? '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    const result: KeyValue[] = lines.map(rawLine => {
        let enabled = true;
        let line = rawLine;
        if (line.startsWith('//')) {
            enabled = false;
            line = line.slice(2).trimStart();
        }
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) {
            return { enabled, key: line.trim(), value: '' };
        }
        return {
            enabled,
            key: line.substring(0, colonIdx).trim(),
            value: line.substring(colonIdx + 1).trim()
        };
    });

    return result.length > 0 ? result : [{ enabled: true, key: '', value: '' }];
}
