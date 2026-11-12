/**
 * Copies plain text to the system clipboard with a textarea fallback for non-secure contexts.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    if (typeof document === 'undefined') return false;
    try {
        if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // Fall through to execCommand fallback
    }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}
