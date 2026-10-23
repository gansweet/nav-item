<template>
  <div class="db-manage">
    <!-- 顶部横幅 -->
    <div class="db-hero">
      <div class="hero-text">
        <h2 class="hero-title">数据库管理</h2>
        <p class="hero-sub">查看运行状态 · 导入 / 导出 · 云端下载 · Supabase 同步 · 数据浏览</p>
      </div>
      <div v-if="status" class="hero-badges">
        <span class="hero-badge">{{ engineLabel }}</span>
        <span class="hero-badge" :class="healthOk ? 'good' : 'bad'">{{ healthOk ? '● 运行正常' : '● 需要关注' }}</span>
      </div>
    </div>

    <!-- 提示条 -->
    <transition name="fade">
      <div v-if="toast.text" class="toast" :class="toast.type" @click="toast.text = ''">{{ toast.text }}</div>
    </transition>

    <!-- 标签页 -->
    <div class="tabs" role="tablist">
      <button v-for="t in tabs" :key="t.id" type="button" class="tab" :class="{ active: tab === t.id }" role="tab" @click="tab = t.id">
        <span class="tab-icon">{{ t.icon }}</span>{{ t.label }}
      </button>
    </div>

    <!-- ================= 概览 ================= -->
    <section v-if="tab === 'overview'" class="panel">
      <div class="panel-head">
        <h3>运行状态</h3>
        <div class="panel-actions">
          <button class="btn ghost" :disabled="statusLoading" @click="loadStatus">{{ statusLoading ? '刷新中…' : '刷新' }}</button>
          <button class="btn ghost" :disabled="!status" @click="doOptimize" title="执行 PRAGMA optimize，更新查询优化器统计信息">优化</button>
        </div>
      </div>

      <div v-if="!status" class="empty">{{ statusLoading ? '正在读取数据库状态…' : '暂无状态信息' }}</div>

      <template v-else>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-label">数据库引擎</div>
            <div class="stat-value small">{{ engineLabel }}</div>
            <div class="stat-note">运行于 {{ status.runtime }} · SQLite {{ status.sqliteVersion }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">数据库大小</div>
            <div class="stat-value">{{ fmtBytes(status.sizeBytes) }}</div>
            <div class="stat-note">{{ status.totals.tables }} 张表 · {{ status.totals.indexes }} 个索引</div>
          </div>
          <div class="stat">
            <div class="stat-label">记录总数</div>
            <div class="stat-value">{{ status.totals.rows }}</div>
            <div class="stat-note">表结构版本 v{{ status.schemaVersion }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">响应延迟</div>
            <div class="stat-value">{{ status.latencyMs }}<small> ms</small></div>
            <div class="stat-note">一次最简查询的往返时间</div>
          </div>
        </div>

        <div class="health">
          <span class="pill" :class="status.health.quickCheck === 'ok' ? 'good' : 'bad'">完整性检查：{{ status.health.quickCheck === 'ok' ? '通过' : status.health.quickCheck }}</span>
          <span class="pill" :class="status.health.foreignKeyViolations ? 'bad' : 'good'">外键检查：{{ status.health.foreignKeyViolations ? status.health.foreignKeyViolations + ' 处不一致' : '通过' }}</span>
          <span class="pill muted">外键约束：已启用</span>
          <span v-if="status.file" class="pill muted" :title="status.file">文件：{{ shortPath(status.file) }}</span>
        </div>
        <ul v-if="status.warnings.length" class="warn-list">
          <li v-for="(w, i) in status.warnings" :key="i">⚠ {{ w }}</li>
        </ul>

        <h4 class="sub-title">各表记录数</h4>
        <div class="table-bars">
          <div v-for="t in status.tables" :key="t.name" class="bar-row">
            <div class="bar-name">
              <b>{{ t.label }}</b>
              <small>{{ t.name }}</small>
            </div>
            <div class="bar-track"><div class="bar-fill" :style="{ width: barWidth(t.rows) }"></div></div>
            <div class="bar-count">{{ t.rows }}</div>
            <button class="link-btn" @click="openBrowse(t.name)">浏览</button>
          </div>
        </div>

        <div class="history">
          <div class="history-item">
            <span class="history-label">最近一次导入</span>
            <span v-if="status.lastImport">{{ fmtTime(status.lastImport.at) }} · 来源 {{ sourceLabel(status.lastImport.source) }} · 新增 {{ status.lastImport.totals.inserted }} / 覆盖 {{ status.lastImport.totals.overwritten }}</span>
            <span v-else class="muted-text">暂无记录</span>
          </div>
          <div class="history-item">
            <span class="history-label">最近一次导出</span>
            <span v-if="status.lastExport">{{ fmtTime(status.lastExport.at) }} · {{ status.lastExport.tables.length }} 张表</span>
            <span v-else class="muted-text">暂无记录</span>
          </div>
        </div>
      </template>
    </section>

    <!-- ================= 导出 ================= -->
    <section v-if="tab === 'export'" class="panel">
      <div class="panel-head"><h3>导出数据</h3></div>
      <p class="desc">把数据库存档到其它设备。JSON 备份可以在本页「导入」里恢复；SQL 脚本可直接用 <code>wrangler d1 execute</code> 或 <code>sqlite3</code> 执行。</p>

      <h4 class="sub-title">选择数据表</h4>
      <div class="chk-grid">
        <label v-for="t in allTables" :key="t" class="chk" :class="{ danger: t === 'users' }">
          <input v-model="exportTables" type="checkbox" :value="t" />
          <span class="chk-text">{{ labels[t] }} <small>{{ t }}</small></span>
        </label>
      </div>
      <p v-if="exportTables.includes('users')" class="hint danger-text">⚠ 账号表包含密码哈希，请妥善保管导出文件。</p>
      <p v-if="exportTables.includes('uploads')" class="hint">图片会以 base64 内嵌在文件中，文件可能较大。</p>

      <h4 class="sub-title">导出格式</h4>
      <div class="radio-row">
        <label class="radio"><input v-model="exportFormat" type="radio" value="json" /> <span><b>JSON</b>（推荐，可再次导入）</span></label>
        <label class="radio"><input v-model="exportFormat" type="radio" value="sql" /> <span><b>SQL</b>（含建表语句，可重复执行）</span></label>
      </div>

      <div class="actions">
        <button class="btn primary" :disabled="exporting || !exportTables.length" @click="doExport">
          {{ exporting ? '正在导出…' : '导出并下载' }}
        </button>
      </div>
      <p class="hint">导出文件名形如 <code>nav-backup-20261021153000.json</code>。JWT 密钥与远程连接密钥不会写入导出文件。</p>
    </section>

    <!-- ================= 导入 ================= -->
    <section v-if="tab === 'import'" class="panel">
      <div class="panel-head"><h3>导入数据</h3></div>
      <p class="desc">来源可以是本机备份文件，也可以是云端下载地址。导入前会先「预览」，确认无误再写入；整个导入在一个事务里完成，失败不会留下半份数据。</p>

      <div class="seg">
        <button type="button" class="seg-btn" :class="{ active: importSource === 'file' }" @click="importSource = 'file'">📁 本地文件</button>
        <button type="button" class="seg-btn" :class="{ active: importSource === 'url' }" @click="importSource = 'url'">☁️ 云端下载地址</button>
      </div>

      <!-- 本地文件 -->
      <div v-if="importSource === 'file'" class="source-box">
        <input ref="fileInput" type="file" accept=".json,application/json" class="file-input" @change="onFileChange" />
        <div v-if="fileName && fileSummary" class="file-ok">✔ {{ fileName }}</div>
        <p class="hint">支持本页导出的 JSON 备份、<code>scripts/old-db-to-json.js</code> 转换的旧版数据库，以及「卡片平铺列表」格式的 JSON 数组。</p>
      </div>

      <!-- 云端 URL -->
      <div v-else class="source-box">
        <div class="form-row">
          <label>备份文件地址</label>
          <input v-model="urlForm.url" class="input" placeholder="https://example.com/nav-backup.json（支持 GitHub 页面链接、Gist、对象存储直链）" />
        </div>
        <div class="form-row">
          <label>Authorization <small>（可选，私有文件用）</small></label>
          <input v-model="urlForm.authorization" type="password" class="input" :placeholder="urlHasAuth ? '已保存授权信息，留空则沿用' : 'Bearer xxxxxxxx 或 token xxxxxxxx'" autocomplete="off" />
        </div>
        <label class="chk inline"><input v-model="urlForm.remember" type="checkbox" /> <span class="chk-text">记住这个地址（授权信息只保存在服务器，不会回显）</span></label>
        <div class="actions left">
          <button class="btn" :disabled="busy === 'preview' || !urlForm.url" @click="doPreview">{{ busy === 'preview' ? '正在下载…' : '下载并预览' }}</button>
        </div>
        <p class="hint">服务器会代你下载该文件（默认禁止访问内网地址）。大小上限 40 MB。</p>
      </div>

      <!-- 导入选项 -->
      <template v-if="fileSummary">
        <div class="summary-box">
          <div class="summary-title">备份内容</div>
          <div class="summary-chips">
            <span v-for="(n, t) in fileSummary.counts" :key="t" class="pill muted">{{ labels[t] || t }} {{ n }}</span>
          </div>
          <div v-if="fileSummary.meta && fileSummary.meta.exportedAt" class="hint">导出时间：{{ fmtTime(fileSummary.meta.exportedAt) }}<span v-if="fileSummary.meta.engine"> · 来自 {{ fileSummary.meta.engine }}</span></div>
          <div v-if="fileSummary.flat" class="hint">识别为「卡片平铺列表」，缺失的栏目会自动创建。</div>
          <ul v-if="fileSummary.warnings && fileSummary.warnings.length" class="warn-list">
            <li v-for="(w, i) in fileSummary.warnings" :key="i">⚠ {{ w }}</li>
          </ul>
        </div>

        <h4 class="sub-title">导入哪些数据表</h4>
        <div class="chk-grid">
          <label v-for="t in foundTables" :key="t" class="chk" :class="{ danger: t === 'users' }">
            <input v-model="importOptions.tables" type="checkbox" :value="t" />
            <span class="chk-text">{{ labels[t] || t }} <small>{{ fileSummary.counts[t] }} 条</small></span>
          </label>
        </div>
        <p class="hint">勾选「卡片」会自动连带栏目与子栏目，保证卡片能挂到正确的位置。账号与图片默认不勾选。</p>
        <p v-if="importOptions.tables.includes('users')" class="hint danger-text">⚠ 导入账号会写入密码哈希。旧版 bcrypt 哈希在 Cloudflare 免费版上可能因 CPU 限制无法登录，建议保留当前管理员账号。</p>

        <h4 class="sub-title">遇到相同记录时</h4>
        <div class="radio-row">
          <label class="radio"><input v-model="importOptions.conflict" type="radio" value="skip" /> <span><b>跳过</b>：保留现有数据，只添加新记录</span></label>
          <label class="radio"><input v-model="importOptions.conflict" type="radio" value="overwrite" /> <span><b>覆盖</b>：以导入的数据为准更新现有记录</span></label>
        </div>
        <p class="hint">“相同记录”按内容识别：栏目=名称；子栏目=所属栏目+名称；卡片=所属栏目+标题+网址；广告=位置+图片；友链=网址；账号=用户名。ID 不参与比较，所以不同数据库之间也能正确合并。</p>

        <h4 class="sub-title">导入方式</h4>
        <div class="radio-row">
          <label class="radio"><input v-model="importOptions.mode" type="radio" value="merge" /> <span><b>合并</b>：保留现有数据，追加 / 更新</span></label>
          <label class="radio danger"><input v-model="importOptions.mode" type="radio" value="replace" /> <span><b>替换</b>：先清空所选表，再还原备份（含原 ID）</span></label>
        </div>
        <p v-if="importOptions.mode === 'replace'" class="hint danger-text">⚠ 替换会删除所选数据表里的现有数据（栏目 / 子栏目 / 卡片相互关联，会一并替换），请先导出备份。</p>

        <div class="actions left">
          <button class="btn" :disabled="busy !== '' || !importOptions.tables.length" @click="doPreview">{{ busy === 'preview' ? '分析中…' : '预览导入结果' }}</button>
          <button class="btn primary" :disabled="busy !== '' || !preview" @click="doImport">{{ busy === 'import' ? '导入中…' : '确认导入' }}</button>
        </div>
        <p v-if="!preview && !result" class="hint">修改任何选项后需要重新预览。</p>
      </template>

      <ImportReport :report="preview" />
      <ImportReport :report="result" />
    </section>

    <!-- ================= 远程同步 ================= -->
    <section v-if="tab === 'remote'" class="panel">
      <div class="panel-head"><h3>远程数据库：Supabase / PostgREST</h3></div>
      <p class="desc">填写 Supabase 项目信息即可把本站数据推送到云端备份，或从云端拉取并合并到当前数据库。接口基于 PostgREST，因此也兼容自建的 Supabase 以及其它 PostgREST 服务。</p>

      <div class="form-grid">
        <div class="form-row">
          <label>Project URL</label>
          <input v-model="sb.url" class="input" placeholder="https://xxxxxxxx.supabase.co（也可只填项目 ref）" />
        </div>
        <div class="form-row">
          <label>API Key <small>（建议使用 secret / service_role 密钥）</small></label>
          <input v-model="sb.key" type="password" class="input" :placeholder="sb.hasKey ? '已保存：' + sb.keyMasked + '（留空则沿用）' : 'sb_secret_… 或 eyJ…'" autocomplete="off" />
        </div>
        <div class="form-row">
          <label>Schema</label>
          <input v-model="sb.schema" class="input" placeholder="public" />
        </div>
        <div class="form-row">
          <label>表名前缀</label>
          <input v-model="sb.prefix" class="input" placeholder="nav_" />
        </div>
      </div>

      <div class="actions left">
        <button class="btn" :disabled="busy !== ''" @click="doSaveConn">{{ busy === 'save' ? '保存中…' : '保存连接' }}</button>
        <button class="btn" :disabled="busy !== '' || !sb.url" @click="doTest">{{ busy === 'test' ? '测试中…' : '测试连接' }}</button>
        <button class="btn ghost" @click="toggleSchema">{{ showSchema ? '收起建表脚本' : '查看建表脚本' }}</button>
      </div>
      <p class="hint">⚠ 密钥保存在你自己的数据库中（不会在页面回显，也不会被导出）。请使用只用于这些表的密钥，并为表开启 RLS；不要把 publishable / anon 密钥配合开放策略使用，否则任何人都能读写这些表。</p>

      <div v-if="showSchema" class="code-box">
        <div class="code-head">
          <span>首次使用：在 Supabase 控制台 → SQL Editor 中执行一次</span>
          <button class="btn mini" @click="copySql">复制</button>
        </div>
        <pre class="code">{{ schemaSql }}</pre>
      </div>

      <div v-if="sbTest" class="test-result">
        <div class="test-head" :class="sbTest.ok ? 'good' : 'bad'">
          {{ sbTest.ok ? '✔ 连接成功，所有数据表就绪' : '✖ 连接成功，但部分数据表缺失' }}
          <small>{{ sbTest.endpoint }} · schema {{ sbTest.schema }}</small>
        </div>
        <div v-for="t in sbTest.tables" :key="t.name" class="test-row">
          <span :class="t.exists ? 'ok-dot' : 'bad-dot'">{{ t.exists ? '●' : '○' }}</span>
          <code>{{ t.name }}</code>
          <span v-if="t.exists" class="muted-text">{{ t.rows == null ? '' : t.rows + ' 行' }}</span>
          <span v-else class="danger-text">{{ t.error }}</span>
        </div>
      </div>

      <div class="two-col">
        <div class="sub-panel">
          <h4 class="sub-title flush">⬆ 推送到 Supabase</h4>
          <p class="hint flush">把本地的栏目、子栏目、卡片、广告、友链写入远程表（保持相同 ID）。账号与图片不会推送。</p>
          <div class="radio-col">
            <label class="radio"><input v-model="pushMode" type="radio" value="merge" /> <span><b>合并</b>：按 ID 更新或新增，远程多出的保留</span></label>
            <label class="radio danger"><input v-model="pushMode" type="radio" value="mirror" /> <span><b>镜像</b>：先清空远程表，再写入（远程 = 本地）</span></label>
          </div>
          <div class="actions left">
            <button class="btn primary" :disabled="busy !== '' || !sb.url" @click="doPush">{{ busy === 'push' ? '推送中…' : '开始推送' }}</button>
          </div>
          <div v-if="pushResult" class="mini-result">
            ✔ 推送完成：
            <span v-for="(n, t) in pushResult.pushed" :key="t" class="pill muted">{{ labels[t] || t }} {{ n }}</span>
          </div>
        </div>

        <div class="sub-panel">
          <h4 class="sub-title flush">⬇ 从 Supabase 拉取</h4>
          <p class="hint flush">读取远程表并按「导入」同样的规则合并到当前数据库（按内容识别重复记录）。</p>
          <div class="radio-col">
            <label class="radio"><input v-model="pullOpts.conflict" type="radio" value="skip" /> <span><b>跳过</b>重复记录</span></label>
            <label class="radio"><input v-model="pullOpts.conflict" type="radio" value="overwrite" /> <span><b>覆盖</b>重复记录</span></label>
            <label class="radio"><input v-model="pullOpts.mode" type="radio" value="merge" /> <span><b>合并</b>：追加新记录</span></label>
            <label class="radio danger"><input v-model="pullOpts.mode" type="radio" value="replace" /> <span><b>替换</b>：先清空本地对应数据表</span></label>
          </div>
          <div class="actions left">
            <button class="btn" :disabled="busy !== '' || !sb.url" @click="doPullPreview">{{ busy === 'pullpreview' ? '读取中…' : '预览' }}</button>
            <button class="btn primary" :disabled="busy !== '' || !pullPreview" @click="doPull">{{ busy === 'pull' ? '导入中…' : '确认拉取' }}</button>
          </div>
        </div>
      </div>

      <ImportReport :report="pullPreview" />
      <ImportReport :report="pullResult" />

      <div class="divider"></div>
      <h3 class="inline-h">从云端下载地址导入</h3>
      <p class="desc">已为你把它放在「导入」标签页：选择「云端下载地址」，填入备份文件的链接（GitHub、Gist、R2 / S3 / Supabase Storage 公开链接或预签名链接均可），服务器会代为下载并导入。</p>
      <div class="actions left"><button class="btn" @click="goImportUrl">前往导入</button></div>
    </section>

    <!-- ================= 数据浏览 ================= -->
    <section v-if="tab === 'browse'" class="panel">
      <div class="panel-head"><h3>数据浏览（只读）</h3></div>
      <div class="browse-bar">
        <select v-model="browse.table" class="input">
          <option v-for="t in allTables" :key="t" :value="t">{{ labels[t] }}（{{ t }}）</option>
        </select>
        <input v-model="browse.q" class="input grow" placeholder="搜索关键词（文本列模糊匹配）" @keyup.enter="searchBrowse" />
        <button class="btn" @click="searchBrowse">搜索</button>
      </div>

      <div v-if="browse.data" class="data-wrap">
        <table class="data-table">
          <thead>
            <tr><th v-for="c in browse.data.columns" :key="c">{{ c }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in browse.data.rows" :key="i">
              <td v-for="c in browse.data.columns" :key="c" :class="{ nul: row[c] === null }" :title="String(row[c] === null ? '' : row[c])">{{ cell(row[c]) }}</td>
            </tr>
            <tr v-if="!browse.data.rows.length"><td :colspan="browse.data.columns.length" class="empty-cell">没有数据</td></tr>
          </tbody>
        </table>
      </div>
      <div v-if="browse.data" class="pager">
        <span>共 {{ browse.data.total }} 条 · 第 {{ browse.page }} / {{ totalPages }} 页</span>
        <button class="btn mini" :disabled="browse.page <= 1 || browse.loading" @click="gotoPage(browse.page - 1)">上一页</button>
        <button class="btn mini" :disabled="browse.page >= totalPages || browse.loading" @click="gotoPage(browse.page + 1)">下一页</button>
      </div>
      <p class="hint">账号表不显示密码哈希；图片表不显示图片内容。</p>

      <div class="divider"></div>
      <h3 class="inline-h">SQL 控制台（仅限 SELECT）</h3>
      <textarea v-model="sql" class="sql-input" rows="4" spellcheck="false" placeholder="SELECT * FROM cards LIMIT 10"></textarea>
      <div class="actions left">
        <button class="btn" :disabled="sqlBusy" @click="doQuery">{{ sqlBusy ? '执行中…' : '执行查询' }}</button>
        <span v-if="sqlResult" class="muted-text">{{ sqlResult.rows.length }} 行{{ sqlResult.truncated ? '（最多显示 200 行）' : '' }} · {{ sqlResult.ms }} ms</span>
      </div>
      <p v-if="sqlError" class="danger-text">{{ sqlError }}</p>
      <div v-if="sqlResult && sqlResult.columns.length" class="data-wrap">
        <table class="data-table">
          <thead><tr><th v-for="c in sqlResult.columns" :key="c">{{ c }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, i) in sqlResult.rows" :key="i">
              <td v-for="c in sqlResult.columns" :key="c" :class="{ nul: row[c] === null }" :title="String(row[c] === null ? '' : row[c])">{{ cell(row[c]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import {
  getDbStatus, optimizeDb, browseTable, runQuery, exportDb, inspectBackup, importBackup, importFromUrl,
  getConnections, saveConnections, getSupabaseSchema, testSupabase, pushSupabase, pullSupabase
} from '../../api';
import ImportReport from '../../components/ImportReport.vue';

const emit = defineEmits(['unauthorized']);

const labels = {
  menus: '栏目', sub_menus: '子栏目', cards: '导航卡片', ads: '广告', friends: '友情链接', users: '管理员账号', uploads: '上传的图片'
};
const allTables = ['menus', 'sub_menus', 'cards', 'ads', 'friends', 'users', 'uploads'];
const tabs = [
  { id: 'overview', label: '概览', icon: '📊' },
  { id: 'export', label: '导出', icon: '📤' },
  { id: 'import', label: '导入', icon: '📥' },
  { id: 'remote', label: '远程同步', icon: '☁️' },
  { id: 'browse', label: '数据浏览', icon: '🔎' }
];
const tab = ref('overview');

// ---------------------------------------------------------------- 提示与错误
const toast = reactive({ type: '', text: '' });
let toastTimer = null;
function notify(type, text) {
  toast.type = type;
  toast.text = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.text = ''; }, 6000);
}

function errText(e) {
  const d = e && e.response && e.response.data;
  if (d && typeof d === 'object' && !(d instanceof Blob)) return d.error || d.message || '请求失败';
  return (e && e.message) || '请求失败';
}

async function handleError(e, prefix) {
  if (e && e.response && e.response.status === 401) { emit('unauthorized'); return; }
  let msg = errText(e);
  const d = e && e.response && e.response.data;
  if (d instanceof Blob) {            // 导出接口以 Blob 返回，错误信息在 Blob 里
    try { msg = JSON.parse(await d.text()).error || msg; } catch (x) { /* 忽略 */ }
  }
  notify('error', (prefix ? prefix + '：' : '') + msg);
}

// ---------------------------------------------------------------- 格式化
function fmtBytes(n) {
  if (n === null || n === undefined) return '--';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
function fmtTime(iso) {
  if (!iso) return '从未';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}
function shortPath(p) {
  const s = String(p || '');
  return s.length > 38 ? '…' + s.slice(-36) : s;
}
function sourceLabel(s) {
  if (s === 'url') return '云端下载';
  if (s === 'supabase') return 'Supabase';
  return '本地文件';
}
function cell(v) {
  if (v === null || v === undefined) return 'NULL';
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

// ---------------------------------------------------------------- 概览
const status = ref(null);
const statusLoading = ref(false);

const engineLabel = computed(() => {
  if (!status.value) return '--';
  return status.value.engine === 'cloudflare-d1' ? 'Cloudflare D1' : 'SQLite（本地文件）';
});
const healthOk = computed(() => {
  const s = status.value;
  return !!s && s.health.quickCheck === 'ok' && !s.health.foreignKeyViolations;
});
const maxRows = computed(() => {
  if (!status.value) return 1;
  return Math.max(1, ...status.value.tables.map((t) => t.rows));
});
function barWidth(rows) {
  if (!rows) return '0%';
  return Math.max(3, Math.round((rows / maxRows.value) * 100)) + '%';
}

async function loadStatus() {
  statusLoading.value = true;
  try {
    status.value = (await getDbStatus()).data;
  } catch (e) {
    await handleError(e, '读取数据库状态失败');
  } finally {
    statusLoading.value = false;
  }
}

async function doOptimize() {
  try {
    await optimizeDb();
    notify('success', '优化完成');
    loadStatus();
  } catch (e) {
    await handleError(e, '优化失败');
  }
}

function openBrowse(name) {
  browse.table = name;
  tab.value = 'browse';
}

// ---------------------------------------------------------------- 导出
const exportTables = ref(['menus', 'sub_menus', 'cards', 'ads', 'friends']);
const exportFormat = ref('json');
const exporting = ref(false);

async function doExport() {
  if (!exportTables.value.length) { notify('error', '请至少选择一张数据表'); return; }
  exporting.value = true;
  try {
    const res = await exportDb({
      tables: exportTables.value.join(','),
      format: exportFormat.value,
      includeUsers: exportTables.value.includes('users') ? 1 : 0,
      includeUploads: exportTables.value.includes('uploads') ? 1 : 0
    });
    const cd = (res.headers && res.headers['content-disposition']) || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const name = m ? m[1] : 'nav-backup.' + exportFormat.value;
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notify('success', '已导出：' + name);
    loadStatus();
  } catch (e) {
    await handleError(e, '导出失败');
  } finally {
    exporting.value = false;
  }
}

// ---------------------------------------------------------------- 导入
const importSource = ref('file');
const fileInput = ref(null);
const fileName = ref('');
const backupData = ref(null);
const fileSummary = ref(null);
const urlForm = reactive({ url: '', authorization: '', remember: false });
const urlHasAuth = ref(false);
const importOptions = reactive({ conflict: 'skip', mode: 'merge', tables: [] });
const preview = ref(null);
const result = ref(null);
const busy = ref('');

const foundTables = computed(() => (fileSummary.value ? Object.keys(fileSummary.value.counts) : []));

function resetImportState() {
  preview.value = null;
  result.value = null;
}
watch(
  () => [importOptions.conflict, importOptions.mode, importOptions.tables.slice().sort().join(',')],
  resetImportState
);
watch(importSource, () => {
  backupData.value = null;
  fileSummary.value = null;
  fileName.value = '';
  importOptions.tables = [];
  resetImportState();
});

function setDefaultTables() {
  importOptions.tables = foundTables.value.filter((t) => t !== 'users' && t !== 'uploads');
}

function onFileChange(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  resetImportState();
  backupData.value = null;
  fileSummary.value = null;
  fileName.value = file.name;
  if (file.size > 40 * 1024 * 1024) {
    notify('error', '文件过大（上限 40 MB）');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = String(reader.result || '').replace(/^\uFEFF/, '');
      const json = JSON.parse(text);
      const res = await inspectBackup(json);
      backupData.value = json;
      fileSummary.value = res.data;
      setDefaultTables();
    } catch (e) {
      fileName.value = '';
      if (e instanceof SyntaxError) notify('error', '这个文件不是有效的 JSON');
      else await handleError(e, '无法识别该备份文件');
    }
  };
  reader.onerror = () => notify('error', '读取文件失败');
  reader.readAsText(file);
}

function buildOptions(dryRun) {
  return {
    conflict: importOptions.conflict,
    mode: importOptions.mode,
    tables: importOptions.tables.slice(),
    dryRun: dryRun
  };
}
function urlPayload(dryRun) {
  return {
    url: urlForm.url.trim(),
    authorization: urlForm.authorization,
    remember: urlForm.remember,
    options: buildOptions(dryRun)
  };
}

async function doPreview() {
  busy.value = 'preview';
  result.value = null;
  try {
    if (importSource.value === 'file') {
      if (!backupData.value) { notify('error', '请先选择备份文件'); return; }
      preview.value = (await importBackup(backupData.value, buildOptions(true))).data;
    } else {
      const res = await importFromUrl(urlPayload(true));
      fileSummary.value = res.data.download.summary;
      if (!importOptions.tables.length) {
        setDefaultTables();
        await nextTick();            // 等“选项变化 → 清空预览”的监听先执行完，再展示预览
      }
      preview.value = res.data;
    }
  } catch (e) {
    preview.value = null;
    await handleError(e, '预览失败');
  } finally {
    busy.value = '';
  }
}

async function doImport() {
  if (!preview.value) return;
  const t = preview.value.totals;
  const msg = importOptions.mode === 'replace'
    ? '「替换」会先清空所选数据表再导入，无法撤销。\n建议先导出一份备份。\n\n确定继续吗？'
    : '将新增 ' + t.inserted + ' 条、覆盖 ' + t.overwritten + ' 条记录。\n\n确定导入吗？';
  if (!window.confirm(msg)) return;
  busy.value = 'import';
  try {
    const res = importSource.value === 'file'
      ? await importBackup(backupData.value, buildOptions(false))
      : await importFromUrl(urlPayload(false));
    result.value = res.data;
    preview.value = null;
    notify('success', '导入完成');
    loadStatus();
    if (importOptions.mode === 'replace' && importOptions.tables.includes('users')) {
      notify('success', '账号表已被替换，请使用备份中的账号重新登录');
    }
  } catch (e) {
    await handleError(e, '导入失败');
  } finally {
    busy.value = '';
  }
}

function goImportUrl() {
  importSource.value = 'url';
  tab.value = 'import';
}

// ---------------------------------------------------------------- 远程同步（Supabase / PostgREST）
const sb = reactive({ url: '', key: '', schema: 'public', prefix: 'nav_', hasKey: false, keyMasked: '' });
const sbTest = ref(null);
const showSchema = ref(false);
const schemaSql = ref('');
const pushMode = ref('merge');
const pushResult = ref(null);
const pullOpts = reactive({ conflict: 'skip', mode: 'merge' });
const pullPreview = ref(null);
const pullResult = ref(null);

watch(() => [pullOpts.conflict, pullOpts.mode], () => {
  pullPreview.value = null;
  pullResult.value = null;
});

async function loadConnections() {
  try {
    const d = (await getConnections()).data;
    sb.url = d.supabase.url;
    sb.schema = d.supabase.schema;
    sb.prefix = d.supabase.prefix;
    sb.hasKey = d.supabase.hasKey;
    sb.keyMasked = d.supabase.keyMasked;
    if (!urlForm.url && d.download.url) urlForm.url = d.download.url;
    urlHasAuth.value = d.download.hasAuth;
  } catch (e) {
    await handleError(e, '读取连接配置失败');
  }
}

function connPayload() {
  return { url: sb.url.trim(), key: sb.key.trim(), schema: sb.schema.trim() || 'public', prefix: sb.prefix };
}

async function doSaveConn() {
  busy.value = 'save';
  try {
    await saveConnections({ supabase: connPayload() });
    sb.key = '';
    await loadConnections();
    notify('success', '连接信息已保存');
  } catch (e) {
    await handleError(e, '保存失败');
  } finally {
    busy.value = '';
  }
}

async function doTest() {
  busy.value = 'test';
  sbTest.value = null;
  try {
    sbTest.value = (await testSupabase(connPayload())).data;
  } catch (e) {
    await handleError(e, '连接失败');
  } finally {
    busy.value = '';
  }
}

async function toggleSchema() {
  showSchema.value = !showSchema.value;
  if (!showSchema.value) return;
  try {
    schemaSql.value = (await getSupabaseSchema({ schema: sb.schema, prefix: sb.prefix })).data.sql;
  } catch (e) {
    await handleError(e, '读取建表脚本失败');
  }
}

async function copySql() {
  try {
    await navigator.clipboard.writeText(schemaSql.value);
    notify('success', '已复制到剪贴板');
  } catch (e) {
    notify('error', '复制失败，请手动选中后复制');
  }
}

async function doPush() {
  if (pushMode.value === 'mirror' && !window.confirm('镜像模式会先清空远程数据表，再写入本地数据；远程独有的数据将丢失。\n\n确定继续吗？')) return;
  busy.value = 'push';
  pushResult.value = null;
  try {
    pushResult.value = (await pushSupabase(connPayload(), { mirror: pushMode.value === 'mirror' })).data;
    notify('success', '推送完成');
  } catch (e) {
    await handleError(e, '推送失败');
  } finally {
    busy.value = '';
  }
}

async function doPullPreview() {
  busy.value = 'pullpreview';
  pullResult.value = null;
  try {
    pullPreview.value = (await pullSupabase(connPayload(), { conflict: pullOpts.conflict, mode: pullOpts.mode, dryRun: true })).data;
  } catch (e) {
    pullPreview.value = null;
    await handleError(e, '读取远程数据失败');
  } finally {
    busy.value = '';
  }
}

async function doPull() {
  if (!pullPreview.value) return;
  const msg = pullOpts.mode === 'replace'
    ? '替换模式会先清空本地对应的数据表，无法撤销。\n\n确定继续吗？'
    : '将新增 ' + pullPreview.value.totals.inserted + ' 条、覆盖 ' + pullPreview.value.totals.overwritten + ' 条记录。\n\n确定拉取吗？';
  if (!window.confirm(msg)) return;
  busy.value = 'pull';
  try {
    pullResult.value = (await pullSupabase(connPayload(), { conflict: pullOpts.conflict, mode: pullOpts.mode, dryRun: false })).data;
    pullPreview.value = null;
    notify('success', '拉取完成');
    loadStatus();
  } catch (e) {
    await handleError(e, '拉取失败');
  } finally {
    busy.value = '';
  }
}

// ---------------------------------------------------------------- 数据浏览
const browse = reactive({ table: 'cards', page: 1, pageSize: 20, q: '', data: null, loading: false });
const totalPages = computed(() => (browse.data ? Math.max(1, Math.ceil(browse.data.total / browse.pageSize)) : 1));

async function loadBrowse() {
  browse.loading = true;
  try {
    browse.data = (await browseTable(browse.table, { page: browse.page, pageSize: browse.pageSize, q: browse.q || undefined })).data;
  } catch (e) {
    await handleError(e, '读取数据失败');
  } finally {
    browse.loading = false;
  }
}
function searchBrowse() {
  browse.page = 1;
  loadBrowse();
}
function gotoPage(p) {
  if (p < 1 || p > totalPages.value) return;
  browse.page = p;
  loadBrowse();
}
watch(() => browse.table, () => {
  browse.page = 1;
  browse.q = '';
  browse.data = null;
  if (tab.value === 'browse') loadBrowse();
});

const sql = ref('SELECT m.name AS 栏目, COUNT(c.id) AS 卡片数\nFROM menus m LEFT JOIN cards c ON c.menu_id = m.id\nGROUP BY m.id ORDER BY m."order"');
const sqlResult = ref(null);
const sqlError = ref('');
const sqlBusy = ref(false);

async function doQuery() {
  sqlBusy.value = true;
  sqlError.value = '';
  sqlResult.value = null;
  try {
    sqlResult.value = (await runQuery(sql.value)).data;
  } catch (e) {
    if (e && e.response && e.response.status === 401) emit('unauthorized');
    else sqlError.value = errText(e);
  } finally {
    sqlBusy.value = false;
  }
}

// ---------------------------------------------------------------- 生命周期
watch(tab, (t) => {
  if (t === 'overview') loadStatus();
  if (t === 'remote' || t === 'import') loadConnections();
  if (t === 'browse' && !browse.data) loadBrowse();
});

onMounted(() => {
  loadStatus();
  loadConnections();
});
</script>

<style scoped>
.db-manage {
  max-width: 1100px;
  width: 95%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}

/* ---------- 横幅 ---------- */
.db-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 24px 28px;
  border-radius: 16px;
  color: #fff;
  background: var(--adm-grad);
  box-shadow: 0 8px 32px rgb(var(--adm-grad-a-rgb) / 0.3);
}
.hero-title { margin: 0 0 6px; font-size: 1.6rem; font-weight: 700; letter-spacing: 1px; }
.hero-sub { margin: 0; opacity: 0.9; font-size: 14px; }
.hero-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.hero-badge {
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(6px);
}
.hero-badge.good { background: rgba(34, 197, 94, 0.35); }
.hero-badge.bad { background: rgba(239, 68, 68, 0.45); }

/* ---------- 提示 ---------- */
.toast {
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  cursor: pointer;
  border: 1px solid transparent;
}
.toast.success { background: #e7f8ee; color: #0f6b34; border-color: #bfe9cf; }
.toast.error { background: #fdecec; color: #b42318; border-color: #f7c6c2; white-space: pre-line; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ---------- 标签页 ---------- */
.tabs { display: flex; gap: 6px; flex-wrap: wrap; padding: 6px; background: #fff; border-radius: 14px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06); }
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #475467;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tab:hover { background: var(--adm-primary-soft); }
.tab.active { background: var(--adm-primary); color: #fff; box-shadow: 0 4px 12px rgb(var(--adm-primary-rgb) / 0.3); }
.tab-icon { font-size: 15px; }

/* ---------- 面板 ---------- */
.panel { background: #fff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08); padding: 22px 24px 26px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.panel-head h3, .inline-h { margin: 0; font-size: 1.15rem; color: #222; }
.panel-actions { display: flex; gap: 8px; }
.desc { margin: 4px 0 16px; color: #667085; font-size: 14px; line-height: 1.7; }
.desc code, .hint code { padding: 1px 6px; background: #f1f3f9; border-radius: 6px; font-size: 12.5px; color: #444; }
.sub-title { margin: 20px 0 10px; font-size: 14px; font-weight: 700; color: #344054; }
.sub-title.flush { margin-top: 0; }
.hint { margin: 8px 0 0; font-size: 12.5px; line-height: 1.7; color: #8a93a6; }
.hint.flush { margin-top: 0; margin-bottom: 10px; }
.danger-text { color: #c0392b; }
.muted-text { color: #8a93a6; font-size: 13px; }
.empty { padding: 36px 0; text-align: center; color: #8a93a6; }
.divider { height: 1px; margin: 26px 0 20px; background: #eef0f6; }

/* ---------- 按钮 / 输入 ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 18px;
  border: 1px solid var(--adm-primary);
  border-radius: 10px;
  background: #fff;
  color: var(--adm-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, transform 0.1s, opacity 0.15s;
}
.btn:hover:not(:disabled) { background: var(--adm-primary-soft); }
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: var(--adm-primary); color: #fff; }
.btn.primary:hover:not(:disabled) { background: var(--adm-primary-dark); }
.btn.ghost { border-color: #d0d7e2; color: #475467; }
.btn.ghost:hover:not(:disabled) { background: #f5f6fa; }
.btn.mini { padding: 5px 12px; font-size: 13px; border-radius: 8px; }
.link-btn { border: none; background: none; color: var(--adm-primary); font-size: 13px; cursor: pointer; padding: 2px 4px; }
.link-btn:hover { text-decoration: underline; }
.actions { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 20px; }
.actions.left { justify-content: flex-start; }

.input {
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1px solid #d0d7e2;
  border-radius: 10px;
  background: #fff;
  color: #222;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input:focus { border-color: var(--adm-primary); box-shadow: 0 0 0 3px rgb(var(--adm-primary-rgb) / 0.15); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }
.form-row label { font-size: 13px; font-weight: 600; color: #344054; }
.form-row label small { font-weight: 400; color: #8a93a6; }

/* ---------- 复选 / 单选 ---------- */
.chk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.chk {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #e3e6ef;
  border-radius: 12px;
  background: #fafbfd;
  cursor: pointer;
  font-size: 14px;
  transition: border-color 0.15s, background 0.15s;
}
.chk:hover { border-color: var(--adm-primary); }
.chk.inline { display: inline-flex; border: none; background: none; padding: 6px 0; }
.chk.danger { border-style: dashed; }
.chk-text small { color: #8a93a6; margin-left: 4px; }
.radio-row { display: flex; flex-wrap: wrap; gap: 12px; }
.radio-col { display: flex; flex-direction: column; gap: 8px; }
.radio { display: inline-flex; align-items: flex-start; gap: 8px; padding: 10px 14px; border: 1px solid #e3e6ef; border-radius: 12px; font-size: 14px; color: #344054; cursor: pointer; line-height: 1.5; }
.radio input { margin-top: 3px; }
.radio:hover { border-color: var(--adm-primary); }
.radio.danger { border-style: dashed; }

/* ---------- 来源切换 / 文件 ---------- */
.seg { display: inline-flex; padding: 4px; background: #f1f3f9; border-radius: 12px; gap: 4px; margin-bottom: 14px; }
.seg-btn { padding: 8px 16px; border: none; border-radius: 9px; background: transparent; color: #475467; font-size: 14px; font-weight: 600; cursor: pointer; }
.seg-btn.active { background: #fff; color: var(--adm-primary); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
.source-box { padding: 16px; border: 1px dashed #cfd6e4; border-radius: 14px; background: #fafbfd; }
.file-input { font-size: 14px; }
.file-ok { margin-top: 10px; color: #0f6b34; font-weight: 600; }
.summary-box { margin-top: 16px; padding: 14px 16px; background: #f4f7ff; border: 1px solid #dfe7fb; border-radius: 14px; }
.summary-title { font-size: 13px; font-weight: 700; color: #344054; margin-bottom: 8px; }
.summary-chips { display: flex; flex-wrap: wrap; gap: 8px; }

/* ---------- 概览组件 ---------- */
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 12px; }
.stat { padding: 16px; border-radius: 14px; background: linear-gradient(180deg, #fafbff, #f3f6ff); border: 1px solid #e3e8f8; }
.stat-label { font-size: 13px; color: #667085; }
.stat-value { margin: 6px 0 4px; font-size: 26px; font-weight: 700; color: var(--adm-primary); line-height: 1.2; }
.stat-value.small { font-size: 18px; padding: 5px 0; }
.stat-value small { font-size: 14px; color: #8a93a6; font-weight: 500; }
.stat-note { font-size: 12px; color: #8a93a6; }
.health { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.pill { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600; }
.pill.good { background: #e0f6e8; color: #0f6b34; }
.pill.bad { background: #fde7e7; color: #b42318; }
.pill.muted { background: #eef0f6; color: #475467; }
.warn-list { margin: 12px 0 0; padding: 10px 14px; list-style: none; background: #fff8e6; border: 1px solid #ffe3a3; border-radius: 10px; color: #8a6100; font-size: 13px; line-height: 1.7; }
.table-bars { display: flex; flex-direction: column; gap: 10px; }
.bar-row { display: grid; grid-template-columns: 170px 1fr 60px 44px; align-items: center; gap: 12px; }
.bar-name b { font-size: 14px; color: #344054; }
.bar-name small { margin-left: 6px; color: #8a93a6; font-size: 12px; }
.bar-track { height: 10px; border-radius: 999px; background: #eef0f6; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 999px; background: var(--adm-grad); transition: width 0.5s ease; }
.bar-count { text-align: right; font-weight: 700; color: #344054; font-variant-numeric: tabular-nums; }
.history { margin-top: 20px; padding: 14px 16px; background: #f8f9fc; border-radius: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; color: #344054; }
.history-label { display: inline-block; width: 96px; color: #8a93a6; }

/* ---------- 远程同步 ---------- */
.code-box { margin-top: 14px; border: 1px solid #e3e6ef; border-radius: 12px; overflow: hidden; }
.code-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; background: #f1f3f9; font-size: 13px; color: #475467; }
.code { margin: 0; padding: 12px 14px; max-height: 300px; overflow: auto; background: #101828; color: #d1e0ff; font-size: 12.5px; line-height: 1.6; }
.test-result { margin-top: 16px; border: 1px solid #e3e6ef; border-radius: 12px; overflow: hidden; }
.test-head { padding: 10px 14px; font-weight: 700; font-size: 14px; }
.test-head small { margin-left: 10px; font-weight: 400; opacity: 0.8; }
.test-head.good { background: #e0f6e8; color: #0f6b34; }
.test-head.bad { background: #fff3cd; color: #8a6100; }
.test-row { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-top: 1px solid #eef0f6; font-size: 13.5px; }
.ok-dot { color: #12a150; }
.bad-dot { color: #dc2626; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 22px; }
.sub-panel { padding: 16px; border: 1px solid #e3e6ef; border-radius: 14px; background: #fcfcfe; }
.mini-result { margin-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13.5px; color: #0f6b34; }

/* ---------- 数据浏览 ---------- */
.browse-bar { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 14px; }
.browse-bar .input { width: auto; min-width: 200px; }
.browse-bar .input.grow { flex: 1; }
.data-wrap { overflow-x: auto; border: 1px solid #e3e6ef; border-radius: 12px; margin-top: 12px; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { position: sticky; top: 0; padding: 9px 12px; background: #f1f3f9; color: #475467; text-align: left; white-space: nowrap; font-weight: 700; }
.data-table td { padding: 8px 12px; border-top: 1px solid #eef0f6; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #344054; }
.data-table td.nul { color: #b0b7c6; font-style: italic; }
.empty-cell { text-align: center; color: #8a93a6; padding: 22px 0 !important; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 12px; font-size: 13px; color: #667085; }
.sql-input {
  box-sizing: border-box;
  width: 100%;
  margin-top: 10px;
  padding: 12px;
  border: 1px solid #d0d7e2;
  border-radius: 12px;
  background: #101828;
  color: #d1e0ff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}
.sql-input:focus { border-color: var(--adm-primary); }

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .two-col, .form-grid { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .panel { padding: 16px 14px 20px; }
  .bar-row { grid-template-columns: 1fr 52px 40px; }
  .bar-track { grid-column: 1 / -1; order: 5; }
  .stat-grid { grid-template-columns: 1fr; }
}
</style>
