import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { AUTH_TOKEN_KEY, API_BASE_URL } from '../constants/api.constants';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const platformId = inject(PLATFORM_ID);
    const authService = inject(AuthService) as AuthService;
    
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

        return next(req).pipe(
            catchError((error: HttpErrorResponse) => {
                if (error.status === 401) {
                    // Token expired or invalid, force logout
                    authService.logout();
                }
                return throwError(() => error);
            })
        );
    }
    return next(req);
};
