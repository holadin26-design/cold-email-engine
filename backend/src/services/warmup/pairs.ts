import { EmailAccount, SeedAccount } from './types'

export function getOptimalPairs(p: {
  primaryAccount: EmailAccount;
  seedAccounts: SeedAccount[];
  existingPairs: any[];
  count: number;
}) {
  const primaryDomain = p.primaryAccount.email.split('@')[1];

  // Filter out seeds on same domain, but allow if it's a major provider like gmail.com or if no other options exist
  let availableSeeds = p.seedAccounts.filter(s => s.email.split('@')[1] !== primaryDomain);
  
  if (availableSeeds.length === 0 || primaryDomain === 'gmail.com') {
    availableSeeds = p.seedAccounts.filter(s => s.email !== p.primaryAccount.email);
  }

  // Sort by fewest total exchanges first.
  // Tiebreaker: least recently paired (oldest last_paired_at) wins — ensures true round-robin
  // when all seeds start at 0 exchanges.
  const sorted = availableSeeds.sort((a, b) => {
    const pairA = p.existingPairs.find(ep => ep.to_account_id === a.id);
    const pairB = p.existingPairs.find(ep => ep.to_account_id === b.id);
    const countA = pairA ? (pairA.total_exchanges ?? 0) : 0;
    const countB = pairB ? (pairB.total_exchanges ?? 0) : 0;

    if (countA !== countB) return countA - countB;

    // Tiebreaker: older last_paired_at (or never paired) comes first
    const timeA = pairA?.last_paired_at ? new Date(pairA.last_paired_at).getTime() : 0;
    const timeB = pairB?.last_paired_at ? new Date(pairB.last_paired_at).getTime() : 0;
    return timeA - timeB;
  });

  return sorted.slice(0, p.count);
}

export async function updatePairRecord(supabase: any, p: {
  fromId: string;
  toId: string;
  fromType: string;
  toType: string;
}) {
  const now = new Date().toISOString();

  // Step 1: Fetch existing pair record (if any)
  const { data: existing } = await supabase
    .from('warmup_pairs')
    .select('total_exchanges')
    .eq('from_account_id', p.fromId)
    .eq('to_account_id', p.toId)
    .maybeSingle();

  const newCount = (existing?.total_exchanges ?? 0) + 1;

  // Step 2: Upsert with incremented total_exchanges and updated last_paired_at
  const { error } = await supabase
    .from('warmup_pairs')
    .upsert({
      from_account_id: p.fromId,
      to_account_id: p.toId,
      from_type: p.fromType,
      to_type: p.toType,
      last_paired_at: now,
      total_exchanges: newCount,
    }, { onConflict: 'from_account_id,to_account_id' });

  if (error && !error.message.includes('column "total_exchanges" does not exist')) {
    console.error('[Pairs] updatePairRecord failed:', error.message);
  }
}
