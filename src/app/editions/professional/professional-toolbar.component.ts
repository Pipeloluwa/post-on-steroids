import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { EnvironmentService } from './environment.service';
import { EnvironmentManagerModalComponent } from './environment-manager.modal.component';
import { CollectionRunnerModalComponent } from './collection-runner.modal.component';
import { MockServerModalComponent } from './mock-server.modal.component';
import { VersionHistoryModalComponent } from './version-history.modal.component';

@Component({
  selector: 'app-professional-toolbar',
  imports: [
    FormsModule,
    MatIcon,
    EnvironmentManagerModalComponent,
    CollectionRunnerModalComponent,
    MockServerModalComponent,
    VersionHistoryModalComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-1.5" style="-webkit-app-region: no-drag;">
      <!-- Environment Switcher Dropdown -->
      <div class="flex items-center rounded-full bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) px-2 py-0.5 gap-1">
        <span class="size-2 rounded-full shrink-0"
              [style.background-color]="envService.activeEnvironment()?.color || '#94a3b8'"></span>
        <select aria-label="Active Environment"
                [ngModel]="envService.activeEnvironmentId() || ''"
                (ngModelChange)="envService.setActiveEnvironment($event || null)"
                class="bg-transparent text-[11px] font-semibold text-(--postonsteroids-text-primary) outline-none cursor-pointer max-w-[100px] truncate">
          <option value="" class="bg-(--postonsteroids-bg-secondary)">No Env</option>
          @for (env of envService.environments(); track env.id) {
            <option [value]="env.id" class="bg-(--postonsteroids-bg-secondary)">{{ env.name }}</option>
          }
        </select>
        <button type="button" (click)="showEnvModal.set(true)" title="Manage Environments"
                class="p-0.5 rounded hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-accent) cursor-pointer flex items-center">
          <mat-icon class="text-[14px]! size-[14px]!">tune</mat-icon>
        </button>
      </div>

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

    <app-environment-manager-modal [isOpen]="showEnvModal()" (closed)="showEnvModal.set(false)" />
    <app-collection-runner-modal [isOpen]="showRunnerModal()" (closed)="showRunnerModal.set(false)" />
    <app-mock-server-modal #mockModal [isOpen]="showMockModal()" (closed)="showMockModal.set(false)" />
    <app-version-history-modal [isOpen]="showSnapshotModal()" (closed)="showSnapshotModal.set(false)" />
  `
})
export class ProfessionalToolbarComponent {
  envService = inject(EnvironmentService);

  showEnvModal = signal(false);
  showRunnerModal = signal(false);
  showMockModal = signal(false);
  showSnapshotModal = signal(false);

  openMockModal(modal: MockServerModalComponent): void {
    this.showMockModal.set(true);
    void modal.refreshRoutes();
  }
}
