// 数据库导入 / 导出引擎。
//
// 导出：JSON（推荐，可被本引擎再次导入）或 SQL（可用 wrangler d1 execute / sqlite3 直接执行）。
// 导入：对任意来源（本地文件、云端 URL、Supabase 拉取）的“备份对象”执行同一套逻辑：
//   · 以“自然键”识别重复记录，而不是依赖自增 ID（不同数据库里的 ID 本来就不一样）
//       栏目=名称；子栏目=所属栏目+名称；卡片=所属栏目(或子栏目)+标题+网址；
//       广告=位置+图片；友链=网址；账号=用户名；图片=文件名
//   · 重复记录可选择“跳过”或“覆盖”；新记录自动追加，并自动重映射栏目 / 子栏目外键
//   · 整个导入在一个 batch（事务）里执行，要么全部成功，要么不改动数据库
//   · 支持 dryRun 预览：只统计，不写入
import { TABLES, TABLE_ORDER, DDL, SCHEMA_VERSION } from './schema.js';
import { buildInserts, q, sqlLiteral } from './sqlutil.js';
import { getSetting, setSetting } from './settings.js';
import { base64ToBytes } from './auth.js';

export const FORMAT = 'nav-item-backup';
export const DEFAULT_EXPORT_TABLES = ['menus', 'sub_menus', 'cards', 'ads', 'friends'];
const MAX_BATCH = 900;           // 单个 batch 的语句数上限；超过则分批（失去整体原子性，会在报告里提示）
const MAX_ROWS_PER_TABLE = 100000;
const MAX_UPLOAD_B64 = 1_500_000;

const lc = (s) => String(s ?? '').trim().toLowerCase();
const str = (v) => (v == null ? '' : String(v));
const int = (v, d = 0) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : d; };

/** 网址比较键：去首尾空格、去末尾斜杠，主机名转小写 */
export function urlKey(u) {
  const s = String(u ?? '').trim().replace(/\/+$/, '');
  try {
    const x = new URL(s);
    return (x.protocol + '//' + x.host.toLowerCase() + x.pathname.replace(/\/+$/, '') + x.search + x.hash);
  } catch { return s.toLowerCase(); }
}

// ----------------------------------------------------------------------------
// 导出
// ----------------------------------------------------------------------------
function pickTables(tables, { includeUsers, includeUploads }) {
  let list = (tables && tables.length ? tables : DEFAULT_EXPORT_TABLES).filter((t) => TABLES[t]);
  if (includeUsers && !list.includes('users')) list = [...list, 'users'];
  if (includeUploads && !list.includes('uploads')) list = [...list, 'uploads'];
  if (!includeUsers) list = list.filter((t) => t !== 'users' || (tables || []).includes('users'));
  return TABLE_ORDER.filter((t) => list.includes(t));
}

export async function readTable(db, table) {
  const cols = TABLES[table].cols.map(q).join(', ');
  const { results } = await db.prepare(`SELECT ${cols} FROM ${q(table)} ORDER BY id`).all();
  return results;
}

export async function exportBackup(db, opts = {}) {
  const list = pickTables(opts.tables, opts);
  const out = {};
  const counts = {};
  for (const t of list) { out[t] = await readTable(db, t); counts[t] = out[t].length; }
  const meta = {
    format: FORMAT, version: 2, app: 'nav-item', schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(), engine: opts.engine || 'unknown', counts
  };
  await setSetting(db, 'last_export', { at: meta.exportedAt, tables: list, counts }).catch(() => {});
  return { ...meta, tables: out };
}

