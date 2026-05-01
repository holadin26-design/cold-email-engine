const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const tables = ['accounts', 'email_accounts', 'campaigns', 'leads', 'seed_accounts'];
  for (const table of tables) {
    try {
      const { data, count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (error) {
        console.log(`Table ${table}: Error - ${error.message}`);
      } else {
        console.log(`Table ${table}: ${count} rows total`);
      }
    } catch (e) {
      console.log(`Table ${table}: Exception - ${e.message}`);
    }
  }
}

check();
