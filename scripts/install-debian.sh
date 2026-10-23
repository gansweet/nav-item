#!/usr/bin/env bash
# =============================================================================
#  nav-item · Debian / Ubuntu 一键部署脚本
#
#  功能：安装 Node.js 22 → 获取源码 → 安装依赖并构建前端 → 注册 systemd 服务 → （可选）Nginx 反向代理 + HTTPS
#
#  用法（需要 root）：
#    在线一键：  bash <(curl -Ls https://raw.githubusercontent.com/Amosgantian/nav-item/main/scripts/install-debian.sh)
#    本地运行：  sudo bash scripts/install-debian.sh            # 在解压后的项目目录里执行，使用本地源码
#    子命令：    install（默认） | update | uninstall | status | restart | logs
#
#  常用环境变量（写在命令前面，空格分隔）：
#    PORT=3000                    服务监听端口
#    ADMIN_USERNAME=amos          后台用户名（仅首次初始化数据库时生效）
#    ADMIN_PASSWORD=xxxx          后台密码；不设置则随机生成并在结束时显示（务必记录）
#    DOMAIN=nav.example.com       设置后自动安装 Nginx 并反向代理到本服务
#    EMAIL=me@example.com         与 DOMAIN 同时设置时，用 certbot 申请 Let's Encrypt 证书并启用 HTTPS
#    INSTALL_DIR=/opt/nav-item    安装目录
#    REPO_URL / BRANCH            源码仓库与分支（在线安装时使用）
#    PURGE=1                      uninstall 时连同数据库一起删除（默认保留）
# =============================================================================
set -euo pipefail

APP_NAME="nav-item"
REPO_URL="${REPO_URL:-https://github.com/Amosgantian/nav-item.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/nav-item}"
PORT="${PORT:-3000}"
ADMIN_USERNAME="${ADMIN_USERNAME:-amos}"
NODE_MAJOR="${NODE_MAJOR:-22}"
SERVICE_USER="${SERVICE_USER:-nav-item}"
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
# 下面几个开关主要给测试 / 特殊环境用
NAV_SKIP_APT="${NAV_SKIP_APT:-0}"
NAV_SKIP_NPM="${NAV_SKIP_NPM:-0}"
NAV_SKIP_USER="${NAV_SKIP_USER:-0}"
NAV_SKIP_SYSTEMD="${NAV_SKIP_SYSTEMD:-0}"
NAV_SKIP_ROOT_CHECK="${NAV_SKIP_ROOT_CHECK:-0}"

SERVICE_FILE="${SYSTEMD_DIR}/${APP_NAME}.service"
ENV_FILE="${INSTALL_DIR}/.env"
GENERATED_PASSWORD=""

# ---------- 输出 ----------
c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_cyan=$'\033[36m'; c_off=$'\033[0m'
info() { echo "${c_cyan}[nav-item]${c_off} $*"; }
ok()   { echo "${c_green}[ ok ]${c_off} $*"; }
warn() { echo "${c_yellow}[warn]${c_off} $*" >&2; }
die()  { echo "${c_red}[fail]${c_off} $*" >&2; exit 1; }

# ---------- 前置检查 ----------
require_root() {
  [ "$NAV_SKIP_ROOT_CHECK" = "1" ] && return 0
  [ "$(id -u)" -eq 0 ] || die "请使用 root 运行：sudo bash $0（或先 sudo -i）"
}

check_os() {
  [ "$NAV_SKIP_APT" = "1" ] && return 0
  command -v apt-get >/dev/null 2>&1 || die "此脚本仅支持 Debian / Ubuntu（需要 apt-get）。其它系统请参考 README 的 Docker 或源码部署。"
}

apt_install() {
  [ "$NAV_SKIP_APT" = "1" ] && { info "跳过 apt 安装：$*"; return 0; }
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

# 返回 0 表示当前 node 满足 >= 22.13（node:sqlite 无需实验开关的最低版本）
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -v | sed 's/^v//')"
  major="${v%%.*}"; minor="$(echo "$v" | cut -d. -f2)"
  [ "$major" -gt 22 ] && return 0
  [ "$major" -eq 22 ] && [ "$minor" -ge 13 ] && return 0
  return 1
}

