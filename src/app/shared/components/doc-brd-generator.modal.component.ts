import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    computed,
    effect,
    inject,
    input,
    output,
    signal,
    viewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState } from '../services/tab.state.service';
import { VariableService } from '../services/variable.service';
import { EnvironmentService } from '../services/environment.service';
import { NotificationService } from '../services/notification.service';
import { copyTextToClipboard } from '../utils/clipboard.util';
import { generateDocumentationOrBrd, DocBrdVariable } from '../utils/doc-brd-generator.util';

@Component({
    selector: 'app-doc-brd-generator-modal',
    imports: [CommonModule, FormsModule, MatIcon],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:keydown.escape)': 'onEscape()'
    },
    template: `
        @if (isOpen()) {
            <div class="fixed inset-0 z-1000 flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4" (click)="close()">
                <div class="w-full max-w-5xl h-[88vh] flex flex-col rounded-xl bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) shadow-2xl overflow-hidden"
                    (click)="$event.stopPropagation()">

                    <!-- Header -->
                    <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-primary)/60 shrink-0">
                        <div class="flex items-center gap-2.5">
                            <div class="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
                                <mat-icon class="text-[18px]! size-[18px]! text-blue-400">description</mat-icon>
                            </div>
                            <div>
                                <h2 class="text-[14px] font-bold text-(--postonsteroids-text-primary) leading-tight">
                                    API Documentation & Standard BRD Generator
                                </h2>
                                <p class="text-[11px] text-(--postonsteroids-text-muted)">
                                    Generate stakeholder-ready Technical API Docs or 6-section Enterprise BRD in Markdown, HTML, PDF, or Word (.doc)
                                </p>
                            </div>
                        </div>
                        <button type="button" (click)="close()"
                            class="p-1.5 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) cursor-pointer">
                            <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
                        </button>
                    </div>

                    <!-- Controls Bar -->
                    <div class="px-5 py-3 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary)/40 flex flex-col gap-3 shrink-0">
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <!-- Mode & Scope Switchers -->
                            <div class="flex flex-wrap items-center gap-2">
                                <div class="flex rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary) p-0.5">
                                    <button type="button" (click)="mode.set('api-doc')"
                                        class="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
                                        [class.bg-blue-600]="mode() === 'api-doc'"
                                        [class.text-white]="mode() === 'api-doc'"
                                        [class.text-(--postonsteroids-text-secondary)]="mode() !== 'api-doc'">
                                        Technical API Docs
                                    </button>
                                    <button type="button" (click)="mode.set('brd')"
                                        class="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
                                        [class.bg-indigo-600]="mode() === 'brd'"
                                        [class.text-white]="mode() === 'brd'"
                                        [class.text-(--postonsteroids-text-secondary)]="mode() !== 'brd'">
                                        Standard BRD
                                    </button>
                                </div>

                                <div class="flex rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary) p-0.5">
                                    <button type="button" (click)="scope.set('endpoint')" [disabled]="!request()"
                                        class="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-40"
                                        [class.bg-emerald-600]="scope() === 'endpoint'"
                                        [class.text-white]="scope() === 'endpoint'"
                                        [class.text-(--postonsteroids-text-secondary)]="scope() !== 'endpoint'">
                                        Current Endpoint
                                    </button>
                                    <button type="button" (click)="scope.set('collection')"
                                        class="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
                                        [class.bg-emerald-600]="scope() === 'collection'"
                                        [class.text-white]="scope() === 'collection'"
                                        [class.text-(--postonsteroids-text-secondary)]="scope() !== 'collection'">
                                        Full Collection ({{ collectionRequestCount() }})
                                    </button>
                                </div>
                            </div>

                            <!-- View Tab -->
                            <div class="flex rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary) p-0.5">
                                <button type="button" (click)="viewTab.set('preview')"
                                    class="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
                                    [class.bg-(--postonsteroids-bg-hover)]="viewTab() === 'preview'"
                                    [class.text-(--postonsteroids-text-primary)]="viewTab() === 'preview'"
                                    [class.text-(--postonsteroids-text-muted)]="viewTab() !== 'preview'">
                                    Rendered Preview
                                </button>
                                <button type="button" (click)="viewTab.set('markdown')"
                                    class="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
                                    [class.bg-(--postonsteroids-bg-hover)]="viewTab() === 'markdown'"
                                    [class.text-(--postonsteroids-text-primary)]="viewTab() === 'markdown'"
                                    [class.text-(--postonsteroids-text-muted)]="viewTab() !== 'markdown'">
                                    Markdown Source
                                </button>
                            </div>
                        </div>

                        <!-- Metadata Inputs -->
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <label class="flex flex-col gap-0.5 text-[10px] text-(--postonsteroids-text-muted)">
                                <span>Project / Document Title</span>
                                <input type="text" [ngModel]="projectTitle()" (ngModelChange)="projectTitle.set($event)"
                                    placeholder="e.g. Payment Gateway API"
                                    class="bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) rounded px-2.5 py-1 text-[11px] text-(--postonsteroids-text-primary) outline-none focus:border-blue-500" />
                            </label>
                            <label class="flex flex-col gap-0.5 text-[10px] text-(--postonsteroids-text-muted)">
                                <span>Organization / Unit</span>
                                <input type="text" [ngModel]="organization()" (ngModelChange)="organization.set($event)"
                                    placeholder="Engineering & Product"
                                    class="bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) rounded px-2.5 py-1 text-[11px] text-(--postonsteroids-text-primary) outline-none focus:border-blue-500" />
                            </label>
                            <label class="flex flex-col gap-0.5 text-[10px] text-(--postonsteroids-text-muted)">
                                <span>Author / Lead</span>
                                <input type="text" [ngModel]="author()" (ngModelChange)="author.set($event)"
                                    placeholder="Solutions Architecture Team"
                                    class="bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) rounded px-2.5 py-1 text-[11px] text-(--postonsteroids-text-primary) outline-none focus:border-blue-500" />
                            </label>
                            <label class="flex flex-col gap-0.5 text-[10px] text-(--postonsteroids-text-muted)">
                                <span>Version</span>
                                <input type="text" [ngModel]="version()" (ngModelChange)="version.set($event)"
                                    placeholder="1.0.0"
                                    class="bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) rounded px-2.5 py-1 text-[11px] text-(--postonsteroids-text-primary) outline-none focus:border-blue-500" />
                            </label>
                        </div>
                    </div>

                    <!-- Preview / Source Body -->
                    <div class="flex-1 min-h-0 p-4 overflow-hidden bg-(--postonsteroids-bg-primary)/50">
                        @if (viewTab() === 'preview') {
                            <iframe #previewFrame sandbox="" title="Document Preview"
                                class="w-full h-full rounded-lg border border-(--postonsteroids-border) bg-white"></iframe>
                        } @else {
                            <textarea readonly [value]="generated().markdown"
                                class="w-full h-full rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary) p-3 font-mono text-[12px] text-(--postonsteroids-text-primary) outline-none resize-none"></textarea>
                        }
                    </div>

                    <!-- Footer Export Actions -->
                    <div class="px-5 py-3 border-t border-(--postonsteroids-border) flex flex-wrap items-center justify-between gap-2 bg-(--postonsteroids-bg-secondary) shrink-0">
                        <span class="text-[11px] text-(--postonsteroids-text-muted)">
                            Document covers {{ targetRequests().length }} endpoint(s) from {{ capsuleName() }}
                        </span>
                        <div class="flex flex-wrap items-center gap-2">
                            <button type="button" (click)="copyMarkdown()"
                                class="px-3 py-1.5 rounded-md border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[11px] font-semibold text-(--postonsteroids-text-primary) flex items-center gap-1.5 cursor-pointer">
                                <mat-icon class="text-[14px]! size-[14px]!">content_copy</mat-icon>
                                <span>Copy Markdown</span>
                            </button>
                            <button type="button" (click)="downloadMarkdown()"
                                class="px-3 py-1.5 rounded-md border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[11px] font-semibold text-(--postonsteroids-text-primary) flex items-center gap-1.5 cursor-pointer">
                                <mat-icon class="text-[14px]! size-[14px]!">download</mat-icon>
                                <span>Download .md</span>
                            </button>
                            <button type="button" (click)="downloadHtml()"
                                class="px-3 py-1.5 rounded-md border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[11px] font-semibold text-(--postonsteroids-text-primary) flex items-center gap-1.5 cursor-pointer">
                                <mat-icon class="text-[14px]! size-[14px]!">html</mat-icon>
                                <span>Download .html</span>
                            </button>
                            <button type="button" (click)="downloadWordDoc()"
                                class="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-[11px] font-semibold text-white flex items-center gap-1.5 cursor-pointer">
                                <mat-icon class="text-[14px]! size-[14px]!">article</mat-icon>
                                <span>Export Word (.doc)</span>
                            </button>
                            <button type="button" (click)="printDocument()"
                                class="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-[11px] font-semibold text-white flex items-center gap-1.5 cursor-pointer">
                                <mat-icon class="text-[14px]! size-[14px]!">print</mat-icon>
                                <span>Print / PDF</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        }
    `
})
export class DocBrdGeneratorModalComponent {
    private tabStateService = inject(TabStateService);
    private variableService = inject(VariableService);
    private environmentService = inject(EnvironmentService);
    private notificationService = inject(NotificationService);

