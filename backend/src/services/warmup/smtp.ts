import nodemailer from 'nodemailer'
import { SmtpConfig } from './types'

export async function testSmtpConnection(config: SmtpConfig) {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.encryption === 'SSL/TLS',
      auth: { user: config.username, pass: config.password },
      tls: config.encryption === 'STARTTLS' ? { rejectUnauthorized: false } : undefined
    })
    await transporter.verify()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function sendSmtpMessage(p: {
  config: SmtpConfig; from: string; to: string
  subject: string; body: string; warmupHeader?: boolean
  inReplyTo?: string; references?: string
}): Promise<{ messageId: string }> {
  const transporter = nodemailer.createTransport({
    host: p.config.host,
    port: p.config.port,
    secure: p.config.encryption === 'SSL/TLS',
    auth: { user: p.config.username, pass: p.config.password },
    tls: p.config.encryption === 'STARTTLS' ? { rejectUnauthorized: false } : undefined
  })

  const info = await transporter.sendMail({
    from: p.from,
    to: p.to,
    subject: p.subject,
    text: p.body,
    headers: {
      ...(p.warmupHeader ? { 'X-WarmGrid-Warmup': 'true' } : {}),
      ...(p.inReplyTo ? { 'In-Reply-To': p.inReplyTo } : {}),
      ...(p.references ? { 'References': p.references } : {})
    }
  })

  if (!info.messageId) throw new Error('SMTP send failed: No message ID returned')
  return { messageId: info.messageId }
}
