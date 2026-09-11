import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { AuthService } from '../../shared/services/auth.service';

@Component({
    selector: 'app-login',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './login.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent implements OnInit {
    authService = inject(AuthService);
    private router = inject(Router);

    isOtpMasked = signal<boolean>(true);

    toggleOtpMask() {
        this.isOtpMasked.update(m => !m);
    }

    ngOnInit() {
        if (this.authService.isLoggedIn()) {
            this.router.navigate(['/steroid']);
        }
    }

    async onSendOtp() {
        const success = await this.authService.sendOtp();
        // stays on page, OTP input shows if success
    }

    onOtpInput(event: Event) {
        const input = event.target as HTMLInputElement;
        const clean = (input.value || '').replace(/\D/g, '').slice(0, 6);
        input.value = clean;
        this.authService.otp.set(clean);

        if (clean.length === 6 && !this.authService.isAuthenticating()) {
            this.onAuthenticate();
        }
    }

    async onAuthenticate() {
        if (this.authService.otp().length !== 6) return;
        const success = await this.authService.authenticate();
        if (success) {
            this.router.navigate(['/steroid']);
        }
    }

    onBackToEmail() {
        this.authService.isOtpSent.set(false);
        this.authService.otp.set('');
        this.isOtpMasked.set(true);
        this.authService.errorMessage.set(null);
        this.authService.successMessage.set(null);
    }

    continueAsGuest() {
        this.router.navigate(['/steroid']);
    }
}
