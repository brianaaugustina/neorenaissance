// Computes the Blocked vs Ready state for a queue item so the card can show
// Briana exactly what's needed from her (blocked) or confirm there's nothing
// to do but approve (ready).
//
// Heuristics per item type. Keep focused — if the queue item type grows, add
// a case rather than overloading an existing one.

export type ReadinessKind = 'ready' | 'blocked' | 'post_approval';

export interface ReadinessLine {
  kind: ReadinessKind;
  message: string;
  blockers?: string[];
}

export interface ReadinessInput {
  agent_name?: string;
  type?: string;
  status?: string;
  full_output?: unknown;
}

export function computeReadiness(item: ReadinessInput): ReadinessLine | null {
  const status = item.status ?? 'pending';
  const agent = item.agent_name ?? '';
  const type = item.type ?? '';
  const fo = (item.full_output ?? {}) as Record<string, unknown>;

  // Showrunner content package
  if (agent === 'showrunner' && type === 'draft') {
    interface Caption {
      index?: number;
      caption?: string;
      storage_path?: string;
      scheduled_at?: string;
    }
    const captions = Array.isArray(fo.clip_captions)
      ? (fo.clip_captions as Caption[])
      : [];

    if (status === 'pending') {
      const missingFiles = captions
        .filter((c) => !c.storage_path)
        .map((c) => c.index);
      if (missingFiles.length > 0 && captions.length > 0) {
        return {
          kind: 'blocked',
          message: `Missing clip files for ${missingFiles.length} of ${captions.length} clips. Captions will draft; Schedule needs the files.`,
          blockers: missingFiles.map((i) => `Upload clip ${i} video file`),
        };
      }
      return {
        kind: 'ready',
        message:
          captions.length > 0
            ? 'All inputs ready. Approve to unlock Schedule per clip.'
            : 'All inputs ready. Approve to save the Newsletter.',
      };
    }
    if (status === 'approved') {
      if (captions.length === 0) {
        return { kind: 'post_approval', message: 'Complete — Newsletter saved to Notion.' };
      }
      const scheduled = captions.filter((c) => c.scheduled_at).length;
      if (scheduled === captions.length) {
        return {
          kind: 'post_approval',
          message: `All ${captions.length} clips scheduled. This item will move to Outputs.`,
        };
      }
      return {
        kind: 'blocked',
        message: `${scheduled} of ${captions.length} clips scheduled. Pick dates and times for the rest.`,
      };
    }
  }

  // Sponsorship / PR pitch draft
  if (
    (agent === 'sponsorship-director' || agent === 'pr-director') &&
    type === 'draft'
  ) {
    if (status === 'pending') {
      const missing: string[] = [];
      if (!fo.contact_email) missing.push('Add contact email before send');
      if (!fo.subject) missing.push('Subject line missing');
      if (!fo.body) missing.push('Body missing');
      if (missing.length) {
        return {
          kind: 'blocked',
          message: 'Some fields are missing before send.',
          blockers: missing,
        };
      }
      return {
        kind: 'ready',
        message:
          'All inputs ready. Approve to save to Notion Outreach (Gate 3 Send is manual until Gmail OAuth lands).',
      };
    }
    if (status === 'approved') {
      return {
        kind: 'post_approval',
        message: 'Saved to Notion. Copy the body into Gmail to send until OAuth lands.',
      };
    }
  }

  // Research batch
  if (
    (agent === 'sponsorship-director' || agent === 'pr-director') &&
    type === 'report' &&
    Array.isArray(fo.leads)
  ) {
    interface Lead { approved?: boolean }
    const leads = fo.leads as Lead[];
    const approved = leads.filter((l) => l.approved).length;
    if (status === 'pending') {
      return {
        kind: 'ready',
        message:
          approved === 0
            ? `${leads.length} leads ready for review.`
            : `${approved} of ${leads.length} leads drafted. Review the rest or archive the batch.`,
      };
    }
  }

  // Ops Chief daily briefing
  if (agent === 'ops_chief' && type === 'briefing') {
    if (status === 'pending') {
      return { kind: 'ready', message: 'Briefing ready. Approve to save.' };
    }
  }

  // Ops Chief weekly plan — approved but execute still downstream
  if (agent === 'ops_chief' && type === 'recommendation') {
    if (status === 'pending') {
      return { kind: 'ready', message: 'Weekly plan ready. Approve to unlock Execute.' };
    }
    if (status === 'approved') {
      return {
        kind: 'blocked',
        message: 'Approved. Click Execute to apply reschedules + new tasks to Notion.',
      };
    }
  }

  return null;
}
