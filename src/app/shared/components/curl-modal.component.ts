import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { RequestState, TabStateService } from '../services/tab.state.service';
import { NotificationService } from '../services/notification.service';
import { VariableService } from '../services/variable.service';
import { AutoAuthService } from '../services/auto-auth.service';
import { copyTextToClipboard } from '../utils/clipboard.util';
import { CODE_LANGUAGE_OPTIONS, CodeLanguageId, buildCodeSnippet } from '../utils/code-generator.util';
import { BodyPortalDirective } from '../directives/body-portal.directive';

@Component({
    selector: 'app-curl-modal',
    imports: [FormsModule, MatIcon, BodyPortalDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:keydown.escape)': 'onEscape($event)'
    },
    template: `
        @if (isOpen() && request()) {
            <div appBodyPortal class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 animate-in fade-in duration-150"
                 (click)="close()">
                <div role="dialog"
                     aria-modal="true"
                     aria-labelledby="curl-modal-title"
                     class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[min(88dvh,calc(100dvh-28px))]"
                     (click)="$event.stopPropagation()">

                    <!-- Header -->
                    <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50 shrink-0">
                        <div class="flex items-center gap-x-2.5 min-w-0">
                            <div class="size-7 rounded-lg bg-(--postonsteroids-accent)/15 text-(--postonsteroids-accent) flex items-center justify-center shrink-0">
                                <mat-icon class="text-[17px]! size-[17px]!">code</mat-icon>
                            </div>
                            <div class="min-w-0">
                                <h3 id="curl-modal-title" class="text-[14px] font-bold text-(--postonsteroids-text-primary) leading-tight">
                                    Code Snippet Generator
                                </h3>
                                <p class="text-[11px] text-(--postonsteroids-text-muted) truncate">
                                    {{ requestTitle() }}
                                </p>
                            </div>
                        </div>
                        <button type="button"
                                (click)="close()"
                                aria-label="Close code snippet modal"
                                class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) transition-colors cursor-pointer">
                            <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
                        </button>
                    </div>

                    <!-- Language Selector Strip -->
                    <div class="px-5 py-2 border-b border-(--postonsteroids-border)/50 flex items-center gap-1.5 overflow-x-auto bg-(--postonsteroids-bg-primary)/30 shrink-0">
                        @for (lang of languageOptions; track lang.id) {
                            <button type="button"
                                    (click)="selectedLanguage.set(lang.id); copied.set(false)"
                                    class="px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer border"
                                    [class.bg-(--postonsteroids-accent)]="selectedLanguage() === lang.id"
                                    [class.text-white]="selectedLanguage() === lang.id"
                                    [class.border-(--postonsteroids-accent)]="selectedLanguage() === lang.id"
                                    [class.bg-(--postonsteroids-bg-tertiary)]="selectedLanguage() !== lang.id"
                                    [class.text-(--postonsteroids-text-secondary)]="selectedLanguage() !== lang.id"
                                    [class.border-(--postonsteroids-border)]="selectedLanguage() !== lang.id"
                                    [class.hover:bg-(--postonsteroids-bg-hover)]="selectedLanguage() !== lang.id">
                                {{ lang.label }}
                            </button>
                        }
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
                            @if (selectedLanguage() === 'curl') {
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
                            }
                        </div>

                        <button type="button"
                                (click)="copyCode()"
                                class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white text-[12px] font-semibold shadow-sm transition-colors cursor-pointer">
                            <mat-icon class="text-[15px]! size-[15px]!">{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
                            <span>{{ copied() ? 'Copied' : 'Copy Code' }}</span>
                        </button>
                    </div>

                    <!-- Code Preview -->
                    <div class="p-5 overflow-auto flex-1 min-h-0">
                        <pre class="p-4 rounded-xl bg-(--postonsteroids-bg-darker) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all select-all m-0">{{ generatedCode() }}</pre>
                    </div>
                </div>
            </div>
        }
    `
})
export class CurlModalComponent {
    private tabStateService = inject(TabStateService);
    private notificationService = inject(NotificationService);
    private variableService = inject(VariableService);
    private autoAuthService = inject(AutoAuthService);

    isOpen = input<boolean>(false);
    request = input<RequestState | null>(null);
    closed = output<void>();

    languageOptions = CODE_LANGUAGE_OPTIONS;
    selectedLanguage = signal<CodeLanguageId>('curl');

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

    generatedCode = computed(() => {
        const req = this.request();
        if (!req) return '';
        const cachedToken = this.autoAuthService.isAutoAuthEnabled(req.id)
            ? this.autoAuthService.getCachedToken()
            : null;
        return buildCodeSnippet(this.selectedLanguage(), req, {
            resolveVariables: this.resolveVariables(),
            multiline: this.multiline(),
            includeInsecureFlag: this.includeInsecureFlag(),
            resolveText: (s: string) => this.variableService.resolve(s),
            resolveJson: (s: string) => this.variableService.resolveJson(s),
            autoAuthToken: cachedToken
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

    async copyCode(): Promise<void> {
        const cmd = this.generatedCode();
        if (!cmd) return;
        const ok = await copyTextToClipboard(cmd);
        if (ok) {
            this.copied.set(true);
            const label = this.languageOptions.find(l => l.id === this.selectedLanguage())?.label || 'Code';
            this.notificationService.notify(`${label} snippet copied to clipboard!`, 'success');
            setTimeout(() => this.copied.set(false), 1800);
        } else {
            this.notificationService.notify('Failed to copy snippet.', 'error');
        }
    }
}
