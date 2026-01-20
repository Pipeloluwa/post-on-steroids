import { Component, signal, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-menu-component',
  imports: [MatIcon],
  templateUrl: './menu.component.html'
})
export class MenuComponent {
  protected themeService = inject(ThemeService);

  menu = signal<{ name: string; icon: string }[]>([
    { name: 'export', icon: 'file_download' },
    { name: 'collection', icon: 'collections' },
    { name: 'history', icon: 'history' }
  ])

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }
}
