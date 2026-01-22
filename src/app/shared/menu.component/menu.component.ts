import { Component, signal, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-menu-component',
  imports: [MatIcon, RouterModule, CommonModule],
  templateUrl: './menu.component.html'
})
export class MenuComponent {
  protected themeService = inject(ThemeService);

  menu = signal<{ name: string; icon: string; path: string }[]>([
    { name: 'WorkSpace', icon: 'dashboard', path: '/workspace' },
    { name: 'collections', icon: 'collections', path: '/collections' },
    { name: 'export', icon: 'file_download', path: '/export' },
    { name: 'history', icon: 'history', path: '/history' }
  ]);

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }
}
