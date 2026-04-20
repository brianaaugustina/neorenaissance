'use client';

import {
  ShowrunnerCaptionsList,
  type ShowrunnerClipCaptionCard,
} from '@/components/QueueCard';
import { Assessment } from './Assessment';
import { ChildrenSection } from './primitives';
import type { ShowrunnerCaptionsPayload } from './types';

// Thin wrapper around the existing ShowrunnerCaptionsList in QueueCard.tsx.
// Per-clip schedule action is already wired inside ShowrunnerCaptionsList's
// ClipScheduleControl subcomponent — we don't need new handlers here.
export function CaptionsBlock({
  payload,
  queueStatus,
}: {
  payload: ShowrunnerCaptionsPayload;
  queueStatus: string | null;
}) {
  const clipCaptions = (payload.clip_captions ?? []) as ShowrunnerClipCaptionCard[];
  const legacy = Array.isArray(payload.social_captions)
    ? payload.social_captions
    : [];
  const count = clipCaptions.length || legacy.length;
  const approved = queueStatus === 'approved' || queueStatus === 'executed';

  return (
    <>
      <Assessment
        html={`<p>${count} social caption${count === 1 ? '' : 's'} generated${
          payload.episode_type ? ` · ${payload.episode_type} episode` : ''
        }.</p>${
          approved
            ? ''
            : '<p style="color:var(--ink-3);margin-top:6px">Approve the package to unlock per-clip scheduling.</p>'
        }`}
      />

      <ChildrenSection title="Captions" count={count}>
        <ShowrunnerCaptionsList
          clipCaptions={clipCaptions}
          legacySocialCaptions={legacy}
          approved={approved}
        />
      </ChildrenSection>
    </>
  );
}
