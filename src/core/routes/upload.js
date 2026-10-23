// 图片上传：Workers 没有本地磁盘，因此图片以 base64 存入 D1 的 uploads 表，再由 /uploads/:name 提供访问。
// 单行上限 2MB（D1 限制），base64 会膨胀约 1.37 倍，所以单张图片限制 1MB。
import { json, HttpError } from '../http.js';
import { requireAuth, bytesToBase64, base64ToBytes } from '../auth.js';

export const MAX_UPLOAD_BYTES = 1024 * 1024;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif'
};

export function registerUpload(r) {
  // 注意：原项目的上传接口没有鉴权，改为需要登录，避免公网部署后被人往数据库里灌数据
  r.post('/api/upload', requireAuth, async (ctx) => {
    let form;
    try { form = await ctx.request.formData(); } catch { throw new HttpError(400, { error: '请使用 multipart/form-data 上传' }); }
    const file = form.get('logo');
    if (!file || typeof file === 'string') throw new HttpError(400, { error: 'No file uploaded' });
    const ext = (String(file.name || '').split('.').pop() || '').toLowerCase();
    const mime = MIME[ext];
    if (!mime) throw new HttpError(400, { error: '不支持的图片格式（支持 png/jpg/gif/webp/ico/svg/avif）' });
    const buf = new Uint8Array(await file.arrayBuffer());
    if (buf.length > MAX_UPLOAD_BYTES) throw new HttpError(413, { error: '图片不能超过 1MB' });

    let filename = Date.now() + '.' + ext;
    const exists = await ctx.db.prepare('SELECT 1 AS x FROM uploads WHERE filename = ?').bind(filename).first();
    if (exists) filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    await ctx.db.prepare('INSERT INTO uploads (filename, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(filename, mime, buf.length, bytesToBase64(buf), new Date().toISOString()).run();
    return json({ filename, url: '/uploads/' + filename });
  });
}

/** GET /uploads/:name —— 先查数据库；找不到返回 null，由入口决定是否回退到静态文件 / 旧版磁盘目录 */
export async function serveUpload(ctx, name) {
  const row = await ctx.db.prepare('SELECT mime, data FROM uploads WHERE filename = ?').bind(name).first();
  if (!row) return null;
  return new Response(base64ToBytes(row.data), {
    headers: {
      'Content-Type': row.mime,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      // SVG 同源直接打开时可能执行脚本，用 CSP 沙箱化
      'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
    }
  });
}
