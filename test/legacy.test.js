// 从原项目（Express + sqlite3 + bcrypt）升级：旧的 nav.db 必须原样可用
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openNodeDb } from '../src/adapters/node-sqlite.js';
import { makeApp } from './helpers/harness.js';
import { setBcryptLoader } from '../src/core/auth.js';
import { importBackup } from '../src/core/transfer.js';

// 用 libxcrypt 生成的真实 bcrypt 哈希（密码 sweet）
const LEGACY_HASH = '$2b$10$abcdefghijklmnopqrstuuLqlfnzgccDpUQBOG.ucXUTtEojh4wHu';

// 原项目 db.js 里的建表语句（users 表没有 last_login_* 列，原项目是后来用 ALTER TABLE 追加的）
const ORIGINAL_DDL = `
CREATE TABLE menus (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, "order" INTEGER DEFAULT 0);
CREATE TABLE sub_menus (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id INTEGER NOT NULL, name TEXT NOT NULL, "order" INTEGER DEFAULT 0, FOREIGN KEY(parent_id) REFERENCES menus(id) ON DELETE CASCADE);
CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER, sub_menu_id INTEGER, title TEXT NOT NULL, url TEXT NOT NULL, logo_url TEXT, custom_logo_path TEXT, desc TEXT, "order" INTEGER DEFAULT 0, FOREIGN KEY(menu_id) REFERENCES menus(id) ON DELETE CASCADE, FOREIGN KEY(sub_menu_id) REFERENCES sub_menus(id) ON DELETE CASCADE);
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE ads (id INTEGER PRIMARY KEY AUTOINCREMENT, position TEXT NOT NULL, img TEXT NOT NULL, url TEXT NOT NULL);
CREATE TABLE friends (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL, logo TEXT);
`;

describe('旧版 nav.db 兼容', () => {
  let dir; let file;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-legacy-'));
    file = path.join(dir, 'nav.db');
    const raw = new DatabaseSync(file);
    raw.exec(ORIGINAL_DDL);
    raw.exec(`INSERT INTO menus (name, "order") VALUES ('我的栏目', 1), ('第二栏', 2);
      INSERT INTO sub_menus (parent_id, name, "order") VALUES (1, '子栏', 1);
      INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order") VALUES
        (1, NULL, '旧卡片A', 'https://a.old', 'https://a.old/i.png', NULL, '描述A', 2),
        (NULL, 1, '旧子卡片', 'https://b.old', '', 'legacy.png', NULL, 1),
        (2, NULL, '旧卡片C', 'https://c.old', '', NULL, '', 0);
      INSERT INTO ads (position, img, url) VALUES ('left', 'https://i/l.png', 'https://l.old');
      INSERT INTO friends (title, url, logo) VALUES ('旧友链', 'https://f.old', '');`);
    raw.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('amos', LEGACY_HASH);
    raw.close();
  });
  after(() => { setBcryptLoader(() => import('bcryptjs')); fs.rmSync(dir, { recursive: true, force: true }); });

  it('直接打开旧库：自动补齐新增的列与表，不重复写入默认数据，旧数据完整保留', async () => {
    const app = makeApp(openNodeDb(file));
    const menus = await app.call('GET', '/api/menus');
    assert.deepEqual(menus.data.map((m) => m.name), ['我的栏目', '第二栏']);
    assert.equal(menus.data[0].subMenus.length, 1);
    const cols = (await app.db.prepare('PRAGMA table_info(users)').all()).results.map((c) => c.name);
    assert.ok(cols.includes('last_login_time') && cols.includes('last_login_ip'));
    assert.equal((await app.db.prepare('SELECT COUNT(*) AS c FROM cards').first()).c, 3);
    assert.equal((await app.db.prepare('SELECT COUNT(*) AS c FROM users').first()).c, 1);
    assert.equal((await app.call('GET', '/api/friends')).data.length, 1);
    app.db.close();
  });

  it('旧版 bcrypt 密码仍可登录，并在成功后自动升级为 PBKDF2；错误密码依旧被拒绝', async () => {
    let calls = 0;
    setBcryptLoader(async () => ({ compare: async (pw, hash) => { calls++; return pw === 'sweet' && hash === LEGACY_HASH; } }));   // 仅验证调用流程，真实比对由 bcryptjs 完成
    const app = makeApp(openNodeDb(file));
    assert.equal((await app.call('POST', '/api/login', { body: { username: 'amos', password: 'wrong' }, token: null })).status, 401);
    assert.match((await app.db.prepare("SELECT password FROM users WHERE username='amos'").first()).password, /^\$2b\$/);
    const ok = await app.call('POST', '/api/login', { body: { username: 'amos', password: 'sweet' }, token: null });
    assert.equal(ok.status, 200);
    assert.match((await app.db.prepare("SELECT password FROM users WHERE username='amos'").first()).password, /^pbkdf2\$/);
    const before = calls;
    assert.equal((await app.call('POST', '/api/login', { body: { username: 'amos', password: 'sweet' }, token: null })).status, 200);
    assert.equal(calls, before);                                     // 升级后不再走 bcrypt
    app.db.close();
  });

  it('bcryptjs 缺失 / 加载失败时登录安全失败（401），不会放行', async () => {
    setBcryptLoader(async () => { throw new Error('Cannot find package bcryptjs'); });
    const app = makeApp(openNodeDb(path.join(dir, 'second.db')));
    await app.call('GET', '/api/menus');
    await app.db.prepare("UPDATE users SET password = ? WHERE username = 'amos'").bind(LEGACY_HASH).run();
    const origErr = console.error; console.error = () => {};
    try { assert.equal((await app.call('POST', '/api/login', { body: { username: 'amos', password: 'sweet' }, token: null })).status, 401); }
    finally { console.error = origErr; }
    app.db.close();
  });

  it('旧库迁移脚本：old-db-to-json 生成的备份可导入全新实例，数据一致', async () => {
    const out = path.join(dir, 'converted.json');
    const log = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/old-db-to-json.js', file, out], { encoding: 'utf8' });
    assert.match(log, /cards:\s*(?:\u001b\[\d+m)?3/);
    const backup = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(backup.format, 'nav-item-backup'); assert.equal(backup.tables.users, undefined);
    const target = makeApp(openNodeDb(':memory:'));
    await target.call('GET', '/api/menus');
    await target.db.batch([target.db.prepare('DELETE FROM cards'), target.db.prepare('DELETE FROM sub_menus'), target.db.prepare('DELETE FROM menus'), target.db.prepare('DELETE FROM friends')]);
    const rep = await importBackup(target.db, backup, {});
    assert.equal(rep.tables.cards.inserted, 3);
    const sub = (await target.db.prepare("SELECT id FROM sub_menus WHERE name = '子栏'").first()).id;
    assert.equal((await target.call('GET', `/api/cards/0?subMenuId=${sub}`)).data[0].title, '旧子卡片');
    assert.equal((await target.db.prepare("SELECT custom_logo_path AS p FROM cards WHERE title = '旧子卡片'").first()).p, 'legacy.png');
    // 带账号迁移
    const out2 = path.join(dir, 'with-users.json');
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/old-db-to-json.js', file, out2, '--with-users']);
    assert.equal(JSON.parse(fs.readFileSync(out2, 'utf8')).tables.users.length, 1);
    target.db.close();
  });
});
