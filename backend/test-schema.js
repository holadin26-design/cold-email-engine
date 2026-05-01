require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  // get 1 account
  const { data: accounts } = await supabase.from('accounts').select('id').limit(1);
  console.log('Account ID type:', typeof accounts[0]?.id, 'Value:', accounts[0]?.id);

  // get 1 lead
  const { data: leads } = await supabase.from('leads').select('id, account_id, status').limit(1);
  console.log('Lead:', leads[0]);
}
test();
