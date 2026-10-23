// 数据库结构、迁移与首次初始化（Workers 没有“启动钩子”，因此在首个请求时惰性执行）
import { hashPassword } from './auth.js';
import { getSetting, setSetting } from './settings.js';
import { buildInserts } from './sqlutil.js';
import { SEED_MENUS, SEED_SUB_MENUS, SEED_CARDS, SEED_FRIENDS } from './seed-data.js';

export const SCHEMA_VERSION = 2;

/** 表定义：列顺序即导出顺序；dependsOn 决定导入 / 导出顺序 */
export const TABLES = {
  menus:      { cols: ['id', 'name', 'order'] },
  sub_menus:  { cols: ['id', 'parent_id', 'name', 'order'] },
  cards:      { cols: ['id', 'menu_id', 'sub_menu_id', 'title', 'url', 'logo_url', 'custom_logo_path', 'desc', 'order'] },
  ads:        { cols: ['id', 'position', 'img', 'url'] },
  friends:    { cols: ['id', 'title', 'url', 'logo'] },
  users:      { cols: ['id', 'username', 'password', 'last_login_time', 'last_login_ip'], sensitive: true },
  uploads:    { cols: ['id', 'filename', 'mime', 'size', 'data', 'created_at'], heavy: true }
};
export const TABLE_ORDER = ['menus', 'sub_menus', 'cards', 'ads', 'friends', 'users', 'uploads'];
export const TABLE_LABELS = {
  menus: '栏目', sub_menus: '子栏目', cards: '导航卡片', ads: '广告', friends: '友情链接', users: '管理员账号', uploads: '上传的图片'
};

export const DDL = [
  `CREATE TABLE IF NOT EXISTS menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  "order" INTEGER DEFAULT 0
)`,
  `CREATE INDEX IF NOT EXISTS idx_menus_order ON menus("order")`,
  `CREATE TABLE IF NOT EXISTS sub_menus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  "order" INTEGER DEFAULT 0,
  FOREIGN KEY(parent_id) REFERENCES menus(id) ON DELETE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS idx_sub_menus_parent_id ON sub_menus(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sub_menus_order ON sub_menus("order")`,
  `CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_id INTEGER,
  sub_menu_id INTEGER,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  logo_url TEXT,
  custom_logo_path TEXT,
  desc TEXT,
  "order" INTEGER DEFAULT 0,
  FOREIGN KEY(menu_id) REFERENCES menus(id) ON DELETE CASCADE,
  FOREIGN KEY(sub_menu_id) REFERENCES sub_menus(id) ON DELETE CASCADE
)`,
  `CREATE INDEX IF NOT EXISTS idx_cards_menu_id ON cards(menu_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cards_sub_menu_id ON cards(sub_menu_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cards_order ON cards("order")`,
  `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  last_login_time TEXT,
  last_login_ip TEXT
)`,
  `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
  `CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position TEXT NOT NULL,
  img TEXT NOT NULL,
  url TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_ads_position ON ads(position)`,
  `CREATE TABLE IF NOT EXISTS friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  logo TEXT
)`,
  `CREATE INDEX IF NOT EXISTS idx_friends_title ON friends(title)`,
  // 以下两张为新增：上传图片（Workers 没有本地磁盘，改存数据库）与站点设置
  `CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT UNIQUE NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  data TEXT NOT NULL,
  created_at TEXT
)`,
  `CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
)`
];

async function columnsOf(db, table) {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all();
  return (results || []).map((r) => r.name);
}

/** 旧库迁移：原项目通过 ALTER TABLE 追加 users 的登录记录列，这里做同样的兼容 */
async function migrate(db) {
  const cols = await columnsOf(db, 'users');
  if (!cols.includes('last_login_time')) await db.prepare('ALTER TABLE users ADD COLUMN last_login_time TEXT').run();
  if (!cols.includes('last_login_ip')) await db.prepare('ALTER TABLE users ADD COLUMN last_login_ip TEXT').run();
}

async function seedAdmin(db, env) {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM users').first();
  if (row && row.c > 0) return;
  const username = env.ADMIN_USERNAME || 'amos';
  const password = env.ADMIN_PASSWORD || 'sweet';
  await db.prepare('INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)')
    .bind(username, await hashPassword(password)).run();
}

async function seedContent(db) {
  if (await getSetting(db, 'seeded')) return;
  const menus = await db.prepare('SELECT COUNT(*) AS c FROM menus').first();
  if (menus && menus.c > 0) { await setSetting(db, 'seeded', 'existing'); return; }

  const rows = (cols, list) => list.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  const now = new Date().toISOString();
  const stmts = [
    // 守卫语句：若并发的另一个实例已经完成播种，主键冲突会让整个 batch 原子回滚，避免重复数据
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('seeded', 'default', ?)").bind(now),
    ...buildInserts(db, 'menus', ['id', 'name', 'order'], rows(['id', 'name', 'order'], SEED_MENUS)),
    ...buildInserts(db, 'sub_menus', ['id', 'parent_id', 'name', 'order'], rows(['id', 'parent_id', 'name', 'order'], SEED_SUB_MENUS)),
    ...buildInserts(db, 'cards', ['menu_id', 'sub_menu_id', 'title', 'url', 'logo_url', 'desc', 'order'],
      rows(['menu_id', 'sub_menu_id', 'title', 'url', 'logo_url', 'desc', 'order'], SEED_CARDS)),
    ...buildInserts(db, 'friends', ['title', 'url', 'logo'], rows(['title', 'url', 'logo'], SEED_FRIENDS))
  ];
  try {
    await db.batch(stmts);
  } catch (e) {
    if (!/UNIQUE|constraint/i.test(String(e && e.message))) throw e; // 他处已播种，忽略
  }
}

const state = { db: null, promise: null };

/** 确保表结构存在并完成首次播种。同一个 db 对象在一个实例内只会执行一次。 */
export function ensureSchema(db, env = {}) {
  if (state.db === db && state.promise) return state.promise;
  state.db = db;
  state.promise = (async () => {
    let current = null;
    try { current = await getSetting(db, 'schema_version'); } catch { /* settings 表尚不存在 */ }
    if (current !== String(SCHEMA_VERSION)) {
      await db.batch(DDL.map((s) => db.prepare(s)));
      await migrate(db);
      await setSetting(db, 'schema_version', String(SCHEMA_VERSION));
    }
    await seedAdmin(db, env);
    await seedContent(db);
  })().catch((e) => { state.promise = null; throw e; });
  return state.promise;
}

/** 仅测试使用：重置惰性初始化缓存 */
export function _resetSchemaState() { state.db = null; state.promise = null; }

export const DDL_SQL = DDL.map((s) => s + ';').join('\n\n') + '\n';
