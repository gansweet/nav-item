// 后台「数据库管理」接口（全部需要管理员登录）
import { json, readJson, HttpError, shanghaiTime } from '../http.js';
import { requireAuth } from '../auth.js';
import { TABLES, TABLE_ORDER, TABLE_LABELS, SCHEMA_VERSION } from '../schema.js';
import { getJsonSetting } from '../settings.js';
import { exportBackup, exportSql, importBackup, summarizePayload, readTable } from '../transfer.js';
import {
  loadConnections, saveConnections, publicView, testSupabase, pullSupabase, pushSupabase,
  supabaseSchemaSql, downloadBackup, REMOTE_TABLES
} from '../remote.js';
import { MAX_UPLOAD_BYTES } from './upload.js';

const engineOf = (db) => (typeof db.info === 'function' ? 'node-sqlite' : 'cloudflare-d1');
const q = (id) => `"${id}"`;

// ---------------------------------------------------------------- 状态
async function collectStatus(db) {
  const t0 = Date.now();
  const ping = await db.prepare('SELECT 1 AS ok').all();
  const latencyMs = Date.now() - t0;

  const ver = await db.prepare('SELECT sqlite_version() AS v').first();
  const counts = await db.prepare(
    TABLE_ORDER.map((t) => `SELECT '${t}' AS t, COUNT(*) AS c FROM ${q(t)}`).join(' UNION ALL ')
  ).all();
  const master = await db.prepare("SELECT type, COUNT(*) AS c FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' GROUP BY type").all();
  const objs = Object.fromEntries(master.results.map((r) => [r.type, r.c]));

  let quick = 'unknown';
  try { const r = await db.prepare('PRAGMA quick_check').all(); quick = (r.results[0] && Object.values(r.results[0])[0]) || 'unknown'; } catch (e) { quick = '不可用：' + e.message; }
  let fk = null;
  try { fk = (await db.prepare('PRAGMA foreign_key_check').all()).results.length; } catch { /* 部分环境不支持 */ }

  const info = typeof db.info === 'function' ? db.info() : {};
  const sizeBytes = info.sizeBytes ?? (ping.meta && ping.meta.size_after) ?? null;

  const warnings = [];
  if (quick !== 'ok') warnings.push(`完整性检查未通过：${quick}`);
  if (fk) warnings.push(`发现 ${fk} 条外键不一致的记录（例如卡片指向了已删除的栏目）`);

  const rows = counts.results.reduce((s, r) => s + r.c, 0);
  return {
    engine: engineOf(db),
    runtime: typeof db.info === 'function' ? 'Node.js' : 'Cloudflare Workers',
    sqliteVersion: ver && ver.v,
    schemaVersion: SCHEMA_VERSION,
    file: info.file || null,
    sizeBytes,
    latencyMs,
    tables: counts.results.map((r) => ({ name: r.t, label: TABLE_LABELS[r.t], rows: r.c, columns: TABLES[r.t].cols.length, sensitive: !!TABLES[r.t].sensitive })),
    totals: { tables: objs.table || 0, indexes: objs.index || 0, rows },
    health: { quickCheck: quick, foreignKeyViolations: fk, foreignKeys: true },
    lastImport: await getJsonSetting(db, 'last_import', null),
    lastExport: await getJsonSetting(db, 'last_export', null),
    limits: { maxUploadBytes: MAX_UPLOAD_BYTES },
    warnings
  };
}

// ---------------------------------------------------------------- 表浏览（只读）
const escLike = (s) => s.replace(/[\\%_]/g, (m) => '\\' + m);
const SAFE_COLS = {
  users: ['id', 'username', 'last_login_time', 'last_login_ip'],          // 不展示密码哈希
  uploads: ['id', 'filename', 'mime', 'size', 'created_at']               // 不展示 base64 内容
};

