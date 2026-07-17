import nodemailer from "nodemailer";
import { supabase } from "./supabase";
import { runWarmupForUser } from "./services/warmup/engine";

let isRunning = false;
let lastWarmupRun = 0;
const WARMUP_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Follow-up schedule definitions
const FOLLOWUP_STEPS = [
    { step: 1, column: "followup_step_1_sent_at" },
    { step: 2, column: "followup_step_2_sent_at" },
    { step: 3, column: "followup_step_3_sent_at" },
];

const PUBLIC_BASE_URL = process.env.PUBLIC_BACKEND_URL || "http://localhost:4000";

function buildTrackingPixel(leadId: string | number): string {
    return `<img src="${PUBLIC_BASE_URL}/api/tracking/open/${leadId}" width="1" height="1" style="display:none" alt="" />`;
}

/**
 * Returns true if an SMTP error message indicates the account has been
 * blocked / suspended / rate-limited by the provider (Gmail, Outlook, etc.).
 * These are day-level policy blocks, not per-message delivery failures.
 */
function isBlockedError(err: any): boolean {
    const msg = String(err?.message || err?.responseCode || err?.response || "").toLowerCase();
    return (
        msg.includes("message blocked") ||
        msg.includes("suspended") ||
        msg.includes("account suspended") ||
        msg.includes("policy violation") ||
        msg.includes("too many") ||
        msg.includes("rate limit") ||
        msg.includes("daily sending quota") ||
        msg.includes("sending limit") ||
        msg.includes("deactivated") ||
        msg.includes("temporarily disabled") ||
        (msg.includes("550") && (msg.includes("blocked") || msg.includes("suspended") || msg.includes("policy")))
    );
}

/**
 * Returns true if the error is a permanent SMTP authentication failure (535).
 * These are bad-credentials errors that will never succeed — the account
 * should be disabled rather than retried.
 */
function isAuthError(err: any): boolean {
    const msg = String(err?.message || err?.responseCode || err?.response || "").toLowerCase();
    return (
        msg.includes("535") ||
        msg.includes("username and password not accepted") ||
        msg.includes("invalid login") ||
        msg.includes("authentication failed") ||
        msg.includes("authentication credentials invalid")
    );
}

/**
 * Returns the ISO timestamp for the next calendar-day midnight in
 * America/New_York. Setting limit_reached_at to this value means the
 * existing daily-reset logic (in index.ts) will clear the block the
 * following morning, giving the account a fresh start.
 */
function getNextMidnightESTISO(): string {
    // Get today's date string in EST
    const estFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = estFormatter.formatToParts(new Date());
    const year = parseInt(parts.find(p => p.type === 'year')!.value, 10);
    const month = parseInt(parts.find(p => p.type === 'month')!.value, 10);
    const day = parseInt(parts.find(p => p.type === 'day')!.value, 10);

    // Next calendar day midnight in EST = Date.UTC with the EST offset applied
    // EST = UTC-5, EDT = UTC-4. Use the naive approach: midnight EST next day
    // We find next day's midnight by constructing midnight UTC and adding the offset
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0)); // midnight UTC next day
    // Format nextDay in EST to find its EST offset at that exact instant
    const nextDayParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit',
        hour12: false,
    }).formatToParts(nextDay);
    const nyHour = parseInt(nextDayParts.find(p => p.type === 'hour')!.value, 10);
    // If NY shows e.g. 19:00 (7 PM) for midnight UTC, offset = -5h, so true midnight EST is +5h from this UTC
    // We want 00:00 EST = midnight UTC + (offset in hours)
    const offsetHours = -nyHour; // nyHour == abs(offsetHours) since we started at 00:00 UTC
    const midnightEST = new Date(nextDay.getTime() + offsetHours * 60 * 60 * 1000);
    return midnightEST.toISOString();
}

