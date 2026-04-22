import { Injectable, signal, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class SidebarService {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);
  
  isCollapsed = signal<boolean>(
    typeof window !== 'undefined' && window.localStorage?.getItem('postonsteroids_sidebar_collapsed') === 'true'
  );

  isHydrated = signal<boolean>(false);

  constructor() {
    if (this.isBrowser) {
        // Set hydrated to true after the first render on the client
        setTimeout(() => this.isHydrated.set(true), 300);
    }

    effect(() => {
      if (this.isBrowser) {
        localStorage.setItem('postonsteroids_sidebar_collapsed', String(this.isCollapsed()));
      }
    });
  }

  toggle() {
    this.isCollapsed.update(v => !v);
  }

  collapse() {
    this.isCollapsed.set(true);
  }

  expand() {
    this.isCollapsed.set(false);
  }
}
