/**
 * Seed Account Reply Service
 * 
 * This service checks each seed account's INBOX for warmup emails received
 * from primary accounts, then generates and sends AI-powered threaded replies
 * to simulate natural human conversation and boost deliverability.
 * 
 * Supports:
 *  - Gmail accounts (via OAuth / Gmail API)
 *  - SMTP/IMAP accounts (via ImapFlow + Nodemailer)
 */

import { supabase } from '../../supabase'
import { SeedAccount, ImapConfig, SmtpConfig } from './types'
import { extractEmail } from '../../utils'
import { generateWarmupReply } from './openai'
import { getAccessToken, sendGmailMessage, markAsImportant } from './gmail'
import { sendSmtpMessage } from './smtp'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'

const REPLY_PROBABILITY = 0.7  // 70% chance a seed replies to any given email
const MAX_EMAILS_PER_RUN = 8   // Max emails to reply to per seed per run
const REPLY_DELAY_MIN = 5_000  // 5 seconds minimum delay between replies
const REPLY_DELAY_MAX = 20_000 // 20 seconds maximum delay between replies

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point — called by engine.ts
// ─────────────────────────────────────────────────────────────────────────────

export async function processSeedReplies(seeds: SeedAccount[], primaryEmails: string[]): Promise<void> {
  console.log(`[SeedReply] Processing replies for ${seeds.length} seed account(s)...`)

  for (const seed of seeds) {
    try {
      await processOneSeed(seed, primaryEmails)
      await delay(randomBetween(2_000, 5_000))
    } catch (err: any) {
      console.error(`[SeedReply] Error processing seed ${seed.email}:`, err.message)
    }
  }

  console.log('[SeedReply] Done processing seed replies.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-seed logic
// ─────────────────────────────────────────────────────────────────────────────

async function processOneSeed(seed: SeedAccount, primaryEmails: string[]): Promise<void> {
  console.log(`[SeedReply] Checking inbox for seed: ${seed.email}`)

  // Fetch warmup emails unread in this seed's inbox
  const inboxEmails = seed.type === 'gmail'
    ? await fetchGmailInboxWarmups(seed, primaryEmails)
    : await fetchImapInboxWarmups(seed, primaryEmails)

  if (inboxEmails.length === 0) {
    console.log(`[SeedReply]   No pending warmup emails for ${seed.email}`)
    return
  }

  console.log(`[SeedReply]   Found ${inboxEmails.length} warmup email(s) to reply to from ${seed.email}`)

  let repliedCount = 0
  for (const email of inboxEmails) {
    if (repliedCount >= MAX_EMAILS_PER_RUN) break

    // Skip randomly to vary reply rate (simulate human behavior)
    if (Math.random() > REPLY_PROBABILITY) {
      console.log(`[SeedReply]   Skipping ${email.from} (random skip)`)
      continue
    }

    // Skip if we've already replied to this thread today
    const alreadyReplied = await hasAlreadyReplied(seed.email, email.from, email.subject)
    if (alreadyReplied) {
      console.log(`[SeedReply]   Already replied to ${email.from} — skipping`)
      continue
    }

    try {
      // Generate AI reply using the original email context
      const replyBody = await generateWarmupReply(email.subject, email.body, seed.email, email.from)
      const replySubject = email.subject.toLowerCase().startsWith('re:')
        ? email.subject
        : `Re: ${email.subject}`

      // Send the reply
      if (seed.type === 'gmail') {
        await sendGmailReply(seed, email, replySubject, replyBody)
      } else {
        await sendSmtpReply(seed, email, replySubject, replyBody)
      }

      // Log the reply in warmup_logs
      await supabase.from('warmup_logs').insert({
        from_email: seed.email,
        to_email: email.from,
        from_account_id: seed.id,
        from_account_type: 'seed',
        to_account_type: 'primary',
        subject: replySubject,
        event_type: 'replied',
        result: 'success',
        message_id: email.messageId || null
      })

      console.log(`[SeedReply]   ✅ Replied: ${seed.email} → ${email.from}`)
      repliedCount++

      // Human-like delay between replies
      await delay(randomBetween(REPLY_DELAY_MIN, REPLY_DELAY_MAX))

    } catch (err: any) {
      console.error(`[SeedReply]   ❌ Reply failed from ${seed.email} to ${email.from}:`, err.message)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gmail inbox fetching (via Gmail API)
// ─────────────────────────────────────────────────────────────────────────────

interface InboxEmail {
  messageId: string
  threadId: string
  from: string
  subject: string
  body: string
}

async function fetchGmailInboxWarmups(seed: SeedAccount, primaryEmails: string[]): Promise<InboxEmail[]> {
  if (!seed.gmail_refresh_token) return []

  try {
    const accessToken = await getAccessToken(seed.gmail_refresh_token)
    const BASE = 'https://gmail.googleapis.com/gmail/v1'

    // Query for UNREAD warmup messages in the inbox
    const query = encodeURIComponent('is:unread label:inbox header:X-WarmGrid-Warmup:true')
    const listRes = await fetch(`${BASE}/users/me/messages?q=${query}&maxResults=20`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    const listData = await listRes.json() as any
    if (!listData.messages || listData.messages.length === 0) return []

    const results: InboxEmail[] = []

    for (const msg of listData.messages.slice(0, MAX_EMAILS_PER_RUN)) {
      try {
        const detailRes = await fetch(`${BASE}/users/me/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        })
        const detail = await detailRes.json() as any
        const headers = detail.payload?.headers || []

        const from = headers.find((h: any) => h.name === 'From')?.value || ''
        const subject = headers.find((h: any) => h.name === 'Subject')?.value || 'No Subject'
        const messageId = headers.find((h: any) => h.name.toLowerCase() === 'message-id')?.value || ''
        const threadId = detail.threadId || ''

        // Extract sender email address
        const fromEmail = extractEmail(from)

        // Only reply if the sender is a known primary account
        const isFromPrimary = primaryEmails.some(e => e.toLowerCase() === fromEmail.toLowerCase())
        if (!isFromPrimary) continue

        // Decode body
        let body = ''
        if (detail.payload?.body?.data) {
          body = Buffer.from(detail.payload.body.data, 'base64').toString()
        } else if (detail.payload?.parts) {
          const part = detail.payload.parts.find((p: any) => p.mimeType === 'text/plain') || detail.payload.parts[0]
          if (part?.body?.data) body = Buffer.from(part.body.data, 'base64').toString()
        }

        results.push({ messageId, threadId, from: fromEmail, subject, body: body.slice(0, 800) })

        // Mark as read to avoid re-fetching
        await fetch(`${BASE}/users/me/messages/${msg.id}/modify`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] })
        })

      } catch (e: any) {
        console.warn(`[SeedReply] Gmail detail fetch failed for message ${msg.id}:`, e.message)
      }
    }

    return results
  } catch (err: any) {
    console.error(`[SeedReply] Gmail inbox fetch failed for ${seed.email}:`, err.message)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAP inbox fetching (for SMTP accounts)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchImapInboxWarmups(seed: SeedAccount, primaryEmails: string[]): Promise<InboxEmail[]> {
  if (!seed.imap_host || !seed.smtp_password) return []

  const config: ImapConfig = {
    host: seed.imap_host,
    port: seed.imap_port || 993,
    username: seed.smtp_username || seed.email,
    password: seed.smtp_password,
    encryption: (seed.smtp_encryption as any) || 'SSL/TLS'
  }

  return new Promise((resolve) => {
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.encryption === 'SSL/TLS',
      auth: { user: config.username, pass: config.password },
      logger: false,
      tls: config.encryption === 'STARTTLS' ? { rejectUnauthorized: false } : undefined
    })

    const results: InboxEmail[] = []

    client.connect().then(async () => {
      try {
        const lock = await client.getMailboxLock('INBOX')
        try {
          // Fetch UNSEEN messages with warmup header
          const seqNums: number[] = []
          for await (const msg of client.fetch({ seen: false }, { envelope: true, source: true, headers: ['X-WarmGrid-Warmup', 'Message-ID'] })) {
            const headerStr = msg.headers?.toString() || ''
            if (!headerStr.toLowerCase().includes('x-warmgrid-warmup')) continue

            const from = msg.envelope?.from?.[0]?.address || ''
            const isFromPrimary = primaryEmails.some(e => e.toLowerCase() === from.toLowerCase())
            if (!isFromPrimary) continue

            // Parse the full raw message
            try {
              const parsed = await simpleParser(msg.source as any)
              const body = (parsed.text || '').slice(0, 800)
              const messageId = parsed.messageId || headerStr.match(/Message-ID:\s*(.+)/i)?.[1]?.trim() || ''

              results.push({
                messageId,
                threadId: messageId,
                from,
                subject: parsed.subject || 'No Subject',
                body
              })

              seqNums.push(msg.seq)
            } catch (parseErr: any) {
              console.warn(`[SeedReply] IMAP parse error for ${seed.email}:`, parseErr.message)
            }

            if (results.length >= MAX_EMAILS_PER_RUN) break
          }

          // Mark fetched messages as seen
          if (seqNums.length > 0) {
            await client.messageFlagsAdd({ seq: seqNums.join(',') }, ['\\Seen'])
          }

        } finally {
          lock.release()
        }
      } catch (err: any) {
        console.error(`[SeedReply] IMAP inbox open failed for ${seed.email}:`, err.message)
      }

      await client.logout()
      resolve(results)
    }).catch((err: any) => {
      console.error(`[SeedReply] IMAP connect failed for ${seed.email}:`, err.message)
      resolve([])
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Send reply helpers
// ─────────────────────────────────────────────────────────────────────────────

async function sendGmailReply(seed: SeedAccount, email: InboxEmail, subject: string, body: string): Promise<void> {
  const accessToken = await getAccessToken(seed.gmail_refresh_token!)
  const result = await sendGmailMessage({
    accessToken,
    from: seed.email,
    to: email.from,
    subject,
    body,
    warmupHeader: true,
    threadId: email.threadId,
    inReplyTo: email.messageId,
    references: email.messageId
  })
  // Mark the replied thread as important/starred to signal good engagement
  if (result.messageId) {
    await markAsImportant(accessToken, result.messageId).catch(() => {})
  }
}

async function sendSmtpReply(seed: SeedAccount, email: InboxEmail, subject: string, body: string): Promise<void> {
  const config: SmtpConfig = {
    host: seed.smtp_host!,
    port: seed.smtp_port || 587,
    username: seed.smtp_username || seed.email,
    password: seed.smtp_password!,
    encryption: (seed.smtp_encryption as any) || 'STARTTLS'
  }
  await sendSmtpMessage({
    config,
    from: seed.email,
    to: email.from,
    subject,
    body,
    warmupHeader: true,
    inReplyTo: email.messageId,
    references: email.messageId
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

async function hasAlreadyReplied(fromEmail: string, toEmail: string, subject: string): Promise<boolean> {
  const baseSubject = subject.replace(/^Re:\s*/i, '').slice(0, 40)
  const { data } = await supabase
    .from('warmup_logs')
    .select('id')
    .eq('from_email', fromEmail)
    .eq('to_email', toEmail)
    .eq('event_type', 'replied')
    .ilike('subject', `%${baseSubject}%`)
    .limit(1)
  return (data?.length ?? 0) > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
