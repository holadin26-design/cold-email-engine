// Migration script: creates global_followups table and seeds default templates
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigrations() {
  console.log("Starting Supabase migration...\n");

  // Check if global_followups table already exists by trying to query it
  const { data, error: tableError } = await supabase
    .from("global_followups")
    .select("id")
    .limit(1);

  if (tableError && (tableError.code === "42P01" || tableError.message?.includes("does not exist"))) {
    // Table doesn't exist — print the SQL to run manually
    console.log("========================================");
    console.log("ACTION REQUIRED: Run this SQL in your Supabase SQL Editor");
    console.log("(Dashboard > SQL Editor > New query)");
    console.log("========================================\n");
    console.log(`-- Add open tracking and account tracking columns to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS account_id BIGINT;

-- Create global follow-up templates table
CREATE TABLE IF NOT EXISTS global_followups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step_number INTEGER NOT NULL UNIQUE,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  delay_days INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default templates
INSERT INTO global_followups (step_number, subject, body, delay_days, enabled) VALUES
  (1, 'Re: {{original_subject}}', 'Hi {{name}},

Just wanted to follow up on my previous email. Did you get a chance to review it?

Looking forward to hearing from you.

Best,', 2, true),
  (2, 'Re: {{original_subject}}', 'Hi {{name}},

I wanted to reach out one more time in case my previous messages got buried.

Would love to connect and see if there is a fit.

Best,', 4, true),
  (3, 'Re: {{original_subject}}', 'Hi {{name}},

This will be my last follow-up. If you are ever interested in the future, feel free to reach out anytime.

Wishing you all the best,', 6, true)
ON CONFLICT (step_number) DO NOTHING;`);
    console.log("\n========================================");
    console.log("After running the SQL above, re-run this script to verify and seed data.");
    console.log("========================================");
    return;
  }

  if (tableError) {
    console.error("Unexpected error checking global_followups:", tableError.message);
    return;
  }

  console.log("[OK] global_followups table exists");

  // Check if we need to seed it
  if (!data || data.length === 0) {
    const { error: seedError } = await supabase.from("global_followups").insert([
      {
        step_number: 1,
        subject: "Re: {{original_subject}}",
        body: "Hi {{name}},\n\nJust wanted to follow up on my previous email. Did you get a chance to review it?\n\nLooking forward to hearing from you.\n\nBest,",
        delay_days: 2,
        enabled: true
      },
      {
        step_number: 2,
        subject: "Re: {{original_subject}}",
        body: "Hi {{name}},\n\nI wanted to reach out one more time in case my previous messages got buried.\n\nWould love to connect and see if there is a fit.\n\nBest,",
        delay_days: 4,
        enabled: true
      },
      {
        step_number: 3,
        subject: "Re: {{original_subject}}",
        body: "Hi {{name}},\n\nThis will be my last follow-up. If you are ever interested in the future, feel free to reach out anytime.\n\nWishing you all the best,",
        delay_days: 6,
        enabled: true
      }
    ]);

    if (seedError) {
      console.error("[ERROR] Failed to seed templates:", seedError.message);
    } else {
      console.log("[OK] Seeded default follow-up templates (2d, 4d, 6d)");
    }
  } else {
    console.log("[SKIP] global_followups already has data — no seeding needed");
  }

  console.log("\nMigration complete!");
  console.log("\nREMINDER: Run these in Supabase SQL Editor if not already done:");
  console.log("  ALTER TABLE leads ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;");
  console.log("  ALTER TABLE leads ADD COLUMN IF NOT EXISTS account_id BIGINT;");
}

runMigrations().catch(console.error);
