import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { catchError, switchMap } from 'rxjs/operators';
import { throwError, from } from 'rxjs';
import { AUTH_TOKEN_KEY, API_BASE_URL } from '../constants/api.constants';
import { AuthService } from '../services/auth.service';

let isRefreshing = false;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const platformId = inject(PLATFORM_ID);
    const authService = inject(AuthService) as AuthService;
    
    // Only intercept requests going to our own backend API
    if (isPlatformBrowser(platformId) && req.url.startsWith(API_BASE_URL)) {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (token && !req.url.includes('/auth/refresh')) {
            req = req.clone({
                setHeaders: {
                    Authorization: `Bearer ${token}`
                }
            });
        }

        return next(req).pipe(
            catchError((error: HttpErrorResponse) => {
                if (error.status === 401 && !req.url.includes('/auth/refresh')) {
                    if (!isRefreshing) {
                        isRefreshing = true;
                        return from(authService.refreshTokens()).pipe(
                            switchMap((success) => {
                                isRefreshing = false;
                                if (success) {
                                    const newToken = localStorage.getItem(AUTH_TOKEN_KEY);
                                    const cloned = req.clone({
                                        setHeaders: {
                                            Authorization: `Bearer ${newToken}`
                                        }
                                    });
                                    return next(cloned);
                                } else {
                                    authService.logout();
                                    return throwError(() => error);
                                }
                            }),
                            catchError((refreshErr) => {
                                isRefreshing = false;
                                authService.logout();
                                return throwError(() => refreshErr);
                            })
                        );
                    }
                }
                return throwError(() => error);
            })
        );
    }
    return next(req);
};
