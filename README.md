# Navigation-Project - 个人导航站

## 项目简介

一个现代化的导航网站项目，提供简洁美观的导航界面和强大的后台管理系统，快速访问常用网站和工具。

**v2.0 起同时支持两种运行方式，业务代码完全共用：**

| 方式 | 运行环境 | 数据库 |
| --- | --- | --- |
| ☁️ **Cloudflare Workers / Pages**（新） | Cloudflare 边缘网络 | **Cloudflare D1**（SQLite） |
| 🖥️ **自托管**（原有） | Node.js ≥ 22.13：源码 / Docker / docker-compose / Debian 一键脚本 / serv00 | 本地 SQLite 文件（`database/nav.db`） |

## 🛠️ 技术栈

- 前端：Vue 3 + Vite
- 后端：**Web 标准 `fetch` 处理函数**（`Request → Response`），不依赖 Express，因此能原样跑在 Workers / Pages Functions / Node 上
- 数据库：Cloudflare D1 或 Node 内置的 `node:sqlite`（统一成 D1 风格接口，无需编译原生模块）

## ✨ 主要功能

### 前端功能
- 🏠 **首页导航**：美观的卡片式导航界面
- 🔍 **聚合搜索**：支持 Google、百度、Bing、GitHub、站内搜索
- 📱 **响应式设计**：完美适配桌面端和移动端
- 🎨 **现代化 UI**：渐变背景和毛玻璃效果
- 🌈 **7 款主题皮肤（新）**：经典 / 海洋蓝 / 彩虹 / 玫瑰 / 山林 / 晚霞 / 朝阳，带动态光效，右上角（手机在右下角）一键切换
- 🧭 **7 个 emoji 风格 SVG Logo（新）**：没填 Logo 的卡片自动分配，也可手动指定
- 🔗 **友情链接**、📢 **广告位**
- 页脚年份自动跟随当前年份（`Copyright © 2026`）

### 后台管理功能
- 👤 **用户管理**：管理员登录、改密码
- 📋 **栏目管理**、🃏 **卡片管理**、📢 **广告管理**、🔗 **友链管理**
- 🗄️ **数据库管理（新）**：运行状态 · 导出 · 导入（可选跳过/覆盖）· 云端下载地址导入 · Supabase 同步 · 数据浏览 · 只读 SQL 控制台
- 📊 登录时间、IP 等统计信息
- 管理员登录在 https://domain.com/admin 输入自己设置的用户名和密码。

### 技术特性
- 🔐 JWT 认证（HS256，WebCrypto 实现）；密码使用 PBKDF2-SHA256 哈希，旧版 bcrypt 密码登录后自动升级
- 📤 图片上传（存入数据库，随备份一起导出）
- 🧪 附带 120 项自动化测试（`npm test`）

## 🏗️ 项目结构

```
nav-item/
├── app.js                    # Node 自托管入口（HTTP 适配 + 静态文件托管）
├── config.js                 # Node 端配置（.env / 环境变量）
├── package.json
├── wrangler.toml             # Cloudflare Workers 配置（静态资源 + D1 绑定）
├── wrangler.pages.toml.example  # Pages + wrangler CLI 参考配置
├── worker/index.js           # Workers 入口
├── functions/[[path]].js     # Pages Functions 入口
├── migrations/0001_init.sql  # D1 建表（由 schema.js 生成；应用启动时也会自动建表）
├── src/
│   ├── core/                 # ★ 与运行环境无关的业务核心
│   │   ├── app.js            #   handle(request, env) -> Response
│   │   ├── schema.js         #   表结构 / 惰性初始化 / 默认数据
│   │   ├── seed-data.js      #   默认菜单与卡片
│   │   ├── auth.js           #   JWT / 密码哈希
│   │   ├── transfer.js       #   导入导出引擎（去重、外键重映射、预览）
│   │   ├── remote.js         #   Supabase(PostgREST) 连接器 + 云端下载
│   │   ├── netguard.js       #   出站请求防护（SSRF）
│   │   └── routes/           #   menus / cards / simple(广告、友链) / users / upload / settings / dbadmin
│   └── adapters/node-sqlite.js  # Node 端的 D1 兼容适配器
├── scripts/
│   ├── install-debian.sh     # Debian/Ubuntu 一键部署
│   ├── old-db-to-json.js     # 旧版 nav.db → 备份 JSON
│   └── gen-migration.js
├── test/                     # node:test 自动化测试
├── Dockerfile / docker-compose.yml / .github/workflows/
└── web/                      # Vue 前端
    ├── public/logos/         #   7 个内置 SVG logo
    └── src/
        ├── styles/themes.css #   主题皮肤（CSS 变量）
        ├── composables/useTheme.js
        ├── utils/logos.js
        ├── components/       #   MenuBar / CardGrid / ThemeSwitcher / LogoPicker / ImportReport
        └── views/            #   Home / Admin / admin/(MenuManage CardManage AdManage FriendLinkManage UserManage DbManage)
```

