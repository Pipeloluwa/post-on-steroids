import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { CookieJarService } from '../services/cookie-jar.service';
import { NotificationService } from '../services/notification.service';

@Component({
  selector: 'app-cookie-manager-modal',
  imports: [FormsModule, MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape($event)'
  },
  template: `
    @if (isOpen()) {
      <div class="fixed inset-0 z-110 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
           (click)="close()">
        <div role="dialog" aria-modal="true" aria-labelledby="cookie-mgr-title"
             class="bg-(--postonsteroids-bg-secondary) border border-(--postonsteroids-border) rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[min(85dvh,calc(100dvh-28px))]"
             (click)="$event.stopPropagation()">

          <div class="px-5 py-3.5 border-b border-(--postonsteroids-border) flex items-center justify-between bg-(--postonsteroids-bg-tertiary)/50">
            <div class="flex items-center gap-2.5">
              <div class="size-7 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center">
                <mat-icon class="text-[17px]! size-[17px]!">cookie</mat-icon>
              </div>
              <div>
                <h3 id="cookie-mgr-title" class="text-sm font-bold text-(--postonsteroids-text-primary)">Cookie Jar Manager</h3>
                <p class="text-[11px] text-(--postonsteroids-text-muted)">Inspect, add, or clear domain cookies synced automatically with outgoing requests</p>
              </div>
            </div>
            <button type="button" (click)="close()" class="p-1 rounded-lg hover:bg-(--postonsteroids-bg-hover) text-(--postonsteroids-text-muted) cursor-pointer">
              <mat-icon class="text-[18px]! size-[18px]!">close</mat-icon>
            </button>
          </div>

          <!-- Filter + Add Form -->
          <div class="p-4 border-b border-(--postonsteroids-border)/70 flex flex-col gap-3 bg-(--postonsteroids-bg-primary)/30">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 flex-1 min-w-[200px] bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) rounded-lg px-2.5 py-1.5">
                <mat-icon class="text-[15px]! size-[15px]! text-(--postonsteroids-text-muted)">search</mat-icon>
                <input type="text" [ngModel]="filterText()" (ngModelChange)="filterText.set($event)"
                       placeholder="Filter by domain or cookie name..."
                       class="w-full bg-transparent text-xs text-(--postonsteroids-text-primary) outline-none" />
              </div>
              @if (cookieJar.cookies().length > 0) {
                <button type="button" (click)="clearAll()"
                        class="px-3 py-1.5 rounded-lg text-xs font-semibold text-status-danger bg-status-danger/10 hover:bg-status-danger/20 border border-status-danger/25 cursor-pointer transition-colors">
                  Clear All ({{ cookieJar.cookies().length }})
                </button>
              }
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
              <input type="text" [ngModel]="newDomain()" (ngModelChange)="newDomain.set($event)" placeholder="Domain (e.g. api.example.com)"
                     class="sm:col-span-3 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent)" />
              <input type="text" [ngModel]="newName()" (ngModelChange)="newName.set($event)" placeholder="Cookie Name"
                     class="sm:col-span-3 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-xs text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent)" />
              <input type="text" [ngModel]="newValue()" (ngModelChange)="newValue.set($event)" placeholder="Value"
                     class="sm:col-span-3 px-2.5 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-xs font-mono text-(--postonsteroids-text-primary) outline-none focus:border-(--postonsteroids-accent)" />
              <input type="text" [ngModel]="newPath()" (ngModelChange)="newPath.set($event)" placeholder="/"
                     class="sm:col-span-1 px-2 py-1.5 rounded-lg bg-(--postonsteroids-bg-tertiary) border border-(--postonsteroids-border) text-xs text-(--postonsteroids-text-primary) outline-none" />
              <button type="button" (click)="addCookie()"
                      class="sm:col-span-2 px-3 py-1.5 rounded-lg bg-(--postonsteroids-accent) hover:bg-(--postonsteroids-accent-hover) text-white text-xs font-semibold cursor-pointer transition-colors">
                + Add
              </button>
            </div>
          </div>

          <!-- Cookie Table -->
          <div class="flex-1 overflow-y-auto p-4">
            @if (filteredCookies().length === 0) {
              <div class="py-10 text-center text-xs text-(--postonsteroids-text-muted)">
                No cookies stored yet. Cookies returned from responses or added manually appear here.
              </div>
            } @else {
              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr class="text-(--postonsteroids-text-muted) border-b border-(--postonsteroids-border)/50">
                    <th class="w-8 py-1.5 text-center">On</th>
                    <th class="py-1.5 px-2 text-left">Domain</th>
                    <th class="py-1.5 px-2 text-left">Name</th>
                    <th class="py-1.5 px-2 text-left">Value</th>
                    <th class="w-16 py-1.5 px-2 text-left">Path</th>
                    <th class="w-10 py-1.5 text-center"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of filteredCookies(); track c.id) {
                    <tr class="border-b border-(--postonsteroids-border)/25 hover:bg-(--postonsteroids-bg-hover)/30">
                      <td class="py-1.5 text-center">
                        <input type="checkbox" [checked]="c.enabled" (change)="cookieJar.toggleCookie(c.id)"
                               class="accent-(--postonsteroids-accent) cursor-pointer" />
                      </td>
                      <td class="py-1.5 px-2 font-mono text-(--postonsteroids-accent)">{{ c.domain }}</td>
                      <td class="py-1.5 px-2 font-mono font-semibold text-(--postonsteroids-text-primary)">{{ c.name }}</td>
                      <td class="py-1.5 px-2 font-mono text-(--postonsteroids-text-secondary) break-all max-w-[240px]">{{ c.value }}</td>
                      <td class="py-1.5 px-2 font-mono text-(--postonsteroids-text-muted)">{{ c.path }}</td>
                      <td class="py-1.5 text-center">
                        <button type="button" (click)="cookieJar.deleteCookie(c.id)" title="Delete cookie"
                                class="text-(--postonsteroids-text-muted) hover:text-status-danger cursor-pointer p-0.5">
                          <mat-icon class="text-[15px]! size-[15px]!">delete</mat-icon>
                        </button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </div>
      </div>
    }
  `
})
export class CookieManagerModalComponent {
  cookieJar = inject(CookieJarService);
  private notification = inject(NotificationService);

