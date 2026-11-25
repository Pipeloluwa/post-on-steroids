import { HttpInterceptorFn, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { catchError, switchMap, finalize } from 'rxjs/operators';
import { throwError, from, of } from 'rxjs';
import { AUTH_TOKEN_KEY, API_BASE_URL } from '../constants/api.constants';
import { AuthService } from '../services/auth.service';
import { generateUUID } from '../utils/uuid.util';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const platformId = inject(PLATFORM_ID);
    const authService = inject(AuthService) as AuthService;
    
    // Only intercept requests going to our own backend API
    if (isPlatformBrowser(platformId) && req.url.startsWith(API_BASE_URL)) {
        if (authService.isTestUserSession()) {
            const singleItemUrl = req.url.includes('/WorkspaceState') || req.url.includes('/capsule/shared/');
            const listData = req.method === 'GET' && !singleItemUrl ? [] : null;
            let mockData: any = listData ?? (req.method === 'GET' ? null : (req.body ?? null));

            if (req.method !== 'GET' && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
                const bodyObj = req.body as Record<string, any>;
                if (req.url.includes('/import') && Array.isArray(bodyObj['capsules'])) {
                    const capsules = bodyObj['capsules'].map((c: any) => {
                        const capId = c.id || generateUUID();
                        return {
                            capsule: {
                                id: capId,
                                name: c.name || 'Imported Capsule',
                                autoAuthEnabled: c.autoAuthEnabled || 'off',
                                autoAuthEndpointId: c.autoAuthEndpointId || null,
                                createdAt: new Date().toISOString()
                            },
                            requests: (c.requests || []).map((r: any) => ({
                                ...r,
                                id: r.id || generateUUID(),
                                capsuleId: capId
                            })),
                            variables: c.variables || []
                        };
                    });
                    mockData = {
                        capsulesCount: capsules.length,
                        requestsCount: capsules.reduce((sum: number, item: any) => sum + (item.requests?.length || 0), 0),
                        capsules
                    };
                } else {
                    const nowIso = new Date().toISOString();
                    mockData = {
                        ...bodyObj,
                        id: bodyObj['id'] || generateUUID(),
                        createdAt: bodyObj['createdAt'] || nowIso,
                        updatedAt: nowIso
                    };
                }
            }

            return of(new HttpResponse({
                status: 200,
                body: {
                    title: 'Test Session',
                    responseCode: '01',
                    message: 'Handled locally for test user session',
                    data: mockData
                }
            }));
        }
        const isSaveOrUpdate = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.url.includes('/auth/');
        if (isSaveOrUpdate) {
            authService.startSaveRequest();
        }

        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        if (token && !req.url.includes('/auth/refresh')) {
            req = req.clone({
                setHeaders: {
                    Authorization: `Bearer ${token}`
                }
            });
        }

        return next(req).pipe(
            finalize(() => {
                if (isSaveOrUpdate) {
                    authService.endSaveRequest();
                }
            }),
            catchError((error: HttpErrorResponse) => {
                // If a backend request failed with 401 Unauthorized
                if (error.status === 401 && !req.url.includes('/auth/refresh') && !req.url.includes('/auth/logout')) {
                    if (authService.isLoggedIn() && !authService.isLoggingOut()) {
                        return from(authService.refreshTokens()).pipe(
                            switchMap((success) => {
                                if (success) {
                                    const newToken = localStorage.getItem(AUTH_TOKEN_KEY);
                                    const cloned = req.clone({
                                        setHeaders: {
                                            Authorization: `Bearer ${newToken}`
                                        }
                                    });
                                    return next(cloned);
                                } else {
                                    return throwError(() => error);
                                }
                            }),
                            catchError((refreshErr) => {
                                return throwError(() => refreshErr);
                            })
                        );
                    }
                } else if (req.url.includes('/auth/refresh') && (error.status === 401 || error.status === 400)) {
                    // Direct failure on the refresh endpoint (refresh token expired)
                    if (authService.isLoggedIn() && !authService.isLoggingOut()) {
                        authService.logout({ isSessionExpired: true });
                    }
                }
                return throwError(() => error);
            })
        );
    }
    return next(req);
};
