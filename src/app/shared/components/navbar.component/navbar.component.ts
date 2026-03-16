import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-navbar-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './navbar.component.html',
    styleUrl: './navbar.component.css'
})
export class NavbarComponent {
    title = input.required<string>();
    isLoggedIn = input.required<boolean>();
    userEmail = input.required<string>();

    onToggleAuth = output<void>();

    userInitials = computed(() => {
        const email = this.userEmail();
        if (!email) return '??';
        const parts = email.split('@')[0].split(/[._-]/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return email.substring(0, 2).toUpperCase();
    });
}
