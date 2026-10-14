#!/usr/bin/env bash
# OPT-111：四种写入之后，上海 / 杭州两城首页缓存是否未命中。
#
# 可观测量：生产模式下首页缓存未命中时 `cached-queries.ts` 打一行
#   [public-catalog:home-cache] {"city":"<slug>","phase":"start"}
# 按城市数这行即可知道某次请求是否回源。写入一律走后台 REST（Next route handler，
# 有请求上下文，失效 hook 真的会发 revalidateTag）。
#
# 用法：./probe-home-misses.sh <origin> <server-log> <out.json>
#   origin      如 http://localhost:3781（server 用 next start 起，NODE_ENV=production）
#   server-log  该 server 的 stdout 落盘文件
# 前置：setup-fixtures.sh 已跑；server 刚起、缓存是空的（每次实验前删 .next/cache/fetch-cache）。
set -euo pipefail
ORIGIN="$1"; LOG="$2"; OUT="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"
SENTINEL_JSON="$HERE/../OPT-037/lib/sentinel.json"
ADMIN_EMAIL='e2e-adm@example.com'; ADMIN_PASSWORD='Test1234!'   # scripts/seed.ts 公开夹具
: "${DATABASE_URL:?需要 DATABASE_URL 以解析夹具 id}"

misses() { grep -c "\[public-catalog:home-cache\] {\"city\":\"$1\",\"phase\":\"start\"}" "$LOG" || true; }

# 页面哨兵：状态码 200 + home 族关键标记（判据来自 OPT-037 共享 sentinel.json）
MARKERS="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(' '.join(next(f for f in d['families'] if f['id']=='home')['requiredMarkers']))" "$SENTINEL_JSON")"
fetch_home() {
  local city="$1" body code
  body="$(mktemp)"
  code="$(curl -s -o "$body" -w '%{http_code}' "$ORIGIN/$city")"
  if [[ "$code" != 200 ]]; then echo "哨兵失败：/$city -> $code" >&2; exit 2; fi
  for m in $MARKERS; do grep -q "$m" "$body" || { echo "哨兵失败：/$city 缺标记 $m" >&2; exit 2; }; done
  rm -f "$body"
}

TOKEN="$(curl -s -X POST "$ORIGIN/api/users/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
AUTH=(-H "Authorization: JWT $TOKEN" -H 'Content-Type: application/json')

sql() { psql "$DATABASE_URL" -At -c "$1"; }
PUBLISHED_ID="$(sql "select min(l.id) from listings l join buildings b on b.id=l.building_id join locations c on c.id=b.city_id where c.slug='shanghai' and l.publication_status='published'")"
DRAFT_ID="$(sql "select max(id) from listings where publication_status='draft'")"
[[ -n "$PUBLISHED_ID" && -n "$DRAFT_ID" ]] || { echo "缺夹具：先跑 setup-fixtures.sh" >&2; exit 2; }

ARTICLE_ID="$(curl -s "${AUTH[@]}" "$ORIGIN/api/articles?limit=1&depth=0" | python3 -c 'import json,sys; d=json.load(sys.stdin)["docs"]; print(d[0]["id"] if d else "")')"
if [[ -z "$ARTICLE_ID" ]]; then
  ARTICLE_ID="$(curl -s "${AUTH[@]}" -X POST "$ORIGIN/api/articles" -d '{"title":"OPT-111 探针资讯","slug":"opt-111-probe"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["doc"]["id"])')"
fi

patch() {  # patch <collection> <id> <json>  → 打印状态码
  curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -X PATCH "$ORIGIN/api/$1/$2?depth=0" -d "$3"
}

# 预热：每城 3 次；首个请求必须真的回源过一次（否则说明首页根本不走这条缓存，量不到）
for city in shanghai hangzhou; do for _ in 1 2 3; do fetch_home "$city"; done; done
sleep 1
for city in shanghai hangzhou; do
  [[ "$(misses "$city")" -ge 1 ]] || { echo "哨兵失败：/$city 预热没有触发首页缓存回源" >&2; exit 2; }
done
# 预热完成后两城都应命中（缓存稳定），这是每一行的起点
for city in shanghai hangzhou; do fetch_home "$city"; done

RUN_SUFFIX="$(date +%s)"
declare -a ROWS=()
run_case() {  # run_case <name> <collection> <id> <json>
  local name="$1" before_sh before_hz status after_sh after_hz
  before_sh="$(misses shanghai)"; before_hz="$(misses hangzhou)"
  status="$(patch "$2" "$3" "$4")"
  [[ "$status" == 200 ]] || { echo "写入失败：$name -> $status" >&2; exit 3; }
  sleep 1
  fetch_home shanghai; fetch_home hangzhou
  sleep 1
  after_sh="$(misses shanghai)"; after_hz="$(misses hangzhou)"
  # 再各请求一次，让下一行从「两城都命中」开始
  fetch_home shanghai; fetch_home hangzhou
  ROWS+=("{\"case\":\"$name\",\"shanghaiMiss\":$([[ $after_sh -gt $before_sh ]] && echo true || echo false),\"hangzhouMiss\":$([[ $after_hz -gt $before_hz ]] && echo true || echo false)}")
}

RENT="$(sql "select rent from listings where id=$PUBLISHED_ID")"
run_case "a-public-field" listings "$PUBLISHED_ID" "{\"rent\":$(python3 -c "print(float('$RENT')+1)")}"
run_case "b-internal-only" listings "$PUBLISHED_ID" "{\"roomNumber\":\"R$RUN_SUFFIX\"}"
DRAFT_RENT="$(sql "select rent from listings where id=$DRAFT_ID")"
run_case "c-draft" listings "$DRAFT_ID" "{\"rent\":$(python3 -c "print(float('$DRAFT_RENT')+1)")}"
run_case "d-article-control" articles "$ARTICLE_ID" "{\"title\":\"OPT-111 探针资讯 $RUN_SUFFIX\"}"

SKIPPED="$(grep -c '\[supply-cache-invalidation\] skipped' "$LOG" || true)"
printf '{"origin":"%s","measuredAt":"%s","publishedListingId":%s,"draftListingId":%s,"articleId":%s,"skipLogLines":%s,"rows":[%s]}\n' \
  "$ORIGIN" "$(date -u +%FT%TZ)" "$PUBLISHED_ID" "$DRAFT_ID" "$ARTICLE_ID" "$SKIPPED" "$(IFS=,; echo "${ROWS[*]}")" \
  | python3 -m json.tool > "$OUT"
cat "$OUT"
