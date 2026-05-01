const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const tables = ['accounts', 'seed_accounts', 'warmup_logs', 'leads', 'email_accounts', 'seeds', 'warmup_seeds'];
  for (const t of tables) {
    const { data, count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`Table ${t}: Error - ${error.message}`);
    } else {
      console.log(`Table ${t}: ${count} rows`);
    }
  }
}

check();
