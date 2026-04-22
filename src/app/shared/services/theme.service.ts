import { Injectable, signal, effect, inject, PLATFORM_ID, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
    providedIn: 'root'
})
export class ThemeService {
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);

    theme = signal<'light' | 'dark' | 'system'>('dark');
    isDarkMode = computed(() => {
        const t = this.theme();
        if (t === 'system') {
            if (!this.isBrowser) return true;
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        return t === 'dark';
    });

    constructor() {
        if (this.isBrowser) {
            // Load theme preference from localStorage
            const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'system';
            if (savedTheme) {
                this.theme.set(savedTheme);
            }

            // Apply theme whenever it changes
            effect(() => {
                const effectiveTheme = this.isDarkMode() ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', effectiveTheme);
                localStorage.setItem('theme', this.theme());
            });

            // Listen for system theme changes
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                if (this.theme() === 'system') {
                    // Trigger effect by re-setting same value or just rely on signal reactivity if computed
                    this.theme.set('system');
                }
            });
        }
    }

    setTheme(theme: 'light' | 'dark' | 'system'): void {
        this.theme.set(theme);
    }

    toggleTheme(): void {
        const current = this.theme();
        if (current === 'light') this.theme.set('dark');
        else if (current === 'dark') this.theme.set('system');
        else this.theme.set('light');
    }
}

