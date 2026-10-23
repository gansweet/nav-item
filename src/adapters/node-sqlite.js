// Node 端的 D1 兼容适配器：基于 Node 内置的 node:sqlite（Node >= 22.13，无需编译原生模块）。
// 对外暴露与 Cloudflare D1 相同的 prepare().bind().first()/all()/run()/raw() 以及 batch() 接口，
// 这样同一份业务代码可以同时跑在 Workers(D1) 和 Node(SQLite 文件) 上。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const READ_RE = /^\s*(select|with|pragma|explain|values)\b/i;
const plain = (row) => (row && typeof row === 'object' ? { ...row } : row);
const norm = (v) => (typeof v === 'bigint' ? Number(v) : v);

class Statement {
  constructor(owner, sql, args = []) { this.owner = owner; this.sql = sql; this.args = args; }

  bind(...args) {
    for (const a of args) {
      if (a === undefined) throw new Error('D1_TYPE_ERROR: Type \'undefined\' not supported for value \'undefined\'');
    }
    return new Statement(this.owner, this.sql, args);
  }

  _exec() {
    const stmt = this.owner.raw.prepare(this.sql);
    if (READ_RE.test(this.sql)) {
      const rows = stmt.all(...this.args).map((r) => {
        const o = plain(r);
        for (const k of Object.keys(o)) o[k] = norm(o[k]);
        return o;
      });
      return { results: rows, success: true, meta: { changes: 0, last_row_id: 0, rows_read: rows.length, rows_written: 0 } };
    }
    const info = stmt.run(...this.args);
    return {
      results: [], success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid), rows_read: 0, rows_written: Number(info.changes) }
    };
  }

  async first(col) {
    const stmt = this.owner.raw.prepare(this.sql);
    const row = stmt.get(...this.args);
    if (!row) return null;
    const o = plain(row);
    for (const k of Object.keys(o)) o[k] = norm(o[k]);
    return col ? o[col] : o;
  }
  async all() { return this._exec(); }
  async run() { return this._exec(); }
  async raw() { return this._exec().results.map((r) => Object.values(r)); }
}

export class NodeSqliteDb {
  constructor(raw, file) { this.raw = raw; this.file = file; this.engine = 'node-sqlite'; }

  prepare(sql) { return new Statement(this, sql); }

  /** 与 D1 一致：batch 在一个事务内执行，任何一条失败则整体回滚 */
  async batch(stmts) {
    this.raw.exec('BEGIN');
    try {
      const out = stmts.map((s) => s._exec());
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      try { this.raw.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  }

  async exec(sql) { this.raw.exec(sql); return { count: 1, duration: 0 }; }

  /** 数据库文件大小等运行信息（供“数据库管理”状态页使用） */
  info() {
    const pc = this.raw.prepare('PRAGMA page_count').get();
    const ps = this.raw.prepare('PRAGMA page_size').get();
    const ver = this.raw.prepare('SELECT sqlite_version() AS v').get();
    return {
      engine: 'node-sqlite',
      file: this.file,
      sqliteVersion: ver.v,
      sizeBytes: Number(pc.page_count) * Number(ps.page_size)
    };
  }

  close() { try { this.raw.close(); } catch { /* ignore */ } }
}

export function openNodeDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON');   // 与 D1 行为一致（D1 始终强制外键）
  raw.exec('PRAGMA busy_timeout = 5000');
  return new NodeSqliteDb(raw, file);
}
