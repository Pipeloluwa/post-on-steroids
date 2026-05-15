import { Component, signal, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { SidebarService } from '../../services/sidebar.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-menu-component',
  imports: [MatIcon, RouterModule, CommonModule],
  templateUrl: './menu.component.html'
})
export class MenuComponent {
  protected themeService = inject(ThemeService);
  protected sidebarService = inject(SidebarService);

  menu = signal<{ name: string; icon: string; path: string }[]>([
    { name: 'Steroid', icon: 'dashboard', path: '/steroid' },
    { name: 'Capsules', icon: 'collections', path: '/capsules' },
    { name: 'export', icon: 'file_download', path: '/export' },
    { name: 'import', icon: 'file_upload', path: '/import' },
    { name: 'history', icon: 'history', path: '/history' }
  ]);

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }
}
