import { Injectable, signal, effect, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);

    isDarkMode = signal<boolean>(true);

    constructor() {
        if (this.isBrowser) {
            // Load theme preference from localStorage
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme) {
                this.isDarkMode.set(savedTheme === 'dark');
            }

            // Apply theme whenever it changes
            effect(() => {
                const theme = this.isDarkMode() ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', theme);
                localStorage.setItem('theme', theme);
            });
        }
    }

    toggleTheme(): void {
        this.isDarkMode.update(current => !current);
    }
}

