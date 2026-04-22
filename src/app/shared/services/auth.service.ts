import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    isLoggedIn = signal<boolean>(false);
    userEmail = signal<string>('');
    otp = signal<string>('');
    isOtpSent = signal<boolean>(false);
    isAuthenticating = signal<boolean>(false);
    showAuthModal = signal<boolean>(false);

    toggleAuthModal() {
        this.showAuthModal.update(v => !v);
    }

    sendOtp() {
        if (!this.userEmail()) return;
        this.isAuthenticating.set(true);
        this.isOtpSent.set(true);
        this.isAuthenticating.set(false);
    }

    authenticate() {
        if (!this.otp()) return;
        this.isAuthenticating.set(true);
        this.isLoggedIn.set(true);
        this.showAuthModal.set(false);
        this.isAuthenticating.set(false);
    }

    logout() {
        this.isLoggedIn.set(false);
        this.userEmail.set('');
    }
}
