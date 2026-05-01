import { supabase } from '../../supabase'
import { EmailAccount, SeedAccount, EventType } from './types'
import { getAccessToken, sendGmailMessage, listSpamMessages, rescueFromSpam, markAsImportant, getMessageDetails } from './gmail'
import { sendSmtpMessage } from './smtp'
import { searchSpamFolder, moveToInbox } from './imap'
import { getOptimalPairs, updatePairRecord } from './pairs'
import { calculateReputation } from './reputation'
import { sendAlert } from './alerts'
import { generateWarmupEmail, generateWarmupReply } from './openai'
import { processSeedReplies } from './seedReplyService'

export async function runWarmupForUser() {
  console.log('[Engine] Starting warmup run for all accounts...')

  // 1. Load: Fetch all active warmup-enabled accounts and active seeds
  const { data: accounts, error: aErr } = await supabase
    .from('accounts')
    .select('*')
    .eq('warmup_enabled', true)
    .in('warmup_status', ['active', 'inactive'])

  const { data: seeds, error: sErr } = await supabase
    .from('seed_accounts')
    .select('*')
    .eq('status', 'active')

  if (aErr || sErr) {
    console.error('[Engine] Load failed:', aErr?.message || sErr?.message)
    return
  }

  if (!seeds || seeds.length === 0) {
    console.warn('[Engine] No seed accounts found. Aborting.')
    return
  }

  // Shuffle both arrays so every run picks a different rotation order
  // This ensures no single account always gets priority
  function shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  const shuffledAccounts = shuffle([...(accounts as EmailAccount[])]);
  const shuffledSeeds   = shuffle([...(seeds as SeedAccount[])]);

  console.log(`[Engine] Rotating: ${shuffledAccounts.length} account(s), ${shuffledSeeds.length} seed(s)`)

  // 2. Process Quota & Timing for each account
  for (const account of shuffledAccounts) {
    try {
      if (!isWithinWindow(account)) {
        console.log(`[Engine] Skipping ${account.email}: Outside send window.`)
        continue
      }

      let dailySent = account.warmup_daily_sent || 0;
      if (account.warmup_last_active) {
        const lastActiveDate = new Date(account.warmup_last_active).toISOString().split('T')[0];
        const todayDate = new Date().toISOString().split('T')[0];
        if (lastActiveDate !== todayDate) {
          dailySent = 0;
          await supabase.from('accounts').update({ warmup_daily_sent: 0 }).eq('id', account.id);
          account.warmup_daily_sent = 0;
        }
      }

      const quota = Math.min(account.warmup_ramp_day * 2 || 2, account.warmup_daily_limit || 40)
      if (dailySent >= quota) {
        console.log(`[Engine] Skipping ${account.email}: Daily quota reached.`)
        continue
      }

      // 2.2 Smart Throttling: Minimum 30 min between sends
      if (account.warmup_last_active) {
        const lastActive = new Date(account.warmup_last_active).getTime()
        const thirtyMins = 30 * 60 * 1000
        if (Date.now() - lastActive < thirtyMins) {
          console.log(`[Engine] Skipping ${account.email}: Sent too recently (min 30 min interval).`)
          continue
        }
      }

      // 3. Send Warmup Email
      const { data: existingPairs } = await supabase.from('warmup_pairs').select('*').eq('from_account_id', account.id)
      
      // Fetch today's logs for this account to check per-recipient quota
      const todayStart = new Date()
      todayStart.setHours(0,0,0,0)
      const { data: todayLogs } = await supabase.from('warmup_logs')
        .select('to_email')
        .eq('from_account_id', account.id)
        .gte('created_at', todayStart.toISOString())

      const sendCounts: Record<string, number> = {}
      todayLogs?.forEach(l => {
        sendCounts[l.to_email] = (sendCounts[l.to_email] || 0) + 1
      })

      const optimalSeeds = getOptimalPairs({
        primaryAccount: account,
        seedAccounts: (seeds as SeedAccount[]).filter(s => (sendCounts[s.email] || 0) < 2),
        existingPairs: existingPairs || [],
        count: 1
      })

      if (optimalSeeds.length > 0) {
        const target = optimalSeeds[0]
        const template = await generateWarmupEmail(account.email, target.email)
        
        console.log(`[Engine] Sending AI-generated warmup from ${account.email} to ${target.email}...`)
        
        let messageId = ''
        try {
          if (account.type === 'gmail') {
            const token = await getAccessToken(account.gmail_refresh_token!)
            const res = await sendGmailMessage({
              accessToken: token, from: account.email, to: target.email,
              subject: template.subject, body: template.body, warmupHeader: true
            })
            messageId = res.messageId
          } else {
            const res = await sendSmtpMessage({
              config: {
                host: account.smtp_host!, 
                port: account.smtp_port!,
                username: account.smtp_username || account.email,
                password: account.smtp_password || (account as any).app_password,
                encryption: account.smtp_encryption as any
              },
              from: account.email, to: target.email, 
              subject: template.subject, body: template.body, warmupHeader: true
            })
            messageId = res.messageId
          }

          // 4. On Success: Log and update
          await supabase.from('warmup_logs').insert({
            from_email: account.email, to_email: target.email,
            from_account_id: account.id, to_account_id: target.id,
            from_account_type: 'primary', to_account_type: 'seed',
            subject: template.subject, event_type: 'sent', result: 'success', message_id: messageId
          })

          await supabase.from('accounts').update({
            warmup_daily_sent: account.warmup_daily_sent + 1,
            warmup_last_active: new Date().toISOString()
          }).eq('id', account.id)

          await updatePairRecord(supabase, { fromId: account.id, toId: target.id, fromType: 'primary', toType: 'seed' })

        } catch (err: any) {
          console.error(`[Engine] Send failed from ${account.email}:`, err.message)
          // Log bounce
          await supabase.from('warmup_logs').insert({
            from_email: account.email, to_email: target.email,
            from_account_id: account.id, to_account_id: target.id,
            event_type: 'bounce', result: err.message
          })
          // Check bounce rate (simplified: check last 20 logs)
          const { data: recentLogs } = await supabase.from('warmup_logs').select('*').eq('from_account_id', account.id).limit(20)
          const bounces = (recentLogs || []).filter(l => l.event_type === 'bounce').length
          if (bounces > 1 && account.warmup_auto_pause) { // >5% of 20
            await supabase.from('accounts').update({ warmup_status: 'paused' }).eq('id', account.id)
            await sendAlert({ 
              toEmail: process.env.ALERT_EMAIL || account.email, 
              eventType: 'bounce', 
              accountEmail: account.email, 
              message: 'High bounce rate detected. Warmup auto-paused.' 
            })
          }
        }
      }
    } catch (e: any) {
      console.error(`[Engine] Error processing account ${account.email}:`, e.message)
    }
  }

  // Seeds do NOT send — they only receive, reply, and rescue from spam.
  // Outbound warmup emails are sent by primary accounts only (above).

  // 6. Auto reply & Spam rescue
  await processRescues(accounts, seeds)
  
  // 7. Seed account inbox check: reply to warmup emails received from primary accounts
  const primaryEmails = (accounts as EmailAccount[]).map(a => a.email)
  await processSeedReplies(seeds as SeedAccount[], primaryEmails)

  // 8. Reputation calculation & Ramp
  await updateReputations(accounts)

  console.log('[Engine] Warmup run completed.')
}

