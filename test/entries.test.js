// Cloudflare 入口（Workers / Pages Functions）与 Node 服务器的装配测试
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { D1Shim } from './helpers/d1-shim.js';
import { _resetSchemaState } from '../src/core/schema.js';
import worker from '../worker/index.js';
import { onRequest } from '../functions/[[path]].js';
import { exportBackup } from '../src/core/transfer.js';
import { verifyJwt } from '../src/core/auth.js';

const asset = () => ({ fetch: async (req) => new Response('ASSET:' + new URL(req.url).pathname, { status: 200 }) });
const req = (path, init) => new Request('http://nav.test' + path, init);

describe('Workers 入口（worker/index.js）', () => {
  it('/api/* 由后端处理；其余路径（含 /admin 这类前端路由）交给静态资源', async () => {
    _resetSchemaState();
    const env = { DB: new D1Shim(), ASSETS: asset(), ADMIN_PASSWORD: 'cf-pass' };
    const menus = await worker.fetch(req('/api/menus'), env, {});
    assert.equal(menus.status, 200); assert.equal((await menus.json()).length, 9);
    assert.equal(await (await worker.fetch(req('/'), env, {})).text(), 'ASSET:/');
    assert.equal(await (await worker.fetch(req('/admin'), env, {})).text(), 'ASSET:/admin');
    assert.equal(await (await worker.fetch(req('/assets/index-abc.js'), env, {})).text(), 'ASSET:/assets/index-abc.js');
  });

  it('/uploads/ 数据库里没有的文件回退到静态资源', async () => {
    _resetSchemaState();
    const env = { DB: new D1Shim(), ASSETS: asset() };
    assert.equal(await (await worker.fetch(req('/uploads/default-favicon.png'), env, {})).text(), 'ASSET:/uploads/default-favicon.png');
  });

  it('未绑定 D1 时返回明确的中文提示（而不是莫名其妙的 500）', async () => {
    _resetSchemaState();
    const res = await worker.fetch(req('/api/menus'), { ASSETS: asset() }, {});
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /绑定 D1.*DB/);
  });

  it('管理员账号取自 Secrets（ADMIN_PASSWORD），未配置 JWT_SECRET 时自动生成并持久化', async () => {
    _resetSchemaState();
    const DB = new D1Shim();
    const env = { DB, ASSETS: asset(), ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'cf-pass' };
    const login = (u, p) => worker.fetch(req('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) }), env, {});
    assert.equal((await login('amos', 'sweet')).status, 401);             // 默认账号不会被创建
    const ok = await login('boss', 'cf-pass');
    assert.equal(ok.status, 200);
    const { token } = await ok.json();
    const row = await DB.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").first();
    assert.ok(row && row.value.length >= 48);
    assert.equal((await verifyJwt(token, row.value)).username, 'boss');
    // 显式配置 JWT_SECRET 时优先使用
    _resetSchemaState();
    const env2 = { DB: new D1Shim(), ASSETS: asset(), ADMIN_PASSWORD: 'p', JWT_SECRET: 'from-env-secret' };
    const r2 = await worker.fetch(req('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'amos', password: 'p' }) }), env2, {});
    assert.equal((await verifyJwt((await r2.json()).token, 'from-env-secret')).username, 'amos');
  });

  it('并发的首批请求（冷启动竞争）不会重复写入默认数据', async () => {
    _resetSchemaState();
    const DB = new D1Shim();
    const env = { DB, ASSETS: asset(), ADMIN_PASSWORD: 'p' };
    await Promise.all([1, 2, 3, 4].map(() => worker.fetch(req('/api/menus'), env, {})));
    assert.equal((await DB.prepare('SELECT COUNT(*) AS c FROM menus').first()).c, 9);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS c FROM cards').first()).c, 187);
    // 模拟“另一个 isolate 同时冷启动”：缓存被清空后再次初始化同一个库
    _resetSchemaState();
    await worker.fetch(req('/api/menus'), env, {});
    assert.equal((await DB.prepare('SELECT COUNT(*) AS c FROM cards').first()).c, 187);
  });

  it('D1 备份中不含 JWT 密钥；设置表不可被 SQL 控制台读取', async () => {
    _resetSchemaState();
    const DB = new D1Shim();
    const env = { DB, ASSETS: asset(), ADMIN_PASSWORD: 'p' };
    const lr = await worker.fetch(req('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'amos', password: 'p' }) }), env, {});
    const { token } = await lr.json();
    const secret = (await DB.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").first()).value;
    const exp = await exportBackup(DB, { includeUsers: true, includeUploads: true });
    assert.ok(!JSON.stringify(exp).includes(secret));
    const q = await worker.fetch(req('/api/db/query', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ sql: 'SELECT * FROM settings' }) }), env, {});
    assert.equal(q.status, 400);
  });
});

describe('Pages Functions 入口（functions/[[path]].js）', () => {
  const ctx = (path, env, init) => ({ request: req(path, init), env, next: async () => new Response('NEXT') });

  it('/api/* 由 Functions 处理，静态文件走 next()', async () => {
    _resetSchemaState();
    const env = { DB: new D1Shim(), ADMIN_PASSWORD: 'p' };
    assert.equal((await onRequest(ctx('/api/menus', env))).status, 200);
    assert.equal(await (await onRequest(ctx('/admin', env))).text(), 'NEXT');
    assert.equal(await (await onRequest(ctx('/assets/x.js', env))).text(), 'NEXT');
    assert.equal(await (await onRequest(ctx('/uploads/default-favicon.png', env))).text(), 'NEXT');
  });

  it('Pages 未绑定 D1 时同样给出提示', async () => {
    _resetSchemaState();
    const res = await onRequest(ctx('/api/menus', {}));
    assert.equal(res.status, 500); assert.match((await res.json()).error, /DB/);
  });
});
