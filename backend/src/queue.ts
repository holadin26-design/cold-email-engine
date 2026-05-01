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

const PUBLIC_BASE_URL = process.env.PUBLIC_BACKEND_URL || "http://localhost:3000";

function buildTrackingPixel(leadId: string | number): string {
    return `<img src="${PUBLIC_BASE_URL}/api/tracking/open/${leadId}" width="1" height="1" style="display:none" alt="" />`;
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
            .eq("status", "running")
            .or(`next_run_at.lte.${now},next_run_at.is.null`);

        if (cError) throw cError;

        for (const campaign of activeCampaigns || []) {
            // ── Initial send: find one pending lead ──
            const { data: leads, error: lError } = await supabase
                .from("leads")
                .select("*")
                .eq("campaign_id", campaign.id)
                .eq("status", "pending")
                .limit(1);

            if (lError) throw lError;
            const lead = leads?.[0];

            if (lead) {
                const account = await getAvailableAccount(campaign.user_id);
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
                        await supabase.from("leads").update({ status: "failed" }).eq("id", lead.id);
                        console.error("[Queue] Failed to send to", lead.email, err);
                    }

                    const delaySeconds =
                        Math.floor(Math.random() * (campaign.delay_max - campaign.delay_min + 1)) +
                        campaign.delay_min;
                    const nextRun = new Date(Date.now() + delaySeconds * 1000).toISOString();
                    await supabase.from("campaigns").update({ next_run_at: nextRun }).eq("id", campaign.id);
                }
            } else {
                // All initial emails sent — mark completed if nothing pending
                const { data: pendingCheck } = await supabase
                    .from("leads")
                    .select("id")
                    .eq("campaign_id", campaign.id)
                    .eq("status", "pending")
                    .limit(1);

                if (!pendingCheck || pendingCheck.length === 0) {
                    await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaign.id);
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

    try {
        for (const { step, column } of FOLLOWUP_STEPS) {
            const template = enabledTemplates.find((t: any) => t.step === step || t.step_number === step);
            if (!template) continue; // This step is disabled or has no template

            const delayDays = typeof template.delayDays === "number" ? template.delayDays : (step * 2);
            const delayMs = delayDays * 24 * 60 * 60 * 1000;
            const cutoff = new Date(Date.now() - delayMs).toISOString();

            // Find leads that: are sent, no bounce, no reply, delay has elapsed, this step hasn't been sent
            const { data: eligibleLeads, error: lErr } = await supabase
                .from("leads")
                .select("*")
                .eq("campaign_id", campaign.id)
                .eq("status", "sent")
                .neq("status", "bounced")
                .is("replied_at", null)
                .not("message_id", "is", null)
                .lte("sent_at", cutoff)
                .is(column, null)
                .limit(1); // Process one per cycle

            if (lErr || !eligibleLeads || eligibleLeads.length === 0) continue;

            const lead = eligibleLeads[0];

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
                console.error(`[FollowupQueue] Failed to send step ${step} to ${lead.email}:`, err);
            }
        }
    } catch (err) {
        console.error("[FollowupQueue] Error processing follow-up steps:", err);
    }
}

// ── Helpers ────────────────────────────────────────────

async function getAvailableAccount(userId: string) {
    const { data: allAccounts, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("user_id", userId);

    if (error) throw error;

    const available = [];
    for (const acc of allAccounts || []) {
        // Skip accounts that have campaign sending explicitly disabled
        if (acc.allow_campaign_sending === false) continue;

        let sendsToday = acc.sends_today || 0;

        if (acc.limit_reached_at) {
            const reachedAt = new Date(acc.limit_reached_at).getTime();
            if (reachedAt <= Date.now() - 24 * 60 * 60 * 1000) {
                await supabase
                    .from("accounts")
                    .update({ sends_today: 0, limit_reached_at: null })
                    .eq("id", acc.id);
                sendsToday = 0;
            }
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
