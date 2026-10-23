// 广告 / 友情链接：结构几乎相同，沿用原项目的接口形状
import { json, nz, parsePaging, readJson } from '../http.js';
import { requireAuth } from '../auth.js';

export function registerAds(r) {
  r.get('/api/ads', async ({ db, url }) => {
    const paging = parsePaging(url);
    if (!paging) return json((await db.prepare('SELECT * FROM ads').all()).results);
    const total = (await db.prepare('SELECT COUNT(*) AS total FROM ads').first()).total;
    const { results } = await db.prepare('SELECT * FROM ads LIMIT ? OFFSET ?').bind(paging.pageSize, paging.offset).all();
    return json({ total, page: paging.page, pageSize: paging.pageSize, data: results });
  });
  r.post('/api/ads', requireAuth, async (ctx) => {
    const { position, img, url } = await readJson(ctx.request);
    const res = await ctx.db.prepare('INSERT INTO ads (position, img, url) VALUES (?, ?, ?)').bind(nz(position), nz(img), nz(url)).run();
    return json({ id: res.meta.last_row_id });
  });
  r.put('/api/ads/:id', requireAuth, async (ctx) => {
    const { img, url } = await readJson(ctx.request);
    const res = await ctx.db.prepare('UPDATE ads SET img=?, url=? WHERE id=?').bind(nz(img), nz(url), ctx.params.id).run();
    return json({ changed: res.meta.changes });
  });
  r.delete('/api/ads/:id', requireAuth, async (ctx) => {
    const res = await ctx.db.prepare('DELETE FROM ads WHERE id=?').bind(ctx.params.id).run();
    return json({ deleted: res.meta.changes });
  });
}

export function registerFriends(r) {
  r.get('/api/friends', async ({ db, url }) => {
    const paging = parsePaging(url);
    if (!paging) return json((await db.prepare('SELECT * FROM friends').all()).results);
    const total = (await db.prepare('SELECT COUNT(*) AS total FROM friends').first()).total;
    const { results } = await db.prepare('SELECT * FROM friends LIMIT ? OFFSET ?').bind(paging.pageSize, paging.offset).all();
    return json({ total, page: paging.page, pageSize: paging.pageSize, data: results });
  });
  r.post('/api/friends', requireAuth, async (ctx) => {
    const { title, url, logo } = await readJson(ctx.request);
    const res = await ctx.db.prepare('INSERT INTO friends (title, url, logo) VALUES (?, ?, ?)').bind(nz(title), nz(url), nz(logo)).run();
    return json({ id: res.meta.last_row_id });
  });
  r.put('/api/friends/:id', requireAuth, async (ctx) => {
    const { title, url, logo } = await readJson(ctx.request);
    const res = await ctx.db.prepare('UPDATE friends SET title=?, url=?, logo=? WHERE id=?').bind(nz(title), nz(url), nz(logo), ctx.params.id).run();
    return json({ changed: res.meta.changes });
  });
  r.delete('/api/friends/:id', requireAuth, async (ctx) => {
    const res = await ctx.db.prepare('DELETE FROM friends WHERE id=?').bind(ctx.params.id).run();
    return json({ deleted: res.meta.changes });
  });
}
