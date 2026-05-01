const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error("Missing SUPABASE credentials in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function run() {
    const query = "ALTER TABLE campaigns ADD COLUMN account_ids JSONB DEFAULT NULL;";
    console.log("Adding account_ids column to campaigns table...");
    
    const { error } = await supabase.rpc('exec_sql', { sql_query: query });
    
    if (error) {
        if (error.message.includes('already exists')) {
             console.log("Column account_ids already exists.");
        } else {
             console.error("Error adding column:", error.message);
        }
    } else {
        console.log("Migration successful!");
    }
}

run();
