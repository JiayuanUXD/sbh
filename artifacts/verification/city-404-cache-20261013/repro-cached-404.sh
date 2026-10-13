#!/bin/bash
# 复现「一次查库失败 → 城市解析的 null 被 unstable_cache 记住 → 恢复后首页/城市页仍 404」（2026-10-13）。
# 用法：repro-cached-404.sh <已 next build 的应用目录> <端口>
# 前置：本地 PG 已迁移并灌好种子数据，DATABASE_URL 指向它；脚本会把 city_site_profiles 临时改名再改回。
set -u
APP=$1; PORT=$2
: "${DATABASE_URL:?需要 DATABASE_URL 指向本地 PG}"
rm -rf "$APP/.next/cache"   # 空缓存起步：先访问一次城市页会把正常值缓存下来，就复现不了
( cd "$APP" && CI=true NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_SITE_URL=https://shangban.cc PAYLOAD_SECRET=${PAYLOAD_SECRET:-repro-secret-0123456789abcdef0123456789abcdef} \
  exec node_modules/.bin/next start -p "$PORT" > "/tmp/repro-cached-404-$PORT.log" 2>&1 ) &
server=$!
for _ in $(seq 1 120); do curl -s -o /dev/null "http://127.0.0.1:$PORT/api/health" && break; sleep 0.5; done
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 60 "http://127.0.0.1:$PORT$1"; }
psql "$DATABASE_URL" -qAt -c "ALTER TABLE city_site_profiles RENAME TO city_site_profiles_off"
echo "查库失败期间  /shanghai/coworking -> $(code /shanghai/coworking)"
psql "$DATABASE_URL" -qAt -c "ALTER TABLE city_site_profiles_off RENAME TO city_site_profiles"
sleep 1
echo "恢复后        /shanghai/coworking -> $(code /shanghai/coworking)"
echo "恢复后        /shanghai -> $(code /shanghai)"
pkill -P "$server" 2>/dev/null; kill "$server" 2>/dev/null
