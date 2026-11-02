import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VersionCheckService } from './shared/services/version-check.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class App implements OnInit {
  private readonly versionCheckService = inject(VersionCheckService);

  ngOnInit(): void {
    this.versionCheckService.init();
  }
}
