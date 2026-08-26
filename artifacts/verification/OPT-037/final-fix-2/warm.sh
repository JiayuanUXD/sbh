#!/usr/bin/env bash
# 预热生产 server 后再采样。
#
# 为什么必须预热（本批实测到的假差异）：
#   - POI（周边配套）走高德 Web 服务实时调用 + 进程内 24h 缓存
#     （`domain/location-services/cache.ts`：失败不写缓存，下次重试）。冷启动
#     首个请求偶发某个类别拿不到，那条一级 tab 甚至整个
#     `.location-panel__poi-panel` 就不渲染 —— 比对时会被误读成「代码改坏了」。
#   - Next 的流式 RSC 载荷首访与复访的切块数不同（html-diff.sh 已归一化）。
#
# 用法：bash warm.sh <origin>
# 每个 URL 连打 3 次，并**打印状态码**（非 200 立刻可见，不做静默通过）。
set -uo pipefail
ORIGIN="${1:-http://localhost:3802}"
URLS=(
  / /listings /buildings
  /buildings/west-nanjing-premium-center /buildings/huangpu-bund /buildings/empty-building
  /listings/lujiazui-grade-a-780sqm /listings/jingan-price-on-request-300sqm
  /listings/media-rich-listing /listings/jingan-serviced-office-42-seats
  /news /pages/privacy /entrust /publish /sale /city-partner
  /dev-story /dev-story/opt036 /dev-story/opt037 /dev-story/building-detail-demo
)
for round in 1 2 3; do
  line=""
  for u in "${URLS[@]}"; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN$u")"
    line="$line $u=$code"
  done
  echo "round $round:$line"
done
