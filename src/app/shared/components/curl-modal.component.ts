import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { RequestState, TabStateService } from '../services/tab.state.service';
import { NotificationService } from '../services/notification.service';
import { copyTextToClipboard } from '../utils/clipboard.util';

@Component({
    selector: 'app-curl-modal',
    imports: [FormsModule, MatIcon],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:keydown.escape)': 'onEscape($event)'
    },
    template: `
        @if (isOpen() && request()) {
            <div class="fixed inset-0 z-100 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 animate-in fade-in duration-150"
                 (click)="close()">
                <div role="dialog"
                     aria-modal="true"
                     aria-labelledby="curl-modal-title"
                     class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
                     (click)="$event.stopPropagation()">

                    <!-- Header -->
                    <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50 shrink-0">
                        <div class="flex items-center gap-x-2.5 min-w-0">
                            <div class="size-7 rounded-lg bg-(--postonsteroids-accent)/15 text-(--postonsteroids-accent) flex items-center justify-center shrink-0">
                                <mat-icon class="text-[17px]! size-[17px]!">code</mat-icon>
                            </div>
                            <div class="min-w-0">
                                <h3 id="curl-modal-title" class="text-[14px] font-bold text-(--postonsteroids-text-primary) leading-tight">
                                    Request as cURL
                                </h3>
                                <p class="text-[11px] text-(--postonsteroids-text-muted) truncate">
                                    {{ requestTitle() }}
                                </p>
                            </div>
                        </div>
                        <button type="button"
                                (click)="close()"
                                aria-label="Close cURL modal"
                                class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) transition-colors cursor-pointer">
                            <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
                        </button>
                    </div>

                    <!-- Options bar -->
                    <div class="px-5 py-2.5 border-b border-(--postonsteroids-border)/70 flex flex-wrap items-center justify-between gap-3 bg-(--postonsteroids-bg-secondary) shrink-0">
                        <div class="flex flex-wrap items-center gap-4 text-[12px] text-(--postonsteroids-text-secondary)">
                            <label class="flex items-center gap-1.5 cursor-pointer select-none">
                                <input type="checkbox"
                                       [ngModel]="resolveVariables()"
                                       (ngModelChange)="resolveVariables.set($event)"
                                       class="accent-(--postonsteroids-accent) cursor-pointer" />
                                <span>Resolve variables</span>
                            </label>
                            <label class="flex items-center gap-1.5 cursor-pointer select-none">
                                <input type="checkbox"
                                       [ngModel]="multiline()"
                                       (ngModelChange)="multiline.set($event)"
                                       class="accent-(--postonsteroids-accent) cursor-pointer" />
                                <span>Multi-line format</span>
                            </label>
                            @if (hasVerifySslDisabled()) {
                                <label class="flex items-center gap-1.5 cursor-pointer select-none">
                                    <input type="checkbox"
                                           [ngModel]="includeInsecureFlag()"
                                           (ngModelChange)="includeInsecureFlag.set($event)"
                                           class="accent-(--postonsteroids-accent) cursor-pointer" />
                                    <span>Include <code>-k</code> (insecure)</span>
                                </label>
                            }
                        </div>

                        <button type="button"
                                (click)="copyCurl()"
                                class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white text-[12px] font-semibold shadow-sm transition-colors cursor-pointer">
                            <mat-icon class="text-[15px]! size-[15px]!">{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
                            <span>{{ copied() ? 'Copied' : 'Copy cURL' }}</span>
                        </button>
                    </div>

                    <!-- Command Preview -->
                    <div class="p-5 overflow-auto flex-1 min-h-0">
                        <pre class="p-4 rounded-xl bg-(--postonsteroids-bg-darker) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all select-all m-0">{{ curlCommand() }}</pre>
                    </div>
                </div>
            </div>
        }
    `
})
export class CurlModalComponent {
    private tabStateService = inject(TabStateService);
    private notificationService = inject(NotificationService);

    isOpen = input<boolean>(false);
    request = input<RequestState | null>(null);
    closed = output<void>();

    resolveVariables = signal<boolean>(true);
    multiline = signal<boolean>(true);
    includeInsecureFlag = signal<boolean>(false);
    copied = signal<boolean>(false);

    requestTitle = computed(() => {
        const req = this.request();
        if (!req) return '';
        return `${(req.method || 'GET').toUpperCase()} · ${this.tabStateService.resolveRequestTitle(req.name, req.url)}`;
    });

    hasVerifySslDisabled = computed(() => this.request()?.settings?.verifySsl === false);

    curlCommand = computed(() => {
        const req = this.request();
        if (!req) return '';
        return this.tabStateService.buildCurlFromState(req, {
            resolveVariables: this.resolveVariables(),
            multiline: this.multiline(),
            includeInsecureFlag: this.includeInsecureFlag()
        });
    });

    onEscape(event: Event): void {
        if (!this.isOpen()) return;
        event.preventDefault();
        this.close();
    }

    close(): void {
        this.copied.set(false);
        this.closed.emit();
    }

    async copyCurl(): Promise<void> {
        const cmd = this.curlCommand();
        if (!cmd) return;
        const ok = await copyTextToClipboard(cmd);
        if (ok) {
            this.copied.set(true);
            this.notificationService.notify('cURL command copied to clipboard!', 'success');
            setTimeout(() => this.copied.set(false), 1800);
        } else {
            this.notificationService.notify('Failed to copy cURL command.', 'error');
        }
    }
}