## ⚙️ 环境变量及配置说明

| 变量 | 适用 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `PORT` | Node | `3000` | 服务端口 |
| `ADMIN_USERNAME` | 全部 | `amos` | 管理员用户名，**仅在首次初始化（用户表为空）时使用** |
| `ADMIN_PASSWORD` | 全部 | `sweet` | 管理员密码，同上。**务必修改**；Cloudflare 请用 Secret |
| `JWT_SECRET` | 全部 | 自动生成 | 令牌签名密钥。不设置则首次使用时随机生成并保存在数据库的 `settings` 表（不会被导出） |
| `DB_PATH` | Node | `./database/nav.db` | SQLite 文件路径 |
| `UPLOADS_DIR` | Node | `./uploads` | 旧版磁盘上传目录（只读兼容，新上传存数据库） |
| `ALLOW_PRIVATE_NETWORK` | 全部 | 关闭 | 设为 `true` 才允许「URL 导入 / Supabase」访问内网地址（默认禁止，防 SSRF） |
| `MAX_BODY_BYTES` | Node | 60MB | 请求体上限（导入大文件时用） |

Node 部署可复制 `.env.example` 为 `.env`；Cloudflare 本地开发复制 `.dev.vars.example` 为 `.dev.vars`。

> ⚠️ **安全提醒**：默认账号 `amos / sweet` 只是为了开箱即用。公网部署前请设置 `ADMIN_PASSWORD`，或首次登录后立刻在「用户管理」里改密码。

---

## 🚀 部署指南

### 方式一：Cloudflare Workers（推荐）+ D1

> Cloudflare 官方对新项目更推荐 Workers（带静态资源）。如果你更习惯 Pages，见「方式二」。

#### 1. 准备
- 一个 Cloudflare 账号；本机安装 Node.js ≥ 22（用来构建前端和运行 wrangler）。

```bash
git clone https://github.com/Amosgantian/nav-item.git
cd nav-item
npm install          # 安装 wrangler 与 bcryptjs
npm run build        # 构建前端 → web/dist
npx wrangler login   # 浏览器授权
```

#### 2. 创建 D1 数据库并绑定
```bash
npx wrangler d1 create nav-item-db
```
命令会输出类似：
```
[[d1_databases]]
binding = "DB"
database_name = "nav-item-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
把其中的 **`database_id`** 填进项目根目录 `wrangler.toml` 的 `[[d1_databases]]` 段（**`binding` 必须保持 `DB`**）。

> 表结构与默认数据**不需要手动初始化**：第一次请求时应用会自动建表并写入默认菜单/卡片。如果你想显式建表：
> `npx wrangler d1 migrations apply nav-item-db --remote`

#### 3. 部署并设置管理员密码
```bash
npx wrangler deploy                       # 部署 Worker + 静态资源
npx wrangler secret put ADMIN_PASSWORD    # 输入你的后台密码（首次初始化时使用）
npx wrangler secret put JWT_SECRET        # 可选：输入一段随机长字符串
```
管理员用户名在 `wrangler.toml` 的 `[vars]` 里（默认 `amos`）。
**请在首次访问网站之前执行 `secret put ADMIN_PASSWORD`**，因为管理员账号在第一次请求时创建；如果错过了，也可以登录后在「用户管理」里改密码。

#### 4. 访问
- 首页：`https://nav-item.<你的子域>.workers.dev`
- 后台：`/admin`
- 自定义域名：Cloudflare 控制台 → Workers & Pages → nav-item → Settings → Domains & Routes → Add。

