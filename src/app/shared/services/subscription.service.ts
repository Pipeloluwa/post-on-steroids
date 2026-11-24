import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { APP_EDITION } from '../../../environments/edition';
import { EditionTier } from '../../../environments/edition.types';

export const SUBSCRIPTION_TIER_STORAGE_KEY = 'onsteroids_user_subscription_tier';

const TIER_RANK: Record<EditionTier, number> = {
  community: 0,
  professional: 1,
  enterprise: 2
};

@Injectable({
  providedIn: 'root'
})
export class SubscriptionService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  /**
   * True when this build physically excluded Pro/Enterprise features (open-source Community build).
   * In the Unified Commercial build (`subscriptionGated: true`), subscription tiers switch dynamically at runtime.
   */
  readonly isOpenSourceCommunityBuild = APP_EDITION.id === 'community' && !APP_EDITION.subscriptionGated;

  private readonly _tier = signal<EditionTier>(this.loadInitialTier());

  readonly tier = computed<EditionTier>(() => {
    if (this.isOpenSourceCommunityBuild) return 'community';
    return this._tier();
  });

  readonly label = computed<string>(() => {
    switch (this.tier()) {
      case 'enterprise': return 'Enterprise';
      case 'professional': return 'Professional';
      default: return 'Community';
    }
  });

  readonly badgeLabel = computed<string>(() => {
    switch (this.tier()) {
      case 'enterprise': return 'Enterprise';
      case 'professional': return 'Pro';
      default: return this.isOpenSourceCommunityBuild ? 'Community' : 'Free';
    }
  });

  readonly isProOrHigher = computed<boolean>(() => {
    if (this.isOpenSourceCommunityBuild) return false;
    return TIER_RANK[this.tier()] >= TIER_RANK['professional'];
  });

  readonly isEnterprise = computed<boolean>(() => {
    if (this.isOpenSourceCommunityBuild) return false;
    return TIER_RANK[this.tier()] >= TIER_RANK['enterprise'];
  });

  private loadInitialTier(): EditionTier {
    if (this.isOpenSourceCommunityBuild) return 'community';
    if (this.isBrowser) {
      try {
        const stored = (localStorage.getItem(SUBSCRIPTION_TIER_STORAGE_KEY) || '').trim().toLowerCase();
        if (stored === 'community' || stored === 'professional' || stored === 'enterprise') {
          return stored;
        }
      } catch { }
    }
    return APP_EDITION.id;
  }

  hasTier(required: EditionTier): boolean {
    return TIER_RANK[this.tier()] >= TIER_RANK[required];
  }

  syncFromUserSubscription(rawPlan?: string | null): void {
    if (this.isOpenSourceCommunityBuild || !rawPlan) return;
    const normalized = String(rawPlan).trim().toLowerCase();
    if (normalized === 'community' || normalized === 'free') {
      this.setTier('community');
    } else if (normalized === 'professional' || normalized === 'pro') {
      this.setTier('professional');
    } else if (normalized === 'enterprise' || normalized === 'ent') {
      this.setTier('enterprise');
    }
  }

  setTier(nextTier: EditionTier): void {
    if (this.isOpenSourceCommunityBuild) return;
    this._tier.set(nextTier);
    if (this.isBrowser) {
      try {
        localStorage.setItem(SUBSCRIPTION_TIER_STORAGE_KEY, nextTier);
      } catch { }
    }
  }
}
