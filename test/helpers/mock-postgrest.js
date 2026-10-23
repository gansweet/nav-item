// 本地模拟的 PostgREST / Supabase REST 服务，用来检验连接器的协议细节（请求头、分页、upsert、错误映射）。
// 注意：这是按公开文档行为编写的模拟，不是真实的 Supabase。
import http from 'node:http';

export function startMockSupabase({ key = 'sb_secret_TESTKEY', maxRows = 1000, schema = 'public', tables = ['nav_menus', 'nav_sub_menus', 'nav_cards', 'nav_ads', 'nav_friends'], rls = false } = {}) {
  const data = Object.fromEntries(tables.map((t) => [t, []]));
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    log.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body });
    const send = (status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };

    // 鉴权：新版密钥（非 JWT）只能放 apikey，放进 Authorization 会被当 JWT 解析并拒绝
    const apikey = req.headers.apikey;
    if (apikey !== key) return send(401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' });
    const auth = req.headers.authorization;
    if (auth && !/^Bearer eyJ/.test(auth) && key.startsWith('sb_')) return send(401, { code: 'PGRST301', message: 'Invalid JWT' });
    if (!url.pathname.startsWith('/rest/v1/')) return send(404, { message: 'not found' });
    // 非 public schema 必须带 Profile 头
    const prof = req.headers['accept-profile'] || req.headers['content-profile'];
    if (schema !== 'public' && prof !== schema) return send(406, { code: 'PGRST106', message: `The schema must be one of the following: ${schema}` });
    if (rls) return send(403, { code: '42501', message: 'new row violates row-level security policy for table' });

    const table = decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    if (!data[table]) return send(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` });
    const rows = data[table];

    if (req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit') || 1000), maxRows);
      const offset = Number(url.searchParams.get('offset') || 0);
      const sorted = [...rows].sort((a, b) => a.id - b.id);
      const page = sorted.slice(offset, offset + limit);
      const range = page.length ? `${offset}-${offset + page.length - 1}/${rows.length}` : `*/${rows.length}`;
      const h = /count=exact/.test(req.headers.prefer || '') ? { 'Content-Range': range } : {};
      return send(page.length < rows.length - offset ? 206 : 200, page, h);
    }
    if (req.method === 'POST') {
      if (url.searchParams.get('on_conflict') !== 'id' || !/merge-duplicates/.test(req.headers.prefer || '')) return send(409, { code: '23505', message: 'duplicate key' });
      const keys = JSON.stringify(Object.keys(body[0]).sort());
      if (body.some((r) => JSON.stringify(Object.keys(r).sort()) !== keys)) return send(400, { code: 'PGRST102', message: 'All object keys must match' });
      for (const r of body) { const i = rows.findIndex((x) => x.id === r.id); if (i >= 0) rows[i] = r; else rows.push(r); }
      return send(201, undefined);
    }
    if (req.method === 'DELETE') {
      if (!url.searchParams.get('id')) return send(400, { code: '21000', message: 'DELETE requires a WHERE clause' });
      rows.length = 0;
      return send(204, undefined);
    }
    send(405, { message: 'method' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, data, log, key, close: () => new Promise((r) => server.close(r))
  })));
}

/** 简单的静态内容服务：用于测试“云端下载地址” */
export function startFileServer(routes) {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push({ path: req.url, headers: req.headers });
    const r = routes[req.url.split('?')[0]];
    if (!r) { res.writeHead(404); return res.end('nope'); }
    if (typeof r === 'function') return r(req, res);
    res.writeHead(r.status || 200, r.headers || { 'Content-Type': 'application/json' }); res.end(r.body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`, log, close: () => new Promise((r) => server.close(r))
  })));
}
