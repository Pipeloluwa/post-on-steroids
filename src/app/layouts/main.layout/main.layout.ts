import { Component, signal, inject } from '@angular/core';
import { MenuComponent } from '../../shared/menu.component/menu.component';
import { NavbarComponent } from '../../shared/navbar.component/navbar.component';
import { AuthModalComponent } from '../../shared/auth.modal.component/auth.modal.component';
import { NotificationComponent } from '../../shared/notification.component/notification.component';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-main-layout',
  imports: [
    MenuComponent,
    RouterOutlet,
    CommonModule,
    NavbarComponent,
    AuthModalComponent,
    NotificationComponent
  ],
  templateUrl: './main.layout.html'
})
export class MainLayout {
  authService = inject(AuthService);
  notificationService = inject(NotificationService);

  protected readonly title = signal('PostOnSteroids');

  toggleAuthModal() {
    this.authService.toggleAuthModal();
  }

  sendOtp() {
    this.authService.sendOtp();
  }

  authenticate() {
    this.authService.authenticate();
  }
}
