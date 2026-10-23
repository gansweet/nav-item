// 出站请求防护（SSRF）：管理员可以让服务器去下载一个 URL 或连接远程数据库，
// 默认禁止指向内网 / 本机 / 云元数据地址的请求。局域网自托管需要时设置 ALLOW_PRIVATE_NETWORK=true。
import { HttpError } from './http.js';

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));

function isPrivateV4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateV6(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes(':')) return false;
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true;
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

export function assertPublicUrl(input, env = {}) {
  let u;
  try { u = new URL(String(input).trim()); } catch { throw new HttpError(400, { error: '网址格式不正确' }); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, { error: '只支持 http / https 网址' });
  if (truthy(env.ALLOW_PRIVATE_NETWORK)) return u;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') ||
      isPrivateV4(host) || isPrivateV6(host)) {
    throw new HttpError(400, { error: '出于安全考虑，默认禁止访问内网 / 本机地址。如确需访问，请设置环境变量 ALLOW_PRIVATE_NETWORK=true' });
  }
  return u;
}
