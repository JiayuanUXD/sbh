#!/usr/bin/env bash
# 资讯草稿匿名可读的请求层探针（改前复现 / 改后验收共用同一份脚本）。
#
# 用法：BASE=http://localhost:3741 bash probe.sh
#
# 只允许打本地 / 隔离库的 dev server：BASE 不是 localhost / 127.0.0.1 直接退出，
# 避免误把「建草稿」打到线上。账号是 scripts/seed.ts 里的公开 E2E 夹具（不是真凭据）。
#
# 做的事：
#   1. 用 e2e-adm 建三篇探针文章：草稿 D、已发布 P、已发布后移入回收站 T（正文各带一个唯一标记串）
#   2. 分别以「匿名 / 会员无关的无权限后台账号（BRK、MGR）/ 有资讯菜单码的 OPS、ADM」请求列表、详情、
#      where 枚举、trash=true，逐项判断响应里有没有 D 的标记串
#   3. 末尾删掉探针文章（本地库，硬删）
#
# 每行输出：<身份> <请求> -> HTTP <码> docs=<条数> 含草稿正文=<yes/no> 含已发布正文=<yes/no> 含回收站正文=<yes/no>
set -uo pipefail

BASE="${BASE:-http://localhost:3741}"
case "$BASE" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *) echo "拒绝：BASE=$BASE 不是本地地址" >&2; exit 2 ;;
esac

TS="$(date +%s)"
MARK_D="LEAKPROBE-DRAFT-$TS"
MARK_P="LEAKPROBE-PUBLISHED-$TS"
MARK_T="LEAKPROBE-TRASHED-$TS"
PASS='Test1234!'

lexical() {
  printf '{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"%s","version":1}],"direction":null,"format":"","indent":0,"version":1}],"direction":null,"format":"","indent":0,"version":1}}' "$1"
}

login() { # $1 email -> token
  curl -sS -X POST "$BASE/api/users/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PASS\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))'
}

create() { # $1 token $2 slug $3 status $4 mark -> id
  curl -sS -X POST "$BASE/api/articles" -H 'Content-Type: application/json' -H "Authorization: JWT $1" \
    -d "{\"title\":\"探针 $4\",\"slug\":\"$2\",\"status\":\"$3\",\"category\":\"market\",\"excerpt\":\"$4\",\"publishedAt\":\"2026-11-11T00:00:00.000Z\",\"content\":$(lexical "$4")}" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("doc") or {}).get("id",""))'
}

ADM="$(login e2e-adm@example.com)"
[ -n "$ADM" ] || { echo "ADM 登录失败（库里没有夹具账号？先 pnpm seed）" >&2; exit 3; }

ID_D="$(create "$ADM" "zz-leakprobe-draft-$TS" draft "$MARK_D")"
ID_P="$(create "$ADM" "zz-leakprobe-pub-$TS" published "$MARK_P")"
ID_T="$(create "$ADM" "zz-leakprobe-trash-$TS" published "$MARK_T")"
[ -n "$ID_D" ] && [ -n "$ID_P" ] && [ -n "$ID_T" ] || { echo "建探针文章失败 D=$ID_D P=$ID_P T=$ID_T" >&2; exit 3; }
# 移入回收站（后台「移到回收站」按钮发的就是带 trash=true 的 PATCH deletedAt）
curl -sS -o /dev/null -X PATCH "$BASE/api/articles/$ID_T?trash=true" -H 'Content-Type: application/json' \
  -H "Authorization: JWT $ADM" -d "{\"deletedAt\":\"2026-11-11T00:00:00.000Z\"}"
echo "探针文章：D(草稿)=#$ID_D P(已发布)=#$ID_P T(回收站)=#$ID_T"

