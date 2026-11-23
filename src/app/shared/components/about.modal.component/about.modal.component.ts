import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { APP_EDITION } from '../../../../environments/edition';

@Component({
    selector: 'app-about-modal-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './about.modal.component.html',
    styleUrl: './about.modal.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: {
        '(keydown.escape)': 'onClose.emit()'
    }
})
export class AboutModalComponent {
    show = input<boolean>(false);
    onClose = output<void>();

    readonly appEdition = APP_EDITION;
    appVersion = 'v2026.11.0-steroids';
    engineerName = 'Pipeloluwa';
    engineerTitle = 'Software Engineer';
}
