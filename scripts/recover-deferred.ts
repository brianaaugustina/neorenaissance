import '../src/lib/env';
import { supabaseAdmin, updateQueueStatus } from '../src/lib/supabase/client';

// Recovery helper for accidentally-deferred approval queue items.
//
// Usage:
//   npx tsx scripts/recover-deferred.ts
//     → lists recent deferred items (all agents)
//
//   npx tsx scripts/recover-deferred.ts <queue_id>
//     → prints the item's full output, then restores it to pending
//
//   npx tsx scripts/recover-deferred.ts <queue_id> --print-only
//     → prints the full output without changing status

async function listDeferred() {
  const { data, error } = await supabaseAdmin()
    .from('approval_queue')
    .select('id, agent_name, type, title, summary, feedback, created_at, reviewed_at')
    .eq('status', 'deferred')
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .limit(30);
  if (error) throw error;
  if (!data?.length) {
    console.log('No deferred items found.');
    return;
  }
  console.log(`Found ${data.length} deferred item(s):\n`);
  for (const item of data) {
    console.log('─'.repeat(72));
    console.log(`id:           ${item.id}`);
    console.log(`agent:        ${item.agent_name}`);
    console.log(`type:         ${item.type}`);
    console.log(`title:        ${item.title}`);
    if (item.summary) console.log(`summary:      ${item.summary}`);
    console.log(`created_at:   ${item.created_at}`);
    if (item.reviewed_at) console.log(`reviewed_at:  ${item.reviewed_at}`);
    if (item.feedback) console.log(`feedback:     ${item.feedback}`);
  }
  console.log('─'.repeat(72));
  console.log(
    '\nTo restore one to pending and dump its full output:\n  npx tsx scripts/recover-deferred.ts <queue_id>',
  );
}

async function recover(id: string, printOnly: boolean) {
  const { data: item, error } = await supabaseAdmin()
    .from('approval_queue')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  if (!item) {
    console.error(`No approval_queue row with id=${id}`);
    process.exit(1);
  }

  console.log('─'.repeat(72));
  console.log(`id:           ${item.id}`);
  console.log(`agent:        ${item.agent_name}`);
  console.log(`type:         ${item.type}`);
  console.log(`status:       ${item.status}`);
  console.log(`title:        ${item.title}`);
  if (item.feedback) console.log(`feedback:     ${item.feedback}`);
  console.log('─'.repeat(72));
  console.log('FULL OUTPUT:\n');
  console.log(JSON.stringify(item.full_output, null, 2));
  console.log('─'.repeat(72));

  if (printOnly) {
    console.log('\n(--print-only set — status unchanged)');
    return;
  }

  if (item.status !== 'deferred') {
    console.log(
      `\nNote: current status is "${item.status}", not "deferred". Not restoring.`,
    );
    return;
  }

  await updateQueueStatus(id, 'pending');
  console.log('\n✓ Restored to pending. Refresh the dashboard to see it in the queue.');
}

async function main() {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--'));
  const printOnly = args.includes('--print-only');

  if (!id) {
    await listDeferred();
    return;
  }
  await recover(id, printOnly);
}

main().catch((e) => {
  console.error('\n✗ Recover failed:', e);
  process.exit(1);
});
