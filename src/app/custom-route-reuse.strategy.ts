import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouteReuseStrategy, DetachedRouteHandle, ActivatedRouteSnapshot } from '@angular/router';
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from './shared/constants/api.constants';
import { APP_EDITION } from '../environments/edition';

export class CustomRouteReuseStrategy implements RouteReuseStrategy {
    private platformId = inject(PLATFORM_ID);
    private isBrowser = isPlatformBrowser(this.platformId);
    private handlers: { [key: string]: DetachedRouteHandle } = {};

    private isAccessAllowed(): boolean {
        if (!APP_EDITION.isProOrHigher) return true;
        if (!this.isBrowser) return false;
        const hasSession = !!(localStorage.getItem(AUTH_TOKEN_KEY) && localStorage.getItem(AUTH_USER_KEY));
        if (hasSession) return true;
        this.handlers = {};
        return false;
    }

    shouldDetach(route: ActivatedRouteSnapshot): boolean {
        if (!this.isAccessAllowed()) return false;
        // Only detach and store the main workspace route (WorkspaceComponent)
        return route.routeConfig?.path === '' || route.routeConfig?.path === 'steroid';
    }

    store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle): void {
        if (!this.isAccessAllowed()) return;
        if (route.routeConfig?.path !== undefined) {
            this.handlers[route.routeConfig.path] = handle;
        }
    }

    shouldAttach(route: ActivatedRouteSnapshot): boolean {
        if (!this.isAccessAllowed()) return false;
        return route.routeConfig?.path !== undefined && !!this.handlers[route.routeConfig.path];
    }

    retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
        if (!this.isAccessAllowed()) return null;
        if (route.routeConfig?.path === undefined) return null;
        return this.handlers[route.routeConfig.path];
    }

    shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
        if (!this.isAccessAllowed()) return false;
        return future.routeConfig === curr.routeConfig;
    }
}
