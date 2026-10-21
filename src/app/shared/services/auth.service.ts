import { Injectable, signal, computed, inject, PLATFORM_ID, Injector } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, firstValueFrom } from 'rxjs';
import { API_BASE_URL, AUTH_TOKEN_KEY, AUTH_USER_KEY, AUTH_REFRESH_TOKEN_KEY } from '../constants/api.constants';
import { NotificationService } from './notification.service';

export interface UserAuth {
    id: string;
    email: string;
    isAuthenticated: boolean;
    hasPassword?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface AuthLoginResponseData {
    user: UserAuth;
    token: string;
    refreshToken: string;
    expiresAt: string;
    requiresPasswordSetup?: boolean;
}

export interface SendOtpResponseData {
    email: string;
    hasPassword?: boolean;
    otpSent?: boolean;
    isPasswordReset?: boolean;
}

export interface ApiResponse<T> {
    title: string;
    responseCode: string;
    message: string;
    data: T;
    errors?: string[];
}

export type AuthStep = 'email' | 'otp' | 'create-password' | 'login-password' | 'change-password';

export interface PasswordValidationState {
    minLength: boolean;
    hasUpper: boolean;
    hasLower: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
    notSameAsEmail: boolean;
    differentFromCurrent: boolean;
    passwordsMatch: boolean;
    passedCount: number;
    strengthLabel: 'Too Short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
    isValid: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private http = inject(HttpClient);
    private router = inject(Router);
    private notificationService = inject(NotificationService);
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);
    private injector = inject(Injector);

    isLoggedIn = signal<boolean>(false);
    currentUser = signal<UserAuth | null>(null);
    token = signal<string | null>(null);
    refreshToken = signal<string | null>(null);
    onLogout = new Subject<UserAuth | null>();
    onLogin = new Subject<UserAuth>();

    userEmail = signal<string>('');
    otp = signal<string>('');
    currentPassword = signal<string>('');
    password = signal<string>('');
    confirmPassword = signal<string>('');

    authStep = signal<AuthStep>('email');
    isOtpSent = signal<boolean>(false);
    isPasswordResetFlow = signal<boolean>(false);
    isAuthenticating = signal<boolean>(false);
    isLoggingOut = signal<boolean>(false);
    showAuthModal = signal<boolean>(false);
    errorMessage = signal<string | null>(null);
    successMessage = signal<string | null>(null);

    passwordValidation = computed<PasswordValidationState>(() => {
        const pwd = this.password() || '';
        const confirm = this.confirmPassword() || '';
        const currPwd = this.currentPassword() || '';
        const step = this.authStep();
        const email = (this.userEmail() || '').trim().toLowerCase();

        const minLength = pwd.length >= 8;
        const hasUpper = /[A-Z]/.test(pwd);
        const hasLower = /[a-z]/.test(pwd);
        const hasNumber = /[0-9]/.test(pwd);
        const hasSpecial = /[^A-Za-z0-9]/.test(pwd);
        const notSameAsEmail = !pwd || !email || pwd.trim().toLowerCase() !== email;
        const differentFromCurrent = step !== 'change-password' || (!pwd || !currPwd || pwd !== currPwd);
        const passwordsMatch = pwd.length > 0 && pwd === confirm;

        const rules = [minLength, hasUpper, hasLower, hasNumber, hasSpecial];
        const passedCount = rules.filter(Boolean).length;

        let strengthLabel: PasswordValidationState['strengthLabel'] = 'Weak';
        if (pwd.length > 0 && pwd.length < 8) {
            strengthLabel = 'Too Short';
        } else if (passedCount <= 2) {
            strengthLabel = 'Weak';
        } else if (passedCount === 3) {
            strengthLabel = 'Fair';
        } else if (passedCount === 4) {
            strengthLabel = 'Good';
        } else if (passedCount === 5) {
            strengthLabel = 'Strong';
        }

        const isValid =
            minLength &&
            hasUpper &&
            hasLower &&
            hasNumber &&
            hasSpecial &&
            notSameAsEmail &&
            differentFromCurrent &&
            passwordsMatch &&
            (step !== 'change-password' || currPwd.length > 0);

        return {
            minLength,
            hasUpper,
            hasLower,
            hasNumber,
            hasSpecial,
            notSameAsEmail,
            differentFromCurrent,
            passwordsMatch,
            passedCount,
            strengthLabel,
            isValid
        };
    });

    activeSaveRequestsCount = signal<number>(0);
    private saveCheckers: (() => boolean)[] = [];

    registerSaveChecker(checker: () => boolean) {
        this.saveCheckers.push(checker);
    }

    startSaveRequest() {
        this.activeSaveRequestsCount.update(c => c + 1);
    }

