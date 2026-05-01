
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testTimestamp() {
    const { data: accounts } = await supabase.from('accounts').select('id').limit(1);
    if (!accounts || accounts.length === 0) return;

    const id = accounts[0].id;
    const testTs = new Date().toISOString();
    console.log('Trying to set timestamp:', testTs);

    const { error } = await supabase
        .from('accounts')
        .update({ last_reset_at: testTs })
        .eq('id', id);
    
    if (error) {
        console.error('Update failed:', error.message);
    } else {
        const { data } = await supabase.from('accounts').select('last_reset_at').eq('id', id).single();
        console.log('Stored value:', data.last_reset_at);
    }
}

testTimestamp();
