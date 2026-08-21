#!/usr/bin/env bash
# OPT-037 Task 11e：抓同一批 URL 的 HTML，供 task11e-domdiff.py 逐字节比对。
# 用法：bash task11e-capture.sh <origin> <输出目录>
# 纪律：每条路由**先预热 3 次**再取样（楼盘详情页 POI 面板冷启动常拿不到数据）；
#       即便如此也别赌预热次数，比对一律配 task11e-domdiff.py 的遮罩模式兜底。
set -euo pipefail
ORIGIN="${1:-http://localhost:3805}"
OUT="${2:?need out dir}"
mkdir -p "$OUT"

declare -A PAGES=(
  [news-detail-related]='/news/jingan-temple-district-why-popular'
  [news-detail-plain]='/news/2026-shanghai-office-market-h1'
  [news]='/news'
  [building-detail]='/buildings/west-nanjing-premium-center'
  [listing-detail]='/listings/lujiazui-grade-a-780sqm'
)

for name in "${!PAGES[@]}"; do
  path="${PAGES[$name]}"
  for _ in 1 2 3; do curl -s -o /dev/null "$ORIGIN$path"; done
  curl -s "$ORIGIN$path" -o "$OUT/$name.html"
  echo "$name  $path  $(wc -c < "$OUT/$name.html") B"
done
