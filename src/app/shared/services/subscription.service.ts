import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { APP_EDITION } from '../../../environments/edition';
import { EditionTier } from '../../../environments/edition.types';
import { DESKTOP_DOWNLOADS_CONFIG } from '../constants/desktop-downloads.constants';
import { API_BASE_URL, AUTH_TOKEN_KEY, AUTH_USER_KEY } from '../constants/api.constants';
import {
  LICENSE_ALPHABET,
  LicenseCodeValidationResult,
  enforceNonEnterpriseForIndividual,
  formatRegistrationCodeInput,
  isPersonalIndividualLicense,
  normalizeIndividualType,
  normalizeLicenseType,
  normalizeSubscriptionTier,
  validateLicenseActivationInput,
  validateRegistrationCodeFormat,
  validateRegistrationCodeWithChecksum,
} from '../utils/license-code.util';

export const SUBSCRIPTION_TIER_STORAGE_KEY = 'onsteroid_subscription_tier';
export {
  LICENSE_ALPHABET,
  enforceNonEnterpriseForIndividual,
  formatRegistrationCodeInput,
  isPersonalIndividualLicense,
  normalizeIndividualType,
  normalizeLicenseType,
  normalizeSubscriptionTier,
  validateLicenseActivationInput,
  validateRegistrationCodeFormat,
  validateRegistrationCodeWithChecksum,
};
export type { LicenseCodeValidationResult };

const TIER_RANK: Record<EditionTier, number> = {
  community: 0,
  professional: 1,
  enterprise: 2,
};

export interface LicenseEntitlementState {
  tier: EditionTier;
  status: 'free' | 'active' | 'expired' | 'revoked' | 'preview';
  licenseType: string | null;
  individualType: string | null;
  isPersonalLicense: boolean;
  isEmailOtpVerified: boolean;
  accessSource: 'domain' | 'key' | 'preview' | 'free';
  licensedEmailPattern: string | null;
  billingCycle: string | null;
  maskedCode: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  activeActivations: number | null;
  maxActivations: number | null;
  isActive: boolean;
  isExpired: boolean;
}

export interface LicenseStatusApiResponse {
  title?: string;
  responseCode?: string;
  message?: string;
  data?: {
    subscriptionTier?: string;
    status?: string;
    licenseType?: string | null;
    individualType?: string | null;
    isPersonalLicense?: boolean;
    isEmailOtpVerified?: boolean;
    accessSource?: string | null;
    licensedEmailPattern?: string | null;
    billingCycle?: string | null;
    maskedCode?: string | null;
    activatedAt?: string | null;
    expiresAt?: string | null;
    activeActivations?: number | null;
    maxActivations?: number | null;
    isActive?: boolean;
    isExpired?: boolean;
  };
  errors?: string[];
}

const DEFAULT_ENTITLEMENT: LicenseEntitlementState = {
  tier: 'community',
  status: 'free',
  licenseType: null,
  individualType: null,
  isPersonalLicense: false,
  isEmailOtpVerified: false,
  accessSource: 'free',
  licensedEmailPattern: null,
  billingCycle: null,
  maskedCode: null,
  activatedAt: null,
  expiresAt: null,
  activeActivations: null,
  maxActivations: null,
  isActive: false,
  isExpired: false,
};

