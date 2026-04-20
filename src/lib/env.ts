import { config } from 'dotenv';
import path from 'path';

// Load .env.local explicitly so CLI scripts (run via tsx) see the same env
// that Next.js loads at runtime. No-op if already loaded.
const envPath = path.resolve(process.cwd(), '.env.local');
config({ path: envPath });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  notion: {
    apiKey: required('NOTION_API_KEY'),
    tasksDbId: required('NOTION_TASKS_DB_ID'),
    initiativesDbId: required('NOTION_INITIATIVES_DB_ID'),
    intentionsDbId: required('NOTION_INTENTIONS_DB_ID'),
    outcomesDbId: required('NOTION_OUTCOMES_DB_ID'),
    notesDbId: process.env.NOTION_NOTES_DB_ID,
    contentDbId: process.env.NOTION_CONTENT_DB_ID,
    companiesDbId: process.env.NOTION_COMPANIES_DB_ID,
    contactsDbId: process.env.NOTION_CONTACTS_DB_ID,
    outreachDbId: process.env.NOTION_OUTREACH_DB,
    fundingDbId: process.env.NOTION_FUNDING_DB_ID,
  },
  supabase: {
    url: required('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
  },
  embedding: {
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    dims: Number(process.env.EMBEDDING_DIMS ?? 1536),
  },
  analytics: {
    // All optional — Analytics & Reporting degrades gracefully when a key is
    // missing (platform gets marked "not configured" in the report).
    posthogApiKey: process.env.POSTHOG_API_KEY,
    posthogProjectId: process.env.POSTHOG_PROJECT_ID,
    posthogHost: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    convertkitApiKey: process.env.CONVERTKIT_API_KEY,
    convertkitApiSecret: process.env.CONVERTKIT_API_SECRET,
  },
  googleOAuth: {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
  },
  github: {
    // Read-only fine-grained PAT scoped to the 4 tracked repos. System Engineer
    // degrades gracefully if missing — each repo is reported as "not configured."
    pat: process.env.GITHUB_PAT,
    repoAgentSystem: process.env.GITHUB_REPO_AGENT_SYSTEM,
    repoDetto: process.env.GITHUB_REPO_DETTO,
    repoTTS: process.env.GITHUB_REPO_TTS,
    repoPersonalSite: process.env.GITHUB_REPO_PERSONAL_SITE,
  },
  vercel: {
    token: process.env.VERCEL_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
  },
};
