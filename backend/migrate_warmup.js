const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function migrate() {
  console.log('Starting migration for warmup tables...');
  
  const queries = [
    // 1. seed_accounts
    `CREATE TABLE IF NOT EXISTS public.seed_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      gmail_refresh_token TEXT,
      smtp_host TEXT,
      smtp_port INTEGER,
      imap_host TEXT,
      imap_port INTEGER,
      smtp_username TEXT,
      smtp_password TEXT,
      smtp_encryption TEXT,
      daily_sent INTEGER DEFAULT 0,
      daily_received INTEGER DEFAULT 0,
      spam_rescued_total INTEGER DEFAULT 0,
      health_status TEXT DEFAULT 'Healthy',
      created_at TIMESTAMPTZ DEFAULT now()
    );`,
    
    // 2. warmup_logs
    `CREATE TABLE IF NOT EXISTS public.warmup_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_email TEXT,
      to_email TEXT,
      from_account_id UUID,
      to_account_id UUID,
      from_account_type TEXT,
      to_account_type TEXT,
      subject TEXT,
      event_type TEXT,
      result TEXT,
      message_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );`,
    
    // 3. warmup_pairs
    `CREATE TABLE IF NOT EXISTS public.warmup_pairs (
      from_account_id UUID NOT NULL,
      to_account_id UUID NOT NULL,
      from_type TEXT,
      to_type TEXT,
      last_paired_at TIMESTAMPTZ DEFAULT now(),
      total_exchanges INTEGER DEFAULT 0,
      PRIMARY KEY (from_account_id, to_account_id)
    );`,
    
    // 4. reputation_history
    `CREATE TABLE IF NOT EXISTS public.reputation_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id UUID NOT NULL,
      score INTEGER,
      recorded_at TIMESTAMPTZ DEFAULT now()
    );`
  ];

  for (const q of queries) {
    console.log(`Executing: ${q.substring(0, 50)}...`);
    // Note: Supabase JS client doesn't support raw SQL easily unless you use an RPC or postgres wrapper.
    // If raw SQL fails, we might need to use a different approach.
    const { error } = await supabase.rpc('exec_sql', { sql_query: q });
    if (error) {
      console.error(`Error executing query: ${error.message}`);
      console.log('Attempting alternative: simple data access to trigger schema cache refresh...');
    }
  }
}

migrate();
