
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkDataType() {
    const { data, error } = await supabase
        .from('accounts')
        .select('last_reset_at')
        .limit(1);
    
    if (error) {
        console.error('Error fetching accounts:', error);
        return;
    }
    
    console.log('Value of last_reset_at:', data[0]?.last_reset_at);
    console.log('Type of last_reset_at:', typeof data[0]?.last_reset_at);
}

checkDataType();
