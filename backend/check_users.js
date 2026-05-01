const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllUsers() {
  const { data: accUsers } = await supabase.from('accounts').select('user_id');
  const uniqueAccUsers = [...new Set(accUsers?.map(u => u.user_id))];
  console.log('Unique user_ids in accounts:', uniqueAccUsers);
  
  const { data: campUsers } = await supabase.from('campaigns').select('user_id');
  const uniqueCampUsers = [...new Set(campUsers?.map(u => u.user_id))];
  console.log('Unique user_ids in campaigns:', uniqueCampUsers);
}

checkAllUsers();
