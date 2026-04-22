process.chdir('/app');
const { getDatabase } = require('./src/lib/db');
async function main() {
  const db = await getDatabase();
  const rows = db.prepare('SELECT prompt_id, version, name, content FROM prompt_versions WHERE is_active = 1 ORDER BY prompt_id').all();
  rows.forEach(r => {
    console.log('\n========== ' + r.prompt_id + ' | ' + r.version + ' | ' + r.name + ' ==========');
    console.log(r.content);
  });
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
