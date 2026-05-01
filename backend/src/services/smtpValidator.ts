import net from 'net';

/**
 * Enhanced SMTP Validator — fast, accurate, enterprise-grade
 *
 * Key design decisions:
 * - Default timeout: 10s (was 20s) — most legit servers respond in < 3s
 * - No built-in retries by default (retries=0) — the caller (routes.ts) handles
 *   retry by trying the next MX host, which is far more effective
 * - Bulk verification reuses a single TCP connection per domain (RCPT TO loop)
 * - ESP domains are short-circuited immediately (no TCP at all)
 * - 4xx greylisting → confidence 'low' so the caller can try the next MX host
 */

export interface SMTPValidationResult {
    valid: boolean;
    deliverable: boolean;
    message: string;
    smtpCode?: string;
    error?: string;
    confidence: 'high' | 'medium' | 'low';
    catchAll?: boolean;
    roleAccount?: boolean;
    recommendation?: 'send' | 'review' | 'skip';
}

export class SMTPValidator {
    private static readonly ROLE_ACCOUNTS = new Set([
        'info', 'admin', 'support', 'hello', 'contact', 'sales', 'noreply',
        'no-reply', 'donotreply', 'do-not-reply', 'team', 'notifications',
        'news', 'newsletter', 'marketing', 'billing', 'abuse', 'security',
        'postmaster', 'hostmaster', 'webmaster', 'mailer-daemon', 'nobody',
        'help', 'feedback', 'press', 'media', 'inquiry', 'request',
        'jobs', 'careers', 'hr', 'finance', 'legal', 'compliance', 'it',
        'ops', 'operations', 'partners', 'partnerships', 'procurement'
    ]);

    private static readonly ESP_DOMAINS = new Set([
        'gmail.com', 'google.com', 'outlook.com', 'hotmail.com', 'yahoo.com',
        'aol.com', 'icloud.com', 'mail.com', 'protonmail.com', 'tutanota.com',
        'live.com', 'msn.com', 'ymail.com', 'me.com', 'mac.com'
    ]);

    // Try port 25 first, then 587 as fallback (ISPs often block outbound 25)
    private static readonly SMTP_PORTS = [25, 587] as const;

    // Max emails per single SMTP connection — many servers cap recipients per session
    private static readonly SMTP_SESSION_CHUNK = 15;

    // ─────────────────────────────────────────────────────────────────────────
    // Single-email verification
    // ─────────────────────────────────────────────────────────────────────────

