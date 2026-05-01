const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkLeadsSchema() {
    const { data, error } = await supabase
        .from('leads')
        .select('*')
        .limit(1);
    
    if (error) {
        console.error('Error fetching leads:', error);
        return;
    }
    
    console.log('Columns in leads table:', Object.keys(data[0] || {}));
}

checkLeadsSchema();
