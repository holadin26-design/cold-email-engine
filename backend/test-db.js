require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  console.log('Fetching a pending lead...');
  const { data: leads, error: fetchErr } = await supabase.from('leads').select('*').limit(1);
  if (fetchErr || !leads || leads.length === 0) {
      console.log('Fetch error or no leads:', fetchErr);
      return;
  }
  const lead = leads[0];
  console.log('Found lead:', lead.id);
  
  console.log('Testing leads update...');
  try {
    const { data, error } = await supabase.from('leads').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        message_id: '<test>',
        account_id: 1
    }).eq('id', lead.id);
    
    console.log('Error output from Supabase:', error);
  } catch (err) {
      console.log('Exception caught:', err);
  }
}
test();
