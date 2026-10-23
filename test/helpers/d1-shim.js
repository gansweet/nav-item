// 用 node:sqlite 模拟 Cloudflare D1 的 Worker 绑定 API，并刻意加上 D1 的限制，
// 用来在沙箱里检验“同一份代码在 D1 的约束下是否可行”。
// 注意：这是一个行为近似的模拟，不是 workerd / Miniflare 真实运行时。
import { DatabaseSync } from 'node:sqlite';

const READ_RE = /^\s*(select|with|pragma|explain|values)\b/i;
// D1 文档列出的受支持 PRAGMA（子集）
const PRAGMA_OK = /^\s*pragma\s+(table_list|table_info|table_xinfo|index_list|index_info|index_xinfo|foreign_key_list|foreign_key_check|foreign_keys|quick_check|integrity_check|optimize|defer_foreign_keys|legacy_alter_table|recursive_triggers|reverse_unordered_selects)\b/i;

class Stmt {
  constructor(owner, sql, args = []) {
    if (sql.length > 100_000) throw new Error('D1_ERROR: statement too long (max 100KB)');
    if (/;\s*\S/.test(sql.trim())) throw new Error('D1_ERROR: multiple statements are not supported in prepare()');
    if (/^\s*pragma/i.test(sql) && !PRAGMA_OK.test(sql)) throw new Error('D1_ERROR: SQLITE_AUTH: not authorized (unsupported PRAGMA)');
    this.owner = owner; this.sql = sql; this.args = args;
  }
  bind(...args) {
    if (args.length > 100) throw new Error('D1_ERROR: too many SQL variables (max 100 bound parameters)');
    for (const a of args) if (a === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
    return new Stmt(this.owner, this.sql, args);
  }
  _run() {
    this.owner.queries++;
    const st = this.owner.raw.prepare(this.sql);
    if (READ_RE.test(this.sql)) {
      const results = st.all(...this.args).map((r) => { const o = { ...r }; for (const k of Object.keys(o)) if (typeof o[k] === 'bigint') o[k] = Number(o[k]); return o; });
      return { results, success: true, meta: { duration: 0.1, changes: 0, last_row_id: 0, rows_read: results.length, rows_written: 0, size_after: this.owner.size() } };
    }
    const i = st.run(...this.args);
    return { results: [], success: true, meta: { duration: 0.1, changes: Number(i.changes), last_row_id: Number(i.lastInsertRowid), rows_read: 0, rows_written: Number(i.changes), size_after: this.owner.size() } };
  }
  async first(col) {
    const r = (await this.all()).results[0];
    if (!r) return null;
    return col ? r[col] : r;
  }
  async all() { return this._run(); }
  async run() { return this._run(); }
  async raw() { return this._run().results.map((r) => Object.values(r)); }
}

export class D1Shim {
  constructor() {
    this.raw = new DatabaseSync(':memory:');
    this.raw.exec('PRAGMA foreign_keys = ON');   // D1 始终强制外键
    this.queries = 0;     // 执行的语句总数（batch 内每条都计）
    this.batches = 0;     // batch 调用次数
  }
  size() { const pc = this.raw.prepare('PRAGMA page_count').get(); const ps = this.raw.prepare('PRAGMA page_size').get(); return Number(pc.page_count) * Number(ps.page_size); }
  prepare(sql) { return new Stmt(this, sql); }
  async batch(stmts) {
    this.batches++;
    this.raw.exec('BEGIN');
    try { const out = stmts.map((s) => s._run()); this.raw.exec('COMMIT'); return out; }
    catch (e) { try { this.raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  }
  async exec() { throw new Error('exec() is not used by this app'); }
}
