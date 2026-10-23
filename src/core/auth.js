// 认证：HS256 JWT（WebCrypto）+ 密码哈希（PBKDF2-SHA256，兼容旧版 bcrypt 哈希）
import { HttpError } from './http.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- base64 / base64url ----------
export function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64url = (bytes) => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlToBytes = (s) => base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ---------- JWT (HS256) ----------
async function hmacKey(secret, usages) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

export async function signJwt(payload, secret, expiresInSec = 7200) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec })));
  const data = `${header}.${body}`;
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, ['sign']), enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

export async function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed');
  const [h, p, s] = parts;
  let header;
  try { header = JSON.parse(dec.decode(b64urlToBytes(h))); } catch { throw new Error('malformed'); }
  if (header.alg !== 'HS256') throw new Error('alg');
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, ['verify']), b64urlToBytes(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error('signature');
  let payload;
  try { payload = JSON.parse(dec.decode(b64urlToBytes(p))); } catch { throw new Error('malformed'); }
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) throw new Error('expired');
  return payload;
}

// ---------- 密码哈希 ----------
// Workers 的 PBKDF2 迭代次数上限为 100000，这里取上限。
const PBKDF2_ITER = 100000;

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

// 旧版（bcrypt / bcryptjs）生成的哈希形如 $2a$/$2b$/$2y$。按需动态加载 bcryptjs，
// 登录成功后会自动升级为 PBKDF2，因此该依赖只在迁移旧库时才会被用到。
let bcryptLoader = () => import('bcryptjs');
export function setBcryptLoader(fn) { bcryptLoader = fn; }

export const isLegacyBcrypt = (stored) => /^\$2[aby]\$/.test(String(stored || ''));

/** @returns {Promise<{ok:boolean, upgrade:boolean}>} upgrade=true 表示应把哈希重写为 PBKDF2 */
export async function verifyPassword(password, stored) {
  stored = String(stored || '');
  if (stored.startsWith('pbkdf2$')) {
    const [, iterStr, saltB64, hashB64] = stored.split('$');
    const iter = parseInt(iterStr, 10);
    if (!iter || !saltB64 || !hashB64) return { ok: false, upgrade: false };
    const got = await pbkdf2(password, base64ToBytes(saltB64), iter);
    return { ok: safeEqual(got, base64ToBytes(hashB64)), upgrade: false };
  }
  if (isLegacyBcrypt(stored)) {
    try {
      const mod = await bcryptLoader();
      const compare = mod.compare || (mod.default && mod.default.compare);
      const ok = await compare(password, stored);
      return { ok: !!ok, upgrade: !!ok };
    } catch (e) {
      console.error('[auth] 无法校验旧版 bcrypt 哈希（bcryptjs 加载失败或超出 CPU 限制）:', e && e.message);
      return { ok: false, upgrade: false };
    }
  }
  return { ok: false, upgrade: false };
}

// ---------- 鉴权中间件 ----------
export async function requireAuth(ctx) {
  const header = ctx.request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) throw new HttpError(401, { error: '未授权' });
  try {
    ctx.user = await verifyJwt(header.slice(7), await ctx.jwtSecret());
  } catch {
    throw new HttpError(401, { error: '无效token' });
  }
}
