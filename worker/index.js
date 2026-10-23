// Cloudflare Workers 入口：/api/* 与 /uploads/* 由后端处理，其余请求交给静态资源（Vue 前端）。
// 需要在 wrangler.toml 中绑定 D1 数据库（变量名 DB）与静态资源（assets）。
import { handle, isBackendPath } from '../src/core/app.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (isBackendPath(url.pathname)) {
      const res = await handle(request, env);
      // /uploads/ 下数据库里没有的文件（例如随前端发布的 default-favicon.png），回退到静态资源
      if (res.status === 404 && url.pathname.startsWith('/uploads/') && env.ASSETS) return env.ASSETS.fetch(request);
      return res;
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404 });
  }
};
