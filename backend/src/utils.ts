/**
 * Extracts the raw email address from a string that might contain a display name.
 * e.g. "John Doe <john@example.com>" -> "john@example.com"
 */
export function extractEmail(raw: string): string {
    if (!raw) return "";
    const match = raw.match(/<(.+?)>/);
    if (match) return match[1].trim();
    const plain = raw.match(/[\w.-]+@[\w.-]+\.\w+/);
    return plain ? plain[0].trim() : raw.trim();
}
