import { signal } from '@angular/core';

export const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
export const GLOBAL_TIMEOUT_STORAGE_KEY = 'onsteroids_request_timeout_ms';

function readStoredTimeoutMs(): number {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    try {
        const raw = localStorage.getItem(GLOBAL_TIMEOUT_STORAGE_KEY);
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

export function sanitizeRequestTimeoutMs(value: unknown): number {
    if (value === null || value === undefined || value === '') {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
        return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    // Cap at 1 hour (3,600,000 ms); 0 means no timeout (infinite)
    return Math.min(3600000, Math.floor(num));
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
