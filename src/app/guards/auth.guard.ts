import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthService } from '../shared/services/auth.service';
import { APP_EDITION } from '../../environments/edition';

function checkEditionAuthAccess() {
    if (!APP_EDITION.isProOrHigher) {
        return true;
    }
    const authService = inject(AuthService);
    const router = inject(Router);

    if (authService.isLoggedIn()) {
        return true;
    }

    return router.createUrlTree(['/login']);
}

export const authGuard: CanActivateFn = () => checkEditionAuthAccess();

export const authMatchGuard: CanMatchFn = () => checkEditionAuthAccess();
