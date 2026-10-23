// 轻量 HTTP 工具：JSON 响应、错误、CORS、请求体解析（Web 标准 API，Workers / Node 通用）

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400'
};

export class HttpError extends Error {
  constructor(status, body) {
    super(typeof body === 'string' ? body : (body && (body.error || body.message)) || `HTTP ${status}`);
    this.status = status;
    this.body = typeof body === 'string' ? { error: body } : body;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  });
}

export function withCors(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) if (!h.has(k)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export async function readJson(request, { maxBytes = 60 * 1024 * 1024 } = {}) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len && len > maxBytes) throw new HttpError(413, { error: `请求体过大（上限 ${Math.round(maxBytes / 1048576)} MB）` });
  let text;
  try { text = await request.text(); } catch { throw new HttpError(400, { error: '无法读取请求体' }); }
  if (!text) return {};
  if (text.length > maxBytes) throw new HttpError(413, { error: `请求体过大（上限 ${Math.round(maxBytes / 1048576)} MB）` });
  try { return JSON.parse(text); } catch { throw new HttpError(400, { error: '请求体不是合法的 JSON' }); }
}

/** undefined 在 D1 / SQLite 绑定时不被接受，统一转 null */
export const nz = (v) => (v === undefined ? null : v);

export function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

/** 解析 ?page=&pageSize=，保持与原项目一致：两个参数都没有时返回 null（表示不分页） */
export function parsePaging(url) {
  const page = url.searchParams.get('page');
  const pageSize = url.searchParams.get('pageSize');
  if (!page && !pageSize) return null;
  const pageNum = parseInt(page, 10) || 1;
  const size = parseInt(pageSize, 10) || 10;
  return { page: pageNum, pageSize: size, offset: (pageNum - 1) * size };
}

export function clientIp(request) {
  let ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
  if (ip.includes(',')) ip = ip.split(',')[0].trim();
  if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  return ip;
}

/** 上海时间 YYYY-MM-DD HH:mm:ss（与原项目登录时间格式一致） */
export function shanghaiTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hh}:${p.minute}:${p.second}`;
}
