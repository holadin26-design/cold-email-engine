import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function test() {
    const { data, error } = await supabase
        .from('campaigns')
        .select(`
            *,
            pending_leads:leads!inner(id),
            sent_leads:leads!inner(id)
        `)
        .eq('pending_leads.status', 'pending')
        .eq('sent_leads.status', 'sent')
        .limit(1);

    console.log("Error?", error);
    console.log("Data?", JSON.stringify(data, null, 2));
}

test();
