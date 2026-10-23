import { json, readJson, clientIp, shanghaiTime, parsePaging } from '../http.js';
import { requireAuth, signJwt, verifyPassword, hashPassword } from '../auth.js';

export function registerAuthAndUsers(r) {
  r.post('/api/login', async (ctx) => {
    const { username, password } = await readJson(ctx.request);
    const user = username ? await ctx.db.prepare('SELECT * FROM users WHERE username=?').bind(username).first() : null;
    const fail = () => json({ error: '用户名或密码错误' }, 401);
    if (!user || !password) return fail();

    const { ok, upgrade } = await verifyPassword(String(password), user.password);
    if (!ok) return fail();

    const lastLoginTime = user.last_login_time || null;
    const lastLoginIp = user.last_login_ip || null;
    // 本次登录记录（上海时间）；旧版 bcrypt 哈希顺便升级为 PBKDF2
    if (upgrade) {
      await ctx.db.prepare('UPDATE users SET last_login_time=?, last_login_ip=?, password=? WHERE id=?')
        .bind(shanghaiTime(), clientIp(ctx.request), await hashPassword(String(password)), user.id).run();
    } else {
      await ctx.db.prepare('UPDATE users SET last_login_time=?, last_login_ip=? WHERE id=?')
        .bind(shanghaiTime(), clientIp(ctx.request), user.id).run();
    }
    const token = await signJwt({ id: user.id, username: user.username }, await ctx.jwtSecret(), 2 * 3600);
    return json({ token, lastLoginTime, lastLoginIp });
  });

  r.get('/api/users/profile', requireAuth, async (ctx) => {
    const user = await ctx.db.prepare('SELECT id, username FROM users WHERE id = ?').bind(ctx.user.id).first();
    if (!user) return json({ message: '用户不存在' }, 404);
    return json({ data: user });
  });

  r.get('/api/users/me', requireAuth, async (ctx) => {
    const user = await ctx.db.prepare('SELECT id, username, last_login_time, last_login_ip FROM users WHERE id = ?').bind(ctx.user.id).first();
    if (!user) return json({ message: '用户不存在' }, 404);
    return json({ last_login_time: user.last_login_time, last_login_ip: user.last_login_ip });
  });

  r.put('/api/users/password', requireAuth, async (ctx) => {
    const { oldPassword, newPassword } = await readJson(ctx.request);
    if (!oldPassword || !newPassword) return json({ message: '请提供旧密码和新密码' }, 400);
    if (String(newPassword).length < 6) return json({ message: '新密码长度至少6位' }, 400);
    const user = await ctx.db.prepare('SELECT password FROM users WHERE id = ?').bind(ctx.user.id).first();
    if (!user) return json({ message: '用户不存在' }, 404);
    const { ok } = await verifyPassword(String(oldPassword), user.password);
    if (!ok) return json({ message: '旧密码错误' }, 400);
    await ctx.db.prepare('UPDATE users SET password = ? WHERE id = ?').bind(await hashPassword(String(newPassword)), ctx.user.id).run();
    return json({ message: '密码修改成功' });
  });

  r.get('/api/users', requireAuth, async (ctx) => {
    const paging = parsePaging(ctx.url);
    if (!paging) return json({ data: (await ctx.db.prepare('SELECT id, username FROM users').all()).results });
    const total = (await ctx.db.prepare('SELECT COUNT(*) AS total FROM users').first()).total;
    const { results } = await ctx.db.prepare('SELECT id, username FROM users LIMIT ? OFFSET ?').bind(paging.pageSize, paging.offset).all();
    return json({ total, page: paging.page, pageSize: paging.pageSize, data: results });
  });
}
