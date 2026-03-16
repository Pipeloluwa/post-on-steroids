import { Component, signal, inject } from '@angular/core';
import { MenuComponent } from '../../shared/components/menu.component/menu.component';
import { NavbarComponent } from '../../shared/components/navbar.component/navbar.component';
import { AuthModalComponent } from '../../shared/components/auth.modal.component/auth.modal.component';
import { NotificationComponent } from '../../shared/components/notification.component/notification.component';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../shared/services/auth.service';
import { NotificationService } from '../../shared/services/notification.service';

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
