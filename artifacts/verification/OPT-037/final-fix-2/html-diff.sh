#!/usr/bin/env bash
# HTML 逐字节比对（改前 vs 改后）。用法：bash html-diff.sh <beforeDir> <afterDir>
#
# 先归一化掉三类**与代码无关**的差异，剩下的必须为 0，否则就是渲染输出被改变了：
#
#   1. 构建产物指纹：`/_next/static/chunks/<hash>.(css|js)` 与 BUILD_ID
#      （`"b":"<id>"`）—— 每次 `next build` 都会变。
#   2. **RSC flight 载荷脚本** `<script>self.__next_f.push([...])</script>`：
#      它是同一份 DOM 的第二份序列化，用于客户端 hydration。Next 的流式输出把它
#      **按到达时机切块**，同一个构建连续抓两次，切块边界就不同（实测：
#      after-html-cold 与 after-html 是同一个 build 的两次抓取，listings/news 也
#      会在这里比出差异）。切块边界不是渲染输出，整段剔除、连续多段折叠成一段后
#      再比 DOM 本身。
#   3. 逐请求变化的运行时数据：`data-supply-as-of="<ISO>"`（供给快照时刻）。
#
# 之后再抵消本批**有意**新增的类名：`sf-card` / `sf-media sf-media--16x10`（V1）
# 与 `sf-num`（V4）——审查报告点名要求加这几个类，HTML 必然多出这些 token。
# 归一化后若还有任何差异，说明改到了不该改的地方。
#
# ⚠️ 采样前必须**预热 server**：POI 一级 tab（「酒店（5）」等）来自高德 Web 服务
# 实时调用 + 进程内 24h 缓存（`domain/location-services/cache.ts`），冷启动首个
# 请求偶发拿不到某个类别，那条 tab 乃至整个 `.location-panel__poi-panel` 就不
# 渲染。冷抓 vs 热抓会比出假差异（本批已实测到）。用 warm-and-capture.sh。
#
# 状态码在 capture.mjs 里已经逐 URL 读过并写进 report-*.json 的 badStatus，
# 本脚本只比内容，不会拿两个 404 页比出「完全一致」。
set -uo pipefail
cd "$(dirname "$0")"
BEFORE="${1:-before-html}"
AFTER="${2:-after-html}"

norm() {
  perl -0777 -pe '
    s{<script>self\.__next_f\.push\(.*?\)</script>}{<script>FLIGHT</script>}gs;
    s{(?:<script>FLIGHT</script>)+}{<script>FLIGHT</script>}g;
    s{/_next/static/chunks/[A-Za-z0-9_-]+\.(css|js)}{/_next/static/chunks/HASH.$1}g;
    s{"b":"[A-Za-z0-9_-]+"}{"b":"BUILDID"}g;
    s{data-supply-as-of="[^"]*"}{data-supply-as-of="ASOF"}g;
    s{class="sf-card }{class="}g;
    s{class="sf-media sf-media--16x10 }{class="}g;
    s{class="sf-num }{class="}g;
    s{<strong class="sf-num">}{<strong>}g;
  ' "$1"
}

fail=0
for f in "$BEFORE"/*.html; do
  b="$(basename "$f")"
  if [ ! -f "$AFTER/$b" ]; then echo "MISSING $AFTER/$b"; fail=1; continue; fi
  if diff -q <(norm "$f") <(norm "$AFTER/$b") > /dev/null; then
    printf 'SAME  %s\n' "$b"
  else
    printf 'DIFF  %s\n' "$b"
    diff <(norm "$f" | sed 's/></>\n</g') <(norm "$AFTER/$b" | sed 's/></>\n</g') \
      | grep -E '^[<>]' | cut -c1-200 | head -40
    fail=1
  fi
done
echo
if [ "$fail" = 0 ]; then echo 'ALL HTML IDENTICAL (归一化后)'; else echo 'HTML DIFFERS — 见上'; fi
exit "$fail"
