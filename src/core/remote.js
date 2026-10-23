// 远程数据源：
//   1) Supabase / 任意 PostgREST 兼容服务（读写：推送备份、拉取并导入）
//   2) 云端下载地址（只读：下载备份 JSON 并导入 D1）
import { HttpError } from './http.js';
import { assertPublicUrl } from './netguard.js';
import { getJsonSetting, setSetting } from './settings.js';

export const REMOTE_TABLES = ['menus', 'sub_menus', 'cards', 'ads', 'friends'];
const PAGE = 1000;
const PUSH_CHUNK = 200;
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;
const TIMEOUT_MS = 30000;

// ---------------------------------------------------------------- 连接配置存取
const KEY = 'remote_connections';

export async function loadConnections(db) {
  return (await getJsonSetting(db, KEY, {})) || {};
}

const mask = (k) => (k ? '••••••••' + String(k).slice(-4) : '');

/** 返回给前端的版本：密钥只显示末 4 位 */
export function publicView(conns) {
  const sb = conns.supabase || {};
  const dl = conns.download || {};
  return {
    supabase: { url: sb.url || '', schema: sb.schema || 'public', prefix: sb.prefix ?? 'nav_', hasKey: !!sb.key, keyMasked: mask(sb.key) },
    download: { url: dl.url || '', hasAuth: !!dl.authorization, authMasked: mask(dl.authorization) }
  };
}

export async function saveConnections(db, patch) {
  const cur = await loadConnections(db);
  const next = { ...cur };
  if (patch.supabase) {
    const p = patch.supabase;
    next.supabase = {
      url: String(p.url ?? cur.supabase?.url ?? '').trim(),
      schema: String(p.schema || cur.supabase?.schema || 'public').trim() || 'public',
      prefix: p.prefix === undefined ? (cur.supabase?.prefix ?? 'nav_') : String(p.prefix).trim(),
      key: p.key ? String(p.key).trim() : (cur.supabase?.key || '')      // 留空表示沿用旧密钥
    };
  }
  if (patch.download) {
    const p = patch.download;
    next.download = {
      url: String(p.url ?? cur.download?.url ?? '').trim(),
      authorization: p.authorization === undefined ? (cur.download?.authorization || '') : String(p.authorization).trim()
    };
  }
  await setSetting(db, KEY, next);
  return next;
}

// ---------------------------------------------------------------- Supabase / PostgREST
/** 兼容多种填法：项目 ref、https://xxx.supabase.co、带 /rest/v1 的完整地址、自建服务地址 */
export function normalizeRestBase(input) {
  let s = String(input || '').trim();
  if (!s) throw new HttpError(400, { error: '请填写 Supabase 项目地址（Project URL）' });
  if (/^[a-z0-9]{20}$/.test(s)) s = `https://${s}.supabase.co`;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  s = s.replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
  return s + '/rest/v1';
}

function sbHeaders(conn, extra = {}) {
  const h = { apikey: conn.key, Accept: 'application/json', ...extra };
  // 新版密钥（sb_publishable_ / sb_secret_）不是 JWT，只能放 apikey；旧版 JWT 密钥（eyJ…）同时放 Authorization
  if (/^eyJ/.test(conn.key || '')) h.Authorization = `Bearer ${conn.key}`;
  if (conn.schema && conn.schema !== 'public') { h['Accept-Profile'] = conn.schema; h['Content-Profile'] = conn.schema; }
  return h;
}

function explain(status, body, table) {
  const code = body && body.code; const msg = (body && (body.message || body.error || body.msg)) || '';
  if (status === 401 || /invalid api key|jwt/i.test(msg)) return 'API Key 无效或已过期，请检查密钥（Settings → API Keys）';
  if (code === 'PGRST205' || code === '42P01' || status === 404) return `远程表「${table}」不存在，请先在 Supabase 的 SQL Editor 执行建表脚本`;
  if (code === '42501' || status === 403 || /row-level security|permission denied/i.test(msg)) return '没有读写权限（被 RLS 策略拦截）。请改用 secret / service_role 密钥，或为这些表添加策略';
  if (code === 'PGRST106') return '指定的 Schema 未暴露给 API，请在 Supabase → Settings → API 的 Exposed schemas 中添加';
  return msg ? `${msg}${body.hint ? '（' + body.hint + '）' : ''}` : `HTTP ${status}`;
}

