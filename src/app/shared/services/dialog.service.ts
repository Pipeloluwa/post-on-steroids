import { Injectable, signal } from '@angular/core';

export interface DialogOptions {
    type: 'confirm' | 'prompt';
    title: string;
    message: string;
    defaultValue?: string;
    confirmText?: string;
    cancelText?: string;
    placeholder?: string;
}

@Injectable({
    providedIn: 'root'
})
export class DialogService {
    show = signal<boolean>(false);
    options = signal<DialogOptions | null>(null);
    promptValue = signal<string>('');
    
    private resolveFn: ((value: any) => void) | null = null;

    confirm(message: string, title: string = 'Confirm'): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            this.options.set({
                type: 'confirm',
                title,
                message,
                confirmText: 'Yes',
                cancelText: 'No'
            });
            this.resolveFn = resolve;
            this.show.set(true);
        });
    }

    prompt(message: string, defaultValue: string = '', title: string = 'Input Required', placeholder: string = 'Enter value'): Promise<string | null> {
        return new Promise<string | null>((resolve) => {
            this.options.set({
                type: 'prompt',
                title,
                message,
                defaultValue,
                placeholder,
                confirmText: 'OK',
                cancelText: 'Cancel'
            });
            this.promptValue.set(defaultValue);
            this.resolveFn = resolve;
            this.show.set(true);
        });
    }

    submit() {
        if (this.resolveFn) {
            if (this.options()?.type === 'confirm') {
                this.resolveFn(true);
            } else {
                this.resolveFn(this.promptValue());
            }
        }
        this.close();
    }

    cancel() {
        if (this.resolveFn) {
            if (this.options()?.type === 'confirm') {
                this.resolveFn(false);
            } else {
                this.resolveFn(null);
            }
        }
        this.close();
    }

    private close() {
        this.show.set(false);
        this.resolveFn = null;
    }
}