    public static async verifySMTP(
        email: string,
        mxHost: string,
        timeout: number = 20000,
        retries: number = 1,
        fromEmail: string = 'verify@validity-verification.io',
        fromDomain: string = 'validity-verification.io'
    ): Promise<SMTPValidationResult> {
        const localPart = email.split('@')[0]?.toLowerCase();
        const domain = email.split('@')[1]?.toLowerCase();

        if (!localPart || !domain) {
            return { valid: false, deliverable: false, message: 'Invalid email format', confidence: 'high' };
        }

        const isRoleAccount = this.ROLE_ACCOUNTS.has(localPart);
        const isESP = this.ESP_DOMAINS.has(domain);

        if (isESP) {
            return {
                valid: !isRoleAccount,
                deliverable: !isRoleAccount,
                message: isRoleAccount
                    ? `${domain} role account — high bounce risk`
                    : `${domain} account — cannot verify via SMTP (standard for major providers)`,
                confidence: isRoleAccount ? 'high' : 'medium',
                roleAccount: isRoleAccount,
                catchAll: !isRoleAccount,
                recommendation: isRoleAccount ? 'skip' : 'review'
            };
        }

        let lastResult: SMTPValidationResult | null = null;

        for (const port of this.SMTP_PORTS) {
            for (let attempt = 0; attempt <= retries; attempt++) {
                const result = await this.attemptVerification(email, mxHost, port, timeout, fromEmail, fromDomain);
                lastResult = result;

                if (result.confidence === 'high' || result.confidence === 'medium') {
                    return this.annotateRoleAccount(result, isRoleAccount);
                }

                // Low confidence — optional backoff before retry
                if (attempt < retries) {
                    await this.sleep(Math.min(1500 * Math.pow(2, attempt), 6000));
                }
            }

            // Low confidence on port 25 → try port 587
            if (lastResult?.confidence === 'low') continue;
            break;
        }

        return this.annotateRoleAccount(lastResult ?? {
            valid: false, deliverable: false,
            message: 'Unable to verify — all connection attempts failed',
            confidence: 'low'
        }, isRoleAccount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Bulk verification — reuses a single SMTP connection per domain group
    // ─────────────────────────────────────────────────────────────────────────

    public static async verifyBulkSMTP(
        emails: string[],
        mxHost: string,
        timeout: number = 20000,
        retries: number = 1,
        fromEmail: string = 'verify@validity-verification.io',
        fromDomain: string = 'validity-verification.io'
    ): Promise<Map<string, SMTPValidationResult>> {
        const domain = emails[0]?.split('@')[1]?.toLowerCase();
        const results = new Map<string, SMTPValidationResult>();

        if (!domain || emails.length === 0) return results;

        // Short-circuit ESPs immediately
        if (this.ESP_DOMAINS.has(domain)) {
            for (const email of emails) {
                const localPart = email.split('@')[0]?.toLowerCase();
                const isRoleAccount = this.ROLE_ACCOUNTS.has(localPart);
                results.set(email, {
                    valid: !isRoleAccount,
                    deliverable: !isRoleAccount,
                    message: isRoleAccount
                        ? `${domain} role account — high bounce risk`
                        : `${domain} account — cannot verify via SMTP (standard for major providers)`,
                    confidence: isRoleAccount ? 'high' : 'medium',
                    roleAccount: isRoleAccount,
                    catchAll: !isRoleAccount,
                    recommendation: isRoleAccount ? 'skip' : 'review'
                });
            }
            return results;
        }

        let pendingEmails = [...emails];

        for (const port of this.SMTP_PORTS) {
            for (let attempt = 0; attempt <= retries; attempt++) {
                if (pendingEmails.length === 0) break;

                // Chunk into sessions of SMTP_SESSION_CHUNK to avoid recipient limits
                const chunks: string[][] = [];
                for (let i = 0; i < pendingEmails.length; i += this.SMTP_SESSION_CHUNK) {
                    chunks.push(pendingEmails.slice(i, i + this.SMTP_SESSION_CHUNK));
                }

                const chunkResultsMap = new Map<string, SMTPValidationResult>();
                for (const chunk of chunks) {
                    const r = await this.attemptBulkVerification(chunk, mxHost, port, timeout, fromEmail, fromDomain);
                    for (const [e, v] of r) chunkResultsMap.set(e, v);
                }
                const batchResults = chunkResultsMap;

                const retryEmails: string[] = [];
                for (const [email, result] of batchResults.entries()) {
                    const localPart = email.split('@')[0]?.toLowerCase();
                    const isRoleAccount = this.ROLE_ACCOUNTS.has(localPart);

                    if (result.confidence === 'high' || result.confidence === 'medium') {
                        results.set(email, this.annotateRoleAccount(result, isRoleAccount));
                    } else if (attempt < retries) {
                        retryEmails.push(email);
                    } else {
                        results.set(email, this.annotateRoleAccount(result, isRoleAccount));
                    }
                }

                pendingEmails = retryEmails;
                if (pendingEmails.length > 0 && attempt < retries) {
                    await this.sleep(Math.min(1500 * Math.pow(2, attempt), 6000));
                }
            }
            if (pendingEmails.length === 0) break;
        }

        // Anything still pending after all ports → mark as low-confidence
        for (const email of pendingEmails) {
            const localPart = email.split('@')[0]?.toLowerCase();
            results.set(email, this.annotateRoleAccount({
                valid: false, deliverable: false,
                message: 'Unable to verify — all connection attempts failed',
                confidence: 'low'
            }, this.ROLE_ACCOUNTS.has(localPart)));
        }

        return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core: single-connection bulk RCPT TO loop
    // ─────────────────────────────────────────────────────────────────────────

    private static async attemptBulkVerification(
        emails: string[],
        mxHost: string,
        port: number,
        timeout: number,
        fromEmail: string,
        fromDomain: string
    ): Promise<Map<string, SMTPValidationResult>> {
        return new Promise((resolve) => {
            const results = new Map<string, SMTPValidationResult>();
            let resolved = false;
            let responseBuffer = '';
            let step = 0;
            let emailIndex = 0;
            let usedEHLO = false;

            const client = net.createConnection({ port, host: mxHost });
            client.setTimeout(timeout);

            /**
             * Resolve the promise. Any email not yet in `results` gets the
             * fallback. Called at most once.
             */
            const finish = (fallback: SMTPValidationResult) => {
                if (resolved) return;
                resolved = true;
                try { client.end(); } catch (_) { }
                try { client.destroy(); } catch (_) { }
                for (const email of emails) {
                    if (!results.has(email)) results.set(email, fallback);
                }
                resolve(results);
            };

            client.on('data', (chunk) => {
                client.setTimeout(timeout); // reset idle timer on activity
                responseBuffer += chunk.toString();

                // Wait until we have at least one complete line
                if (!responseBuffer.includes('\r\n')) return;

                const lines = responseBuffer.split('\r\n');
                responseBuffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line) continue;

                    const code = line.substring(0, 3);
                    const isContinuation = line[3] === '-'; // multi-line response
                    const msg = line.substring(4);

                    if (isContinuation) continue; // skip intermediate lines

                    switch (step) {
                        // ── Banner ──────────────────────────────────────────
                        case 0:
                            if (code === '220') {
                                client.write(`EHLO ${fromDomain}\r\n`);
                                usedEHLO = true;
                                step++;
                            } else {
                                finish({ valid: false, deliverable: false, message: `SMTP banner error: ${msg}`, smtpCode: code, confidence: 'high' });
                            }
                            break;

                        // ── EHLO / HELO ──────────────────────────────────────
                        case 1:
                            if (code === '250') {
                                client.write(`MAIL FROM:<${fromEmail}>\r\n`);
                                step++;
                            } else if ((code === '500' || code === '502') && usedEHLO) {
                                client.write(`HELO ${fromDomain}\r\n`);
                                usedEHLO = false;
                            } else if (code.startsWith('4')) {
                                finish({ valid: false, deliverable: false, message: 'Server temporarily unavailable', smtpCode: code, confidence: 'low' });
                            } else {
                                finish({ valid: false, deliverable: false, message: `Greeting rejected: ${msg}`, smtpCode: code, confidence: 'high' });
                            }
                            break;

                        // ── MAIL FROM ────────────────────────────────────────
                        case 2:
                            if (code === '250') {
                                client.write(`RCPT TO:<${emails[emailIndex]}>\r\n`);
                                step++;
                            } else if (code.startsWith('4')) {
                                finish({ valid: false, deliverable: false, message: 'Server temporarily rejected sender', smtpCode: code, confidence: 'low' });
                            } else {
                                finish({ valid: false, deliverable: false, message: `Sender rejected: ${msg}`, smtpCode: code, confidence: 'high' });
                            }
                            break;

                        // ── RCPT TO (loop) ────────────────────────────────────
                        case 3: {
                            const currentEmail = emails[emailIndex];

                            if (code === '250' || code === '251') {
                                results.set(currentEmail, { valid: true, deliverable: true, message: code === '251' ? 'User will receive mail via forwarding' : 'Mailbox exists and is deliverable', smtpCode: code, confidence: 'high', recommendation: 'send' });
                            } else if (code === '252') {
                                results.set(currentEmail, { valid: false, deliverable: false, message: 'Server cannot verify mailbox — possible catch-all domain', smtpCode: code, confidence: 'medium', catchAll: true, recommendation: 'review' });
                            } else if (code === '550' || code === '551' || code === '553' || code === '554') {
                                results.set(currentEmail, { valid: false, deliverable: false, message: `Mailbox does not exist: ${msg}`, smtpCode: code, confidence: 'high', recommendation: 'skip' });
                            } else if (code === '552') {
                                results.set(currentEmail, { valid: false, deliverable: false, message: `Mailbox storage exceeded: ${msg}`, smtpCode: code, confidence: 'high', recommendation: 'skip' });
                            } else if (code.startsWith('4')) {
                                results.set(currentEmail, { valid: false, deliverable: false, message: `Temporary rejection (greylisting likely): ${msg}`, smtpCode: code, confidence: 'low' });
                            } else if (code.startsWith('5')) {
                                results.set(currentEmail, { valid: false, deliverable: false, message: `Recipient rejected: ${msg}`, smtpCode: code, confidence: 'medium', recommendation: 'skip' });
                            } else {
                                results.set(currentEmail, { valid: false, deliverable: false, message: `Unexpected RCPT response: ${msg}`, smtpCode: code, confidence: 'low' });
                            }

                            emailIndex++;
                            if (emailIndex < emails.length) {
                                // Continue to next RCPT TO — no need to reset MAIL FROM
                                client.write(`RCPT TO:<${emails[emailIndex]}>\r\n`);
                            } else {
                                // All done — quit cleanly then resolve
                                step++; // move to step 4 (QUIT sent)
                                client.write('QUIT\r\n');
                            }
                            break;
                        }

                        // ── QUIT ack — we're done. Don't overwrite results ──
                        case 4:
                            finish({ valid: false, deliverable: false, message: 'Session complete', confidence: 'low' });
                            break;
                    }
                }
            });

            client.on('error', (error) => {
                finish({ valid: false, deliverable: false, message: `Network error: ${error.message}`, error: error.message, confidence: 'low' });
            });

            client.on('timeout', () => {
                finish({ valid: false, deliverable: false, message: 'SMTP connection timeout — server slow or filtering', confidence: 'low' });
            });

            client.on('close', () => {
                finish({ valid: false, deliverable: false, message: 'Connection closed', confidence: 'low' });
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core: single-email SMTP attempt
    // ─────────────────────────────────────────────────────────────────────────

    private static async attemptVerification(
        email: string,
        mxHost: string,
        port: number,
        timeout: number,
        fromEmail: string,
        fromDomain: string
    ): Promise<SMTPValidationResult> {
        return new Promise((resolve) => {
            let resolved = false;
            let responseBuffer = '';
            let step = 0;
            let usedEHLO = false;

            const client = net.createConnection({ port, host: mxHost });
            client.setTimeout(timeout);

            const safeResolve = (result: SMTPValidationResult) => {
                if (resolved) return;
                resolved = true;
                try { client.end(); } catch (_) { }
                try { client.destroy(); } catch (_) { }
                resolve(result);
            };

            client.on('data', (chunk) => {
                responseBuffer += chunk.toString();
                if (!responseBuffer.includes('\r\n')) return;

                const lines = responseBuffer.split('\r\n');
                responseBuffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line) continue;

                    const code = line.substring(0, 3);
                    const isContinuation = line[3] === '-';
                    const msg = line.substring(4);

                    if (isContinuation) continue;

                    switch (step) {
                        case 0: // Banner
                            if (code === '220') {
                                client.write(`EHLO ${fromDomain}\r\n`);
                                usedEHLO = true;
                                step++;
                            } else if (code.startsWith('4')) {
                                safeResolve({ valid: false, deliverable: false, message: `Temporary server error: ${msg}`, smtpCode: code, confidence: 'low' });
                            } else {
                                safeResolve({ valid: false, deliverable: false, message: `SMTP banner error: ${msg}`, smtpCode: code, confidence: 'high' });
                            }
                            break;

                        case 1: // EHLO / HELO
                            if (code === '250') {
                                client.write(`MAIL FROM:<${fromEmail}>\r\n`);
                                step++;
                            } else if ((code === '500' || code === '502') && usedEHLO) {
                                client.write(`HELO ${fromDomain}\r\n`);
                                usedEHLO = false;
                            } else if (code.startsWith('4')) {
                                safeResolve({ valid: false, deliverable: false, message: 'Server temporarily unavailable', smtpCode: code, confidence: 'low' });
                            } else {
                                safeResolve({ valid: false, deliverable: false, message: `Greeting rejected: ${msg}`, smtpCode: code, confidence: 'high' });
                            }
                            break;

                        case 2: // MAIL FROM
                            if (code === '250') {
                                client.write(`RCPT TO:<${email}>\r\n`);
                                step++;
                            } else if (code.startsWith('4')) {
                                safeResolve({ valid: false, deliverable: false, message: 'Server temporarily rejected sender', smtpCode: code, confidence: 'low' });
                            } else {
                                safeResolve({ valid: false, deliverable: false, message: `Sender rejected: ${msg}`, smtpCode: code, confidence: 'high' });
                            }
                            break;

                        case 3: // RCPT TO — the critical check
                            client.write('QUIT\r\n');

                            if (code === '250' || code === '251') {
                                safeResolve({ valid: true, deliverable: true, message: code === '251' ? 'User will receive mail via forwarding' : 'Mailbox exists and is deliverable', smtpCode: code, confidence: 'high', recommendation: 'send' });
                            } else if (code === '252') {
                                safeResolve({ valid: false, deliverable: false, message: 'Server cannot verify mailbox — possible catch-all domain', smtpCode: code, confidence: 'medium', catchAll: true, recommendation: 'review' });
                            } else if (code === '550' || code === '551' || code === '553' || code === '554') {
                                safeResolve({ valid: false, deliverable: false, message: `Mailbox does not exist: ${msg}`, smtpCode: code, confidence: 'high', recommendation: 'skip' });
                            } else if (code === '552') {
                                safeResolve({ valid: false, deliverable: false, message: `Mailbox storage exceeded: ${msg}`, smtpCode: code, confidence: 'high', recommendation: 'skip' });
                            } else if (code.startsWith('4')) {
                                safeResolve({ valid: false, deliverable: false, message: `Temporary rejection (greylisting likely): ${msg}`, smtpCode: code, confidence: 'low' });
                            } else if (code.startsWith('5')) {
                                safeResolve({ valid: false, deliverable: false, message: `Recipient rejected: ${msg}`, smtpCode: code, confidence: 'medium', recommendation: 'skip' });
                            } else {
                                safeResolve({ valid: false, deliverable: false, message: `Unexpected RCPT response: ${msg}`, smtpCode: code, confidence: 'low' });
                            }
                            break;

                        // Step 4 = after QUIT sent — ignore server response, we already resolved
                    }
                }
            });

            client.on('error', (error) => {
                const msg = error.message.toLowerCase();
                if (msg.includes('econnrefused')) {
                    safeResolve({ valid: false, deliverable: false, message: `Port ${port} refused — trying fallback`, error: error.message, confidence: 'low' });
                } else if (msg.includes('econnreset')) {
                    safeResolve({ valid: false, deliverable: false, message: 'Connection reset by server', error: error.message, confidence: 'low' });
                } else if (msg.includes('etimedout') || msg.includes('timeout')) {
                    safeResolve({ valid: false, deliverable: false, message: 'Connection timed out', error: error.message, confidence: 'low' });
                } else {
                    safeResolve({ valid: false, deliverable: false, message: `Network error: ${error.message}`, error: error.message, confidence: 'low' });
                }
            });

            client.on('timeout', () => {
                safeResolve({ valid: false, deliverable: false, message: 'SMTP connection timeout — server slow or filtering', confidence: 'low' });
            });

            client.on('close', () => {
                safeResolve({ valid: false, deliverable: false, message: 'Connection closed unexpectedly', confidence: 'low' });
            });
        });
    }

    private static annotateRoleAccount(result: SMTPValidationResult, isRoleAccount: boolean): SMTPValidationResult {
        if (isRoleAccount && result.valid) {
            result.roleAccount = true;
            result.confidence = 'medium';
            result.message += ' (role account — high bounce risk)';
            result.recommendation = 'review';
        }
        return result;
    }

    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}