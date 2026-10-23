<template>
  <div ref="root" class="theme-switcher" :class="[variant, { open: open }]">
    <button class="ts-btn" type="button" :title="'切换主题（当前：' + currentName + '）'" aria-haspopup="true" :aria-expanded="open" @click="open = !open">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
        <circle cx="7.5" cy="11" r="1" fill="currentColor" />
        <circle cx="10.5" cy="7" r="1" fill="currentColor" />
        <circle cx="15" cy="7" r="1" fill="currentColor" />
      </svg>
      <span v-if="variant === 'admin'" class="ts-label">主题</span>
    </button>

    <transition name="ts-pop">
      <div v-if="open" class="ts-pop" role="menu">
        <div class="ts-title">主题皮肤</div>
        <button
          v-for="t in themes"
          :key="t.id"
          type="button"
          class="ts-item"
          :class="{ active: t.id === current }"
          role="menuitemradio"
          :aria-checked="t.id === current"
          @click="pick(t.id)"
        >
          <span class="ts-swatch" :style="swatchStyle(t)"></span>
          <span class="ts-name">{{ t.name }}</span>
          <span class="ts-desc">{{ t.desc }}</span>
          <svg v-if="t.id === current" class="ts-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
        </button>
        <div v-if="canSetDefault" class="ts-default">
          <button type="button" class="ts-default-btn" :disabled="current === siteDefault || saving" @click="saveDefault">
            {{ current === siteDefault ? '✓ 当前主题已是站点默认' : (saving ? '保存中…' : '设为站点默认主题') }}
          </button>
          <div class="ts-hint">访客第一次打开时使用站点默认主题；访客自己选择的主题会保存在其浏览器里。</div>
          <div v-if="message" class="ts-msg">{{ message }}</div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useTheme } from '../composables/useTheme';
import { getSettings, updateSettings } from '../api';

const props = defineProps({
  variant: { type: String, default: 'home' },        // home：首页悬浮按钮；admin：后台顶栏按钮
  canSetDefault: { type: Boolean, default: false }   // 后台可以把当前主题设为站点默认
});

const { current, themes, setTheme } = useTheme();
const open = ref(false);
const root = ref(null);
const siteDefault = ref('');
const saving = ref(false);
const message = ref('');

const currentName = computed(() => {
  const t = themes.find((x) => x.id === current.value);
  return t ? t.name : '';
});

function swatchStyle(t) {
  return { background: 'linear-gradient(135deg, ' + t.colors.join(', ') + ')' };
}

function pick(id) {
  setTheme(id);
  message.value = '';
}

async function saveDefault() {
  saving.value = true;
  message.value = '';
  try {
    const res = await updateSettings({ defaultTheme: current.value });
    siteDefault.value = res.data.defaultTheme;
    message.value = '已保存';
  } catch (e) {
    message.value = '保存失败：' + ((e.response && e.response.data && e.response.data.error) || e.message);
  } finally {
    saving.value = false;
  }
}

function onDocClick(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false;
}
function onKey(e) {
  if (e.key === 'Escape') open.value = false;
}

onMounted(async () => {
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);
  if (props.canSetDefault) {
    try { siteDefault.value = (await getSettings()).data.defaultTheme; } catch (e) { /* 忽略 */ }
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<style scoped>
.theme-switcher { position: relative; }

.ts-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  font-family: inherit;
}

/* ---------- 首页：右上角悬浮的圆形按钮 ---------- */
.theme-switcher.home { position: fixed; top: 0.9rem; right: 1rem; z-index: 120; }
.home .ts-btn {
  width: 40px;
  height: 40px;
  padding: 0;
  border-radius: 50%;
  color: #fff;
  background: var(--switcher-bg);
  border: 1px solid rgba(255, 255, 255, 0.28);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}
.home .ts-btn:hover { transform: rotate(-14deg) scale(1.08); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3); }
.home .ts-pop {
  position: absolute;
  top: 48px;
  right: 0;
  width: 236px;
  padding: 8px;
  border-radius: 16px;
  color: #fff;
  background: rgba(22, 26, 38, 0.82);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}
.home .ts-title { color: rgba(255, 255, 255, 0.6); }
.home .ts-item { color: #fff; }
.home .ts-item:hover { background: rgba(255, 255, 255, 0.1); }
.home .ts-item.active { background: rgb(var(--accent-rgb) / 0.22); color: var(--accent); }
.home .ts-desc { color: rgba(255, 255, 255, 0.5); }
.home .ts-default { border-top: 1px solid rgba(255, 255, 255, 0.12); }

/* ---------- 后台：顶栏里的按钮 ---------- */
.theme-switcher.admin { display: inline-block; }
.admin .ts-btn {
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  color: var(--adm-primary);
  background: #fff;
  border: 1px solid #e3e6ef;
  font-size: 14px;
  font-weight: 600;
}
.admin .ts-btn:hover { background: var(--adm-primary-soft); }
.admin .ts-pop {
  position: absolute;
  top: 44px;
  right: 0;
  width: 250px;
  padding: 8px;
  border-radius: 14px;
  color: #222;
  background: #fff;
  border: 1px solid #e3e6ef;
  box-shadow: 0 14px 40px rgba(20, 30, 60, 0.18);
  z-index: 300;
}
.admin .ts-title { color: #8a93a6; }
.admin .ts-item { color: #222; }
.admin .ts-item:hover { background: #f5f6fa; }
.admin .ts-item.active { background: var(--adm-primary-soft); color: var(--adm-primary); }
.admin .ts-desc { color: #8a93a6; }
.admin .ts-default { border-top: 1px solid #eef0f6; }

/* ---------- 共用 ---------- */
.ts-title { padding: 4px 10px 8px; font-size: 12px; letter-spacing: 1px; }
.ts-item {
  display: grid;
  grid-template-columns: 30px auto 1fr 18px;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  text-align: left;
  transition: background 0.15s ease;
}
.ts-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55), 0 2px 6px rgba(0, 0, 0, 0.25);
}
.ts-name { font-weight: 600; }
.ts-desc { font-size: 12px; justify-self: end; }
.ts-check { justify-self: end; }
.ts-default { margin-top: 6px; padding: 10px 6px 4px; }
.ts-default-btn {
  width: 100%;
  padding: 8px 10px;
  border: 1px dashed currentColor;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.ts-default-btn:disabled { opacity: 0.6; cursor: default; }
.ts-hint { margin-top: 6px; font-size: 12px; opacity: 0.6; line-height: 1.5; }
.ts-msg { margin-top: 4px; font-size: 12px; }

.ts-pop-enter-active, .ts-pop-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.ts-pop-enter-from, .ts-pop-leave-to { opacity: 0; transform: translateY(-6px) scale(0.98); }

@media (max-width: 768px) {
  .theme-switcher.home { top: auto; bottom: 1rem; right: 1rem; }
  .home .ts-pop { top: auto; bottom: 48px; }
}
</style>
