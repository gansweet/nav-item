// 把旧版（或任何一份）nav.db 转换成可在「后台 → 数据库管理 → 导入」中使用的备份 JSON。
// 用法：node scripts/old-db-to-json.js database/nav.db [输出文件.json] [--with-users]
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const withUsers = process.argv.includes('--with-users');
const [dbFile, outFile = `nav-backup-from-old-db.json`] = args;
if (!dbFile || !fs.existsSync(dbFile)) {
  console.error('用法：node scripts/old-db-to-json.js <nav.db 路径> [输出.json] [--with-users]');
  process.exit(1);
}

const db = new DatabaseSync(dbFile, { readOnly: true });
const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const dump = (t, cols) => {
  if (!has(t)) return [];
  const exist = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const use = cols.filter((c) => exist.includes(c));
  return db.prepare(`SELECT ${use.map((c) => `"${c}"`).join(',')} FROM "${t}" ORDER BY id`).all().map((r) => ({ ...r }));
};

const tables = {
  menus: dump('menus', ['id', 'name', 'order']),
  sub_menus: dump('sub_menus', ['id', 'parent_id', 'name', 'order']),
  cards: dump('cards', ['id', 'menu_id', 'sub_menu_id', 'title', 'url', 'logo_url', 'custom_logo_path', 'desc', 'order']),
  ads: dump('ads', ['id', 'position', 'img', 'url']),
  friends: dump('friends', ['id', 'title', 'url', 'logo'])
};
if (withUsers) tables.users = dump('users', ['id', 'username', 'password', 'last_login_time', 'last_login_ip']);

const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
fs.writeFileSync(outFile, JSON.stringify({
  format: 'nav-item-backup', version: 2, app: 'nav-item', exportedAt: new Date().toISOString(), engine: 'legacy-sqlite', counts, tables
}, null, 2));
console.log(`已生成 ${outFile}`, counts);
if (!withUsers) console.log('（未包含管理员账号；如需迁移账号请加 --with-users）');
db.close();
