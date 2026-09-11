import { Component, ChangeDetectionStrategy, input, output, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-auth-modal-component',
    imports: [CommonModule, MatIcon, FormsModule],
    templateUrl: './auth.modal.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuthModalComponent {
    show = input.required<boolean>();
    isOtpSent = input.required<boolean>();
    isAuthenticating = input.required<boolean>();
    errorMessage = input<string | null>(null);
    successMessage = input<string | null>(null);

    userEmail = model<string>('');
    otp = model<string>('');

    isOtpMasked = signal<boolean>(true);

    toggleOtpMask() {
        this.isOtpMasked.update(m => !m);
    }

    onClose = output<void>();
    onSendOtp = output<void>();
    onAuthenticate = output<void>();
    onBackToEmail = output<void>();
    onContinueWithoutSignIn = output<void>();

    toggleModal() {
        this.isOtpMasked.set(true);
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

    continueWithoutSignIn() {
        this.onContinueWithoutSignIn.emit();
        this.onClose.emit();
    }
}