#### 通过 Git 自动部署（Workers Builds）
1. 先按上面步骤 2 创建 D1，把 `database_id` 写入 `wrangler.toml` 并提交到你的仓库。
2. 控制台 → Workers & Pages → **Create** → **Import a repository** → 选你的仓库。
3. 构建设置：**Build command** `npm install && npm run build`；**Deploy command** `npx wrangler deploy`。
4. 部署完成后到 Worker 的 **Settings → Variables and Secrets** 添加 Secret：`ADMIN_PASSWORD`（和可选的 `JWT_SECRET`）。

#### 本地调试
```bash
cp .dev.vars.example .dev.vars   # 填入本地用的密码
npm run build
npx wrangler dev                 # 使用本地模拟的 D1，访问 http://localhost:8787
```

### 方式二：Cloudflare Pages + D1

1. 把项目推送到你的 GitHub/GitLab 仓库。
2. 控制台 → Workers & Pages → **Create** → **Pages** → **Connect to Git** → 选仓库。
3. 构建配置：
   - Framework preset：`None`
   - **Build command**：`npm install && npm run build`
   - **Build output directory**：`web/dist`
   - Root directory：`/`（留空）
4. 点 **Save and Deploy**（第一次因为没绑定 D1，访问 API 会提示「未绑定数据库」，这是正常的）。
5. 创建 D1：控制台 → **Storage & Databases → D1 → Create database**，名称 `nav-item-db`。
6. 绑定 D1：Pages 项目 → **Settings → Bindings → Add → D1 database**，**Variable name 填 `DB`**，选择 `nav-item-db`（Production 与 Preview 都要加的话各加一次）。
7. 添加 Secret：**Settings → Variables and Secrets** 添加 `ADMIN_PASSWORD`（和可选的 `JWT_SECRET`、`ADMIN_USERNAME`）。
8. 建议同时在 **Settings → Runtime → Compatibility flags** 添加 `nodejs_compat`（Workers 方式已在 `wrangler.toml` 里配置；这是给依赖包兜底用的）。
9. 回到 **Deployments → Retry deployment**（绑定、变量与兼容性标志对**新的**部署才生效）。

项目里的 `functions/[[path]].js` 会被 Pages 自动识别为 Functions；`web/public/_routes.json` 限定只有 `/api/*` 和 `/uploads/*` 才调用 Functions，其余是纯静态托管（不消耗 Functions 额度）。

用命令行直接上传（可选）：
```bash
npm run build
npx wrangler pages deploy web/dist --project-name nav-item
```
> 仓库根目录的 `wrangler.toml` 是 Workers 用的；Pages 会因缺少 `pages_build_output_dir` 而忽略它（可能出现一条警告，属正常）。D1 绑定请在控制台里配置。

### D1 数据库配置速查

| 项目 | 说明 |
| --- | --- |
| 绑定变量名 | 必须是 **`DB`** |
| 创建 | `npx wrangler d1 create nav-item-db` 或控制台创建 |
| 初始化 | 自动（首次请求）。也可 `wrangler d1 migrations apply nav-item-db --remote` |
| 直接查询 | `npx wrangler d1 execute nav-item-db --remote --command "SELECT COUNT(*) FROM cards"` |
| 命令行备份 | `npx wrangler d1 export nav-item-db --remote --output=backup.sql` |
| 命令行恢复 | `npx wrangler d1 execute nav-item-db --remote --file=backup.sql`（后台「导出 → SQL」生成的文件也可以这样执行） |
| 时间点恢复 | D1 自带 Time Travel：`npx wrangler d1 time-travel info nav-item-db` |

