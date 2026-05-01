import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(__dirname, '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function test() {
  console.log('Testing Supabase Connection...')
  console.log('URL:', process.env.SUPABASE_URL)
  
  const { data: campaigns, error: cErr } = await supabase.from('campaigns').select('id, name, user_id').limit(5)
  if (cErr) {
    console.error('Campaigns Query Error:', cErr)
  } else {
    console.log('Campaigns Found:', campaigns?.length || 0)
    console.log('Sample Campaigns:', campaigns)
  }

  const { data: accounts, error: aErr } = await supabase.from('accounts').select('id, email, user_id').limit(5)
  if (aErr) {
    console.error('Accounts Query Error:', aErr)
  } else {
    console.log('Accounts Found:', accounts?.length || 0)
    console.log('Sample Accounts:', accounts)
  }
}

test()
