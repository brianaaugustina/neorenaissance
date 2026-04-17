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
  },
  supabase: {
    url: required('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
  },
};