    endSaveRequest() {
        this.activeSaveRequestsCount.update(c => Math.max(0, c - 1));
    }

    hasPendingSaveOperations(): boolean {
        if (this.activeSaveRequestsCount() > 0) return true;
        for (const checker of this.saveCheckers) {
            try {
                if (checker()) return true;
            } catch {}
        }
        return false;
    }

    constructor() {
        this.loadSession();
    }

    private loadSession() {
        if (!this.isBrowser) return;

        try {
            const savedToken = localStorage.getItem(AUTH_TOKEN_KEY);
            const savedRefreshToken = localStorage.getItem(AUTH_REFRESH_TOKEN_KEY);
            const savedUser = localStorage.getItem(AUTH_USER_KEY);

            if (savedToken && savedUser) {
                const user = JSON.parse(savedUser) as UserAuth;
                this.token.set(savedToken);
                this.refreshToken.set(savedRefreshToken);
                this.currentUser.set(user);
                this.userEmail.set(user.email);
                this.isLoggedIn.set(true);
                this.showAuthModal.set(false);
            } else {
                this.showAuthModal.set(true);
            }
        } catch (e) {
            console.error('Failed to load session from localStorage', e);
            this.clearStorage();
            this.showAuthModal.set(true);
        }
    }

    toggleAuthModal() {
        if (!this.showAuthModal() && !this.isLoggedIn()) {
            this.authStep.set('email');
        }
        this.showAuthModal.update(v => !v);
        this.errorMessage.set(null);
    }

    openAuthModal() {
        if (!this.isLoggedIn()) {
            this.authStep.set('email');
        }
        this.showAuthModal.set(true);
        this.errorMessage.set(null);
    }

    openChangePasswordModal() {
        const user = this.currentUser();
        if (user?.email) {
            this.userEmail.set(user.email);
        }
        this.currentPassword.set('');
        this.password.set('');
        this.confirmPassword.set('');
        this.errorMessage.set(null);
        this.successMessage.set(null);
        this.isPasswordResetFlow.set(false);
        this.authStep.set('change-password');
        this.showAuthModal.set(true);
    }

    closeAuthModal() {
        this.showAuthModal.set(false);
        this.errorMessage.set(null);
        this.successMessage.set(null);
        if (this.authStep() === 'change-password') {
            this.currentPassword.set('');
            this.password.set('');
            this.confirmPassword.set('');
            this.authStep.set('email');
        }
    }

    continueWithoutSignIn() {
        this.closeAuthModal();
    }

    resetToEmailStep() {
        this.authStep.set('email');
        this.isOtpSent.set(false);
        this.isPasswordResetFlow.set(false);
        this.otp.set('');
        this.currentPassword.set('');
        this.password.set('');
        this.confirmPassword.set('');
        this.errorMessage.set(null);
        this.successMessage.set(null);
    }

    async sendOtp(forceOtp = false): Promise<boolean> {
        const email = this.userEmail().trim();
        if (!email) {
            this.errorMessage.set('Please enter a valid email address.');
            return false;
        }

        this.isAuthenticating.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        return new Promise<boolean>((resolve) => {
            this.http.post<ApiResponse<SendOtpResponseData>>(`${API_BASE_URL}/auth/send-otp`, { email, forceOtp }).subscribe({
                next: (res) => {
                    const data = res.data;
                    if (data && data.hasPassword && data.otpSent === false && !forceOtp) {
                        this.isOtpSent.set(false);
                        this.authStep.set('login-password');
                        this.password.set('');
                        this.confirmPassword.set('');
                        this.successMessage.set(null);
                    } else {
                        this.isOtpSent.set(true);
                        this.authStep.set('otp');
                        this.otp.set('');
                        this.successMessage.set(res.message || `Verification code sent to ${email}`);
                    }
                    this.isAuthenticating.set(false);
                    resolve(true);
                },
                error: (err) => {
                    const msg = err.error?.message || err.error?.errors?.[0] || 'Failed to send verification code. Please try again.';
                    this.errorMessage.set(msg);
                    this.isAuthenticating.set(false);
                    resolve(false);
                }
            });
        });
    }