async function sbFetch(conn, env, path, { method = 'GET', headers = {}, body, table = '' } = {}) {
  const base = normalizeRestBase(conn.url);
  const url = base + path;
  assertPublicUrl(url, env);
  if (!conn.key) throw new HttpError(400, { error: '请填写 API Key' });
  let res;
  try {
    res = await fetch(url, {
      method, headers: sbHeaders(conn, { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }),
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (e) {
    throw new HttpError(502, { error: `无法连接远程数据库：${e && e.message ? e.message : e}` });
  }
  if (!res.ok) {
    let b = null; try { b = await res.json(); } catch { /* ignore */ }
    throw new HttpError(res.status === 401 || res.status === 403 ? 400 : 502, { error: explain(res.status, b, table), remoteStatus: res.status, remoteCode: b && b.code });
  }
  return res;
}

const tname = (conn, t) => `${conn.prefix ?? 'nav_'}${t}`;
const totalFromRange = (res) => { const m = (res.headers.get('content-range') || '').match(/\/(\d+)$/); return m ? Number(m[1]) : null; };

/** 逐表探测：是否存在、行数 */
export async function testSupabase(conn, env) {
  const tables = [];
  let allOk = true;
  for (const t of REMOTE_TABLES) {
    try {
      const res = await sbFetch(conn, env, `/${encodeURIComponent(tname(conn, t))}?select=id&limit=1`, { headers: { Prefer: 'count=exact' }, table: tname(conn, t) });
      await res.text();
      tables.push({ name: tname(conn, t), exists: true, rows: totalFromRange(res) });
    } catch (e) {
      // 密钥错误之类的全局问题，第一张表就直接抛出
      if (e instanceof HttpError && (e.body.remoteStatus === 401 || !/不存在/.test(e.body.error))) { if (!tables.length) throw e; }
      allOk = false;
      tables.push({ name: tname(conn, t), exists: false, error: e.body ? e.body.error : String(e.message || e) });
    }
  }
  return { ok: allOk, endpoint: normalizeRestBase(conn.url), schema: conn.schema || 'public', tables };
}

export async function pullSupabase(conn, env, tables = REMOTE_TABLES) {
  const out = {};
  for (const t of REMOTE_TABLES.filter((x) => tables.includes(x))) {
    const rows = [];
    let offset = 0;
    for (;;) {
      const res = await sbFetch(conn, env, `/${encodeURIComponent(tname(conn, t))}?select=*&order=id.asc&limit=${PAGE}&offset=${offset}`,
        { headers: { Prefer: 'count=exact' }, table: tname(conn, t) });
      const page = await res.json();
      if (!Array.isArray(page)) throw new HttpError(502, { error: `远程表「${tname(conn, t)}」返回了意外的数据` });
      rows.push(...page);
      offset += page.length;
      const total = totalFromRange(res);
      if (!page.length || (total != null && offset >= total) || (total == null && page.length < PAGE)) break;
    }
    out[t] = rows;
  }
  return { format: 'nav-item-backup', version: 2, source: 'supabase', tables: out };
}

/** 推送：merge=按 id 合并写入（upsert）；mirror=先清空远程表再写入（远程变成本地的精确副本） */
export async function pushSupabase(conn, env, tablesData, { mirror = false } = {}) {
  const result = {};
  const order = REMOTE_TABLES.filter((t) => tablesData[t]);
  if (mirror) {
    for (const t of [...order].reverse()) {
      await sbFetch(conn, env, `/${encodeURIComponent(tname(conn, t))}?id=not.is.null`, { method: 'DELETE', headers: { Prefer: 'return=minimal' }, table: tname(conn, t) });
    }
  }
  for (const t of order) {
    const rows = tablesData[t];
    for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
      await sbFetch(conn, env, `/${encodeURIComponent(tname(conn, t))}?on_conflict=id`, {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows.slice(i, i + PUSH_CHUNK), table: tname(conn, t)
      });
    }
    result[t] = rows.length;
  }
  return result;
}

/** 在 Supabase SQL Editor 中执行一次的建表脚本 */
export function supabaseSchemaSql({ schema = 'public', prefix = 'nav_' } = {}) {
  const s = schema; const p = prefix;
  const T = (n) => `${s}.${p}${n}`;
  const tables = {
    menus: `id bigint primary key,\n  name text not null,\n  "order" integer default 0`,
    sub_menus: `id bigint primary key,\n  parent_id bigint not null,\n  name text not null,\n  "order" integer default 0`,
    cards: `id bigint primary key,\n  menu_id bigint,\n  sub_menu_id bigint,\n  title text not null,\n  url text not null,\n  logo_url text,\n  custom_logo_path text,\n  "desc" text,\n  "order" integer default 0`,
    ads: `id bigint primary key,\n  position text not null,\n  img text not null,\n  url text not null`,
    friends: `id bigint primary key,\n  title text not null,\n  url text not null,\n  logo text`
  };
  const lines = ['-- nav-item × Supabase：建表脚本（在 Supabase 控制台 → SQL Editor 中执行一次）', `-- Schema：${s}　表名前缀：${p}`, ''];
  for (const t of REMOTE_TABLES) lines.push(`create table if not exists ${T(t)} (\n  ${tables[t]}\n);`, '');
  lines.push('-- 开启行级安全（RLS）且不创建任何策略：匿名 / publishable 密钥无法读取，只有 secret / service_role 密钥可以读写。');
  for (const t of REMOTE_TABLES) lines.push(`alter table ${T(t)} enable row level security;`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------- 云端下载
/** GitHub 页面链接自动换成 raw 直链 */
export function toDirectUrl(input) {
  const u = String(input || '').trim();
  const m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  const g = u.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/i);
  if (g) return `https://gist.githubusercontent.com/${g[1]}/${g[2]}/raw`;
  return u;
}

async function readLimited(res, max) {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, { error: `文件过大（上限 ${Math.round(max / 1048576)} MB）` });
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } throw new HttpError(413, { error: `文件过大（上限 ${Math.round(max / 1048576)} MB）` }); }
    chunks.push(value);
  }
  const buf = new Uint8Array(size); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf;
}

