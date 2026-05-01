import { runWarmupForUser } from './src/services/warmup/engine';
import { supabase } from './src/supabase';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    console.log('Resetting quotas...');
    await supabase.from('accounts').update({ warmup_daily_sent: 0, warmup_last_active: null }).neq('id', '00000000-0000-0000-0000-000000000000');
    console.log('Quotas reset. Triggering warmup run...');
    await runWarmupForUser();
    
    console.log('Checking pairs...');
    const { data } = await supabase.from('warmup_pairs').select('*').order('last_paired_at', { ascending: false }).limit(5);
    console.log(data);
    
    console.log('Finished manual warmup run.');
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
