// Node 自托管入口：把 Node 的 HTTP 请求转换为 Web 标准 Request，交给与 Cloudflare 完全相同的核心处理，
// 并负责托管前端静态文件（web/dist）。SQLite 使用 Node 内置 node:sqlite。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import config, { ROOT } from './config.js';
import { openNodeDb } from './src/adapters/node-sqlite.js';
import { handle, isBackendPath } from './src/core/app.js';

const DIST = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : path.join(ROOT, 'web', 'dist');
const MAX_BODY = Number(process.env.MAX_BODY_BYTES) || 60 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.avif': 'image/avif', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml'
};
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;

export function createServer(db, env = process.env) {
  const coreEnv = { ...env, DB: db };

  
  async function readBody(req) {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    for await (const c of req) {
      // 超过大小限制后，不再保存请求体，但继续读取数据，
      // 避免中途终止请求流，导致客户端出现 fetch failed。
      if (tooLarge) {
        continue;
      }

      size += c.length;

      if (size > MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
        continue;
      }

      chunks.push(c);
    }

    // 请求流读取完成后，再返回明确的 413 状态。
    if (tooLarge) {
      const e = new Error('请求体过大');
      e.status = 413;
      throw e;
    }

    return chunks.length ? Buffer.concat(chunks) : undefined;
  }


  function send(req, res, status, headers, body) {
    const h = { ...headers };
    let buf = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const type = String(h['content-type'] || h['Content-Type'] || '');
    if (buf.length > 1024 && COMPRESSIBLE.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      buf = zlib.gzipSync(buf);
      h['Content-Encoding'] = 'gzip';
      h['Vary'] = 'Accept-Encoding';
    }
    h['Content-Length'] = buf.length;
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  function serveFile(req, res, file, extra = {}) {
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ...extra };
    send(req, res, 200, headers, fs.readFileSync(file));
  }

  function safeJoin(base, rel) {
    const p = path.normalize(path.join(base, rel));
    return p === base || p.startsWith(base + path.sep) ? p : null;
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { pathname = url.pathname; }

      if (isBackendPath(pathname)) {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        if (!headers.has('x-forwarded-for') && !headers.has('x-real-ip') && req.socket.remoteAddress) headers.set('x-real-ip', req.socket.remoteAddress);
        const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        const request = new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), {
          method: req.method, headers, body: hasBody ? await readBody(req) : undefined
        });
        const response = await handle(request, coreEnv);

        // 旧版本把上传的图片放在磁盘 uploads/ 目录：数据库里没有时继续读磁盘，保证升级后老图片不丢
        if (response.status === 404 && pathname.startsWith('/uploads/') && req.method === 'GET') {
          const f = safeJoin(config.legacyUploadsDir, pathname.slice('/uploads/'.length));
          if (f && fs.existsSync(f) && fs.statSync(f).isFile()) {
            return serveFile(req, res, f, {
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
              'Cache-Control': 'public, max-age=86400'
            });
          }
        }
        const out = {};
        response.headers.forEach((v, k) => { out[k] = v; });
        return send(req, res, response.status, out, Buffer.from(await response.arrayBuffer()));
      }

      // 前端静态文件 + SPA 回退
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { 'Content-Type': 'text/plain' }, 'Method Not Allowed');
      let file = safeJoin(DIST, pathname);
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const immutable = pathname.startsWith('/assets/');
        return serveFile(req, res, file, { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600' });
      }
      const index = path.join(DIST, 'index.html');
      if (fs.existsSync(index)) return serveFile(req, res, index, { 'Cache-Control': 'no-cache' });
      return send(req, res, 503, { 'Content-Type': 'text/plain; charset=utf-8' },
        '前端尚未构建：请先执行 `npm run build`（或使用 Docker / 一键脚本部署）。');
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error('[server]', e);
      send(req, res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: e.message || 'Internal Error' }));
    }
  });
}

// 作为入口直接运行时启动服务
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = openNodeDb(config.dbPath);
  const server = createServer(db);
  server.listen(config.server.port, () => {
    console.log(`server is running on http://localhost:${config.server.port}`);
    console.log(`数据库文件：${config.dbPath}`);
  });
  const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