/** 下载并解析备份 JSON。手动跟随重定向，并对每一跳重新做内网地址检查 */
export async function downloadBackup(rawUrl, { authorization = '' } = {}, env = {}) {
  let url = toDirectUrl(rawUrl);
  let res;
  for (let hop = 0; hop < 5; hop++) {
    assertPublicUrl(url, env);
    const headers = { Accept: 'application/json, text/plain, */*', 'User-Agent': 'nav-item-backup-fetch' };
    // 授权头只发给最初的主机，避免被重定向带到别处
    if (authorization && hop === 0) headers.Authorization = authorization;
    try { res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (e) { throw new HttpError(502, { error: `下载失败：${e && e.message ? e.message : e}` }); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), url).toString(); authorization = ''; continue; }
    break;
  }
  if (!res || (res.status >= 300 && res.status < 400)) throw new HttpError(502, { error: '重定向次数过多' });
  if (!res.ok) throw new HttpError(502, { error: `下载失败：远程服务器返回 HTTP ${res.status}` });
  const bytes = await readLimited(res, MAX_DOWNLOAD_BYTES);
  let text = new TextDecoder().decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let payload;
  try { payload = JSON.parse(text); } catch { throw new HttpError(400, { error: '下载到的内容不是 JSON。请提供 nav-item 导出的 .json 备份文件地址' }); }
  return { payload, bytes: bytes.length, finalUrl: url };
}