/**
 * Marks an account as blocked:
 * - sets sends_today to daily_send_limit (stops further sends)
 * - sets limit_reached_at to 24 hours in the future (preventing early reset)
 */
async function blockAccountForToday(account: any): Promise<void> {
    const blockUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase
        .from("accounts")
        .update({
            sends_today: account.daily_send_limit,
            limit_reached_at: blockUntil,
        })
        .eq("id", account.id);
    console.warn(`[Queue] ⚠️  Account ${account.email} is BLOCKED by provider. Disabled for 24 hours. Will auto-resume after ${blockUntil}.`);
}

export async function startQueue() {
    isRunning = true;
    processQueue();
}

async function processQueue() {
    if (!isRunning) return;

    try {
        const now = new Date().toISOString();
        const { data: activeCampaigns, error: cError } = await supabase
            .from("campaigns")
            .select("*")
            .in("status", ["running", "scheduled"])
            .or(`next_run_at.lte.${now},next_run_at.is.null`);

        if (cError) throw cError;

        for (const campaign of activeCampaigns || []) {
            if (campaign.status === "scheduled") {
                await supabase
                    .from("campaigns")
                    .update({ status: "running" })
                    .eq("id", campaign.id);
                campaign.status = "running";
                console.log(`[Queue] Scheduled campaign "${campaign.name}" is now due. Starting campaign execution.`);
            }
            // ── Initial send: find pending leads in batches to handle duplicates efficiently ──
            const { data: pendingLeads, error: lError } = await supabase
                .from("leads")
                .select("*")
                .eq("campaign_id", campaign.id)
                .eq("status", "pending")
                .limit(100);

            if (lError) throw lError;
            
            let lead = null;
            if (pendingLeads && pendingLeads.length > 0) {
                // Get all campaign IDs belonging to this user
                const { data: userCampaigns } = await supabase
                    .from("campaigns")
                    .select("id")
                    .eq("user_id", campaign.user_id);
                const userCampaignIds = (userCampaigns || []).map((c: any) => c.id);

                // Get distinct email addresses from our pending batch
                const batchEmails = Array.from(new Set(pendingLeads.map(l => l.email)));

                // Check which of these emails have already been emailed in OTHER campaigns.
                // We exclude the current campaign so that restarted campaigns can resend
                // to their own leads without being blocked by the cross-campaign de-dup.
                const otherCampaignIds = userCampaignIds.filter((cid: any) => String(cid) !== String(campaign.id));

                let sentLeads: any[] = [];
                if (otherCampaignIds.length > 0) {
                    const { data: sentLeadsData, error: slError } = await supabase
                        .from("leads")
                        .select("email")
                        .in("campaign_id", otherCampaignIds)
                        .in("status", ["sent", "replied", "bounced"])
                        .in("email", batchEmails);

                    if (slError) throw slError;
                    sentLeads = sentLeadsData || [];
                }

                const sentEmailsSet = new Set((sentLeads || []).map(l => l.email.toLowerCase().trim()));
                const seenEmails = new Set(sentEmailsSet);
                const skippedLeadIds: any[] = [];

                for (const pl of pendingLeads) {
                    const emailKey = pl.email.toLowerCase().trim();
                    if (seenEmails.has(emailKey)) {
                        skippedLeadIds.push(pl.id);
                    } else if (!lead) {
                        lead = pl;
                        seenEmails.add(emailKey);
                    }
                }

                // Mark duplicates as skipped in database
                if (skippedLeadIds.length > 0) {
                    await supabase
                        .from("leads")
                        .update({ status: "skipped" })
                        .in("id", skippedLeadIds);
                    console.log(`[Queue] Skipped ${skippedLeadIds.length} duplicate leads for campaign ${campaign.id}`);
                }
            }

            if (lead) {
                const account = await getAvailableAccount(campaign.user_id, campaign.account_ids);
                if (account) {
                    const transporter = createTransporter(account);
                    const personalizedSubject = personalize(campaign.subject, lead);
                    const personalizedBody = personalize(campaign.body, lead);
                    const trackingPixel = buildTrackingPixel(lead.id);

                    // Append tracking pixel to HTML body
                    const htmlBody = personalizedBody.replace(/\n/g, "<br>") + trackingPixel;

                    try {
                        const info = await transporter.sendMail({
                            from: `"${account.display_name || account.email}" <${account.email}>`,
                            to: lead.email,
                            subject: personalizedSubject,
                            html: htmlBody,
                        });

                        let msgId = info.messageId || "";
                        if (msgId && !msgId.startsWith('<')) msgId = `<${msgId}`;
                        if (msgId && !msgId.endsWith('>')) msgId = `${msgId}>`;

                        const { error: updateErr } = await supabase
                            .from("leads")
                            .update({
                                status: "sent",
                                sent_at: new Date().toISOString(),
                                message_id: msgId,
                                account_id: account.id, // Remember which account sent this
                            })
                            .eq("id", lead.id);

                        if (updateErr) throw new Error(`DB Update failed: ${updateErr.message}`);

                        await incrementAccountSends(account);
                        console.log(`[Queue] Sent initial email to ${lead.email} (campaign ${campaign.id})`);
                    } catch (err) {
                        // Check if the account was blocked / suspended by the provider
                        if (isBlockedError(err)) {
                            await blockAccountForToday(account);
                            // Do NOT mark lead as failed — it will be retried with another account
                        } else if (isAuthError(err)) {
                            // Bad credentials — disable campaign sending for this account permanently
                            await supabase
                                .from("accounts")
                                .update({ allow_campaign_sending: false })
                                .eq("id", account.id);
                            console.error(`[Queue] ❌ Account ${account.email} has invalid SMTP credentials (535). Disabling campaign sending for this account.`);
                            // Do NOT mark lead as failed — it will be retried with another account
                        } else {
                            // Retry up to 3 times before permanently marking as failed
                            const currentRetries = lead.retry_count || 0;
                            const MAX_RETRIES = 3;
                            if (currentRetries + 1 >= MAX_RETRIES) {
                                await supabase
                                    .from("leads")
                                    .update({ status: "failed", retry_count: currentRetries + 1 })
                                    .eq("id", lead.id);
                                console.error(`[Queue] Permanently failed lead ${lead.email} after ${MAX_RETRIES} attempts:`, err);
                            } else {
                                // Keep as pending for retry, just increment the counter
                                await supabase
                                    .from("leads")
                                    .update({ retry_count: currentRetries + 1 })
                                    .eq("id", lead.id);
                                console.warn(`[Queue] Send failed for ${lead.email} (attempt ${currentRetries + 1}/${MAX_RETRIES}), will retry:`, (err as any)?.message || err);
                            }
                        }
                    }

                    const delaySeconds =
                        Math.floor(Math.random() * (campaign.delay_max - campaign.delay_min + 1)) +
                        campaign.delay_min;
                    const nextRun = new Date(Date.now() + delaySeconds * 1000).toISOString();
                    await supabase.from("campaigns").update({ next_run_at: nextRun }).eq("id", campaign.id);
                } else {
                    // No account available (e.g. daily limit reached). Reschedule in 15 minutes to avoid hot looping.
                    console.log(`[Queue] No available account for campaign: "${campaign.name}". Rescheduling in 15 minutes.`);
                    const nextRun = new Date(Date.now() + 15 * 60 * 1000).toISOString();
                    await supabase.from("campaigns").update({ next_run_at: nextRun }).eq("id", campaign.id);
                }
            } else {
                // lead is null — the batch may have been all duplicates/skipped.
                // Do a definitive DB count before making any completion decision.
                const { count: truePendingCount, error: countErr } = await supabase
                    .from("leads")
                    .select("*", { count: "exact", head: true })
                    .eq("campaign_id", campaign.id)
                    .eq("status", "pending");

                if (countErr) {
                    console.error(`[Queue] Failed to count pending leads for campaign "${campaign.name}":`, countErr.message);
                } else if ((truePendingCount ?? 0) > 0) {
                    // There are still real pending leads — server may have gone offline mid-run
                    // or the entire batch was duplicates. Reschedule immediately and continue.
                    console.log(`[Queue] Campaign "${campaign.name}" still has ${truePendingCount} pending lead(s) in DB. Not marking completed — rescheduling.`);
                    const nextRun = new Date(Date.now() + 5000).toISOString();
                    await supabase.from("campaigns").update({ next_run_at: nextRun }).eq("id", campaign.id);
                } else {
                    // Truly no pending leads left. Check for failed leads.
                    const { data: allLeadStatuses } = await supabase
                        .from("leads")
                        .select("status")
                        .eq("campaign_id", campaign.id);

                    const statusCounts = (allLeadStatuses || []).reduce((acc: any, l: any) => {
                        acc[l.status] = (acc[l.status] || 0) + 1;
                        return acc;
                    }, {});

                    console.log(`[Queue] Campaign "${campaign.name}" lead statuses:`, statusCounts);

                    const hasFailed = (statusCounts.failed || 0) > 0;
                    if (hasFailed) {
                        console.log(`[Queue] Campaign "${campaign.name}" has failed leads. Pausing instead of completing.`);
                        await supabase.from("campaigns").update({ status: "paused" }).eq("id", campaign.id);
                    } else {
                        console.log(`[Queue] All leads processed for campaign: "${campaign.name}". Marking completed.`);
                        await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaign.id);
                    }
                }
            }

            // ── Follow-up sends for running campaigns ──
            await processFollowupSteps(campaign);
        }

        // Also run follow-ups for completed campaigns (still need to send steps)
        const { data: completedCampaigns } = await supabase
            .from("campaigns")
            .select("*")
            .eq("status", "completed");

        for (const campaign of completedCampaigns || []) {
            await processFollowupSteps(campaign);
        }

        // ── Warmup periodic check ── DISABLED
        /*
        if (Date.now() - lastWarmupRun >= WARMUP_INTERVAL) {
            console.log("[Queue] Running periodic warmup (send + seed replies + reputation)...");
            await runWarmupForUser();
            lastWarmupRun = Date.now();
        }
        */

    } catch (err) {
        console.error("[Queue] Error:", err);
    }

    setTimeout(processQueue, 5000);
}

