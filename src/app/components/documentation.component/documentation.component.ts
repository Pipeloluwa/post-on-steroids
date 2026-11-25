import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { TabStateService, RequestState } from '../../shared/services/tab.state.service';
import { VariableService } from '../../shared/services/variable.service';
import { EnvironmentService } from '../../shared/services/environment.service';
import { NotificationService } from '../../shared/services/notification.service';
import { copyTextToClipboard } from '../../shared/utils/clipboard.util';
import { getHttpMethodColor } from '../../shared/utils/http-method.util';
import {
  BrdEditableSections,
  CustomDocBlock,
  DocBrdVariable,
  generateDocumentationOrBrd
} from '../../shared/utils/doc-brd-generator.util';

type StudioViewTab = 'edit-brd' | 'edit-endpoints' | 'preview' | 'markdown';

@Component({
  selector: 'app-documentation',
  imports: [CommonModule, FormsModule, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex-1 min-h-0 h-full flex flex-col overflow-hidden'
  },
  template: `
    <div class="flex-1 min-h-0 h-full w-full flex flex-col bg-(--postonsteroids-bg-primary) text-(--postonsteroids-text-primary) overflow-hidden">
      <!-- Header -->
      <div class="px-6 py-4 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center shrink-0">
            <mat-icon class="text-[22px]! size-[22px]! text-blue-400">menu_book</mat-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base font-bold tracking-tight truncate">Documentation, BRD &amp; TestRail Studio</h1>
            <p class="text-xs text-(--postonsteroids-text-muted) truncate">
              Author Enterprise BRDs, edit per-endpoint notes, generate technical API docs, and export TestRail-native XML &amp; CSV suites.
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <div class="px-2.5 py-1 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) text-xs flex items-center gap-1.5">
            <mat-icon class="text-[14px]! size-[14px]! text-blue-400">api</mat-icon>
            <span class="font-semibold tabular-nums">{{ targetRequests().length }}</span>
            <span class="text-(--postonsteroids-text-muted)">Endpoint(s) in Document</span>
          </div>

          <button type="button" (click)="saveAllDocumentation()" [disabled]="isSavingDocs()"
                  class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
            <mat-icon class="text-[15px]! size-[15px]!">save</mat-icon>
            <span>{{ isSavingDocs() ? 'Saving...' : 'Save BRD & Notes' }}</span>
          </button>

          <button type="button" (click)="goToWorkspace()"
                  class="px-3 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) hover:border-(--postonsteroids-accent)/60 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
            <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-accent)">open_in_new</mat-icon>
            <span>OnSteroid</span>
          </button>
        </div>
      </div>

      <!-- Mode, Capsule & View Controls Bar -->
      <div class="px-6 py-2.5 border-b border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary)/60 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
        <div class="flex flex-wrap items-center gap-2.5">
          <!-- Format Switcher (only shown in Preview / Markdown views where switching output format applies) -->
          @if (viewTab() === 'preview' || viewTab() === 'markdown') {
            <div class="inline-flex rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) p-0.5">
              <button type="button" (click)="setDocMode('api-doc')"
                      class="px-2.5 py-1 rounded-md font-semibold cursor-pointer transition-colors"
                      [class.bg-(--postonsteroids-accent)]="mode() === 'api-doc'"
                      [class.text-white]="mode() === 'api-doc'"
                      [class.text-(--postonsteroids-text-secondary)]="mode() !== 'api-doc'">
                Technical API Docs
              </button>
              <button type="button" (click)="setDocMode('brd')"
                      class="px-2.5 py-1 rounded-md font-semibold cursor-pointer transition-colors"
                      [class.bg-blue-600]="mode() === 'brd'"
                      [class.text-white]="mode() === 'brd'"
                      [class.text-(--postonsteroids-text-secondary)]="mode() !== 'brd'">
                Enterprise BRD
              </button>
              <button type="button" (click)="setDocMode('testrail')"
                      class="px-2.5 py-1 rounded-md font-semibold cursor-pointer transition-colors"
                      [class.bg-teal-600]="mode() === 'testrail'"
                      [class.text-white]="mode() === 'testrail'"
                      [class.text-(--postonsteroids-text-secondary)]="mode() !== 'testrail'">
                TestRail Suite
              </button>
            </div>
          }

          <!-- Capsule Selector -->
          <select aria-label="Documentation Capsule"
                  [ngModel]="selectedCapsuleId()"
                  (ngModelChange)="onCapsuleChange($event)"
                  class="bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
            @for (cap of tabStateService.capsules(); track cap.id) {
              <option [value]="cap.id" class="bg-(--postonsteroids-bg-secondary)">Capsule: {{ cap.name }}</option>
            }
          </select>

          <!-- Folder Scope Filter -->
          <select aria-label="Folder Scope"
                  [ngModel]="selectedGroupId()"
                  (ngModelChange)="onGroupChange($event)"
                  class="bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-(--postonsteroids-accent) cursor-pointer">
            <option value="__all__" class="bg-(--postonsteroids-bg-secondary)">All Endpoints ({{ allCapsuleRequests().length }})</option>
            @for (grp of availableGroups(); track grp.id) {
              <option [value]="grp.id" class="bg-(--postonsteroids-bg-secondary)">Folder: {{ grp.name }}</option>
            }
          </select>
        </div>

        <!-- Studio View Tabs -->
        <div class="inline-flex rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) p-0.5">
          <button type="button" (click)="viewTab.set('edit-brd')"
                  class="px-2.5 py-1 rounded-md font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  [class.bg-(--postonsteroids-bg-secondary)]="viewTab() === 'edit-brd'"
                  [class.text-(--postonsteroids-text-primary)]="viewTab() === 'edit-brd'"
                  [class.text-(--postonsteroids-text-muted)]="viewTab() !== 'edit-brd'">
            <mat-icon class="text-[14px]! size-[14px]! text-blue-400">edit_document</mat-icon>
            <span>Edit BRD &amp; Metadata</span>
          </button>
          <button type="button" (click)="viewTab.set('edit-endpoints')"
                  class="px-2.5 py-1 rounded-md font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  [class.bg-(--postonsteroids-bg-secondary)]="viewTab() === 'edit-endpoints'"
                  [class.text-(--postonsteroids-text-primary)]="viewTab() === 'edit-endpoints'"
                  [class.text-(--postonsteroids-text-muted)]="viewTab() !== 'edit-endpoints'">
            <mat-icon class="text-[14px]! size-[14px]! text-emerald-400">tune</mat-icon>
            <span>Endpoints &amp; TestRail ({{ targetRequests().length }})</span>
          </button>
          <button type="button" (click)="viewTab.set('preview')"
                  class="px-2.5 py-1 rounded-md font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  [class.bg-(--postonsteroids-bg-secondary)]="viewTab() === 'preview'"
                  [class.text-(--postonsteroids-text-primary)]="viewTab() === 'preview'"
                  [class.text-(--postonsteroids-text-muted)]="viewTab() !== 'preview'">
            <mat-icon class="text-[14px]! size-[14px]! text-amber-400">visibility</mat-icon>
            <span>Live Preview</span>
          </button>
          <button type="button" (click)="openMarkdownTab()"
                  class="px-2.5 py-1 rounded-md font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                  [class.bg-(--postonsteroids-bg-secondary)]="viewTab() === 'markdown'"
                  [class.text-(--postonsteroids-text-primary)]="viewTab() === 'markdown'"
                  [class.text-(--postonsteroids-text-muted)]="viewTab() !== 'markdown'">
            <mat-icon class="text-[14px]! size-[14px]! text-(--postonsteroids-accent)">code</mat-icon>
            <span>Markdown</span>
          </button>
        </div>
      </div>

      <!-- Optional Direct TestRail Integration Bar -->
      @if (showTestRailPanel()) {
        <div class="px-6 py-3 bg-teal-500/8 border-b border-teal-500/25 shrink-0 space-y-2 text-xs">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-bold text-teal-400 flex items-center gap-1.5">
              <mat-icon class="text-[16px]! size-[16px]!">cloud_upload</mat-icon>
              <span>TestRail API v2 Integration</span>
            </span>
            <span class="text-[11px] text-(--postonsteroids-text-muted)">
              Alternatively download <strong>TestRail .xml</strong> below and import directly inside TestRail (&ldquo;Import &rarr; Import from XML&rdquo;).
            </span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <input type="url" [ngModel]="trUrl()" (ngModelChange)="trUrl.set($event)"
                   placeholder="https://company.testrail.io"
                   class="px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none" />
            <input type="email" [ngModel]="trEmail()" (ngModelChange)="trEmail.set($event)"
                   placeholder="TestRail email"
                   class="px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none" />
            <input type="password" [ngModel]="trApiKey()" (ngModelChange)="trApiKey.set($event)"
                   placeholder="API Key / Token"
                   class="px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none" />
            <input type="text" [ngModel]="trSectionId()" (ngModelChange)="trSectionId.set($event)"
                   placeholder="Target Section ID (e.g. 42)"
                   class="px-2.5 py-1.5 rounded bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none" />
            <button type="button" (click)="pushToTestRail()" [disabled]="isPushingTestRail()"
                    class="px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold cursor-pointer disabled:opacity-50">
              {{ isPushingTestRail() ? 'Pushing...' : 'Push ' + (generated().testRailCases?.length || 0) + ' Case(s)' }}
            </button>
          </div>
          @if (trStatus()) {
            <div class="text-[11px]" [class.text-emerald-400]="!trError()" [class.text-status-danger]="trError()">{{ trStatus() }}</div>
          }
        </div>
      }

      <!-- Scrollable Studio Body -->
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        @if (viewTab() === 'edit-brd') {
          <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
            <!-- Document Control Metadata -->
            <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-3 text-xs">
              <div class="flex items-center justify-between">
                <h2 class="text-sm font-bold text-(--postonsteroids-text-primary)">1. Document Control &amp; Header Metadata</h2>
                <button type="button" (click)="resetBrdSections()"
                        class="px-2.5 py-1 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:border-(--postonsteroids-accent)/60 text-[11px] font-semibold cursor-pointer">
                  Reset BRD Sections
                </button>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <div class="lg:col-span-2">
                  <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted) mb-1">Project / System Title</label>
                  <input type="text" [ngModel]="projectTitle()" (ngModelChange)="projectTitle.set($event)"
                         class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted) mb-1">Version</label>
                  <input type="text" [ngModel]="version()" (ngModelChange)="version.set($event)"
                         class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted) mb-1">Status</label>
                  <select [ngModel]="brdSections().documentStatus || 'Draft'"
                          (ngModelChange)="patchBrdSection('documentStatus', $event)"
                          class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none cursor-pointer">
                    <option value="Draft" class="bg-(--postonsteroids-bg-secondary)">Draft</option>
                    <option value="In Review" class="bg-(--postonsteroids-bg-secondary)">In Review</option>
                    <option value="Approved" class="bg-(--postonsteroids-bg-secondary)">Approved</option>
                    <option value="Final" class="bg-(--postonsteroids-bg-secondary)">Final</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted) mb-1">Author</label>
                  <input type="text" [ngModel]="author()" (ngModelChange)="author.set($event)"
                         class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted) mb-1">Organization</label>
                  <input type="text" [ngModel]="organization()" (ngModelChange)="organization.set($event)"
                         class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none focus:border-blue-500" />
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted) mb-1">Target Release / Milestone</label>
                  <input type="text" [ngModel]="brdSections().targetRelease || ''" (ngModelChange)="patchBrdSection('targetRelease', $event)"
                         placeholder="e.g. Q4 Core API Gateway v2.4"
                         class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-(--postonsteroids-text-muted) mb-1">Stakeholders &amp; Reviewers</label>
                  <input type="text" [ngModel]="brdSections().stakeholders || ''" (ngModelChange)="patchBrdSection('stakeholders', $event)"
                         placeholder="e.g. Product Lead, Platform Security, Backend Engineering, QA"
                         class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>

            <!-- Structured Editable BRD Narrative Sections -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-2">
                <label class="block font-bold text-sm text-(--postonsteroids-text-primary)">2. Executive Summary &amp; Business Context</label>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">Markdown supported. Leave empty to auto-generate a summary from your capsule.</p>
                <textarea rows="5" [ngModel]="brdSections().executiveSummary || ''" (ngModelChange)="patchBrdSection('executiveSummary', $event)"
                          placeholder="Summarize business problem, API capability, and value delivered..."
                          class="w-full px-3 py-2 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
              </div>

              <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-2">
                <label class="block font-bold text-sm text-(--postonsteroids-text-primary)">2.1 Business Objectives &amp; Success Metrics</label>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">Markdown bullet points recommended (<code>- **Metric:** ...</code>).</p>
                <textarea rows="5" [ngModel]="brdSections().businessObjectives || ''" (ngModelChange)="patchBrdSection('businessObjectives', $event)"
                          placeholder="- Reduce partner onboarding time by 50%&#10;- Maintain < 300ms p95 API latency"
                          class="w-full px-3 py-2 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
              </div>

              <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-2">
                <label class="block font-bold text-sm text-(--postonsteroids-text-primary)">3. In-Scope Boundaries &amp; Actors</label>
                <textarea rows="4" [ngModel]="brdSections().inScopeNotes || ''" (ngModelChange)="patchBrdSection('inScopeNotes', $event)"
                          placeholder="Detail included APIs, client channels, and integration flows..."
                          class="w-full px-3 py-2 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
              </div>

              <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-2">
                <label class="block font-bold text-sm text-(--postonsteroids-text-primary)">3. Out-of-Scope Boundaries</label>
                <textarea rows="4" [ngModel]="brdSections().outOfScopeNotes || ''" (ngModelChange)="patchBrdSection('outOfScopeNotes', $event)"
                          placeholder="Clarify explicitly excluded items, legacy endpoints, or future phases..."
                          class="w-full px-3 py-2 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
              </div>

              <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-2">
                <label class="block font-bold text-sm text-(--postonsteroids-text-primary)">5. Non-Functional Requirements &amp; SLAs</label>
                <textarea rows="4" [ngModel]="brdSections().nonFunctionalRequirements || ''" (ngModelChange)="patchBrdSection('nonFunctionalRequirements', $event)"
                          placeholder="- 99.95% availability SLA&#10;- Rate limit: 1000 req/min per API key&#10;- Idempotency required on POST payments"
                          class="w-full px-3 py-2 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
              </div>

              <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-2">
                <label class="block font-bold text-sm text-(--postonsteroids-text-primary)">5.1 Security &amp; Compliance / 6.1 Rollout Notes</label>
                <textarea rows="2" [ngModel]="brdSections().securityAndCompliance || ''" (ngModelChange)="patchBrdSection('securityAndCompliance', $event)"
                          placeholder="Security notes (OAuth2 scopes, PII masking, TLS 1.3, audit trails)..."
                          class="w-full px-3 py-2 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
                <textarea rows="2" [ngModel]="brdSections().rolloutAndAssumptions || ''" (ngModelChange)="patchBrdSection('rolloutAndAssumptions', $event)"
                          placeholder="Rollout plan, migration notes, dependencies & assumptions..."
                          class="w-full px-3 py-2 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
              </div>
            </div>

            <!-- Unlimited Custom Headings, Subheadings & Descriptions per Capsule -->
            <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 space-y-3 text-xs">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-sm font-bold text-(--postonsteroids-text-primary)">Custom Headings, Subheadings &amp; Descriptions</h2>
                  <p class="text-[11px] text-(--postonsteroids-text-muted)">Add as many custom headers, subheadings, or detailed paragraphs as needed to include in this capsule's BRD &amp; Technical Docs.</p>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  <button type="button" (click)="addCapsuleCustomBlock('heading')"
                          class="px-2.5 py-1 rounded-lg border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 font-semibold cursor-pointer flex items-center gap-1">
                    <mat-icon class="text-[14px]! size-[14px]!">title</mat-icon>
                    <span>+ Add Heading</span>
                  </button>
                  <button type="button" (click)="addCapsuleCustomBlock('subheading')"
                          class="px-2.5 py-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 font-semibold cursor-pointer flex items-center gap-1">
                    <mat-icon class="text-[14px]! size-[14px]!">subtitles</mat-icon>
                    <span>+ Add Subheading</span>
                  </button>
                  <button type="button" (click)="addCapsuleCustomBlock('description')"
                          class="px-2.5 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-semibold cursor-pointer flex items-center gap-1">
                    <mat-icon class="text-[14px]! size-[14px]!">notes</mat-icon>
                    <span>+ Add Description</span>
                  </button>
                </div>
              </div>

              @let capBlocks = brdSections().customBlocks || [];
              @if (capBlocks.length === 0) {
                <div class="rounded-lg border border-dashed border-(--postonsteroids-border) p-4 text-center text-(--postonsteroids-text-muted)">
                  No custom sections yet. Click <strong>+ Add Heading</strong>, <strong>+ Add Subheading</strong>, or <strong>+ Add Description</strong> above.
                </div>
              } @else {
                <div class="space-y-2.5">
                  @for (blk of capBlocks; track blk.id; let idx = $index) {
                    <div class="rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary) p-3 space-y-2">
                      <div class="flex items-center justify-between gap-2">
                        <select [ngModel]="blk.kind" (ngModelChange)="updateCapsuleCustomBlock(blk.id, { kind: $event })"
                                class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded px-2 py-1 text-[11px] font-semibold outline-none cursor-pointer">
                          <option value="heading">Heading (H2)</option>
                          <option value="subheading">Subheading (H3)</option>
                          <option value="description">Description / Paragraph</option>
                        </select>
                        <div class="flex items-center gap-1">
                          <button type="button" (click)="moveCapsuleCustomBlock(idx, -1)" [disabled]="idx === 0"
                                  title="Move Up" class="p-1 rounded hover:bg-(--postonsteroids-bg-hover) disabled:opacity-30 cursor-pointer">
                            <mat-icon class="text-[15px]! size-[15px]!">arrow_upward</mat-icon>
                          </button>
                          <button type="button" (click)="moveCapsuleCustomBlock(idx, 1)" [disabled]="idx === capBlocks.length - 1"
                                  title="Move Down" class="p-1 rounded hover:bg-(--postonsteroids-bg-hover) disabled:opacity-30 cursor-pointer">
                            <mat-icon class="text-[15px]! size-[15px]!">arrow_downward</mat-icon>
                          </button>
                          <button type="button" (click)="removeCapsuleCustomBlock(blk.id)"
                                  title="Delete block" class="p-1 rounded hover:bg-red-500/15 text-status-danger cursor-pointer">
                            <mat-icon class="text-[15px]! size-[15px]!">delete</mat-icon>
                          </button>
                        </div>
                      </div>
                      @if (blk.kind === 'description') {
                        <textarea rows="3" [ngModel]="blk.text" (ngModelChange)="updateCapsuleCustomBlock(blk.id, { text: $event })"
                                  placeholder="Enter detailed Markdown description or business narrative..."
                                  class="w-full px-3 py-2 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
                      } @else {
                        <input type="text" [ngModel]="blk.text" (ngModelChange)="updateCapsuleCustomBlock(blk.id, { text: $event })"
                               [placeholder]="blk.kind === 'heading' ? 'Custom section header...' : 'Custom subheading...'"
                               class="w-full px-3 py-1.5 rounded-lg bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) text-xs font-semibold outline-none focus:border-blue-500" />
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        } @else if (viewTab() === 'edit-endpoints') {
          <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-3 text-xs">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-(--postonsteroids-text-muted)">
                Select endpoints to include and edit per-endpoint documentation notes &amp; TestRail steps (changes save straight to each request).
              </span>
              <div class="flex items-center gap-2">
                <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) hover:border-(--postonsteroids-accent)/60 cursor-pointer select-none font-semibold">
                  <input type="checkbox"
                         [checked]="areAllEndpointsSelected()"
                         (change)="toggleSelectAllEndpoints()"
                         class="accent-(--postonsteroids-accent) cursor-pointer" />
                  <span>{{ areAllEndpointsSelected() ? 'Deselect All' : 'Select All' }} ({{ scopedRequests().length }})</span>
                </label>
              </div>
            </div>

            @if (scopedRequests().length === 0) {
              <div class="rounded-xl border border-dashed border-(--postonsteroids-border) p-10 text-center text-(--postonsteroids-text-muted)">
                No requests found in this capsule / folder.
              </div>
            } @else {
              @for (req of scopedRequests(); track req.id) {
                @let isIncluded = isEndpointSelected(req.id);
                @let isOpenEp = expandedEndpointId() === req.id;
                <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) overflow-hidden">
                  <div class="px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-(--postonsteroids-bg-tertiary)/40">
                    <div class="flex items-center gap-2.5 min-w-0 flex-1">
                      <input type="checkbox"
                             [checked]="isIncluded"
                             (change)="toggleEndpointSelection(req.id)"
                             class="accent-(--postonsteroids-accent) cursor-pointer shrink-0" />
                      <span class="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) shrink-0"
                            [style.color]="getMethodColor(req.method)">
                        {{ req.method }}
                      </span>
                      <span class="font-semibold truncate">{{ tabStateService.resolveRequestTitle(req.name, req.url) }}</span>
                      <span class="font-mono text-[11px] text-(--postonsteroids-text-muted) truncate">{{ req.url || '(no URL)' }}</span>
                    </div>
                    <button type="button" (click)="expandedEndpointId.set(isOpenEp ? null : req.id)"
                            class="px-2.5 py-1 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary) hover:border-blue-500/60 font-semibold cursor-pointer">
                      {{ isOpenEp ? 'Collapse' : 'Edit Notes & TestRail' }}
                    </button>
                  </div>

                  @if (isOpenEp) {
                    <div class="p-4 border-t border-(--postonsteroids-border) space-y-3">
                      <div>
                        <label class="block font-semibold text-(--postonsteroids-text-secondary) mb-1">Short Description</label>
                        <input type="text" [ngModel]="req.description || ''" (ngModelChange)="updateEndpointField(req.id, 'description', $event)"
                               placeholder="Brief endpoint summary..."
                               class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) outline-none focus:border-blue-500" />
                      </div>
                      <div>
                        <label class="block font-semibold text-(--postonsteroids-text-secondary) mb-1">Detailed Doc / BRD Content (Markdown)</label>
                        <textarea rows="4" [ngModel]="req.docNotes || ''" (ngModelChange)="updateEndpointField(req.id, 'docNotes', $event)"
                                  placeholder="Business rules, error handling, edge cases..."
                                  class="w-full px-2.5 py-2 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11.5px] outline-none focus:border-blue-500 resize-y"></textarea>
                      </div>
                      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label class="block font-semibold text-teal-400 mb-1">TestRail Preconditions</label>
                          <textarea rows="3" [ngModel]="req.testRailPreconditions || ''" (ngModelChange)="updateEndpointField(req.id, 'testRailPreconditions', $event)"
                                    class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-[11px] outline-none focus:border-teal-500 resize-y"></textarea>
                        </div>
                        <div>
                          <label class="block font-semibold text-teal-400 mb-1">TestRail Steps (1 per line)</label>
                          <textarea rows="3" [ngModel]="req.testRailSteps || ''" (ngModelChange)="updateEndpointField(req.id, 'testRailSteps', $event)"
                                    class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-[11px] outline-none focus:border-teal-500 resize-y"></textarea>
                        </div>
                        <div>
                          <label class="block font-semibold text-teal-400 mb-1">TestRail Expected Result</label>
                          <textarea rows="3" [ngModel]="req.testRailExpected || ''" (ngModelChange)="updateEndpointField(req.id, 'testRailExpected', $event)"
                                    class="w-full px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-[11px] outline-none focus:border-teal-500 resize-y"></textarea>
                        </div>
                      </div>

                      <!-- Per-Endpoint Custom Headings, Subheadings & Descriptions -->
                      <div class="rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary)/60 p-3 space-y-2">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <span class="font-semibold text-(--postonsteroids-text-secondary)">Custom Headings, Subheadings &amp; Descriptions (This Endpoint)</span>
                          <div class="flex flex-wrap items-center gap-1.5">
                            <button type="button" (click)="addEndpointCustomBlock(req.id, 'heading')"
                                    class="px-2 py-0.5 rounded border border-blue-500/40 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 font-semibold cursor-pointer text-[10.5px]">
                              + Heading
                            </button>
                            <button type="button" (click)="addEndpointCustomBlock(req.id, 'subheading')"
                                    class="px-2 py-0.5 rounded border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 font-semibold cursor-pointer text-[10.5px]">
                              + Subheading
                            </button>
                            <button type="button" (click)="addEndpointCustomBlock(req.id, 'description')"
                                    class="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-semibold cursor-pointer text-[10.5px]">
                              + Description
                            </button>
                          </div>
                        </div>
                        @let epBlocks = req.customDocBlocks || [];
                        @if (epBlocks.length > 0) {
                          <div class="space-y-2">
                            @for (eb of epBlocks; track eb.id; let eIdx = $index) {
                              <div class="rounded border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-2 space-y-1.5">
                                <div class="flex items-center justify-between gap-2">
                                  <select [ngModel]="eb.kind" (ngModelChange)="updateEndpointCustomBlock(req.id, eb.id, { kind: $event })"
                                          class="bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) rounded px-2 py-0.5 text-[10.5px] font-semibold outline-none cursor-pointer">
                                    <option value="heading">Heading</option>
                                    <option value="subheading">Subheading</option>
                                    <option value="description">Description</option>
                                  </select>
                                  <div class="flex items-center gap-1">
                                    <button type="button" (click)="moveEndpointCustomBlock(req.id, eIdx, -1)" [disabled]="eIdx === 0"
                                            class="p-0.5 rounded hover:bg-(--postonsteroids-bg-hover) disabled:opacity-30 cursor-pointer">
                                      <mat-icon class="text-[14px]! size-[14px]!">arrow_upward</mat-icon>
                                    </button>
                                    <button type="button" (click)="moveEndpointCustomBlock(req.id, eIdx, 1)" [disabled]="eIdx === epBlocks.length - 1"
                                            class="p-0.5 rounded hover:bg-(--postonsteroids-bg-hover) disabled:opacity-30 cursor-pointer">
                                      <mat-icon class="text-[14px]! size-[14px]!">arrow_downward</mat-icon>
                                    </button>
                                    <button type="button" (click)="removeEndpointCustomBlock(req.id, eb.id)"
                                            class="p-0.5 rounded hover:bg-red-500/15 text-status-danger cursor-pointer">
                                      <mat-icon class="text-[14px]! size-[14px]!">delete</mat-icon>
                                    </button>
                                  </div>
                                </div>
                                @if (eb.kind === 'description') {
                                  <textarea rows="2" [ngModel]="eb.text" (ngModelChange)="updateEndpointCustomBlock(req.id, eb.id, { text: $event })"
                                            placeholder="Custom endpoint description..."
                                            class="w-full px-2 py-1 rounded bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) font-mono text-[11px] outline-none focus:border-blue-500 resize-y"></textarea>
                                } @else {
                                  <input type="text" [ngModel]="eb.text" (ngModelChange)="updateEndpointCustomBlock(req.id, eb.id, { text: $event })"
                                         [placeholder]="eb.kind === 'heading' ? 'Custom header...' : 'Custom subheading...'"
                                         class="w-full px-2 py-1 rounded bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) text-[11px] font-semibold outline-none focus:border-blue-500" />
                                }
                              </div>
                            }
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              }
            }
          </div>
        } @else if (viewTab() === 'preview') {
          <div class="flex-1 min-h-0 p-4 flex flex-col">
            <iframe #previewFrame sandbox="" title="Documentation Live Preview"
                    class="w-full flex-1 min-h-0 rounded-xl border border-(--postonsteroids-border) bg-white"></iframe>
          </div>
        } @else {
          <div class="flex-1 min-h-0 p-4 flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs shrink-0">
              <span class="text-(--postonsteroids-text-muted)">
                Edit raw Markdown directly to customize output, or click Reset to sync with structured fields.
              </span>
              @if (customMarkdownOverride()) {
                <button type="button" (click)="customMarkdownOverride.set('')"
                        class="px-2.5 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 font-semibold cursor-pointer">
                  Sync Back to Auto-Generated
                </button>
              }
            </div>
            <textarea [ngModel]="customMarkdownOverride() || generated().markdown"
                      (ngModelChange)="customMarkdownOverride.set($event)"
                      class="w-full flex-1 min-h-0 rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) p-4 font-mono text-[12px] text-(--postonsteroids-text-primary) outline-none resize-none"></textarea>
          </div>
        }
      </div>

      <!-- Footer Export Bar -->
      <div class="px-6 py-3 border-t border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) flex flex-wrap items-center justify-between gap-2 shrink-0">
        <span class="text-[11px] text-(--postonsteroids-text-muted)">
          Ready to export {{ targetRequests().length }} endpoint(s) &bull; {{ capsuleName() }}
        </span>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" (click)="copyMarkdown()"
                  class="px-3 py-1.5 rounded-md border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer">
            <mat-icon class="text-[14px]! size-[14px]!">content_copy</mat-icon>
            <span>Copy MD</span>
          </button>
          <button type="button" (click)="downloadMarkdown()"
                  class="px-3 py-1.5 rounded-md border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer">
            <mat-icon class="text-[14px]! size-[14px]!">download</mat-icon>
            <span>.md</span>
          </button>
          <button type="button" (click)="downloadHtml()"
                  class="px-3 py-1.5 rounded-md border border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer">
            <mat-icon class="text-[14px]! size-[14px]!">html</mat-icon>
            <span>.html</span>
          </button>
          <button type="button" (click)="downloadWordDoc()"
                  class="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-[11px] font-semibold text-white flex items-center gap-1.5 cursor-pointer">
            <mat-icon class="text-[14px]! size-[14px]!">article</mat-icon>
            <span>Word (.doc)</span>
          </button>
          <button type="button" (click)="downloadTestRailXml()"
                  title="Download TestRail Suite XML (importable via TestRail -> Import from XML)"
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
            <span>Push TestRail API</span>
          </button>
          <button type="button" (click)="printDocument()"
                  class="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-[11px] font-semibold text-white flex items-center gap-1.5 cursor-pointer">
            <mat-icon class="text-[14px]! size-[14px]!">print</mat-icon>
            <span>Print / PDF</span>
          </button>
        </div>
      </div>
    </div>
  `
})
export class DocumentationComponent {
  tabStateService = inject(TabStateService);
  private variableService = inject(VariableService);
  private environmentService = inject(EnvironmentService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  previewFrame = viewChild<ElementRef<HTMLIFrameElement>>('previewFrame');

  mode = signal<'api-doc' | 'brd' | 'testrail'>('brd');
  viewTab = signal<StudioViewTab>('edit-brd');
  selectedCapsuleId = signal<string>(this.tabStateService.activeCapsuleId() || '1');
  selectedGroupId = signal<string>('__all__');
  includeAllEndpoints = signal<boolean>(true);
  selectedRequestIds = signal<Set<string>>(new Set());
  expandedEndpointId = signal<string | null>(null);
  isSavingDocs = signal<boolean>(false);
  private lastSyncedActiveCapId = this.tabStateService.activeCapsuleId() || '1';

  projectTitle = signal<string>('');
  version = signal<string>('1.0.0');
  author = signal<string>('Solutions Architecture Team');
  organization = signal<string>('Engineering & Product');
  brdSections = signal<BrdEditableSections>(this.tabStateService.getBrdSectionsForCapsule(this.tabStateService.activeCapsuleId() || '1'));
  customMarkdownOverride = signal<string>('');

  showTestRailPanel = signal<boolean>(false);
  trUrl = signal<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('onsteroids_tr_url') || '') : '');
  trEmail = signal<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('onsteroids_tr_email') || '') : '');
  trApiKey = signal<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('onsteroids_tr_key') || '') : '');
  trSectionId = signal<string>(typeof localStorage !== 'undefined' ? (localStorage.getItem('onsteroids_tr_section') || '') : '');
  isPushingTestRail = signal<boolean>(false);
  trStatus = signal<string>('');
  trError = signal<boolean>(false);

  capsuleName = computed(() => {
    const capId = this.selectedCapsuleId();
    return this.tabStateService.capsules().find(c => c.id === capId)?.name || 'API Collection';
  });

  availableGroups = computed(() =>
    this.tabStateService.getGroupsForCapsule(this.selectedCapsuleId())
  );

  allCapsuleRequests = computed<RequestState[]>(() => {
    this.tabStateService.runnerTreeVersion();
    const capId = this.selectedCapsuleId();
    const list = this.tabStateService.getCapsuleRequestsSync(capId);
    if (list.length > 0) return list;
    return capId === this.tabStateService.activeCapsuleId()
      ? this.tabStateService.allCapsuleRequests()
      : [];
  });

  scopedRequests = computed<RequestState[]>(() => {
    const all = this.allCapsuleRequests();
    const gId = this.selectedGroupId();
    if (!gId || gId === '__all__') return all;
    const descIds = new Set(this.tabStateService.getDescendantGroupIds([gId], this.selectedCapsuleId()));
    return all.filter(r => r.groupId && descIds.has(r.groupId));
  });

  areAllEndpointsSelected = computed<boolean>(() => {
    const scoped = this.scopedRequests();
    if (scoped.length === 0) return false;
    if (this.includeAllEndpoints()) return true;
    const chosen = this.selectedRequestIds();
    return scoped.every(r => chosen.has(r.id));
  });

  targetRequests = computed<RequestState[]>(() => {
    const scoped = this.scopedRequests();
    if (this.includeAllEndpoints()) return scoped;
    const chosen = this.selectedRequestIds();
    return scoped.filter(r => chosen.has(r.id));
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
    const capId = this.selectedCapsuleId();
    const groupNamesById: Record<string, string> = {};
    for (const g of this.availableGroups()) {
      groupNamesById[g.id] = this.tabStateService.getFolderFullPath(g.id, capId) || g.name;
    }
    const targetReqs = this.targetRequests();
    return generateDocumentationOrBrd({
      mode: this.mode(),
      scope: targetReqs.length === 1 && !this.includeAllEndpoints() ? 'endpoint' : 'collection',
      projectTitle: this.projectTitle().trim() || this.capsuleName(),
      version: this.version().trim() || '1.0.0',
      author: this.author().trim() || 'Solutions Architecture Team',
      organization: this.organization().trim() || 'Engineering & Product',
      capsuleName: this.capsuleName(),
      requests: targetReqs,
      variables: this.mergedVariables(),
      groupNamesById,
      brdSections: this.brdSections(),
      customMarkdownOverride: this.customMarkdownOverride().trim() ? this.customMarkdownOverride() : undefined
    });
  });

  constructor() {
    if (!this.projectTitle().trim()) {
      this.projectTitle.set(this.capsuleName());
    }
    void this.tabStateService.preloadCapsuleRequestsForRunner(this.selectedCapsuleId());

    // Keep Studio synchronized whenever user switches active capsule in OnSteroid workspace
    effect(() => {
      const workspaceCapId = this.tabStateService.activeCapsuleId();
      if (workspaceCapId && workspaceCapId !== this.lastSyncedActiveCapId) {
        this.lastSyncedActiveCapId = workspaceCapId;
        this.applyCapsuleContext(workspaceCapId);
      }
    });

    // Reload current capsule BRD sections when backend session / sync updates them
    effect(() => {
      this.tabStateService.brdSectionsVersion();
      const capId = this.selectedCapsuleId();
      this.brdSections.set(this.tabStateService.getBrdSectionsForCapsule(capId));
    });

    effect(() => {
      const frame = this.previewFrame()?.nativeElement;
      if (frame && this.viewTab() === 'preview') {
        frame.srcdoc = this.generated().html;
      }
    });
  }

  private applyCapsuleContext(capId: string): void {
    this.selectedCapsuleId.set(capId);
    this.selectedGroupId.set('__all__');
    this.includeAllEndpoints.set(true);
    this.selectedRequestIds.set(new Set());
    this.expandedEndpointId.set(null);
    this.customMarkdownOverride.set('');
    this.brdSections.set(this.tabStateService.getBrdSectionsForCapsule(capId));
    const capName = this.tabStateService.capsules().find(c => c.id === capId)?.name || 'API Collection';
    this.projectTitle.set(capName);
    void this.tabStateService.preloadCapsuleRequestsForRunner(capId);
  }

  setDocMode(m: 'api-doc' | 'brd' | 'testrail'): void {
    this.mode.set(m);
    this.customMarkdownOverride.set('');
  }

  openMarkdownTab(): void {
    this.viewTab.set('markdown');
  }

  onCapsuleChange(capId: string): void {
    this.applyCapsuleContext(capId);
  }

  onGroupChange(groupId: string): void {
    this.selectedGroupId.set(groupId);
    this.includeAllEndpoints.set(true);
    this.selectedRequestIds.set(new Set());
    this.expandedEndpointId.set(null);
    this.customMarkdownOverride.set('');
  }

  patchBrdSection<K extends keyof BrdEditableSections>(field: K, value: BrdEditableSections[K]): void {
    this.customMarkdownOverride.set('');
    this.brdSections.update(curr => {
      const next = { ...curr, [field]: value };
      this.tabStateService.saveBrdSectionsForCapsule(this.selectedCapsuleId(), next);
      return next;
    });
  }

  addCapsuleCustomBlock(kind: 'heading' | 'subheading' | 'description'): void {
    const currBlocks = this.brdSections().customBlocks || [];
    const nextBlocks: CustomDocBlock[] = [
      ...currBlocks,
      { id: `cbrd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, kind, text: '' }
    ];
    this.patchBrdSection('customBlocks', nextBlocks);
  }

  updateCapsuleCustomBlock(blockId: string, patch: Partial<CustomDocBlock>): void {
    const currBlocks = this.brdSections().customBlocks || [];
    const nextBlocks = currBlocks.map(b => b.id === blockId ? { ...b, ...patch } : b);
    this.patchBrdSection('customBlocks', nextBlocks);
  }

  moveCapsuleCustomBlock(index: number, delta: -1 | 1): void {
    const currBlocks = [...(this.brdSections().customBlocks || [])];
    const target = index + delta;
    if (target < 0 || target >= currBlocks.length) return;
    const [moved] = currBlocks.splice(index, 1);
    currBlocks.splice(target, 0, moved);
    this.patchBrdSection('customBlocks', currBlocks);
  }

  removeCapsuleCustomBlock(blockId: string): void {
    const nextBlocks = (this.brdSections().customBlocks || []).filter(b => b.id !== blockId);
    this.patchBrdSection('customBlocks', nextBlocks);
  }

  async saveAllDocumentation(): Promise<void> {
    this.isSavingDocs.set(true);
    try {
      await this.tabStateService.saveDocumentationContext(this.selectedCapsuleId(), this.brdSections());
    } finally {
      this.isSavingDocs.set(false);
    }
  }

  resetBrdSections(): void {
    const clean: BrdEditableSections = { documentStatus: 'Draft' };
    this.brdSections.set(clean);
    this.customMarkdownOverride.set('');
    this.tabStateService.saveBrdSectionsForCapsule(this.selectedCapsuleId(), clean);
    this.notificationService.notify('Reset custom BRD section overrides to auto-generated defaults.');
  }

  isEndpointSelected(id: string): boolean {
    if (this.includeAllEndpoints()) return true;
    return this.selectedRequestIds().has(id);
  }

  toggleEndpointSelection(id: string): void {
    const scoped = this.scopedRequests().map(r => r.id);
    if (this.includeAllEndpoints()) {
      const next = new Set(scoped);
      next.delete(id);
      this.includeAllEndpoints.set(false);
      this.selectedRequestIds.set(next);
      return;
    }
    this.selectedRequestIds.update(curr => {
      const next = new Set(curr);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleSelectAllEndpoints(): void {
    const scoped = this.scopedRequests().map(r => r.id);
    if (this.areAllEndpointsSelected()) {
      this.includeAllEndpoints.set(false);
      this.selectedRequestIds.set(new Set());
    } else {
      this.includeAllEndpoints.set(true);
      this.selectedRequestIds.set(new Set(scoped));
    }
  }

  addEndpointCustomBlock(reqId: string, kind: 'heading' | 'subheading' | 'description'): void {
    this.customMarkdownOverride.set('');
    const curr = this.tabStateService.getState(reqId)?.customDocBlocks || [];
    const next: CustomDocBlock[] = [
      ...curr,
      { id: `epcb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, kind, text: '' }
    ];
    this.tabStateService.updateState(reqId, { customDocBlocks: next });
  }

  updateEndpointCustomBlock(reqId: string, blockId: string, patch: Partial<CustomDocBlock>): void {
    this.customMarkdownOverride.set('');
    const curr = this.tabStateService.getState(reqId)?.customDocBlocks || [];
    const next = curr.map(b => b.id === blockId ? { ...b, ...patch } : b);
    this.tabStateService.updateState(reqId, { customDocBlocks: next });
  }

  moveEndpointCustomBlock(reqId: string, index: number, delta: -1 | 1): void {
    this.customMarkdownOverride.set('');
    const curr = [...(this.tabStateService.getState(reqId)?.customDocBlocks || [])];
    const target = index + delta;
    if (target < 0 || target >= curr.length) return;
    const [moved] = curr.splice(index, 1);
    curr.splice(target, 0, moved);
    this.tabStateService.updateState(reqId, { customDocBlocks: curr });
  }

  removeEndpointCustomBlock(reqId: string, blockId: string): void {
    this.customMarkdownOverride.set('');
    const curr = this.tabStateService.getState(reqId)?.customDocBlocks || [];
    const next = curr.filter(b => b.id !== blockId);
    this.tabStateService.updateState(reqId, { customDocBlocks: next });
  }

  updateEndpointField(
    reqId: string,
    field: 'description' | 'docNotes' | 'testRailPreconditions' | 'testRailSteps' | 'testRailExpected',
    val: string
  ): void {
    this.customMarkdownOverride.set('');
    this.tabStateService.updateState(reqId, { [field]: val });
  }

  getMethodColor(method: string): string {
    return getHttpMethodColor(method);
  }

  private fileBaseName(): string {
    const clean = (this.projectTitle().trim() || this.capsuleName())
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'api_document';
    const suffix = this.mode() === 'brd' ? 'brd' : (this.mode() === 'testrail' ? 'testrail_cases' : 'api_docs');
    return `${clean}_${suffix}`;
  }

  private triggerDownload(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async copyMarkdown(): Promise<void> {
    await copyTextToClipboard(this.generated().markdown);
    this.notificationService.notify('Markdown document copied to clipboard.', 'success');
  }

  downloadMarkdown(): void {
    this.triggerDownload(this.generated().markdown, `${this.fileBaseName()}.md`, 'text/markdown;charset=utf-8');
    this.notificationService.notify('Downloaded Markdown document.', 'success');
  }

  downloadHtml(): void {
    this.triggerDownload(this.generated().html, `${this.fileBaseName()}.html`, 'text/html;charset=utf-8');
    this.notificationService.notify('Downloaded HTML documentation.', 'success');
  }

  downloadWordDoc(): void {
    this.triggerDownload(this.generated().wordHtml, `${this.fileBaseName()}.doc`, 'application/msword;charset=utf-8');
    this.notificationService.notify('Exported Word (.doc) document.', 'success');
  }

  downloadTestRailXml(): void {
    const xml = this.generated().testRailXml || '';
    if (!xml) return;
    this.triggerDownload(xml, `${this.fileBaseName()}_testrail.xml`, 'application/xml;charset=utf-8');
    this.notificationService.notify('Exported native TestRail Suite XML (import via TestRail -> Import from XML).', 'success');
  }

  downloadTestRailCsv(): void {
    const csv = this.generated().testRailCsv || '';
    if (!csv) return;
    this.triggerDownload(csv, `${this.fileBaseName()}_testrail.csv`, 'text/csv;charset=utf-8');
    this.notificationService.notify('Exported TestRail CSV file.', 'success');
  }

  printDocument(): void {
    const win = window.open('', '_blank', 'width=960,height=800');
    if (!win) {
      this.notificationService.notify('Allow pop-ups to print or save as PDF.', 'warning');
      return;
    }
    win.document.open();
    win.document.write(this.generated().html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 200);
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

  goToWorkspace(): void {
    void this.router.navigate(['/']);
  }
}