**D1 的限制（代码已按其设计，了解即可）**：免费版每次请求最多 50 条查询；单条语句最多 100 个绑定参数；单行最大 2MB（所以上传图片限制 1MB）。
应用已针对这些限制做了优化（在 D1 行为模拟器上实测，按“每条语句都算一次查询”的保守口径）：首页菜单列表 2 条、某菜单的卡片 1 条、登录 2 条；导入把多行合并成一条 `INSERT` 并放进同一个 batch（事务），把 187 张卡片的完整备份导入空库共 25 条（其中写入只有 1 个 batch），全部是重复记录时 8 条，预览 4 条。
如果备份特别大（几千张卡片），免费版可能超出 50 次查询/请求的限制，此时请用上表的 `wrangler d1 execute --file` 方式恢复。

---

### 方式三：自托管 · 源码部署（Node.js ≥ 22.13）

```bash
git clone https://github.com/Amosgantian/nav-item.git
cd nav-item
npm install                              # 后端依赖（仅 bcryptjs，无原生模块）
cd web && npm install && npm run build   # 构建前端
cd .. && npm start                       # 启动
```
- 前端地址：http://localhost:3000
- 后台管理：http://localhost:3000/admin
- 默认管理员账号：amos / sweet（请及时修改）
- 开发模式：根目录 `npm run dev`（后端），另开终端 `cd web && npm run dev`（前端，已配置接口代理到 3000 端口）

> 与旧版的区别：不再需要编译 `sqlite3` / `bcrypt` 等原生模块；但 Node 版本需 **≥ 22.13**（使用内置 `node:sqlite`）。

### 方式四：Docker 部署

#### 1. docker 快速部署
```bash
docker run -d \
  --name nav-item \
  -p 3000:3000 \
  -v $(pwd)/database:/app/database \
  -e NODE_ENV=production \
  -e ADMIN_USERNAME=amos \
  -e ADMIN_PASSWORD=sweet \
  eooce/nav-item
```
> 从旧版升级且旧版把图片放在 `uploads/` 目录时，再加一行 `-v $(pwd)/uploads:/app/uploads` 即可继续显示旧图片。新上传的图片存放在数据库里，随 `database/` 一起持久化。

#### 2. docker-compose.yaml 部署
```yaml
version: '3'

services:
  nav-item-backend:
    image: amosgantian/nav-item-backend
    container_name: navigation
    ports:
      - "3000:3000"
    environment:
      - PORT=3000             # 监听端口
      - ADMIN_USERNAME=amos  # 后台用户名
      - ADMIN_PASSWORD=sweet # 后台密码（务必修改）
    volumes:
      - ./database:/app/database  # 持久化数据库
    restart: unless-stopped
```

#### 3. 使用 docker image 配合环境变量部署
```
amosgantian/nav-item-backend
```
或
```
ghcr.io/amosgantian/nav-item:latest
```
> 以上镜像需由本仓库的 GitHub Actions 重新构建后才是 v2.0 版本（见 `.github/workflows/`）；也可以在项目目录里 `docker build -t nav-item .` 本地构建。

### 方式五：Debian / Ubuntu 一键部署（新）

脚本会：安装 Node.js 22 → 获取源码 → 安装依赖并构建前端 → 创建专用系统用户 → 注册 systemd 服务（开机自启、崩溃自动重启）→（可选）Nginx 反向代理 + HTTPS。需要 root。

**在线一键**（把命令里的仓库地址换成你自己的，前提是你已把本项目推送到该仓库）：
```bash
bash <(curl -Ls https://raw.githubusercontent.com/Amosgantian/nav-item/main/scripts/install-debian.sh)
```

