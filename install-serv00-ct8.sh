#!/usr/bin/env bash
# =============================================================================
# nav-item · Serv00 / CT8 / Hostuno 安装脚本
# 项目：https://github.com/gansweet/nav-item
# 要求：主机提供 Node.js >= 22.13；需要 devil、curl 或 wget、tar、npm。
#
# 使用：
#   bash <(curl -fsSL https://raw.githubusercontent.com/gansweet/nav-item/main/install-serv00-ct8.sh)
#   DOMAIN=nav.example.com ADMIN_USERNAME=amos ADMIN_PASSWORD='请设置强密码' \
#     bash <(curl -fsSL https://raw.githubusercontent.com/gansweet/nav-item/main/install-serv00-ct8.sh)
#
# 环境变量：DOMAIN、ADMIN_USERNAME、ADMIN_PASSWORD、PORT、BRANCH、SOURCE_URL。
# 脚本会保留现有 .env、database/ 与 uploads/；不会覆盖非 Node.js 类型的网站。
# =============================================================================
set -Eeuo pipefail
export LC_ALL=C

APP_NAME='nav-item'
REPO_SLUG="${REPO_SLUG:-gansweet/nav-item}"
BRANCH="${BRANCH:-main}"
SOURCE_URL="${SOURCE_URL:-https://github.com/${REPO_SLUG}/archive/refs/heads/${BRANCH}.tar.gz}"
PORT="${PORT:-3000}"
ADMIN_USERNAME="${ADMIN_USERNAME:-amos}"
DOMAIN_WAS_SET=0
[[ -n "${DOMAIN:-}" ]] && DOMAIN_WAS_SET=1

c_reset=$'\033[0m'
c_red=$'\033[1;91m'
c_green=$'\033[1;32m'
c_yellow=$'\033[1;33m'
c_purple=$'\033[1;35m'
c_cyan=$'\033[1;36m'
info() { printf '%s[信息]%s %s\n' "$c_cyan" "$c_reset" "$*"; }
ok()   { printf '%s[完成]%s %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%s[提醒]%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
die()  { printf '%s[错误]%s %s\n' "$c_red" "$c_reset" "$*" >&2; exit 1; }

TMP_DIR=''
cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup EXIT
on_error() {
  local rc=$?
  printf '\n%s[错误]%s 脚本在第 %s 行执行失败（退出码 %s）。请检查上方输出。\n' \
    "$c_red" "$c_reset" "${BASH_LINENO[0]:-未知}" "$rc" >&2
  exit "$rc"
}
trap on_error ERR

random_hex() {
  local bytes="${1:-24}"
  od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
}

node_version_ok() {
  local bin="$1" version major minor
  version="$("$bin" -v 2>/dev/null | sed 's/^v//')" || return 1
  if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\. ]]; then
    return 1
  fi
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  (( major > 22 || (major == 22 && minor >= 13) ))
}

# Serv00/CT8 的 WWW Node 应用需要使用 /usr/local/bin 下的版本化运行时。
# 优先选择稳定的 Node 22，再依次选择主机可能提供的较新版本。
find_node_runtime() {
  local major node_bin npm_bin
  for major in 22 24 26 23 25; do
    node_bin="/usr/local/bin/node${major}"
    npm_bin="/usr/local/bin/npm${major}"
    [[ -x "$node_bin" ]] || continue
    [[ -x "$npm_bin" ]] || continue
    node_version_ok "$node_bin" || continue
    NODE_BIN="$node_bin"
    NPM_BIN="$npm_bin"
    NODE_MAJOR="$major"
    return 0
  done
  return 1
}

get_current_site_line() {
  devil www list 2>/dev/null | awk -v domain="$CURRENT_DOMAIN" '$1 == domain { print; exit }'
}

# 下载支持 curl / wget；源码从指定仓库分支压缩包获取，不依赖 git。
download_file() {
  local url="$1" output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 2 --connect-timeout 20 --max-time 300 "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -q --tries=3 --timeout=30 -O "$output" "$url"
  else
    die '未找到 curl 或 wget，请先在主机环境中提供其中一个工具。'
  fi
}

# ------------------------ 前置检查 ------------------------
[[ "${BASH_VERSION:-}" ]] || die '请使用 Bash 执行本脚本。'
command -v devil >/dev/null 2>&1 || die '未找到 devil 命令。本脚本仅用于 Serv00 / CT8 / Hostuno 等 Devil 主机。'
command -v tar >/dev/null 2>&1 || die '未找到 tar 命令。'
command -v awk >/dev/null 2>&1 || die '未找到 awk 命令。'
command -v od >/dev/null 2>&1 || die '未找到 od 命令，无法生成安全的随机密码。'