async function browseTable(db, name, url) {
  if (!TABLES[name]) throw new HttpError(404, { error: '未知的数据表' });
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize'), 10) || 20));
  const cols = SAFE_COLS[name] || TABLES[name].cols;
  const kw = (url.searchParams.get('q') || '').trim();
  let where = ''; const args = [];
  if (kw) {
    if (new TextEncoder().encode(kw).length > 40) throw new HttpError(400, { error: '搜索关键词过长（最多约 13 个汉字 / 40 个字母）' });
    const textCols = cols.filter((c) => !['id', 'order', 'size', 'parent_id', 'menu_id', 'sub_menu_id'].includes(c));
    where = ' WHERE ' + textCols.map((c) => `${q(c)} LIKE ? ESCAPE '\\'`).join(' OR ');
    for (let i = 0; i < textCols.length; i++) args.push(`%${escLike(kw)}%`);
  }
  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM ${q(name)}${where}`).bind(...args).first()).c;
  const { results } = await db.prepare(`SELECT ${cols.map(q).join(', ')} FROM ${q(name)}${where} ORDER BY id LIMIT ? OFFSET ?`)
    .bind(...args, pageSize, (page - 1) * pageSize).all();
  return { table: name, label: TABLE_LABELS[name], columns: cols, rows: results, total, page, pageSize };
}

// ---------------------------------------------------------------- 只读 SQL 控制台
async function runReadonlyQuery(db, sqlRaw) {
  const sql = String(sqlRaw || '').trim().replace(/;+\s*$/, '');
  if (!sql) throw new HttpError(400, { error: '请输入 SQL' });
  if (sql.includes(';')) throw new HttpError(400, { error: '一次只能执行一条语句' });
  if (!/^(select|with)\b/i.test(sql)) throw new HttpError(400, { error: '为了安全，控制台只允许 SELECT 查询' });
  if (/\bsettings\b/i.test(sql)) throw new HttpError(400, { error: 'settings 表保存着密钥，不允许在控制台查询' });
  if (sql.length > 4000) throw new HttpError(400, { error: 'SQL 过长' });
  const t0 = Date.now();
  let res;
  try { res = await db.prepare(`SELECT * FROM (${sql}) LIMIT 200`).all(); }
  catch (e) { throw new HttpError(400, { error: 'SQL 执行出错：' + (e.message || e) }); }
  const rows = res.results || [];
  return { columns: rows.length ? Object.keys(rows[0]) : [], rows, truncated: rows.length >= 200, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------- 工具
function parseTables(v) {
  if (!v) return null;
  const list = (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter((t) => TABLES[t]);
  return list.length ? list : null;
}
const flag = (v) => v === true || v === 1 || /^(1|true|yes|on)$/i.test(String(v || ''));
const stamp = () => shanghaiTime().replace(/\D/g, '').slice(0, 14);

function cleanOptions(o = {}, extra = {}) {
  return { tables: parseTables(o.tables), conflict: o.conflict === 'overwrite' ? 'overwrite' : 'skip', mode: o.mode === 'replace' ? 'replace' : 'merge', dryRun: !!o.dryRun, ...extra };
}

async function resolveSupabase(ctx, inline = {}) {
  inline = inline || {};
  const stored = (await loadConnections(ctx.db)).supabase || {};
  return {
    url: (inline.url || '').trim() || stored.url || '',
    key: (inline.key || '').trim() || stored.key || '',
    schema: (inline.schema || '').trim() || stored.schema || 'public',
    prefix: inline.prefix === undefined || inline.prefix === null ? (stored.prefix ?? 'nav_') : String(inline.prefix).trim()
  };
}

export function registerDbAdmin(r) {
  r.get('/api/db/status', requireAuth, async (ctx) => json(await collectStatus(ctx.db)));

  r.get('/api/db/tables/:name', requireAuth, async (ctx) => json(await browseTable(ctx.db, ctx.params.name, ctx.url)));

  r.post('/api/db/query', requireAuth, async (ctx) => json(await runReadonlyQuery(ctx.db, (await readJson(ctx.request)).sql)));

  r.post('/api/db/maintenance', requireAuth, async (ctx) => {
    const { action } = await readJson(ctx.request);
    if (action !== 'optimize') throw new HttpError(400, { error: '不支持的维护操作' });
    await ctx.db.prepare('PRAGMA optimize').all();
    return json({ ok: true, message: '已执行 PRAGMA optimize' });
  });

  // ---- 导出 ----
  r.get('/api/db/export', requireAuth, async (ctx) => {
    const sp = ctx.url.searchParams;
    const opts = { tables: parseTables(sp.get('tables')), includeUsers: flag(sp.get('includeUsers')), includeUploads: flag(sp.get('includeUploads')), engine: engineOf(ctx.db) };
    const format = sp.get('format') === 'sql' ? 'sql' : 'json';
    const body = format === 'sql' ? await exportSql(ctx.db, opts) : JSON.stringify(await exportBackup(ctx.db, opts), null, 2);
    return new Response(body, {
      headers: {
        'Content-Type': format === 'sql' ? 'application/sql; charset=utf-8' : 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="nav-backup-${stamp()}.${format}"`,
        'Cache-Control': 'no-store'
      }
    });
  });

  // ---- 导入 ----
  r.post('/api/db/inspect', requireAuth, async (ctx) => {
    const { backup } = await readJson(ctx.request);
    try { return json(summarizePayload(backup)); } catch (e) { throw new HttpError(400, { error: e.message }); }
  });

  r.post('/api/db/import', requireAuth, async (ctx) => {
    const { backup, options } = await readJson(ctx.request);
    try { return json(await importBackup(ctx.db, backup, cleanOptions(options, { source: 'file' }))); }
    catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, { error: e.message }); }
  });

  // 从云端下载地址导入
  r.post('/api/db/import/url', requireAuth, async (ctx) => {
    const body = await readJson(ctx.request);
    const stored = (await loadConnections(ctx.db)).download || {};
    const url = (body.url || '').trim() || stored.url;
    if (!url) throw new HttpError(400, { error: '请填写备份文件的下载地址' });
    const authorization = body.authorization !== undefined && body.authorization !== '' ? String(body.authorization) : (stored.authorization || '');
    const { payload, bytes, finalUrl } = await downloadBackup(url, { authorization }, ctx.env);
    if (body.remember) await saveConnections(ctx.db, { download: { url, authorization: body.authorization || undefined } });
    let summary;
    try { summary = summarizePayload(payload); } catch (e) { throw new HttpError(400, { error: e.message }); }
    try {
      const report = await importBackup(ctx.db, payload, cleanOptions(body.options, { source: 'url' }));
      return json({ ...report, download: { bytes, finalUrl, summary } });
    } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, { error: e.message }); }
  });

  // ---- 远程连接配置 ----
  r.get('/api/db/connections', requireAuth, async (ctx) => json(publicView(await loadConnections(ctx.db))));
  r.put('/api/db/connections', requireAuth, async (ctx) => {
    const patch = await readJson(ctx.request);
    return json(publicView(await saveConnections(ctx.db, patch)));
  });

  // ---- Supabase / PostgREST ----
  r.get('/api/db/remote/supabase/schema', requireAuth, async (ctx) => {
    const conn = await resolveSupabase(ctx, { schema: ctx.url.searchParams.get('schema') || '', prefix: ctx.url.searchParams.get('prefix') ?? undefined });
    return json({ sql: supabaseSchemaSql({ schema: conn.schema, prefix: conn.prefix }) });
  });

  r.post('/api/db/remote/supabase/test', requireAuth, async (ctx) => {
    const body = await readJson(ctx.request);
    return json(await testSupabase(await resolveSupabase(ctx, body.connection), ctx.env));
  });

  r.post('/api/db/remote/supabase/push', requireAuth, async (ctx) => {
    const body = await readJson(ctx.request);
    const conn = await resolveSupabase(ctx, body.connection);
    const tables = (parseTables(body.tables) || REMOTE_TABLES).filter((t) => REMOTE_TABLES.includes(t));
    const data = {};
    for (const t of tables) data[t] = await readTable(ctx.db, t);
    const pushed = await pushSupabase(conn, ctx.env, data, { mirror: flag(body.mirror) });
    return json({ ok: true, mirror: flag(body.mirror), pushed });
  });

  r.post('/api/db/remote/supabase/pull', requireAuth, async (ctx) => {
    const body = await readJson(ctx.request);
    const conn = await resolveSupabase(ctx, body.connection);
    const opts = cleanOptions(body.options, { source: 'supabase' });
    const backup = await pullSupabase(conn, ctx.env, opts.tables || REMOTE_TABLES);
    const total = Object.values(backup.tables).reduce((s, a) => s + a.length, 0);
    if (!total) throw new HttpError(400, { error: '远程表里没有数据可拉取' });
    try { return json(await importBackup(ctx.db, backup, opts)); }
    catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, { error: e.message }); }
  });
}
