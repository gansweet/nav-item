// 运行配置（Node 自托管）。优先级：真实环境变量 > .env 文件 > 默认值。
// Cloudflare 部署不使用本文件，改用 wrangler.toml 的 [vars] 与 Secrets（详见 README）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

// 极简 .env 解析（不引入 dotenv 依赖）
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

export default {
  admin: {
    username: process.env.ADMIN_USERNAME || 'amos',
    password: process.env.ADMIN_PASSWORD || 'sweet'
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    jwtSecret: process.env.JWT_SECRET || ''   // 留空则自动生成并保存在数据库中
  },
  // SQLite 数据库文件；Docker 部署请挂载 /app/database
  dbPath: process.env.DB_PATH || path.join(ROOT, 'database', 'nav.db'),
  // 旧版本把上传图片存在磁盘目录里，这里继续兼容读取
  legacyUploadsDir: process.env.UPLOADS_DIR || path.join(ROOT, 'uploads')
};
