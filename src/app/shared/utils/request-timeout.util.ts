import { signal } from '@angular/core';

export const DEFAULT_REQUEST_TIMEOUT_MS = 0;
export const GLOBAL_TIMEOUT_STORAGE_KEY = 'onsteroids_request_timeout_ms';
export const DEFAULT_TIMEOUT_MIGRATION_KEY = 'onsteroids_timeout_default_infinity_v1';

function readStoredTimeoutMs(): number {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    try {
        const raw = localStorage.getItem(GLOBAL_TIMEOUT_STORAGE_KEY);
        const migrated = localStorage.getItem(DEFAULT_TIMEOUT_MIGRATION_KEY) === '1';
        if (!migrated) {
            localStorage.setItem(DEFAULT_TIMEOUT_MIGRATION_KEY, '1');
            if (raw === null || raw.trim() === '' || raw.trim() === '120000') {
                localStorage.setItem(GLOBAL_TIMEOUT_STORAGE_KEY, String(DEFAULT_REQUEST_TIMEOUT_MS));
                return DEFAULT_REQUEST_TIMEOUT_MS;
            }
        }
        if (raw === null || raw.trim() === '') {
            return DEFAULT_REQUEST_TIMEOUT_MS;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return DEFAULT_REQUEST_TIMEOUT_MS;
        }
        return Math.floor(parsed);
    } catch {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }
}

export const globalRequestTimeoutMs = signal<number>(readStoredTimeoutMs());

export function parseTimeoutInputValue(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
        return null;
    }
    const num = Number(typeof value === 'string' ? value.trim() : value);
    if (!Number.isFinite(num) || num < 0) {
        return null;
    }
    return Math.min(3600000, Math.floor(num));
}

export function sanitizeRequestTimeoutMs(value: unknown): number {
    const parsed = parseTimeoutInputValue(value);
    return parsed === null ? DEFAULT_REQUEST_TIMEOUT_MS : parsed;
}

export function getGlobalRequestTimeoutMs(): number {
    return globalRequestTimeoutMs();
}

export function setGlobalRequestTimeoutMs(value: unknown, persistToStorage = true): number {
    const sanitized = sanitizeRequestTimeoutMs(value);
    globalRequestTimeoutMs.set(sanitized);
    if (persistToStorage && typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(GLOBAL_TIMEOUT_STORAGE_KEY, String(sanitized));
        } catch { }
    }
    return sanitized;
}

export function formatTimeoutLabel(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) {
        return 'No timeout (∞)';
    }
    if (ms < 1000) {
        return `${ms} ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${Number(seconds.toFixed(1))}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remSec = Math.round(seconds % 60);
    return remSec > 0 ? `${minutes}m ${remSec}s (${Math.round(seconds)}s)` : `${minutes}m (${Math.round(seconds)}s)`;
}
