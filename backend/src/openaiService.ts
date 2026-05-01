import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface GenerateFollowupParams {
    originalSubject: string;
    originalBody: string;
    leadName: string;
    leadEmail: string;
    stepNumber: number; // 1 = 24h, 2 = 4 days, 3 = 7 days
}

const stepLabels: Record<number, string> = {
    1: "24 hours",
    2: "4 days",
    3: "7 days",
};

export async function generateFollowupEmail(params: GenerateFollowupParams): Promise<{ subject: string; body: string }> {
    const { originalSubject, originalBody, leadName, leadEmail, stepNumber } = params;
    const timeElapsed = stepLabels[stepNumber] || `${stepNumber} days`;

    const prompt = `You are a professional cold email copywriter. The following is an original cold email that was sent to a prospect:

---
Subject: ${originalSubject}
Body:
${originalBody}
---

Write a follow-up email (follow-up #${stepNumber}, sent ${timeElapsed} after the original) for the same prospect named "${leadName || leadEmail}".

Rules:
- Match the exact tone, style, and length of the original email.
- Reference that you already sent an email — keep it natural, not pushy.
- Keep it SHORT (2-4 sentences max), casual, and human.
- Do NOT use the word "follow-up" in the subject line. Get creative.
- Use {{name}} as the personalization token if referencing the prospect's name.
- Do NOT add signatures, disclaimers, or formal closings — just the body text.

Respond ONLY with valid JSON in this exact format:
{
  "subject": "...",
  "body": "..."
}`;

    try {
        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 400,
        });

        const raw = response.choices[0]?.message?.content?.trim() || "";

        // Strip markdown code fences if present
        const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
        const parsed = JSON.parse(cleaned);

        if (!parsed.subject || !parsed.body) throw new Error("Invalid OpenAI response shape");
        return { subject: parsed.subject, body: parsed.body };
    } catch (err) {
        console.error("[OpenAI] Failed to generate follow-up, using fallback:", err);
        // Fallback: generic follow-up
        return {
            subject: `Re: ${originalSubject}`,
            body: `Hey {{name}}, just wanted to bump this up in case it got buried. Happy to chat if you're interested!`,
        };
    }
}
