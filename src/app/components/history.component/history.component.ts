import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIcon } from '@angular/material/icon';

interface HistoryItem {
    id: string;
    method: string;
    url: string;
    time: string;
}

@Component({
    selector: 'app-history-component',
    imports: [CommonModule, MatIcon],
    templateUrl: './history.component.html',
    styleUrl: './history.component.css'
})
export class HistoryComponent {
    history = signal<HistoryItem[]>([
        { id: '1', method: 'POST', url: 'http://acegeld.runasp.net/api/v1/auth/login', time: '2 mins ago' },
        { id: '2', method: 'GET', url: 'https://api.github.com/users/octocat', time: '1 hour ago' },
        { id: '3', method: 'PUT', url: 'http://acegeld.runasp.net/api/v1/users/profile', time: 'Yesterday' }
    ]);

    getMethodColor(method: string): string {
        switch (method.toUpperCase()) {
            case 'GET': return '#00BF8E';
            case 'POST': return '#FFB400';
            case 'PUT': return '#097BED';
            case 'DEL':
            case 'DELETE': return '#FF5233';
            default: return 'var(--postonsteroids-text-primary)';
        }
    }

    clearHistory() {
        this.history.set([]);
    }
}
