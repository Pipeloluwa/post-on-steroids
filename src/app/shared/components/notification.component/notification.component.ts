import { Component, input, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { ThemeService } from '../../services/theme.service';
import { NotificationService } from '../../services/notification.service';

@Component({
    selector: 'app-notification-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './notification.component.html',
    styleUrl: './notification.component.css'
})
export class NotificationComponent {
    protected themeService = inject(ThemeService);
    protected notificationService = inject(NotificationService);

    message = input.required<string>();
    show = input.required<boolean>();
    type = input<'success' | 'warning' | 'error' | 'info'>('success');

    isDark = computed(() => this.themeService.isDarkMode());
}
