
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkSchema() {
    const { data, error } = await supabase
        .from('accounts')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('Error fetching accounts:', error);
        return;
    }
    
    console.log('Columns in accounts table:', Object.keys(data[0] || {}));
}

checkSchema();
