import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { ScrollableSelectComponent } from '../../../shared/scrollable.select.component/scrollable.select.component';

@Component({
    standalone: true,
    selector: 'app-request-url-component',
    imports: [FormsModule, ScrollableSelectComponent, MatIcon],
    templateUrl: './request-url.component.html',
    styleUrl: './request-url.component.css',
})
export class RequestUrlComponent {
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    selectedMethod = signal<string>('POST');
    url = signal<string>('http://acegeld.runasp.net/api/v1/super-admin/users/create-admin');

    setMethod(method: string) {
        this.selectedMethod.set(method);
    }

    getMethodColor = (method: string): string => {
        switch (method) {
            case 'GET': return '#00BF8E';
            case 'POST': return '#FFB400';
            case 'PUT': return '#097BED';
            case 'PATCH': return '#A97BFF';
            case 'DELETE': return '#FF5233';
            case 'HEAD': return '#00BF8E';
            case 'OPTIONS': return '#FF60AD';
            default: return 'var(--postonsteroids-text-primary)';
        }
    }
}