**本地运行**（已下载 / 解压项目）：
```bash
cd nav-item
sudo bash scripts/install-debian.sh
```

**带参数**（环境变量写在命令前面）：
```bash
# 指定端口、管理员、密码，并绑定域名 + 自动申请 HTTPS 证书
sudo PORT=3000 ADMIN_USERNAME=amos ADMIN_PASSWORD='你的强密码' \
     DOMAIN=nav.example.com EMAIL=me@example.com \
     bash scripts/install-debian.sh
```
不设置 `ADMIN_PASSWORD` 时会随机生成并在结束时显示（同时保存在 `/opt/nav-item/.env`）。

| 子命令 | 说明 |
| --- | --- |
| `install`（默认） | 安装 |
| `update` | 更新程序：先备份数据库（保留最近 5 份），保留 `.env` 与数据，重新构建并重启 |
| `uninstall` | 卸载服务；`PURGE=1` 时连同数据库一起删除 |
| `status` / `restart` / `logs` | 查看状态 / 重启 / 实时日志 |

其它可用变量：`INSTALL_DIR`（默认 `/opt/nav-item`）、`REPO_URL`、`BRANCH`、`NODE_MAJOR`。
HTTPS 需要域名已解析到本机且 80/443 端口开放。

### serv00 | ct8 | Hostuno 一键安装脚本
- 环境变量，放在脚本前，随脚本一起运行，英文空隔隔开
- 后台管理用户名和密码默认分别为为`amos`和`sweet`
  * `DOMAIN`为自定义站点域名

```bash
bash <(curl -Ls https://github.com/Amosgantian/nav-item/releases/download/nav/nav_install.sh)
```
> 该脚本托管在原仓库的 Releases 里，本次改造没有改动它。v2.0 需要 **Node.js ≥ 22.13**，使用前请确认主机提供该版本；如果主机的 Node 较旧，请改用 Cloudflare / Docker 方式。使用新版代码需要重新发布对应的 Release 包。

---

## 🗄️ 后台「数据库管理」使用指南

登录后台 → 左侧 **数据库管理**。

### 概览
引擎（D1 / SQLite）、数据库大小、记录总数、响应延迟、完整性检查（`PRAGMA quick_check`）、外键检查、各表记录数（点「浏览」可查看内容）、最近一次导入/导出。

### 导出（存档到其它设备）
- 选择数据表，格式二选一：
  - **JSON**（推荐）：可在本页「导入」恢复；
  - **SQL**：含建表语句，用 UPSERT 写成，可重复执行，适合 `wrangler d1 execute --file` 或 `sqlite3`。
- 账号表（含密码哈希）和上传图片默认不选，需要时手动勾选。
- JWT 密钥与远程连接密钥**永远不会**写入导出文件。

定时备份（可选）：
```bash
TOKEN=$(curl -s -X POST https://你的域名/api/login -H 'Content-Type: application/json' \
        -d '{"username":"amos","password":"你的密码"}' | jq -r .token)
curl -s -H "Authorization: Bearer $TOKEN" "https://你的域名/api/db/export?format=json" -o nav-backup.json
```

### 导入（支持跳过 / 覆盖）
1. 选择来源：本地 `.json` 文件，或「云端下载地址」。
2. 选择要导入的表、**相同记录的处理方式**（跳过 / 覆盖）、**导入方式**（合并 / 替换）。
3. 点 **预览导入结果**：统计新增 / 覆盖 / 无变化 / 跳过 / 无效，不写入任何数据。
4. 确认无误后点 **确认导入**。整个导入在一个事务里完成，失败不会留下半份数据。

**怎么判断“相同记录”**（不看 ID，因为不同数据库的 ID 本来就不同）：

