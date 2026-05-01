import { supabase } from '../../supabase'

export async function getRandomTemplate() {
  const { data, error } = await supabase
    .from('email_templates')
    .select('subject, body')
  
  if (error || !data || data.length === 0) {
    return {
      subject: 'Quick check-in',
      body: 'Hi, hope you are having a great week! Just wanted to send a quick note to say hello. Talk soon.'
    }
  }

  return data[Math.floor(Math.random() * data.length)]
}

export function getRandomReply() {
  const replies = [
    "Thanks for the update!", "Got it, thanks.", "That sounds good to me.",
    "I'll take a look and get back to you.", "Great, talk soon!",
    "Appreciate you letting me know.", "Perfect, thanks for sharing.",
    "Makes sense, I agree with that approach.", "Looking forward to it!",
    "Thanks, I've received the files.", "No problem at all.",
    "Sounds like a plan.", "Thanks! Have a great afternoon.",
    "I'll keep an eye out for your next update.", "Exactly what I was thinking.",
    "Thanks for the heads up.", "Okay, I'll update my calendar.",
    "Great work on this, thanks.", "Interesting, thanks for the link.",
    "Talk to you later today!"
  ]
  return replies[Math.floor(Math.random() * replies.length)]
}
