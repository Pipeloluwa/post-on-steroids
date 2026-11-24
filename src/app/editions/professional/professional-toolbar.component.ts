import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { CollectionRunnerModalComponent } from './collection-runner.modal.component';
import { MockServerModalComponent } from './mock-server.modal.component';
import { VersionHistoryModalComponent } from './version-history.modal.component';
import { RunnerSchedulerService } from '../../shared/services/runner-scheduler.service';

@Component({
  selector: 'app-professional-toolbar',
  imports: [
    MatIcon,
    CollectionRunnerModalComponent,
    MockServerModalComponent,
    VersionHistoryModalComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'showToolsMenu.set(false)'
  },
  template: `
    <div class="flex items-center gap-1.5 shrink-0 relative">
      @if (scheduler.activeTotalCount() > 0) {
        <button type="button" (click)="openScheduledTasks($event)"
                title="View running and scheduled tasks inside Collection Runner"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/35 text-[11px] font-bold text-amber-300 cursor-pointer transition-colors shrink-0">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
          <span>{{ scheduler.activeTotalCount() }} Scheduled</span>
        </button>
      }

      <!-- Grouped Tools Dropdown (Collection Runner & Scheduler, Mock Server, Version Snapshots) -->
      <div class="relative">
        <button type="button" (click)="toggleToolsMenu($event)" title="Workspace Tools (Runner &amp; Scheduler, Mocks, Snapshots)"
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-(--postonsteroids-bg-tertiary) hover:bg-(--postonsteroids-bg-hover) border border-(--postonsteroids-border) text-[11px] font-semibold text-(--postonsteroids-text-secondary) hover:text-(--postonsteroids-text-primary) cursor-pointer transition-colors shrink-0">
          <mat-icon class="text-[14px]! size-[14px]! text-purple-400">workspaces</mat-icon>
          <span>Tools</span>
          <mat-icon class="text-[13px]! size-[13px]! opacity-70">expand_more</mat-icon>
        </button>

        @if (showToolsMenu()) {
          <div (click)="$event.stopPropagation()"
               class="absolute right-0 top-full mt-1.5 w-56 p-1.5 rounded-xl bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) shadow-2xl z-[105] text-[11.5px] flex flex-col gap-0.5">
            <button type="button" (click)="openRunner($event)"
                    class="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-primary) cursor-pointer text-left">
              <span class="flex items-center gap-2">
                <mat-icon class="text-[15px]! size-[15px]! text-indigo-500">play_circle</mat-icon>
                <span>Collection Runner</span>
              </span>
              @if (scheduler.activeTotalCount() > 0) {
                <span class="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-amber-500/20 text-amber-300">
                  {{ scheduler.activeTotalCount() }}
                </span>
              }
            </button>
            <button type="button" (click)="openMockModal(mockModal, $event)"
                    class="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-primary) cursor-pointer text-left">
              <mat-icon class="text-[15px]! size-[15px]! text-purple-500">dns</mat-icon>
              <span>Local Mock Server</span>
            </button>
            <button type="button" (click)="openSnapshots($event)"
                    class="flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-primary) cursor-pointer text-left">
              <mat-icon class="text-[15px]! size-[15px]! text-cyan-500">restore</mat-icon>
              <span>Version Snapshots</span>
            </button>
          </div>
        }
      </div>
    </div>

    <app-collection-runner-modal [isOpen]="showRunnerModal()" [initialTab]="runnerInitialTab()" (closed)="showRunnerModal.set(false)" />
    <app-mock-server-modal #mockModal [isOpen]="showMockModal()" (closed)="showMockModal.set(false)" />
    <app-version-history-modal [isOpen]="showSnapshotModal()" (closed)="showSnapshotModal.set(false)" />
  `
})
export class ProfessionalToolbarComponent {
  scheduler = inject(RunnerSchedulerService);

  showToolsMenu = signal(false);
  showRunnerModal = signal(false);
  runnerInitialTab = signal<'runner' | 'scheduled'>('runner');
  showMockModal = signal(false);
  showSnapshotModal = signal(false);

  toggleToolsMenu(event: Event): void {
    event.stopPropagation();
    this.showToolsMenu.update(v => !v);
  }

  openRunner(event?: Event): void {
    event?.stopPropagation();
    this.showToolsMenu.set(false);
    this.runnerInitialTab.set('runner');
    this.showRunnerModal.set(true);
  }

  openScheduledTasks(event?: Event): void {
    event?.stopPropagation();
    this.showToolsMenu.set(false);
    this.runnerInitialTab.set('scheduled');
    this.showRunnerModal.set(true);
  }

  openMockModal(modal: MockServerModalComponent, event?: Event): void {
    event?.stopPropagation();
    this.showToolsMenu.set(false);
    this.showMockModal.set(true);
    void modal.refreshRoutes();
  }

  openSnapshots(event?: Event): void {
    event?.stopPropagation();
    this.showToolsMenu.set(false);
    this.showSnapshotModal.set(true);
  }
}
