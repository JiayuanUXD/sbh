#!/usr/bin/env bash
# 浏览器走查夹具：在本地库里造一篇草稿、一篇已发布文章；`clean` 子命令删掉它们。
#   BASE=http://localhost:3741 bash browser-fixture.sh        # 造
#   BASE=http://localhost:3741 bash browser-fixture.sh clean  # 删
# 只允许本地地址；账号是 scripts/seed.ts 的公开夹具。
set -uo pipefail

BASE="${BASE:-http://localhost:3741}"
case "$BASE" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *) echo "拒绝：BASE=$BASE 不是本地地址" >&2; exit 2 ;;
esac

TOK="$(curl -sS -X POST "$BASE/api/users/login" -H 'Content-Type: application/json' \
  -d '{"email":"e2e-adm@example.com","password":"Test1234!"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"

if [ "${1:-}" = "clean" ]; then
  for slug in zz-browser-draft zz-browser-pub; do
    ids="$(curl -sS "$BASE/api/articles?trash=true&limit=10&depth=0&where%5Bslug%5D%5Bequals%5D=$slug" -H "Authorization: JWT $TOK" \
      | python3 -c 'import sys,json; print(" ".join(str(d["id"]) for d in json.load(sys.stdin)["docs"]))')"
    for id in $ids; do
      curl -sS -o /dev/null -w "删除 #$id -> HTTP %{http_code}\n" -X DELETE "$BASE/api/articles/$id?trash=true" -H "Authorization: JWT $TOK"
    done
  done
  exit 0
fi

lex() {
  printf '{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"%s","version":1}],"direction":null,"format":"","indent":0,"version":1}],"direction":null,"format":"","indent":0,"version":1}}' "$1"
}

mk() { # $1 标题 $2 slug $3 状态 $4 正文
  curl -sS -X POST "$BASE/api/articles" -H 'Content-Type: application/json' -H "Authorization: JWT $TOK" \
    -d "{\"title\":\"$1\",\"slug\":\"$2\",\"status\":\"$3\",\"category\":\"guide\",\"excerpt\":\"$4\",\"publishedAt\":\"2026-11-11T08:00:00.000Z\",\"content\":$(lex "$4")}" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("doc") or d).get("id"))'
}

echo "草稿 id: $(mk '浏览器走查草稿不应对外' zz-browser-draft draft '这是草稿正文走查标记DRAFTBODY')"
echo "已发布 id: $(mk '浏览器走查已发布应对外' zz-browser-pub published '这是已发布正文走查标记PUBBODY')"