export async function exportSql(db, opts = {}) {
  const backup = await exportBackup(db, opts);
  const lines = [
    `-- nav-item 数据库导出（SQL）`,
    `-- 导出时间：${backup.exportedAt}`,
    `-- 用法：Cloudflare D1  → wrangler d1 execute <库名> --remote --file=本文件.sql`,
    `--       本地 SQLite    → sqlite3 database/nav.db < 本文件.sql`,
    `-- 说明：使用 UPSERT（按 id 冲突则更新），可重复执行；不会删除目标库里已有的其它数据。`,
    ''
  ];
  lines.push(...DDL.map((s) => s + ';'), '');
  for (const t of Object.keys(backup.tables)) {
    const cols = TABLES[t].cols;
    const upd = cols.filter((c) => c !== 'id').map((c) => `${q(c)} = excluded.${q(c)}`).join(', ');
    lines.push(`-- ${t}（${backup.tables[t].length} 行）`);
    for (const row of backup.tables[t]) {
      lines.push(
        `INSERT INTO ${q(t)} (${cols.map(q).join(', ')}) VALUES (${cols.map((c) => sqlLiteral(row[c])).join(', ')}) ` +
        `ON CONFLICT("id") DO UPDATE SET ${upd};`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ----------------------------------------------------------------------------
// 标准化与校验
// ----------------------------------------------------------------------------
/** 把各种来源的数据整理成 { tables: {menus:[], ...}, flat:boolean, warnings:[] } */
export function normalizePayload(payload) {
  const warnings = [];
  let tables = {};
  let flat = false;

  if (Array.isArray(payload)) {
    // 兼容“卡片平铺列表”：[{title,url,logo_url,desc,order,menu,subMenu}]（栏目以名称引用）
    flat = true;
    tables.cards = payload.filter((x) => x && typeof x === 'object');
  } else if (payload && typeof payload === 'object') {
    if (payload.format && payload.format !== FORMAT) warnings.push(`文件标识为 "${payload.format}"，不是 nav-item 备份，将尽力按表结构解析。`);
    const src = payload.tables && typeof payload.tables === 'object' ? payload.tables : payload;
    for (const t of TABLE_ORDER) if (Array.isArray(src[t])) tables[t] = src[t].filter((x) => x && typeof x === 'object');
    // 兼容仅有 sub_menus 的别名
    if (!tables.sub_menus && Array.isArray(src.submenus)) tables.sub_menus = src.submenus;
  } else {
    throw new Error('无法识别的备份内容：应为 JSON 对象（nav-item 备份）或卡片数组');
  }
  const present = Object.keys(tables).filter((t) => tables[t].length);
  if (!present.length) throw new Error('备份中没有可导入的数据（menus / sub_menus / cards / ads / friends / users / uploads 均为空或不存在）');
  for (const t of Object.keys(tables)) {
    if (tables[t].length > MAX_ROWS_PER_TABLE) throw new Error(`表 ${t} 行数过多（上限 ${MAX_ROWS_PER_TABLE}）`);
  }
  return { tables, flat, warnings };
}

const sanitize = {
  menus: (r) => (str(r.name).trim() ? { id: int(r.id, null), name: str(r.name), order: int(r.order, 0) } : null),
  sub_menus: (r) => (str(r.name).trim() ? { id: int(r.id, null), parent_id: int(r.parent_id, null), parent_name: str(r.parent_name || r.menu).trim(), name: str(r.name), order: int(r.order, 0) } : null),
  cards: (r) => {
    const title = str(r.title); const url = str(r.url);
    if (!title.trim() || !url.trim()) return null;
    return {
      id: int(r.id, null), menu_id: int(r.menu_id, null), sub_menu_id: int(r.sub_menu_id, null),
      menu_name: str(r.menu_name ?? r.menu).trim(), sub_menu_name: str(r.sub_menu_name ?? r.subMenu).trim(),
      title, url, logo_url: str(r.logo_url), custom_logo_path: r.custom_logo_path ? str(r.custom_logo_path) : null,
      desc: r.desc == null ? '' : str(r.desc), order: int(r.order, 0)
    };
  },
  ads: (r) => (str(r.position).trim() && str(r.img).trim() && str(r.url).trim()
    ? { id: int(r.id, null), position: str(r.position), img: str(r.img), url: str(r.url) } : null),
  friends: (r) => (str(r.title).trim() && str(r.url).trim()
    ? { id: int(r.id, null), title: str(r.title), url: str(r.url), logo: str(r.logo) } : null),
  users: (r) => (str(r.username).trim() && str(r.password)
    ? { id: int(r.id, null), username: str(r.username), password: str(r.password), last_login_time: r.last_login_time ?? null, last_login_ip: r.last_login_ip ?? null } : null),
  uploads: (r) => {
    const data = str(r.data);
    if (!str(r.filename).trim() || !data || data.length > MAX_UPLOAD_B64 || /[^A-Za-z0-9+/=]/.test(data)) return null;
    return { id: int(r.id, null), filename: str(r.filename).trim(), mime: str(r.mime) || 'application/octet-stream', size: int(r.size, 0) || Math.floor(data.length * 0.75), data, created_at: r.created_at ?? new Date().toISOString() };
  }
};

// ----------------------------------------------------------------------------
// 导入
// ----------------------------------------------------------------------------
/** 选中表的依赖闭包：卡片依赖栏目/子栏目；子栏目依赖栏目 */
export function withDependencies(tables) {
  const set = new Set(tables);
  if (set.has('cards')) { set.add('menus'); set.add('sub_menus'); }
  if (set.has('sub_menus')) set.add('menus');
  return TABLE_ORDER.filter((t) => set.has(t));
}
/** replace 模式下，删除栏目 / 子栏目会级联删除其下卡片，所以卡片必须一并替换 */
export function withDependents(tables) {
  const set = new Set(tables);
  if (set.has('menus')) { set.add('sub_menus'); set.add('cards'); }
  if (set.has('sub_menus')) set.add('cards');
  return TABLE_ORDER.filter((t) => set.has(t));
}

const newCounter = () => ({ total: 0, inserted: 0, overwritten: 0, unchanged: 0, skipped: 0, invalid: 0 });

/**
 * @param {object} payload   备份内容（对象或卡片数组）
 * @param {object} options   { tables?:string[], conflict:'skip'|'overwrite', mode:'merge'|'replace', dryRun?:boolean, source?:string }
 */
export async function importBackup(db, payload, options = {}) {
  const conflict = options.conflict === 'overwrite' ? 'overwrite' : 'skip';
  const mode = options.mode === 'replace' ? 'replace' : 'merge';
  const dryRun = !!options.dryRun;

  const { tables: raw, flat, warnings } = normalizePayload(payload);

  // 默认导入备份中存在的表，但账号与图片需显式勾选
  let selected = options.tables && options.tables.length
    ? options.tables.filter((t) => TABLES[t])
    : Object.keys(raw).filter((t) => t !== 'users' && t !== 'uploads');
  selected = selected.filter((t) => raw[t] && raw[t].length);          // 备份里没有的表不会被清空
  selected = mode === 'merge' ? withDependencies(selected) : withDependents(selected);
  if (!selected.length) throw new Error('没有选择任何可导入的数据表');

  // replace 模式安全检查
  if (mode === 'replace' && selected.includes('users') && !(raw.users || []).some((u) => sanitize.users(u))) {
    throw new Error('替换账号表时，备份里必须包含至少一个有效账号，否则会把你锁在系统之外');
  }

  const report = { ok: true, dryRun, mode, conflict, atomic: true, tables: {}, warnings: [...warnings], samples: { skipped: [], invalid: [] } };
  for (const t of selected) report.tables[t] = newCounter();
  const note = (kind, text) => { if (report.samples[kind].length < 8) report.samples[kind].push(text); };

  // ---- 读取目标库现有数据 ----
  const existing = {};
  for (const t of selected) {
    if (mode === 'replace') { existing[t] = []; continue; }
    existing[t] = await readTable(db, t);
  }
  // 仅替换卡片等情况下，栏目表不在 selected 里，但仍需要现有栏目来做 ID 对应
  const exMenus = existing.menus || (selected.includes('cards') ? await readTable(db, 'menus') : []);
  const exSubs = existing.sub_menus || (selected.includes('cards') ? await readTable(db, 'sub_menus') : []);
  const needMenus = (t) => selected.includes(t);

  // 每张表：key -> 目标行（含已计划写入的新行），用于去重；nextId 用于分配新 ID
  const idx = {}; const nextId = {}; const usedIds = {}; const writes = {};
  for (const t of selected) { idx[t] = new Map(); usedIds[t] = new Set(); writes[t] = []; nextId[t] = 1; }
  for (const t of selected) {
    for (const r of existing[t]) usedIds[t].add(r.id);
    nextId[t] = (existing[t].reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1;
  }
  // replace 模式：预留备份中的合法 ID，以便精确还原
  const preferId = (t, oldId) => {
    if (mode === 'replace' && Number.isInteger(oldId) && oldId > 0 && !usedIds[t].has(oldId)) { usedIds[t].add(oldId); nextId[t] = Math.max(nextId[t], oldId + 1); return oldId; }
    let id = nextId[t]; while (usedIds[t].has(id)) id++; nextId[t] = id + 1; usedIds[t].add(id); return id;
  };
  // replace 模式下先预留，避免新分配的 ID 抢占备份里其它行的 ID
  if (mode === 'replace') {
    for (const t of selected) for (const r of (raw[t] || [])) { const id = int(r.id, null); if (Number.isInteger(id) && id > 0) nextId[t] = Math.max(nextId[t], id + 1); }
  }

  const menuIdMap = new Map();       // 备份中的 menu.id -> 目标 id
  const subIdMap = new Map();        // 备份中的 sub_menu.id -> 目标 id
  const menuByName = new Map();      // lc(name) -> 目标 id
  const subByKey = new Map();        // `${parentTargetId}|${lc(name)}` -> 目标 id
  const subByName = new Map();       // lc(name) -> 目标 id（平铺列表用）
  const subParent = new Map();       // 目标子栏目 id -> 目标栏目 id

  // ---- 栏目 ----
  if (needMenus('menus')) {
    for (const r of existing.menus) { menuByName.set(lc(r.name), r.id); idx.menus.set(lc(r.name), r); }
    for (const rawRow of (raw.menus || [])) {
      const c = report.tables.menus; c.total++;
      const m = sanitize.menus(rawRow);
      if (!m) { c.invalid++; note('invalid', `栏目：缺少名称`); continue; }
      const key = lc(m.name);
      const hit = idx.menus.get(key);
      if (hit) {
        if (m.id != null) menuIdMap.set(m.id, hit.id);
        if (conflict === 'overwrite' && !hit._planned && (hit.order !== m.order || hit.name !== m.name)) {
          writes.menus.push({ id: hit.id, name: m.name, order: m.order }); hit.order = m.order; hit.name = m.name; c.overwritten++;
        } else if (conflict === 'overwrite' && !hit._planned) c.unchanged++;
        else { c.skipped++; note('skipped', `栏目「${m.name}」已存在`); }
        continue;
      }
      const id = preferId('menus', m.id);
      const row = { id, name: m.name, order: m.order, _planned: true };
      idx.menus.set(key, row); menuByName.set(key, id); writes.menus.push(row); c.inserted++;
      if (m.id != null) menuIdMap.set(m.id, id);
    }
  }

  // ---- 子栏目 ----
  if (needMenus('sub_menus')) {
    for (const r of existing.sub_menus) {
      const k = `${r.parent_id}|${lc(r.name)}`; idx.sub_menus.set(k, r); subByKey.set(k, r.id); subByName.set(lc(r.name), r.id); subParent.set(r.id, r.parent_id);
    }
    const backupHasMenus = (raw.menus || []).length > 0;
    for (const rawRow of (raw.sub_menus || [])) {
      const c = report.tables.sub_menus; c.total++;
      const s = sanitize.sub_menus(rawRow);
      if (!s) { c.invalid++; note('invalid', '子栏目：缺少名称'); continue; }
      let parent = s.parent_id != null ? menuIdMap.get(s.parent_id) : undefined;
      if (parent === undefined && s.parent_name) parent = menuByName.get(lc(s.parent_name));
      if (parent === undefined && !backupHasMenus && s.parent_id != null && exMenus.some((m) => m.id === s.parent_id)) parent = s.parent_id;
      if (parent === undefined) { c.invalid++; note('invalid', `子栏目「${s.name}」找不到所属栏目`); continue; }
      const key = `${parent}|${lc(s.name)}`;
      const hit = idx.sub_menus.get(key);
      if (hit) {
        if (s.id != null) subIdMap.set(s.id, hit.id);
        if (conflict === 'overwrite' && !hit._planned && (hit.order !== s.order)) { writes.sub_menus.push({ id: hit.id, parent_id: parent, name: s.name, order: s.order }); hit.order = s.order; c.overwritten++; }
        else if (conflict === 'overwrite' && !hit._planned) c.unchanged++;
        else { c.skipped++; note('skipped', `子栏目「${s.name}」已存在`); }
        continue;
      }
      const id = preferId('sub_menus', s.id);
      const row = { id, parent_id: parent, name: s.name, order: s.order, _planned: true };
      idx.sub_menus.set(key, row); subByKey.set(key, id); subByName.set(lc(s.name), id); subParent.set(id, parent); writes.sub_menus.push(row); c.inserted++;
      if (s.id != null) subIdMap.set(s.id, id);
    }
  }

  // 平铺列表专用：按名称确保栏目存在（不存在则创建）
  const ensureMenuByName = (name) => {
    const key = lc(name);
    if (menuByName.has(key)) return menuByName.get(key);
    const id = preferId('menus', null);
    const row = { id, name, order: id, _planned: true };
    idx.menus.set(key, row); menuByName.set(key, id); writes.menus.push(row);
    report.tables.menus.total++; report.tables.menus.inserted++;
    return id;
  };

  // ---- 卡片 ----
  if (needMenus('cards')) {
    for (const r of existing.cards) idx.cards.set(`${r.sub_menu_id ? 's' + r.sub_menu_id : 'm' + r.menu_id}|${lc(r.title)}|${urlKey(r.url)}`, r);
    for (const rawRow of (raw.cards || [])) {
      const c = report.tables.cards; c.total++;
      const card = sanitize.cards(rawRow);
      if (!card) { c.invalid++; note('invalid', '卡片：缺少标题或网址'); continue; }

      let subId; let menuId;
      if (card.sub_menu_id != null && subIdMap.has(card.sub_menu_id)) subId = subIdMap.get(card.sub_menu_id);
      else if (card.sub_menu_name) subId = subByName.get(lc(card.sub_menu_name));
      if (card.menu_id != null && menuIdMap.has(card.menu_id)) menuId = menuIdMap.get(card.menu_id);
      else if (card.menu_name) menuId = flat ? ensureMenuByName(card.menu_name) : menuByName.get(lc(card.menu_name));
      // 备份缺少栏目表（只导入了卡片）时，按 ID 直接对应到目标库已有栏目
      if (!(raw.menus || []).length) {
        if (subId === undefined && card.sub_menu_id != null && exSubs.some((s) => s.id === card.sub_menu_id)) subId = card.sub_menu_id;
        if (menuId === undefined && card.menu_id != null && exMenus.some((m) => m.id === card.menu_id)) menuId = card.menu_id;
      }
      if (subId === undefined && menuId === undefined) { c.invalid++; note('invalid', `卡片「${card.title}」找不到所属栏目`); continue; }
      const container = subId !== undefined ? 's' + subId : 'm' + menuId;
      const key = `${container}|${lc(card.title)}|${urlKey(card.url)}`;
      const hit = idx.cards.get(key);
      if (hit) {
        const changed = hit.logo_url !== card.logo_url || (hit.desc || '') !== card.desc || hit.order !== card.order || (hit.custom_logo_path || null) !== card.custom_logo_path;
        if (conflict === 'overwrite' && !hit._planned && changed) {
          Object.assign(hit, { logo_url: card.logo_url, desc: card.desc, order: card.order, custom_logo_path: card.custom_logo_path });
          writes.cards.push({ id: hit.id, menu_id: hit.menu_id, sub_menu_id: hit.sub_menu_id, title: hit.title, url: hit.url, logo_url: hit.logo_url, custom_logo_path: hit.custom_logo_path, desc: hit.desc, order: hit.order });
          c.overwritten++;
        } else if (conflict === 'overwrite' && !hit._planned) c.unchanged++;
        else { c.skipped++; note('skipped', `卡片「${card.title}」已存在`); }
        continue;
      }
      const id = preferId('cards', card.id);
      const row = {
        id, menu_id: menuId !== undefined ? menuId : null,
        sub_menu_id: subId !== undefined ? subId : null, title: card.title, url: card.url, logo_url: card.logo_url,
        custom_logo_path: card.custom_logo_path, desc: card.desc, order: card.order, _planned: true
      };
      idx.cards.set(key, row); writes.cards.push(row); c.inserted++;
    }
  }

  // ---- 广告 / 友链 / 账号 / 图片：结构简单，按各自自然键处理 ----
  const simple = (table, keyOf, onOverwrite, label) => {
    if (!selected.includes(table)) return;
    for (const r of existing[table]) idx[table].set(keyOf(r), r);
    for (const rawRow of (raw[table] || [])) {
      const c = report.tables[table]; c.total++;
      const row = sanitize[table](rawRow);
      if (!row) { c.invalid++; note('invalid', `${label}：缺少必要字段或格式不正确`); continue; }
      const key = keyOf(row);
      const hit = idx[table].get(key);
      if (hit) {
        const changed = onOverwrite.changed(hit, row);
        if (conflict === 'overwrite' && !hit._planned && changed) { Object.assign(hit, onOverwrite.apply(row)); writes[table].push({ ...hit }); c.overwritten++; }
        else if (conflict === 'overwrite' && !hit._planned) c.unchanged++;
        else { c.skipped++; note('skipped', `${label}「${row.title || row.username || row.filename || row.position}」已存在`); }
        continue;
      }
      const id = preferId(table, row.id);
      const nr = { ...row, id, _planned: true };
      idx[table].set(key, nr); writes[table].push(nr); c.inserted++;
    }
  };
  simple('ads', (r) => `${lc(r.position)}|${String(r.img).trim()}`, { changed: (a, b) => a.url !== b.url, apply: (b) => ({ url: b.url }) }, '广告');
  simple('friends', (r) => urlKey(r.url), { changed: (a, b) => a.title !== b.title || (a.logo || '') !== b.logo, apply: (b) => ({ title: b.title, logo: b.logo }) }, '友链');
  simple('users', (r) => lc(r.username), { changed: (a, b) => a.password !== b.password, apply: (b) => ({ password: b.password }) }, '账号');
  simple('uploads', (r) => r.filename, { changed: (a, b) => a.data !== b.data, apply: (b) => ({ mime: b.mime, size: b.size, data: b.data }) }, '图片');

  // ---- 汇总 ----
  report.totals = { inserted: 0, overwritten: 0, unchanged: 0, skipped: 0, invalid: 0 };
  for (const t of selected) for (const k of Object.keys(report.totals)) report.totals[k] += report.tables[t][k];
  report.selectedTables = selected;
  if (mode === 'replace') report.warnings.push(`替换模式：将先清空 ${selected.join('、')}，再写入备份内容。`);

  if (dryRun) return report;

  // ---- 写入（单个 batch = 事务） ----
  const stmts = [];
  if (mode === 'replace') for (const t of [...selected].reverse()) stmts.push(db.prepare(`DELETE FROM ${q(t)}`));
  for (const t of TABLE_ORDER) {
    if (!selected.includes(t) || !writes[t].length) continue;
    const cols = TABLES[t].cols;
    stmts.push(...buildInserts(db, t, cols, writes[t], { conflictKey: 'id' }));
  }
  if (stmts.length) {
    if (stmts.length <= MAX_BATCH) await db.batch(stmts);
    else {
      report.atomic = false;
      report.warnings.push('数据量较大，已分多批写入（不再是单个事务）。');
      for (let i = 0; i < stmts.length; i += MAX_BATCH) await db.batch(stmts.slice(i, i + MAX_BATCH));
    }
  }
  await setSetting(db, 'last_import', { at: new Date().toISOString(), source: options.source || 'file', mode, conflict, totals: report.totals });
  return report;
}

/** 轻量校验：给文件上传后“先看一眼里面有什么”用 */
export function summarizePayload(payload) {
  const { tables, flat, warnings } = normalizePayload(payload);
  const counts = {};
  for (const t of Object.keys(tables)) counts[t] = tables[t].length;
  const meta = payload && !Array.isArray(payload) ? { exportedAt: payload.exportedAt || null, version: payload.version || null, engine: payload.engine || null } : {};
  return { counts, flat, warnings, meta };
}

export { base64ToBytes };
