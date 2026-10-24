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
