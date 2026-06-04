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
