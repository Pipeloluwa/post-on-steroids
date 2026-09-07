import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { API_BASE_URL, AUTH_TOKEN_KEY, AUTH_USER_KEY } from '../constants/api.constants';

export interface UserAuth {
    id: string;
    email: string;
    isAuthenticated: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface AuthLoginResponseData {
    user: UserAuth;
    token: string;
    expiresAt: string;
}

export interface ApiResponse<T> {
    title: string;
    responseCode: string;
    message: string;
    data: T;
    errors?: string[];
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private http = inject(HttpClient);
    private router = inject(Router);
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);

    isLoggedIn = signal<boolean>(false);
    currentUser = signal<UserAuth | null>(null);
    token = signal<string | null>(null);

    userEmail = signal<string>('');
    otp = signal<string>('');
    isOtpSent = signal<boolean>(false);
    isAuthenticating = signal<boolean>(false);
    showAuthModal = signal<boolean>(false);
    errorMessage = signal<string | null>(null);
    successMessage = signal<string | null>(null);

    constructor() {
        this.loadSession();
    }

    private loadSession() {
        if (!this.isBrowser) return;

        try {
            const savedToken = localStorage.getItem(AUTH_TOKEN_KEY);
            const savedUser = localStorage.getItem(AUTH_USER_KEY);

            if (savedToken && savedUser) {
                const user = JSON.parse(savedUser) as UserAuth;
                this.token.set(savedToken);
                this.currentUser.set(user);
                this.userEmail.set(user.email);
                this.isLoggedIn.set(true);
            }
        } catch (e) {
            console.error('Failed to load session from localStorage', e);
            this.clearStorage();
        }
    }

    toggleAuthModal() {
        this.showAuthModal.update(v => !v);
        this.errorMessage.set(null);
    }

    async sendOtp(): Promise<boolean> {
        const email = this.userEmail().trim();
        if (!email) {
            this.errorMessage.set('Please enter a valid email address.');
            return false;
        }

        this.isAuthenticating.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        return new Promise<boolean>((resolve) => {
            this.http.post<ApiResponse<any>>(`${API_BASE_URL}/auth/send-otp`, { email }).subscribe({
                next: (res) => {
                    this.isOtpSent.set(true);
                    this.successMessage.set(res.message || `Verification code sent to ${email}`);
                    this.isAuthenticating.set(false);
                    resolve(true);
                },
                error: (err) => {
                    const msg = err.error?.message || err.error?.errors?.[0] || 'Failed to send OTP code. Please try again.';
                    this.errorMessage.set(msg);
                    this.isAuthenticating.set(false);
                    resolve(false);
                }
            });
        });
    }

    async authenticate(): Promise<boolean> {
        const email = this.userEmail().trim();
        const otp = this.otp().trim();

        if (!email || !otp) {
            this.errorMessage.set('Please enter both email and OTP.');
            return false;
        }

        this.isAuthenticating.set(true);
        this.errorMessage.set(null);
        this.successMessage.set(null);

        return new Promise<boolean>((resolve) => {
            this.http.post<ApiResponse<AuthLoginResponseData>>(`${API_BASE_URL}/auth/verify-otp`, { email, otp }).subscribe({
                next: (res) => {
                    const data = res.data;
                    this.token.set(data.token);
                    this.currentUser.set(data.user);
                    this.isLoggedIn.set(true);
                    this.showAuthModal.set(false);
                    this.isAuthenticating.set(false);
                    this.otp.set('');

                    if (this.isBrowser) {
                        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
                        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
                    }

                    resolve(true);
                },
                error: (err) => {
                    const msg = err.error?.message || err.error?.errors?.[0] || 'Invalid or expired OTP. Please try again.';
                    this.errorMessage.set(msg);
                    this.isAuthenticating.set(false);
                    resolve(false);
                }
            });
        });
    }

    logout() {
        const userToken = this.token();
        if (userToken) {
            this.http.post(`${API_BASE_URL}/auth/logout`, {}).subscribe({
                error: () => { /* ignore logout errors */ }
            });
        }

        this.clearStorage();
        this.isLoggedIn.set(false);
        this.currentUser.set(null);
        this.token.set(null);
        this.userEmail.set('');
        this.otp.set('');
        this.isOtpSent.set(false);
        this.router.navigate(['/login']);
    }

    private clearStorage() {
        if (!this.isBrowser) return;
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
    }
}
