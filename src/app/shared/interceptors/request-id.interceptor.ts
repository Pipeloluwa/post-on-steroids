import { HttpInterceptorFn } from '@angular/common/http';
import { timeout } from 'rxjs';
import { generateUUID } from '../utils/uuid.util';
import { getGlobalRequestTimeoutMs } from '../utils/request-timeout.util';

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

    const timeoutMs = getGlobalRequestTimeoutMs();
    return timeoutMs > 0 ? next(cloned).pipe(timeout(timeoutMs)) : next(cloned);
};
