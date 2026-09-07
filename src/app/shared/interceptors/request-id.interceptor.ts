import { HttpInterceptorFn } from '@angular/common/http';

function generateRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

export const requestIdInterceptor: HttpInterceptorFn = (req, next) => {
    const existingId = req.headers.get('X-Request-ID');
    const requestId = existingId || generateRequestId();

    const cloned = req.clone({
        setHeaders: {
            'X-Request-ID': requestId
        }
    });

    return next(cloned);
};