async function processRescues(accounts: EmailAccount[], seeds: SeedAccount[]) {
  // Combine all accounts to check
  const all = [...accounts, ...seeds]
  for (const acc of all) {
    if (acc.type === 'recipient') continue;
    // For primary accounts, check the toggle. For seeds, always rescue (passive pool).
    const isPrimary = 'warmup_auto_rescue' in acc;
    if (isPrimary && !acc.warmup_auto_rescue) continue;

    try {
      if (acc.type === 'gmail') {
        const token = await getAccessToken(acc.gmail_refresh_token!)
        const spams = await listSpamMessages(token)
        for (const msgId of spams) {
          const details = await getMessageDetails(token, msgId)
          const isFromSeed = seeds.some(s => s.email.toLowerCase() === details.from.toLowerCase())
          
          await rescueFromSpam(token, msgId)
          await supabase.from('warmup_logs').insert({ 
            from_email: details.from, to_email: acc.email, to_account_id: acc.id, 
            event_type: 'rescue', result: 'Inboxed' 
          })
          console.log(`[Engine] Rescued Gmail message for ${acc.email} from ${details.from}`)
          
          // Auto reply ONLY if from an active seed OR an active primary account
          const senderIsActiveSeed = seeds.some(s => s.email.toLowerCase() === details.from.toLowerCase() && s.status === 'active')
          const senderIsActivePrimary = accounts.some(a => a.email.toLowerCase() === details.from.toLowerCase() && a.warmup_status === 'active')
          
          const canReply = isPrimary ? acc.warmup_auto_reply : true;
          if (canReply && (senderIsActiveSeed || senderIsActivePrimary) && Math.random() > 0.4) {
             const reply = await generateWarmupReply(details.subject, details.body, acc.email, details.from)
             await sendGmailMessage({ 
               accessToken: token, 
               from: acc.email, 
               to: details.from, 
               subject: details.subject.toLowerCase().startsWith('re:') ? details.subject : `Re: ${details.subject}`, 
               body: reply,
               threadId: details.threadId,
               inReplyTo: details.msgId,
               references: details.msgId
             })
             await markAsImportant(token, msgId)
             console.log(`[Engine] Sent OpenAI threaded auto-reply from ${acc.email} to active sender ${details.from}`)
          }
        }
      } else {
        const imapConfig = { host: acc.imap_host!, port: acc.imap_port!, username: acc.smtp_username!, password: acc.smtp_password!, encryption: acc.smtp_encryption as any }
        const spams = await searchSpamFolder(imapConfig)
        for (const msg of spams) {
          const isFromSeed = seeds.some(s => s.email.toLowerCase() === msg.from.toLowerCase())
          
          await moveToInbox(imapConfig, msg.uid)
          await supabase.from('warmup_logs').insert({ 
            from_email: msg.from, to_email: acc.email, to_account_id: acc.id, 
            event_type: 'rescue', result: 'Inboxed' 
          })
          console.log(`[Engine] Rescued SMTP/IMAP message for ${acc.email} from ${msg.from}`)

          // Auto reply ONLY if from an active seed OR an active primary account
          const senderIsActiveSeed = seeds.some(s => s.email.toLowerCase() === msg.from.toLowerCase() && s.status === 'active')
          const senderIsActivePrimary = accounts.some(a => a.email.toLowerCase() === msg.from.toLowerCase() && a.warmup_status === 'active')
          
          const canReply = isPrimary ? acc.warmup_auto_reply : true;
          if (canReply && (senderIsActiveSeed || senderIsActivePrimary) && Math.random() > 0.4) {
             const reply = await generateWarmupReply(msg.subject, msg.body, acc.email, msg.from)
             await sendSmtpMessage({ 
               config: {
                 host: acc.smtp_host!, 
                 port: acc.smtp_port!, 
                 username: acc.smtp_username || acc.email, 
                 password: acc.smtp_password || (acc as any).app_password, 
                 encryption: acc.smtp_encryption as any,
               },
               from: acc.email, 
               to: msg.from, 
               subject: msg.subject.toLowerCase().startsWith('re:') ? msg.subject : `Re: ${msg.subject}`, 
               body: reply,
               warmupHeader: true,
               inReplyTo: msg.messageId,
               references: msg.messageId
             })
             console.log(`[Engine] Sent OpenAI threaded SMTP auto-reply from ${acc.email} to active sender ${msg.from}`)
          }
        }
      }
    } catch (e) {}
  }
}

