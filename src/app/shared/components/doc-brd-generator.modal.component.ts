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
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState } from '../services/tab.state.service';
import { VariableService } from '../services/variable.service';
import { EnvironmentService } from '../services/environment.service';
import { NotificationService } from '../services/notification.service';
import { copyTextToClipboard } from '../utils/clipboard.util';
import { generateDocumentationOrBrd, DocBrdVariable } from '../utils/doc-brd-generator.util';
import { BodyPortalDirective } from '../directives/body-portal.directive';

@Component({
    selector: 'app-doc-brd-generator-modal',
    imports: [CommonModule, FormsModule, MatIcon, BodyPortalDirective],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(document:keydown.escape)': 'onEscape()'
    },
    template: `
        @if (isOpen()) {
            <div appBodyPortal class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/65 backdrop-blur-[2px] p-4" (click)="close()">
                <div class="w-full max-w-5xl h-[min(88dvh,calc(100dvh-28px))] flex flex-col rounded-xl bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) shadow-2xl overflow-hidden"
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
                        <div class="flex items-center gap-2 shrink-0">
                            @if (canReturnToNotes()) {
                                <button type="button" (click)="onBackToNotes()"
                                    class="px-3 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors">
                                    <mat-icon class="text-[14px]! size-[14px]!">arrow_back</mat-icon>
                                    <span>Back to Edit Notes</span>
                                </button>
                            }
                            <button type="button" (click)="openFullStudio()"
                                class="px-3 py-1.5 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:border-blue-500/50 text-(--postonsteroids-text-primary) text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors">
                                <mat-icon class="text-[14px]! size-[14px]! text-blue-400">menu_book</mat-icon>
                                <span>Full Docs / BRD Studio</span>
                            </button>
                            <button type="button" (click)="close()"
                                class="p-1.5 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) cursor-pointer">
                                <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
                            </button>
                        </div>
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
                                    <button type="button" (click)="mode.set('testrail')"
                                        class="px-3 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer"
                                        [class.bg-teal-600]="mode() === 'testrail'"
                                        [class.text-white]="mode() === 'testrail'"
                                        [class.text-(--postonsteroids-text-secondary)]="mode() !== 'testrail'">
                                        TestRail Cases
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

                        @if (showTestRailPanel()) {
                            <div class="p-3 rounded-xl bg-teal-500/8 border border-teal-500/30 flex flex-col gap-2.5">
                                <div class="flex items-center justify-between gap-2">
                                    <div class="flex items-center gap-2 text-[11.5px] font-bold text-teal-400">
                                        <mat-icon class="text-[16px]! size-[16px]!">checklist</mat-icon>
                                        <span>TestRail API Integration (Push {{ generated().testRailCases?.length || 0 }} Test Case(s))</span>
                                    </div>
                                    <button type="button" (click)="showTestRailPanel.set(false)" class="text-[11px] text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) cursor-pointer">
                                        Hide
                                    </button>
                                </div>
                                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                                    <input type="url" [ngModel]="trUrl()" (ngModelChange)="trUrl.set($event)"
                                        placeholder="https://company.testrail.io"
                                        class="px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none focus:border-teal-500" />
                                    <input type="email" [ngModel]="trEmail()" (ngModelChange)="trEmail.set($event)"
                                        placeholder="TestRail Email"
                                        class="px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none focus:border-teal-500" />
                                    <input type="password" [ngModel]="trApiKey()" (ngModelChange)="trApiKey.set($event)"
                                        placeholder="TestRail API Key"
                                        class="px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none focus:border-teal-500" />
                                    <div class="flex items-center gap-1.5">
                                        <input type="text" [ngModel]="trSectionId()" (ngModelChange)="trSectionId.set($event)"
                                            placeholder="Section ID (e.g. 12)"
                                            class="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-(--postonsteroids-text-primary) outline-none focus:border-teal-500" />
                                        <button type="button" (click)="pushToTestRail()" [disabled]="isPushingTestRail()"
                                            class="px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold shrink-0 cursor-pointer disabled:opacity-50 flex items-center gap-1">
                                            @if (isPushingTestRail()) {
                                                <mat-icon class="text-[13px]! size-[13px]! animate-spin">sync</mat-icon>
                                                <span>Pushing...</span>
                                            } @else {
                                                <span>Push</span>
                                            }
                                        </button>
                                    </div>
                                </div>
                                @if (trStatus()) {
                                    <div class="text-[11px] font-medium px-2.5 py-1.5 rounded border"
                                         [class.bg-emerald-500/10]="!trError()" [class.border-emerald-500/30]="!trError()" [class.text-emerald-400]="!trError()"
                                         [class.bg-red-500/10]="trError()" [class.border-red-500/30]="trError()" [class.text-red-400]="trError()">
                                        {{ trStatus() }}
                                    </div>
                                }
                            </div>
                        }
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
                            <button type="button" (click)="downloadTestRailXml()"
                                title="Download TestRail-native Suite XML format (Import -> XML in TestRail)"
                                class="px-3 py-1.5 rounded-md border border-teal-500/50 bg-teal-500/15 hover:bg-teal-500/25 text-[11px] font-semibold text-teal-300 flex items-center gap-1.5 cursor-pointer">
                                <mat-icon class="text-[14px]! size-[14px]!">code</mat-icon>
                                <span>TestRail .xml</span>
                            </button>
                            <button type="button" (click)="downloadTestRailCsv()"
                                class="px-3 py-1.5 rounded-md border border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20 text-[11px] font-semibold text-teal-400 flex items-center gap-1.5 cursor-pointer">
                                <mat-icon class="text-[14px]! size-[14px]!">table_view</mat-icon>
                                <span>TestRail .csv</span>
                            </button>
                            <button type="button" (click)="showTestRailPanel.set(!showTestRailPanel())"
                                class="px-3 py-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-[11px] font-semibold text-white flex items-center gap-1.5 cursor-pointer">
                                <mat-icon class="text-[14px]! size-[14px]!">cloud_upload</mat-icon>
                                <span>Integrate TestRail</span>
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
    private router = inject(Router);

    isOpen = input<boolean>(false);
    initialScope = input<'endpoint' | 'collection'>('endpoint');
    initialMode = input<'api-doc' | 'brd' | 'testrail'>('api-doc');
    request = input<RequestState | null>(null);
    customRequests = input<RequestState[] | null>(null);
    customTitle = input<string | null>(null);
    canReturnToNotes = input<boolean>(false);
    closed = output<void>();
    backToNotes = output<void>();

    previewFrame = viewChild<ElementRef<HTMLIFrameElement>>('previewFrame');

    mode = signal<'api-doc' | 'brd' | 'testrail'>('api-doc');
    scope = signal<'endpoint' | 'collection'>('endpoint');
    viewTab = signal<'preview' | 'markdown'>('preview');
    projectTitle = signal<string>('');
    version = signal<string>('1.0.0');
    author = signal<string>('Solutions Architecture Team');
    organization = signal<string>('Engineering & Product');

    showTestRailPanel = signal<boolean>(false);
    trUrl = signal<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('onsteroids_tr_url') || '') : '');
    trEmail = signal<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('onsteroids_tr_email') || '') : '');
    trApiKey = signal<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('onsteroids_tr_key') || '') : '');
    trSectionId = signal<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('onsteroids_tr_section') || '') : '');
    isPushingTestRail = signal<boolean>(false);
    trStatus = signal<string>('');
    trError = signal<boolean>(false);

    capsuleName = computed(() => {
        if (this.customTitle()) return this.customTitle()!;
        const capId = this.tabStateService.activeCapsuleId();
        return this.tabStateService.capsules().find(c => c.id === capId)?.name || 'API Collection';
    });

    collectionRequestCount = computed(() => {
        const custom = this.customRequests();
        if (custom && custom.length > 0) return custom.length;
        return this.tabStateService.allCapsuleRequests().length || (this.request() ? 1 : 0);
    });

    targetRequests = computed<RequestState[]>(() => {
        const current = this.request();
        if (this.scope() === 'endpoint' && current) {
            return [current];
        }
        const custom = this.customRequests();
        if (custom && custom.length > 0) {
            return custom;
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

    generated = computed(() => {
        this.tabStateService.brdSectionsVersion();
        const capId = this.tabStateService.activeCapsuleId();
        const groupNamesById: Record<string, string> = {};
        if (capId) {
            for (const g of this.tabStateService.getGroupsForCapsule(capId)) {
                groupNamesById[g.id] = this.tabStateService.getFolderFullPath(g.id, capId) || g.name;
            }
        }
        return generateDocumentationOrBrd({
            mode: this.mode(),
            scope: this.scope(),
            projectTitle: this.projectTitle().trim() || this.capsuleName(),
            version: this.version().trim() || '1.0.0',
            author: this.author().trim() || 'API Engineering',
            organization: this.organization().trim() || 'Engineering & Product',
            capsuleName: this.capsuleName(),
            requests: this.targetRequests(),
            variables: this.mergedVariables(),
            groupNamesById,
            brdSections: capId ? this.tabStateService.getBrdSectionsForCapsule(capId) : undefined
        });
    });

    private wasOpen = false;
    private lastOpenedCapsuleId = '';

    constructor() {
        effect(() => {
            const open = this.isOpen();
            if (open && !this.wasOpen) {
                this.mode.set(this.initialMode());
                const req = this.request();
                this.scope.set(req ? this.initialScope() : 'collection');
                const currentCapId = this.tabStateService.activeCapsuleId() || '';
                if (currentCapId !== this.lastOpenedCapsuleId || !this.projectTitle().trim()) {
                    this.projectTitle.set(this.capsuleName());
                    this.lastOpenedCapsuleId = currentCapId;
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

    onBackToNotes() {
        this.backToNotes.emit();
    }

    openFullStudio() {
        this.close();
        setTimeout(() => {
            void this.router.navigate(['/documentation']);
        }, 0);
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
        const suffix = this.mode() === 'brd' ? 'brd' : (this.mode() === 'testrail' ? 'testrail_cases' : 'api_docs');
        return `${clean}_${suffix}`;
    }

    downloadTestRailXml(): void {
        const xml = this.generated().testRailXml || '';
        if (!xml) return;
        this.triggerDownload(xml, `${this.fileBaseName()}_testrail.xml`, 'application/xml;charset=utf-8;');
        this.notificationService.notify('Exported native TestRail Suite XML file (import via TestRail Import -> XML).', 'success');
    }

    downloadTestRailCsv(): void {
        const csv = this.generated().testRailCsv || '';
        if (!csv) return;
        this.triggerDownload(csv, `${this.fileBaseName()}_testrail.csv`, 'text/csv;charset=utf-8;');
        this.notificationService.notify('Exported TestRail-compatible CSV file.', 'success');
    }

    async pushToTestRail(): Promise<void> {
        const base = this.trUrl().trim().replace(/\/+$/, '');
        const email = this.trEmail().trim();
        const key = this.trApiKey().trim();
        const sectionId = this.trSectionId().trim();
        const cases = this.generated().testRailCases || [];

        if (!base || !email || !key || !sectionId) {
            this.trError.set(true);
            this.trStatus.set('Enter TestRail URL, Email, API Key, and Section ID.');
            return;
        }
        if (cases.length === 0) {
            this.trError.set(true);
            this.trStatus.set('No test cases to push.');
            return;
        }

        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('onsteroids_tr_url', base);
            localStorage.setItem('onsteroids_tr_email', email);
            localStorage.setItem('onsteroids_tr_key', key);
            localStorage.setItem('onsteroids_tr_section', sectionId);
        }

        this.isPushingTestRail.set(true);
        this.trError.set(false);
        this.trStatus.set('');

        const authHeader = 'Basic ' + btoa(`${email}:${key}`);
        const electronApi = typeof window !== 'undefined' ? (window as any).electronAPI : null;
        let pushed = 0;

        try {
            for (const c of cases) {
                const endpoint = `${base}/index.php?/api/v2/add_case/${encodeURIComponent(sectionId)}`;
                const payload = {
                    title: c.title,
                    refs: c.refs,
                    custom_preconds: c.preconditions,
                    custom_steps: c.steps,
                    custom_expected: c.expectedResult
                };

                if (electronApi && typeof electronApi.executeHttpRequest === 'function') {
                    const res = await electronApi.executeHttpRequest({
                        method: 'POST',
                        url: endpoint,
                        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
                        body: JSON.stringify(payload)
                    });
                    if (!res?.ok || (res.statusCode && res.statusCode >= 400)) {
                        throw new Error(res?.body || res?.error || `HTTP ${res?.statusCode || 'Error'}`);
                    }
                } else {
                    const resp = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: authHeader },
                        body: JSON.stringify(payload)
                    });
                    if (!resp.ok) {
                        const errText = await resp.text();
                        throw new Error(`HTTP ${resp.status}: ${errText || resp.statusText}`);
                    }
                }
                pushed++;
            }

            this.trError.set(false);
            this.trStatus.set(`Successfully pushed ${pushed} test case(s) to TestRail section #${sectionId}.`);
            this.notificationService.notify(`Pushed ${pushed} test case(s) to TestRail.`, 'success');
        } catch (err: any) {
            this.trError.set(true);
            this.trStatus.set(`TestRail push stopped after ${pushed}/${cases.length} case(s): ${err?.message || err}`);
        } finally {
            this.isPushingTestRail.set(false);
        }
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
