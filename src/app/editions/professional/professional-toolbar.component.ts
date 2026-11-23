import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { CollectionRunnerModalComponent } from './collection-runner.modal.component';
import { MockServerModalComponent } from './mock-server.modal.component';
import { VersionHistoryModalComponent } from './version-history.modal.component';

@Component({
  selector: 'app-professional-toolbar',
  imports: [
    MatIcon,
    CollectionRunnerModalComponent,
    MockServerModalComponent,
    VersionHistoryModalComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-1.5" style="-webkit-app-region: no-drag;">
      <!-- Collection Runner -->
      <button type="button" (click)="showRunnerModal.set(true)" title="Collection &amp; Data-Driven Runner"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) border border-(--postonsteroids-border) text-[11px] font-medium text-(--postonsteroids-text-secondary) hover:text-(--postonsteroids-text-primary) cursor-pointer transition-colors">
        <mat-icon class="text-[14px]! size-[14px]! text-indigo-500">play_circle</mat-icon>
        <span class="hidden xl:inline">Runner</span>
      </button>

      <!-- Mock Server -->
      <button type="button" (click)="openMockModal(mockModal)" title="Mock Server from Saved Examples"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) border border-(--postonsteroids-border) text-[11px] font-medium text-(--postonsteroids-text-secondary) hover:text-(--postonsteroids-text-primary) cursor-pointer transition-colors">
        <mat-icon class="text-[14px]! size-[14px]! text-purple-500">dns</mat-icon>
        <span class="hidden xl:inline">Mocks</span>
      </button>

      <!-- Request Version Snapshots -->
      <button type="button" (click)="showSnapshotModal.set(true)" title="Version History &amp; Snapshots"
              class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) border border-(--postonsteroids-border) text-[11px] font-medium text-(--postonsteroids-text-secondary) hover:text-(--postonsteroids-text-primary) cursor-pointer transition-colors">
        <mat-icon class="text-[14px]! size-[14px]! text-cyan-500">restore</mat-icon>
        <span class="hidden xl:inline">Snapshots</span>
      </button>
    </div>

    <app-collection-runner-modal [isOpen]="showRunnerModal()" (closed)="showRunnerModal.set(false)" />
    <app-mock-server-modal #mockModal [isOpen]="showMockModal()" (closed)="showMockModal.set(false)" />
    <app-version-history-modal [isOpen]="showSnapshotModal()" (closed)="showSnapshotModal.set(false)" />
  `
})
export class ProfessionalToolbarComponent {
  showRunnerModal = signal(false);
  showMockModal = signal(false);
  showSnapshotModal = signal(false);

  openMockModal(modal: MockServerModalComponent): void {
    this.showMockModal.set(true);
    void modal.refreshRoutes();
  }
}