probe() { # $1 label $2 token(可空) $3 path
  # macOS 自带 bash 3.2：set -u 下空数组展开会报 unbound variable，所以匿名不用数组
  local out code body
  if [ -n "$2" ]; then
    out="$(curl -sS -w '\n%{http_code}' -H "Authorization: JWT $2" "$BASE$3")"
  else
    out="$(curl -sS -w '\n%{http_code}' "$BASE$3")"
  fi
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  local n="-"
  n="$(printf '%s' "$body" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(len(d["docs"]) if "docs" in d else ("1" if "id" in d else "0"))
except Exception:
    print("-")')"
  local has_d has_p has_t
  has_d=no; has_p=no; has_t=no
  printf '%s' "$body" | grep -q "$MARK_D" && has_d=yes
  printf '%s' "$body" | grep -q "$MARK_P" && has_p=yes
  printf '%s' "$body" | grep -q "$MARK_T" && has_t=yes
  printf '%-10s %-62s -> HTTP %s docs=%-3s 草稿正文=%-3s 已发布正文=%-3s 回收站正文=%s\n' "$1" "$3" "$code" "$n" "$has_d" "$has_p" "$has_t"
}

run_matrix() { # $1 label $2 token
  probe "$1" "$2" "/api/articles?limit=100&depth=0"
  probe "$1" "$2" "/api/articles?limit=100&depth=0&where%5Bstatus%5D%5Bequals%5D=draft"
  probe "$1" "$2" "/api/articles?limit=100&depth=0&where%5Bslug%5D%5Bequals%5D=zz-leakprobe-draft-$TS"
  probe "$1" "$2" "/api/articles/$ID_D?depth=0"
  probe "$1" "$2" "/api/articles/$ID_P?depth=0"
  probe "$1" "$2" "/api/articles?limit=100&depth=0&trash=true"
  probe "$1" "$2" "/api/articles?limit=100&depth=0&draft=true"
  probe "$1" "$2" "/api/articles/$ID_T?depth=0&trash=true"
}

echo "== 匿名"
run_matrix 匿名 ""
for who in brk csr mgr ops adm; do
  tok="$(login "e2e-$who@example.com")"
  echo "== e2e-$who"
  run_matrix "$who" "$tok"
done

gql() { # $1 label $2 token(可空) $3 query
  local body out code
  body="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$3")"
  if [ -n "$2" ]; then
    out="$(curl -sS -w '\n%{http_code}' -X POST "$BASE/api/graphql" -H 'Content-Type: application/json' -H "Authorization: JWT $2" -d "$body")"
  else
    out="$(curl -sS -w '\n%{http_code}' -X POST "$BASE/api/graphql" -H 'Content-Type: application/json' -d "$body")"
  fi
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  local has_d=no has_p=no
  printf '%s' "$out" | grep -q "zz-leakprobe-draft-$TS\|$MARK_D" && has_d=yes
  printf '%s' "$out" | grep -q "zz-leakprobe-pub-$TS" && has_p=yes
  printf '%-10s GraphQL %-52s -> HTTP %s 含草稿=%-3s 含已发布=%s\n' "$1" "$4" "$code" "$has_d" "$has_p"
}

echo "== GraphQL"
for who in 匿名 ops; do
  tok=""; [ "$who" = ops ] && tok="$(login e2e-ops@example.com)"
  gql "$who" "$tok" "{ Articles(limit: 200) { docs { slug status } } }" "Articles 列表"
  gql "$who" "$tok" "{ Articles(limit: 200, where: { status: { equals: draft } }) { docs { slug } } }" "Articles where status=draft"
  gql "$who" "$tok" "{ Article(id: $ID_D) { slug content } }" "Article(id: 草稿)"
done

# 清理探针（本地库硬删；T 在回收站里，要带 trash=true）
for id in "$ID_D" "$ID_P"; do curl -sS -o /dev/null -X DELETE "$BASE/api/articles/$id" -H "Authorization: JWT $ADM"; done
curl -sS -o /dev/null -X DELETE "$BASE/api/articles/$ID_T?trash=true" -H "Authorization: JWT $ADM"
echo "探针已清理：$(curl -sS "$BASE/api/articles?limit=1&depth=0&trash=true" -H "Authorization: JWT $ADM" | python3 -c 'import sys,json; print("库内文章总数(含回收站)=",json.load(sys.stdin)["totalDocs"])')"
