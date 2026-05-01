import "reflect-metadata";
import express from "express";
import cors from "cors";
import { apiRouter } from "./routes";
import { warmupRouter } from "./routes/warmup";
import { startQueue } from "./queue";
import { startReplyChecker } from "./replyChecker";
import cron from "node-cron";
import { supabase } from "./supabase";
import { runWarmupForUser } from "./services/warmup/engine";

// ──────────────────────────────
// GLOBAL ERROR HANDLERS
// ──────────────────────────────
process.on('uncaughtException', (err: any) => {
    console.error('[Fatal] Uncaught Exception:', err);
    if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
        console.warn('[System] Socket error detected. Keeping process alive.');
        return;
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
});

app.use("/api/warmup", warmupRouter);
app.use("/api", apiRouter);

// ──────────────────────────────
// STARTUP MIGRATION
// ──────────────────────────────

async function runMigrations() {
    try {
        // Check if global_followups table exists
        const { error: checkError } = await supabase
            .from("global_followups")
            .select("id")
            .limit(1);

        if (checkError && (checkError.code === "42P01" || checkError.message?.includes("does not exist"))) {
            console.log("[Migration] global_followups table not found.");
            console.log("[Migration] Please run the following SQL in your Supabase SQL Editor:");
            console.log(`
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS account_id BIGINT;
CREATE TABLE IF NOT EXISTS global_followups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step_number INTEGER NOT NULL UNIQUE,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  delay_days INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO global_followups (step_number, subject, body, delay_days, enabled) VALUES
  (1, 'Re: {{original_subject}}', 'Hi {{name}},\n\nJust wanted to follow up on my previous email. Did you get a chance to review it?\n\nLooking forward to hearing from you.\n\nBest,', 2, true),
  (2, 'Re: {{original_subject}}', 'Hi {{name}},\n\nI wanted to reach out one more time in case my previous messages got buried.\n\nWould love to connect and see if there is a fit.\n\nBest,', 4, true),
  (3, 'Re: {{original_subject}}', 'Hi {{name}},\n\nThis will be my last follow-up. If you are ever interested in the future, feel free to reach out anytime.\n\nWishing you all the best,', 6, true)
ON CONFLICT (step_number) DO NOTHING;
            `);
            return;
        }

        // Check and seed if empty
        const { data: existing } = await supabase
            .from("global_followups")
            .select("id")
            .limit(1);

        if (!existing || existing.length === 0) {
            await supabase.from("global_followups").insert([
                {
                    step_number: 1,
                    subject: "Re: {{original_subject}}",
                    body: "Hi {{name}},\n\nJust wanted to follow up on my previous email. Did you get a chance to review it?\n\nLooking forward to hearing from you.\n\nBest,",
                    delay_days: 2,
                    enabled: true,
                },
                {
                    step_number: 2,
                    subject: "Re: {{original_subject}}",
                    body: "Hi {{name}},\n\nI wanted to reach out one more time in case my previous messages got buried.\n\nWould love to connect and see if there is a fit.\n\nBest,",
                    delay_days: 4,
                    enabled: true,
                },
                {
                    step_number: 3,
                    subject: "Re: {{original_subject}}",
                    body: "Hi {{name}},\n\nThis will be my last follow-up. If you are ever interested in the future, feel free to reach out anytime.\n\nWishing you all the best,",
                    delay_days: 6,
                    enabled: true,
                },
            ]);
            console.log("[Migration] Seeded default global follow-up templates.");
        } else {
            console.log("[Migration] global_followups already seeded.");
        }
    } catch (err: any) {
        console.error("[Migration] Error:", err.message);
    }
}

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    await runMigrations();
    await startQueue();
    console.log(`Queue worker started.`);
    startReplyChecker();
    console.log(`Reply checker started.`);

    // ──────────────────────────────
    // WARMUP AUTOMATION (CRON)
    // ──────────────────────────────
    
    // 1. Run warmup every day at 9am (Mon-Fri) - DISABLED
    /*
    cron.schedule('0 9 * * 1-5', () => {
        runWarmupForUser();
        console.log('[WarmGrid] Daily automated warmup run started');
    });
    */

    // 2. Daily reset of counts at midnight - DISABLED
    /*
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('[WarmGrid] Running daily counts reset...');
            await supabase.from('accounts').update({ warmup_daily_sent: 0 }).eq('warmup_enabled', true);
            await supabase.from('seed_accounts').update({ daily_sent: 0, daily_received: 0 });
            console.log('[WarmGrid] Daily counts reset successfully');
        } catch (err: any) {
            console.error('[WarmGrid] Daily reset failed:', err.message);
        }
    });
    */
});
