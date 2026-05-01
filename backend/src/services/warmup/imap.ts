import { ImapFlow } from 'imapflow'
import { ImapConfig } from './types'

export async function testImapConnection(config: ImapConfig) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.encryption === 'SSL/TLS',
    auth: { user: config.username, pass: config.password },
    logger: false,
    tls: config.encryption === 'STARTTLS' ? { rejectUnauthorized: false } : undefined
  })

  try {
    await client.connect()
    await client.logout()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

export async function searchSpamFolder(config: ImapConfig) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.encryption === 'SSL/TLS',
    auth: { user: config.username, pass: config.password },
    logger: false,
    tls: config.encryption === 'STARTTLS' ? { rejectUnauthorized: false } : undefined
  })

  await client.connect()
  const lock = await client.getMailboxLock('INBOX') // Placeholder, searching for spam below
  
  const folders = ['[Gmail]/Spam', 'SPAM', 'Junk', 'Junk E-mail']
  let spamFound = false
  const results: any[] = []

  try {
    for (const folder of folders) {
      try {
        const mailbox = await client.mailboxOpen(folder)
        if (mailbox) {
          spamFound = true
          for await (let msg of client.fetch({ seq: '1:50' }, { envelope: true, bodyStructure: true, headers: ['X-WarmGrid-Warmup', 'Message-ID'], source: true })) {
            const headersStr = msg.headers ? msg.headers.toString() : '';
            const isWarmup = headersStr.toLowerCase().includes('x-warmgrid-warmup');
            
            if (isWarmup && msg.envelope && msg.envelope.from && msg.envelope.from[0]) {
              // Try to find text body
              let body = ''
              if (msg.source) {
                // Simplistic extraction from source or specialized fetch if needed
                // For IMAPFlow, fetching 'source: true' gives the full raw message
                const raw = msg.source.toString()
                const bodyStart = raw.indexOf('\r\n\r\n')
                body = bodyStart !== -1 ? raw.substring(bodyStart + 4) : ''
              }
              
              results.push({ 
                uid: msg.uid, 
                messageId: msg.envelope.messageId || (msg.headers as any)?.get('message-id'),
                subject: msg.envelope.subject, 
                from: msg.envelope.from[0].address,
                body: body.substring(0, 1000) // Truncate for safety
              })
            }
          }
          break
        }
      } catch (e) {
        continue
      }
    }
  } finally {
    lock.release()
    await client.logout()
  }

  return results
}

export async function moveToInbox(config: ImapConfig, uid: number) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.encryption === 'SSL/TLS',
    auth: { user: config.username, pass: config.password },
    logger: false,
    tls: config.encryption === 'STARTTLS' ? { rejectUnauthorized: false } : undefined
  })

  await client.connect()
  // Re-open spam folder to move
  const folders = ['[Gmail]/Spam', 'SPAM', 'Junk', 'Junk E-mail']
  try {
    for (const folder of folders) {
      try {
        await client.mailboxOpen(folder)
        await client.messageMove(uid, 'INBOX')
        break
      } catch (e) {}
    }
  } finally {
    await client.logout()
  }
}
