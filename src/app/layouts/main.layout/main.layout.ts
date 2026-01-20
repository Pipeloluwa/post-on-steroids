import { afterNextRender, Component, signal, Type } from '@angular/core';
import { MenuComponent } from '../../shared/menu.component/menu.component';
import { NgComponentOutlet } from '@angular/common';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [MenuComponent, NgComponentOutlet, RouterOutlet],
  templateUrl: './main.layout.html',
})
export class MainLayout {
  protected readonly title = signal('post-on-steroids');
  protected jsonComponent = signal<Type<any> | null>(null);

  constructor() {
    afterNextRender(async () => {
      try {
        const { JsonComponent } = await import('../../shared/json.component/json.component');
        this.jsonComponent.set(JsonComponent);
      } catch (error) {
        console.error('Error loading JsonComponent:', error);
      }
    });
  }

}