    async startPasswordReset(): Promise<boolean> {
        const email = this.userEmail().trim();
        if (!email) {
            this.errorMessage.set('Please enter your email address first to reset your password.');
            return false;
        }

        this.isPasswordResetFlow.set(true);
        this.currentPassword.set('');
        this.password.set('');
        this.confirmPassword.set('');
        this.isAuthenticating.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        return new Promise<boolean>((resolve) => {
            this.http.post<ApiResponse<SendOtpResponseData>>(`${API_BASE_URL}/auth/forgot-password`, { email }).subscribe({
                next: (res) => {
                    this.isOtpSent.set(true);
                    this.authStep.set('otp');
                    this.otp.set('');
                    this.successMessage.set(res.message || `Password reset code sent to ${email}`);
                    this.isAuthenticating.set(false);
                    resolve(true);
                },
                error: (err) => {
                    const msg = err.error?.message || err.error?.errors?.[0] || 'Failed to send password reset code. Please try again.';
                    this.errorMessage.set(msg);
                    this.isAuthenticating.set(false);
                    resolve(false);
                }
            });
        });
    }

    async signInWithOtpInstead(): Promise<boolean> {
        this.isPasswordResetFlow.set(false);
        this.password.set('');
        return this.sendOtp(true);
    }

    async authenticate(): Promise<boolean> {
        const email = this.userEmail().trim();
        const otp = this.otp().trim();

        if (!email || !otp) {
            this.errorMessage.set('Please enter both email and verification code.');
            return false;
        }

        this.isAuthenticating.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        return new Promise<boolean>((resolve) => {
            this.http.post<ApiResponse<AuthLoginResponseData>>(`${API_BASE_URL}/auth/verify-otp`, {
                email,
                otp,
                isPasswordReset: this.isPasswordResetFlow()
            }).subscribe({
                next: (res) => {
                    const data = res.data;
                    this.isAuthenticating.set(false);
                    this.otp.set('');

                    if (data?.requiresPasswordSetup) {
                        this.authStep.set('create-password');
                        this.password.set('');
                        this.confirmPassword.set('');
                        this.successMessage.set(
                            res.message ||
                            (this.isPasswordResetFlow()
                                ? 'Code verified! Enter your new password below.'
                                : 'Email verified! Create a strong password to complete your account.')
                        );
                        resolve(false);
                        return;
                    }

                    this.finalizeLogin(data);
                    resolve(true);
                },
                error: (err) => {
                    const msg = err.error?.message || err.error?.errors?.[0] || 'Invalid or expired OTP. Please try again.';
                    this.errorMessage.set(msg);
                    this.isAuthenticating.set(false);
                    this.otp.set('');
                    resolve(false);
                }
            });
        });
    }

    async completeAccountCreation(): Promise<boolean> {
        const email = this.userEmail().trim();
        const password = this.password();
        const confirmPassword = this.confirmPassword();
        const v = this.passwordValidation();

        if (!v.minLength) {
            this.errorMessage.set('Password must be at least 8 characters long.');
            return false;
        }
        if (!v.hasUpper || !v.hasLower || !v.hasNumber || !v.hasSpecial) {
            this.errorMessage.set('Password must include uppercase, lowercase, number, and special character.');
            return false;
        }
        if (!v.notSameAsEmail) {
            this.errorMessage.set('Password cannot be the same as your email address.');
            return false;
        }
        if (!v.passwordsMatch) {
            this.errorMessage.set('Passwords do not match.');
            return false;
        }

        this.isAuthenticating.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        return new Promise<boolean>((resolve) => {
            this.http.post<ApiResponse<AuthLoginResponseData>>(`${API_BASE_URL}/auth/set-password`, {
                email,
                password,
                confirmPassword
            }).subscribe({
                next: (res) => {
                    this.isAuthenticating.set(false);
                    this.finalizeLogin(res.data);
                    this.notificationService.notify(
                        this.isPasswordResetFlow()
                            ? 'Password reset and signed in successfully!'
                            : 'Account created and signed in successfully!'
                    );
                    this.isPasswordResetFlow.set(false);
                    resolve(true);
                },
                error: (err) => {
                    const msg = err.error?.errors?.[0] || err.error?.message || 'Could not save password. Please check the requirements and try again.';
                    this.errorMessage.set(msg);
                    this.isAuthenticating.set(false);
                    resolve(false);
                }
            });
        });
    }