async function processFollowupSteps(campaign: any) {
    // Load campaign follow-up config
    const followupsConfig = campaign.followups_config || {
        enabled: true,
        steps: [
            { step: 1, delayDays: 2, subject: "Re: {{original_subject}}", body: "Hi {{name}},\n\nJust wanted to follow up on my previous email. Did you get a chance to review it?\n\nLooking forward to hearing from you.\n\nBest,", enabled: true },
            { step: 2, delayDays: 4, subject: "Re: {{original_subject}}", body: "Hi {{name}},\n\nI wanted to reach out one more time in case my previous messages got buried.\n\nWould love to connect and see if there is a fit.\n\nBest,", enabled: true },
            { step: 3, delayDays: 6, subject: "Re: {{original_subject}}", body: "Hi {{name}},\n\nThis will be my last follow-up. If you are ever interested in the future, feel free to reach out anytime.\n\nWishing you all the best,", enabled: true }
        ]
    };

    if (!followupsConfig.enabled) return;

    // If no enabled templates, skip
    const enabledTemplates = (followupsConfig.steps || []).filter((t: any) => t.enabled);
    if (enabledTemplates.length === 0) {
        return;
    }

    const processedLeadIdsInThisRun = new Set<string | number>();

    try {
        for (let i = 0; i < FOLLOWUP_STEPS.length; i++) {
            const { step, column } = FOLLOWUP_STEPS[i];
            const template = enabledTemplates.find((t: any) => t.step === step || t.step_number === step);
            if (!template) continue; // This step is disabled or has no template

            const currentDelayDays = typeof template.delayDays === "number" ? template.delayDays : (step * 2);

            let query = supabase
                .from("leads")
                .select("*")
                .eq("campaign_id", campaign.id)
                .eq("status", "sent")
                .neq("status", "bounced")
                .is("replied_at", null)
                .not("message_id", "is", null)
                .is(column, null);

            // Sequential logic and relative delay
            if (i === 0) {
                // Step 1: Delay relative to initial sent_at
                const delayMs = currentDelayDays * 24 * 60 * 60 * 1000;
                const cutoff = new Date(Date.now() - delayMs).toISOString();
                query = query.lte("sent_at", cutoff);
            } else {
                // Step N > 1: Ensure previous step was sent AND respect relative interval
                const prevStep = FOLLOWUP_STEPS[i - 1];
                const prevTemplate = enabledTemplates.find((t: any) => t.step === prevStep.step || t.step_number === prevStep.step);

                // Ensure previous step is NOT null
                query = query.not(prevStep.column, "is", null);

                // Calculate relative gap
                const prevDelayDays = prevTemplate
                    ? (typeof prevTemplate.delayDays === "number" ? prevTemplate.delayDays : (prevStep.step * 2))
                    : (prevStep.step * 2);

                const relativeGapDays = Math.max(1, currentDelayDays - prevDelayDays);
                const gapMs = relativeGapDays * 24 * 60 * 60 * 1000;

                // Cutoff is relative to the PREVIOUS step's sent time
                const cutoff = new Date(Date.now() - gapMs).toISOString();
                query = query.lte(prevStep.column, cutoff);
            }

            // Prevent processing same lead multiple times in one run
            if (processedLeadIdsInThisRun.size > 0) {
                const idsString = Array.from(processedLeadIdsInThisRun).map(id => `'${id}'`).join(",");
                query = query.not("id", "in", `(${idsString})`);
            }

            const { data: eligibleLeads, error: lErr } = await query.limit(1);

            if (lErr || !eligibleLeads || eligibleLeads.length === 0) continue;

            const lead = eligibleLeads[0];
            processedLeadIdsInThisRun.add(lead.id);

            // Use the SAME account that sent the initial email
            const account = await getSpecificOrFallbackAccount(campaign.user_id, lead.account_id);
            if (!account) {
                console.warn(`[FollowupQueue] No available account for follow-up to ${lead.email}`);
                continue;
            }

            // Use user-customized template, replace {{original_subject}} placeholder
            let subject = template.subject.replace(/\{\{original_subject\}\}/g, campaign.subject);
            let body = template.body;
            subject = personalize(subject, lead);
            body = personalize(body, lead);

            const trackingPixel = buildTrackingPixel(lead.id);
            const htmlBody = body.replace(/\n/g, "<br>") + trackingPixel;

            const transporter = createTransporter(account);

            try {
                let threadMsgId = lead.message_id || "";
                if (threadMsgId && !threadMsgId.startsWith('<')) threadMsgId = `<${threadMsgId}`;
                if (threadMsgId && !threadMsgId.endsWith('>')) threadMsgId = `${threadMsgId}>`;

                await transporter.sendMail({
                    from: `"${account.display_name || account.email}" <${account.email}>`,
                    to: lead.email,
                    subject: subject.startsWith("Re:") ? subject : `Re: ${campaign.subject}`,
                    html: htmlBody,
                    inReplyTo: threadMsgId,
                    references: threadMsgId,
                });

                await supabase
                    .from("leads")
                    .update({ [column]: new Date().toISOString() })
                    .eq("id", lead.id);

                console.log(`[FollowupQueue] Sent step ${step} to ${lead.email} (campaign ${campaign.id}) [Exempt from Send Limits]`);
            } catch (err) {
                // Check if the follow-up account got blocked by the provider
                if (isBlockedError(err)) {
                    await blockAccountForToday(account);
                    // Lead is not marked failed — it will be retried once account is re-enabled
                } else {
                    console.error(`[FollowupQueue] Failed to send step ${step} to ${lead.email}:`, err);
                }
            }
        }
    } catch (err) {
        console.error("[FollowupQueue] Error processing follow-up steps:", err);
    }
}

