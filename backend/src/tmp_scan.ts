import { supabase } from './supabase';
import * as dotenv from 'dotenv';
dotenv.config();

async function run() {
    const { data: campaigns, error: cErr } = await supabase
        .from('campaigns')
        .select('id, name')
        .order('created_at', { ascending: false })
        .limit(1);

    if (cErr) return console.error(cErr);
    if (!campaigns || campaigns.length === 0) return console.log('No campaigns found.');

    const campaign = campaigns[0];
    console.log(`Latest Campaign: ${campaign.name} (${campaign.id})`);

    const { data: leads, error: lErr } = await supabase
        .from('leads')
        .select('email, variables, replied_at, status')
        .not('replied_at', 'is', null)
        .order('replied_at', { ascending: false });

    if (lErr) return console.error(lErr);
    console.log(`Replies Found: ${leads?.length || 0}`);
    
    if (leads) {
        leads.forEach(l => {
            const vars = typeof l.variables === 'string' ? JSON.parse(l.variables) : (l.variables || {});
            console.log(`\n--- Reply from: ${l.email}`);
            console.log(`Sentiment: ${vars.reply_sentiment}`);
            console.log(`Body: ${vars.reply_body ? vars.reply_body.substring(0, 300) : 'No body captured'}`);
        });
    }
}
run();
