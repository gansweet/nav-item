// 业务核心：一个 Web 标准的 fetch 处理函数 handle(request, env) -> Response。
// Workers（worker/index.js）、Pages Functions（functions/[[path]].js）与 Node（app.js）都复用它。
import { Router } from './router.js';
import { HttpError, json, withCors, CORS_HEADERS } from './http.js';
import { ensureSchema } from './schema.js';
import { getSetting, setSetting } from './settings.js';
import { randomToken } from './auth.js';
import { registerMenus } from './routes/menus.js';
import { registerCards } from './routes/cards.js';
import { registerAds, registerFriends } from './routes/simple.js';
import { registerAuthAndUsers } from './routes/users.js';
import { registerUpload, serveUpload } from './routes/upload.js';
import { registerSettings } from './routes/settings.js';
import { registerDbAdmin } from './routes/dbadmin.js';

const router = new Router();
registerMenus(router);
registerCards(router);
registerAds(router);
registerFriends(router);
registerAuthAndUsers(router);
registerUpload(router);
registerSettings(router);
registerDbAdmin(router);

const secretCache = new WeakMap();
async function resolveJwtSecret(db, env) {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (secretCache.has(db)) return secretCache.get(db);
  let s = await getSetting(db, 'jwt_secret');
  if (!s) {
    // 未配置 JWT_SECRET 时，首次使用自动生成随机密钥并保存在数据库中（不会随导出文件泄露）
    await db.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('jwt_secret', ?, ?)")
      .bind(randomToken(48), new Date().toISOString()).run();
    s = await getSetting(db, 'jwt_secret');
  }
  secretCache.set(db, s);
  return s;
}

/** 该路径是否归后端处理（其余交给静态资源） */
export function isBackendPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/uploads/');
}

export async function handle(request, env = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const url = new URL(request.url);
  try {
    const db = env.DB;
    if (!db) {
      throw new HttpError(500, { error: '未绑定数据库：请在 Cloudflare 中为本项目绑定 D1 数据库，变量名必须为 DB（详见 README）' });
    }
    await ensureSchema(db, env);

    const ctx = {
      request, url, db, env, params: {}, user: null,
      jwtSecret: () => resolveJwtSecret(db, env)
    };

    if (url.pathname.startsWith('/uploads/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const res = await serveUpload(ctx, decodeURIComponent(url.pathname.slice('/uploads/'.length)));
      return withCors(res || json({ error: 'Not Found' }, 404));
    }

    const m = router.match(request.method, url.pathname);
    if (!m) return withCors(json({ error: 'Not Found' }, 404));
    ctx.params = m.params;
    for (const h of m.handlers) {
      const out = await h(ctx);
      if (out instanceof Response) return withCors(out);
    }
    return withCors(json({ error: 'No response' }, 500));
  } catch (e) {
    if (e instanceof HttpError) return withCors(json(e.body, e.status));
    console.error('[api]', request.method, url.pathname, e);
    return withCors(json({ error: (e && e.message) || String(e) }, 500));
  }
}