  isOpen = input<boolean>(false);
  defaultUrl = input<string>('');
  closed = output<void>();

  filterText = signal<string>('');
  newDomain = signal<string>('');
  newName = signal<string>('');
  newValue = signal<string>('');
  newPath = signal<string>('/');

  filteredCookies = computed(() => {
    const q = this.filterText().trim().toLowerCase();
    const list = this.cookieJar.cookies();
    if (!q) return list;
    return list.filter(c =>
      c.domain.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.value.toLowerCase().includes(q)
    );
  });

  onEscape(event: Event): void {
    if (!this.isOpen()) return;
    event.preventDefault();
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  addCookie(): void {
    let domain = this.newDomain().trim();
    if (!domain && this.defaultUrl()) {
      try {
        domain = new URL(this.defaultUrl()).hostname;
      } catch {
        domain = '';
      }
    }
    const name = this.newName().trim();
    if (!domain || !name) {
      this.notification.notify('Please enter both domain and cookie name.', 'warning');
      return;
    }
    this.cookieJar.upsertCookie({
      domain,
      name,
      value: this.newValue(),
      path: this.newPath() || '/',
      enabled: true,
      source: 'manual'
    });
    this.newName.set('');
    this.newValue.set('');
    this.notification.notify(`Cookie "${name}" saved for ${domain}.`, 'success');
  }

  clearAll(): void {
    this.cookieJar.clearAll();
    this.notification.notify('Cookie jar cleared.', 'info');
  }
}
