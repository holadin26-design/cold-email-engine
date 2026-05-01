const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLeads() {
  const { data: allLeads } = await supabase.from('leads').select('user_id');
  const uniqueLeadsUsers = [...new Set(allLeads?.map(u => u.user_id))];
  console.log('Unique user_ids in leads:', uniqueLeadsUsers);
}

checkLeads();
