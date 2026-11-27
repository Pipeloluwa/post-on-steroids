import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIcon } from '@angular/material/icon';
import { AuthService } from '../../shared/services/auth.service';
import { APP_EDITION } from '../../../environments/edition';

@Component({
    selector: 'app-login',
    imports: [CommonModule, FormsModule, MatIcon],
    templateUrl: './login.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent implements OnInit {
    authService = inject(AuthService);
    private router = inject(Router);
    readonly appEdition = APP_EDITION;

    isOtpMasked = signal<boolean>(true);
    isPasswordMasked = signal<boolean>(true);
    isConfirmPasswordMasked = signal<boolean>(true);

    toggleOtpMask() {
        this.isOtpMasked.update(m => !m);
    }

    togglePasswordMask() {
        this.isPasswordMasked.update(m => !m);
    }

    toggleConfirmPasswordMask() {
        this.isConfirmPasswordMasked.update(m => !m);
    }

    ngOnInit() {
        if (this.authService.isLoggedIn()) {
            this.router.navigate(['/']);
        }
    }

    async onSendOtp(forceOtp = false) {
        if (forceOtp && this.authService.isPasswordResetFlow()) {
            await this.authService.startPasswordReset();
            return;
        }
        await this.authService.sendOtp(forceOtp);
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
        const loggedInImmediately = await this.authService.authenticate();
        if (loggedInImmediately) {
            this.router.navigate(['/']);
        }
    }

    async onCompleteAccountCreation() {
        const success = await this.authService.completeAccountCreation();
        if (success) {
            this.router.navigate(['/']);
        }
    }

    async onLoginWithPassword() {
        const success = await this.authService.loginWithPassword();
        if (success) {
            this.router.navigate(['/']);
        }
    }

    async onForgotPassword() {
        await this.authService.startPasswordReset();
    }

    onBackToEmail() {
        this.isOtpMasked.set(true);
        this.isPasswordMasked.set(true);
        this.isConfirmPasswordMasked.set(true);
        this.authService.resetToEmailStep();
    }

    continueAsGuest() {
        if (this.appEdition.isProOrHigher) {
            return;
        }
        this.router.navigate(['/']);
    }
}
