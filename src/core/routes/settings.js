// 站点设置：目前只有“站点默认主题”（访客首次打开时使用；访客自己选择的主题保存在浏览器本地）
import { json, readJson } from '../http.js';
import { requireAuth } from '../auth.js';
import { getSetting, setSetting } from '../settings.js';

export const THEMES = ['default', 'ocean', 'rainbow', 'rose', 'forest', 'sunset', 'sunrise'];

export function registerSettings(r) {
  r.get('/api/settings', async ({ db }) => {
    return json({ defaultTheme: (await getSetting(db, 'default_theme')) || 'default', themes: THEMES });
  });

  r.put('/api/settings', requireAuth, async (ctx) => {
    const b = await readJson(ctx.request);
    if (b.defaultTheme !== undefined) {
      if (!THEMES.includes(b.defaultTheme)) return json({ error: '未知主题' }, 400);
      await setSetting(ctx.db, 'default_theme', b.defaultTheme);
    }
    return json({ ok: true, defaultTheme: (await getSetting(ctx.db, 'default_theme')) || 'default' });
  });
}