if ! find_node_runtime; then
  die '未检测到可用的 Node.js >= 22.13 及对应 npm（例如 /usr/local/bin/node22 和 npm22）。请在主机面板确认已提供 Node.js 22 或更高版本；本脚本不会尝试安装系统级 Node.js。'
fi

# 让构建命令明确使用上面检测到的同一套 Node/npm。
mkdir -p "$HOME/bin" "$HOME/.npm-global"
ln -sfn "$NODE_BIN" "$HOME/bin/node"
ln -sfn "$NPM_BIN" "$HOME/bin/npm"
export PATH="$HOME/.npm-global/bin:$HOME/bin:$PATH"

if ! grep -Fq '.npm-global/bin' "$HOME/.bash_profile" 2>/dev/null; then
  printf '\n# nav-item Node.js CLI PATH\nexport PATH="$HOME/.npm-global/bin:$HOME/bin:$PATH"\n' >> "$HOME/.bash_profile"
fi

# ------------------------ 识别主域名 ------------------------
HOST_NAME="$(hostname 2>/dev/null || printf 'unknown')"
LOGIN_NAME="$(id -un 2>/dev/null || whoami)"
LOGIN_NAME="$(printf '%s' "$LOGIN_NAME" | tr '[:upper:]' '[:lower:]')"

if [[ -z "${DOMAIN:-}" ]]; then
  if [[ "$HOST_NAME" == *ct8* ]]; then
    CURRENT_DOMAIN="${LOGIN_NAME}.ct8.pl"
  elif [[ "$HOST_NAME" == *hostuno* ]]; then
    CURRENT_DOMAIN="${LOGIN_NAME}.useruno.com"
  else
    CURRENT_DOMAIN="${LOGIN_NAME}.serv00.net"
  fi
else
  CURRENT_DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
fi