| 数据 | 判定依据 |
| --- | --- |
| 栏目 | 名称 |
| 子栏目 | 所属栏目 + 名称 |
| 卡片 | 所属栏目（或子栏目）+ 标题 + 网址 |
| 广告 | 位置 + 图片 |
| 友情链接 | 网址（忽略末尾斜杠和主机大小写） |
| 账号 | 用户名 |
| 图片 | 文件名 |

- **跳过**：保留现有数据，只追加新记录；**覆盖**：以导入的为准更新重复记录（卡片更新 logo/描述/排序，栏目更新排序等）。
- 新记录会自动追加，并自动把卡片挂到正确的栏目/子栏目下（外键重映射）；勾选「卡片」会自动连带栏目与子栏目。
- **替换**：先清空所选表再按备份还原（保留原 ID）。栏目/子栏目/卡片相互关联，会一并替换。请先导出备份。
- 账号默认不导入（避免把自己锁在外面）。
- 也能导入「卡片平铺列表」格式（JSON 数组，每项含 `title/url/logo_url/desc/order/menu/subMenu`），缺失的栏目会自动创建。

### 云端下载地址导入
填入备份 JSON 的下载地址，服务器会代你下载并导入：
- 支持 GitHub 页面链接（`github.com/.../blob/...` 自动转 raw）、Gist、R2 / S3 / Supabase Storage 的公开链接或预签名链接；
- 私有文件可填 `Authorization`（如 `Bearer xxx`），只保存在服务器、不会回显；
- 上限 40 MB；默认禁止访问内网地址（`ALLOW_PRIVATE_NETWORK=true` 可放开）。

