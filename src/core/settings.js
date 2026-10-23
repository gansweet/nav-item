// settings 表：简单的键值存储（站点默认主题、JWT 密钥、远程连接配置、导入导出记录等）
export async function getSetting(db, key, fallback = null) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}

export async function getJsonSetting(db, key, fallback = null) {
  const v = await getSetting(db, key, null);
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

export async function setSetting(db, key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, v, new Date().toISOString()).run();
}

export async function deleteSetting(db, key) {
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
}
