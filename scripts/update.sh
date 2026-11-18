#!/usr/bin/env bash
# Update an existing OpenBBS installation to the latest version.
#
# Usage: bash scripts/update.sh
# Environment: OPENBBS_DIR, OPENBBS_BRANCH

set -euo pipefail

REPO="yaoyue996/OpenBBS"
BRANCH="${OPENBBS_BRANCH:-main}"
ROOT="${OPENBBS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

say() { printf '\033[1;36m[OpenBBS]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[OpenBBS] 错误：\033[0m %s\n' "$*" >&2; exit 1; }

for command in curl tar; do
  command -v "$command" >/dev/null 2>&1 || die "缺少命令 $command。"
done

[ -f "$ROOT/server.js" ] || die "未找到 OpenBBS 安装：$ROOT。"

if [ -d "$ROOT/.runtime/node/bin" ]; then
  export PATH="$ROOT/.runtime/node/bin:$PATH"
fi

cd "$ROOT"
say "停止服务…"
bash scripts/service.sh stop || true

mkdir -p data
if [ -f data/openbbs.db ]; then
  BACKUP="data/backup-$(date +%Y%m%d-%H%M%S).db"
  if command -v node >/dev/null 2>&1; then
    node -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1]); db.exec("PRAGMA wal_checkpoint(FULL);"); db.close();' data/openbbs.db \
      || die "数据库备份失败（无法检查点数据库）。"
  fi
  cp data/openbbs.db "$BACKUP"
  say "数据库已备份：$BACKUP"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openbbs-update.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

say "下载最新源码（$BRANCH 分支）…"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$TMP_DIR/openbbs.tar.gz" \
  || die "下载失败，请检查网络。"
tar -xzf "$TMP_DIR/openbbs.tar.gz" -C "$TMP_DIR"
SRC_DIR="$(find "$TMP_DIR" -maxdepth 1 -type d -name 'OpenBBS-*' | head -n 1)"
[ -n "$SRC_DIR" ] && [ -f "$SRC_DIR/server.js" ] || die "源码包结构不正确。"

for item in server.js package.json package-lock.json README.md LICENSE CONTRIBUTING.md SECURITY.md .env.example \
  Dockerfile docker-compose.yml .dockerignore src views public scripts docs test; do
  if [ -e "$SRC_DIR/$item" ]; then
    rm -rf "$ROOT/$item"
    cp -R "$SRC_DIR/$item" "$ROOT/$item"
  fi
done

chmod +x scripts/*.sh 2>/dev/null || true

say "更新依赖…"
npm install --omit=dev --no-audit --no-fund

say "执行数据库迁移…"
npm run init

say "启动服务…"
bash scripts/service.sh start

say "更新完成。"
