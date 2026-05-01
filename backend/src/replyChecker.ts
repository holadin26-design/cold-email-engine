import imapSimple from "imap-simple";
import { supabase } from "./supabase";
import { ReplyClassifier } from "./services/replyClassifier";
import { simpleParser } from "mailparser";
import dotenv from "dotenv";
import { extractEmail } from "./utils";

dotenv.config();

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export async function startReplyChecker() {
    console.log("[ReplyChecker] Started. Polling IMAP every 10 minutes.");
    checkReplies();
    setInterval(checkReplies, POLL_INTERVAL_MS);
}

export async function checkReplies() {
    try {
        console.log("[ReplyChecker] Polling IMAP for replies...");

        const { data: accounts, error: aErr } = await supabase
            .from("accounts")
            .select("*");

        if (aErr) throw aErr;
        if (!accounts || accounts.length === 0) return;

        // Fetch ALL leads that haven't yet replied — regardless of status.
        // We use iterative fetching to bypass the 1000-row limit.
        const allSentLeads = await fetchAllSentLeads();

        if (!allSentLeads || allSentLeads.length === 0) {
            console.log("[ReplyChecker] No unread leads to check.");
            return;
        }

        // Subset with a stored message_id (for thread-based matching)
        const sentLeadsWithMsgId = allSentLeads.filter(l => l.message_id);

        console.log(`[ReplyChecker] Checking ${allSentLeads.length} sent leads for new replies...`);

        // Build message_id → lead lookup (for threading-based matching)
        const messageIdMap = new Map<string, { id: string; email: string }>();
        // Build email → lead lookup (fallback for replies to follow-ups whose msg_id isn't stored)
        const emailMap = new Map<string, { id: string; email: string }>();

        for (const lead of (sentLeadsWithMsgId || [])) {
            if (lead.message_id) {
                const key = lead.message_id.replace(/[<>]/g, "").trim();
                messageIdMap.set(key, { id: lead.id, email: lead.email });
            }
        }

        // Build emailMap from ALL sent leads (not just those with message_id)
        // This ensures we catch replies to follow-up emails
        for (const lead of allSentLeads) {
            if (lead.email) {
                emailMap.set(lead.email.toLowerCase().trim(), { id: lead.id, email: lead.email });
            }
        }

        for (const account of accounts) {
            try {
                await checkAccountReplies(account, messageIdMap, emailMap);
            } catch (err) {
                console.error(`[ReplyChecker] Error checking ${account.email}:`, err);
            }
        }
    } catch (err) {
        console.error("[ReplyChecker] Unexpected error:", err);
    }
}

async function fetchAllSentLeads() {
    let allLeads: any[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        
        const { data, error } = await supabase
            .from("leads")
            .select("id, message_id, email, campaign_id")
            .is("replied_at", null)
            .not("status", "eq", "replied")
            .not("status", "eq", "bounced")
            .range(from, to);
            
        if (error) {
            console.error("[ReplyChecker] Error fetching leads page:", error);
            break;
        }
        
        if (!data || data.length === 0) break;
        
        allLeads = allLeads.concat(data);
        
        if (data.length < pageSize) break; // Last page
        page++;
    }
    
    return allLeads;
}

