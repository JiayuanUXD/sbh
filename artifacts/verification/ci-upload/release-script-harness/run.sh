#!/usr/bin/env bash
# 用法：run.sh <modes>   例：run.sh slow,hang,bad,ok   /  run.sh bad
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

# 64MB 随机包（真包 2.6MB 会被 Windows 回环的内核缓冲整个吃掉，curl 看到的「已传」
# 就是全量，验不出背压；64MB 缓冲吃不完，slow 模式下 size_upload 必然只是一部分）。
# 上限压到 40s：need_bps=1.6MB/s，slow 模式（~10KB/s）肯定达不到；而 --max-time 变成
# 50s > --speed-time 30s，所以 slow 的断开归 --speed-limit、hang 的断开归 --max-time，
# 两条兜底各自可归因。
head -c 64000000 /dev/urandom > "$WORK_DIR/source.zip"
COS_PUT_CAP=40

# 桩：每次调用记一行，PackageVersion 带上序号，事后能核对成功那次用的是第几份 info
tcb_api() {
  echo "$2" >> "$HTMP/fetches.log"
  local n
  n="$(wc -l < "$HTMP/fetches.log" | tr -d ' ')"
  printf '{"data":{"UploadUrl":"http://127.0.0.1:%s/put?sign=a%%26b=c%%3D1","PackageName":"pkg","PackageVersion":"v%s","UploadHeaders":[{"Key":"x-test","Value":"harness 1"}]}}' "$PORT" "$n"
}

rc=0
info="$(upload_package "$WORK_DIR/source.zip" 2> >(tee "$HTMP/upload.log" >&2))" || rc=$?
sleep 0.5
echo "---- upload_package exit=$rc ----"
if [ "$rc" = "0" ]; then
  echo "stdout(info path)=$info"
  echo "info 内容：$(cat "$info")"
fi
echo "---- fetches: $(wc -l < "$HTMP/fetches.log" | tr -d ' ') 次 ----"
echo "---- server.log ----"
cat "$HTMP/server.log"

# 断言：slow 打头时，第 1 次必须是「too slow」断开且只传了一部分——否则就是背压没生效
# （第一版夹具的 slow 就是这样：3MB 全进了内核缓冲，实际是 --max-time 到期，Codex 审阅指出）。
case "$MODES" in
  slow*)
    first_err="$(grep -m1 '^curl: (28)' "$HTMP/upload.log" || true)"
    first_sent="$(grep -m1 'curl exit=' "$HTMP/upload.log" | sed -n 's/.*已传=\([0-9]*\)B.*/\1/p')"
    total="$(wc -c < "$WORK_DIR/source.zip" | tr -d ' ')"
    echo "---- 断言 slow：err=「${first_err}」 已传=${first_sent} / ${total} ----"
    case "$first_err" in *"too slow"*) ;; *) echo "✗ 第 1 次不是 --speed-limit 断开"; exit 2 ;; esac
    [ -n "$first_sent" ] && [ "$first_sent" -lt "$total" ] || { echo "✗ 第 1 次 size_upload 不是部分上传，背压未生效"; exit 2; }
    echo "✓ slow：--speed-limit 断开且只传了 $(( first_sent * 100 / total ))%"
    ;;
esac
exit "$rc"
