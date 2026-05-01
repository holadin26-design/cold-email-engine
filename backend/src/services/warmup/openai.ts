import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Topics used to diversify warmup email content so they aren't fingerprinted
const WARMUP_TOPICS = [
  'a recent industry trend', 'a productivity tip', 'a quick business insight',
  'a thought on remote work', 'a weekend recommendation', 'an interesting article',
  'a project update', 'a team collaboration tip', 'a professional development idea',
  'a market trend', 'a technology observation', 'a leadership reflection',
  'a business book recommendation', 'a networking thought', 'a customer success story'
];

/**
 * Extract a human-readable first name from an email address.
 * e.g. "john.smith@acme.com" → "John", "sarah_edgeai@gmail.com" → "Sarah"
 */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  // Take the first segment before any separator (., _, -, +, number)
  const firstName = local.split(/[._\-+0-9]/)[0] ?? local;
  if (!firstName) return '';
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

/**
 * Generate a unique, human-like outbound warmup email using GPT-4o-mini.
 * Each call produces a different topic/subject/body to avoid fingerprinting.
 * 
 * @param fromEmail  Sender's email — used to derive a real first name for sign-off
 * @param toEmail    Recipient email — used to derive a real first name for greeting
 */
export async function generateWarmupEmail(fromEmail?: string, toEmail?: string): Promise<{ subject: string; body: string }> {
  const topic = WARMUP_TOPICS[Math.floor(Math.random() * WARMUP_TOPICS.length)];
  const senderName = fromEmail ? nameFromEmail(fromEmail) : '';
  const recipientName = toEmail ? nameFromEmail(toEmail) : '';

  const greeting = recipientName ? `Hi ${recipientName},` : 'Hey,';
  const signoff = senderName ? `\n\nBest,\n${senderName}` : '';

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are writing natural, human business emails for email warmup.
Rules (STRICT):
- Write ONLY the middle body content (1-3 sentences). Do NOT include a greeting line or sign-off — those will be added separately.
- NEVER use placeholders like [name], {name}, [your name], {{recipient}}, or ANY bracket/brace variables whatsoever. Use actual words instead.
- Sound completely human, not corporate or robotic.
- Do not mention "warmup", "AI", "automation", or anything meta.
- Vary your writing style and vocabulary every time.
- Output ONLY a JSON object: {"subject": "...", "body": "..."}`
        },
        {
          role: 'user',
          content: `Write a professional email body (middle content only, no greeting or sign-off) about: ${topic}`
        }
      ],
      max_tokens: 200,
      temperature: 0.9,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content || '';
    const parsed = JSON.parse(content);

    if (parsed.subject && parsed.body) {
      // Sanitize: strip any leftover brackets/brace placeholders just in case
      const cleanBody = stripPlaceholders(parsed.body);
      // Assemble the full email with real names
      const fullBody = `${greeting}\n\n${cleanBody}${signoff}`;
      return { subject: parsed.subject, body: fullBody };
    }

    throw new Error('Invalid JSON structure from OpenAI');
  } catch (error) {
    console.error('[OpenAI] Failed to generate warmup email, using fallback:', error);
    const fallbacks = [
      { subject: 'Quick thought', body: `${greeting}\n\nHad a quick thought I wanted to share with you. Let me know if you get a chance to connect this week.${signoff}` },
      { subject: 'Following up', body: `${greeting}\n\nJust wanted to check in and see how things are going on your end. Hope all is well!${signoff}` },
      { subject: 'Checking in', body: `${greeting}\n\nHope your week is going well. I came across something you might find interesting — let me know if you want to chat.${signoff}` },
      { subject: 'Quick note', body: `${greeting}\n\nReaching out to share a quick update. Nothing urgent, just wanted to stay in touch.${signoff}` },
      { subject: 'Thoughts on this week', body: `${greeting}\n\nHow has your week been shaping up? Would love to connect soon.${signoff}` },
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

/**
 * Generate a human-like reply to a received warmup email using GPT-4o-mini.
 * 
 * @param originalSubject  Subject of the email being replied to
 * @param originalBody     Body of the email being replied to
 * @param fromEmail        The seed account replying (used to derive real sign-off name)
 * @param toEmail          The primary account being replied to (used for greeting)
 */
export async function generateWarmupReply(
  originalSubject: string,
  originalBody: string,
  fromEmail?: string,
  toEmail?: string
): Promise<string> {
  const senderName = fromEmail ? nameFromEmail(fromEmail) : '';
  const recipientName = toEmail ? nameFromEmail(toEmail) : '';

  const greeting = recipientName ? `Hi ${recipientName},` : 'Hey,';
  const signoff = senderName ? `\n\nCheers,\n${senderName}` : '';

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are writing a natural reply to an email.
Rules (STRICT):
- Write ONLY the middle body content (1-3 sentences). Do NOT include a greeting or sign-off — those will be added separately.
- NEVER use placeholders like [name], {name}, [your name], {{recipient}}, or ANY bracket/brace variables whatsoever. Use specific words or omit names entirely.
- Keep it casual, brief, and contextually relevant to the email you received.
- Do not sound like a bot or use corporate jargon.
- Just write plain text — no markdown, no formatting.`
        },
        {
          role: 'user',
          content: `Write a short reply body (middle content only) to this email:\nSubject: ${originalSubject}\nBody: ${originalBody.slice(0, 400)}`
        },
      ],
      max_tokens: 150,
      temperature: 0.8,
    });

    const rawReply = response.choices[0].message.content || '';
    const cleanReply = stripPlaceholders(rawReply);
    return `${greeting}\n\n${cleanReply}${signoff}`;

  } catch (error) {
    console.error('[OpenAI] Failed to generate reply:', error);
    return `${greeting}\n\nThanks for reaching out — appreciated!${signoff}`;
  }
}

/**
 * Strip any remaining placeholder patterns from AI-generated text.
 * Handles: [name], {name}, {{name}}, [Your Name], etc.
 */
function stripPlaceholders(text: string): string {
  // Remove {{...}} double-brace placeholders
  text = text.replace(/\{\{[^}]*\}\}/g, '');
  // Remove {single} brace placeholders
  text = text.replace(/\{[^}]*\}/g, '');
  // Remove [bracket] placeholders
  text = text.replace(/\[[^\]]*\]/g, '');
  // Clean up any double spaces or leading/trailing whitespace left behind
  return text.replace(/  +/g, ' ').trim();
}
