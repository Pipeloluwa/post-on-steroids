import { Component, ChangeDetectionStrategy, input, output, model, signal, viewChild, ElementRef, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
    selector: 'app-auth-modal-component',
    imports: [CommonModule, MatIcon, FormsModule],
    templateUrl: './auth.modal.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuthModalComponent {
    authService = inject(AuthService);

    emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
    otpInput = viewChild<ElementRef<HTMLInputElement>>('otpInput');
    createPasswordInput = viewChild<ElementRef<HTMLInputElement>>('createPasswordInput');
    loginPasswordInput = viewChild<ElementRef<HTMLInputElement>>('loginPasswordInput');
    currentPasswordInput = viewChild<ElementRef<HTMLInputElement>>('currentPasswordInput');

    constructor() {
        effect(() => {
            if (this.show()) {
                const step = this.authService.authStep();
                if (step === 'otp') {
                    const el = this.otpInput();
                    if (el) setTimeout(() => el.nativeElement.focus(), 100);
                } else if (step === 'create-password') {
                    const el = this.createPasswordInput();
                    if (el) setTimeout(() => el.nativeElement.focus(), 100);
                } else if (step === 'login-password') {
                    const el = this.loginPasswordInput();
                    if (el) setTimeout(() => el.nativeElement.focus(), 100);
                } else if (step === 'change-password') {
                    const el = this.currentPasswordInput();
                    if (el) setTimeout(() => el.nativeElement.focus(), 100);
                } else {
                    const el = this.emailInput();
                    if (el) setTimeout(() => el.nativeElement.focus(), 100);
                }
            }
        });
    }

    show = input.required<boolean>();
    isOtpSent = input.required<boolean>();
    isAuthenticating = input.required<boolean>();
    errorMessage = input<string | null>(null);
    successMessage = input<string | null>(null);

    userEmail = model<string>('');
    otp = model<string>('');

    isOtpMasked = signal<boolean>(true);
    isCurrentPasswordMasked = signal<boolean>(true);
    isPasswordMasked = signal<boolean>(true);
    isConfirmPasswordMasked = signal<boolean>(true);

    toggleOtpMask() {
        this.isOtpMasked.update(m => !m);
    }

    toggleCurrentPasswordMask() {
        this.isCurrentPasswordMasked.update(m => !m);
    }

    togglePasswordMask() {
        this.isPasswordMasked.update(m => !m);
    }

    toggleConfirmPasswordMask() {
        this.isConfirmPasswordMasked.update(m => !m);
    }

    onClose = output<void>();
    onSendOtp = output<void>();
    onAuthenticate = output<void>();
    onBackToEmail = output<void>();
    onContinueWithoutSignIn = output<void>();

    toggleModal() {
        this.isOtpMasked.set(true);
        this.isCurrentPasswordMasked.set(true);
        this.isPasswordMasked.set(true);
        this.isConfirmPasswordMasked.set(true);
        this.onClose.emit();
    }

    onOtpInput(event: Event) {
        const input = event.target as HTMLInputElement;
        const clean = (input.value || '').replace(/\D/g, '').slice(0, 6);
        input.value = clean;
        this.otp.set(clean);

        if (clean.length === 6 && !this.isAuthenticating()) {
            this.onAuthenticate.emit();
        }
    }

    async submitCreatePassword() {
        await this.authService.completeAccountCreation();
    }

    async submitChangePassword() {
        await this.authService.changePassword();
    }

    async submitLoginPassword() {
        await this.authService.loginWithPassword();
    }

    async onForgotPassword() {
        await this.authService.startPasswordReset();
    }

    async onSignInWithOtpInstead() {
        await this.authService.signInWithOtpInstead();
    }

    async onResendOtp() {
        if (this.authService.isPasswordResetFlow()) {
            await this.authService.startPasswordReset();
        } else {
            await this.authService.sendOtp(true);
        }
    }

    backToEmail() {
        this.isOtpMasked.set(true);
        this.isCurrentPasswordMasked.set(true);
        this.isPasswordMasked.set(true);
        this.isConfirmPasswordMasked.set(true);
        this.authService.resetToEmailStep();
        this.onBackToEmail.emit();
    }

    continueWithoutSignIn() {
        this.onContinueWithoutSignIn.emit();
        this.onClose.emit();
    }
}