    isOpen = input<boolean>(false);
    initialScope = input<'endpoint' | 'collection'>('endpoint');
    initialMode = input<'api-doc' | 'brd'>('api-doc');
    request = input<RequestState | null>(null);
    closed = output<void>();

    previewFrame = viewChild<ElementRef<HTMLIFrameElement>>('previewFrame');

    mode = signal<'api-doc' | 'brd'>('api-doc');
    scope = signal<'endpoint' | 'collection'>('endpoint');
    viewTab = signal<'preview' | 'markdown'>('preview');
    projectTitle = signal<string>('');
    version = signal<string>('1.0.0');
    author = signal<string>('Solutions Architecture Team');
    organization = signal<string>('Engineering & Product');

    capsuleName = computed(() => {
        const capId = this.tabStateService.activeCapsuleId();
        return this.tabStateService.capsules().find(c => c.id === capId)?.name || 'API Collection';
    });

    collectionRequestCount = computed(() => this.tabStateService.allCapsuleRequests().length || (this.request() ? 1 : 0));

    targetRequests = computed<RequestState[]>(() => {
        const current = this.request();
        if (this.scope() === 'endpoint' && current) {
            return [current];
        }
        const all = this.tabStateService.allCapsuleRequests();
        return all.length > 0 ? all : (current ? [current] : []);
    });

