import { Component, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-utility-component',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './utility.component.html',
    styleUrl: './utility.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UtilityComponent {
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
