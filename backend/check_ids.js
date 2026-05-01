const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkIds() {
  const { data: accounts } = await supabase.from('accounts').select('id, email, user_id').limit(5);
  console.log('Sample Accounts:', accounts);
  
  const { data: campaigns } = await supabase.from('campaigns').select('id, name, user_id').limit(5);
  console.log('Sample Campaigns:', campaigns);
}

checkIds();
