import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-share-modal-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './share.modal.component.html',
    styleUrl: './share.modal.component.css'
})
export class ShareModalComponent {
    show = input.required<boolean>();
    link = input.required<string>();

    onClose = output<void>();
    onCopy = output<void>();
}
