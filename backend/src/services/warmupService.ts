import nodemailer from "nodemailer";
import { supabase } from "../supabase";
import OpenAI from "openai";
import Imap from "imap";
import { simpleParser, ParsedMail } from "mailparser";

const openai = new OpenAI(); // uses OPENAI_API_KEY from env

export async function processWarmup() {
    console.log("[Warmup] Checking for active warmup accounts...");
    try {
        const { data: accounts, error } = await supabase
            .from("accounts")
            .select("*")
            .eq("warmup_status", "active");

        if (error) {
            console.error("[Warmup] Error fetching accounts:", error);
            if (error.message.includes("column \"warmup_status\" does not exist")) {
                const { data: all } = await supabase.from("accounts").select("*").limit(2);
                if (all) await runWarmupBatch(all);
            }
            return;
        }

        if (accounts && accounts.length > 0) {
            await runWarmupBatch(accounts);
        }
    } catch (err) {
        console.error("[Warmup] Unexpected error:", err);
    }
}

async function runWarmupBatch(accounts: any[]) {
    // Only use active seed accounts from the DB — no hardcoded warm leads
    const { data: seedAccounts } = await supabase
        .from("seed_accounts")
        .select("email")
        .eq("status", "active");

    // Also check accounts table for accounts flagged as seed
    const { data: legacySeeds } = await supabase
        .from("accounts")
        .select("email")
        .eq("is_seed", true);

    const seedEmails = [
        ...(seedAccounts?.map((s: any) => s.email) ?? []),
        ...(legacySeeds?.map((s: any) => s.email) ?? [])
    ];
    const allRecipients = [...new Set(seedEmails)];

    if (allRecipients.length === 0) {
        console.log("[Warmup] No seed accounts found — skipping batch.");
        return;
    }

    // Shuffle for rotation — different seeds get picked first each run
    for (let i = allRecipients.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allRecipients[i], allRecipients[j]] = [allRecipients[j], allRecipients[i]];
    }

    console.log(`[Warmup] Sending to ${allRecipients.length} seed account(s) only.`);

    for (const account of accounts) {
        let sendCount = account.warmup_send_count || account.warmup_daily_sent || 0;
        
        const lastActiveTime = account.last_active_at || account.warmup_last_active;
        if (lastActiveTime) {
            const lastActiveDate = new Date(lastActiveTime).toISOString().split('T')[0];
            const todayDate = new Date().toISOString().split('T')[0];
            if (lastActiveDate !== todayDate) {
                sendCount = 0;
                await supabase.from("accounts").update({ 
                    warmup_send_count: 0,
                    warmup_daily_sent: 0 
                }).eq("id", account.id);
                account.warmup_send_count = 0;
                account.warmup_daily_sent = 0;
            }
        }

        const rampLimit = Math.min(account.warmup_ramp_day || account.ramp_current_day || 2, account.warmup_daily_limit || account.daily_send_limit || 50);

        if (sendCount >= rampLimit) {
            console.log(`[Warmup] Account ${account.email} reached daily ramp limit (${rampLimit})`);
            continue;
        }

        // Send 1 email per recipient per day
        for (const targetEmail of allRecipients) {
            // 1. Check if already sent to this recipient today from this account
            const today = new Date().toISOString().split('T')[0];
            const { data: alreadySent } = await supabase
                .from("warmup_logs")
                .select("id")
                .eq("from_email", account.email)
                .eq("to_email", targetEmail)
                .eq("event_type", "sent")
                .gte("created_at", `${today}T00:00:00.000Z`);

            if (alreadySent && alreadySent.length > 0) {
                // Already sent today, skip this recipient
                console.log(`[Warmup] Already sent today from ${account.email} to ${targetEmail} — skipping.`);
                continue;
            }

            // 2. Check daily ramp limit before sending
            const { data: freshAccount } = await supabase
                .from("accounts")
                .select("warmup_send_count")
                .eq("id", account.id)
                .single();

            const currentSendCount = freshAccount?.warmup_send_count ?? sendCount;
            if (currentSendCount >= rampLimit) {
                console.log(`[Warmup] Daily limit hit mid-batch for ${account.email}`);
                break;
            }

            try {
                const transporter = nodemailer.createTransport({
                    host: account.smtp_host,
                    port: account.smtp_port,
                    secure: account.smtp_port === 465,
                    auth: { user: account.email, pass: account.app_password },
                });

                const { subject, body } = await generateAIWarmupContent(account.email, targetEmail);

                await transporter.sendMail({
                    from: `"${account.display_name || account.email}" <${account.email}>`,
                    to: targetEmail,
                    subject,
                    text: body,
                });

                const newRep = Math.min(100, (account.reputation_score || 70) + 0.5);
                await supabase
                    .from("accounts")
                    .update({
                        warmup_send_count: currentSendCount + 1,
                        warmup_daily_sent: currentSendCount + 1,
                        reputation_score: newRep,
                        last_active_at: new Date().toISOString(),
                        warmup_last_active: new Date().toISOString()
                    })
                    .eq("id", account.id);

                console.log(`[Warmup] ✅ Email sent from ${account.email} → ${targetEmail}`);

                // Log it
                const { error: logErr } = await supabase.from("warmup_logs").insert({
                    from_account_id: account.id,
                    from_email: account.email,
                    to_email: targetEmail,
                    event_type: 'sent',
                    subject,
                    result: 'success'
                });
                if (logErr) console.warn("[Warmup] Log insertion skipped:", logErr.message);

            } catch (err) {
                console.error(`[Warmup] ❌ Failed sending from ${account.email} to ${targetEmail}:`, err);
            }

            // Delay between recipients to look natural
            await delay(randomBetween(5000, 10000));
        }
    }
}

