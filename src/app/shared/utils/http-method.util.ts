/**
 * Resolves a theme-aware CSS color expression for an HTTP verb so badges and labels
 * stay high-contrast across both dark and light themes.
 */
export function getHttpMethodColor(method?: string | null): string {
    switch ((method || 'GET').toUpperCase()) {
        case 'GET':
            return 'var(--postonsteroids-method-get)';
        case 'POST':
            return 'var(--postonsteroids-method-post)';
        case 'PUT':
            return 'var(--postonsteroids-method-put)';
        case 'PATCH':
            return 'var(--postonsteroids-method-patch)';
        case 'DEL':
        case 'DELETE':
            return 'var(--postonsteroids-method-delete)';
        case 'HEAD':
            return 'var(--postonsteroids-method-head)';
        case 'OPT':
        case 'OPTIONS':
            return 'var(--postonsteroids-method-options)';
        default:
            return 'var(--postonsteroids-text-primary)';
    }
}
