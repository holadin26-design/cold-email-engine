import { supabase } from './src/supabase';
import * as dotenv from 'dotenv';
dotenv.config();

console.log('Fetching warmup pairs...');
supabase.from('warmup_pairs').select('*').then(({ data, error }) => {
    if (error) console.error(error);
    else console.log(data);
    process.exit(0);
});
