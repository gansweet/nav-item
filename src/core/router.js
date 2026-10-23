// 极简路由：按 方法 + 路径模式 匹配，支持 :param 与 * 通配（末尾）
export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, ...handlers) {
    const segs = pattern.split('/').filter(Boolean);
    this.routes.push({ method, segs, handlers });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }

  match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const params = {};
      let ok = true;
      const wild = r.segs.length && r.segs[r.segs.length - 1] === '*';
      const need = wild ? r.segs.length - 1 : r.segs.length;
      if (wild ? parts.length < need : parts.length !== need) continue;
      for (let i = 0; i < need; i++) {
        const s = r.segs[i];
        if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(parts[i]);
        else if (s !== parts[i]) { ok = false; break; }
      }
      if (!ok) continue;
      if (wild) params['*'] = parts.slice(need).map(decodeURIComponent).join('/');
      return { handlers: r.handlers, params };
    }
    return null;
  }
}
