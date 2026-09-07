import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
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

    ngOnInit() {
        if (this.authService.isLoggedIn()) {
            this.router.navigate(['/steroid']);
        }
    }

    async onSendOtp() {
        const success = await this.authService.sendOtp();
        // stays on page, OTP input shows if success
    }

    async onAuthenticate() {
        const success = await this.authService.authenticate();
        if (success) {
            this.router.navigate(['/steroid']);
        }
    }

    onBackToEmail() {
        this.authService.isOtpSent.set(false);
        this.authService.otp.set('');
        this.authService.errorMessage.set(null);
        this.authService.successMessage.set(null);
    }
}