function nameFromEmail(email: string): string {
    const local = email.split('@')[0] ?? '';
    const firstName = local.split(/[._\-+0-9]/)[0] ?? local;
    if (!firstName) return '';
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

function stripPlaceholders(text: string): string {
    return text
        .replace(/\{\{[^}]*\}\}/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/  +/g, ' ')
        .trim();
}

async function generateAIWarmupContent(fromEmail: string, toEmail: string): Promise<{ subject: string; body: string }> {
    const senderName = nameFromEmail(fromEmail);
    const recipientName = nameFromEmail(toEmail);
    const greeting = recipientName ? `Hi ${recipientName},` : 'Hey,';
    const signoff = senderName ? `\n\nBest,\n${senderName}` : '';
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are writing short, natural-sounding warmup emails between colleagues.
                    Rules (STRICT):
                    - Write ONLY the middle body content (1-3 sentences). No greeting or sign-off — those are added separately.
                    - NEVER use placeholders like [name], {name}, [your name], {{recipient}}, or ANY bracket/brace variables. Use actual words.
                    - Keep it casual, brief, and varied each time.
                    - Do not mention AI, warmup, or automation.
                    Respond ONLY with a JSON object: { "subject": "...", "body": "..." }
                    No markdown, no extra text.`
                },
                {
                    role: "user",
                    content: `Write a short casual warmup email body (middle content only, no greeting/sign-off) from ${fromEmail} to ${toEmail}. Vary the topic each time.`
                }
            ],
            temperature: 0.9,
        });

        const raw = completion.choices[0].message.content ?? "";
        const parsed = JSON.parse(raw);
        return {
            subject: parsed.subject,
            body: `${greeting}\n\n${stripPlaceholders(parsed.body)}${signoff}`
        };

    } catch (err) {
        console.warn("[Warmup] OpenAI generation failed, falling back to static content:", err);
        return generateFallbackContent(greeting, signoff);
    }
}

function generateFallbackContent(greeting = 'Hey,', signoff = ''): { subject: string; body: string } {
    const subjects = [
        "Quick question about the project",
        "Meeting follow-up",
        "Thought you might like this",
        "Regarding our last conversation",
        "Checking in"
    ];
    const bodies = [
        "Just wanted to check in on the status of our project. Let me know when you have a moment to chat.",
        "It was great meeting you the other day. Looking forward to our next steps.",
        "I found this interesting and thought you might find it useful.",
        "I've updated the shared document with the latest figures. Talk soon!",
        "Hope you're having a great week! Let's touch base soon."
    ];
    return {
        subject: subjects[Math.floor(Math.random() * subjects.length)],
        body: `${greeting}\n\n${bodies[Math.floor(Math.random() * bodies.length)]}${signoff}`
    };
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// MAIN ENTRY — call this on your cron schedule
// alongside processWarmup()
// ─────────────────────────────────────────────
export async function processWarmupReplies() {
    console.log("[AutoReply] Starting warmup reply cycle...");

    try {
        // Fetch all active seed accounts that have IMAP credentials
        const { data: seedAccounts, error } = await supabase
            .from("accounts")
            .select("*")
            .eq("warmup_status", "active")
            .eq("is_seed", true);

        if (error) {
            console.error("[AutoReply] Failed to fetch seed accounts:", error.message);
            return;
        }

        if (!seedAccounts || seedAccounts.length === 0) {
            console.log("[AutoReply] No active seed accounts found.");
            return;
        }

        console.log(`[AutoReply] Processing ${seedAccounts.length} seed account(s)...`);

        for (const account of seedAccounts) {
            await processAccountReplies(account);
            await delay(3000); // Gap between accounts
        }

    } catch (err) {
        console.error("[AutoReply] Unexpected error:", err);
    }
}

// ─────────────────────────────────────────────
// Per-account: fetch unseen warmup emails → reply
// ─────────────────────────────────────────────
async function processAccountReplies(account: any) {
    console.log(`[AutoReply] Checking inbox for ${account.email}...`);

    let unseenEmails: ParsedMail[] = [];

    try {
        unseenEmails = await fetchUnseenEmails(account);
    } catch (err) {
        console.error(`[AutoReply] IMAP fetch failed for ${account.email}:`, err);
        return;
    }

    if (unseenEmails.length === 0) {
        console.log(`[AutoReply] No new warmup emails for ${account.email}`);
        return;
    }

    console.log(`[AutoReply] Found ${unseenEmails.length} email(s) to reply to from ${account.email}`);

    const transporter = nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_port === 465,
        auth: { user: account.email, pass: account.app_password },
    });

    for (const email of unseenEmails) {
        try {
            const fromAddress = extractEmail(email.from?.text ?? "");
            const originalSubject = email.subject ?? "Re: Hello";
            const originalBody = email.text ?? "";

            if (!fromAddress) {
                console.warn("[AutoReply] Skipping email with no sender.");
                continue;
            }

            // Skip if we already replied (check warmup_logs)
            const alreadyReplied = await checkAlreadyReplied(account.email, fromAddress, originalSubject);
            if (alreadyReplied) {
                console.log(`[AutoReply] Already replied to ${fromAddress} — skipping.`);
                continue;
            }

            // Generate AI reply
            const { subject, body } = await generateAIReply(
                account.email,
                fromAddress,
                originalSubject,
                originalBody
            );

            // Send reply
            await transporter.sendMail({
                from: `"${account.display_name || account.email}" <${account.email}>`,
                to: fromAddress,
                subject,
                text: body,
                inReplyTo: email.messageId,
                references: email.messageId,
            });

            console.log(`[AutoReply] ✅ Replied from ${account.email} → ${fromAddress}`);

            // Update reputation score
            const newRep = Math.min(100, (account.reputation_score || 70) + 0.3);
            await supabase
                .from("accounts")
                .update({
                    reputation_score: newRep,
                    last_active_at: new Date().toISOString(),
                })
                .eq("id", account.id);

            // Log the reply
            const { error: logErr } = await supabase.from("warmup_logs").insert({
                from_account_id: account.id,
                from_email: account.email,
                to_email: fromAddress,
                event_type: "reply",
                subject,
                result: "success",
            });
            if (logErr) console.warn("[AutoReply] Log skipped:", logErr.message);

            // Humanlike delay between replies
            await delay(randomBetween(4000, 9000));

        } catch (err) {
            console.error(`[AutoReply] Failed to reply to an email for ${account.email}:`, err);
        }
    }
}

// ─────────────────────────────────────────────
// IMAP: fetch UNSEEN emails from INBOX
// Marks them as SEEN after fetching
// ─────────────────────────────────────────────
function fetchUnseenEmails(account: any): Promise<ParsedMail[]> {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: account.email,
            password: account.app_password,
            host: account.imap_host || deriveImapHost(account.smtp_host),
            port: account.imap_port || 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000,
        });

        const emails: ParsedMail[] = [];

        imap.once("ready", () => {
            imap.openBox("INBOX", false, (err, _box) => {
                if (err) { imap.end(); return reject(err); }

                imap.search(["UNSEEN"], (searchErr, uids) => {
                    if (searchErr) { imap.end(); return reject(searchErr); }

                    if (!uids || uids.length === 0) {
                        imap.end();
                        return resolve([]);
                    }

                    // Process up to 10 at a time to avoid overload
                    const batch = uids.slice(0, 10);
                    const fetch = imap.fetch(batch, { bodies: "", markSeen: true });
                    const parsePromises: Promise<void>[] = [];

                    fetch.on("message", (msg) => {
                        const p = new Promise<void>((res) => {
                            let rawBuffer = "";
                            msg.on("body", (stream) => {
                                stream.on("data", (chunk: Buffer) => { rawBuffer += chunk.toString("utf8"); });
                                stream.once("end", async () => {
                                    try {
                                        const parsed = await simpleParser(rawBuffer);
                                        emails.push(parsed);
                                    } catch (e) {
                                        console.warn("[AutoReply] Failed to parse email:", e);
                                    }
                                    res();
                                });
                            });
                        });
                        parsePromises.push(p);
                    });

                    fetch.once("error", (fetchErr: Error) => {
                        imap.end();
                        reject(fetchErr);
                    });

                    fetch.once("end", async () => {
                        await Promise.all(parsePromises);
                        imap.end();
                        resolve(emails);
                    });
                });
            });
        });

        imap.once("error", (err: Error) => reject(err));
        imap.once("end", () => { });
        imap.connect();
    });
}

// ─────────────────────────────────────────────
// OpenAI: generate a natural reply
// ─────────────────────────────────────────────
async function generateAIReply(
    fromEmail: string,
    toEmail: string,
    originalSubject: string,
    originalBody: string
): Promise<{ subject: string; body: string }> {
    const senderName = nameFromEmail(fromEmail);
    const recipientName = nameFromEmail(toEmail);
    const greeting = recipientName ? `Hi ${recipientName},` : 'Hey,';
    const signoff = senderName ? `\n\nCheers,\n${senderName}` : '';
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are writing a short, natural reply to an email.
Rules (STRICT):
- Write ONLY the middle body content (1-3 sentences). No greeting or sign-off — those are added separately.
- NEVER use placeholders like [name], {name}, [your name], {{recipient}}, or ANY bracket/brace variables. Use actual words instead, or omit names.
- Keep it casual, brief, warm, and contextually relevant.
- Do not mention AI, warmup, or automation.
- Plain text only — no markdown.`
                },
                {
                    role: "user",
                    content: `Write a short reply body (middle content only) to this email.
From: ${toEmail}
To: ${fromEmail}
Subject: ${originalSubject}
Body: ${originalBody.slice(0, 300)}`
                }
            ],
            temperature: 0.85,
        });

        const raw = completion.choices[0].message.content ?? "";
        const cleaned = stripPlaceholders(raw.replace(/```json|```/g, "").trim());

        return {
            subject: originalSubject.startsWith("Re:") ? originalSubject : `Re: ${originalSubject}`,
            body: `${greeting}\n\n${cleaned}${signoff}`,
        };

    } catch (err) {
        console.warn("[AutoReply] OpenAI failed, using fallback:", err);
        return generateFallbackReply(originalSubject, greeting, signoff);
    }
}