install_node() {
  if node_ok; then ok "已检测到 Node.js $(node -v)，跳过安装"; return 0; fi
  [ "$NAV_SKIP_APT" = "1" ] && die "需要 Node.js >= 22.13，当前：$(node -v 2>/dev/null || echo 未安装)"
  info "安装 Node.js ${NODE_MAJOR}.x（NodeSource）…"
  apt-get update -y
  apt_install curl ca-certificates gnupg
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt_install nodejs
  node_ok || die "Node.js 安装后版本仍不满足要求（需要 >= 22.13）：$(node -v)"
  ok "Node.js $(node -v) 安装完成"
}

# ---------- 获取源码 ----------
script_dir() {
  local src="${BASH_SOURCE[0]:-$0}"
  case "$src" in /dev/fd/*|/proc/*|bash|-bash) return 1 ;; esac
  [ -f "$src" ] || return 1
  (cd "$(dirname "$src")" && pwd)
}

local_project_root() {
  local d root
  d="$(script_dir)" || return 1
  root="$(cd "$d/.." && pwd)"
  if [ -f "$root/package.json" ] && [ -f "$root/app.js" ] && grep -q '"name": "nav-item"' "$root/package.json"; then
    echo "$root"; return 0
  fi
  return 1
}

fetch_source() {
  local local_root=""
  local_root="$(local_project_root || true)"
  mkdir -p "$INSTALL_DIR"
  if [ -n "$local_root" ] && [ "$(cd "$local_root" && pwd)" != "$(cd "$INSTALL_DIR" && pwd)" ]; then
    info "使用本地源码：$local_root → $INSTALL_DIR"
    # 保留 .env 与 database；不复制 node_modules / .git / 旧的构建产物
    (cd "$local_root" && tar --exclude=./node_modules --exclude=./web/node_modules --exclude=./.git \
        --exclude=./database --exclude=./.env --exclude=./web/dist -cf - .) | (cd "$INSTALL_DIR" && tar -xf -)
  elif [ -d "$INSTALL_DIR/.git" ]; then
    info "更新源码（git pull）…"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
  elif [ -n "$local_root" ]; then
    info "已在安装目录内运行，直接使用当前源码"
  else
    command -v git >/dev/null 2>&1 || apt_install git
    info "克隆源码：$REPO_URL（$BRANCH）→ $INSTALL_DIR"
    if [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
      die "$INSTALL_DIR 已存在且不是 git 仓库。请换一个 INSTALL_DIR，或清空该目录后重试。"
    fi
    git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
  [ -f "$INSTALL_DIR/app.js" ] || die "源码不完整：$INSTALL_DIR/app.js 不存在"
}

# ---------- 配置 ----------
rand_str() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-16}" || true; }

write_env() {
  if [ -f "$ENV_FILE" ]; then
    ok "保留已有配置：$ENV_FILE"
    return 0
  fi
  local pass="${ADMIN_PASSWORD:-}"
  if [ -z "$pass" ]; then pass="$(rand_str 16)"; GENERATED_PASSWORD="$pass"; fi
  umask 077
  cat > "$ENV_FILE" <<EOF
# nav-item 运行配置（由 install-debian.sh 生成，可手动修改后执行：systemctl restart ${APP_NAME}）
PORT=${PORT}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${pass}
JWT_SECRET=${JWT_SECRET:-$(rand_str 48)}
# ALLOW_PRIVATE_NETWORK=true
EOF
  ok "已生成配置：$ENV_FILE"
}

env_value() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }

ensure_user() {
  [ "$NAV_SKIP_USER" = "1" ] && return 0
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
    ok "已创建系统用户 $SERVICE_USER"
  fi
}

fix_permissions() {
  [ "$NAV_SKIP_USER" = "1" ] && return 0
  mkdir -p "$INSTALL_DIR/database" "$INSTALL_DIR/uploads"
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
}

# ---------- 构建 ----------
build_app() {
  [ "$NAV_SKIP_NPM" = "1" ] && { info "跳过 npm 安装与前端构建"; return 0; }
  info "安装后端依赖…"
  (cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund)
  info "构建前端（首次约 1~3 分钟）…"
  (cd "$INSTALL_DIR/web" && npm install --no-audit --no-fund && npm run build)
  rm -rf "$INSTALL_DIR/web/node_modules"      # 构建完成后不再需要，节省磁盘
  [ -f "$INSTALL_DIR/web/dist/index.html" ] || die "前端构建失败：web/dist/index.html 不存在"
  ok "构建完成"
}

backup_db() {
  local db="$INSTALL_DIR/database/nav.db"
  [ -f "$db" ] || return 0
  local ts; ts="$(date +%Y%m%d%H%M%S)"
  cp -p "$db" "$INSTALL_DIR/database/nav.db.bak-$ts"
  ok "已备份数据库：database/nav.db.bak-$ts"
  # 只保留最近 5 份备份
  ls -1t "$INSTALL_DIR"/database/nav.db.bak-* 2>/dev/null | tail -n +6 | xargs -r rm -f
}

# ---------- systemd ----------
write_service() {
  [ "$NAV_SKIP_SYSTEMD" = "1" ] && { info "跳过 systemd 配置"; return 0; }
  local node_bin; node_bin="$(command -v node)"
  mkdir -p "$SYSTEMD_DIR"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=nav-item 个人导航站
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${node_bin} --disable-warning=ExperimentalWarning app.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$APP_NAME" >/dev/null 2>&1
  systemctl restart "$APP_NAME"
  ok "systemd 服务已启动：$APP_NAME"
}

wait_healthy() {
  [ "$NAV_SKIP_SYSTEMD" = "1" ] && return 0
  local port; port="$(env_value PORT)"; port="${port:-$PORT}"
  info "等待服务就绪（端口 $port）…"
  local i
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${port}/api/settings" >/dev/null 2>&1; then ok "服务运行正常"; return 0; fi
    sleep 1
  done
  warn "服务在 30 秒内没有响应，请查看日志：journalctl -u $APP_NAME -n 50 --no-pager"
  return 1
}

# ---------- Nginx / HTTPS ----------
setup_nginx() {
  [ -z "$DOMAIN" ] && return 0
  info "配置 Nginx 反向代理：$DOMAIN"
  apt_install nginx
  local port; port="$(env_value PORT)"; port="${port:-$PORT}"
  mkdir -p "$NGINX_DIR/sites-available" "$NGINX_DIR/sites-enabled"
  cat > "$NGINX_DIR/sites-available/${APP_NAME}.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 64m;      # 导入较大的备份文件

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
  ln -sf "$NGINX_DIR/sites-available/${APP_NAME}.conf" "$NGINX_DIR/sites-enabled/${APP_NAME}.conf"
  if [ "$NAV_SKIP_APT" != "1" ]; then
    nginx -t && systemctl reload nginx
    ok "Nginx 已配置：http://${DOMAIN}"
    if [ -n "$EMAIL" ]; then
      info "申请 HTTPS 证书（Let's Encrypt）…"
      apt_install certbot python3-certbot-nginx
      if certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect; then
        ok "HTTPS 已启用：https://${DOMAIN}"
      else
        warn "证书申请失败（请确认域名已解析到本机、80/443 端口已放行）。可稍后手动执行：certbot --nginx -d ${DOMAIN}"
      fi
    else
      warn "未设置 EMAIL，已跳过 HTTPS。需要时执行：certbot --nginx -d ${DOMAIN}"
    fi
  fi
}

# ---------- 子命令 ----------
summary() {
  local port user host
  port="$(env_value PORT)"; port="${port:-$PORT}"
  user="$(env_value ADMIN_USERNAME)"; user="${user:-$ADMIN_USERNAME}"
  host="${DOMAIN:-$(hostname -I 2>/dev/null | awk '{print $1}')}"; host="${host:-localhost}"
  echo
  echo "${c_green}==================== 部署完成 ====================${c_off}"
  if [ -n "$DOMAIN" ]; then
    echo "  首页：      http://${DOMAIN}        （若已启用 HTTPS 则为 https://${DOMAIN}）"
    echo "  后台：      http://${DOMAIN}/admin"
    echo "  直连端口：  http://${host}:${port}"
  else
    echo "  首页：      http://${host}:${port}"
    echo "  后台：      http://${host}:${port}/admin"
  fi
  echo "  管理员：    ${user}"
  if [ -n "$GENERATED_PASSWORD" ]; then
    echo "  初始密码：  ${GENERATED_PASSWORD}    ← 随机生成，仅显示这一次（也保存在 ${ENV_FILE}）"
  else
    echo "  密码：      见 ${ENV_FILE}（登录后请立即修改）"
  fi
  echo "  数据库：    ${INSTALL_DIR}/database/nav.db"
  echo "  管理：      systemctl status|restart|stop ${APP_NAME}    日志：journalctl -u ${APP_NAME} -f"
  echo "  更新：      sudo bash ${INSTALL_DIR}/scripts/install-debian.sh update"
  echo "  提示：      数据库管理（导入 / 导出 / Supabase 同步）在后台「数据库管理」页。"
  echo "${c_green}=================================================${c_off}"
}

do_install() {
  require_root; check_os
  install_node
  apt_install curl ca-certificates git
  fetch_source
  ensure_user
  write_env
  [ -n "$(env_value PORT)" ] && PORT="$(env_value PORT)"
  build_app
  fix_permissions
  write_service
  wait_healthy || true
  setup_nginx
  summary
}

do_update() {
  require_root; check_os
  [ -d "$INSTALL_DIR" ] || die "未找到安装目录 $INSTALL_DIR，请先执行 install"
  install_node
  backup_db
  fetch_source
  build_app
  fix_permissions
  [ "$NAV_SKIP_SYSTEMD" = "1" ] || systemctl restart "$APP_NAME"
  wait_healthy || true
  ok "更新完成（配置与数据库均已保留）"
}

do_uninstall() {
  require_root
  if [ "$NAV_SKIP_SYSTEMD" != "1" ]; then
    systemctl stop "$APP_NAME" 2>/dev/null || true
    systemctl disable "$APP_NAME" 2>/dev/null || true
  fi
  rm -f "$SERVICE_FILE" "$NGINX_DIR/sites-enabled/${APP_NAME}.conf" "$NGINX_DIR/sites-available/${APP_NAME}.conf"
  [ "$NAV_SKIP_SYSTEMD" = "1" ] || { systemctl daemon-reload; (command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1 && systemctl reload nginx) || true; }
  if [ "${PURGE:-0}" = "1" ]; then
    rm -rf "$INSTALL_DIR"
    ok "已卸载并删除 $INSTALL_DIR（含数据库）"
  else
    ok "已卸载服务。程序与数据仍保留在 $INSTALL_DIR（如需彻底删除：PURGE=1 重新执行 uninstall）"
  fi
}

do_status() {
  systemctl --no-pager status "$APP_NAME" || true
  [ -f "$ENV_FILE" ] && echo "端口：$(env_value PORT)    数据库：$INSTALL_DIR/database/nav.db"
}

case "${1:-install}" in
  install)   do_install ;;
  update)    do_update ;;
  uninstall) do_uninstall ;;
  status)    do_status ;;
  restart)   require_root; systemctl restart "$APP_NAME"; ok "已重启" ;;
  logs)      journalctl -u "$APP_NAME" -n 100 -f ;;
  -h|--help|help) sed -n '2,24p' "$0" ;;
  *) die "未知子命令：$1（可用：install | update | uninstall | status | restart | logs）" ;;
esac
