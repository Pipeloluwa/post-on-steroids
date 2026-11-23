import { Component, signal, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MenuComponent } from '../../shared/components/menu.component/menu.component';
import { NavbarComponent } from '../../shared/components/navbar.component/navbar.component';
import { AuthModalComponent } from '../../shared/components/auth.modal.component/auth.modal.component';
import { NotificationComponent } from '../../shared/components/notification.component/notification.component';
import { AddVariableModalComponent } from '../../shared/components/add-variable.modal.component/add-variable.modal.component';
import { DialogModalComponent } from '../../shared/components/dialog.modal.component';
import { TerminalDrawerComponent } from '../../shared/components/terminal-drawer.component';
import { Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../shared/services/auth.service';
import { NotificationService } from '../../shared/services/notification.service';
import { TabStateService } from '../../shared/services/tab.state.service';
import { SidebarService } from '../../shared/services/sidebar.service';
import { NetworkService } from '../../shared/services/network.service';
import { APP_EDITION } from '../../../environments/edition';
import { MatIcon } from '@angular/material/icon';
import { filter } from 'rxjs';

@Component({
  selector: 'app-main-layout',
  imports: [
    MenuComponent,
    RouterOutlet,
    CommonModule,
    MatIcon,
    NavbarComponent,
    AuthModalComponent,
    NotificationComponent,
    AddVariableModalComponent,
    DialogModalComponent,
    TerminalDrawerComponent
  ],
  templateUrl: './main.layout.html'
})
export class MainLayout {
  authService = inject(AuthService);
  notificationService = inject(NotificationService);
  sidebarService = inject(SidebarService);
  tabStateService = inject(TabStateService);
  networkService = inject(NetworkService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly requiresAuthGate = APP_EDITION.isProOrHigher;
  isWorkspaceRoute = signal<boolean>(this.checkWorkspaceRoute(this.router.url));

  protected readonly title = signal('OnSteroid');

  constructor() {
    this.router.events
      .pipe(
        filter((ev): ev is NavigationEnd => ev instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((ev) => {
        this.isWorkspaceRoute.set(this.checkWorkspaceRoute(ev.urlAfterRedirects || ev.url));
      });
  }

  private checkWorkspaceRoute(url: string): boolean {
    const clean = (url || '/').split('?')[0].split('#')[0];
    return clean === '/' || clean === '';
  }

  handleLogout() {
    this.authService.logout();
  }

  toggleAuthModal() {
    this.authService.toggleAuthModal();
  }

  closeAuthModal() {
    this.authService.closeAuthModal();
  }

  sendOtp() {
    this.authService.sendOtp();
  }

  authenticate() {
    this.authService.authenticate();
  }
}
