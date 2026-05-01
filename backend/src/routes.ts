import { Router } from "express";
import { supabase } from "./supabase";
import { checkReplies } from "./replyChecker";
import { DNSValidator } from "./services/dnsValidator";
import { SMTPValidator } from "./services/smtpValidator";
import { EmailPatternService } from "./services/emailPatternService";
import { runWarmupForUser } from "./services/warmup/engine";

export const apiRouter = Router();

// Middleware to get user_id from headers
const getUserId = (req: any) => req.headers["x-user-id"] || '71e1f783-95a2-463b-ac32-26e07c0a82ca';

async function fetchAllLeadsStatuses(campaignIds: string[]) {
    if (!campaignIds || campaignIds.length === 0) return [];
    let allLeads: { campaign_id: string, status: string }[] = [];
    let from = 0;
    while (true) {
        const { data: leadsPage, error } = await supabase
            .from("leads")
            .select("campaign_id, status")
            .in("campaign_id", campaignIds)
            .range(from, from + 999);

        if (error) throw error;

        if (leadsPage && leadsPage.length > 0) {
            allLeads.push(...leadsPage);
            if (leadsPage.length < 1000) break;
            from += 1000;
        } else {
            break;
        }
    }
    return allLeads;
}

apiRouter.get("/accounts", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { data: accounts, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("user_id", userId);

    if (error) return res.status(500).json({ error: error.message });

    // Check for resets (24 hours after limit reached)
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

    for (const acc of accounts) {
        if (acc.limit_reached_at) {
            const reachedAt = new Date(acc.limit_reached_at).getTime();
            if (reachedAt <= twentyFourHoursAgo) {
                await supabase
                    .from("accounts")
                    .update({ sends_today: 0, limit_reached_at: null })
                    .eq("id", acc.id);
                acc.sends_today = 0;
                acc.limit_reached_at = null;
            }
        }
    }

    res.json(accounts);
});

