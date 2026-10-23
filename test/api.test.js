// 核心 REST 接口测试：同一套用例分别跑在 node:sqlite 适配器与 D1 行为模拟器上
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS, makeApp } from './helpers/harness.js';
import { signJwt, verifyJwt, hashPassword, verifyPassword } from '../src/core/auth.js';

for (const [name, mk] of Object.entries(ADAPTERS)) {
  describe(`API 行为一致性 [${name}]`, () => {
    let app;
    before(async () => { app = makeApp(mk()); await app.login(); });

    it('首次请求自动建表并写入默认数据', async () => {
      const menus = await app.call('GET', '/api/menus');
      assert.equal(menus.status, 200);
      assert.equal(menus.data.length, 9);
      assert.equal(menus.data.find((m) => m.name === 'Software&OS').subMenus.length, 2);
      const total = (await app.db.prepare('SELECT COUNT(*) AS c FROM cards').first()).c;
      assert.equal(total, 187);
      assert.equal((await app.call('GET', '/api/friends')).data.length, 5);
    });

    it('原项目写错的栏目名已修正：Mail&Domain 下有 6 张主栏目卡片', async () => {
      const mail = (await app.call('GET', '/api/menus')).data.find((m) => m.name === 'Mail&Domain');
      const cards = await app.call('GET', `/api/cards/${mail.id}`);
      assert.equal(cards.data.length, 6);
    });

    it('卡片接口：主栏目与子栏目隔离，并带 display_logo', async () => {
      const menus = (await app.call('GET', '/api/menus')).data;
      const sw = menus.find((m) => m.name === 'Software&OS');
      const proxy = sw.subMenus.find((s) => s.name === 'Proxy');
      const sub = await app.call('GET', `/api/cards/${sw.id}?subMenuId=${proxy.id}`);
      assert.ok(sub.data.length >= 8);
      assert.ok(sub.data.every((c) => c.sub_menu_id === proxy.id && 'display_logo' in c));
      const main = await app.call('GET', `/api/cards/${sw.id}`);
      assert.ok(main.data.every((c) => c.sub_menu_id === null));
    });

    it('种子数据里被截断的 base64 logo 已清空', async () => {
      const bad = await app.db.prepare("SELECT COUNT(*) AS c FROM cards WHERE logo_url LIKE 'data:%'").first();
      assert.equal(bad.c, 0);
    });

    it('重复初始化不会重复写入默认数据', async () => {
      const again = makeApp(app.db);               // 重置惰性初始化缓存后对同一个库再次初始化
      await again.call('GET', '/api/menus');
      assert.equal((await again.call('GET', '/api/menus')).data.length, 9);
      assert.equal((await app.db.prepare('SELECT COUNT(*) AS c FROM users').first()).c, 1);
    });

    it('登录：成功返回 token；错误密码/不存在的用户 401；未授权写操作 401', async () => {
      const ok = await app.call('POST', '/api/login', { body: { username: 'amos', password: 'sweet' }, token: null });
      assert.equal(ok.status, 200);
      assert.ok(ok.data.token.split('.').length === 3);
      assert.ok('lastLoginTime' in ok.data && 'lastLoginIp' in ok.data);
      assert.equal((await app.call('POST', '/api/login', { body: { username: 'amos', password: 'x' }, token: null })).status, 401);
      assert.equal((await app.call('POST', '/api/login', { body: { username: 'nobody', password: 'x' }, token: null })).status, 401);
      assert.equal((await app.call('POST', '/api/menus', { body: { name: 'x' }, token: null })).status, 401);
      assert.equal((await app.call('POST', '/api/menus', { body: { name: 'x' }, token: 'bad.token.here' })).status, 401);
    });

    it('第二次登录能拿到上次登录时间', async () => {
      const r = await app.call('POST', '/api/login', { body: { username: 'amos', password: 'sweet' }, token: null });
      assert.match(r.data.lastLoginTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('菜单 / 子菜单 CRUD 与分页结构', async () => {
      const add = await app.call('POST', '/api/menus', { body: { name: '测试栏目', order: 99 } });
      assert.equal(add.status, 200); const id = add.data.id; assert.ok(id > 9);
      assert.equal((await app.call('PUT', `/api/menus/${id}`, { body: { name: '测试栏目2', order: 98 } })).data.changed, 1);
      const sub = await app.call('POST', `/api/menus/${id}/submenus`, { body: { name: '子', order: 1 } });
      assert.ok(sub.data.id);
      assert.equal((await app.call('GET', `/api/menus/${id}/submenus`)).data.length, 1);
      assert.equal((await app.call('PUT', `/api/menus/submenus/${sub.data.id}`, { body: { name: '子2', order: 2 } })).data.changed, 1);
      const page = await app.call('GET', '/api/menus?page=1&pageSize=3');
      assert.equal(page.data.data.length, 3); assert.equal(page.data.pageSize, 3); assert.ok(page.data.total >= 10);
      assert.equal((await app.call('DELETE', `/api/menus/submenus/${sub.data.id}`)).data.deleted, 1);
      assert.equal((await app.call('DELETE', `/api/menus/${id}`)).data.deleted, 1);
    });

    it('卡片 CRUD；修改时保留已有的 custom_logo_path；删除栏目级联删除其卡片', async () => {
      const m = await app.call('POST', '/api/menus', { body: { name: '级联测试', order: 50 } });
      const mid = m.data.id;
      const c = await app.call('POST', '/api/cards', { body: { menu_id: mid, title: 'A', url: 'https://a.test', logo_url: '', desc: 'd', order: 1, custom_logo_path: 'x.png' } });
      const cid = c.data.id;
      assert.equal((await app.call('PUT', `/api/cards/${cid}`, { body: { menu_id: mid, title: 'A2', url: 'https://a.test', logo_url: '', desc: 'd2', order: 2 } })).data.changed, 1);
      const list = (await app.call('GET', `/api/cards/${mid}`)).data;
      assert.equal(list[0].title, 'A2'); assert.equal(list[0].custom_logo_path, 'x.png');
      assert.equal(list[0].display_logo, '/uploads/x.png');
      await app.call('DELETE', `/api/menus/${mid}`);
      assert.equal((await app.db.prepare('SELECT COUNT(*) AS c FROM cards WHERE id = ?').bind(cid).first()).c, 0);
    });

    it('广告 / 友链 CRUD', async () => {
      const ad = await app.call('POST', '/api/ads', { body: { position: 'left', img: 'https://i.test/a.png', url: 'https://x.test' } });
      assert.ok(ad.data.id);
      assert.equal((await app.call('PUT', `/api/ads/${ad.data.id}`, { body: { img: 'https://i.test/b.png', url: 'https://y.test' } })).data.changed, 1);
      assert.equal((await app.call('GET', '/api/ads?page=1&pageSize=5')).data.total, 1);
      assert.equal((await app.call('DELETE', `/api/ads/${ad.data.id}`)).data.deleted, 1);
      const f = await app.call('POST', '/api/friends', { body: { title: '友', url: 'https://f.test', logo: '' } });
      assert.equal((await app.call('PUT', `/api/friends/${f.data.id}`, { body: { title: '友2', url: 'https://f.test', logo: 'l' } })).data.changed, 1);
      assert.equal((await app.call('DELETE', `/api/friends/${f.data.id}`)).data.deleted, 1);
    });

    it('用户接口：profile / me / 修改密码（旧密码校验、长度校验）', async () => {
      assert.equal((await app.call('GET', '/api/users/profile')).data.data.username, 'amos');
      assert.ok('last_login_time' in (await app.call('GET', '/api/users/me')).data);
      assert.equal((await app.call('GET', '/api/users')).data.data.length, 1);
      assert.equal((await app.call('PUT', '/api/users/password', { body: { oldPassword: 'sweet' } })).status, 400);
      assert.equal((await app.call('PUT', '/api/users/password', { body: { oldPassword: 'sweet', newPassword: '123' } })).data.message, '新密码长度至少6位');
      assert.equal((await app.call('PUT', '/api/users/password', { body: { oldPassword: 'wrong', newPassword: '123456' } })).data.message, '旧密码错误');
      assert.equal((await app.call('PUT', '/api/users/password', { body: { oldPassword: 'sweet', newPassword: 'newpass1' } })).data.message, '密码修改成功');
      assert.equal((await app.login('amos', 'sweet')).status, 401);
      assert.equal((await app.login('amos', 'newpass1')).status, 200);
      await app.call('PUT', '/api/users/password', { body: { oldPassword: 'newpass1', newPassword: 'sweet' } });
      await app.login('amos', 'sweet');
    });

    it('上传图片：需登录、限制类型与大小，存入数据库并可通过 /uploads/ 访问', async () => {
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      const mk = (name, bytes) => { const f = new FormData(); f.append('logo', new File([bytes], name, { type: 'image/png' })); return f; };
      assert.equal((await app.call('POST', '/api/upload', { form: mk('a.png', png), token: null })).status, 401);
      assert.equal((await app.call('POST', '/api/upload', { form: mk('a.exe', png) })).status, 400);
      assert.equal((await app.call('POST', '/api/upload', { form: mk('big.png', new Uint8Array(1024 * 1024 + 1)) })).status, 413);
      const up = await app.call('POST', '/api/upload', { form: mk('a.png', png) });
      assert.equal(up.status, 200); assert.match(up.data.url, /^\/uploads\/\d+.*\.png$/);
      const res = await app.call('GET', up.data.url, { raw: true });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.match(res.headers.get('content-security-policy'), /sandbox/);
      assert.deepEqual(new Uint8Array(await res.arrayBuffer()), png);
      assert.equal((await app.call('GET', '/uploads/none.png')).status, 404);
    });

    it('设置：默认主题读写（需登录，未知主题被拒绝）', async () => {
      assert.equal((await app.call('GET', '/api/settings', { token: null })).data.defaultTheme, 'default');
      assert.equal((await app.call('PUT', '/api/settings', { body: { defaultTheme: 'ocean' }, token: null })).status, 401);
      assert.equal((await app.call('PUT', '/api/settings', { body: { defaultTheme: 'nope' } })).status, 400);
      assert.equal((await app.call('PUT', '/api/settings', { body: { defaultTheme: 'ocean' } })).data.defaultTheme, 'ocean');
      assert.equal((await app.call('GET', '/api/settings', { token: null })).data.defaultTheme, 'ocean');
    });

    it('CORS 预检、未知路径 404（JSON）', async () => {
      const pre = await app.call('OPTIONS', '/api/menus', { raw: true });
      assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), '*');
      const nf = await app.call('GET', '/api/nope');
      assert.equal(nf.status, 404); assert.equal(nf.data.error, 'Not Found');
    });
  });
}

describe('认证原语', () => {
  it('JWT：签名校验、篡改、过期、alg 伪造', async () => {
    const t = await signJwt({ id: 1 }, 'secret', 60);
    assert.equal((await verifyJwt(t, 'secret')).id, 1);
    await assert.rejects(verifyJwt(t, 'other'));
    const [h, p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ id: 999, exp: 9999999999 })).toString('base64url');
    await assert.rejects(verifyJwt(`${h}.${forged}.${s}`, 'secret'));
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    await assert.rejects(verifyJwt(`${none}.${p}.`, 'secret'));
    await assert.rejects(verifyJwt(await signJwt({ id: 1 }, 'secret', -10), 'secret'));
  });

  it('密码：PBKDF2 哈希可校验；错误密码/损坏的哈希不通过', async () => {
    const h = await hashPassword('p@ss');
    assert.match(h, /^pbkdf2\$100000\$/);
    assert.deepEqual(await verifyPassword('p@ss', h), { ok: true, upgrade: false });
    assert.equal((await verifyPassword('nope', h)).ok, false);
    assert.equal((await verifyPassword('p@ss', 'pbkdf2$bad')).ok, false);
    assert.equal((await verifyPassword('p@ss', 'plain')).ok, false);
  });
});
