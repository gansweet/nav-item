import { json, nz, toInt, readJson } from '../http.js';
import { requireAuth } from '../auth.js';

export function registerCards(r) {
  // 获取指定菜单的卡片（子菜单卡片通过 ?subMenuId= 获取）
  r.get('/api/cards/:menuId', async ({ db, url, params }) => {
    const subMenuId = url.searchParams.get('subMenuId');
    const stmt = subMenuId
      ? db.prepare('SELECT * FROM cards WHERE sub_menu_id = ? ORDER BY "order"').bind(subMenuId)
      : db.prepare('SELECT * FROM cards WHERE menu_id = ? AND sub_menu_id IS NULL ORDER BY "order"').bind(params.menuId);
    const { results } = await stmt.all();
    const rows = results.map((card) => ({
      ...card,
      display_logo: card.custom_logo_path
        ? '/uploads/' + card.custom_logo_path
        : (card.logo_url || String(card.url || '').replace(/\/+$/, '') + '/favicon.ico')
    }));
    return json(rows);
  });

  r.post('/api/cards', requireAuth, async (ctx) => {
    const b = await readJson(ctx.request);
    const res = await ctx.db.prepare(
      'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, "desc", "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(nz(b.menu_id), b.sub_menu_id || null, nz(b.title), nz(b.url), nz(b.logo_url), nz(b.custom_logo_path), nz(b.desc), toInt(b.order, 0)).run();
    return json({ id: res.meta.last_row_id });
  });

  r.put('/api/cards/:id', requireAuth, async (ctx) => {
    const b = await readJson(ctx.request);
    // 请求体没带 custom_logo_path 时保留原值（原项目会把它清空，这里避免误删已上传的图片）
    let custom = b.custom_logo_path;
    if (custom === undefined) {
      const old = await ctx.db.prepare('SELECT custom_logo_path FROM cards WHERE id = ?').bind(ctx.params.id).first();
      custom = old ? old.custom_logo_path : null;
    }
    const res = await ctx.db.prepare(
      'UPDATE cards SET menu_id=?, sub_menu_id=?, title=?, url=?, logo_url=?, custom_logo_path=?, "desc"=?, "order"=? WHERE id=?'
    ).bind(nz(b.menu_id), b.sub_menu_id || null, nz(b.title), nz(b.url), nz(b.logo_url), nz(custom), nz(b.desc), toInt(b.order, 0), ctx.params.id).run();
    return json({ changed: res.meta.changes });
  });

  r.delete('/api/cards/:id', requireAuth, async (ctx) => {
    const res = await ctx.db.prepare('DELETE FROM cards WHERE id=?').bind(ctx.params.id).run();
    return json({ deleted: res.meta.changes });
  });
}
