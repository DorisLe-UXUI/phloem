// Report how many bytes each table and column of a Phloem database takes (to see what bloats the backup snapshot).
// Usage: node server/scripts/db-sizes.mjs path/to/phloem.db — works on a copy, never touches the original file.
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = process.argv[2];
if (!src || !existsSync(src)) { console.error('usage: node server/scripts/db-sizes.mjs <phloem.db>'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'db-sizes-'));
const file = join(dir, 'copy.db');
for (const ext of ['', '-wal', '-shm']) if (existsSync(src + ext)) copyFileSync(src + ext, file + ext);
const db = new DatabaseSync(file);
const kb = (n) => `${(Number(n) / 1024).toFixed(1)} KB`;
const rows = [];
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
  const t = `"${name.replace(/"/g, '""')}"`;
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  const per = cols.map((c) => ({ c, b: Number(db.prepare(`SELECT COALESCE(SUM(length(CAST("${c.replace(/"/g, '""')}" AS BLOB))), 0) AS b FROM ${t}`).get().b) }));
  rows.push({ name, n, total: per.reduce((s, x) => s + x.b, 0), per: per.sort((a, b) => b.b - a.b) });
}
rows.sort((a, b) => b.total - a.total);
db.exec(`VACUUM INTO '${join(dir, 'vacuum.db').replace(/'/g, "''")}'`);
console.log(`file ${kb(statSync(src).size)}, vacuumed ${kb(statSync(join(dir, 'vacuum.db')).size)}`);
for (const r of rows) {
  console.log(`\n${r.name}: ${r.n} rows, ${kb(r.total)}`);
  for (const x of r.per) if (x.b) console.log(`  ${x.c.padEnd(16)} ${kb(x.b).padStart(12)}`);
}
db.close();
rmSync(dir, { recursive: true, force: true });
