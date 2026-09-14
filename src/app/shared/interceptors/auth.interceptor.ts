import { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { AUTH_TOKEN_KEY, API_BASE_URL } from '../constants/api.constants';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const platformId = inject(PLATFORM_ID);
    
    // Only intercept requests going to our own backend API
    if (isPlatformBrowser(platformId) && req.url.startsWith(API_BASE_URL)) {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (token) {
            req = req.clone({
                setHeaders: {
                    Authorization: `Bearer ${token}`
                }
            });
        }
    }
    return next(req);
};
