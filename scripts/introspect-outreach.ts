// One-off: dump the Sponsorship Director pipeline DB schemas so we can wire
// the correct field names into the agent. Safe read-only introspection.

import { config } from 'dotenv';
config({ path: '.env.local' });
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DBS: Record<string, string | undefined> = {
  Companies: process.env.NOTION_COMPANIES_DB_ID,
  Contacts: process.env.NOTION_CONTACTS_DB_ID,
  Outreach: process.env.NOTION_OUTREACH_DB,
};

async function main() {
  for (const [name, id] of Object.entries(DBS)) {
    if (!id) {
      console.log(`\nX ${name}: no env var set`);
      continue;
    }
    try {
      const db: any = await notion.databases.retrieve({ database_id: id });
      console.log(`\n=== ${name} (${id}) ===`);
      console.log(
        `title: ${db.title?.map((t: any) => t.plain_text).join('') || '(untitled)'}`,
      );
      let props = db.properties;
      if (!props && db.data_sources?.length) {
        const dsId = db.data_sources[0].id;
        console.log(`  (multi-source DB, data_source ${dsId})`);
        const ds: any = await (notion as any).request({
          path: `data_sources/${dsId}`,
          method: 'GET',
        });
        props = ds.properties;
      }
      if (!props) {
        console.log('  (no properties returned)');
        continue;
      }
      for (const [propName, prop] of Object.entries<any>(props)) {
        const typeInfo =
          prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status'
            ? ` options=[${(prop[prop.type]?.options || []).map((o: any) => o.name).join(' | ')}]`
            : prop.type === 'relation'
              ? ` -> ${prop.relation?.database_id}`
              : prop.type === 'rollup'
                ? ` (rollup)`
                : prop.type === 'formula'
                  ? ` (formula)`
                  : '';
        console.log(`  - ${propName}  (${prop.type})${typeInfo}`);
      }
    } catch (e: any) {
      console.log(`\nX ${name} (${id}): ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
