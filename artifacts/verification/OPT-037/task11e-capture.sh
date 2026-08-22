#!/usr/bin/env bash
# OPT-037 Task 11e：抓同一批 URL 的 HTML，供 task11e-domdiff.py 逐字节比对。
# 用法：bash task11e-capture.sh <origin> <输出目录>
#
# 纪律一：每条路由**先预热 3 次**再取样（楼盘详情页 POI 面板冷启动常拿不到数据）；
#        即便如此也别赌预热次数，比对一律配 task11e-domdiff.py 的遮罩模式兜底。
# 纪律二（2026-08-22 终审第 3 轮补）：**真读 HTTP 状态码并落盘 `status.json`**。
#        原实现用 `curl -s`（无 `-f`、不查状态码），错误页原样写进 dump，
#        再交给只比字节的 domdiff —— 两侧都是错误页就会打印「DOM 完全一致」。
#        判据与读取器都在 `lib/sentinel.{json,sh}`，别在这里另写一份。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/sentinel.sh
source "$HERE/lib/sentinel.sh"

ORIGIN="${1:-http://localhost:3805}"
OUT="${2:?need out dir}"
sentinel_init "$OUT"

declare -A PAGES=(
  [news-detail-related]='/news/jingan-temple-district-why-popular'
  [news-detail-plain]='/news/2026-shanghai-office-market-h1'
  [news]='/news'
  [building-detail]='/buildings/west-nanjing-premium-center'
  [listing-detail]='/listings/lujiazui-grade-a-780sqm'
)

echo "预热（每条 3 次）…"
for name in "${!PAGES[@]}"; do
  for _ in 1 2 3; do curl -s -o /dev/null "$ORIGIN${PAGES[$name]}"; done
done

echo "取样："
for name in "${!PAGES[@]}"; do
  sentinel_fetch "$ORIGIN" "${PAGES[$name]}" "$OUT/$name.html" "$name"
done

sentinel_finish "$OUT"
