import { Component, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterModule, Router, NavigationEnd, IsActiveMatchOptions } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { SidebarService } from '../../services/sidebar.service';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-menu-component',
  imports: [MatIcon, RouterModule, CommonModule],
  templateUrl: './menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MenuComponent {
  protected themeService = inject(ThemeService);
  protected sidebarService = inject(SidebarService);
  protected authService = inject(AuthService);
  private router = inject(Router);

  protected readonly currentUrl = signal<string>(this.router.url);

  readonly matchOptionsExact: IsActiveMatchOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored'
  };

  readonly matchOptionsSubset: IsActiveMatchOptions = {
    paths: 'subset',
    queryParams: 'ignored',
    matrixParams: 'ignored',
    fragment: 'ignored'
  };

  menu = signal<{ name: string; icon: string; path: string; exact?: boolean }[]>([
    { name: 'OnSteroid', icon: 'dashboard', path: '/', exact: true },
    { name: 'Capsules', icon: 'collections', path: '/capsules' },
    { name: 'Export', icon: 'file_download', path: '/export' },
    { name: 'Import', icon: 'file_upload', path: '/import' },
    { name: 'Utilities', icon: 'handyman', path: '/utilities' },
    { name: 'History', icon: 'history', path: '/history' }
  ]);

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        this.currentUrl.set(event.urlAfterRedirects || event.url);
      });
  }

  isItemActive(item: { path: string; exact?: boolean }): boolean {
    const rawUrl = this.currentUrl() || this.router.url || '/';
    const cleanCurrent = rawUrl.split('?')[0].split('#')[0] || '/';
    const cleanTarget = item.path.split('?')[0].split('#')[0] || '/';
    if (item.exact) {
      return cleanCurrent === cleanTarget || cleanCurrent === '';
    }
    return cleanCurrent === cleanTarget || cleanCurrent.startsWith(`${cleanTarget}/`);
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }

  openChangePassword(): void {
    this.authService.openChangePasswordModal();
  }
}
