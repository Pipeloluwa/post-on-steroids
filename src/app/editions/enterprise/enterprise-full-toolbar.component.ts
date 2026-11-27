import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ProfessionalToolbarComponent } from '../professional/professional-toolbar.component';
import { EnterpriseGovernanceService } from './enterprise-governance.service';
import { EnterpriseSuiteModalComponent } from './enterprise-suite.modal.component';
import { SubscriptionService } from '../../shared/services/subscription.service';
import { TabStateService } from '../../shared/services/tab.state.service';

@Component({
  selector: 'app-enterprise-full-toolbar',
  imports: [MatIcon, ProfessionalToolbarComponent, EnterpriseSuiteModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-1.5 shrink-0">
      @if (subscription.isProOrHigher()) {
        <app-professional-toolbar />
      }

      @if (subscription.isEnterprise()) {
        <button type="button" (click)="showEnterpriseModal.set(true)"
                title="Enterprise Governance, Secret Vault, mTLS, RBAC &amp; Load Tester"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-[11px] font-bold text-amber-500 cursor-pointer transition-colors shrink-0">
          <mat-icon class="text-[14px]! size-[14px]!">admin_panel_settings</mat-icon>
          <span>Suite</span>
          @if (tabState.activeCapsuleLockMode() !== 'unlocked' || gov.isActiveCapsuleLocked()) {
            <mat-icon class="text-[12px]! size-[12px]!">lock</mat-icon>
          }
        </button>
      } @else if (!subscription.isOpenSourceCommunityBuild) {
        @if (!subscription.isProOrHigher()) {
          <button type="button" (click)="subscription.openHomepagePricing('pro')"
                  title="Upgrade to Pro on OnSteroid Pricing & Plans"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/40 text-[10.5px] font-bold text-indigo-300 cursor-pointer transition-colors shrink-0">
            <mat-icon class="text-[13px]! size-[13px]!">rocket_launch</mat-icon>
            <span>Upgrade Pro</span>
          </button>
        }
        <button type="button" (click)="subscription.openHomepagePricing('enterprise')"
                title="Explore Enterprise plans on OnSteroid Pricing"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-[10.5px] font-bold text-amber-300 cursor-pointer transition-colors shrink-0">
          <mat-icon class="text-[13px]! size-[13px]!">business</mat-icon>
          <span>Enterprise</span>
        </button>
        <button type="button" (click)="subscription.openUpgradeModal(subscription.isProOrHigher() ? 'enterprise' : 'professional')"
                [title]="subscription.isPersonalLicense()
                  ? 'Personal Pro license active — click for Enterprise info or key entry'
                  : 'Enter a Pro or Enterprise Registration Key'"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-(--postonsteroids-bg-tertiary) hover:bg-amber-500/15 border border-(--postonsteroids-border) hover:border-amber-500/40 text-[10.5px] font-semibold text-(--postonsteroids-text-muted) hover:text-amber-300 cursor-pointer transition-colors shrink-0">
          <mat-icon class="text-[13px]! size-[13px]! text-amber-400">{{ subscription.isPersonalLicense() ? 'lock' : 'vpn_key' }}</mat-icon>
          <span>{{ subscription.isPersonalLicense() ? 'Personal · Ent Locked' : 'Key' }}</span>
        </button>
      }
    </div>

    @if (subscription.isEnterprise()) {
      <app-enterprise-suite-modal [isOpen]="showEnterpriseModal()" (closed)="showEnterpriseModal.set(false)" />
    }
  `
})
export class EnterpriseFullToolbarComponent {
  gov = inject(EnterpriseGovernanceService);
  subscription = inject(SubscriptionService);
  tabState = inject(TabStateService);
  showEnterpriseModal = signal(false);
}
