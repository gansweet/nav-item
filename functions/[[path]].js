// Cloudflare Pages Functions 入口（Pages 部署方式使用）。
// 只处理 /api/* 与 /uploads/*（见 web/public/_routes.json），其余由 Pages 直接托管静态文件。
// 需要在 Pages 项目 设置 → 绑定 → D1 数据库 中添加变量名 DB。
import { handle, isBackendPath } from '../src/core/app.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!isBackendPath(url.pathname)) return context.next();
  const res = await handle(context.request, context.env);
  if (res.status === 404 && url.pathname.startsWith('/uploads/')) return context.next();
  return res;
}
