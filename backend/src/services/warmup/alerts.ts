import { EventType } from './types'

export async function sendAlert(p: {
  toEmail: string;
  eventType: EventType;
  accountEmail: string;
  message: string;
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Alerts] RESEND_API_KEY missing. Skipping alert.');
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'alerts@warmgrid.io',
        to: p.toEmail,
        subject: `WarmGrid Alert: ${p.eventType} - ${p.accountEmail}`,
        text: p.message
      })
    })

    if (!res.ok) {
      const err = await res.json()
      console.error('[Alerts] Resend API error:', err)
    } else {
      console.log(`[Alerts] Alert sent to ${p.toEmail} for ${p.accountEmail}`)
    }
  } catch (err) {
    console.error('[Alerts] Failed to send alert:', err)
  }
}
