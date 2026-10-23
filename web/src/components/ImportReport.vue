<template>
  <div v-if="report" class="report">
    <div class="rp-head">
      <span class="rp-badge" :class="report.dryRun ? 'preview' : 'done'">{{ report.dryRun ? '预览（尚未写入）' : '导入完成' }}</span>
      <span class="rp-mode">{{ report.mode === 'replace' ? '替换模式' : '合并模式' }} · {{ report.conflict === 'overwrite' ? '覆盖重复记录' : '跳过重复记录' }}</span>
    </div>

    <div class="rp-totals">
      <div class="rp-chip ok"><b>{{ report.totals.inserted }}</b><span>新增</span></div>
      <div class="rp-chip warn"><b>{{ report.totals.overwritten }}</b><span>覆盖</span></div>
      <div class="rp-chip"><b>{{ report.totals.unchanged }}</b><span>无变化</span></div>
      <div class="rp-chip"><b>{{ report.totals.skipped }}</b><span>跳过</span></div>
      <div class="rp-chip bad"><b>{{ report.totals.invalid }}</b><span>无效</span></div>
    </div>

    <div class="rp-scroll">
      <table class="rp-table">
        <thead>
          <tr><th>数据表</th><th>备份中</th><th>新增</th><th>覆盖</th><th>无变化</th><th>跳过</th><th>无效</th></tr>
        </thead>
        <tbody>
          <tr v-for="(c, t) in report.tables" :key="t">
            <td class="rp-name">{{ labels[t] || t }}</td>
            <td>{{ c.total }}</td>
            <td class="num ok">{{ c.inserted }}</td>
            <td class="num warn">{{ c.overwritten }}</td>
            <td>{{ c.unchanged }}</td>
            <td>{{ c.skipped }}</td>
            <td class="num bad">{{ c.invalid }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <ul v-if="report.warnings && report.warnings.length" class="rp-warn">
      <li v-for="(w, i) in report.warnings" :key="i">⚠ {{ w }}</li>
    </ul>

    <details v-if="hasSamples" class="rp-samples">
      <summary>查看示例（跳过 / 无效的记录）</summary>
      <div v-if="report.samples.skipped.length" class="rp-sample-group">
        <div class="rp-sample-title">已跳过</div>
        <div v-for="(s, i) in report.samples.skipped" :key="'s' + i" class="rp-sample">{{ s }}</div>
      </div>
      <div v-if="report.samples.invalid.length" class="rp-sample-group">
        <div class="rp-sample-title">无效</div>
        <div v-for="(s, i) in report.samples.invalid" :key="'i' + i" class="rp-sample">{{ s }}</div>
      </div>
    </details>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({ report: { type: Object, default: null } });

const labels = {
  menus: '栏目', sub_menus: '子栏目', cards: '导航卡片', ads: '广告', friends: '友情链接', users: '管理员账号', uploads: '上传的图片'
};

const hasSamples = computed(() => {
  const s = props.report && props.report.samples;
  return !!s && ((s.skipped && s.skipped.length) || (s.invalid && s.invalid.length));
});
</script>

<style scoped>
.report { margin-top: 14px; padding: 16px; background: #f8f9fc; border: 1px solid #e3e6ef; border-radius: 14px; }
.rp-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.rp-badge { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.rp-badge.preview { background: #fff3cd; color: #8a6100; }
.rp-badge.done { background: #d4f5df; color: #0f6b34; }
.rp-mode { font-size: 13px; color: #667085; }
.rp-totals { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 12px; }
.rp-chip { display: flex; flex-direction: column; align-items: center; padding: 10px 4px; background: #fff; border: 1px solid #e3e6ef; border-radius: 12px; }
.rp-chip b { font-size: 22px; line-height: 1.2; color: #344054; }
.rp-chip span { font-size: 12px; color: #8a93a6; }
.rp-chip.ok b { color: #12a150; }
.rp-chip.warn b { color: #d97706; }
.rp-chip.bad b { color: #dc2626; }
.rp-scroll { overflow-x: auto; }
.rp-table { width: 100%; border-collapse: collapse; font-size: 14px; background: #fff; border-radius: 10px; overflow: hidden; }
.rp-table th, .rp-table td { padding: 8px 10px; text-align: center; border-bottom: 1px solid #eef0f6; white-space: nowrap; }
.rp-table th { background: #f1f3f9; color: #667085; font-weight: 600; }
.rp-table .rp-name { text-align: left; font-weight: 600; }
.rp-table .num.ok { color: #12a150; font-weight: 700; }
.rp-table .num.warn { color: #d97706; font-weight: 700; }
.rp-table .num.bad { color: #dc2626; font-weight: 700; }
.rp-warn { margin: 12px 0 0; padding: 10px 14px; list-style: none; background: #fff8e6; border: 1px solid #ffe3a3; border-radius: 10px; color: #8a6100; font-size: 13px; line-height: 1.7; }
.rp-samples { margin-top: 10px; font-size: 13px; color: #475467; }
.rp-samples summary { cursor: pointer; color: var(--adm-primary); }
.rp-sample-group { margin-top: 8px; }
.rp-sample-title { font-weight: 700; margin-bottom: 4px; }
.rp-sample { padding: 2px 0; color: #667085; }
@media (max-width: 640px) {
  .rp-totals { grid-template-columns: repeat(3, 1fr); }
}
</style>