### Supabase / PostgREST 同步
1. 在 [supabase.com](https://supabase.com) 创建项目。
2. 在本页「远程同步」点 **查看建表脚本 → 复制**，到 Supabase 控制台 **SQL Editor** 执行一次（会创建 `nav_menus / nav_sub_menus / nav_cards / nav_ads / nav_friends` 并开启 RLS）。
3. 在 Supabase **Project Settings → API Keys** 取得 **Project URL** 和 **secret key**（旧版项目用 `service_role` key；新旧格式都支持）。
4. 回到本页填写：Project URL（或只填项目 ref）、API Key、Schema（默认 `public`）、表前缀（默认 `nav_`），点 **保存连接 → 测试连接**（会逐表显示是否存在及行数）。
5. **推送**：把本地数据写到 Supabase。*合并* 按 ID 更新/新增；*镜像* 先清空远程再写入。**拉取**：读取远程并按上面的导入规则合并到本地（先预览再确认）。

> 💡 这套接口基于 PostgREST，因此**也兼容自建 Supabase 和其它 PostgREST 服务**。
> 🔒 密钥保存在你自己的数据库里（页面不回显、不会被导出）。请使用 **secret / service_role** 密钥并保持 RLS 开启；**不要**把 publishable / anon 密钥配合“开放策略”使用，否则任何人都能读写这些表。

### 数据浏览与 SQL 控制台
只读浏览任意表（支持搜索、分页；账号表不显示哈希、图片表不显示内容）。SQL 控制台只允许单条 `SELECT`，最多返回 200 行，不能查询 `settings` 表。

### 从旧版（原项目）迁移数据
- **自托管升级**：直接用新版程序打开旧的 `database/nav.db` 即可，应用会自动补齐新增的列和表，数据原样保留（旧的 bcrypt 密码也能登录，登录后自动升级）。
- **迁移到 Cloudflare D1**：
  ```bash
  node scripts/old-db-to-json.js database/nav.db my-old-data.json        # 需要 Node ≥ 22.13
  ```
  然后在后台「导入」里选择这个 JSON。默认不含账号（D1 上用 `ADMIN_PASSWORD` 创建新管理员）；需要迁移账号时加 `--with-users`。

---

## 🎨 主题皮肤

右上角调色盘（手机在右下角）可切换：**经典 / 海洋蓝 / 彩虹 / 玫瑰 / 山林 / 晚霞 / 朝阳**。主题会同时应用于首页和后台。
- 访客的选择保存在自己浏览器的 `localStorage`；
- 管理员在后台点调色盘 →「设为站点默认主题」，可决定访客**第一次**打开时看到的主题；
- 动态光效使用 CSS 动画，系统开启“减少动态效果”时自动关闭；
- 想改配色或新增主题：编辑 `web/src/styles/themes.css`（每个主题就是一组 CSS 变量）并在 `web/src/composables/useTheme.js` 的 `THEMES` 里登记。

## 🧭 内置 Logo

`web/public/logos/` 下有 7 个 emoji 风格的 SVG：指南针、地球、火箭、链接、书签、定位、星标。
- 卡片没填 Logo 链接时，按「标题 + 网址」的哈希**稳定地**分配其中一个（每张卡片固定，不会每次刷新都变；也不依赖卡片 ID，所以导出再导入后保持不变）；
- 后台「卡片管理」每行的 Logo 输入框左边有选择按钮，可手动选择任意一个，选「🎲 自动」则清空链接回到自动分配；
- 自己填写的 Logo 链接加载失败时，会回退到内置 Logo；
- 想增删 Logo：放入 SVG 并编辑 `web/src/utils/logos.js` 的 `BUILTIN_LOGOS`。

## 🧪 测试

```bash
npm test
```
共 120 项，覆盖：全部 REST 接口（同一套用例分别跑在 `node:sqlite` 和带 D1 限制的行为模拟器上）、导入导出（去重、外键重映射、预览、事务回滚、SQL 导出可执行）、Supabase 连接器（本地模拟的 PostgREST 服务：请求头、分页、upsert、错误映射）、云端下载与 SSRF 防护、Workers / Pages 入口、旧版 `nav.db` 兼容、Node 服务器（SPA 回退、gzip、路径穿越、旧上传目录）。

## 🔁 与旧版的行为差异（请留意）

| 变化 | 原因 / 说明 |
| --- | --- |
| 后端由 Express 改为 Web 标准处理函数 | 才能同时跑在 Workers / Pages / Node。**所有 `/api/*` 路径与返回结构保持不变** |
| Node 需 ≥ 22.13，`sqlite3`/`bcrypt` 改为内置 `node:sqlite` + `bcryptjs` | 省去原生编译；Workers 也无法使用原生模块 |
| 密码改用 PBKDF2-SHA256 | 旧 bcrypt 哈希仍可登录并自动升级。**Cloudflare 免费版**（单请求 CPU 时间很短）下，校验旧 bcrypt 哈希可能超限，所以导入时默认不带账号 |
| `POST /api/upload` 现在需要登录 | 原接口无鉴权，部署到公网后任何人都能往库里灌数据 |
| 上传图片存入数据库（`uploads` 表），经 `/uploads/文件名` 访问 | Workers 没有本地磁盘；好处是图片随备份一起导出。旧版磁盘 `uploads/` 里的文件仍可读取 |
| 外键级联删除真正生效：删除栏目会同时删除其子栏目和卡片 | 原表结构里声明了 `ON DELETE CASCADE`，但 SQLite 默认不启用外键，所以原来是孤儿数据；D1 始终启用 |
| 修改卡片时保留已有的 `custom_logo_path` | 原接口会把它清空 |
| 没有 Logo 链接的卡片显示内置 emoji Logo，不再去猜 `网站/favicon.ico` | 按需求 8 |
| 默认数据修正：栏目名 `Domain&Mail`→`Mail&Domain`（原来 6 张卡片因名称写反从未被写入）；清空 4 个被截断而无法显示的 base64 Logo | 数据本身的小问题 |
| `index.html` 去掉指向 serv00 的外链图标，只用本地 `default-favicon.png` | 减少对外部站点的依赖 |
| `npm run dev` 的前端新增到 3000 端口的接口代理 | 原来开发模式下前端请求不到后端 |

## 🤝 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情
