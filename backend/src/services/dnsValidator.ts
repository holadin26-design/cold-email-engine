/**
 * Enhanced DNS Validator
 * Fetches MX records using a parallel race across multiple DNS-over-HTTPS providers.
 * Whichever responds first wins — typically < 200ms.
 */

export interface MXRecord {
    priority: number;
    host: string;
}

export interface DNSValidationResult {
    valid: boolean;
    mxRecords: string[];
    allRecords?: MXRecord[];
    error?: string;
}

export class DNSValidator {
    // Cache: 10-min TTL for hits, 60s for misses
    private static cache = new Map<string, { result: DNSValidationResult; expires: number }>();

    /**
     * Validate domain and get MX records.
     * Races Cloudflare, Google, and Quad9 DNS-over-HTTPS in parallel — fastest wins.
     */
    public static async validateDomain(domain: string): Promise<DNSValidationResult> {
        const cleanDomain = domain
            .toLowerCase()
            .trim()
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')
            .replace(/^www\./, '');

        if (!cleanDomain || !cleanDomain.includes('.')) {
            return { valid: false, mxRecords: [], error: 'Invalid domain format' };
        }

        const cached = this.cache.get(cleanDomain);
        if (cached && cached.expires > Date.now()) {
            return cached.result;
        }

        // Race all three providers — use the first successful response
        const result = await this.raceDNSProviders(cleanDomain);

        const ttl = result.valid
            ? 10 * 60 * 1000  // 10 minutes for valid domains
            : 60 * 1000;      // 60 seconds for failures

        this.cache.set(cleanDomain, { result, expires: Date.now() + ttl });
        return result;
    }

    private static async raceDNSProviders(domain: string): Promise<DNSValidationResult> {
        const providers = [
            this.queryCloudflare(domain),
            this.queryGoogle(domain),
            this.queryQuad9(domain),
        ];

        // Return first successful (valid) result; if all fail return last error
        return new Promise(async (resolve) => {
            let failures = 0;
            let lastFailed: DNSValidationResult = { valid: false, mxRecords: [] };

            for (const p of providers) {
                p.then((result) => {
                    if (result.valid) resolve(result);
                    else {
                        lastFailed = result;
                        failures++;
                        if (failures === providers.length) {
                            resolve({ valid: false, mxRecords: [], error: 'Failed to retrieve MX records from all DNS providers' });
                        }
                    }
                }).catch(() => {
                    failures++;
                    if (failures === providers.length) {
                        resolve({ valid: false, mxRecords: [], error: 'DNS query error from all providers' });
                    }
                });
            }
        });
    }

    private static async queryCloudflare(domain: string): Promise<DNSValidationResult> {
        try {
            const res = await fetch(
                `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
                { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) }
            );
            if (!res.ok) return { valid: false, mxRecords: [] };
            const data = (await res.json()) as any;
            if (data.Status !== 0 || !data.Answer || data.Answer.length === 0) return { valid: false, mxRecords: [] };
            return this.parseAnswers(data.Answer);
        } catch {
            return { valid: false, mxRecords: [] };
        }
    }

    private static async queryGoogle(domain: string): Promise<DNSValidationResult> {
        try {
            const res = await fetch(
                `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
                { signal: AbortSignal.timeout(4000) }
            );
            if (!res.ok) return { valid: false, mxRecords: [] };
            const data = (await res.json()) as any;
            if (data.Status !== 0 || !data.Answer || data.Answer.length === 0) return { valid: false, mxRecords: [] };
            return this.parseAnswers(data.Answer);
        } catch {
            return { valid: false, mxRecords: [] };
        }
    }

    private static async queryQuad9(domain: string): Promise<DNSValidationResult> {
        try {
            const res = await fetch(
                `https://dns.quad9.net/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
                { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) }
            );
            if (!res.ok) return { valid: false, mxRecords: [] };
            const data = (await res.json()) as any;
            if (data.Status !== 0 || !data.Answer || data.Answer.length === 0) return { valid: false, mxRecords: [] };
            return this.parseAnswers(data.Answer);
        } catch {
            return { valid: false, mxRecords: [] };
        }
    }

    private static parseAnswers(answers: any[]): DNSValidationResult {
        const mxRecords: MXRecord[] = answers
            .filter((a: any) => a.type === 15)
            .map((a: any) => {
                try {
                    const parts = a.data.trim().split(/\s+/);
                    const priority = parseInt(parts[0]);
                    const host = parts[1].replace(/\.$/, '');
                    return { priority, host };
                } catch {
                    return null;
                }
            })
            .filter((r: any): r is MXRecord => r !== null)
            .sort((a, b) => a.priority - b.priority);

        if (mxRecords.length === 0) return { valid: false, mxRecords: [], allRecords: [] };

        return { valid: true, mxRecords: mxRecords.map(r => r.host), allRecords: mxRecords };
    }

    public static async getMXRecords(domain: string): Promise<MXRecord[]> {
        const result = await this.validateDomain(domain);
        return result.allRecords || [];
    }

    public static async validateDomainExists(domain: string): Promise<boolean> {
        try {
            const res = await fetch(
                `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
                { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) }
            );
            if (!res.ok) return false;
            const data = (await res.json()) as any;
            if (data.Status === 3) return false;
            return data.Status === 0 && data.Answer && data.Answer.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Batch validate multiple domains in parallel with concurrency limit
     */
    public static async validateMultipleDomains(domains: string[]): Promise<Map<string, DNSValidationResult>> {
        const results = new Map<string, DNSValidationResult>();
        const CONCURRENCY = 40; // Higher — DNS over HTTPS is lightweight
        const domainsToProcess = [...domains];
        const active = new Set<Promise<void>>();

        for (const domain of domainsToProcess) {
            const promise = (async () => {
                results.set(domain, await this.validateDomain(domain));
            })();

            active.add(promise);
            promise.finally(() => active.delete(promise));

            if (active.size >= CONCURRENCY) await Promise.race(active);
        }

        await Promise.all(active);
        return results;
    }
}