<template>
  <div class="logo-picker">
    <button ref="btn" type="button" class="lp-btn" title="选择内置 Logo（留空则自动分配）" @click="toggle">
      <img :src="previewSrc" alt="" class="lp-img" @error="onErr" />
      <span class="lp-caret">▾</span>
    </button>
    <Teleport to="body">
      <div v-if="open" ref="pop" class="lp-pop" :style="popStyle">
        <div class="lp-title">选择内置 Logo</div>
        <div class="lp-grid">
          <button
            v-for="l in logos"
            :key="l.id"
            type="button"
            class="lp-item"
            :class="{ active: modelValue === l.url }"
            :title="l.name"
            @click="choose(l.url)"
          >
            <img :src="l.url" :alt="l.name" />
            <span>{{ l.name }}</span>
          </button>
          <button type="button" class="lp-item lp-auto" :class="{ active: !modelValue }" title="清空链接，由系统自动分配" @click="choose('')">
            <span class="lp-dice">🎲</span>
            <span>自动</span>
          </button>
        </div>
        <div class="lp-hint">没有填写 Logo 链接的卡片，系统会自动分配一个内置 Logo。</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { BUILTIN_LOGOS, resolveLogo, pickDefaultLogo } from '../utils/logos';

const props = defineProps({
  modelValue: { type: String, default: '' },
  card: { type: Object, default: null }       // 用于计算“自动分配”时的预览（标题 + 网址）
});
const emit = defineEmits(['update:modelValue', 'change']);

const logos = BUILTIN_LOGOS;
const open = ref(false);
const btn = ref(null);
const pop = ref(null);
const popStyle = ref({});

const previewSrc = computed(() => resolveLogo({ ...(props.card || {}), logo_url: props.modelValue || '' }));

function onErr(e) {
  if (e.target.dataset.fb === '1') return;
  e.target.dataset.fb = '1';
  e.target.src = pickDefaultLogo(props.card || {});
}

function toggle() {
  if (open.value) { open.value = false; return; }
  const r = btn.value.getBoundingClientRect();
  const width = 268;
  const height = 250;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  const below = window.innerHeight - r.bottom;
  const top = below > height + 12 ? r.bottom + 6 : Math.max(8, r.top - height - 6);
  popStyle.value = { top: top + 'px', left: left + 'px', width: width + 'px' };
  open.value = true;
}

function choose(url) {
  emit('update:modelValue', url);
  emit('change', url);
  open.value = false;
}

// 点击弹层外部时关闭（捕获阶段，避免被其它元素的 stopPropagation 吞掉）
function onPointerDown(e) {
  if (!open.value) return;
  const t = e.target;
  if ((pop.value && pop.value.contains(t)) || (btn.value && btn.value.contains(t))) return;
  open.value = false;
}
function close() { open.value = false; }

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('scroll', close, true);
  window.addEventListener('resize', close);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close);
});
</script>

<style scoped>
.logo-picker { display: inline-flex; }
.lp-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 34px;
  padding: 0 6px 0 4px;
  background: #fff;
  border: 1px solid #d0d7e2;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.lp-btn:hover { border-color: var(--adm-primary); box-shadow: 0 0 0 3px rgb(var(--adm-primary-rgb) / 0.12); }
.lp-img { width: 24px; height: 24px; object-fit: contain; border-radius: 6px; }
.lp-caret { font-size: 11px; color: #8a93a6; }

.lp-pop {
  position: fixed;
  z-index: 2000;
  padding: 12px;
  background: #fff;
  border: 1px solid #e3e6ef;
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(20, 30, 60, 0.22);
  color: #222;
}
.lp-title { font-size: 12px; font-weight: 600; letter-spacing: 1px; color: #8a93a6; margin-bottom: 8px; }
.lp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.lp-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 2px 6px;
  background: #f7f8fb;
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  font-size: 12px;
  color: #444;
  transition: transform 0.15s, background 0.15s, border-color 0.15s;
}
.lp-item:hover { transform: translateY(-2px); background: var(--adm-primary-soft); }
.lp-item.active { border-color: var(--adm-primary); background: var(--adm-primary-soft); }
.lp-item img { width: 36px; height: 36px; }
.lp-dice { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 26px; }
.lp-hint { margin-top: 10px; font-size: 12px; color: #8a93a6; line-height: 1.5; }
</style>