async function checkAccountReplies(
    account: any,
    messageIdMap: Map<string, { id: string; email: string }>,
    emailMap: Map<string, { id: string; email: string }>
) {
    const config = {
        imap: {
            user: account.email,
            password: account.app_password,
            host: account.imap_host,
            port: account.imap_port || 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 10000,
        },
    };

    let connection: any;
    try {
        connection = await imapSimple.connect(config);
        
        // Listen for socket errors during the session to prevent crashes
        connection.on('error', (err: any) => {
            console.error(`[ReplyChecker] IMAP connection error for ${account.email}:`, err);
        });

        await connection.openBox("INBOX");

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const since = thirtyDaysAgo.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "2-digit",
        });

        const searchCriteria = [["SINCE", since]];
        const fetchOptions = {
            bodies: [""], // Fetch full RFC822 message so mailparser can decode it properly
            struct: false,
        };

        const messages = await connection.search(searchCriteria, fetchOptions);

        for (const message of messages) {
            const fullPart = message.parts.find((p: any) => p.which === "");
            if (!fullPart) continue;

            // Use mailparser to properly decode Gmail's multipart/quoted-printable messages
            let parsed: any;
            try {
                parsed = await simpleParser(fullPart.body);
            } catch (parseErr) {
                console.error("[ReplyChecker] Failed to parse message:", parseErr);
                continue;
            }

            let inReplyToStr = "";
            if (typeof parsed.inReplyTo === "string") inReplyToStr = parsed.inReplyTo;
            else if (Array.isArray(parsed.inReplyTo)) inReplyToStr = parsed.inReplyTo[0] || "";
            const inReplyTo = inReplyToStr.replace(/[<>]/g, "").trim();
            let parsedRefs = parsed.references || [];
            if (typeof parsedRefs === "string") parsedRefs = [parsedRefs];
            const references: string[] = parsedRefs.map((r: string) => r.replace(/[<>]/g, "").trim());
            const fromHeader = parsed.from?.text || "";
            const fromEmail = parsed.from?.value?.[0]?.address || extractEmail(fromHeader);
            const rawBody: string = parsed.text || ""; // mailparser gives us clean decoded plain text

            // ── 1. Skip emails FROM our own sending account (self-sends / outbound copies) ──
            if (!fromEmail || fromEmail.toLowerCase() === account.email.toLowerCase()) continue;

            // -- 1.5 Handle bounce notifications from system senders --
            const bounceSenders = ["mailer-daemon", "postmaster"];
            const isBounceNotification = bounceSenders.some(s => fromEmail.toLowerCase().includes(s));

            if (isBounceNotification) {
                // Try to find the original lead this bounce is for using message-ID references
                const refIds = new Set<string>([
                    ...(parsed.references ? (typeof parsed.references === 'string' ? [parsed.references] : parsed.references) : []),
                    ...(parsed.inReplyTo ? (typeof parsed.inReplyTo === 'string' ? [parsed.inReplyTo] : parsed.inReplyTo) : [])
                ].map((r: string) => r.replace(/[<>]/g, "").trim()).filter(Boolean));

                let bouncedLead: { id: string; email: string } | undefined;
                for (const refId of refIds) {
                    if (messageIdMap.has(refId)) {
                        bouncedLead = messageIdMap.get(refId)!;
                        break;
                    }
                }

                if (bouncedLead) {
                    console.log(`[ReplyChecker] ⚠️ Bounce notification detected for lead ${bouncedLead.id} (${bouncedLead.email}). Marking as bounced.`);
                    await supabase
                        .from("leads")
                        .update({ status: "bounced" })
                        .eq("id", bouncedLead.id);
                    messageIdMap.delete(bouncedLead.email);
                } else {
                    console.log(`[ReplyChecker] ℹ️ Bounce notification from ${fromEmail} could not be matched to a lead.`);
                }
                continue; // Never treat bounce notifications as human replies
            }

            // Skip other non-reply system senders (no-reply, noreply)
            const otherSystemSenders = ["no-reply", "noreply"];
            if (otherSystemSenders.some(s => fromEmail.toLowerCase().includes(s))) continue;

            // ── 2. Skip messages with no threading headers — they are new outbound emails, not replies ──
            if (!inReplyTo && !references.length) continue;

            // ── 3. Try to match by message-ID threading (most accurate) ──
            const refIds = new Set<string>([
                ...references,
                ...(inReplyTo ? [inReplyTo] : [])
            ].filter(Boolean));

            let matchedLead: { id: string; email: string } | undefined;
            let matchedMsgId = "";
            for (const refId of refIds) {
                if (messageIdMap.has(refId)) {
                    matchedLead = messageIdMap.get(refId)!;
                    matchedMsgId = refId;
                    break;
                }
            }

            // ── 4. Fallback: match by sender email ──
            if (!matchedLead && fromEmail) {
                const cleanFrom = fromEmail.toLowerCase().trim();
                if (emailMap.has(cleanFrom)) {
                    matchedLead = emailMap.get(cleanFrom)!;
                    console.log(`[ReplyChecker] 💡 Matched by sender email for ${fromEmail} (Lead: ${matchedLead.id})`);
                }
            }

            // ── Warmup Rescue Detection ── DISABLED
            /*
            const warmupHeader = headers["x-warmgrid-warmup"]?.[0];
            const isWarmup = !!warmupHeader; // Any presence of the header marks it as warmup
            
            if (isWarmup) {
                console.log(`[ReplyChecker] 🔥 Warmup email detected in ${account.email} from ${fromHeader} (via header). Rescuing...`);
                
                const { error: logErr } = await supabase.from("warmup_logs").insert({
                    user_id: account.user_id,
                    from_email: fromHeader,
                    to_email: account.email,
                    event_type: 'rescue',
                    subject: headers["subject"]?.[0],
                    result: 'Inboxed'
                });
                if (logErr) console.error("[ReplyChecker] Warmup log error:", logErr.message);
                
                // Optional: Auto-reply to boost engagement
                if (Math.random() > 0.5) {
                    await sendWarmupReply(account, fromHeader, headers["message-id"]?.[0]);
                }
                continue;
            }
            */

            if (!matchedLead) continue;

            console.log(
                `[ReplyChecker] Potential reply from ${fromHeader} for lead ${matchedLead.id}. Classifying with rules...`
            );

            // Classify: is this a legitimate human reply?
            const { isHuman, isPositive, sentiment, trimmedBody } = await classifyReply(rawBody);

            if (isHuman) {
                console.log(`[ReplyChecker] ✅ Human reply detected for lead ${matchedLead.id} (Sentiment: ${sentiment}) Body snippet: ${trimmedBody.slice(0, 100)}`);
                
                // Get existing variables to avoid overwriting
                const { data: currentLead } = await supabase
                    .from("leads")
                    .select("variables")
                    .eq("id", matchedLead.id)
                    .single();

                const vars = typeof currentLead?.variables === 'string' 
                    ? JSON.parse(currentLead.variables) 
                    : (currentLead?.variables || {});
                
                vars.reply_body = trimmedBody;
                vars.reply_sentiment = sentiment;
                vars.received_by_account = account.email; // which IMAP account got this reply

                await supabase
                    .from("leads")
                    .update({ 
                        replied_at: new Date().toISOString(), // detection time, not email send time
                        status: "replied",
                        variables: vars
                    })
                    .eq("id", matchedLead.id);

                // Remove from map so we don't re-process
                messageIdMap.delete(matchedMsgId);
            } else {
                console.log(
                    `[ReplyChecker] ⛔ Ignored non-human or auto-reply for lead ${matchedLead.id}.`
                );
            }
        }
    } finally {
        if (connection) {
            try { connection.end(); } catch (_) {}
        }
    }
}