    mergedVariables = computed<DocBrdVariable[]>(() => {
        const out: DocBrdVariable[] = [];
        const seen = new Set<string>();
        const envVars = this.environmentService.activeEnvironment()?.variables || [];
        for (const v of envVars) {
            if (v.enabled && v.key.trim()) {
                seen.add(v.key.trim().toLowerCase());
                out.push({ key: v.key.trim(), value: v.value ?? '' });
            }
        }
        for (const v of this.variableService.variables()) {
            const k = (v.key || '').trim();
            if (v.enabled && k && !seen.has(k.toLowerCase())) {
                out.push({ key: k, value: v.value ?? '' });
            }
        }
        return out;
    });

    generated = computed(() =>
        generateDocumentationOrBrd({
            mode: this.mode(),
            scope: this.scope(),
            projectTitle: this.projectTitle().trim() || this.capsuleName(),
            version: this.version().trim() || '1.0.0',
            author: this.author().trim() || 'API Engineering',
            organization: this.organization().trim() || 'Engineering & Product',
            capsuleName: this.capsuleName(),
            requests: this.targetRequests(),
            variables: this.mergedVariables()
        })
    );

    private wasOpen = false;

    constructor() {
        effect(() => {
            const open = this.isOpen();
            if (open && !this.wasOpen) {
                this.mode.set(this.initialMode());
                const req = this.request();
                this.scope.set(req ? this.initialScope() : 'collection');
                if (!this.projectTitle().trim()) {
                    this.projectTitle.set(this.capsuleName());
                }
            }
            this.wasOpen = open;
        });

        effect(() => {
            const frame = this.previewFrame()?.nativeElement;
            if (frame && this.isOpen() && this.viewTab() === 'preview') {
                frame.srcdoc = this.generated().html;
            }
        });
    }

    onEscape() {
        if (this.isOpen()) {
            this.close();
        }
    }

    close() {
        this.closed.emit();
    }

    async copyMarkdown() {
        await copyTextToClipboard(this.generated().markdown);
        this.notificationService.notify('Markdown document copied to clipboard.', 'success');
    }

    private fileBaseName(): string {
        const clean = (this.projectTitle().trim() || this.capsuleName())
            .replace(/[^a-z0-9]+/gi, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase() || 'api_document';
        return `${clean}_${this.mode() === 'brd' ? 'brd' : 'api_docs'}`;
    }

    private triggerDownload(content: string, filename: string, mimeType: string) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    downloadMarkdown() {
        this.triggerDownload(this.generated().markdown, `${this.fileBaseName()}.md`, 'text/markdown;charset=utf-8');
        this.notificationService.notify('Downloaded Markdown file.', 'success');
    }

    downloadHtml() {
        this.triggerDownload(this.generated().html, `${this.fileBaseName()}.html`, 'text/html;charset=utf-8');
        this.notificationService.notify('Downloaded HTML documentation.', 'success');
    }

    downloadWordDoc() {
        this.triggerDownload(this.generated().wordHtml, `${this.fileBaseName()}.doc`, 'application/msword;charset=utf-8');
        this.notificationService.notify('Exported Word (.doc) document.', 'success');
    }

    printDocument() {
        const popup = window.open('', '_blank', 'width=960,height=780');
        if (popup) {
            popup.document.open();
            popup.document.write(this.generated().html);
            popup.document.close();
            popup.focus();
            setTimeout(() => popup.print(), 250);
        } else {
            this.downloadHtml();
            this.notificationService.notify('Popup blocked; downloaded standalone HTML for browser printing.', 'warning');
        }
    }
}
