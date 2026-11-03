/**
 * Determines whether a given URL points to localhost or a 127.x.x.x loopback address.
 *
 * Matches:
 * - localhost (e.g., http://localhost, http://localhost:3000, localhost:5000)
 * - subdomains of localhost (e.g., test.localhost)
 * - 127.x.x.x (e.g., http://127.0.0.1, http://127.0.0.1:8080, 127.1.2.3:3000)
 * - IPv6 loopback (e.g., http://[::1], http://[::1]:8080)
 */
export function isLocalhostOrLoopbackUrl(url: string | null | undefined): boolean {
    if (!url) return false;
    const trimmed = url.trim().toLowerCase();
    if (!trimmed) return false;

    try {
        const parsed = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
        const hostname = parsed.hostname.toLowerCase();
        return (
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname === '::1' ||
            hostname === '[::1]' ||
            /^127\.\d+\.\d+\.\d+$/.test(hostname)
        );
    } catch {
        return /(^|[/:@])(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)(:\d+)?([/?#]|$)/i.test(trimmed);
    }
}

/**
 * Resolves the full base URL where the application is hosted, preserving any subpath / subdirectory prefix
 * (e.g., https://www.privateweb.com/onsteroid or https://domain.com/tools/app).
 *
 * For example:
 * - Hosted at root: https://onsteroid.com -> https://onsteroid.com
 * - Hosted under subpath: https://www.privateweb.com/onsteroid -> https://www.privateweb.com/onsteroid
 * - Hosted with deeper path: https://example.com/apps/dev/onsteroid -> https://example.com/apps/dev/onsteroid
 * - Localhost dev server: http://localhost:4200 -> http://localhost:4200
 * - Electron / file protocol: file:///path/to/app -> http://localhost:5000
 */
export function getAppBaseUrl(): string {
    if (typeof window === 'undefined') return '';
    const isFile = window.location.protocol === 'file:' || window.location.origin.startsWith('file:');
    if (isFile) {
        return 'http://localhost:5000';
    }

    const origin = window.location.origin;
    let basePath = '';

    // 1. Check document.baseURI (respects <base href="..."> if set to a subpath)
    try {
        if (typeof document !== 'undefined' && document.baseURI) {
            const parsedBase = new URL(document.baseURI);
            const path = parsedBase.pathname.replace(/\/+$/, '');
            if (path && path !== '') {
                basePath = path;
            }
        }
    } catch { }

    // 2. If no subpath found from baseURI, check window.location.pathname
    if (!basePath) {
        const fullPath = window.location.pathname || '';
        // Known route segments in the Angular app
        const knownRoutes = ['capsules', 'export', 'import', 'utilities', 'history', 'login', 'workspace'];
        // Remove trailing index.html if present
        const cleanPath = fullPath.replace(/\/index\.html$/i, '');
        // Split path into segments
        const segments = cleanPath.split('/').filter(Boolean);
        // If the last segment is one of our known routes, strip it off
        if (segments.length > 0 && knownRoutes.includes(segments[segments.length - 1].toLowerCase())) {
            segments.pop();
        }
        if (segments.length > 0) {
            basePath = '/' + segments.join('/');
        }
    }

    basePath = basePath.replace(/\/+$/, '');
    return `${origin}${basePath}`;
}
