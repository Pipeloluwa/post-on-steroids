import { RouteReuseStrategy, DetachedRouteHandle, ActivatedRouteSnapshot } from '@angular/router';

export class CustomRouteReuseStrategy implements RouteReuseStrategy {
    private handlers: { [key: string]: DetachedRouteHandle } = {};

    shouldDetach(route: ActivatedRouteSnapshot): boolean {
        // Only detach and store the 'steroid' route (WorkspaceComponent)
        return route.routeConfig?.path === 'steroid';
    }

    store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle): void {
        if (route.routeConfig?.path) {
            this.handlers[route.routeConfig.path] = handle;
        }
    }

    shouldAttach(route: ActivatedRouteSnapshot): boolean {
        return !!route.routeConfig?.path && !!this.handlers[route.routeConfig.path];
    }

    retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
        if (!route.routeConfig?.path) return null;
        return this.handlers[route.routeConfig.path];
    }

    shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
        return future.routeConfig === curr.routeConfig;
    }
}
