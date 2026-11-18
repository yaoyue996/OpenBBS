#!/usr/bin/env bash
# Start, stop, restart or inspect an OpenBBS installation.
#
# Usage: bash scripts/service.sh [start|stop|restart|status|logs]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PID_FILE="$ROOT/data/openbbs.pid"
LOG_FILE="$ROOT/data/openbbs.log"
ERR_FILE="$ROOT/data/openbbs.err.log"

if [ -d "$ROOT/.runtime/node/bin" ]; then
  export PATH="$ROOT/.runtime/node/bin:$PATH"
fi

ACTION="${1:-status}"

say() { printf '\033[1;36m[OpenBBS]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[OpenBBS] 错误：\033[0m %s\n' "$*" >&2; exit 1; }

read_pid() {
  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE" 2>/dev/null | tr -dc '0-9'
  fi
}

is_running() {
  local pid
  pid="$(read_pid)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

wait_for_http() {
  local port="$1"
  local attempts=0
  while [ "$attempts" -lt 40 ]; do
    if curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1; then
      return 0
    fi
    if ! is_running; then
      return 1
    fi
    attempts=$((attempts + 1))
    sleep 0.5
  done
  return 1
}

stop_service() {
  if ! is_running; then
    say "服务未运行。"
    rm -f "$PID_FILE"
    return 0
  fi
  local pid
  pid="$(read_pid)"
  say "正在停止服务（PID $pid）…"
  kill "$pid" 2>/dev/null || true
  local attempts=0
  while kill -0 "$pid" 2>/dev/null && [ "$attempts" -lt 20 ]; do
    attempts=$((attempts + 1))
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    say "进程未及时退出，强制结束。"
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  say "服务已停止。"
}

start_service() {
  if is_running; then
    say "服务已在运行（PID $(read_pid)）。"
    return 0
  fi
  command -v node >/dev/null 2>&1 || die "未找到 Node.js。请重新运行安装脚本或安装 Node.js >= 22.13。"
  mkdir -p "$ROOT/data"
  say "正在启动服务…"
  nohup node "$ROOT/server.js" >> "$LOG_FILE" 2>> "$ERR_FILE" &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  local port
  port="$(grep -E '^PORT=' "$ROOT/.env" 2>/dev/null | tail -n 1 | cut -d= -f2 | tr -d '[:space:]' || true)"
  port="${port:-3000}"

  if wait_for_http "$port"; then
    say "服务已启动：http://localhost:$port （PID $pid）"
  else
    say "服务启动失败，最近日志："
    tail -n 30 "$ERR_FILE" 2>/dev/null || true
    tail -n 30 "$LOG_FILE" 2>/dev/null || true
    exit 1
  fi
}

case "$ACTION" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  status)
    if is_running; then
      say "服务运行中（PID $(read_pid)）。"
    else
      say "服务未运行。"
      exit 1
    fi
    ;;
  logs)
    mkdir -p "$ROOT/data"
    touch "$LOG_FILE" "$ERR_FILE"
    exec tail -n 100 -f "$LOG_FILE" "$ERR_FILE"
    ;;
  *)
    die "未知操作：$ACTION。可用操作：start | stop | restart | status | logs"
    ;;
esac
