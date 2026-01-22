import { Component, input, output, model } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-auth-modal-component',
    imports: [CommonModule, MatIcon, FormsModule],
    templateUrl: './auth.modal.component.html',
})
export class AuthModalComponent {
    show = input.required<boolean>();
    isOtpSent = input.required<boolean>();
    isAuthenticating = input.required<boolean>();

    userEmail = model<string>('');
    otp = model<string>('');

    onClose = output<void>();
    onSendOtp = output<void>();
    onAuthenticate = output<void>();
    onBackToEmail = output<void>();

    toggleModal() {
        this.onClose.emit();
    }
}
