// 内置的 7 个 emoji 风格 SVG logo（位于 public/logos/）。
// · 卡片没有填写 logo 链接时，按“标题 + 网址”的哈希稳定地分配其中一个（看起来是随机的，但刷新页面不会变）。
// · 管理员也可以在「卡片管理」里手动指定其中任意一个。
export const BUILTIN_LOGOS = [
  { id: 'compass', name: '指南针', url: '/logos/compass.svg' },
  { id: 'globe', name: '地球', url: '/logos/globe.svg' },
  { id: 'rocket', name: '火箭', url: '/logos/rocket.svg' },
  { id: 'link', name: '链接', url: '/logos/link.svg' },
  { id: 'bookmark', name: '书签', url: '/logos/bookmark.svg' },
  { id: 'pin', name: '定位', url: '/logos/pin.svg' },
  { id: 'star', name: '星标', url: '/logos/star.svg' }
];

export function isBuiltinLogo(url) {
  return typeof url === 'string' && BUILTIN_LOGOS.some((l) => l.url === url);
}

// FNV-1a 32 位哈希
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 给没有 logo 的卡片稳定地挑一个内置 logo */
export function pickDefaultLogo(card) {
  const key = String((card && card.title) || '') + '|' + String((card && card.url) || '');
  return BUILTIN_LOGOS[hashString(key) % BUILTIN_LOGOS.length].url;
}

/** 卡片最终显示的 logo 地址 */
export function resolveLogo(card) {
  if (card && card.custom_logo_path) return '/uploads/' + card.custom_logo_path;
  const u = card && card.logo_url ? String(card.logo_url).trim() : '';
  return u || pickDefaultLogo(card);
}
