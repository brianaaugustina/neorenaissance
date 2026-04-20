import Link from 'next/link';
import { Suspense } from 'react';
import { AnalyticsCsvUpload } from '@/components/AnalyticsCsvUpload';
import { GoogleConnectPanel } from '@/components/GoogleConnectPanel';
import { RunAnalyticsReportButton } from '@/components/RunAnalyticsReportButton';
import { RunFundingResearchButton } from '@/components/RunFundingResearchButton';
import { RunGrowthBriefingButton } from '@/components/RunGrowthBriefingButton';
import { RunOpsChiefButton } from '@/components/RunOpsChiefButton';
import { RunPrResearchButton } from '@/components/RunPrResearchButton';
import { RunSponsorshipResearchButton } from '@/components/RunSponsorshipResearchButton';
import { RunSupervisorButton } from '@/components/RunSupervisorButton';
import { RunSystemEngineerButton } from '@/components/RunSystemEngineerButton';
import { RunTalentResearchButton } from '@/components/RunTalentResearchButton';
import { ShowrunnerInput } from '@/components/ShowrunnerInput';
import {
  isGoogleConnected,
  isGoogleOAuthConfigured,
} from '@/lib/analytics/google-oauth';
import { getOAuthToken } from '@/lib/analytics/oauth-tokens';
import {
  getTrackedRepos,
  isGithubConfigured,
} from '@/lib/system-engineer/github';
import { isVercelConfigured } from '@/lib/system-engineer/vercel';

interface Props {
  agentId: string;
}

/**
 * Renders the appropriate manual-trigger UI for an agent id, including any
 * per-agent sidecar controls (CSV upload for analytics, OAuth connect,
 * tracked-repo status for system engineer). Every detail page consumes this
 * so the visual shell stays uniform.
 */
