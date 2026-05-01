import { AccountRole } from './types'
const BASE = 'https://gmail.googleapis.com/gmail/v1'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export function getAuthUrl(role: AccountRole): string {
  const state = Buffer.from(JSON.stringify({ role })).toString('base64')
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify',
    access_type: 'offline', prompt: 'consent', state
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCodeForTokens(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, grant_type: 'authorization_code',
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!
    })
  })
  const data = await res.json() as any;
  if (!data.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(data))
  return { access_token: data.access_token, refresh_token: data.refresh_token }
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, grant_type: 'refresh_token',
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!
    })
  })
  const data = await res.json() as any;
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data))
  return data.access_token
}

export async function sendGmailMessage(p: {
  accessToken: string; from: string; to: string
  subject: string; body: string; warmupHeader?: boolean
  threadId?: string; inReplyTo?: string; references?: string
}): Promise<{ messageId: string }> {
  const headers = [
    `From: ${p.from}`, 
    `To: ${p.to}`, 
    `Subject: ${p.subject}`, 
    'Content-Type: text/plain; charset=utf-8', 
    p.warmupHeader ? 'X-WarmGrid-Warmup: true' : '',
    p.inReplyTo ? `In-Reply-To: ${p.inReplyTo}` : '',
    p.references ? `References: ${p.references}` : ''
  ].filter(Boolean).join('\r\n')
  const raw = `${headers}\r\n\r\n${p.body}`
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  const res = await fetch(`${BASE}/users/me/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded, threadId: p.threadId })
  })
  const data = await res.json() as any;
  if (!data.id) throw new Error(`Gmail send failed for ${p.from}: ` + JSON.stringify(data))
  return { messageId: data.id }
}

export async function listSpamMessages(accessToken: string): Promise<string[]> {
  const res = await fetch(`${BASE}/users/me/messages?labelIds=SPAM&maxResults=50`, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await res.json() as any;
  if (!data.messages) return []
  const ids: string[] = []
  for (const msg of data.messages) {
    const detailRes = await fetch(`${BASE}/users/me/messages/${msg.id}?format=metadata&metadataHeaders=X-WarmGrid-Warmup`, { headers: { Authorization: `Bearer ${accessToken}` } })
    const detail = await detailRes.json() as any;
    if ((detail.payload?.headers || []).some((h: any) => h.name === 'X-WarmGrid-Warmup')) ids.push(msg.id)
  }
  return ids
}

export async function rescueFromSpam(accessToken: string, messageId: string) {
  await fetch(`${BASE}/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['SPAM'], addLabelIds: ['INBOX'] })
  })
}

export async function getMessageDetails(accessToken: string, messageId: string): Promise<{ from: string, subject: string, body: string, msgId: string, threadId: string }> {
  const res = await fetch(`${BASE}/users/me/messages/${messageId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await res.json() as any;
  const msgId = (data.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'message-id')?.value || ''
  const threadId = data.threadId || ''
  const from = (data.payload?.headers || []).find((h: any) => h.name === 'From')?.value || 'unknown'
  const subject = (data.payload?.headers || []).find((h: any) => h.name === 'Subject')?.value || 'No Subject'
  
  let body = ''
  if (data.payload?.body?.data) {
    body = Buffer.from(data.payload.body.data, 'base64').toString()
  } else if (data.payload?.parts) {
    const part = data.payload.parts.find((p: any) => p.mimeType === 'text/plain') || data.payload.parts[0]
    if (part?.body?.data) {
      body = Buffer.from(part.body.data, 'base64').toString()
    }
  }

  // Extract email if in "Name <email@example.com>" format
  const emailRegex = /<(.+?)>/
  const emailMatch = from.match(emailRegex)
  return { from: emailMatch ? emailMatch[1] : from, subject, body, msgId, threadId }
}

export async function markAsImportant(accessToken: string, messageId: string) {
  await fetch(`${BASE}/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds: ['IMPORTANT', 'STARRED'] })
  })
}
