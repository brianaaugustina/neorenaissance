import '../src/lib/env';
import { runOpsChiefDailyBriefing } from '../src/lib/agents/ops-chief';

async function main() {
  console.log('Ops Chief — Daily Briefing (manual run)\n');
  const { briefing, runId, queueId, result, context } = await runOpsChiefDailyBriefing('manual');

  console.log('─'.repeat(72));
  console.log(briefing);
  console.log('─'.repeat(72));
  console.log();
  console.log(`run_id:           ${runId}`);
  console.log(`approval_queue:   ${queueId}`);
  console.log(
    `tokens:           ${result.inputTokens} in / ${result.outputTokens} out   cost: $${result.costEstimate.toFixed(4)}`,
  );
  console.log(
    `context:          today=${context.todayIso} urgent=${context.urgentProjects.length} urgent_subs=${context.urgentSubtasks.length} overdue=${context.overdueTasks.length} today_tasks=${context.todaysTasks.length} outcomes=${context.activeOutcomes.length}`,
  );
  const errs = Object.entries(context.errors);
  if (errs.length) {
    console.log('errors:');
    for (const [k, v] of errs) console.log(`  ${k}: ${v}`);
  }
}

main().catch((e) => {
  console.error('\n✗ Ops Chief run failed:', e);
  process.exit(1);
});
