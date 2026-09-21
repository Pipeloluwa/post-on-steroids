import { HttpInterceptorFn } from '@angular/common/http';
import { generateUUID } from '../utils/uuid.util';

function generateRequestId(): string {
    return generateUUID();
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