// ─────────────────────────────────────────────
// Check warmup_logs to avoid double-replying
// ─────────────────────────────────────────────
async function checkAlreadyReplied(
    fromEmail: string,
    toEmail: string,
    subject: string
): Promise<boolean> {
    const { data, error } = await supabase
        .from("warmup_logs")
        .select("id")
        .eq("from_email", fromEmail)
        .eq("to_email", toEmail)
        .eq("event_type", "reply")
        .ilike("subject", `%${subject.replace("Re: ", "").slice(0, 30)}%`)
        .limit(1);

    if (error) return false; // If table missing, proceed anyway
    return (data?.length ?? 0) > 0;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

// Derive IMAP host from SMTP host (works for most providers)
function deriveImapHost(smtpHost: string): string {
    if (!smtpHost) return "imap.gmail.com";
    return smtpHost.replace("smtp.", "imap.");
}

function extractEmail(raw: string): string {
    const match = raw.match(/<(.+?)>/) || raw.match(/[\w.-]+@[\w.-]+\.\w+/);
    return match ? match[1] ?? match[0] : raw.trim();
}

function generateFallbackReply(originalSubject: string, greeting = 'Hey,', signoff = ''): { subject: string; body: string } {
    const bodies = [
        "Thanks for reaching out! I'll get back to you shortly with more details.",
        "Got your message — will follow up soon.",
        "Appreciate you sending this over. Let's connect soon.",
        "Thanks for the heads up — will take a look and circle back.",
        "Got it, thanks! I'll review and respond shortly.",
    ];
    return {
        subject: originalSubject.startsWith("Re:") ? originalSubject : `Re: ${originalSubject}`,
        body: `${greeting}\n\n${bodies[Math.floor(Math.random() * bodies.length)]}${signoff}`,
    };
}

function randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}