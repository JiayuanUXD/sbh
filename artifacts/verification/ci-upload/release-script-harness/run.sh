#!/usr/bin/env bash
# 用法：run.sh <modes>   例：run.sh slow,bad,ok   /  run.sh bad
# 把 cloudrun-release.sh 的函数 source 进来（去掉末行 main、去掉 CRLF），桩掉 tcb_api，
# 直接调 upload_package 打本地假 COS。
set -eo pipefail
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HARNESS_DIR" rev-parse --show-toplevel)"
MODES="${1:-ok}"
# 本机没有 jq 时启用垫片（只认脚本上传路径用到的三种 jq 调用）
command -v jq >/dev/null 2>&1 || PATH="$HARNESS_DIR/bin:$PATH"

HTMP="$(mktemp -d)"
node "$HARNESS_DIR/server.mjs" "$MODES" > "$HTMP/server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT
for i in $(seq 1 50); do
  grep -q '^PORT=' "$HTMP/server.log" 2>/dev/null && break
  sleep 0.2
done
PORT="$(sed -n 's/^PORT=//p' "$HTMP/server.log")"
echo "fake COS on 127.0.0.1:$PORT  modes=$MODES"

# 脚本里 REPO_ROOT 用 BASH_SOURCE 定位，process substitution 会变成 /proc/self/fd；
# 所以把去掉 main 的副本临时放进仓库 scripts/ 再 source，跑完删掉
LIB="$REPO/scripts/.harness-cloudrun-release.sh"
sed '$d' "$REPO/scripts/cloudrun-release.sh" | tr -d '\r' > "$LIB"
# shellcheck disable=SC1090
source "$LIB"
# 脚本自己会 trap EXIT 清 WORK_DIR，把夹具的清理并回去（否则副本与假 COS 都会残留）
trap 'kill $SERVER_PID 2>/dev/null; rm -f "$LIB"; rm -rf "$WORK_DIR" "$HTMP"' EXIT

# 3MB 随机包；把上限压到 2s，让 need_bps=1.5MB/s，slow 模式肯定达不到
head -c 3000000 /dev/urandom > "$WORK_DIR/source.zip"
COS_PUT_CAP=2

# 桩：每次调用记一行，PackageVersion 带上序号，事后能核对成功那次用的是第几份 info
tcb_api() {
  echo "$2" >> "$HTMP/fetches.log"
  local n
  n="$(wc -l < "$HTMP/fetches.log" | tr -d ' ')"
  printf '{"data":{"UploadUrl":"http://127.0.0.1:%s/put?sign=a%%26b=c%%3D1","PackageName":"pkg","PackageVersion":"v%s","UploadHeaders":[{"Key":"x-test","Value":"harness 1"}]}}' "$PORT" "$n"
}

rc=0
info="$(upload_package "$WORK_DIR/source.zip")" || rc=$?
echo "---- upload_package exit=$rc ----"
if [ "$rc" = "0" ]; then
  echo "stdout(info path)=$info"
  echo "info 内容：$(cat "$info")"
fi
echo "---- fetches: $(wc -l < "$HTMP/fetches.log" | tr -d ' ') 次 ----"
sleep 0.5
echo "---- server.log ----"
cat "$HTMP/server.log"
exit "$rc"
