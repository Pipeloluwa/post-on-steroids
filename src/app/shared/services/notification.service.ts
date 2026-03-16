import { Injectable, signal } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    show = signal<boolean>(false);
    message = signal<string>('');

    notify(message: string) {
        this.message.set(message);
        this.show.set(true);
        setTimeout(() => this.show.set(false), 6000);
    }
}
