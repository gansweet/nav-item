// 远程连接：Supabase / PostgREST 读写、云端下载导入、SSRF 防护
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, makeApp } from './helpers/harness.js';
import { startMockSupabase, startFileServer } from './helpers/mock-postgrest.js';
import { normalizeRestBase, toDirectUrl, supabaseSchemaSql } from '../src/core/remote.js';
import { assertPublicUrl } from '../src/core/netguard.js';
import { exportBackup } from '../src/core/transfer.js';

describe('连接地址与工具函数', () => {
  it('Supabase 地址兼容多种写法', () => {
    const want = 'https://abcdefghijklmnopqrst.supabase.co/rest/v1';
    assert.equal(normalizeRestBase('abcdefghijklmnopqrst'), want);
    assert.equal(normalizeRestBase('https://abcdefghijklmnopqrst.supabase.co'), want);
    assert.equal(normalizeRestBase('https://abcdefghijklmnopqrst.supabase.co/'), want);
    assert.equal(normalizeRestBase('abcdefghijklmnopqrst.supabase.co/rest/v1/'), want);
    assert.equal(normalizeRestBase('http://db.mylan:8000/rest/v1'), 'http://db.mylan:8000/rest/v1');
    assert.throws(() => normalizeRestBase('  '));
  });
  it('GitHub 页面链接自动转 raw 直链', () => {
    assert.equal(toDirectUrl('https://github.com/me/repo/blob/main/backup/nav.json'), 'https://raw.githubusercontent.com/me/repo/main/backup/nav.json');
    assert.equal(toDirectUrl('https://example.com/a.json'), 'https://example.com/a.json');
  });
  it('建表脚本：引号转义保留字列、默认开启 RLS、支持自定义 schema/前缀', () => {
    const sql = supabaseSchemaSql({});
    assert.match(sql, /create table if not exists public\.nav_cards/);
    assert.match(sql, /"desc" text/); assert.match(sql, /"order" integer/);
    assert.match(sql, /alter table public\.nav_menus enable row level security/);
    assert.match(supabaseSchemaSql({ schema: 'app', prefix: 'x_' }), /app\.x_friends/);
  });
});

describe('SSRF 防护', () => {
  it('默认拒绝内网 / 本机 / 元数据地址与非 http 协议', () => {
    for (const u of ['http://localhost/a', 'http://127.0.0.1/a', 'http://10.1.2.3/', 'http://192.168.1.5/', 'http://172.20.0.1/', 'http://169.254.169.254/latest/meta-data',
      'http://[::1]/', 'http://2130706433/', 'http://foo.internal/', 'http://printer.local/', 'file:///etc/passwd', 'ftp://x.test/']) {
      assert.throws(() => assertPublicUrl(u, {}), (e) => e.status === 400, u);
    }
    for (const u of ['https://abc.supabase.co/rest/v1', 'https://raw.githubusercontent.com/a/b/main/x.json', 'http://8.8.8.8/']) assert.doesNotThrow(() => assertPublicUrl(u, {}), u);
    assert.doesNotThrow(() => assertPublicUrl('http://192.168.1.5/', { ALLOW_PRIVATE_NETWORK: 'true' }));
  });
});