async function classifyReply(emailBody: string): Promise<{ isHuman: boolean; isPositive: boolean; sentiment: string; trimmedBody: string }> {
    // Strip quoted original email, signatures, and headers (keep only the new reply text)
    // We use a more aggressive split to catch common outlook/gmail reply headers
    const trimmedBody = emailBody
        .split(/\n\s*>\s*/)[0] // Strip lines starting with >
        .split(/\n--\s*\n/)[0] // Strip traditional sigs
        .split(/\n-+\s*Original Message\s*-+/i)[0]
        .split(/\nOn\s.*\swrote:/i)[0]
        .split(/\nFrom:\s/i)[0]
        .split(/\nSent:\s/i)[0]
        .trim()
        .slice(0, 1500); // Limit tokens

    if (!trimmedBody) return { isHuman: false, isPositive: false, sentiment: "neutral", trimmedBody: "" };

    const result = ReplyClassifier.classify(trimmedBody);

    return {
        isHuman: !result.isAutoReply,
        isPositive: result.isPositive,
        sentiment: result.sentiment,
        trimmedBody
    };
}

async function sendWarmupReply(account: any, toEmail: string, inReplyTo: string | undefined) {
    const nodemailer = (await import("nodemailer")).default;
    const transporter = nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port,
        secure: account.smtp_port === 465,
        auth: { user: account.email, pass: account.app_password },
    });

    const replies = [
        "Thanks for the update!",
        "Got it, thanks.",
        "That sounds good to me.",
        "I'll take a look and get back to you.",
        "Great, talk soon!"
    ];

    try {
        await transporter.sendMail({
            from: `"${account.display_name || account.email}" <${account.email}>`,
            to: toEmail,
            subject: "Re: Warmup engagement",
            text: replies[Math.floor(Math.random() * replies.length)],
            inReplyTo: inReplyTo,
            references: inReplyTo
        });
        console.log(`[ReplyChecker] Sent warmup reply from ${account.email} to ${toEmail}`);
        
        // Boost reputation slightly more for a successful reply
        const newRep = Math.min(100, (account.reputation_score || 70) + 1.0);
        const { error: upErr } = await supabase.from("accounts").update({ reputation_score: newRep }).eq("id", account.id);
        if (upErr) console.error("[ReplyChecker] Account update error:", upErr.message);
        
    } catch (err) {
        console.error(`[ReplyChecker] Failed to send warmup reply from ${account.email}:`, err);
    }
}
