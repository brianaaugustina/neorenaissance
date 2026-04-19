import { config } from 'dotenv';
config({ path: '.env.local' });
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  const id = process.env.NOTION_CONTENT_DB_ID;
  if (!id) {
    console.log('NOTION_CONTENT_DB_ID not set');
    return;
  }
  try {
    const db: any = await notion.databases.retrieve({ database_id: id });
    let props = db.properties;
    if (!props && db.data_sources?.length) {
      const ds: any = await (notion as any).request({
        path: `data_sources/${db.data_sources[0].id}`,
        method: 'GET',
      });
      props = ds.properties;
    }
    console.log(`=== Content DB (${id}) ===`);
    console.log(
      `title: ${db.title?.map((t: any) => t.plain_text).join('') || '(untitled)'}`,
    );
    for (const [name, p] of Object.entries<any>(props ?? {})) {
      const extra =
        p.type === 'select' || p.type === 'multi_select' || p.type === 'status'
          ? ` options=[${(p[p.type]?.options || []).map((o: any) => o.name).join(' | ')}]`
          : p.type === 'relation'
            ? ` -> ${p.relation?.database_id}`
            : '';
      console.log(`  - ${name} (${p.type})${extra}`);
    }
  } catch (e: any) {
    console.log(`X ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
