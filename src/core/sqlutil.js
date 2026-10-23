// SQL 小工具：标识符转义、多行 INSERT / UPSERT 的分块构造（D1 单条语句最多 100 个绑定参数）
export const MAX_PARAMS = 100;

export const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;

/**
 * 构造多行 INSERT 语句（可选 ON CONFLICT(pk) DO UPDATE）。
 * @returns {Array} 预编译语句数组，可直接交给 db.batch()
 */
export function buildInserts(db, table, cols, rows, { conflictKey = null, updateCols = null, orIgnore = false } = {}) {
  if (!rows.length) return [];
  const perStmt = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
  const out = [];
  for (let i = 0; i < rows.length; i += perStmt) {
    const slice = rows.slice(i, i + perStmt);
    const placeholders = slice.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    let sql = `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${q(table)} (${cols.map(q).join(',')}) VALUES ${placeholders}`;
    if (conflictKey) {
      const up = (updateCols || cols.filter((c) => c !== conflictKey));
      sql += ` ON CONFLICT(${q(conflictKey)}) DO UPDATE SET ${up.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`;
    }
    const params = [];
    for (const r of slice) for (const c of cols) params.push(r[c] === undefined ? null : r[c]);
    out.push(db.prepare(sql).bind(...params));
  }
  return out;
}

/** SQL 字面量转义（仅用于导出 .sql 文件） */
export function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
}
