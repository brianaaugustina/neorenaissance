import '../src/lib/env';
import { supabaseAdmin } from '../src/lib/supabase/client';

// Quick diagnostic — list recent rejected items so we can decide whether to
// restore any of them to pending. Mirrors the find/restore flow of
// recover-deferred.ts.
async function main() {
  const agent = process.argv[2];
  const q = supabaseAdmin()
    .from('approval_queue')
    .select('id, agent_name, type, status, title, feedback, created_at, reviewed_at')
    .eq('status', 'rejected')
    .order('reviewed_at', { ascending: false })
    .limit(10);
  if (agent) q.eq('agent_name', agent);
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) {
    console.log('No rejected items found.');
    return;
  }
  for (const item of data) {
    console.log('─'.repeat(72));
    console.log(`id:           ${item.id}`);
    console.log(`agent:        ${item.agent_name}`);
    console.log(`title:        ${item.title}`);
    console.log(`reviewed_at:  ${item.reviewed_at}`);
    if (item.feedback) console.log(`feedback:     ${item.feedback.slice(0, 200)}`);
  }
  console.log('─'.repeat(72));
  console.log('\nTo restore one to pending:');
  console.log('  npx tsx scripts/recover-deferred.ts <id>  # works for rejected too');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
