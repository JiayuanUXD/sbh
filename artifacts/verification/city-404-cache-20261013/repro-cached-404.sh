#!/bin/bash
# 复现「一次查库失败 → 城市解析的 null 被 unstable_cache 记住 → 恢复后首页/城市页仍 404」（2026-10-13）。
# 用法：repro-cached-404.sh <已 next build 的应用目录> <端口>
# 前置：本地 PG 已迁移并灌好种子数据，DATABASE_URL 指向它；脚本会把 city_site_profiles 临时改名再改回。
#
# 临时写库探针纪律（.agent/testing.md）：先断言干净起点；无论正常结束、出错还是被 Ctrl-C / kill
# 中断，都由 EXIT 陷阱把表名改回并停掉服务；还原后再自查一次，不干净就以非零退出。
set -u
APP=$1; PORT=$2
: "${DATABASE_URL:?需要 DATABASE_URL 指向本地 PG}"

psqlq() { psql "$DATABASE_URL" -qAt -v ON_ERROR_STOP=1 -c "$1"; }
# 输出「正式表名 临时表名」，不存在的位置为 -；干净状态是 "city_site_profiles -"
table_state() {
  psqlq "SELECT coalesce(to_regclass('public.city_site_profiles')::text, '-') || ' ' || coalesce(to_regclass('public.city_site_profiles_off')::text, '-')"
}
CLEAN="city_site_profiles -"

start=$(table_state)
if [ "$start" != "$CLEAN" ]; then
  echo "起点不干净：$start（多半是上次中断的残留，先手工执行 ALTER TABLE city_site_profiles_off RENAME TO city_site_profiles）" >&2
  exit 1
fi

server=""
renamed=0
cleanup() {
  status=$?
  if [ "$renamed" = 1 ]; then
    psqlq "ALTER TABLE city_site_profiles_off RENAME TO city_site_profiles" && renamed=0
  fi
  if [ -n "$server" ]; then
    pkill -P "$server" 2>/dev/null
    kill "$server" 2>/dev/null
  fi
  end=$(table_state)
  if [ "$end" != "$CLEAN" ]; then
    echo "还原失败：表状态为 $end" >&2
    exit 1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

rm -rf "$APP/.next/cache"   # 空缓存起步：先访问一次城市页会把正常值缓存下来，就复现不了
( cd "$APP" && CI=true NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_SITE_URL=https://shangban.cc PAYLOAD_SECRET=${PAYLOAD_SECRET:-repro-secret-0123456789abcdef0123456789abcdef} \
  exec node_modules/.bin/next start -p "$PORT" > "/tmp/repro-cached-404-$PORT.log" 2>&1 ) &
server=$!
for _ in $(seq 1 120); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" && break; sleep 0.5; done
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 60 "http://127.0.0.1:$PORT$1"; }

renamed=1
psqlq "ALTER TABLE city_site_profiles RENAME TO city_site_profiles_off"
echo "查库失败期间  /shanghai/coworking -> $(code /shanghai/coworking)"
psqlq "ALTER TABLE city_site_profiles_off RENAME TO city_site_profiles"
renamed=0
sleep 1
echo "恢复后        /shanghai/coworking -> $(code /shanghai/coworking)"
echo "恢复后        /shanghai -> $(code /shanghai)"
