import { config } from 'dotenv';
config({ path: '.env.local' });
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

async function main() {
  console.log('Listing every database/data source visible to the integration...\n');
  const res: any = await notion.search({
    filter: { property: 'object', value: 'data_source' },
    page_size: 100,
  });
  for (const r of res.results) {
    const title = (r.title || r.name || []).map?.((t: any) => t.plain_text).join('') || r.title || '(untitled)';
    console.log(`• ${title}`);
    console.log(`    object:         ${r.object}`);
    console.log(`    id:             ${r.id}`);
    if (r.parent) console.log(`    parent:         ${JSON.stringify(r.parent)}`);
    console.log();
  }
  console.log(`Total: ${res.results.length}`);

  // Also try databases
  console.log('\n--- databases ---');
  const res2: any = await (notion as any).search({
    filter: { property: 'object', value: 'database' },
    page_size: 100,
  });
  for (const r of res2.results) {
    const title = (r.title || []).map((t: any) => t.plain_text).join('') || '(untitled)';
    console.log(`• ${title}  (${r.id})`);
    if (r.data_sources) {
      for (const ds of r.data_sources) {
        console.log(`    ↳ data_source: ${ds.id}  ${ds.name ?? ''}`);
      }
    }
  }
  console.log(`Total: ${res2.results.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
