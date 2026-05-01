require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runMigrations() {
  console.log("Starting Supabase migration for campaign followups...\n");

  console.log("========================================");
  console.log("ACTION REQUIRED: Run this SQL in your Supabase SQL Editor");
  console.log("(Dashboard > SQL Editor > New query)");
  console.log("========================================\n");
  console.log(`-- Add followups_config JSONB column to campaigns
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followups_config JSONB;
`);
  console.log("\n========================================");
}

runMigrations().catch(console.error);
