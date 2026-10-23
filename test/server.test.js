// Node 自托管服务器：静态文件托管、SPA 回退、压缩、安全、旧版上传目录兼容
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-srv-'));
const dist = path.join(tmp, 'dist'); const uploads = path.join(tmp, 'uploads');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true }); fs.mkdirSync(uploads);
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>nav</title><div id="app"></div>');
fs.writeFileSync(path.join(dist, 'assets', 'app-1a2b3c.js'), 'console.log("hello");\n'.repeat(500));
fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *');
fs.writeFileSync(path.join(uploads, 'legacy.png'), Buffer.from([137, 80, 78, 71]));
fs.writeFileSync(path.join(tmp, 'secret.txt'), 'TOP SECRET');
process.env.STATIC_DIR = dist; process.env.UPLOADS_DIR = uploads; process.env.MAX_BODY_BYTES = '200000';

const { createServer } = await import('../app.js');
const { openNodeDb } = await import('../src/adapters/node-sqlite.js');
const { _resetSchemaState } = await import('../src/core/schema.js');

describe('Node 服务器', () => {
  let server; let base; let db;
  before(async () => {
    _resetSchemaState(); db = openNodeDb(':memory:');
    server = createServer(db, { ADMIN_USERNAME: 'amos', ADMIN_PASSWORD: 'sweet' });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  const get = (p, headers = {}) => fetch(base + p, { headers });
  // fetch 会规整 URL（如 /../），用原始 http 请求测试路径穿越
  const raw = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject);
  });

  it('首页与前端路由（/admin 等）都返回 index.html（SPA 回退）', async () => {
    for (const p of ['/', '/admin', '/some/deep/route']) {
      const r = await get(p); assert.equal(r.status, 200);
      assert.match(await r.text(), /<div id="app">/);
      assert.equal(r.headers.get('cache-control'), 'no-cache');
    }
  });

  it('静态资源：带哈希的 assets 长期缓存；文本资源在客户端支持时 gzip', async () => {
    const r = await get('/assets/app-1a2b3c.js');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(r.headers.get('content-type'), /javascript/);
    assert.equal(r.headers.get('content-encoding'), 'gzip');                 // fetch 会自动声明 gzip 并解压
    assert.equal((await r.text()).length, 'console.log("hello");\n'.length * 500);
    assert.equal((await get('/robots.txt')).status, 200);
  });

  it('拒绝路径穿越，不会泄露站点目录之外的文件', async () => {
    for (const p of ['/..%2f..%2fsecret.txt', '/%2e%2e/%2e%2e/secret.txt', '/..%5c..%5csecret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const r = await raw(p);
      assert.ok(!r.body.includes('TOP SECRET'), p);
    }
    const up = await raw('/uploads/..%2fsecret.txt');
    assert.ok(!up.body.includes('TOP SECRET'));
  });

  it('API 经 HTTP 可用：登录、鉴权、CRUD', async () => {
    const lr = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'amos', password: 'sweet' }) });
    const { token } = await lr.json(); assert.ok(token);
    assert.equal((await fetch(base + '/api/menus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' })).status, 401);
    const add = await fetch(base + '/api/menus', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'HTTP栏目', order: 5 }) });
    assert.ok((await add.json()).id);
    const status = await (await fetch(base + '/api/db/status', { headers: { authorization: `Bearer ${token}` } })).json();
    assert.equal(status.engine, 'node-sqlite'); assert.equal(status.runtime, 'Node.js');
  });

  it('上传：写入数据库后经 /uploads/ 访问；旧版磁盘 uploads/ 里的老图片继续可用', async () => {
    const lr = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'amos', password: 'sweet' }) });
    const { token } = await lr.json();
    const form = new FormData(); form.append('logo', new File([new Uint8Array([1, 2, 3])], 'z.png', { type: 'image/png' }));
    const up = await (await fetch(base + '/api/upload', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })).json();
    assert.equal((await get(up.url)).status, 200);
    const legacy = await get('/uploads/legacy.png');
    assert.equal(legacy.status, 200); assert.equal(legacy.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual([...new Uint8Array(await legacy.arrayBuffer())], [137, 80, 78, 71]);
    assert.equal((await get('/uploads/none.png')).status, 404);
  });

  it('请求体超过上限返回 413；非 GET 访问静态路径返回 405；HEAD 可用', async () => {
    const big = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'a', password: 'x'.repeat(300000) }) });
    assert.equal(big.status, 413);
    assert.equal((await fetch(base + '/index.html', { method: 'POST', body: 'x' })).status, 405);
    assert.equal((await fetch(base + '/', { method: 'HEAD' })).status, 200);
  });
});
