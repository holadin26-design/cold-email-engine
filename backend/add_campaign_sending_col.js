const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const query = "ALTER TABLE accounts ADD COLUMN allow_campaign_sending BOOLEAN DEFAULT true;";
  const { error } = await supabase.rpc('exec_sql', { sql_query: query });
  
  if (error) {
    if (error.message.includes('function') && error.message.includes('not find')) {
        console.error("Function exec_sql not found. Cannot run schema update via JS.");
    } else {
        console.error("RPC Error:", error.message);
    }
  } else {
    console.log("Column allow_campaign_sending added successfully!");
  }
}
run();
