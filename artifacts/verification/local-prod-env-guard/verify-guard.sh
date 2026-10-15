#!/usr/bin/env bash
# 本机生产模式守卫（src/lib/runtime/local-production-env-guard.ts）的实机验证。
#
# 思路：不碰任何真实数据库。用 fake-pg-listener.py 在一个地址上监听，只记录「有没有进程来连」。
# 把 DATABASE_URL 指过去，再看 next start 在首个请求后有没有发起连接：
#   A 主工作树形态  .env.production.local + 非环回库主机          → 期望：守卫报错，0 次连接
#   B 对照组        同 A，加 ALLOW_LOCAL_PRODUCTION_ENV=1        → 期望：有连接（证明 A 的 0 是守卫拦的）
#   C 干净 worktree .env.local + 环回库主机                       → 期望：守卫放行，有连接
#   D 生产容器形态  没有任何 env 文件，库主机非环回（进程环境变量）  → 期望：守卫放行，有连接
#
# 用法（应用目录须已 next build，且不含任何 .env* 本地文件，脚本会自己放、自己删）：
#   bash verify-guard.sh <应用目录> <输出目录>
# 绝不要对主工作树运行：脚本会在应用目录里写 / 删 .env.production.local 与 .env.local。

set -u

APP=$(cd "$1" && pwd)
OUT=$(mkdir -p "$2" && cd "$2" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=${PORT:-3791}
LAN_IP=$(ipconfig getifaddr en0 || ipconfig getifaddr en1)
LAN_PORT=54329
LOOP_PORT=54328
SECRET=verify-only-dummy-secret-0123456789abcdef

for f in .env.production.local .env.local .env.production .env; do
  if [ -e "$APP/$f" ]; then
    echo "应用目录已有 $f，拒绝运行（防止覆盖真实配置）" >&2
    exit 1
  fi
done
[ -n "$LAN_IP" ] || { echo '取不到非环回的本机 IP' >&2; exit 1; }

cleanup() {
  rm -f "$APP/.env.production.local" "$APP/.env.local"
}
trap cleanup EXIT

wait_port_free() {
  for _ in $(seq 1 30); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 1
  done
  echo "端口 $PORT 未释放" >&2
  exit 1
}

# scenario <名称> <监听地址> <监听端口> [server 进程额外环境变量...]
scenario() {
  local name=$1 host=$2 port=$3
  shift 3
  wait_port_free

  python3 "$HERE/fake-pg-listener.py" "$host" "$port" >"$OUT/$name.listener.log" 2>&1 &
  local lpid=$!
  sleep 1

  (cd "$APP" && exec env CI=1 "$@" ./node_modules/.bin/next start -p "$PORT") >"$OUT/$name.server.log" 2>&1 &
  local spid=$!

  for _ in $(seq 1 60); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" && break
    sleep 1
  done
  {
    echo "GET /api/health -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:$PORT/api/health")"
    echo "GET /           -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:$PORT/")"
  } >"$OUT/$name.http.log"
  sleep 5

  kill "$spid" 2>/dev/null
  wait "$spid" 2>/dev/null
  kill "$lpid" 2>/dev/null
  wait "$lpid" 2>/dev/null

  local connects guard
  connects=$(grep -c ' CONNECT ' "$OUT/$name.listener.log")
  guard=$(grep -c '\[local-production-env-guard\] 拒绝启动' "$OUT/$name.server.log")
  printf '%-28s 守卫报错行=%s  假库被连次数=%s  %s\n' "$name" "$guard" "$connects" \
    "$(tr '\n' ' ' <"$OUT/$name.http.log")" | tee -a "$OUT/summary.txt"
}

: >"$OUT/summary.txt"
# 记下被测代码：HEAD、src 是否有未提交改动、守卫源码与 payload.config 的 blob 哈希（可与任一提交对账）
{
  echo "HEAD $(git -C "$APP" rev-parse --short HEAD)$(git -C "$APP" diff --quiet HEAD -- src || echo ' + src 有未提交改动')  $(date '+%F %T %z')  LAN_IP=$LAN_IP"
  echo "blob local-production-env-guard.ts $(git -C "$APP" hash-object src/lib/runtime/local-production-env-guard.ts)"
  echo "blob payload.config.ts             $(git -C "$APP" hash-object src/payload.config.ts)"
} | tee -a "$OUT/summary.txt"

printf 'DATABASE_URL=postgres://u:p@%s:%s/fake\nPAYLOAD_SECRET=%s\n' "$LAN_IP" "$LAN_PORT" "$SECRET" >"$APP/.env.production.local"
scenario A-main-tree-blocked "$LAN_IP" "$LAN_PORT"
scenario B-control-allow-switch "$LAN_IP" "$LAN_PORT" ALLOW_LOCAL_PRODUCTION_ENV=1
rm -f "$APP/.env.production.local"

printf 'DATABASE_URL=postgres://u:p@127.0.0.1:%s/fake\nPAYLOAD_SECRET=%s\n' "$LOOP_PORT" "$SECRET" >"$APP/.env.local"
scenario C-clean-worktree-loopback 127.0.0.1 "$LOOP_PORT"
rm -f "$APP/.env.local"

scenario D-container-no-env-files "$LAN_IP" "$LAN_PORT" \
  "DATABASE_URL=postgres://u:p@$LAN_IP:$LAN_PORT/fake" "PAYLOAD_SECRET=$SECRET"

# E next build 不能被拦：主树本地 build 一直是合法操作，构建期不连库（NEXT_PHASE 跳过，
#   collectPageData worker 也继承它）。带着 A 的 .env.production.local 重新构建，期望退出码 0。
printf 'DATABASE_URL=postgres://u:p@%s:%s/fake\nPAYLOAD_SECRET=%s\n' "$LAN_IP" "$LAN_PORT" "$SECRET" >"$APP/.env.production.local"
(cd "$APP" && env CI=1 NEXT_PUBLIC_SITE_URL=https://verify.example.test MULTI_CITY_ROUTING_ENABLED=false \
  ./node_modules/.bin/next build) >"$OUT/E-build-with-prod-env-file.build.log" 2>&1
build_exit=$?
rm -f "$APP/.env.production.local"
printf '%-28s next build 退出码=%s  守卫报错行=%s\n' E-build-with-prod-env-file "$build_exit" \
  "$(grep -c '\[local-production-env-guard\]' "$OUT/E-build-with-prod-env-file.build.log")" | tee -a "$OUT/summary.txt"