async function updateReputations(accounts: any[]) {
  for (const acc of accounts) {
    const { data: logs } = await supabase
      .from('warmup_logs')
      .select('*')
      .or(`from_account_id.eq.${acc.id},to_account_id.eq.${acc.id}`)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    
    const sent = (logs || []).filter(l => l.from_account_id === acc.id && l.event_type === 'sent').length
    const bounces = (logs || []).filter(l => l.from_account_id === acc.id && l.event_type === 'bounce').length
    const rescues = (logs || []).filter(l => l.to_account_id === acc.id && l.event_type === 'rescue').length
    const replies = (logs || []).filter(l => l.to_account_id === acc.id && l.event_type === 'replied').length

    const newScore = calculateReputation({
      totalSent: sent,
      spamDetected: rescues, // proxy for spam detected
      totalReplied: replies,
      spamRescued: rescues,
      rampDay: acc.warmup_ramp_day,
      rampTarget: acc.warmup_ramp_target
    })

    await supabase.from('accounts').update({ warmup_reputation: newScore }).eq('id', acc.id)
    await supabase.from('reputation_history').insert({ account_id: acc.id, score: newScore })

    // Ramp increment
    if (sent >= Math.min(acc.warmup_ramp_day * 2 || 2, acc.warmup_daily_limit)) {
      if (acc.warmup_ramp_day < acc.warmup_ramp_target) {
        await supabase.from('accounts').update({ warmup_ramp_day: acc.warmup_ramp_day + 1, warmup_daily_sent: 0 }).eq('id', acc.id)
      } else {
        await supabase.from('accounts').update({ warmup_status: 'completed' }).eq('id', acc.id)
        await sendAlert({ toEmail: process.env.ALERT_EMAIL || acc.email, eventType: 'sent', accountEmail: acc.email, message: 'Warmup ramp strategy completed!' })
      }
    }
  }
}

function isWithinWindow(acc: EmailAccount) {
  const now = new Date()
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(now)
  if (!acc.warmup_active_days.includes(day)) return false
  
  if (acc.warmup_send_window_start === acc.warmup_send_window_end) return true;

  const [hStart, mStart] = acc.warmup_send_window_start.split(':').map(Number)
  const [hEnd, mEnd] = acc.warmup_send_window_end.split(':').map(Number)
  const start = hStart * 60 + mStart
  const end = hEnd * 60 + mEnd
  const current = now.getHours() * 60 + now.getMinutes()
  
  return current >= start && current <= end
}