for (const name of Object.keys(ADAPTERS)) {
  describe(`Supabase / PostgREST 连接 [${name}]`, () => {
    let mock; let app;
    before(async () => { mock = await startMockSupabase({ key: 'sb_secret_TESTKEY', maxRows: 50 }); app = makeApp(ADAPTERS[name]()); await app.login(); });
    after(async () => { await mock.close(); });
    const conn = () => ({ url: mock.url, key: 'sb_secret_TESTKEY', prefix: 'nav_', schema: 'public' });

    it('测试连接：逐表报告存在性与行数；新版密钥不放进 Authorization 头', async () => {
      const r = await app.call('POST', '/api/db/remote/supabase/test', { body: { connection: conn() } });
      assert.equal(r.status, 200); assert.equal(r.data.ok, true);
      assert.deepEqual(r.data.tables.map((t) => t.name), ['nav_menus', 'nav_sub_menus', 'nav_cards', 'nav_ads', 'nav_friends']);
      assert.ok(r.data.tables.every((t) => t.exists && t.rows === 0));
      assert.ok(mock.log.every((l) => l.headers.apikey === 'sb_secret_TESTKEY' && !l.headers.authorization));
    });

    it('旧版 JWT 密钥同时带 apikey 与 Authorization', async () => {
      const m2 = await startMockSupabase({ key: 'eyJhbGciOi.legacy.jwt' });
      try {
        const r = await app.call('POST', '/api/db/remote/supabase/test', { body: { connection: { url: m2.url, key: 'eyJhbGciOi.legacy.jwt' } } });
        assert.equal(r.data.ok, true);
        assert.equal(m2.log[0].headers.authorization, 'Bearer eyJhbGciOi.legacy.jwt');
      } finally { await m2.close(); }
    });

    it('错误映射：密钥错误、表不存在、RLS 拦截、连接不上都给出可读提示', async () => {
      const bad = await app.call('POST', '/api/db/remote/supabase/test', { body: { connection: { ...conn(), key: 'wrong' } } });
      assert.equal(bad.status, 400); assert.match(bad.data.error, /API Key 无效/);
      const m2 = await startMockSupabase({ key: 'sb_secret_TESTKEY', tables: ['nav_menus'] });
      const partial = await app.call('POST', '/api/db/remote/supabase/test', { body: { connection: { ...conn(), url: m2.url } } });
      assert.equal(partial.data.ok, false);
      assert.equal(partial.data.tables.find((t) => t.name === 'nav_menus').exists, true);
      assert.match(partial.data.tables.find((t) => t.name === 'nav_cards').error, /建表脚本/);
      await m2.close();
      const m3 = await startMockSupabase({ key: 'sb_secret_TESTKEY', rls: true });
      const rls = await app.call('POST', '/api/db/remote/supabase/test', { body: { connection: { ...conn(), url: m3.url } } });
      assert.equal(rls.status, 400); assert.match(rls.data.error, /RLS/);
      await m3.close();
      const down = await app.call('POST', '/api/db/remote/supabase/test', { body: { connection: { url: 'http://127.0.0.1:1', key: 'k' } } });
      assert.equal(down.status, 502); assert.match(down.data.error, /无法连接/);
      assert.equal((await app.call('POST', '/api/db/remote/supabase/test', { body: { connection: { url: '', key: '' } } })).status, 400);
    });

    it('推送（合并）：本地数据写入远程，重复推送是幂等的', async () => {
      const r = await app.call('POST', '/api/db/remote/supabase/push', { body: { connection: conn() } });
      assert.equal(r.status, 200); assert.equal(r.data.pushed.cards, 187); assert.equal(r.data.pushed.menus, 9);
      assert.equal(mock.data.nav_cards.length, 187);
      await app.call('POST', '/api/db/remote/supabase/push', { body: { connection: conn() } });
      assert.equal(mock.data.nav_cards.length, 187);
      const row = mock.data.nav_cards.find((c) => c.title === 'GitHub');
      assert.deepEqual(Object.keys(row), ['id', 'menu_id', 'sub_menu_id', 'title', 'url', 'logo_url', 'custom_logo_path', 'desc', 'order']);
    });

    it('推送（镜像）：先清空远程再写入，使远程成为本地的精确副本', async () => {
      mock.data.nav_friends.push({ id: 999, title: '远程多出来的', url: 'https://stale.test', logo: '' });
      await app.call('POST', '/api/db/remote/supabase/push', { body: { connection: conn(), mirror: true } });
      assert.equal(mock.data.nav_friends.length, 5);
      assert.ok(!mock.data.nav_friends.some((f) => f.id === 999));
    });

    it('拉取：分页读取（服务端限制每页 50 行）并导入到另一个库，预览与执行结果一致', async () => {
      const other = makeApp(ADAPTERS[name](), { ADMIN_PASSWORD: 'x' }); await other.login();
      await other.db.batch([other.db.prepare('DELETE FROM cards'), other.db.prepare('DELETE FROM sub_menus'), other.db.prepare('DELETE FROM menus'), other.db.prepare('DELETE FROM friends')]);
      mock.log.length = 0;
      const dry = await other.call('POST', '/api/db/remote/supabase/pull', { body: { connection: conn(), options: { dryRun: true } } });
      assert.equal(dry.status, 200); assert.equal(dry.data.tables.cards.inserted, 187);
      assert.ok(mock.log.filter((l) => l.path.endsWith('nav_cards')).length >= 4);   // 187 行 / 每页 50 行
      assert.equal((await other.db.prepare('SELECT COUNT(*) AS c FROM cards').first()).c, 0);
      const real = await other.call('POST', '/api/db/remote/supabase/pull', { body: { connection: conn(), options: { conflict: 'skip' } } });
      assert.deepEqual(real.data.tables, dry.data.tables);
      assert.equal((await other.db.prepare('SELECT COUNT(*) AS c FROM cards').first()).c, 187);
      assert.equal((await other.db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
      // 再拉一次：全部跳过
      const again = await other.call('POST', '/api/db/remote/supabase/pull', { body: { connection: conn(), options: { conflict: 'skip' } } });
      assert.equal(again.data.totals.inserted, 0);
      assert.equal(again.data.tables.cards.skipped, 187);
    });

    it('自定义 schema 与表前缀', async () => {
      const m2 = await startMockSupabase({ key: 'sb_secret_TESTKEY', schema: 'navapp', tables: ['x_menus', 'x_sub_menus', 'x_cards', 'x_ads', 'x_friends'] });
      try {
        const c = { url: m2.url, key: 'sb_secret_TESTKEY', schema: 'navapp', prefix: 'x_' };
        assert.equal((await app.call('POST', '/api/db/remote/supabase/test', { body: { connection: c } })).data.ok, true);
        await app.call('POST', '/api/db/remote/supabase/push', { body: { connection: c, tables: ['friends'] } });
        assert.equal(m2.data.x_friends.length, 5);
      } finally { await m2.close(); }
    });

    it('连接信息保存：密钥不回显（只显示末 4 位），留空保留旧密钥；保存后可直接使用', async () => {
      const saved = await app.call('PUT', '/api/db/connections', { body: { supabase: conn() } });
      assert.equal(saved.data.supabase.hasKey, true); assert.equal(saved.data.supabase.keyMasked, '••••••••TKEY');
      assert.ok(!JSON.stringify(saved.data).includes('sb_secret_TESTKEY'));
      const again = await app.call('PUT', '/api/db/connections', { body: { supabase: { url: mock.url, key: '' } } });
      assert.equal(again.data.supabase.keyMasked, '••••••••TKEY');
      const t = await app.call('POST', '/api/db/remote/supabase/test', { body: {} });     // 不带任何参数，使用已保存的连接
      assert.equal(t.data.ok, true);
      assert.equal((await app.call('GET', '/api/db/connections', { token: null })).status, 401);
      assert.ok((await app.call('GET', '/api/db/remote/supabase/schema')).data.sql.includes('create table'));
    });

    it('拉取空的远程表时给出明确提示', async () => {
      const m2 = await startMockSupabase({ key: 'sb_secret_TESTKEY' });
      try {
        const r = await app.call('POST', '/api/db/remote/supabase/pull', { body: { connection: { url: m2.url, key: 'sb_secret_TESTKEY' } } });
        assert.equal(r.status, 400); assert.match(r.data.error, /没有数据/);
      } finally { await m2.close(); }
    });

    it('默认配置下拒绝连接内网地址', async () => {
      const strict = makeApp(ADAPTERS[name](), { ALLOW_PRIVATE_NETWORK: '' }); await strict.login();
      const r = await strict.call('POST', '/api/db/remote/supabase/test', { body: { connection: conn() } });
      assert.equal(r.status, 400); assert.match(r.data.error, /内网/);
    });
  });

  describe(`云端下载导入 [${name}]`, () => {
    let files; let backupText; let app;
    before(async () => {
      const src = makeApp(ADAPTERS[name]()); await src.login();
      await src.call('POST', '/api/cards', { body: { menu_id: 1, title: '云端新卡片', url: 'https://cloud-new.test' } });
      backupText = JSON.stringify(await exportBackup(src.db, {}));
      files = await startFileServer({
        '/backup.json': { body: backupText },
        '/secure.json': (req, res) => { if (req.headers.authorization !== 'Bearer tok') { res.writeHead(401); return res.end('no'); } res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(backupText); },
        '/redirect': { status: 302, headers: { Location: '/backup.json' }, body: '' },
        '/to-internal': { status: 302, headers: { Location: 'http://169.254.169.254/latest' }, body: '' },
        '/page.html': { headers: { 'Content-Type': 'text/html' }, body: '<html>hello</html>' },
        '/huge': (req, res) => { res.writeHead(200, { 'Content-Length': String(60 * 1024 * 1024) }); res.end('x'); },
        '/empty.json': { body: '{"tables":{"cards":[]}}' }
      });
      app = makeApp(ADAPTERS[name]()); await app.login();
    });
    after(async () => { await files.close(); });

    it('下载并导入：新记录追加、已有记录跳过；预览与结果一致；返回下载信息', async () => {
      const pre = await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/backup.json', options: { dryRun: true } } });
      assert.equal(pre.status, 200); assert.equal(pre.data.tables.cards.inserted, 1); assert.equal(pre.data.tables.cards.skipped, 187);
      assert.ok(pre.data.download.bytes > 1000);
      const run = await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/backup.json', options: { conflict: 'skip' } } });
      assert.deepEqual(run.data.tables, pre.data.tables);
      assert.equal((await app.db.prepare("SELECT COUNT(*) AS c FROM cards WHERE title = '云端新卡片'").first()).c, 1);
      assert.equal((await app.call('GET', '/api/db/status')).data.lastImport.source, 'url');
    });

    it('支持授权头；无授权时给出下载失败提示；重定向会被跟随', async () => {
      const no = await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/secure.json', options: { dryRun: true } } });
      assert.equal(no.status, 502); assert.match(no.data.error, /HTTP 401/);
      const yes = await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/secure.json', authorization: 'Bearer tok', options: { dryRun: true } } });
      assert.equal(yes.status, 200);
      assert.equal((await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/redirect', options: { dryRun: true } } })).status, 200);
    });

    it('错误处理：非 JSON、空备份、超大文件、404、重定向到内网都被拦下', async () => {
      assert.match((await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/page.html' } })).data.error, /不是 JSON/);
      assert.equal((await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/empty.json' } })).status, 400);
      assert.equal((await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/huge' } })).status, 413);
      assert.match((await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/missing' } })).data.error, /404/);
      assert.equal((await app.call('POST', '/api/db/import/url', { body: {} })).status, 400);
      const strict = makeApp(ADAPTERS[name](), { ALLOW_PRIVATE_NETWORK: '' }); await strict.login();
      assert.equal((await strict.call('POST', '/api/db/import/url', { body: { url: files.url + '/backup.json' } })).status, 400);
      const hop = makeApp(ADAPTERS[name](), { ALLOW_PRIVATE_NETWORK: 'true' }); await hop.login();
      const internal = await hop.call('POST', '/api/db/import/url', { body: { url: files.url + '/to-internal' } });
      assert.ok(internal.status >= 400);     // 即使允许内网，169.254.x 元数据地址依然不可达（连接失败）
    });

    it('记住下载地址：授权头只保存在服务端，不回显', async () => {
      await app.call('POST', '/api/db/import/url', { body: { url: files.url + '/secure.json', authorization: 'Bearer tok', remember: true, options: { dryRun: true } } });
      const c = (await app.call('GET', '/api/db/connections')).data.download;
      assert.equal(c.url, files.url + '/secure.json'); assert.equal(c.hasAuth, true);
      assert.ok(!JSON.stringify(c).includes('Bearer tok'));
      const reuse = await app.call('POST', '/api/db/import/url', { body: { options: { dryRun: true } } });   // 使用已保存的地址与授权
      assert.equal(reuse.status, 200);
    });
  });
}