@Injectable({
  providedIn: 'root',
})
export class SubscriptionService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly isOpenSourceCommunityBuild = APP_EDITION.id === 'community';

  private readonly _entitlement = signal<LicenseEntitlementState>(this.loadInitialEntitlement());

  readonly showUpgradeModal = signal<boolean>(false);
  readonly requestedPlan = signal<'professional' | 'enterprise' | null>(null);
  readonly pricingPlansUrl = DESKTOP_DOWNLOADS_CONFIG.homepagePricingUrl;
  readonly isLicenseBusy = signal<boolean>(false);
  readonly licenseError = signal<string | null>(null);
  readonly licenseSuccess = signal<string | null>(null);

  readonly isPersonalLicense = computed<boolean>(() => {
    if (this.isOpenSourceCommunityBuild) return false;
    const ent = this._entitlement();
    const effectiveTier = enforceNonEnterpriseForIndividual({
      tier: ent.tier,
      licenseType: ent.licenseType,
      individualType: ent.individualType,
    });
    if (effectiveTier === 'community') return false;
    return (
      ent.isPersonalLicense ||
      isPersonalIndividualLicense({
        tier: effectiveTier,
        licenseType: ent.licenseType,
        individualType: ent.individualType,
      })
    );
  });

  readonly tier = computed<EditionTier>(() => {
    if (this.isOpenSourceCommunityBuild) {
      return 'community';
    }
    const ent = this._entitlement();
    return enforceNonEnterpriseForIndividual({
      tier: ent.tier,
      licenseType: ent.licenseType,
      individualType: ent.individualType,
    });
  });

  readonly entitlement = computed<LicenseEntitlementState>(() => {
    if (this.isOpenSourceCommunityBuild) {
      return DEFAULT_ENTITLEMENT;
    }
    const ent = this._entitlement();
    const cleanTier = this.tier();
    const isPersonal = this.isPersonalLicense();
    return {
      ...ent,
      tier: cleanTier,
      isPersonalLicense: isPersonal,
      isActive: ent.isActive && cleanTier !== 'community',
    };
  });

  readonly isProOrHigher = computed<boolean>(() => {
    if (this.isOpenSourceCommunityBuild) return false;
    return TIER_RANK[this.tier()] >= TIER_RANK.professional;
  });

  readonly isEnterprise = computed<boolean>(() => {
    if (this.isOpenSourceCommunityBuild) return false;
    // Strict client-side guard: a personal/individual license can NEVER bypass into Enterprise
    if (this.isPersonalLicense()) return false;
    return TIER_RANK[this.tier()] >= TIER_RANK.enterprise;
  });

  readonly label = computed<string>(() => {
    switch (this.tier()) {
      case 'enterprise':
        return 'Enterprise';
      case 'professional':
        return 'Pro (Personal)';
      default:
        return 'Community';
    }
  });

  readonly badgeLabel = computed<string>(() => {
    switch (this.tier()) {
      case 'enterprise':
        return 'ENT';
      case 'professional':
        return 'PRO';
      default:
        return 'Free';
    }
  });

  hasTier(required: EditionTier): boolean {
    if (this.isOpenSourceCommunityBuild) {
      return required === 'community';
    }
    if (required === 'enterprise' && this.isPersonalLicense()) {
      return false;
    }
    return TIER_RANK[this.tier()] >= TIER_RANK[required];
  }

  getHomepagePricingUrl(plan?: 'pro' | 'enterprise'): string {
    return plan ? `${this.pricingPlansUrl}?plan=${plan}` : this.pricingPlansUrl;
  }

  openHomepagePricing(plan?: 'pro' | 'enterprise'): void {
    if (!this.isBrowser) return;
    try {
      window.open(this.getHomepagePricingUrl(plan), '_blank', 'noopener,noreferrer');
    } catch { }
  }

  openUpgradeModal(plan: 'professional' | 'enterprise' | null = null): void {
    this.requestedPlan.set(plan);
    this.licenseError.set(null);
    this.licenseSuccess.set(null);
    this.showUpgradeModal.set(true);
    void this.refreshStatusFromBackend();
  }

  closeUpgradeModal(): void {
    this.showUpgradeModal.set(false);
    this.licenseError.set(null);
    this.licenseSuccess.set(null);
  }

  getStoredQaPreviewSelection(): { tier: EditionTier; licenseType: string | null; individualType: string | null } | null {
    if (!this.isBrowser || this.isOpenSourceCommunityBuild) return null;
    try {
      const stored = (localStorage.getItem(SUBSCRIPTION_TIER_STORAGE_KEY) || '').trim().toLowerCase();
      if (!stored) return null;
      if (stored === 'professional:personal' || stored === 'professional') {
        return { tier: 'professional', licenseType: 'individual', individualType: 'personal' };
      }
      if (stored === 'community' || stored === 'enterprise') {
        return {
          tier: stored,
          licenseType: stored === 'enterprise' ? 'enterprise' : null,
          individualType: stored === 'enterprise' ? 'organization' : null,
        };
      }
    } catch { }
    return null;
  }

  getStoredQaPreviewTier(): EditionTier | null {
    return this.getStoredQaPreviewSelection()?.tier ?? null;
  }

  syncFromUserSubscription(
    userTier?: string | null,
    options?: {
      isTestUser?: boolean;
      expiresAt?: string | null;
      maskedCode?: string | null;
      licenseType?: string | null;
      individualType?: string | null;
      isPersonalLicense?: boolean;
      isEmailOtpVerified?: boolean;
      accessSource?: string | null;
      licensedEmailPattern?: string | null;
    }
  ): void {
    if (this.isOpenSourceCommunityBuild) {
      this._entitlement.set(DEFAULT_ENTITLEMENT);
      return;
    }

    const expiresAt = options?.expiresAt ?? null;
    const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
    const isExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
    let licenseType = normalizeLicenseType(options?.licenseType);
    let individualType = normalizeIndividualType(options?.individualType);
    const rawIsPersonal =
      !!options?.isPersonalLicense ||
      isPersonalIndividualLicense({ tier: userTier, licenseType, individualType });

    const effectiveTier: EditionTier = isExpired
      ? 'community'
      : enforceNonEnterpriseForIndividual({
          tier: userTier,
          licenseType,
          individualType: rawIsPersonal ? individualType || 'personal' : individualType,
        });

    const isPersonal = effectiveTier !== 'community' && rawIsPersonal;
    if (effectiveTier === 'professional' && isPersonal) {
      licenseType ??= 'individual';
      individualType ??= 'personal';
    }

    const rawSource = (options?.accessSource || '').trim().toLowerCase();
    const accessSource: LicenseEntitlementState['accessSource'] = options?.isTestUser
      ? effectiveTier === 'community'
        ? 'free'
        : 'preview'
      : rawSource === 'domain' || rawSource === 'key'
        ? rawSource
        : effectiveTier === 'community'
          ? 'free'
          : 'key';

    this._entitlement.set({
      tier: effectiveTier,
      status: options?.isTestUser
        ? effectiveTier === 'community'
          ? 'free'
          : 'preview'
        : isExpired
          ? 'expired'
          : effectiveTier === 'community'
            ? 'free'
            : 'active',
      licenseType,
      individualType: isPersonal ? individualType || 'personal' : individualType,
      isPersonalLicense: isPersonal,
      isEmailOtpVerified: !!options?.isEmailOtpVerified,
      accessSource,
      licensedEmailPattern: options?.licensedEmailPattern ?? null,
      billingCycle: options?.isTestUser ? 'preview' : null,
      maskedCode: options?.maskedCode ?? null,
      activatedAt: null,
      expiresAt,
      activeActivations: null,
      maxActivations: null,
      isActive: effectiveTier !== 'community',
      isExpired,
    });

    if (this.isBrowser && !options?.isTestUser) {
      try {
        localStorage.removeItem(SUBSCRIPTION_TIER_STORAGE_KEY);
      } catch { }
    }
  }

  /**
   * Used only for QA preview switching inside the built-in test user session.
   */
  setTier(
    nextTier: EditionTier,
    options?: { persistPreview?: boolean; licenseType?: string | null; individualType?: string | null }
  ): void {
    if (this.isOpenSourceCommunityBuild) return;

    const rawLicenseType = normalizeLicenseType(options?.licenseType);
    const rawIndividualType = normalizeIndividualType(options?.individualType);
    const provisionalPersonal =
      nextTier === 'professional'
        ? rawIndividualType !== 'organization'
        : isPersonalIndividualLicense({ tier: nextTier, licenseType: rawLicenseType, individualType: rawIndividualType });
    const cleanTier = enforceNonEnterpriseForIndividual({
      tier: nextTier,
      licenseType: rawLicenseType,
      individualType: provisionalPersonal ? rawIndividualType || 'personal' : rawIndividualType,
    });
    const isPersonal = cleanTier !== 'community' && provisionalPersonal;
    const licenseType = cleanTier === 'professional' && isPersonal ? rawLicenseType || 'individual' : rawLicenseType;
    const individualType = isPersonal ? rawIndividualType || 'personal' : rawIndividualType;

    this._entitlement.set({
      ...DEFAULT_ENTITLEMENT,
      tier: cleanTier,
      status: cleanTier === 'community' ? 'free' : 'preview',
      licenseType,
      individualType,
      isPersonalLicense: isPersonal,
      isEmailOtpVerified: true,
      accessSource: cleanTier === 'community' ? 'free' : 'preview',
      billingCycle: cleanTier === 'community' ? null : 'preview',
      isActive: cleanTier !== 'community',
    });

    if (this.isBrowser && options?.persistPreview !== false) {
      try {
        localStorage.setItem(SUBSCRIPTION_TIER_STORAGE_KEY, cleanTier);
      } catch { }
    }
  }

  resetToFreeOnLogout(): void {
    this._entitlement.set(DEFAULT_ENTITLEMENT);
    this.showUpgradeModal.set(false);
    this.licenseError.set(null);
    this.licenseSuccess.set(null);
    if (this.isBrowser) {
      try {
        localStorage.removeItem(SUBSCRIPTION_TIER_STORAGE_KEY);
      } catch { }
    }
  }

  async refreshStatusFromBackend(): Promise<LicenseEntitlementState | null> {
    if (this.isOpenSourceCommunityBuild || !this.isBrowser) {
      return null;
    }

    const token = localStorage.getItem(AUTH_TOKEN_KEY) || '';
    if (!token || token.startsWith('onsteroid-test-token-')) {
      return null;
    }

    try {
      const res = await firstValueFrom(
        this.http.get<LicenseStatusApiResponse>(`${API_BASE_URL}/license/status`)
      );
      if (res?.data) {
        return this.applyBackendEntitlement(res.data);
      }
    } catch {
      // Keep cached session entitlement when offline
    }
    return null;
  }

  async activateRegistrationCode(
    rawCode: string,
    deviceLabel?: string
  ): Promise<{ ok: boolean; message: string; state?: LicenseEntitlementState }> {
    this.licenseError.set(null);
    this.licenseSuccess.set(null);

    if (this.isOpenSourceCommunityBuild) {
      const msg = 'Registration codes apply only to OnSteroid commercial builds.';
      this.licenseError.set(msg);
      return { ok: false, message: msg };
    }

    if (!this.isBrowser) {
      return { ok: false, message: 'Activation requires a browser or desktop session.' };
    }

    const token = localStorage.getItem(AUTH_TOKEN_KEY) || '';
    if (!token) {
      const msg = 'Please sign in with your OnSteroid account before activating a registration code.';
      this.licenseError.set(msg);
      return { ok: false, message: msg };
    }

    if (token.startsWith('onsteroid-test-token-')) {
      const msg = 'You are signed into the offline QA Test account. Sign in with a real OTP-verified account to redeem a server registration key, or use the QA Preview Switcher below.';
      this.licenseError.set(msg);
      return { ok: false, message: msg };
    }

    const validation = await validateRegistrationCodeWithChecksum(rawCode);
    if (!validation.valid) {
      const msg = validation.error || 'Invalid registration code.';
      this.licenseError.set(msg);
      return { ok: false, message: msg };
    }

    this.isLicenseBusy.set(true);
    try {
      const inferredDevice = (deviceLabel || '').trim() || this.detectDeviceLabel();
      const res = await firstValueFrom(
        this.http.post<LicenseStatusApiResponse>(`${API_BASE_URL}/license/activate`, {
          code: validation.normalizedCode,
          deviceLabel: inferredDevice,
        })
      );

      if (res?.data) {
        const state = this.applyBackendEntitlement(res.data);
        const msg = res.message || `Activated ${this.label()} plan!`;
        this.licenseSuccess.set(msg);
        return { ok: true, message: msg, state };
      }

      const fallbackMsg = res?.message || 'Unable to verify registration code.';
      this.licenseError.set(fallbackMsg);
      return { ok: false, message: fallbackMsg };
    } catch (err) {
      const msg = this.extractApiErrorMessage(err, 'Failed to activate registration code.');
      this.licenseError.set(msg);
      return { ok: false, message: msg };
    } finally {
      this.isLicenseBusy.set(false);
    }
  }

  async deactivateLicense(): Promise<{ ok: boolean; message: string }> {
    this.licenseError.set(null);
    this.licenseSuccess.set(null);

    if (!this.isBrowser) {
      return { ok: false, message: 'Deactivation requires a desktop or browser session.' };
    }

    const token = localStorage.getItem(AUTH_TOKEN_KEY) || '';
    if (!token || token.startsWith('onsteroid-test-token-')) {
      this.setTier('community');
      return { ok: true, message: 'Reverted QA preview to Community (Free).' };
    }

    this.isLicenseBusy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<LicenseStatusApiResponse>(`${API_BASE_URL}/license/deactivate`, {})
      );
      if (res?.data) {
        this.applyBackendEntitlement(res.data);
      } else {
        this.resetToFreeOnLogout();
      }
      const msg = res?.message || 'License deactivated cleanly.';
      this.licenseSuccess.set(msg);
      return { ok: true, message: msg };
    } catch (err) {
      const msg = this.extractApiErrorMessage(err, 'Failed to deactivate license seat.');
      this.licenseError.set(msg);
      return { ok: false, message: msg };
    } finally {
      this.isLicenseBusy.set(false);
    }
  }

  private applyBackendEntitlement(data: NonNullable<LicenseStatusApiResponse['data']>): LicenseEntitlementState {
    let licenseType = normalizeLicenseType(data.licenseType);
    let individualType = normalizeIndividualType(data.individualType);
    const rawTier = normalizeSubscriptionTier(data.subscriptionTier);
    const rawIsPersonal =
      !!data.isPersonalLicense || isPersonalIndividualLicense({ tier: rawTier, licenseType, individualType });
    const safeTier = enforceNonEnterpriseForIndividual({
      tier: rawTier,
      licenseType,
      individualType: rawIsPersonal ? individualType || 'personal' : individualType,
    });
    const isPersonal = safeTier !== 'community' && rawIsPersonal;
    if (safeTier === 'professional' && isPersonal) {
      licenseType ??= 'individual';
      individualType ??= 'personal';
    }

    if (rawIsPersonal && rawTier === 'enterprise') {
      this.licenseError.set('Personal individual licenses are blocked from bypassing into Enterprise tier.');
    }

    const rawStatus = (data.status || '').trim().toLowerCase();
    const status: LicenseEntitlementState['status'] =
      rawStatus === 'active' || rawStatus === 'expired' || rawStatus === 'revoked'
        ? rawStatus
        : safeTier === 'community'
          ? 'free'
          : 'active';

    const rawSource = (data.accessSource || '').trim().toLowerCase();
    const accessSource: LicenseEntitlementState['accessSource'] =
      rawSource === 'domain' || rawSource === 'key'
        ? rawSource
        : safeTier === 'community'
          ? 'free'
          : 'key';

    const next: LicenseEntitlementState = {
      tier: safeTier,
      status,
      licenseType,
      individualType: isPersonal ? individualType || 'personal' : individualType,
      isPersonalLicense: isPersonal,
      isEmailOtpVerified: !!data.isEmailOtpVerified,
      accessSource,
      licensedEmailPattern: data.licensedEmailPattern ?? null,
      billingCycle: data.billingCycle ?? null,
      maskedCode: data.maskedCode ?? null,
      activatedAt: data.activatedAt ?? null,
      expiresAt: data.expiresAt ?? null,
      activeActivations: data.activeActivations ?? null,
      maxActivations: data.maxActivations ?? null,
      isActive: !!data.isActive && safeTier !== 'community',
      isExpired: !!data.isExpired,
    };

    this._entitlement.set(next);
    this.syncCachedUserSnapshot(next);
    return next;
  }

  private syncCachedUserSnapshot(state: LicenseEntitlementState): void {
    if (!this.isBrowser) return;
    try {
      const rawUser = localStorage.getItem(AUTH_USER_KEY);
      if (!rawUser) return;
      const parsed = JSON.parse(rawUser) as Record<string, unknown>;
      parsed['subscriptionTier'] = state.tier;
      parsed['subscriptionExpiresAt'] = state.expiresAt;
      parsed['maskedLicenseCode'] = state.maskedCode;
      parsed['licenseType'] = state.licenseType;
      parsed['individualType'] = state.individualType;
      parsed['isPersonalLicense'] = state.isPersonalLicense;
      parsed['isEmailOtpVerified'] = state.isEmailOtpVerified;
      parsed['licenseAccessSource'] = state.accessSource;
      parsed['licensedEmailPattern'] = state.licensedEmailPattern;
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(parsed));
    } catch { }
  }

  private extractApiErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { message?: string; errors?: string[] } | string | null;
      if (typeof body === 'string' && body.trim()) return body.trim();
      if (body && typeof body === 'object') {
        if (Array.isArray(body.errors) && body.errors.length > 0 && body.errors[0]) {
          return body.errors[0];
        }
        if (typeof body.message === 'string' && body.message.trim()) {
          return body.message.trim();
        }
      }
    }
    if (err instanceof Error && err.message) return err.message;
    return fallback;
  }

  private detectDeviceLabel(): string {
    if (!this.isBrowser) return 'OnSteroid Client';
    try {
      const nav = window.navigator;
      const isElectron = /Electron/i.test(nav.userAgent || '');
      const platform = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || nav.platform || 'Desktop';
      return `${isElectron ? 'OnSteroid Desktop' : 'OnSteroid Web'} (${platform})`.slice(0, 140);
    } catch {
      return 'OnSteroid Client';
    }
  }

  private loadInitialEntitlement(): LicenseEntitlementState {
    if (this.isOpenSourceCommunityBuild) return DEFAULT_ENTITLEMENT;
    if (this.isBrowser) {
      try {
        const token = localStorage.getItem(AUTH_TOKEN_KEY) || '';
        const storedUserRaw = localStorage.getItem(AUTH_USER_KEY);
        if (token.startsWith('onsteroid-test-token-')) {
          const preview = this.getStoredQaPreviewSelection();
          if (preview) {
            const isPersonal = preview.tier !== 'community' && isPersonalIndividualLicense({
              tier: preview.tier,
              licenseType: preview.licenseType,
              individualType: preview.individualType,
            });
            return {
              ...DEFAULT_ENTITLEMENT,
              tier: preview.tier,
              status: preview.tier === 'community' ? 'free' : 'preview',
              licenseType: preview.licenseType,
              individualType: preview.individualType,
              isPersonalLicense: isPersonal,
              isEmailOtpVerified: true,
              accessSource: preview.tier === 'community' ? 'free' : 'preview',
              isActive: preview.tier !== 'community',
            };
          }
        } else if (token && storedUserRaw) {
          const parsed = JSON.parse(storedUserRaw) as {
            subscriptionTier?: string | null;
            subscriptionExpiresAt?: string | null;
            maskedLicenseCode?: string | null;
            licenseType?: string | null;
            individualType?: string | null;
            isPersonalLicense?: boolean;
            isEmailOtpVerified?: boolean;
            licenseAccessSource?: string | null;
            licensedEmailPattern?: string | null;
          };
          let licenseType = normalizeLicenseType(parsed?.licenseType);
          let individualType = normalizeIndividualType(parsed?.individualType);
          const rawIsPersonal =
            !!parsed?.isPersonalLicense ||
            isPersonalIndividualLicense({ tier: parsed?.subscriptionTier, licenseType, individualType });
          const expiresAt = parsed?.subscriptionExpiresAt ?? null;
          const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
          const isExpired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
          const safeTier: EditionTier = isExpired
            ? 'community'
            : enforceNonEnterpriseForIndividual({
                tier: parsed?.subscriptionTier,
                licenseType,
                individualType: rawIsPersonal ? individualType || 'personal' : individualType,
              });
          const isPersonal = safeTier !== 'community' && rawIsPersonal;
          if (safeTier === 'professional' && isPersonal) {
            licenseType ??= 'individual';
            individualType ??= 'personal';
          }
          const rawSource = (parsed?.licenseAccessSource || '').trim().toLowerCase();
          return {
            ...DEFAULT_ENTITLEMENT,
            tier: safeTier,
            status: isExpired ? 'expired' : safeTier === 'community' ? 'free' : 'active',
            licenseType,
            individualType: isPersonal ? individualType || 'personal' : individualType,
            isPersonalLicense: isPersonal,
            isEmailOtpVerified: !!parsed?.isEmailOtpVerified,
            accessSource: rawSource === 'domain' ? 'domain' : safeTier === 'community' ? 'free' : 'key',
            licensedEmailPattern: parsed?.licensedEmailPattern ?? null,
            maskedCode: parsed?.maskedLicenseCode ?? null,
            expiresAt,
            isActive: safeTier !== 'community',
            isExpired,
          };
        }
      } catch { }
    }
    return DEFAULT_ENTITLEMENT;
  }
}