// ── Helpers ────────────────────────────────────────────

async function getAvailableAccount(userId: string, accountIds: string[] | null = null) {
    let query = supabase
        .from("accounts")
        .select("*")
        .eq("user_id", userId);

    const { data: allAccounts, error } = await query;

    if (error) throw error;

    let targetAccounts = allAccounts || [];
    if (accountIds && Array.isArray(accountIds) && accountIds.length > 0) {
        // Coerce both sides to string to handle UUID vs numeric ID mismatches
        const normalizedIds = accountIds.map(id => String(id));
        targetAccounts = targetAccounts.filter(acc => normalizedIds.includes(String(acc.id)));
    }

    const available = [];
    for (const acc of targetAccounts) {
        // Skip accounts that have campaign sending explicitly disabled
        if (acc.allow_campaign_sending === false) continue;

        // Skip accounts that are currently blocked
        const isCurrentlyBlocked = acc.limit_reached_at && (new Date(acc.limit_reached_at).getTime() > Date.now());
        if (isCurrentlyBlocked) continue;

        let sendsToday = acc.sends_today || 0;
        const todayStr = new Date().toISOString().split('T')[0];

        const needsResetByTime = acc.limit_reached_at && (new Date(acc.limit_reached_at).getTime() <= Date.now() - 24 * 60 * 60 * 1000);
        const needsResetByDate = !acc.last_reset_at || acc.last_reset_at !== todayStr;

        if (needsResetByTime || needsResetByDate) {
            await supabase
                .from("accounts")
                .update({ sends_today: 0, limit_reached_at: null, last_reset_at: todayStr })
                .eq("id", acc.id);
            sendsToday = 0;
        }

        if (sendsToday < acc.daily_send_limit) {
            available.push({ ...acc, sends_today: sendsToday });
        }
    }

    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
}

