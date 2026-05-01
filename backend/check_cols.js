const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCols() {
  const { data, error } = await supabase.from('accounts').select('*').limit(1);
  if (data && data.length > 0) {
    console.log('Columns in accounts:', Object.keys(data[0]));
  } else {
    console.log('No data or error:', error);
  }
}

checkCols();