[[ "$CURRENT_DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || \
  die "域名格式不正确：${CURRENT_DOMAIN}。请设置 DOMAIN=example.com，不要包含 http:// 或路径。"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "PORT 必须是数字，当前值：${PORT}"

WORKDIR="${HOME}/domains/${CURRENT_DOMAIN}/public_nodejs"
ENV_FILE="${WORKDIR}/.env"
DB_FILE="${WORKDIR}/database/nav.db"

info "项目：${REPO_SLUG}（分支 ${BRANCH}）"
info "站点：${CURRENT_DOMAIN}"
info "项目目录：${WORKDIR}"
info "Node.js：$("$NODE_BIN" -v)，npm：$(PATH="$HOME/bin:$PATH" "$NPM_BIN" -v)"

# 已存在的 PHP/静态网站不能由脚本自动删除或替换，以免误删用户站点。
SITE_LINE="$(get_current_site_line || true)"
if [[ -n "$SITE_LINE" ]]; then
  SITE_TYPE="$(printf '%s\n' "$SITE_LINE" | awk '{print tolower($2)}')"
  [[ "$SITE_TYPE" == 'nodejs' ]] || die "域名 ${CURRENT_DOMAIN} 已存在，但类型不是 Node.js：${SITE_LINE}。为避免删除现有网站，脚本已停止；请先在 Devil 面板中处理该域名，或指定另一个 DOMAIN。"
fi

# ------------------------ 获取与部署源码 ------------------------
TMP_DIR="$(mktemp -d "${TMPDIR:-$HOME}/nav-item-install.XXXXXX")"
ARCHIVE="${TMP_DIR}/source.tar.gz"
SOURCE_DIR="${TMP_DIR}/source"
mkdir -p "$SOURCE_DIR" "$WORKDIR"

HAD_DATABASE=0
[[ -s "$DB_FILE" ]] && HAD_DATABASE=1

info '正在下载仓库源码……'
download_file "$SOURCE_URL" "$ARCHIVE"
if ! tar -tzf "$ARCHIVE" >/dev/null 2>&1; then
  die "下载文件不是有效的 gzip/tar 源码包：${SOURCE_URL}。请确认仓库与 BRANCH 设置正确。"
fi
tar -xzf "$ARCHIVE" --strip-components=1 -C "$SOURCE_DIR"
[[ -f "$SOURCE_DIR/app.js" && -f "$SOURCE_DIR/package.json" && -f "$SOURCE_DIR/web/package.json" ]] || \
  die '下载的源码缺少 app.js、package.json 或 web/package.json，已停止以避免部署不完整的程序。'

info '正在复制程序文件（保留现有 .env、database/ 和 uploads/）……'
# .env 只需保存一份很小的副本。当前仓库将 database/、uploads/ 加入 .gitignore，
# 源码归档不会带上这些运行数据，因此不复制大型数据库/上传目录，避免耗尽共享主机配额。
PRESERVE_ENV="${TMP_DIR}/existing.env"
[[ -f "$WORKDIR/.env" ]] && cp -p "$WORKDIR/.env" "$PRESERVE_ENV"
cp -a "$SOURCE_DIR"/. "$WORKDIR"/
[[ -f "$PRESERVE_ENV" ]] && cp -p "$PRESERVE_ENV" "$WORKDIR/.env"

mkdir -p "$WORKDIR/database" "$WORKDIR/uploads"
chmod 755 "$WORKDIR" "$WORKDIR/database" "$WORKDIR/uploads" 2>/dev/null || true

# Passenger/Devil 主机可能在 public/ 放置默认欢迎页；项目自己通过 web/dist 提供页面。
# 只清理默认 index.html，不删除目录中的其它用户文件。
if [[ -f "$WORKDIR/public/index.html" ]]; then
  rm -f "$WORKDIR/public/index.html"
fi

# ------------------------ 运行配置 ------------------------
ENV_CREATED=0
GENERATED_PASSWORD=''
if [[ -f "$ENV_FILE" ]]; then
  info '检测到现有 .env，保留原配置和管理员设置。'
else
  if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
    GENERATED_PASSWORD="$ADMIN_PASSWORD"
  else
    GENERATED_PASSWORD="$(random_hex 18)"
  fi
  JWT_SECRET_VALUE="${JWT_SECRET:-$(random_hex 32)}"
  [[ "$ADMIN_USERNAME" != *$'\n'* && "$ADMIN_USERNAME" != *$'\r'* ]] || die 'ADMIN_USERNAME 不可包含换行符。'
  [[ "$GENERATED_PASSWORD" != *$'\n'* && "$GENERATED_PASSWORD" != *$'\r'* ]] || die 'ADMIN_PASSWORD 不可包含换行符。'
  [[ "$JWT_SECRET_VALUE" != *$'\n'* && "$JWT_SECRET_VALUE" != *$'\r'* ]] || die 'JWT_SECRET 不可包含换行符。'
  umask 077
  {
    printf '# nav-item runtime configuration\n'
    printf 'PORT=%s\n' "$PORT"
    printf 'ADMIN_USERNAME=%s\n' "$ADMIN_USERNAME"
    printf 'ADMIN_PASSWORD=%s\n' "$GENERATED_PASSWORD"
    printf 'JWT_SECRET=%s\n' "$JWT_SECRET_VALUE"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ENV_CREATED=1
  ok '已生成 .env（权限为 600）。'
fi

# ------------------------ 安装依赖与构建前端 ------------------------
info '正在安装后端生产依赖……'
(cd "$WORKDIR" && npm install --omit=dev --no-audit --no-fund)

info '正在安装前端依赖并构建 web/dist……'
(cd "$WORKDIR/web" && npm install --no-audit --no-fund && npm run build)
[[ -s "$WORKDIR/web/dist/index.html" ]] || die '前端构建结束，但未找到 web/dist/index.html。请查看上方 npm 输出。'
# 生产运行只需要已构建的 dist；删除前端构建依赖以节省共享主机空间。
rm -rf "$WORKDIR/web/node_modules"
ok '后端依赖安装与前端构建成功。'

# ------------------------ 创建或更新 Node.js 站点 ------------------------
SITE_LINE="$(get_current_site_line || true)"
if [[ -z "$SITE_LINE" ]]; then
  info "正在创建 Node.js 站点 ${CURRENT_DOMAIN}……"
  devil www add "$CURRENT_DOMAIN" nodejs "$NODE_BIN" || \
    die "创建站点失败。请检查域名是否已添加到主机账号、Node.js 版本是否受支持，以及 devil www add 的错误信息。"
else
  SITE_TYPE="$(printf '%s\n' "$SITE_LINE" | awk '{print tolower($2)}')"
  [[ "$SITE_TYPE" == 'nodejs' ]] || die "域名类型已发生变化，拒绝覆盖：${SITE_LINE}"
  if ! printf '%s\n' "$SITE_LINE" | grep -Fq "$NODE_BIN"; then
    warn "现有 Node.js 站点使用的运行时可能不符合要求，将重新创建该 Node.js 虚拟主机（项目数据目录不会删除）。"
    devil www del "$CURRENT_DOMAIN" || die "删除旧 Node.js 虚拟主机失败：${CURRENT_DOMAIN}"
    devil www add "$CURRENT_DOMAIN" nodejs "$NODE_BIN" || \
      die "使用 ${NODE_BIN} 创建 Node.js 站点失败，请检查 Devil 主机的 Node.js 支持情况。"
  else
    info '站点已经使用符合要求的 Node.js 运行时。'
  fi
fi

# 每次部署后重启站点，让 Passenger/Devil 重新加载 app.js。
if devil www restart "$CURRENT_DOMAIN" >/dev/null 2>&1; then
  ok '已请求重启网站。'
else
  warn 'devil www restart 未返回成功；请在面板重启该 Node.js 站点后再访问。'
fi

# ------------------------ 安装结果 ------------------------
printf '\n%s========================================%s\n' "$c_green" "$c_reset"
printf '%s%s 安装流程已完成%s\n' "$c_green" "$APP_NAME" "$c_reset"
printf '站点地址：      %shttps://%s/%s\n' "$c_purple" "$CURRENT_DOMAIN" "$c_reset"
printf '后台管理入口：  %shttps://%s/admin%s\n' "$c_purple" "$CURRENT_DOMAIN" "$c_reset"
printf '项目目录：      %s\n' "$WORKDIR"
printf 'Node.js 运行时：%s（%s）\n' "$NODE_BIN" "$("$NODE_BIN" -v)"
printf '数据库文件：    %s\n' "$DB_FILE"

if [[ "$HAD_DATABASE" -eq 1 ]]; then
  warn '检测到安装前已有数据库：原有账号和密码以数据库中的用户记录为准；请使用你之前的登录凭据。'
  warn '原有 .env（若存在）也已保留，没有自动重置管理员密码。'
elif [[ "$ENV_CREATED" -eq 1 ]]; then
  printf '\n%s首次初始化管理员账号%s\n' "$c_yellow" "$c_reset"
  printf '用户名：%s\n' "$ADMIN_USERNAME"
  printf '密码：  %s\n' "$GENERATED_PASSWORD"
  warn '请立即登录后台修改密码，并妥善保存该密码。'
else
  warn '保留了现有 .env。首次访问时请使用其中的管理员设置；如果数据库已有账号，实际登录凭据以数据库为准。'
fi

if [[ "$DOMAIN_WAS_SET" -eq 1 ]]; then
  SERVER_IP="$(devil vhost list 2>/dev/null | awk 'tolower($2) ~ /web/ {print $1; exit}')"
  printf '\n%s自定义域名提示%s\n' "$c_yellow" "$c_reset"
  printf '请确认 %s 已添加到主机账号并指向此 Node.js 站点。\n' "$CURRENT_DOMAIN"
  if [[ -n "$SERVER_IP" ]]; then
    printf '主机检测到的 Web IP（仅供核对）：%s\n' "$SERVER_IP"
  fi
  printf '若通过 Cloudflare 代理，请按主机商对该域名的要求配置 DNS，再测试 HTTPS。\n'
fi

if command -v curl >/dev/null 2>&1; then
  HTTP_CODE="$(curl -k -sS --max-time 12 -o /dev/null -w '%{http_code}' "https://${CURRENT_DOMAIN}/" 2>/dev/null || true)"
  if [[ "$HTTP_CODE" == '200' ]]; then
    ok 'HTTPS 首页返回 HTTP 200。'
  else
    warn "当前 HTTPS 检查返回 ${HTTP_CODE:-无响应}。这不一定代表安装失败，也可能是 DNS、证书或主机站点重启尚未完成；请稍后访问站点并检查 devil www list。"
  fi
fi

printf '\n%s仓库地址：%shttps://github.com/%s%s\n' "$c_green" "$c_purple" "$REPO_SLUG" "$c_reset"
printf '%s安装目录：%s\n' "$c_green" "$WORKDIR"
printf '%s========================================%s\n' "$c_green" "$c_reset"