/**
 * For follow-ups: Always use the exact account that sent the initial email to preserve threading.
 * Follow-up emails do NOT count towards normal campaign sending limits.
 * If that account was deleted, fall back to any available account.
 */
async function getSpecificOrFallbackAccount(userId: string, accountId: string | null) {
    if (accountId) {
        const { data: specificAccount } = await supabase
            .from("accounts")
            .select("*")
            .eq("id", accountId)
            .eq("user_id", userId)
            .single();

        if (specificAccount) {
            // Follow-ups are exempt from daily sending limits to ensure threads are not broken
            return specificAccount;
        }
    }

    // Fallback: any available account
    return getAvailableAccount(userId);
}

async function incrementAccountSends(account: any) {
    const newSendsToday = account.sends_today + 1;
    const updateData: any = { sends_today: newSendsToday };
    if (newSendsToday >= account.daily_send_limit) {
        updateData.limit_reached_at = new Date().toISOString();
    }
    await supabase.from("accounts").update(updateData).eq("id", account.id);
}

function createTransporter(account: any) {
    return nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_port === 465,
        auth: { user: account.email, pass: account.app_password },
    });
}

function personalize(template: string, lead: any): string {
    let result = template
        .replace(/{{name}}/g, lead.name || "")
        .replace(/{{email}}/g, lead.email);

    if (lead.variables) {
        try {
            const vars =
                typeof lead.variables === "string" ? JSON.parse(lead.variables) : lead.variables;
            for (const [key, value] of Object.entries(vars)) {
                result = result.replace(new RegExp(`{{${key}}}`, "g"), String(value || ""));
            }
        } catch {
            console.error("[Queue] Failed to parse variables for lead", lead.id);
        }
    }

    return result;
}
