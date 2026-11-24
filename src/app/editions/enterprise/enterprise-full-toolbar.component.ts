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
