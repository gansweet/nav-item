import { json, nz, toInt, parsePaging, readJson } from '../http.js';
import { requireAuth } from '../auth.js';

export function registerMenus(r) {
  // 获取所有菜单（含子菜单）；带 page/pageSize 时返回分页结构（与原接口一致）
  r.get('/api/menus', async ({ db, url }) => {
    const paging = parsePaging(url);
    if (!paging) {
      const [{ results: menus }, { results: subs }] = await Promise.all([
        db.prepare('SELECT * FROM menus ORDER BY "order"').all(),
        db.prepare('SELECT * FROM sub_menus ORDER BY "order"').all()
      ]);
      const byParent = new Map();
      for (const s of subs) {
        if (!byParent.has(s.parent_id)) byParent.set(s.parent_id, []);
        byParent.get(s.parent_id).push(s);
      }
      return json(menus.map((m) => ({ ...m, subMenus: byParent.get(m.id) || [] })));
    }
    const total = (await db.prepare('SELECT COUNT(*) AS total FROM menus').first()).total;
    const { results } = await db.prepare('SELECT * FROM menus ORDER BY "order" LIMIT ? OFFSET ?').bind(paging.pageSize, paging.offset).all();
    return json({ total, page: paging.page, pageSize: paging.pageSize, data: results });
  });

  r.get('/api/menus/:id/submenus', async ({ db, params }) => {
    const { results } = await db.prepare('SELECT * FROM sub_menus WHERE parent_id = ? ORDER BY "order"').bind(params.id).all();
    return json(results);
  });

  r.post('/api/menus', requireAuth, async (ctx) => {
    const { name, order } = await readJson(ctx.request);
    const res = await ctx.db.prepare('INSERT INTO menus (name, "order") VALUES (?, ?)').bind(nz(name), toInt(order, 0)).run();
    return json({ id: res.meta.last_row_id });
  });

  r.put('/api/menus/:id', requireAuth, async (ctx) => {
    const { name, order } = await readJson(ctx.request);
    const res = await ctx.db.prepare('UPDATE menus SET name=?, "order"=? WHERE id=?').bind(nz(name), toInt(order, 0), ctx.params.id).run();
    return json({ changed: res.meta.changes });
  });

  r.delete('/api/menus/:id', requireAuth, async (ctx) => {
    const res = await ctx.db.prepare('DELETE FROM menus WHERE id=?').bind(ctx.params.id).run();
    return json({ deleted: res.meta.changes });
  });

  // 子菜单
  r.post('/api/menus/:id/submenus', requireAuth, async (ctx) => {
    const { name, order } = await readJson(ctx.request);
    const res = await ctx.db.prepare('INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)')
      .bind(ctx.params.id, nz(name), toInt(order, 0)).run();
    return json({ id: res.meta.last_row_id });
  });

  r.put('/api/menus/submenus/:id', requireAuth, async (ctx) => {
    const { name, order } = await readJson(ctx.request);
    const res = await ctx.db.prepare('UPDATE sub_menus SET name=?, "order"=? WHERE id=?').bind(nz(name), toInt(order, 0), ctx.params.id).run();
    return json({ changed: res.meta.changes });
  });

  r.delete('/api/menus/submenus/:id', requireAuth, async (ctx) => {
    const res = await ctx.db.prepare('DELETE FROM sub_menus WHERE id=?').bind(ctx.params.id).run();
    return json({ deleted: res.meta.changes });
  });
}
