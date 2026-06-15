import { Component, input, output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { TabStateService, RequestState } from '../services/tab.state.service';
import { AutoAuthService } from '../services/auto-auth.service';

@Component({
    selector: 'app-auto-auth-modal',
    imports: [CommonModule, MatIcon, FormsModule],
    template: `
    @if (show()) {
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="w-[450px] bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <!-- Header -->
            <div class="flex items-center justify-between px-5 py-4 border-b border-(--postonsteroids-border)/50 bg-(--postonsteroids-bg-tertiary)/30">
                <div class="flex items-center gap-x-3">
                    <div class="p-2 rounded-full bg-(--postonsteroids-accent)/10">
                        <mat-icon class="text-(--postonsteroids-accent) text-[20px]! size-[20px]!">bolt</mat-icon>
                    </div>
                    <div>
                        <h2 class="text-[15px] font-semibold text-(--postonsteroids-text-primary)">Enable Auto Auth</h2>
                        <p class="text-[11px] text-(--postonsteroids-text-muted) mt-0.5">Automatically re-authenticate on 401 Unauthorized</p>
                    </div>
                </div>
                <button (click)="onCancel.emit()" class="p-1 rounded-full hover:bg-(--postonsteroids-bg-hover) transition-colors text-(--postonsteroids-text-muted) hover:text-(--postonsteroids-text-primary)">
                    <mat-icon class="text-[20px]! size-[20px]!">close</mat-icon>
                </button>
            </div>

            <!-- Body -->
            <div class="p-5 flex flex-col gap-y-4">
                <div class="text-[13px] text-(--postonsteroids-text-secondary) leading-relaxed">
                    We've intelligently detected the login endpoint below. When any request returns a 401, we will automatically call this endpoint, extract the Bearer token, and retry the original request.
                </div>

                <div class="flex flex-col gap-y-1.5">
                    <label class="text-[12px] font-medium text-(--postonsteroids-text-primary)">Login Endpoint</label>
                    <div class="relative">
                        <select [(ngModel)]="selectedEndpointId" class="w-full appearance-none bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-md px-3 py-2 text-[13px] text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent)/50 cursor-pointer">
                            @for (tab of availableTabs(); track tab.id) {
                                <option [value]="tab.id">{{ tab.name }} ({{ tab.url }})</option>
                            }
                        </select>
                        <mat-icon class="absolute right-3 top-1/2 -translate-y-1/2 text-(--postonsteroids-text-muted) text-[16px]! size-[16px]! pointer-events-none">expand_more</mat-icon>
                    </div>
                    @if (availableTabs().length === 0) {
                        <p class="text-[11px] text-red-400 mt-1">No open tabs available to use for authentication.</p>
                    }
                </div>
            </div>

            <!-- Footer -->
            <div class="flex items-center justify-end gap-x-3 px-5 py-4 border-t border-(--postonsteroids-border)/50 bg-(--postonsteroids-bg-tertiary)/30">
                <button (click)="onCancel.emit()" class="px-4 py-1.5 text-[13px] font-medium text-(--postonsteroids-text-secondary) hover:text-(--postonsteroids-text-primary) transition-colors">
                    Cancel
                </button>
                <button (click)="confirm()" [disabled]="!selectedEndpointId" class="px-5 py-1.5 bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent)/90 text-white text-[13px] font-semibold rounded shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    Enable
                </button>
            </div>
        </div>
    </div>
    }
    `
})
export class AutoAuthModalComponent {
    tabStateService = inject(TabStateService);
    autoAuthService = inject(AutoAuthService);

    show = input.required<boolean>();
    detectedEndpoint = input<RequestState | null>(null);

    onCancel = output<void>();
    onConfirm = output<string>();

    availableTabs = computed(() => this.tabStateService.getAllOpenTabs());
    selectedEndpointId: string = '';

    // Watch for input changes to initialize selection
    ngOnChanges() {
        if (this.show()) {
            const detected = this.detectedEndpoint();
            if (detected) {
                this.selectedEndpointId = detected.id;
            } else {
                const tabs = this.availableTabs();
                if (tabs.length > 0) {
                    this.selectedEndpointId = tabs[0].id;
                }
            }
        }
    }

    confirm() {
        if (this.selectedEndpointId) {
            this.onConfirm.emit(this.selectedEndpointId);
        }
    }
}