apiRouter.post("/accounts", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { email, display_name, app_password, smtp_host, smtp_port, imap_host, imap_port, daily_send_limit } = req.body;

    const { error } = await supabase
        .from("accounts")
        .insert([{
            user_id: userId,
            email,
            display_name,
            app_password,
            smtp_host,
            smtp_port,
            imap_host,
            imap_port,
            daily_send_limit,
            last_reset_at: new Date().toISOString().split('T')[0]
        }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

apiRouter.delete("/accounts/:id", async (req, res) => {
    const userId = getUserId(req);
    const { error } = await supabase
        .from("accounts")
        .delete()
        .eq("id", req.params.id)
        .eq("user_id", userId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

apiRouter.patch("/accounts/:id/limit", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { limit } = req.body;
    if (typeof limit !== "number" || limit < 0) {
        return res.status(400).json({ error: "Invalid limit value" });
    }

    const { error } = await supabase
        .from("accounts")
        .update({ daily_send_limit: limit })
        .eq("id", req.params.id)
        .eq("user_id", userId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

apiRouter.patch("/accounts/:id/campaign-sending", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { enabled } = req.body;

    const { error } = await supabase
        .from("accounts")
        .update({ allow_campaign_sending: enabled })
        .eq("id", req.params.id)
        .eq("user_id", userId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ── Finder Routes ──
apiRouter.post("/finder/patterns", async (req, res) => {
    const { firstName, lastName, domain } = req.body;
    if (!firstName || !lastName || !domain) return res.status(400).json({ error: "Missing fields" });
    const patterns = EmailPatternService.generatePatterns(firstName, lastName, domain);
    res.json({ patterns });
});

apiRouter.post("/finder/verify", async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ status: "invalid", message: "Email is required" });

        const domain = email.split("@")[1];
        if (!domain) return res.status(400).json({ status: "invalid", message: "Invalid email format" });

        const dnsResult = await DNSValidator.validateDomain(domain);

        if (!dnsResult.valid || dnsResult.mxRecords.length === 0) {
            return res.json({ status: "invalid", message: "Domain has no MX records — emails cannot be delivered here", confidence: "high" });
        }

        // Try each MX host in priority order until we get a high/medium-confidence result
        let lastResult: any = null;

        for (const mxHost of dnsResult.mxRecords) {
            try {
                const result = await SMTPValidator.verifySMTP(email, mxHost);
                lastResult = result;

                // Got a clear answer — return it
                if (result.confidence === 'high' || result.confidence === 'medium') {
                    const status = result.deliverable
                        ? 'valid'
                        : result.catchAll
                            ? 'risky'
                            : result.confidence === 'medium'
                                ? 'risky'
                                : 'invalid';

                    return res.json({
                        status,
                        message: result.message,
                        confidence: result.confidence,
                        recommendation: result.recommendation,
                        catchAll: result.catchAll,
                        roleAccount: result.roleAccount,
                        smtpCode: result.smtpCode
                    });
                }
                // Low confidence — try next MX host
            } catch (smtpErr: any) {
                console.warn(`[Finder] SMTP failed for ${mxHost}:`, smtpErr.message);
            }
        }

        // All MX hosts returned low confidence (timeouts, greylisting, etc.)
        return res.json({
            status: 'risky',
            message: lastResult?.message || 'Domain verified but mailbox could not be confirmed (SMTP filtered)',
            confidence: 'low',
            recommendation: 'review'
        });

    } catch (error: any) {
        res.status(500).json({ status: "error", message: error.message });
    }
});

apiRouter.post("/finder/verify-bulk", async (req, res) => {
    try {
        const { emails } = req.body;
        if (!emails || !Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ error: "An array of emails is required" });
        }

        // Hard cap to prevent runaway jobs
        const MAX_EMAILS = 500;
        const emailList: string[] = emails.slice(0, MAX_EMAILS);

        // Filter out malformed entries upfront so SMTP never sees them
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const validEmails = emailList.filter(e => typeof e === 'string' && EMAIL_RE.test(e.trim()));
        const invalidUpfront = emailList.filter(e => !validEmails.includes(e));

        const allResults = new Map<string, any>();

        // Mark clearly-malformed addresses right away
        for (const email of invalidUpfront) {
            allResults.set(email, { email, status: 'invalid', message: 'Invalid email format', confidence: 'high' });
        }

        // Group emails by domain for optimized, domain-aware processing
        const domainGroups = new Map<string, string[]>();
        for (const email of validEmails) {
            const domain = email.split('@')[1]?.toLowerCase();
            if (domain) {
                if (!domainGroups.has(domain)) domainGroups.set(domain, []);
                domainGroups.get(domain)!.push(email);
            }
        }

        // Process domain groups with controlled concurrency
        const DOMAIN_CONCURRENCY = 5; 
        const activeDomains = new Set<Promise<void>>();

        for (const [domain, emailsInDomain] of domainGroups.entries()) {
            const domainTask = (async () => {
                const dnsResult = await DNSValidator.validateDomain(domain);

                if (!dnsResult.valid || dnsResult.mxRecords.length === 0) {
                    for (const email of emailsInDomain) {
                        allResults.set(email, { email, status: 'invalid', message: 'Domain has no MX records', confidence: 'high' });
                    }
                    return;
                }

                // Try verifyBulkSMTP with the best MX record first
                // If it fails with low confidence, we can potentially try the next MX in a more complex version
                const mxHost = dnsResult.mxRecords[0];
                try {
                    const batchResults = await SMTPValidator.verifyBulkSMTP(emailsInDomain, mxHost);
                    for (const [email, result] of batchResults.entries()) {
                        const status = result.deliverable
                            ? 'valid'
                            : result.catchAll
                                ? 'risky'
                                : result.confidence === 'medium'
                                    ? 'risky'
                                    : 'invalid';

                        allResults.set(email, {
                            email, status,
                            message: result.message,
                            confidence: result.confidence,
                            recommendation: result.recommendation
                        });
                    }
                } catch (err) {
                    // Fallback to individual checks or mark as risky
                    for (const email of emailsInDomain) {
                        allResults.set(email, { email, status: 'risky', message: 'Bulk verification failed for domain', confidence: 'low' });
                    }
                }
            })();

            activeDomains.add(domainTask);
            domainTask.finally(() => activeDomains.delete(domainTask));

            if (activeDomains.size >= DOMAIN_CONCURRENCY) await Promise.race(activeDomains);
        }

        await Promise.all(activeDomains);


        // Return in original order
        const responseData = emailList.map(email =>
            allResults.get(email) || { email, status: 'invalid', message: 'Unknown error', confidence: 'low' }
        );

        res.json({ results: responseData });

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

apiRouter.get("/campaigns", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const { data: campaigns, error } = await supabase
            .from("campaigns")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (error) return res.status(500).json({ error: error.message });

        const campaignIds = campaigns.map(c => c.id);
        const allLeads = await fetchAllLeadsStatuses(campaignIds);

        // Group leads by campaign
        const leadsByCampaign = allLeads.reduce((acc: any, lead) => {
            if (!acc[lead.campaign_id]) acc[lead.campaign_id] = { total: 0, sent: 0, pending: 0 };
            acc[lead.campaign_id].total++;
            if (lead.status === 'sent') acc[lead.campaign_id].sent++;
            if (lead.status === 'pending') acc[lead.campaign_id].pending++;
            return acc;
        }, {});

        const formatted = campaigns.map((c: any) => {
            const stats = leadsByCampaign[c.id] || { total: 0, sent: 0, pending: 0 };
            return {
                ...c,
                total_leads: stats.total,
                sent: stats.sent,
                pending: stats.pending
            };
        });

        res.json(formatted);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post("/campaigns", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { name, delayMin, delayMax, subject, body, leads, accountIds } = req.body;

    const { data: campaign, error: cError } = await supabase
        .from("campaigns")
        .insert([{
            user_id: userId,
            name,
            delay_min: delayMin,
            delay_max: delayMax,
            subject,
            body,
            account_ids: accountIds || null,
            status: 'paused' // Start as paused to avoid race condition with queue worker
        }])
        .select()
        .single();

    if (cError) {
        console.error("Campaign creation error:", cError);
        return res.status(500).json({ error: cError.message });
    }

    console.log(`Campaign created: ${campaign.id}. Processing ${leads?.length || 0} leads.`);

    if (!leads || leads.length === 0) {
        console.error("Campaign creation rejected: No leads provided.");
        // Delete the useless campaign
        await supabase.from("campaigns").delete().eq("id", campaign.id);
        return res.status(400).json({ error: "No valid leads provided. Campaign creation cancelled." });
    }

    if (leads && leads.length > 0) {
        const leadInserts = leads.map((l: any) => ({
            campaign_id: campaign.id,
            email: l.email,
            name: l.name,
            variables: l.variables || null
        }));

        const { error: lError } = await supabase
            .from("leads")
            .insert(leadInserts);

        if (lError) {
            console.error("Leads insertion error for campaign:", campaign.id, lError);
            return res.status(500).json({ error: lError.message });
        }
        console.log(`Successfully inserted ${leads.length} leads for campaign ${campaign.id}`);
    }

    // Now that leads are in, set status to running
    const { error: sError } = await supabase
        .from("campaigns")
        .update({ status: 'running' })
        .eq("id", campaign.id);

    if (sError) {
        console.error("Error setting campaign status to running:", sError);
        return res.status(500).json({ error: sError.message });
    }

    res.json({ success: true, id: campaign.id });
});

apiRouter.patch("/accounts/:id/reset", async (req, res) => {
    const { error } = await supabase
        .from("accounts")
        .update({ sends_today: 0, limit_reached_at: null })
        .eq("id", req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

apiRouter.patch("/campaigns/:id/status", async (req, res) => {
    const { error } = await supabase
        .from("campaigns")
        .update({ status: req.body.status })
        .eq("id", req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

apiRouter.delete("/campaigns/:id", async (req, res) => {
    const { error } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", req.params.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

apiRouter.get("/analytics", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const { data: campaigns, error: cError } = await supabase
            .from("campaigns")
            .select("id")
            .eq("user_id", userId);

        if (cError) return res.status(500).json({ error: cError.message });

        const campaignIds = campaigns.map(c => c.id);
        if (campaignIds.length === 0) {
            return res.json({ sent: 0, total: 0, opens: 0, openRate: 0, pieData: [] });
        }

        // Fetch full lead data including opened_at for open tracking
        let allLeads: any[] = [];
        let from = 0;
        while (true) {
            const { data: leadsPage, error } = await supabase
                .from("leads")
                .select("campaign_id, status, opened_at")
                .in("campaign_id", campaignIds)
                .range(from, from + 999);
            if (error) throw error;
            if (leadsPage && leadsPage.length > 0) {
                allLeads.push(...leadsPage);
                if (leadsPage.length < 1000) break;
                from += 1000;
            } else { break; }
        }

        const total = allLeads.length;
        const sent = allLeads.filter(l => l.status === 'sent').length;
        const failed = allLeads.filter(l => l.status === 'failed').length;
        const bounced = allLeads.filter(l => l.status === 'bounced').length;
        const totalBounced = failed + bounced;
        const pending = allLeads.filter(l => l.status === 'pending').length;
        const opens = allLeads.filter(l => l.opened_at).length;

        res.json({
            sent,
            total,
            opens,
            clicks: 0,
            replied: allLeads.filter(l => l.status === 'replied' || l.replied_at).length,
            bounced: totalBounced,
            openRate: sent ? parseFloat((opens / sent * 100).toFixed(1)) : 0,
            clickRate: 0,
            replyRate: sent ? parseFloat((allLeads.filter(l => l.status === 'replied' || l.replied_at).length / sent * 100).toFixed(1)) : 0,
            bounceRate: total ? parseFloat((totalBounced / total * 100).toFixed(1)) : 0,
            pieData: [
                { name: "Sent", value: sent },
                { name: "Pending", value: pending },
                { name: "Failed", value: failed },
                { name: "Bounced", value: bounced }
            ]
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get("/stats", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const { data: campaigns, error: cError } = await supabase
            .from("campaigns")
            .select("id")
            .eq("user_id", userId);

        if (cError) return res.status(500).json({ error: cError.message });

        const campaignIds = campaigns.map(c => c.id);
        if (campaignIds.length === 0) {
            return res.json({ total: 0, pending: 0, sent: 0, replied: 0 });
        }

        const leads = await fetchAllLeadsStatuses(campaignIds);

        res.json({
            total: leads.length,
            pending: leads.filter(l => l.status === 'pending').length,
            sent: leads.filter(l => l.status === 'sent').length,
            replied: leads.filter(l => l.status === 'replied').length
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get("/emails", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { data: campaigns, error: cError } = await supabase
        .from("campaigns")
        .select("id")
        .eq("user_id", userId);

    if (cError) return res.status(500).json({ error: cError.message });

    const campaignIds = campaigns.map(c => c.id);
    if (campaignIds.length === 0) return res.json([]);

    const { data: leads, error: lError } = await supabase
        .from("leads")
        .select("*, campaigns(subject)")
        .in("campaign_id", campaignIds)
        .order("id", { ascending: false })
        .limit(10);

    if (lError) return res.status(500).json({ error: lError.message });

    const mapped = leads.map((l: any) => ({
        id: l.id,
        recipient_email: l.email,
        subject: (l.campaigns as any)?.subject,
        status: l.status,
        scheduled_for: l.sent_at || new Date().toISOString()
    }));
    res.json(mapped);
});

// ──────────────────────────────
// REPLIES
// ──────────────────────────────

apiRouter.post("/replies/sync", async (req, res) => {
    try {
        await checkReplies();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get("/replies", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { campaignId, sentiment } = req.query;

    const { data: campaigns, error: cError } = await supabase
        .from("campaigns")
        .select("id, name")
        .eq("user_id", userId);

    if (cError) return res.status(500).json({ error: cError.message });

    const campaignIds = campaigns.map((c: any) => c.id);
    if (campaignIds.length === 0) return res.json([]);

    let query = supabase
        .from("leads")
        .select("id, email, name, replied_at, variables, campaign_id")
        .in("campaign_id", campaignIds)
        .not("replied_at", "is", null);

    if (campaignId) {
        query = query.eq("campaign_id", campaignId);
    }

    const { data: leads, error: lError } = await query
        .order("id", { ascending: false }); // newest detected first (id = insertion order)

    if (lError) return res.status(500).json({ error: lError.message });

    const campaignMap = new Map(campaigns.map((c: any) => [c.id, c.name]));
    let mapped = (leads || []).map((l: any) => {
        const vars = typeof l.variables === 'string' ? JSON.parse(l.variables) : (l.variables || {});
        return {
            ...l,
            reply_body: vars.reply_body || "",
            reply_sentiment: vars.reply_sentiment || "neutral",
            received_by_account: vars.received_by_account || null,
            campaign_name: campaignMap.get(l.campaign_id) || "Unknown",
        };
    });

    if (sentiment) {
        mapped = mapped.filter(m => m.reply_sentiment === sentiment);
    }

    res.json(mapped);
});

// ──────────────────────────────
// WARMUP (WarmGrid Integration)
// ──────────────────────────────

apiRouter.get("/warmup/stats", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    try {
        const { data: accounts, error } = await supabase
            .from("accounts")
            .select("*")
            .eq("user_id", userId);

        if (error) throw error;

        // Calculate aggregate stats
        const activeAccounts = accounts.filter(a => a.warmup_status !== 'stopped').length;
        const sentToday = accounts.reduce((acc, a) => acc + (a.sends_today || 0), 0);

        // Mocking some values that might not be in the DB yet
        const stats = {
            avg_reputation: Math.round(accounts.reduce((acc, a) => acc + (a.warmup_reputation || 70), 0) / (accounts.length || 1)),
            sent_today: sentToday,
            active_accounts: activeAccounts,
            seed_count: 12, // Mocked for now
            pool_strength: 'strong',
            reputation_history: Array.from({ length: 30 }, (_, i) => ({
                date: new Date(Date.now() - (30 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                score: 65 + Math.floor(Math.random() * 15)
            })),
            daily_sends_history: Array.from({ length: 14 }, (_, i) => ({
                date: new Date(Date.now() - (14 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                count: 50 + Math.floor(Math.random() * 50)
            })),
            accounts: accounts.map(a => ({
                id: a.id,
                email: a.email,
                type: a.smtp_host?.includes('gmail') ? 'gmail' : 'smtp',
                status: a.warmup_status || 'active',
                warmup_reputation: a.warmup_reputation || 72,
                warmup_ramp_day: a.warmup_ramp_day || 1
            })),
            recent_logs: [
                { id: '1', from_email: accounts[0]?.email || 'sender@acme.io', to_email: 'seed1@pool.com', subject: 'Re: Warmup test', event_type: 'sent', created_at: new Date().toISOString() }
            ]
        };

        res.json(stats);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post("/warmup/trigger", async (req, res) => {
    try {
        console.log("[API] Manual warmup trigger received...");
        // Run in background so we don't time out the request
        runWarmupForUser().catch(err => console.error("[API] Manual warmup failed:", err));
        res.json({
            success: true,
            message: "Warmup engine started in background",
            triggered_at: new Date().toISOString()
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────
// OPEN TRACKING
// ──────────────────────────────

// 1x1 transparent GIF pixel
const TRACKING_PIXEL = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
);

apiRouter.get("/tracking/open/:leadId", async (req, res) => {
    const leadId = req.params.leadId;
    // Mark as opened (only first open)
    await supabase
        .from("leads")
        .update({ opened_at: new Date().toISOString() })
        .eq("id", leadId)
        .is("opened_at", null);

    res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': TRACKING_PIXEL.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
    });
    res.end(TRACKING_PIXEL);
});

// ──────────────────────────────
// CAMPAIGN FOLLOW-UPS
// ──────────────────────────────

const DEFAULT_FOLLOWUPS_CONFIG = {
    enabled: true,
    steps: [
        { step: 1, delayDays: 2, subject: "Re: {{original_subject}}", body: "Hi {{name}},\n\nJust wanted to follow up on my previous email. Did you get a chance to review it?\n\nLooking forward to hearing from you.\n\nBest,", enabled: true },
        { step: 2, delayDays: 4, subject: "Re: {{original_subject}}", body: "Hi {{name}},\n\nI wanted to reach out one more time in case my previous messages got buried.\n\nWould love to connect and see if there is a fit.\n\nBest,", enabled: true },
        { step: 3, delayDays: 6, subject: "Re: {{original_subject}}", body: "Hi {{name}},\n\nThis will be my last follow-up. If you are ever interested in the future, feel free to reach out anytime.\n\nWishing you all the best,", enabled: true }
    ]
};

apiRouter.get("/campaigns/:id/followups", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { data, error } = await supabase
        .from("campaigns")
        .select("followups_config")
        .eq("id", req.params.id)
        .eq("user_id", userId)
        .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json(data?.followups_config || DEFAULT_FOLLOWUPS_CONFIG);
});

apiRouter.put("/campaigns/:id/followups", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const config = req.body;

    const { data, error } = await supabase
        .from("campaigns")
        .update({ followups_config: config })
        .eq("id", req.params.id)
        .eq("user_id", userId)
        .select("followups_config")
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data?.followups_config);
});

apiRouter.get("/campaigns/:id/variables", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Fetch ONE lead from this campaign that has variables
    const { data, error } = await supabase
        .from("leads")
        .select("variables")
        .eq("campaign_id", req.params.id)
        .not("variables", "is", null)
        .limit(1);

    if (error) return res.status(500).json({ error: error.message });

    let keys: string[] = [];
    if (data && data.length > 0 && data[0].variables) {
        try {
            const vars = typeof data[0].variables === "string"
                ? JSON.parse(data[0].variables)
                : data[0].variables;
            keys = Object.keys(vars);
        } catch (e) {
            console.error("Failed to parse variables for campaign", req.params.id);
        }
    }
    res.json(keys);
});

// ──────────────────────────────
// GLOBAL FOLLOW-UP TEMPLATES
// ──────────────────────────────

apiRouter.get("/global-followups", async (req, res) => {
    const { data, error } = await supabase
        .from("global_followups")
        .select("*")
        .order("step_number", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});

apiRouter.put("/global-followups/:stepNumber", async (req, res) => {
    const { subject, body, enabled } = req.body;
    const stepNumber = parseInt(req.params.stepNumber);

    const updateData: any = { updated_at: new Date().toISOString() };
    if (subject !== undefined) updateData.subject = subject;
    if (body !== undefined) updateData.body = body;
    if (enabled !== undefined) updateData.enabled = enabled ? 1 : 0;

    const { data, error } = await supabase
        .from("global_followups")
        .update(updateData)
        .eq("step_number", stepNumber)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ──────────────────────────────
// CAMPAIGN LEADS (for followup stats)
// ──────────────────────────────

apiRouter.get("/campaign-leads/:campaignId", async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { data, error } = await supabase
        .from("leads")
        .select("id, email, name, status, sent_at, opened_at, replied_at, followup_step_1_sent_at, followup_step_2_sent_at, followup_step_3_sent_at")
        .eq("campaign_id", req.params.campaignId);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
});
