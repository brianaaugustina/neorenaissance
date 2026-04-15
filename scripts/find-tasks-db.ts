import { config } from 'dotenv';
config({ path: '.env.local' });
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  const TASKS_DS_ID = '8eefd9d0-a154-4a64-95c6-014451933fed';
  console.log(`Retrieving Tasks data source ${TASKS_DS_ID}...`);
  try {
    const ds: any = await notion.dataSources.retrieve({ data_source_id: TASKS_DS_ID });
    console.log(`\nParent type: ${ds.parent?.type}`);
    console.log(`Parent database_id: ${ds.parent?.database_id}`);
    console.log(`Title: ${(ds.title || []).map((t: any) => t.plain_text).join('') || '(untitled)'}`);
    console.log(`\nProperties:`);
    for (const [name, prop] of Object.entries<any>(ds.properties || {})) {
      const extra =
        prop.type === 'select' || prop.type === 'multi_select' || prop.type === 'status'
          ? ` options=[${(prop[prop.type]?.options || []).map((o: any) => o.name).join(', ')}]`
          : prop.type === 'relation'
          ? ` → ${prop.relation?.database_id}`
          : '';
      console.log(`  • ${name}  (${prop.type})${extra}`);
    }
  } catch (e: any) {
    console.log(`✗ ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