export async function AgentTriggerPanel({ agentId }: Props) {
  switch (agentId) {
    case 'ops_chief':
    case 'ops-chief':
      return (
        <Wrap
          blurb="Runs the daily briefing synthesis. Standard cron fires Mon–Fri 5am PT; trigger manually for an off-cycle run."
        >
          <RunOpsChiefButton />
        </Wrap>
      );

    case 'showrunner':
      return (
        <Wrap blurb="Paste an episode transcript and Showrunner writes the Substack post, titles/descriptions, and one caption per clip. Interview episodes take guest info + outline.">
          <ShowrunnerInput />
        </Wrap>
      );

    case 'sponsorship-director':
      return (
        <Wrap blurb="Weekly cron surfaces 10 leads Mon 8am PT. Trigger off-cycle for a fresh batch now.">
          <RunSponsorshipResearchButton />
        </Wrap>
      );

    case 'pr-director':
      return (
        <Wrap blurb="Monthly landscape scan + weekly press research. Trigger below; the landscape view lives at a dedicated page.">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <RunPrResearchButton />
            <Link href="/agents/pr-director/landscape" className="btn ghost">
              Open landscape →
            </Link>
          </div>
        </Wrap>
      );

    case 'talent-scout':
      return (
        <Wrap blurb="Manual-only. Each surfaced lead is written to Notion Contacts (append-only) and carries a suggested channel — email, IG DM, or through-team.">
          <RunTalentResearchButton />
        </Wrap>
      );

    case 'funding-scout':
      return (
        <Wrap blurb="Non-dilutive only. Each opportunity is web-verified and scored against the 6-point fit test. Approve an opportunity and a custom application draft generates in your voice.">
          <RunFundingResearchButton />
        </Wrap>
      );

    case 'growth-strategist':
      return (
        <Wrap blurb="Pick output type — monthly pulse (default cron), quarterly review, or on-demand channel / audience / synergy analysis.">
          <RunGrowthBriefingButton />
        </Wrap>
      );

    case 'agent-supervisor':
      return (
        <Wrap blurb="Weekly = all agents, 7-day window, trailing 28-day comparison. Deep dive = one agent, longer window, more specific pattern analysis.">
          <RunSupervisorButton />
        </Wrap>
      );

    case 'analytics-reporting': {
      const googleToken = await getOAuthToken('google').catch(() => null);
      const googleConnected = isGoogleOAuthConfigured()
        ? await isGoogleConnected().catch(() => false)
        : false;
      const channelTitle =
        (googleToken?.raw as { channel_title?: string } | null)?.channel_title ?? null;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <Wrap blurb="Leave period end blank to run the previous calendar month (what the cron does). Set it to re-run a specific past month.">
            <RunAnalyticsReportButton />
          </Wrap>

          <SubBlock title="YouTube connection">
            {isGoogleOAuthConfigured() ? (
              <Suspense
                fallback={
                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    Loading…
                  </div>
                }
              >
                <GoogleConnectPanel
                  connected={googleConnected}
                  channelTitle={channelTitle}
                />
              </Suspense>
            ) : (
              <p className="mono" style={{ fontSize: 11, color: 'var(--danger)', margin: 0 }}>
                GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET / REDIRECT_URI not set in .env.local.
              </p>
            )}
          </SubBlock>

          <SubBlock title="Substack / Spotify · manual CSV upload">
            <p
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--ink-3)',
                letterSpacing: '0.04em',
                margin: '0 0 14px',
                maxWidth: 640,
                lineHeight: 1.55,
              }}
            >
              Neither platform has a usable analytics API. Export a CSV from
              the platform dashboard for the period and upload here — the
              parser writes a snapshot the monthly report picks up.
            </p>
            <AnalyticsCsvUpload />
          </SubBlock>
        </div>
      );
    }

    case 'system-engineer': {
      const tracked = getTrackedRepos();
      const ghConfigured = isGithubConfigured();
      const vcConfigured = isVercelConfigured();
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <Wrap blurb="Leave repo selector on 'All tracked repos' for the normal weekly pass. Pick one to run a focused scan.">
            <RunSystemEngineerButton />
          </Wrap>

          <SubBlock title="Data sources">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    marginBottom: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: '-0.005em',
                    }}
                  >
                    GitHub
                  </span>
                  <ConnectionDot configured={ghConfigured} label={ghConfigured ? 'PAT configured' : 'GITHUB_PAT missing'} />
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {tracked.map((r) => (
                    <li
                      key={r.shortId}
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--ink-3)',
                        padding: '3px 0',
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-sans), "Inter", sans-serif',
                          fontSize: 12,
                          color: 'var(--ink-2)',
                          letterSpacing: '-0.005em',
                          fontWeight: 500,
                        }}
                      >
                        {r.label}
                      </span>
                      <span style={{ color: 'var(--ink-4)' }}>·</span>
                      <span>
                        {r.slug ?? (
                          <span style={{ color: 'var(--danger)' }}>env var missing</span>
                        )}
                      </span>
                      <span style={{ color: 'var(--ink-4)' }}>·</span>
                      <span>priority {r.priority}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    marginBottom: 4,
                    flexWrap: 'wrap',
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: '-0.005em',
                    }}
                  >
                    Vercel
                  </span>
                  <ConnectionDot
                    configured={vcConfigured}
                    label={vcConfigured ? 'token configured' : 'VERCEL_TOKEN missing'}
                  />
                </div>
              </div>
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--ink-3)',
                      letterSpacing: '-0.005em',
                    }}
                  >
                    Supabase logs
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--ink-3)',
                    }}
                  >
                    · deferred to a later pass
                  </span>
                </div>
              </div>
            </div>
          </SubBlock>
        </div>
      );
    }

    default:
      return (
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            letterSpacing: '0.04em',
            margin: 0,
            lineHeight: 1.55,
          }}
        >
          This agent runs on a schedule — no manual trigger here.
        </p>
      );
  }
}

// ============================================================================

function Wrap({
  blurb,
  children,
}: {
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--ink-3)',
          letterSpacing: '0.04em',
          margin: 0,
          maxWidth: 640,
          lineHeight: 1.55,
        }}
      >
        {blurb}
      </p>
      {children}
    </div>
  );
}

function SubBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-2)',
          fontWeight: 500,
          margin: '0 0 10px',
        }}
      >
        {title}
      </h4>
      {children}
    </div>
  );
}

function ConnectionDot({ configured, label }: { configured: boolean; label: string }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: configured ? 'var(--ok)' : 'var(--danger)',
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          background: configured ? 'var(--ok)' : 'var(--danger)',
          borderRadius: '50%',
        }}
      />
      {label}
    </span>
  );
}
