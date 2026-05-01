export function calculateReputation(p: {
    totalSent: number;
    spamDetected: number;
    totalReplied: number;
    spamRescued: number;
    rampDay: number;
    rampTarget: number;
  }) {
    // Formula: base 50, +25 for inbox rate, +15 for reply rate, -10 for rescue penalty, +10 for ramp progress. Clamp 0–100.
    const inboxRate = p.totalSent > 0 ? (p.totalSent - p.spamDetected) / p.totalSent : 1;
    const replyRate = p.totalSent > 0 ? p.totalReplied / p.totalSent : 0;
    const rescueRate = p.spamDetected > 0 ? p.spamRescued / p.spamDetected : 1;
    const rampProgress = p.rampTarget > 0 ? p.rampDay / p.rampTarget : 1;
  
    let score = 50 
      + (inboxRate * 25) 
      + (replyRate * 15 * 5) // weighted heavily
      + (rescueRate * 10)
      + (rampProgress * 10);
  
    // Penalize if spam rate is high and rescues are low
    if (p.spamDetected > (p.totalSent * 0.1) && rescueRate < 0.5) {
      score -= 20;
    }
  
    return Math.round(Math.max(0, Math.min(100, score)));
  }
