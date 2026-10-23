// 主题管理：访客自己的选择保存在浏览器 localStorage；没选过时使用站点默认主题（管理员在后台设置）。
import { ref } from 'vue';

export const THEMES = [
  { id: 'default', name: '经典', desc: '原版配色', colors: ['#399dff', '#1f2a44', '#6b7280'] },
  { id: 'ocean', name: '海洋蓝', desc: '深海 · 水光', colors: ['#4fe3ff', '#0ea5e9', '#1d4ed8'] },
  { id: 'rainbow', name: '彩虹', desc: '色相流动', colors: ['#ff3d81', '#ffe53d', '#3dc8ff'] },
  { id: 'rose', name: '玫瑰', desc: '浪漫 · 柔光', colors: ['#ff8fc0', '#e11d79', '#7a1244'] },
  { id: 'forest', name: '山林', desc: '墨绿 · 薄雾', colors: ['#72f0a8', '#16a34a', '#0f5132'] },
  { id: 'sunset', name: '晚霞', desc: '橙红 · 紫', colors: ['#ffb454', '#e11d48', '#a21caf'] },
  { id: 'sunrise', name: '朝阳', desc: '金橙 · 晨光', colors: ['#ffd36b', '#fb7185', '#60a5fa'] }
];

const KEY = 'nav-theme';
const current = ref('default');
let initialized = false;

const valid = (id) => THEMES.some((t) => t.id === id);

export function applyTheme(id) {
  const theme = valid(id) ? id : 'default';
  current.value = theme;
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(id) {
  applyTheme(id);
  try { localStorage.setItem(KEY, current.value); } catch (e) { /* 隐私模式下可能不可用 */ }
}

/** 应用启动时调用：优先用访客自己的选择，否则取站点默认主题 */
export async function initTheme() {
  if (initialized) return;
  initialized = true;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  if (saved && valid(saved)) { applyTheme(saved); return; }
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data && valid(data.defaultTheme)) applyTheme(data.defaultTheme);
    }
  } catch (e) { /* 取不到就保持默认 */ }
}

export function useTheme() {
  return { current, themes: THEMES, setTheme, initTheme };
}
