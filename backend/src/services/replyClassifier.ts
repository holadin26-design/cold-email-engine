/**
 * Rule-based classifier for email replies.
 * - Detects Positive/Interested responses
 * - Detects Negative/Unsubscribe responses
 * - Identifies Auto-responders (OOO)
 */

export interface ClassificationResult {
    isPositive: boolean;
    isAutoReply: boolean;
    sentiment: "positive" | "negative" | "neutral";
    reason: string;
}

export class ReplyClassifier {
    private static POSITIVE_KEYWORDS = [
        "interested", "more info", "pricing", "details", "call", "schedule", 
        "meeting", "demo", "cost", "how much", "tell me more", "sounds good", 
        "let's talk", "availabl", "zoom", "teams", "calendar", "great", 
        "thanks for reaching out", "book a time", "discuss", "chat"
    ];

    private static NEGATIVE_KEYWORDS = [
        "unsubscribe", "remove me", "opt out", "stop", "not interested", 
        "not a good fit", "wrong person", "spam", "no thank", "don't email", 
        "never contact", "wrong email", "take me off", "cease and desist",
        "harassment", "reporting you"
    ];

    private static AUTO_REPLY_KEYWORDS = [
        "out of office", "out of the office", "automatic reply", "vacation", 
        "away", "autoreply", "re: auto", "notification", "noreply", 
        "postmaster", "mailer-daemon", "delivery subsystem", "failure notice", 
        "undeliverable"
    ];

    /**
     * Classifies an email body using keyword matching with word boundaries.
     * @param body The email text to classify.
     */
    public static classify(body: string): ClassificationResult {
        const text = body.toLowerCase();
        
        // 1. Detect Auto-replies first (high priority)
        for (const kw of this.AUTO_REPLY_KEYWORDS) {
            const regex = new RegExp(`\\b${kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
            if (regex.test(text)) {
                console.log(`[ReplyClassifier] 🚩 Match: ${kw} in snippet: ${text.slice(0, 100)}...`);
                return {
                    isPositive: false,
                    isAutoReply: true,
                    sentiment: "neutral",
                    reason: `matched auto-reply regex: ${kw}`
                };
            }
        }

        // 2. Detect Negative/Rejections
        for (const kw of this.NEGATIVE_KEYWORDS) {
            const regex = new RegExp(`\\b${kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
            if (regex.test(text)) {
                return {
                    isPositive: false,
                    isAutoReply: false,
                    sentiment: "negative",
                    reason: `matched negative regex: ${kw}`
                };
            }
        }

        // 3. Detect Positive/Interested
        for (const kw of this.POSITIVE_KEYWORDS) {
            const regex = new RegExp(`\\b${kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
            if (regex.test(text)) {
                return {
                    isPositive: true,
                    isAutoReply: false,
                    sentiment: "positive",
                    reason: `matched positive regex: ${kw}`
                };
            }
        }

        // 4. Fallback logic
        // Check for question marks — often a sign of a real human asking something
        if (text.includes("?")) {
            return {
                isPositive: true,
                isAutoReply: false,
                sentiment: "positive",
                reason: "contains question mark (presumed interest)"
            };
        }

        // Extremely short replies like "No" or "Nope" are negative
        if (text.length < 10 && (/\bno\b/i.test(text) || /\bnope\b/i.test(text))) {
            return {
                isPositive: false,
                isAutoReply: false,
                sentiment: "negative",
                reason: "short negative reply"
            };
        }

        // Default: If it's a real human but no keywords matched, call it "neutral" 
        // but mark isPositive as true so the user sees it as a lead response.
        return {
            isPositive: true,
            isAutoReply: false,
            sentiment: "neutral",
            reason: "no specific keywords matched (defaulting to human response)"
        };
    }
}
