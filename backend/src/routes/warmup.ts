import { Router } from 'express'
import { supabase } from '../supabase'
import { runWarmupForUser } from '../services/warmup/engine'
import { getAuthUrl, exchangeCodeForTokens } from '../services/warmup/gmail'
import { testSmtpConnection } from '../services/warmup/smtp'
import { testImapConnection } from '../services/warmup/imap'

export const warmupRouter = Router()

// 1. GET /api/warmup/stats
warmupRouter.get('/stats', async (req, res) => {
  try {
    const { data: accounts } = await supabase.from('accounts').select('*')
    const { data: seeds } = await supabase.from('seed_accounts').select('*')
    const { data: recentLogs } = await supabase.from('warmup_logs').select('*').order('created_at', { ascending: false }).limit(20)
    const { data: repHistory } = await supabase.from('reputation_history').select('*').order('recorded_at', { ascending: false }).limit(120)
    
    // Calculate stats
    const avgRep = accounts?.length ? accounts.reduce((acc, curr) => acc + (curr.warmup_reputation || 0), 0) / accounts.length : 0
    const sentToday = accounts?.reduce((acc, curr) => acc + (curr.warmup_daily_sent || 0), 0) || 0
    const activeAccounts = accounts?.filter(a => a.warmup_status === 'active').length || 0
    
    res.json({
      avg_reputation: Math.round(avgRep),
      sent_today: sentToday,
      active_accounts: activeAccounts,
      seed_count: seeds?.length || 0,
      pool_strength: (seeds?.length || 0) > 10 ? 'strong' : (seeds?.length || 0) > 5 ? 'good' : 'weak',
      accounts: accounts || [],
      seeds: seeds || [],
      recent_logs: recentLogs || [],
      reputation_history: repHistory || [],
      daily_sends_history: [] // Placeholder
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 2. POST /api/warmup/engine (CRON)
warmupRouter.post('/engine', async (req, res) => {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  await runWarmupForUser()
  res.json({ success: true })
})

// 3. POST /api/warmup/trigger
warmupRouter.post('/trigger', async (req, res) => {
  // Simple rate limit check: last hour logs
  const { count } = await supabase.from('warmup_logs').select('*', { count: 'exact', head: true }).gt('created_at', new Date(Date.now() - 3600000).toISOString())
  if ((count || 0) > 100) return res.status(429).json({ error: 'Rate limit exceeded' })
  
  runWarmupForUser() // Run async
  res.json({ success: true, triggered_at: new Date().toISOString() })
})

// 4. POST /api/warmup/test-smtp
warmupRouter.post('/test-smtp', async (req, res) => {
  const { smtp_host, smtp_port, smtp_username, smtp_password, smtp_encryption, imap_host, imap_port } = req.body
  const sRes = await testSmtpConnection({ host: smtp_host, port: smtp_port, username: smtp_username, password: smtp_password, encryption: smtp_encryption })
  const iRes = await testImapConnection({ host: imap_host, port: imap_port, username: smtp_username, password: smtp_password, encryption: smtp_encryption })
  res.json({ smtp_ok: sRes.ok, imap_ok: iRes.ok, error: sRes.error || iRes.error })
})

// 5. POST /api/warmup/save-smtp
warmupRouter.post('/save-smtp', async (req, res) => {
  const { email, role, type, ...config } = req.body
  const table = role === 'seed' ? 'seed_accounts' : 'accounts'
  const { data, error } = await supabase.from(table).insert([{ ...config, email, type: type || 'smtp' }]).select()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ account_id: data[0].id })
})

// 5b. POST /api/warmup/connect-supabase-account
warmupRouter.post('/connect-supabase-account', async (req, res) => {
  const { email, provider_token, provider_refresh_token, role } = req.body
  const table = role === 'seed' ? 'seed_accounts' : 'accounts'
  
  // Use upsert to handle re-connections
  const { data, error } = await supabase.from(table).upsert({ 
    email, 
    gmail_refresh_token: provider_refresh_token, 
    type: 'gmail',
    status: 'active'
  }, { onConflict: 'email' }).select()
  
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true, account_id: data[0].id })
})

// 6. GET /api/warmup/gmail-auth
warmupRouter.get('/gmail-auth', (req, res) => {
  const role = (req.query.role as any) || 'primary'
  res.json({ url: getAuthUrl(role) })
})

// 7. GET /api/warmup/gmail-callback
warmupRouter.get('/gmail-callback', async (req, res) => {
  const { code, state } = req.query
  const { role } = JSON.parse(Buffer.from(state as string, 'base64').toString())
  
  try {
    const { refresh_token, access_token } = await exchangeCodeForTokens(code as string)
    // Get user email
    const uRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${access_token}` } })
    const user = await uRes.json() as any
    
    const table = role === 'seed' ? 'seed_accounts' : 'accounts'
    await supabase.from(table).insert([{ email: user.email, gmail_refresh_token: refresh_token, type: 'gmail' }])
    
    res.redirect(`${process.env.FRONTEND_URL}/warmup/accounts?connected=true`)
  } catch (err: any) {
    res.status(500).send(`Auth failed: ${err.message}`)
  }
})

// 8. Lifecycle endpoints
warmupRouter.post('/accounts/:id/pause', async (req, res) => {
  await supabase.from('accounts').update({ warmup_status: 'paused' }).eq('id', req.params.id)
  res.json({ success: true })
})

warmupRouter.post('/accounts/:id/resume', async (req, res) => {
  await supabase.from('accounts').update({ warmup_status: 'active' }).eq('id', req.params.id)
  res.json({ success: true })
})

warmupRouter.delete('/accounts/:id', async (req, res) => {
  const id = req.params.id
  await supabase.from('warmup_pairs').delete().or(`from_account_id.eq.${id},to_account_id.eq.${id}`)
  await supabase.from('warmup_logs').delete().or(`from_account_id.eq.${id},to_account_id.eq.${id}`)
  await supabase.from('reputation_history').delete().eq('account_id', id)
  await supabase.from('accounts').delete().eq('id', id)
  res.json({ success: true })
})

// 9. Logs & Reputation
warmupRouter.get('/logs', async (req, res) => {
  const { type, limit = 50, offset = 0 } = req.query
  let query = supabase.from('warmup_logs').select('*', { count: 'exact' })
  if (type && type !== 'All') query = query.eq('event_type', type.toString().toLowerCase())
  const { data, count } = await query.order('created_at', { ascending: false }).range(Number(offset), Number(offset) + Number(limit))
  res.json({ logs: data, total: count })
})

warmupRouter.get('/reputation/:id', async (req, res) => {
  const { data } = await supabase.from('reputation_history').select('*').eq('account_id', req.params.id).order('recorded_at', { ascending: false }).limit(30)
  res.json(data)
})

warmupRouter.post('/update-settings', async (req, res) => {
  const { account_id, ...payload } = req.body
  
  // Whitelist allowed fields to avoid updating ID or other protected columns
  const allowedFields = [
    'warmup_enabled', 'warmup_status', 'warmup_daily_limit', 'warmup_ramp_target',
    'warmup_send_window_start', 'warmup_send_window_end', 'warmup_active_days',
    'warmup_auto_rescue', 'warmup_auto_reply', 'warmup_auto_pause'
  ]
  
  const settings: any = {}
  for (const key of allowedFields) {
    if (payload[key] !== undefined) settings[key] = payload[key]
  }

  const { error } = await supabase.from('accounts').update(settings).eq('id', account_id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})
