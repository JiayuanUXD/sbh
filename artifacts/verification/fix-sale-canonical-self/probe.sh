#!/usr/bin/env bash
# 出售频道 canonical 自指走查探针（2026-09-16）。
# 用法：BASE=http://localhost:3741 bash probe.sh
# 只抓 <head> 里的四个 SEO 标签；origin 是 next 内联的 NEXT_PUBLIC_SITE_URL，断言只看 path。
set -u
BASE="${BASE:-http://localhost:3741}"
for u in \
  "/shanghai/sale?district=changning" \
  "/shanghai/sale?areaMin=100&unknown=drop" \
  "/shanghai/sale" \
  "/hangzhou/sale" \
  "/shanghai/listings?district=changning"; do
  echo "== $u  [$(curl -s -o /dev/null -w '%{http_code}' --max-time 180 "$BASE$u")]"
  curl -s --max-time 120 "$BASE$u" \
    | grep -o '<link rel="canonical"[^>]*>\|<title>[^<]*</title>\|<meta name="description"[^>]*>\|<meta name="robots"[^>]*>'
done
echo "== /sale?areaMin=100&unknown=drop (redirect)"
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' --max-time 120 "$BASE/sale?areaMin=100&unknown=drop"
