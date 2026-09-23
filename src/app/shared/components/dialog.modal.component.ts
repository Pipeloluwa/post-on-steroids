import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../services/dialog.service';

@Component({
  standalone: true,
  selector: 'app-dialog-modal',
  imports: [CommonModule, FormsModule],
  template: `
    @if (dialogService.show()) {
      <div style="-webkit-app-region: no-drag;" class="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" (click)="onBackdropClick($event)">
          <div class="w-full max-w-sm rounded-xl bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) shadow-2xl flex flex-col overflow-hidden" (click)="$event.stopPropagation()">
              <div class="px-5 py-4 border-b border-(--postonsteroids-border)">
                  <h2 class="text-sm font-semibold text-(--postonsteroids-text-primary)">
                      {{ dialogService.options()?.title }}
                  </h2>
              </div>
              <div class="p-5 flex flex-col gap-4">
                  <p class="text-xs text-(--postonsteroids-text-secondary) leading-relaxed">
                      {{ dialogService.options()?.message }}
                  </p>
                  @if (dialogService.options()?.type === 'prompt') {
                      <input 
                          type="text" 
                          [ngModel]="dialogService.promptValue()" 
                          (ngModelChange)="dialogService.promptValue.set($event)"
                          [placeholder]="dialogService.options()?.placeholder || ''"
                          class="w-full bg-(--postonsteroids-bg-primary) border border-(--postonsteroids-border) rounded px-3 py-2 text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent) transition-colors"
                          (keydown.enter)="dialogService.submit()"
                          (keydown.escape)="dialogService.cancel()"
                          autofocus
                      />
                  }
              </div>
              <div class="px-5 py-3 border-t border-(--postonsteroids-border) bg-(--postonsteroids-bg-tertiary) flex items-center justify-end gap-3">
                  <button (click)="dialogService.cancel()"
                      class="px-4 py-1.5 text-xs font-medium rounded text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary) hover:bg-(--postonsteroids-bg-hover) transition-all cursor-pointer">
                      {{ dialogService.options()?.cancelText }}
                  </button>
                  <button (click)="dialogService.submit()"
                      class="px-4 py-1.5 text-xs font-semibold rounded bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white shadow-sm transition-all cursor-pointer">
                      {{ dialogService.options()?.confirmText }}
                  </button>
              </div>
          </div>
      </div>
    }
  `
})
export class DialogModalComponent {
    dialogService = inject(DialogService);

    onBackdropClick(event: MouseEvent) {
        this.dialogService.cancel();
    }
}
