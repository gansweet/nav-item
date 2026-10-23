// 数据库导入 / 导出 / 状态 / 表浏览 / SQL 控制台
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ADAPTERS, makeApp } from './helpers/harness.js';
import { exportBackup, exportSql, importBackup, urlKey, normalizePayload } from '../src/core/transfer.js';
import { TABLE_ORDER } from '../src/core/schema.js';

const rowsOf = async (db, t) => (await db.prepare(`SELECT * FROM "${t}" ORDER BY id`).all()).results;
const count = async (db, t) => (await db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).first()).c;
const fresh = async (name, env) => { const a = makeApp(ADAPTERS[name](), env); await a.login(); return a; };

for (const name of Object.keys(ADAPTERS)) {
  describe(`导出 / 导入 [${name}]`, () => {
    it('JSON 导出：默认 5 张内容表；账号与图片需显式包含；绝不包含 JWT 密钥与远程连接密钥', async () => {
      const a = await fresh(name);
      await a.call('PUT', '/api/db/connections', { body: { supabase: { url: 'https://x.supabase.co', key: 'sb_secret_SUPERSECRET' } } });
      const b = await exportBackup(a.db, {});
      assert.equal(b.format, 'nav-item-backup');
      assert.deepEqual(Object.keys(b.tables), ['menus', 'sub_menus', 'cards', 'ads', 'friends']);
      assert.equal(b.counts.cards, 187);
      const withUsers = await exportBackup(a.db, { includeUsers: true, includeUploads: true });
      assert.deepEqual(Object.keys(withUsers.tables), TABLE_ORDER);
      const text = JSON.stringify(withUsers);
      assert.ok(!text.includes('SUPERSECRET'));
      assert.ok(!text.includes('jwt_secret'));
    });

    it('完整往返：导出 → 在另一个库「替换」导入 → 所有表逐行一致（含原 ID）', async () => {
      const a = await fresh(name);
      const png = new Uint8Array([1, 2, 3, 4]); const f = new FormData(); f.append('logo', new File([png], 'k.png'));
      await a.call('POST', '/api/upload', { form: f });
      const backup = await exportBackup(a.db, { includeUsers: true, includeUploads: true });
      const b = await fresh(name, { ADMIN_PASSWORD: 'other' });
      const rep = await importBackup(b.db, backup, { mode: 'replace', tables: TABLE_ORDER });
      assert.equal(rep.atomic, true);
      for (const t of TABLE_ORDER) assert.deepEqual(await rowsOf(b.db, t), await rowsOf(a.db, t), `表 ${t} 不一致`);
    });

    it('合并·跳过：重复导入同一份数据不新增任何记录；新记录自动追加', async () => {
      const a = await fresh(name); const b = await fresh(name);
      await a.call('POST', '/api/cards', { body: { menu_id: 1, title: '全新卡片', url: 'https://brand-new.test', order: 5 } });
      const backup = await exportBackup(a.db, {});
      const before = await count(b.db, 'cards');
      const rep = await importBackup(b.db, backup, { conflict: 'skip' });
      assert.equal(rep.tables.cards.inserted, 1);
      assert.equal(rep.tables.cards.skipped, 187);
      assert.equal(rep.tables.menus.inserted, 0);
      assert.equal(await count(b.db, 'cards'), before + 1);
      const again = await importBackup(b.db, backup, { conflict: 'skip' });
      assert.equal(again.totals.inserted, 0);
      assert.equal(await count(b.db, 'cards'), before + 1);
    });

    it('合并·覆盖：只更新有差异的记录，其余计为 unchanged', async () => {
      const a = await fresh(name); const b = await fresh(name);
      await a.db.prepare("UPDATE cards SET desc = '改过的描述', \"order\" = 77 WHERE title = 'GitHub'").run();
      const backup = await exportBackup(a.db, {});
      const rep = await importBackup(b.db, backup, { conflict: 'overwrite' });
      assert.equal(rep.tables.cards.overwritten, 1);
      assert.equal(rep.tables.cards.unchanged, 186);
      assert.equal(rep.tables.cards.inserted, 0);
      const gh = await b.db.prepare("SELECT desc, \"order\" FROM cards WHERE title = 'GitHub'").first();
      assert.deepEqual({ ...gh }, { desc: '改过的描述', order: 77 });
      // 同样的“跳过”模式则不会改
      const c = await fresh(name);
      const skip = await importBackup(c.db, backup, { conflict: 'skip' });
      assert.equal(skip.tables.cards.overwritten, 0);
      assert.notEqual((await c.db.prepare("SELECT \"order\" AS o FROM cards WHERE title = 'GitHub'").first()).o, 77);
    });

    it('外键重映射：目标库的栏目 ID 与备份不同，卡片仍挂到同名栏目下', async () => {
      const src = await fresh(name);
      const backup = await exportBackup(src.db, {});
      const target = makeApp(ADAPTERS[name]());
      await target.login();
      await target.db.batch([target.db.prepare('DELETE FROM cards'), target.db.prepare('DELETE FROM sub_menus'), target.db.prepare('DELETE FROM menus')]);
      // 目标库里先放几个“不同 ID、不同顺序”的栏目
      await target.db.prepare("INSERT INTO menus (id, name, \"order\") VALUES (500, 'Dev', 1), (501, 'Tools', 2)").run();
      const rep = await importBackup(target.db, backup, { conflict: 'skip' });
      assert.equal(rep.tables.menus.skipped, 2);               // Dev / Tools 已存在，沿用目标库 ID
      assert.equal(rep.tables.menus.inserted, 7);
      const dev = await target.db.prepare("SELECT id FROM menus WHERE name = 'Dev'").first();
      assert.equal(dev.id, 500);
      const devCards = (await target.call('GET', `/api/cards/${dev.id}`)).data;
      const srcDev = (await src.db.prepare("SELECT id FROM menus WHERE name='Dev'").first()).id;
      const srcDevCards = (await src.call('GET', `/api/cards/${srcDev}`)).data;
      assert.equal(devCards.length, srcDevCards.length);
      assert.deepEqual(devCards.map((c) => c.title).sort(), srcDevCards.map((c) => c.title).sort());
      // 子栏目里的卡片挂到了正确的子栏目
      const proxy = (await target.db.prepare("SELECT s.id FROM sub_menus s JOIN menus m ON m.id = s.parent_id WHERE s.name='Proxy' AND m.name='Software&OS'").first()).id;
      assert.ok((await target.call('GET', `/api/cards/0?subMenuId=${proxy}`)).data.length >= 8);
      assert.equal((await target.db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    });

    it('卡片平铺列表（栏目用名称引用）可直接导入，缺失的栏目自动创建', async () => {
      const a = await fresh(name);
      await a.db.batch([a.db.prepare('DELETE FROM cards'), a.db.prepare('DELETE FROM sub_menus'), a.db.prepare('DELETE FROM menus')]);
      const flat = [
        { title: 'X1', url: 'https://x1.test', logo_url: '', desc: 'a', order: 1, menu: 'Alpha' },
        { title: 'X2', url: 'https://x2.test', logo_url: '', desc: null, order: 2, menu: 'Alpha' },
        { title: 'Y1', url: 'https://y1.test', order: 0, menu: 'Beta' }
      ];
      const rep = await importBackup(a.db, flat, {});
      assert.equal(rep.tables.menus.inserted, 2);
      assert.equal(rep.tables.cards.inserted, 3);
      const alpha = (await a.db.prepare("SELECT id FROM menus WHERE name='Alpha'").first()).id;
      assert.equal((await a.call('GET', `/api/cards/${alpha}`)).data.length, 2);
    });

    it('无效记录被统计并给出样例；预览（dryRun）不写库且数字与真实导入一致', async () => {
      const a = await fresh(name);
      const payload = { tables: {
        menus: [{ id: 1, name: 'M1', order: 1 }, { id: 2, name: '', order: 2 }],
        cards: [
          { id: 1, menu_id: 1, title: 'ok', url: 'https://ok.test' },
          { id: 2, menu_id: 1, title: '', url: 'https://bad.test' },
          { id: 3, menu_id: 99, title: 'orphan', url: 'https://orphan.test' }
        ],
        friends: [{ title: 'f', url: 'https://f.test' }, { title: 'dup', url: 'https://f.test/' }]
      } };
      const before = { menus: await count(a.db, 'menus'), cards: await count(a.db, 'cards') };
      const dry = await importBackup(a.db, payload, { dryRun: true });
      assert.equal(await count(a.db, 'menus'), before.menus);
      assert.equal(await count(a.db, 'cards'), before.cards);
      const real = await importBackup(a.db, payload, {});
      assert.deepEqual(dry.tables, real.tables);
      assert.equal(real.tables.menus.invalid, 1);
      assert.equal(real.tables.cards.inserted, 1);
      assert.equal(real.tables.cards.invalid, 2);
      assert.ok(real.samples.invalid.length >= 2);
      assert.equal(real.tables.friends.inserted, 1);     // 网址仅末尾斜杠不同 → 视为同一条
      assert.equal(real.tables.friends.skipped, 1);
    });

    it('账号：默认不导入；显式选择时按用户名去重；替换账号表必须带有效账号', async () => {
      const a = await fresh(name); const b = await fresh(name);
      await b.db.prepare("INSERT INTO users (username, password) VALUES ('bob', 'pbkdf2$1$x$y')").run();
      const backup = await exportBackup(b.db, { includeUsers: true });
      const rep0 = await importBackup(a.db, backup, {});
      assert.equal(rep0.tables.users, undefined);
      assert.equal(await count(a.db, 'users'), 1);
      const rep1 = await importBackup(a.db, backup, { tables: ['users'] });
      assert.equal(rep1.tables.users.inserted, 1);       // bob 新增
      assert.equal(rep1.tables.users.skipped, 1);        // amos 已存在
      await assert.rejects(importBackup(a.db, { tables: { users: [{ username: '', password: '' }] } }, { tables: ['users'], mode: 'replace' }));
    });

    it('SQL 导出可在全新 SQLite 里直接执行，且可重复执行（UPSERT）', async () => {
      const a = await fresh(name);
      const sql = await exportSql(a.db, { includeUsers: false });
      const lite = new DatabaseSync(':memory:');
      lite.exec(sql); lite.exec(sql);
      assert.equal(lite.prepare('SELECT COUNT(*) AS c FROM cards').get().c, 187);
      assert.equal(lite.prepare('SELECT COUNT(*) AS c FROM menus').get().c, 9);
      const orig = (await a.db.prepare("SELECT title, url, desc FROM cards WHERE title LIKE 'Mihomo%' ORDER BY id").all()).results;
      const got = lite.prepare("SELECT title, url, desc FROM cards WHERE title LIKE 'Mihomo%' ORDER BY id").all().map((r) => ({ ...r }));
      assert.deepEqual(got, orig);
    });

    it('SQL 导出能正确转义单引号与换行', async () => {
      const a = await fresh(name);
      await a.db.prepare("INSERT INTO cards (menu_id, title, url, desc) VALUES (1, ?, ?, ?)").bind("It's \"quoted\"", 'https://q.test', "line1\nline2 'x'").run();
      const lite = new DatabaseSync(':memory:'); lite.exec(await exportSql(a.db, {}));
      const r = lite.prepare("SELECT title, desc FROM cards WHERE url = 'https://q.test'").get();
      assert.equal(r.title, "It's \"quoted\""); assert.equal(r.desc, "line1\nline2 'x'");
    });

    it('替换模式：栏目被替换时其下卡片一并被替换（外键级联），并保持整体事务', async () => {
      const a = await fresh(name);
      const rep = await importBackup(a.db, { tables: { menus: [{ id: 1, name: 'Only', order: 1 }], cards: [{ menu_id: 1, title: 'c', url: 'https://c.test' }] } }, { mode: 'replace', tables: ['menus'] });
      assert.equal(await count(a.db, 'menus'), 1);
      assert.equal(await count(a.db, 'cards'), 1);
      assert.equal(await count(a.db, 'sub_menus'), 0);
      assert.ok(rep.warnings.some((w) => w.includes('替换')));
    });

    it('batch 是事务：中途失败会整体回滚', async () => {
      const a = await fresh(name);
      const before = await count(a.db, 'friends');
      await assert.rejects(a.db.batch([
        a.db.prepare("INSERT INTO friends (title, url) VALUES ('t1', 'u1')"),
        a.db.prepare('INSERT INTO no_such_table VALUES (1)')
      ]));
      assert.equal(await count(a.db, 'friends'), before);
    });
  });

  describe(`数据库管理接口 [${name}]`, () => {
    it('状态：引擎、体积、各表行数、完整性与外键检查', async () => {
      const a = await fresh(name);
      const s = (await a.call('GET', '/api/db/status')).data;
      assert.equal(s.engine, name === 'node-sqlite' ? 'node-sqlite' : 'cloudflare-d1');
      assert.equal(s.health.quickCheck, 'ok');
      assert.equal(s.health.foreignKeyViolations, 0);
      assert.ok(s.sizeBytes > 0); assert.ok(s.latencyMs >= 0); assert.match(s.sqliteVersion, /^3\./);
      assert.equal(s.tables.find((t) => t.name === 'cards').rows, 187);
      assert.equal(s.totals.tables >= 8, true);
      assert.equal((await a.call('GET', '/api/db/status', { token: null })).status, 401);
    });

    it('导出接口：下载头、JSON/SQL 两种格式、需要登录', async () => {
      const a = await fresh(name);
      const res = await a.call('GET', '/api/db/export?tables=menus,cards&format=json', { raw: true });
      assert.match(res.headers.get('content-disposition'), /attachment; filename="nav-backup-\d{14}\.json"/);
      const body = JSON.parse(await res.text());
      assert.deepEqual(Object.keys(body.tables), ['menus', 'cards']);
      const sql = await a.call('GET', '/api/db/export?format=sql', { raw: true });
      assert.match(sql.headers.get('content-type'), /sql/);
      assert.match(await sql.text(), /INSERT INTO "cards"/);
      assert.equal((await a.call('GET', '/api/db/export', { token: null })).status, 401);
      assert.ok((await a.call('GET', '/api/db/status')).data.lastExport);
    });

    it('导入接口：inspect / 预览 / 执行 / 非法内容给出 400', async () => {
      const a = await fresh(name); const b = await fresh(name);
      const backup = await exportBackup(a.db, {});
      const insp = await b.call('POST', '/api/db/inspect', { body: { backup } });
      assert.equal(insp.data.counts.cards, 187);
      const pre = await b.call('POST', '/api/db/import', { body: { backup, options: { dryRun: true, conflict: 'skip' } } });
      assert.equal(pre.data.dryRun, true); assert.equal(pre.data.totals.inserted, 0);
      const run = await b.call('POST', '/api/db/import', { body: { backup, options: { conflict: 'overwrite' } } });
      assert.equal(run.status, 200);
      assert.ok((await b.call('GET', '/api/db/status')).data.lastImport);
      assert.equal((await b.call('POST', '/api/db/import', { body: { backup: 'nonsense' } })).status, 400);
      assert.equal((await b.call('POST', '/api/db/import', { body: { backup: { tables: { cards: [] } } } })).status, 400);
    });

    it('表浏览：分页、搜索、敏感列不外泄', async () => {
      const a = await fresh(name);
      const p = (await a.call('GET', '/api/db/tables/cards?page=2&pageSize=10')).data;
      assert.equal(p.rows.length, 10); assert.equal(p.total, 187); assert.equal(p.page, 2);
      const s = (await a.call('GET', '/api/db/tables/cards?q=' + encodeURIComponent('Gitee'))).data;
      assert.ok(s.total === 0 || s.rows.every((r) => JSON.stringify(r).toLowerCase().includes('gitee')));
      const gh = (await a.call('GET', '/api/db/tables/cards?q=GitHub')).data;
      assert.ok(gh.total >= 1);
      const users = (await a.call('GET', '/api/db/tables/users')).data;
      assert.ok(!users.columns.includes('password')); assert.ok(!('password' in users.rows[0]));
      assert.equal((await a.call('GET', '/api/db/tables/settings')).status, 404);
      assert.equal((await a.call('GET', '/api/db/tables/nope')).status, 404);
      assert.equal((await a.call('GET', '/api/db/tables/cards?q=' + 'x'.repeat(50))).status, 400);
      assert.equal((await a.call('GET', '/api/db/tables/cards?q=' + encodeURIComponent("100%_'"))).status, 200);
    });

    it('SQL 控制台：只读 SELECT，限制行数，拒绝写入 / 多语句 / 读取 settings', async () => {
      const a = await fresh(name);
      const ok = await a.call('POST', '/api/db/query', { body: { sql: 'SELECT name, "order" FROM menus ORDER BY "order" LIMIT 3;' } });
      assert.equal(ok.data.rows.length, 3); assert.deepEqual(ok.data.columns, ['name', 'order']);
      const big = await a.call('POST', '/api/db/query', { body: { sql: 'SELECT a.id FROM cards a, cards b' } });
      assert.equal(big.data.rows.length, 200); assert.equal(big.data.truncated, true);
      for (const sql of ['DELETE FROM cards', 'DROP TABLE cards', 'SELECT 1; DELETE FROM cards', 'SELECT * FROM settings', 'PRAGMA table_info(cards)', '']) {
        assert.equal((await a.call('POST', '/api/db/query', { body: { sql } })).status, 400, sql);
      }
      assert.equal(await count(a.db, 'cards'), 187);
      assert.equal((await a.call('POST', '/api/db/query', { body: { sql: 'SELECT nope FROM cards' } })).status, 400);
    });

    it('维护：PRAGMA optimize 可执行', async () => {
      const a = await fresh(name);
      assert.equal((await a.call('POST', '/api/db/maintenance', { body: { action: 'optimize' } })).data.ok, true);
      assert.equal((await a.call('POST', '/api/db/maintenance', { body: { action: 'drop' } })).status, 400);
    });
  });
}

describe('D1 配额适配（以“每条语句都计一次查询”的保守口径）', () => {
  it('合并导入完整备份：查询数低于免费版 50 次/请求的上限，且写入只用一个 batch', async () => {
    const a = makeApp(ADAPTERS['d1-shim']()); await a.login();
    const b = makeApp(ADAPTERS['d1-shim']()); await b.login();
    await a.call('POST', '/api/cards', { body: { menu_id: 1, title: '新', url: 'https://n.test' } });
    const backup = await exportBackup(a.db, {});
    b.db.queries = 0; b.db.batches = 0;
    const res = await b.call('POST', '/api/db/import', { body: { backup, options: { conflict: 'overwrite' } } });
    assert.equal(res.status, 200);
    console.log(`    [D1 模拟] 合并导入：共 ${b.db.queries} 条语句，${b.db.batches} 次 batch`);
    assert.ok(b.db.queries < 50, `语句数 ${b.db.queries} 过多`);
    assert.equal(b.db.batches, 1);
  });

  it('菜单列表接口只用 2 条查询（原项目每个菜单多查 1 次）', async () => {
    const a = makeApp(ADAPTERS['d1-shim']()); await a.login();
    a.db.queries = 0;
    await a.call('GET', '/api/menus');
    assert.equal(a.db.queries, 2);
  });
});

describe('工具函数', () => {
  it('urlKey：忽略末尾斜杠与主机大小写', () => {
    assert.equal(urlKey('https://GitHub.com/'), urlKey('https://github.com'));
    assert.equal(urlKey(' https://a.test/x/ '), 'https://a.test/x');
    assert.notEqual(urlKey('https://a.test/x?y=1'), urlKey('https://a.test/x'));
  });
  it('normalizePayload：拒绝空内容与无法识别的内容', () => {
    assert.throws(() => normalizePayload('x'));
    assert.throws(() => normalizePayload({ tables: { cards: [] } }));
    assert.equal(normalizePayload([{ title: 't', url: 'u' }]).flat, true);
  });
});
