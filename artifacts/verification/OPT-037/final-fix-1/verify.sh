#!/usr/bin/env bash
# OPT-037 终审修复第 1 轮验证脚本（正确性 + 高危注释漂移）
#
# 用法：
#   1) 先起生产 server（不要覆盖 DATABASE_URL，默认库 postgres 夹具最全）：
#        CI=1 NEXT_PUBLIC_SITE_URL=https://<线上 https 域名> \
#        MULTI_CITY_ROUTING_ENABLED=false PORT=3719 pnpm exec next start -p 3719
#      少了 CI=1 / https 的 NEXT_PUBLIC_SITE_URL，config-guard 会 fail-closed，
#      症状是「房源类路由全线 404、楼盘类照常 200」。
#   2) BASE=http://localhost:3719 bash verify.sh
#
# 本脚本**真读 HTTP 状态码**（curl -w '%{http_code}'），不拿两个 404 页比 DOM。
set -uo pipefail
BASE="${BASE:-http://localhost:3719}"
fail=0

status() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
body()   { curl -s "$1"; }

expect_status() {
  local url="$1" want="$2" got
  got="$(status "$url")"
  if [ "$got" = "$want" ]; then
    printf 'PASS  %-3s %s\n' "$got" "$url"
  else
    printf 'FAIL  want=%s got=%s %s\n' "$want" "$got" "$url"; fail=1
  fi
}

# grep -F：全部是字面量，不走正则
expect_contains() {
  local url="$1" needle="$2" st
  st="$(status "$url")"
  if [ "$st" != "200" ]; then printf 'FAIL  非 200（%s），无法断言内容 %s\n' "$st" "$url"; fail=1; return; fi
  if body "$url" | grep -qF -- "$needle"; then
    printf 'PASS  含「%s」 %s\n' "$needle" "$url"
  else
    printf 'FAIL  缺「%s」 %s\n' "$needle" "$url"; fail=1
  fi
}

expect_absent() {
  local url="$1" needle="$2" st
  st="$(status "$url")"
  if [ "$st" != "200" ]; then printf 'FAIL  非 200（%s），无法断言内容 %s\n' "$st" "$url"; fail=1; return; fi
  if body "$url" | grep -qF -- "$needle"; then
    printf 'FAIL  不该出现「%s」 %s\n' "$needle" "$url"; fail=1
  else
    printf 'PASS  无「%s」 %s\n' "$needle" "$url"
  fi
}

echo '== 0. 环境自检：房源类与楼盘类路由都必须 200（全 404 = config-guard fail-closed）=='
expect_status "$BASE/buildings" 200
expect_status "$BASE/listings" 200
expect_status "$BASE/buildings/west-nanjing-premium-center" 200
expect_status "$BASE/listings/jingan-serviced-office-42-seats" 200
expect_status "$BASE/buildings/huangpu-bund" 200
expect_status "$BASE/buildings/empty-building" 200

echo
echo '== C2 多业务组楼盘：默认组按单价排序不再被跨组结果集拖成降级 =='
# huangpu-bund 同时有租赁与出售/联合办公组；修复前跨组 hasMixedPriceKeys 恒真，
# 会在租赁组下渲染「该组内房源计价单位不唯一」——而该组内单位是唯一的。
expect_absent "$BASE/buildings/huangpu-bund?sort=price-asc" '计价单位不唯一'
expect_contains "$BASE/buildings/huangpu-bund?sort=price-asc" '单价从低到高'

echo
echo '== C1 出售组不渲染「可即时过户」聚合格与「可即刻入驻」pill =='
# 本地夹具没有出售组楼盘，故只能证否（站内任何页面都不该再出现这个标签）。
# 真正的守卫在 tests/detail-components-contract.test.ts（renderToStaticMarkup 直打出售组）。
expect_absent "$BASE/buildings/west-nanjing-premium-center" '可即时过户'

echo
echo '== M2 价格桶标签改为闭区间口径 =='
# 首尾两桶的区间是闭的（min/max 均含），标签得照实说「及以下」「及以上」。
# 本夹具楼盘的元/㎡/天 报价区间只与「10+」桶有交集，所以这里断言的是尾桶；
# 首桶「8 元及以下」的守卫在 tests/detail-components-contract.test.ts。
expect_absent   "$BASE/buildings/west-nanjing-premium-center" '>10 元以上<'
expect_contains "$BASE/buildings/west-nanjing-premium-center" '10 元及以上'

echo
echo '== I2 房源详情页补回 5 条事实（房源楼层 / 朝向 / 可分割 / 家具 / 其他固定费用）=='
for label in '房源楼层' '朝向' '可分割' '家具' '其他固定费用'; do
  expect_contains "$BASE/listings/jingan-serviced-office-42-seats" ">$label<"
done

echo
echo '== NC2 供给区恒渲染：三组全空时是诚实空态，不是整段消失 =='
expect_contains "$BASE/buildings/empty-building" 'id="supply"'
expect_contains "$BASE/buildings/empty-building" '当前暂无公开可选空间'

echo
if [ "$fail" = "0" ]; then echo 'ALL PASS'; else echo 'HAS FAILURES'; fi
exit "$fail"
