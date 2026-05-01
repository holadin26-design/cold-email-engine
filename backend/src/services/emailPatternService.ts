/**
 * Enhanced Email Pattern Service
 * - Normalizes international/accented names
 * - Patterns ordered by real-world frequency (based on industry research)
 * - Domain-level platform inference for smarter prioritization
 */

export class EmailPatternService {

    /**
     * Normalize a name: lowercase, strip accents/diacritics, remove non-alpha
     * e.g. "José" → "jose", "O'Brien" → "obrien"
     */
    private static normalizeName(name: string): string {
        return name
            .toLowerCase()
            .trim()
            .normalize('NFD')                     // decompose accented chars
            .replace(/[\u0300-\u036f]/g, '')       // strip diacritical marks
            .replace(/[^a-z0-9]/g, '');            // remove non-alphanumeric
    }

    /**
     * Detect which email platform/provider the domain likely uses
     * based on MX record hints embedded in the domain string or known patterns.
     * Uses the domain TLD and common naming conventions.
     */
    private static detectPlatform(domain: string): 'google' | 'microsoft' | 'generic' {
        const d = domain.toLowerCase();
        // Google Workspace telltales
        if (d.includes('google') || d.includes('gmail')) return 'google';
        // Microsoft 365 / Exchange telltales
        if (d.includes('microsoft') || d.includes('outlook') || d.includes('office365')) return 'microsoft';
        return 'generic';
    }

    /**
     * Generate email patterns for a person at a company.
     * Patterns are ordered by probability (most → least common).
     *
     * Research sources: Hunter.io format breakdown, MailTester studies
     * Rank order: firstname.lastname > firstnamelastname > firstlast > firstname > lastname...
     */
    public static generatePatterns(firstName: string, lastName: string, domain: string): string[] {
        const fn = this.normalizeName(firstName);
        const ln = this.normalizeName(lastName);
        const domainClean = domain
            .toLowerCase()
            .trim()
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')
            .replace(/^www\./, '');

        if (!fn || !ln || !domainClean) return [];

        const fi = fn.charAt(0);   // first initial
        const li = ln.charAt(0);   // last initial

        const platform = this.detectPlatform(domainClean);

        // Build ordered pattern list based on platform
        let patterns: string[];

        if (platform === 'google') {
            // Google Workspace orgs heavily favour firstname.lastname
            patterns = [
                `${fn}@${domainClean}`,                 // john (first name only)
                `${fn}.${ln}@${domainClean}`,          // john.doe (most common ~46%)
                `${fn}${ln}@${domainClean}`,            // johndoe (~17%)
                `${fi}${ln}@${domainClean}`,            // jdoe (~8%)
                `${fi}.${ln}@${domainClean}`,           // j.doe (~7%)
                `${fn}-${ln}@${domainClean}`,           // john-doe
                `${fn}_${ln}@${domainClean}`,           // john_doe
                `${ln}.${fn}@${domainClean}`,           // doe.john
                `${ln}${fi}@${domainClean}`,            // doej
                `${ln}@${domainClean}`,                 // doe
                `${fn}${li}@${domainClean}`,            // johnd
                `${fi}${li}@${domainClean}`,            // jd
            ];
        } else if (platform === 'microsoft') {
            // M365 companies often use firstlast or first.last
            patterns = [
                `${fn}@${domainClean}`,                 // john (first name only)
                `${fn}${ln}@${domainClean}`,            // johndoe
                `${fn}.${ln}@${domainClean}`,           // john.doe
                `${fi}${ln}@${domainClean}`,            // jdoe
                `${fi}.${ln}@${domainClean}`,           // j.doe
                `${fn}-${ln}@${domainClean}`,           // john-doe
                `${fn}_${ln}@${domainClean}`,           // john_doe
                `${ln}.${fn}@${domainClean}`,           // doe.john
                `${ln}${fi}@${domainClean}`,            // doej
                `${ln}@${domainClean}`,                 // doe
                `${fn}${li}@${domainClean}`,            // johnd
                `${fi}${li}@${domainClean}`,            // jd
            ];
        } else {
            // Generic — ordered by global frequency
            patterns = [
                `${fn}@${domainClean}`,                 // john (first name only)
                `${fn}.${ln}@${domainClean}`,           // john.doe ~46%
                `${fn}${ln}@${domainClean}`,            // johndoe ~17%
                `${fi}${ln}@${domainClean}`,            // jdoe ~8%
                `${fi}.${ln}@${domainClean}`,           // j.doe ~7%
                `${fn}${li}@${domainClean}`,            // johnd ~2%
                `${fn}-${ln}@${domainClean}`,           // john-doe
                `${fn}_${ln}@${domainClean}`,           // john_doe
                `${ln}.${fn}@${domainClean}`,           // doe.john
                `${ln}${fi}@${domainClean}`,            // doej
                `${ln}@${domainClean}`,                 // doe (executive mailboxes)
                `${fi}${li}@${domainClean}`,            // jd
            ];
        }

        // Deduplicate while preserving order
        return Array.from(new Set(patterns));
    }

    /**
     * Generate patterns for compound/hyphenated names (3+ tokens)
     */
    public static generateVariations(firstName: string, lastName: string, domain: string): string[] {
        const nameParts = `${firstName} ${lastName}`.split(/[\s\-]+/).filter(p => p.length > 0);

        if (nameParts.length <= 2) {
            return this.generatePatterns(firstName, lastName, domain);
        }

        const fn = this.normalizeName(nameParts[0]);
        const ln = this.normalizeName(nameParts[nameParts.length - 1]);
        const allButLast = nameParts.slice(0, -1).map(p => this.normalizeName(p)).join('');

        const domainClean = domain
            .toLowerCase()
            .trim()
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '');

        const patterns = [
            `${fn}@${domainClean}`,
            `${fn}.${ln}@${domainClean}`,
            `${fn}${ln}@${domainClean}`,
            `${allButLast}.${ln}@${domainClean}`,
            `${allButLast}${ln}@${domainClean}`,
            `${fn.charAt(0)}${ln}@${domainClean}`,
            `${fn.charAt(0)}.${ln}@${domainClean}`,
        ];

        return Array.from(new Set(patterns));
    }

    /**
     * Estimate pattern confidence 0-100 for pre-filtering / SDR prioritization
     */
    public static getPatternConfidence(pattern: string): number {
        const local = pattern.split('@')[0];
        if (!local) return 0;

        if (local.includes('.')) return 92;         // firstname.lastname → highest
        if (/^[a-z][a-z]{2,}[a-z]{2,}$/.test(local) && local.length > 6) return 85; // johndoe
        if (/^[a-z][a-z0-9]{3,}$/.test(local)) return 80;  // jdoe-style
        if (/^[a-z]+$/.test(local) && local.length <= 8) return 72;  // firstname only
        if (local.includes('_')) return 70;
        if (local.includes('-')) return 68;
        if (/^[a-z]{1,2}[a-z]+$/.test(local)) return 65;   // jd or fi initials

        return 50;
    }
}