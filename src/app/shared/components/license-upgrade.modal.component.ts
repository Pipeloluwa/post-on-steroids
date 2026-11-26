import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../services/auth.service';
import { NotificationService } from '../services/notification.service';
import { SubscriptionService } from '../services/subscription.service';
import {
  formatRegistrationCodeInput,
  validateLicenseActivationInput,
} from '../utils/license-code.util';
import { EditionTier } from '../../../environments/edition.types';

interface TierCardSpec {
  id: EditionTier;
  name: string;
  tagline: string;
  badge: string;
  highlights: string[];
}

interface QaPreviewOption {
  key: string;
  tier: EditionTier;
  short: string;
  licenseType: string | null;
  individualType: string | null;
}

const TIER_CARDS: TierCardSpec[] = [
  {
    id: 'community',
    name: 'Community',
    tagline: 'Free Forever',
    badge: 'FREE',
    highlights: [
      'REST, GraphQL & WebSocket workspace',
      'Swagger / Postman / cURL / HAR import',
      'Local scripting, crypto & request history',
    ],
  },
  {
    id: 'professional',
    name: 'Pro (Personal)',
    tagline: 'Personal by Default · $9/mo',
    badge: 'PRO',
    highlights: [
      'Multi-environment switcher & presets',
      'Integrated sandbox terminal & npm tools',
      'Scheduled triggers & request chaining',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Teams & Compliance',
    badge: 'ENT',
    highlights: [
      'Full Documentation & Enterprise BRD Studio',
      'TestRail suite & PDF/HTML compliance exports',
      'Domain OTP enrollment & multi-seat volume keys',
    ],
  },
];

@Component({
  selector: 'app-license-upgrade-modal',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    @if (subscription.showUpgradeModal()) {
      <div
        class="fixed inset-0 z-1050 flex items-center justify-center bg-black/65 backdrop-blur-xs p-3 sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="license-modal-title"
        (click)="subscription.closeUpgradeModal()"
      >
        <div
          class="w-full max-w-4xl max-h-[min(88dvh,calc(100dvh-28px))] flex flex-col rounded-2xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) shadow-2xl overflow-hidden text-(--postonsteroids-text-primary)"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="px-5 py-4 border-b border-(--postonsteroids-border)/70 flex items-center justify-between gap-3 shrink-0 bg-(--postonsteroids-bg-primary)/60">
            <div class="flex items-center gap-3 min-w-0">
              <div class="size-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                <mat-icon class="text-[20px]! size-[20px]!">workspace_premium</mat-icon>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 id="license-modal-title" class="text-[15px] font-bold tracking-tight">
                    OnSteroid Plan &amp; License Activation
                  </h2>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border"
                    [class.bg-sky-500/15]="subscription.isPersonalLicense()"
                    [class.text-sky-300]="subscription.isPersonalLicense()"
                    [class.border-sky-500/35]="subscription.isPersonalLicense()"
                    [class.bg-amber-500/15]="!subscription.isPersonalLicense() && subscription.tier() === 'enterprise'"
                    [class.text-amber-400]="!subscription.isPersonalLicense() && subscription.tier() === 'enterprise'"
                    [class.border-amber-500/35]="!subscription.isPersonalLicense() && subscription.tier() === 'enterprise'"
                    [class.bg-indigo-500/15]="!subscription.isPersonalLicense() && subscription.tier() === 'professional'"
                    [class.text-indigo-400]="!subscription.isPersonalLicense() && subscription.tier() === 'professional'"
                    [class.border-indigo-500/35]="!subscription.isPersonalLicense() && subscription.tier() === 'professional'"
                    [class.bg-(--postonsteroids-bg-tertiary)]="!subscription.isPersonalLicense() && subscription.tier() === 'community'"
                    [class.text-(--postonsteroids-text-muted)]="!subscription.isPersonalLicense() && subscription.tier() === 'community'"
                    [class.border-(--postonsteroids-border)]="!subscription.isPersonalLicense() && subscription.tier() === 'community'"
                  >
                    {{ subscription.isPersonalLicense() ? subscription.label() : subscription.label() + ' (' + subscription.badgeLabel() + ')' }}
                  </span>
                </div>
                <p class="text-[11.5px] text-(--postonsteroids-text-muted) truncate mt-0.5">
                  Activate a key or automatically work under an OTP-verified organization email domain license.
                </p>
              </div>
            </div>

            <button
              type="button"
              (click)="subscription.closeUpgradeModal()"
              aria-label="Close plan modal"
              class="size-8 rounded-lg flex items-center justify-center text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) hover:bg-(--postonsteroids-bg-hover) cursor-pointer transition-colors shrink-0"
            >
              <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
            </button>
          </div>

          <!-- Scrollable Content -->
          <div class="p-5 overflow-y-auto flex-1 space-y-4">
            <!-- Personal Individual License Guard Indicator -->
            @if (subscription.isPersonalLicense()) {
              <div class="rounded-xl border border-sky-500/35 bg-sky-500/10 p-3.5 flex items-start gap-2.5 text-[12px] text-sky-100">
                <mat-icon class="text-[18px]! size-[18px]! text-sky-400 shrink-0 mt-0.5">person</mat-icon>
                <div class="space-y-0.5">
                  <div class="font-bold flex items-center gap-2 flex-wrap">
                    <span>Personal Individual License Indicator</span>
                    <span class="px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-400/30 text-[10px] font-mono uppercase">
                      {{ entitlement().licenseType || 'individual' }} · {{ entitlement().individualType || 'personal' }}
                    </span>
                  </div>
                  <p class="text-[11.5px] text-sky-200/85">
                    Personal individual licenses are scoped to single-user workflows and cannot be bypassed into Enterprise governance, team shared locks, or organization compliance exports.
                  </p>
                </div>
              </div>
            }

            <!-- Current Seat / Status Banner -->
            @if (entitlement().isActive && (entitlement().maskedCode || entitlement().accessSource === 'domain')) {
              <div class="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="space-y-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <mat-icon class="text-[16px]! size-[16px]! text-emerald-400">verified</mat-icon>
                    <span class="text-[12.5px] font-bold text-emerald-300">
                      {{ subscription.label() }} License Active
                    </span>
                    @if (entitlement().maskedCode) {
                      <span class="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[11px] border border-emerald-500/25">
                        {{ entitlement().maskedCode }}
                      </span>
                    }
                    @if (entitlement().licenseType) {
                      <span class="px-1.5 py-0.5 rounded bg-(--postonsteroids-bg-primary)/70 text-[10px] font-semibold uppercase tracking-wide text-(--postonsteroids-text-secondary) border border-(--postonsteroids-border)/70">
                        Type: {{ entitlement().licenseType }}
                      </span>
                    }
                    @if (entitlement().individualType) {
                      <span class="px-1.5 py-0.5 rounded bg-sky-500/15 text-[10px] font-semibold uppercase tracking-wide text-sky-300 border border-sky-500/30">
                        Individual: {{ entitlement().individualType }}
                      </span>
                    }
                    @if (entitlement().accessSource === 'domain' && entitlement().licensedEmailPattern) {
                      <span class="px-1.5 py-0.5 rounded bg-indigo-500/15 text-[10px] font-semibold text-indigo-300 border border-indigo-500/30">
                        OTP Domain: {{ entitlement().licensedEmailPattern }}
                      </span>
                    }
                    @if (entitlement().billingCycle) {
                      <span class="px-1.5 py-0.5 rounded bg-(--postonsteroids-bg-primary)/70 text-[10px] font-semibold uppercase tracking-wide text-(--postonsteroids-text-secondary) border border-(--postonsteroids-border)/70">
                        {{ entitlement().billingCycle }}
                      </span>
                    }
                  </div>
                  <div class="text-[11px] text-(--postonsteroids-text-muted) flex items-center gap-3 flex-wrap">
                    @if (entitlement().expiresAt) {
                      <span>Expires: <strong class="text-(--postonsteroids-text-secondary)">{{ formatDisplayDate(entitlement().expiresAt) }}</strong></span>
                    } @else {
                      <span>Validity: <strong class="text-(--postonsteroids-text-secondary)">Lifetime / Perpetual</strong></span>
                    }
                    @if (entitlement().maxActivations !== null) {
                      <span>Seats: <strong class="text-(--postonsteroids-text-secondary)">{{ entitlement().activeActivations ?? 1 }} / {{ entitlement().maxActivations }}</strong></span>
                    }
                  </div>
                </div>

                <div class="shrink-0 flex items-center gap-2">
                  @if (!confirmDeactivate()) {
                    <button
                      type="button"
                      (click)="confirmDeactivate.set(true)"
                      [disabled]="subscription.isLicenseBusy()"
                      class="px-3 py-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-[11px] font-semibold cursor-pointer transition-colors disabled:opacity-50"
                    >
                      Release Seat
                    </button>
                  } @else {
                    <button
                      type="button"
                      (click)="onDeactivateConfirmed()"
                      [disabled]="subscription.isLicenseBusy()"
                      class="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold cursor-pointer transition-colors disabled:opacity-50"
                    >
                      Confirm Release
                    </button>
                    <button
                      type="button"
                      (click)="confirmDeactivate.set(false)"
                      class="px-2.5 py-1.5 rounded-lg border border-(--postonsteroids-border) hover:bg-(--postonsteroids-bg-hover) text-[11px] cursor-pointer"
                    >
                      Cancel
                    </button>
                  }
                </div>
              </div>
            } @else if (entitlement().status === 'expired' || entitlement().status === 'revoked') {
              <div class="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5 flex items-center gap-2.5 text-[12px] text-amber-200">
                <mat-icon class="text-[18px]! size-[18px]! text-amber-400 shrink-0">warning_amber</mat-icon>
                <span>
                  Your previous license key ({{ entitlement().maskedCode || 'on file' }}) has
                  <strong>{{ entitlement().status === 'revoked' ? 'been revoked' : 'expired' }}</strong>.
                  Enter a renewed registration code below to restore Pro or Enterprise capabilities.
                </span>
              </div>
            }

            <!-- Requested Feature Callout / Free -> Pro Pricing Routing -->
            @if (subscription.requestedPlan(); as reqPlan) {
              <div class="rounded-xl border border-indigo-500/30 bg-indigo-500/8 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-[12px] text-indigo-200">
                <div class="flex items-center gap-2">
                  <mat-icon class="text-[16px]! size-[16px]! text-indigo-400 shrink-0">lock_open</mat-icon>
                  <span>
                    This capability requires a valid
                    <strong class="uppercase">{{ reqPlan === 'enterprise' ? 'Enterprise (Organization / Team)' : 'Pro (Personal) or Enterprise' }}</strong>
                    license{{ subscription.isPersonalLicense() && reqPlan === 'enterprise' ? ' — Personal individual licenses cannot unlock Enterprise.' : '.' }}
                  </span>
                </div>
                @if (reqPlan === 'professional' && subscription.tier() === 'community') {
                  <a [href]="subscription.getHomepagePricingUrl('pro')"
                     target="_blank"
                     rel="noopener noreferrer"
                     class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold shrink-0 no-underline transition-colors">
                    <span>Get Pro on Pricing &amp; Plans</span>
                    <mat-icon class="text-[13px]! size-[13px]!">open_in_new</mat-icon>
                  </a>
                }
              </div>
            } @else if (subscription.tier() === 'community') {
              <div class="rounded-xl border border-indigo-500/30 bg-indigo-500/8 px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-[12px] text-indigo-200">
                <div class="flex items-center gap-2">
                  <mat-icon class="text-[16px]! size-[16px]! text-indigo-400 shrink-0">rocket_launch</mat-icon>
                  <span>
                    Using <strong>Free (Community)</strong>? Activate <strong>Pro (Personal · $9/mo or $84/yr)</strong> from the OnSteroid Homepage Pricing page and redeem your key below.
                  </span>
                </div>
                <a [href]="subscription.getHomepagePricingUrl('pro')"
                   target="_blank"
                   rel="noopener noreferrer"
                   class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold shrink-0 no-underline transition-colors">
                  <span>View Pricing &amp; Get Pro</span>
                  <mat-icon class="text-[13px]! size-[13px]!">open_in_new</mat-icon>
                </a>
              </div>
            }

            <!-- Registration Code Activation Panel -->
            <div class="rounded-xl border border-(--postonsteroids-border) bg-(--postonsteroids-bg-primary)/55 p-4 space-y-3.5">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 class="text-[13px] font-bold">Activate with Registration Code or Domain License</h3>
                  <p class="text-[11px] text-(--postonsteroids-text-muted) mt-0.5">
                    Enter <code class="font-mono text-(--postonsteroids-text-secondary)">ONST-PRO/ENT-XXXX-...</code> or an organization license key, or sync an OTP-verified domain license.
                  </p>
                </div>

                <div class="flex items-center gap-1.5 flex-wrap">
                  @if (authService.isLoggedIn() && !authService.isTestUserSession()) {
                    <button
                      type="button"
                      (click)="onSyncDomainLicense()"
                      [disabled]="subscription.isLicenseBusy()"
                      class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-indigo-500/35 bg-indigo-500/12 hover:bg-indigo-500/20 text-[11px] font-semibold text-indigo-300 cursor-pointer transition-colors disabled:opacity-50"
                      title="Re-check whether your OTP-verified email domain matches an active organization license"
                    >
                      <mat-icon class="text-[13px]! size-[13px]!">domain_verification</mat-icon>
                      <span>Check Domain License</span>
                    </button>
                  }
                  @if (authService.currentUser(); as user) {
                    <button
                      type="button"
                      (click)="copyAccountEmail(user.email)"
                      class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) hover:bg-(--postonsteroids-bg-hover) text-[11px] text-(--postonsteroids-text-secondary) cursor-pointer transition-colors"
                      title="Copy signed-in account email for key provisioning"
                    >
                      <mat-icon class="text-[13px]! size-[13px]!">content_copy</mat-icon>
                      <span class="truncate max-w-[180px]">{{ user.email }}</span>
                    </button>
                  }
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-[1fr_210px_auto] gap-2.5 items-start">
                <div>
                  <label for="registration-code-input" class="block text-[10.5px] font-semibold text-(--postonsteroids-text-muted) uppercase tracking-wider mb-1">
                    Registration Key
                  </label>
                  <div class="relative flex items-center">
                    <input
                      id="registration-code-input"
                      type="text"
                      [value]="codeInput()"
                      (input)="onCodeInput($event)"
                      (keydown.enter)="onActivateSubmit()"
                      placeholder="ONST-ENT-XXXX-XXXX-XXXX-XXXX"
                      autocomplete="off"
                      spellcheck="false"
                      class="w-full h-9 px-3 pr-16 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) text-[12.5px] font-mono tracking-wider text-(--postonsteroids-text-primary) placeholder:text-(--postonsteroids-text-muted)/60 focus:outline-none focus:border-(--postonsteroids-accent)"
                    />
                    <div class="absolute right-1.5 flex items-center gap-1">
                      @if (codeInput()) {
                        <button
                          type="button"
                          (click)="clearCodeInput()"
                          title="Clear input"
                          class="p-1 rounded hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer flex items-center"
                        >
                          <mat-icon class="text-[14px]! size-[14px]!">backspace</mat-icon>
                        </button>
                      }
                      <button
                        type="button"
                        (click)="pasteFromClipboard()"
                        title="Paste registration code"
                        class="px-1.5 py-0.5 rounded bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) text-[10px] font-semibold text-(--postonsteroids-text-secondary) cursor-pointer"
                      >
                        Paste
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label for="device-label-input" class="block text-[10.5px] font-semibold text-(--postonsteroids-text-muted) uppercase tracking-wider mb-1">
                    Device Label (Optional)
                  </label>
                  <input
                    id="device-label-input"
                    type="text"
                    [value]="deviceLabelInput()"
                    (input)="onDeviceLabelInput($event)"
                    placeholder="e.g. Work Laptop"
                    maxlength="80"
                    class="w-full h-9 px-3 rounded-lg border border-(--postonsteroids-border) bg-(--postonsteroids-bg-secondary) text-[12px] text-(--postonsteroids-text-primary) placeholder:text-(--postonsteroids-text-muted)/60 focus:outline-none focus:border-(--postonsteroids-accent)"
                  />
                </div>

                <div class="md:pt-5">
                  <button
                    type="button"
                    (click)="onActivateSubmit()"
                    [disabled]="subscription.isLicenseBusy() || !codeInput().trim()"
                    class="w-full md:w-auto h-9 px-4 rounded-lg bg-(--postonsteroids-accent) hover:brightness-110 text-white text-[12px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-all disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <mat-icon class="text-[16px]! size-[16px]!">vpn_key</mat-icon>
                    <span>{{ subscription.isLicenseBusy() ? 'Activating...' : 'Activate Key' }}</span>
                  </button>
                </div>
              </div>

              <!-- Live Prefix/Format Hint -->
              @if (liveCodeHint(); as hint) {
                <div
                  class="text-[11px] flex items-center gap-1.5"
                  [class.text-emerald-400]="hint.valid"
                  [class.text-amber-300]="!hint.valid"
                >
                  <mat-icon class="text-[14px]! size-[14px]! shrink-0">{{ hint.valid ? 'check_circle' : 'info' }}</mat-icon>
                  <span>{{ hint.message }}</span>
                </div>
              }

              @if (subscription.licenseError(); as errMsg) {
                <div role="alert" class="rounded-lg border border-rose-500/35 bg-rose-500/12 px-3 py-2 text-[11.5px] text-rose-200 flex items-center gap-2">
                  <mat-icon class="text-[15px]! size-[15px]! text-rose-400 shrink-0">error_outline</mat-icon>
                  <span>{{ errMsg }}</span>
                </div>
              }

              @if (subscription.licenseSuccess(); as okMsg) {
                <div role="status" class="rounded-lg border border-emerald-500/35 bg-emerald-500/12 px-3 py-2 text-[11.5px] text-emerald-200 flex items-center gap-2">
                  <mat-icon class="text-[15px]! size-[15px]! text-emerald-400 shrink-0">check_circle</mat-icon>
                  <span>{{ okMsg }}</span>
                </div>
              }

              @if (!authService.isLoggedIn()) {
                <div class="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11.5px] text-amber-200 flex items-center justify-between gap-2">
                  <span>Sign in with an OTP-verified account to bind a key or work under your organization domain license.</span>
                  <button
                    type="button"
                    (click)="openSignInModal()"
                    class="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold text-[11px] cursor-pointer shrink-0"
                  >
                    Sign In
                  </button>
                </div>
              } @else if (authService.isTestUserSession()) {
                <div class="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div class="text-[11px] text-indigo-200">
                    <strong>Offline QA Preview Session:</strong> Preview Free, Pro (Personal), or Enterprise tiers below.
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
                    @for (plan of previewOptions; track plan.key) {
                      <button
                        type="button"
                        (click)="applyQaPreview(plan)"
                        class="px-2.5 py-1 rounded-md text-[10.5px] font-bold border cursor-pointer transition-colors"
                        [class.bg-(--postonsteroids-accent)]="isQaOptionSelected(plan)"
                        [class.text-white]="isQaOptionSelected(plan)"
                        [class.border-(--postonsteroids-accent)]="isQaOptionSelected(plan)"
                        [class.border-(--postonsteroids-border)]="!isQaOptionSelected(plan)"
                        [class.hover:bg-(--postonsteroids-bg-hover)]="!isQaOptionSelected(plan)"
                      >
                        {{ plan.short }}
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Edition Comparison Cards -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              @for (card of tierCards; track card.id) {
                <div
                  class="rounded-xl border p-3.5 flex flex-col justify-between gap-3 transition-colors"
                  [class.border-indigo-500/60]="subscription.tier() === card.id || subscription.requestedPlan() === card.id"
                  [class.bg-indigo-500/6]="subscription.tier() === card.id"
                  [class.border-(--postonsteroids-border)]="subscription.tier() !== card.id && subscription.requestedPlan() !== card.id"
                  [class.bg-(--postonsteroids-bg-primary)/35]="subscription.tier() !== card.id"
                >
                  <div class="space-y-2.5">
                    <div class="flex items-center justify-between gap-2">
                      <div>
                        <h4 class="text-[13px] font-bold">{{ card.name }}</h4>
                        <div class="text-[10.5px] text-(--postonsteroids-text-muted)">{{ card.tagline }}</div>
                      </div>
                      <span
                        class="px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wider border"
                        [class.bg-amber-500/15]="card.id === 'enterprise'"
                        [class.text-amber-400]="card.id === 'enterprise'"
                        [class.border-amber-500/35]="card.id === 'enterprise'"
                        [class.bg-indigo-500/15]="card.id === 'professional'"
                        [class.text-indigo-400]="card.id === 'professional'"
                        [class.border-indigo-500/35]="card.id === 'professional'"
                        [class.bg-(--postonsteroids-bg-tertiary)]="card.id === 'community'"
                        [class.text-(--postonsteroids-text-muted)]="card.id === 'community'"
                        [class.border-(--postonsteroids-border)]="card.id === 'community'"
                      >
                        {{ subscription.tier() === card.id ? 'Current' : card.badge }}
                      </span>
                    </div>

                    <ul class="space-y-1.5">
                      @for (item of card.highlights; track item) {
                        <li class="flex items-start gap-1.5 text-[11px] text-(--postonsteroids-text-secondary)">
                          <mat-icon class="text-[13px]! size-[13px]! text-emerald-400 shrink-0 mt-0.5">check</mat-icon>
                          <span>{{ item }}</span>
                        </li>
                      }
                    </ul>
                  </div>

                  <div class="pt-2 border-t border-(--postonsteroids-border)/50 text-[10.5px] text-(--postonsteroids-text-muted) flex items-center justify-between gap-2">
                    @if (subscription.tier() === card.id) {
                      <span class="font-semibold text-emerald-400">
                        {{ subscription.isPersonalLicense() ? 'Active (Personal Individual)' : 'Active on this session' }}
                      </span>
                    } @else if (card.id === 'community') {
                      <span>Included with every account</span>
                    } @else if (card.id === 'enterprise' && subscription.isPersonalLicense()) {
                      <span class="text-sky-300 font-semibold">Blocked on Personal Individual keys</span>
                    } @else if (card.id === 'professional') {
                      <span>Personal key (<code class="font-mono">ONST-PRO-...</code>)</span>
                      <a [href]="subscription.getHomepagePricingUrl('pro')"
                         target="_blank"
                         rel="noopener noreferrer"
                         class="text-indigo-400 hover:text-indigo-300 font-bold underline shrink-0">
                        Pricing ↗
                      </a>
                    } @else {
                      <span>Sign in with OTP-verified company email</span>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class LicenseUpgradeModalComponent {
  readonly subscription = inject(SubscriptionService);
  readonly authService = inject(AuthService);
  private readonly notificationService = inject(NotificationService);

  readonly tierCards = TIER_CARDS;
  readonly previewOptions: QaPreviewOption[] = [
    { key: 'community', tier: 'community', short: 'Free', licenseType: null, individualType: null },
    { key: 'professional', tier: 'professional', short: 'Pro', licenseType: 'individual', individualType: 'personal' },
    { key: 'enterprise', tier: 'enterprise', short: 'Ent', licenseType: 'enterprise', individualType: 'organization' },
  ];

  readonly entitlement = computed(() => this.subscription.entitlement());
  readonly codeInput = signal<string>('');
  readonly deviceLabelInput = signal<string>('');
  readonly confirmDeactivate = signal<boolean>(false);

  readonly liveCodeHint = computed<{ valid: boolean; message: string } | null>(() => {
    const raw = this.codeInput().trim();
    if (!raw) return null;

    const cleanUpper = raw.toUpperCase().replace(/\s+/g, '');
    if (cleanUpper.startsWith('ONST')) {
      const compact = cleanUpper.replace(/[^A-Z0-9]/g, '');
      if (compact.length < 23) {
        return {
          valid: false,
          message: `${compact.length}/23 characters entered`,
        };
      }
    }

    const res = validateLicenseActivationInput(raw);
    if (!res.valid) {
      return {
        valid: false,
        message: res.error || 'Invalid code format',
      };
    }

    if (res.tier === 'enterprise') {
      return {
        valid: true,
        message: 'Valid format — Enterprise registration key detected',
      };
    }
    if (res.tier === 'professional') {
      return {
        valid: true,
        message: 'Valid format — Professional registration key detected',
      };
    }
    return {
      valid: true,
      message: 'Custom organization license key format — will verify via server',
    };
  });

  onEscape(): void {
    if (this.subscription.showUpgradeModal()) {
      this.subscription.closeUpgradeModal();
    }
  }

  onCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const formatted = formatRegistrationCodeInput(input.value);
    this.codeInput.set(formatted);
    if (input.value !== formatted) {
      input.value = formatted;
    }
    this.subscription.licenseError.set(null);
    this.subscription.licenseSuccess.set(null);
  }

  onDeviceLabelInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.deviceLabelInput.set(input.value);
  }

  clearCodeInput(): void {
    this.codeInput.set('');
    this.subscription.licenseError.set(null);
    this.subscription.licenseSuccess.set(null);
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const formatted = formatRegistrationCodeInput(text);
        if (formatted) {
          this.codeInput.set(formatted);
          this.subscription.licenseError.set(null);
          return;
        }
      }
      this.notificationService.notify('Clipboard does not contain a readable code.', 'warning');
    } catch {
      this.notificationService.notify('Clipboard access unavailable — paste with Ctrl+V.', 'warning');
    }
  }

  async onActivateSubmit(): Promise<void> {
    const code = this.codeInput().trim();
    if (!code) return;

    const res = await this.subscription.activateRegistrationCode(code, this.deviceLabelInput());
    if (res.ok) {
      this.confirmDeactivate.set(false);
      this.codeInput.set('');
      this.notificationService.notify(res.message, 'success');
    } else if (res.message) {
      this.notificationService.notify(res.message, 'warning');
    }
  }

  async onSyncDomainLicense(): Promise<void> {
    const state = await this.subscription.refreshStatusFromBackend();
    if (state?.isActive && state.accessSource === 'domain') {
      this.notificationService.notify(`Active domain license confirmed (${state.licensedEmailPattern}).`, 'success');
    } else if (state?.isActive) {
      this.notificationService.notify(`License status refreshed (${this.subscription.label()}).`, 'success');
    } else {
      this.notificationService.notify('No active domain license found for your OTP-verified email domain.', 'warning');
    }
  }

  async onDeactivateConfirmed(): Promise<void> {
    const res = await this.subscription.deactivateLicense();
    this.confirmDeactivate.set(false);
    this.notificationService.notify(res.message, res.ok ? 'success' : 'warning');
  }

  isQaOptionSelected(plan: QaPreviewOption): boolean {
    const currentTier = this.subscription.tier();
    const isPersonal = this.subscription.isPersonalLicense();
    if (plan.key === 'enterprise') {
      return currentTier === 'enterprise' && !isPersonal;
    }
    return currentTier === plan.tier;
  }

  applyQaPreview(plan: QaPreviewOption): void {
    this.subscription.setTier(plan.tier, {
      licenseType: plan.licenseType,
      individualType: plan.individualType,
    });
    this.notificationService.notify(`QA preview switched to ${this.subscription.label()}.`, 'success');
  }

  openSignInModal(): void {
    this.subscription.closeUpgradeModal();
    this.authService.resetToEmailStep();
    this.authService.openAuthModal();
  }

  copyAccountEmail(email: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(email);
      this.notificationService.notify(`Copied ${email}`, 'success');
    }
  }

  formatDisplayDate(iso: string | null | undefined): string {
    if (!iso) return 'N/A';
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(ms);
  }
}