    async changePassword(): Promise<boolean> {
        const currentPassword = this.currentPassword();
        const newPassword = this.password();
        const confirmPassword = this.confirmPassword();
        const v = this.passwordValidation();

        if (!currentPassword) {
            this.errorMessage.set('Please enter your current password.');
            return false;
        }
        if (!v.minLength || !v.hasUpper || !v.hasLower || !v.hasNumber || !v.hasSpecial) {
            this.errorMessage.set('New password must meet all complexity requirements.');
            return false;
        }
        if (!v.differentFromCurrent) {
            this.errorMessage.set('New password must be different from your current password.');
            return false;
        }
        if (!v.notSameAsEmail) {
            this.errorMessage.set('New password cannot be the same as your email address.');
            return false;
        }
        if (!v.passwordsMatch) {
            this.errorMessage.set('New passwords do not match.');
            return false;
        }

        this.isAuthenticating.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        return new Promise<boolean>((resolve) => {
            this.http.post<ApiResponse<UserAuth>>(`${API_BASE_URL}/auth/change-password`, {
                currentPassword,
                newPassword,
                confirmPassword
            }).subscribe({
                next: (res) => {
                    this.isAuthenticating.set(false);
                    if (res.data) {
                        this.currentUser.set(res.data);
                        if (this.isBrowser) {
                            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(res.data));
                        }
                    }
                    this.currentPassword.set('');
                    this.password.set('');
                    this.confirmPassword.set('');
                    this.authStep.set('email');
                    this.showAuthModal.set(false);
                    this.notificationService.notify('Password changed successfully!');
                    resolve(true);
                },
                error: (err) => {
                    const msg = err.error?.errors?.[0] || err.error?.message || 'Could not change password. Please verify your current password.';
                    this.errorMessage.set(msg);
                    this.isAuthenticating.set(false);
                    resolve(false);
                }
            });
        });
    }

    async loginWithPassword(): Promise<boolean> {
        const email = this.userEmail().trim();
        const password = this.password();

        if (!email || !password) {
            this.errorMessage.set('Please enter your password.');
            return false;
        }

        this.isAuthenticating.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        return new Promise<boolean>((resolve) => {
            this.http.post<ApiResponse<AuthLoginResponseData>>(`${API_BASE_URL}/auth/login-password`, {
                email,
                password
            }).subscribe({
                next: (res) => {
                    this.isAuthenticating.set(false);
                    this.finalizeLogin(res.data);
                    resolve(true);
                },
                error: (err) => {
                    const msg = err.error?.message || err.error?.errors?.[0] || 'Invalid email or password.';
                    this.errorMessage.set(msg);
                    this.isAuthenticating.set(false);
                    resolve(false);
                }
            });
        });
    }

    private finalizeLogin(data: AuthLoginResponseData) {
        const prevUser = this.currentUser();

        if (prevUser && prevUser.id !== data.user.id) {
            this.onLogout.next(prevUser);
            this.clearStorage();
        }

        this.token.set(data.token);
        this.refreshToken.set(data.refreshToken);
        this.currentUser.set(data.user);
        this.isLoggedIn.set(true);
        this.showAuthModal.set(false);
        this.authStep.set('email');
        this.isOtpSent.set(false);
        this.otp.set('');
        this.currentPassword.set('');
        this.password.set('');
        this.confirmPassword.set('');
        this.errorMessage.set(null);
        this.successMessage.set(null);

        if (this.isBrowser) {
            localStorage.setItem(AUTH_TOKEN_KEY, data.token);
            localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, data.refreshToken);
            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        }

        this.onLogin.next(data.user);
    }

    async logout() {
        if (this.isLoggingOut()) return;
        this.isLoggingOut.set(true);

        const startWait = Date.now();
        const maxWaitMs = 15000;
        while (this.hasPendingSaveOperations() && (Date.now() - startWait < maxWaitMs)) {
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        const user = this.currentUser();
        const userToken = this.token();

        if (userToken) {
            await firstValueFrom(this.http.post(`${API_BASE_URL}/auth/logout`, {})).catch(() => {});
        }

        this.onLogout.next(user);

        this.clearStorage();
        this.isLoggedIn.set(false);
        this.currentUser.set(null);
        this.token.set(null);
        this.refreshToken.set(null);
        this.userEmail.set('');
        this.resetToEmailStep();
        this.showAuthModal.set(true);
        this.isLoggingOut.set(false);
        this.notificationService.notify('Successfully logged out.');
    }

    private clearStorage() {
        if (!this.isBrowser) return;
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        localStorage.removeItem(AUTH_REFRESH_TOKEN_KEY);
    }

    async refreshTokens(): Promise<boolean> {
        const currentToken = this.token();
        const currentRefresh = this.refreshToken();
        if (!currentRefresh) {
            return false;
        }

        try {
            const res = await firstValueFrom(this.http.post<ApiResponse<AuthLoginResponseData>>(`${API_BASE_URL}/auth/refresh`, { 
                accessToken: currentToken || '',
                refreshToken: currentRefresh
            }));
            
            if (res && res.data) {
                this.token.set(res.data.token);
                this.refreshToken.set(res.data.refreshToken);
                if (this.isBrowser) {
                    localStorage.setItem(AUTH_TOKEN_KEY, res.data.token);
                    localStorage.setItem(AUTH_REFRESH_TOKEN_KEY, res.data.refreshToken);
                }
                return true;
            }
        } catch (e) {
            console.error('Failed to refresh token', e);
        }
        
        return false;
    }
}
