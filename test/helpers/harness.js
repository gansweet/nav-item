import { openNodeDb } from '../../src/adapters/node-sqlite.js';
import { D1Shim } from './d1-shim.js';
import { handle } from '../../src/core/app.js';
import { _resetSchemaState } from '../../src/core/schema.js';

export const ADAPTERS = {
  'node-sqlite': () => openNodeDb(':memory:'),
  'd1-shim': () => new D1Shim()
};

/** 创建一个测试应用：直接调用 handle(request, env)，不经过网络 */
export function makeApp(db, envExtra = {}) {
  _resetSchemaState();
  const env = { ADMIN_USERNAME: 'amos', ADMIN_PASSWORD: 'sweet', ALLOW_PRIVATE_NETWORK: 'true', ...envExtra, DB: db };
  const app = {
    db, env, token: null,
    async call(method, path, { body, token, headers = {}, raw = false, form } = {}) {
      const h = { ...headers };
      const t = token === undefined ? app.token : token;
      if (t) h.authorization = `Bearer ${t}`;
      let payload;
      if (form) payload = form;
      else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await handle(new Request('http://nav.test' + path, { method, headers: h, body: payload }), env);
      if (raw) return res;
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    },
    async login(username = env.ADMIN_USERNAME, password = env.ADMIN_PASSWORD) {
      const r = await app.call('POST', '/api/login', { body: { username, password }, token: null });
      if (r.status === 200) app.token = r.data.token;
      return r;
    }
  };
  return app;
}
