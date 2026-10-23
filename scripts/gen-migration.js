// 由 src/core/schema.js 生成 migrations/0001_init.sql（供 wrangler d1 migrations apply / d1 execute 使用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DDL } from '../src/core/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const header = `-- nav-item 初始化表结构（由 npm run gen:migration 自动生成，请勿手改；修改 src/core/schema.js 后重新生成）
-- 应用方式：wrangler d1 migrations apply nav-item-db --remote
-- 说明：即使不执行本迁移，应用在首次访问时也会自动建表并写入默认数据（惰性初始化）。

`;
const out = header + DDL.map((s) => s + ';').join('\n\n') + '\n';
fs.mkdirSync(path.join(root, 'migrations'), { recursive: true });
fs.writeFileSync(path.join(root, 'migrations', '0001_init.sql'), out);
console.log('已生成 migrations/0001_init.sql');
