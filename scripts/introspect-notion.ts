import { config } from 'dotenv';
config({ path: '.env.local' });
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const DBS: Record<string, string | undefined> = {
  Tasks: process.env.NOTION_TASKS_DB_ID,
  Initiatives: process.env.NOTION_INITIATIVES_DB_ID,
  Intentions: process.env.NOTION_INTENTIONS_DB_ID,
  Outcomes: process.env.NOTION_OUTCOMES_DB_ID,
  Notes: process.env.NOTION_NOTES_DB_ID,
  Content: process.env.NOTION_CONTENT_DB_ID,
};

async function main() {
  for (const [name, id] of Object.entries(DBS)) {
    if (!id) {
      console.log(`\n⚠ ${name}: no env var set`);
      continue;
    }
    try {
      const db: any = await notion.databases.retrieve({ database_id: id });
      console.log(`\n=== ${name} (${id}) ===`);
      console.log(`title: ${db.title?.map((t: any) => t.plain_text).join('') || '(untitled)'}`);
      let props = db.properties;
      if (!props && db.data_sources?.length) {
        const dsId = db.data_sources[0].id;
        console.log(`  (multi-source DB, using data_source ${dsId})`);
        const ds: any = await (notion as any).request({
          path: `data_sources/${dsId}`,
          method: 'GET',
        });
        props = ds.properties;
      }
      if (!props) {
        console.log('  (no properties returned)');
        console.log(JSON.stringify(db, null, 2).slice(0, 800));
        continue;
      }
      for (const [propName, prop] of Object.entries<any>(props)) {
        const extra =
          prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status'
            ? ` options=[${(prop[prop.type]?.options || []).map((o: any) => o.name).join(', ')}]`
            : prop.type === 'relation'
            ? ` → ${prop.relation?.database_id}`
            : '';
        console.log(`  • ${propName}  (${prop.type})${extra}`);
      }
    } catch (e: any) {
      console.log(`\n✗ ${name} (${id}): ${e.message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
