import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VersionCheckService } from './shared/services/version-check.service';
import { LicenseUpgradeModalComponent } from './shared/components/license-upgrade.modal.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LicenseUpgradeModalComponent],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit {
  private readonly versionCheckService = inject(VersionCheckService);

  ngOnInit(): void {
    this.versionCheckService.init();
  }
}
