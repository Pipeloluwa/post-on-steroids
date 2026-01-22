import { Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScrollableSelectComponent } from '../../../shared/scrollable.select.component/scrollable.select.component';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';
import { ShareModalComponent } from '../../../shared/share.modal.component/share.modal.component';

@Component({
    selector: 'app-request-details-component',
    imports: [FormsModule, ScrollableSelectComponent, MatIcon, CommonModule, ShareModalComponent],
    templateUrl: './request-details.component.html',
    styleUrl: './request-details.component.css',
})
export class RequestDetailsComponent {
    isLoggedIn = input<boolean>(false);
    onAuthRequired = output<void>();
    onNotify = output<string>();

    waitingForAuth = signal<boolean>(false);

    constructor() {
        effect(() => {
            if (this.isLoggedIn() && this.waitingForAuth()) {
                this.waitingForAuth.set(false);
                // Small delay to ensure modal is closed and UI is ready
                setTimeout(() => this.shareCollection(), 500);
            }
        });
    }

    requestName = signal<string>('http://acegeld.runasp.net/api/v1/super-admin/users/create-admin');
    collections = signal<string[]>(['My Collection', 'API Project A', 'Personal Sandbox', 'Team Workspace']);
    selectedCollection = signal<string>('My Collection');
    saveOptions = ['Save As...'];

    showShareModal = signal<boolean>(false);
    generatedLink = signal<string>('');

    setCollection(collection: string) {
        this.selectedCollection.set(collection);
    }

    shareCollection() {
        if (!this.isLoggedIn()) {
            this.waitingForAuth.set(true);
            this.onAuthRequired.emit();
            return;
        }

        const shareLink = `https://postonsteroids.app/share/${Math.random().toString(36).substring(7)}`;
        this.generatedLink.set(shareLink);
        this.showShareModal.set(true);
    }

    copyLink() {
        navigator.clipboard.writeText(this.generatedLink()).then(() => {
            this.showShareModal.set(false);
            this.onNotify.emit('Collection link copied to clipboard!');
        });
    }

    onSaveOptionSelected(option: string) {
        if (option === 'Save As...') {
            alert('Save As clicked!');
        }
    }
}
