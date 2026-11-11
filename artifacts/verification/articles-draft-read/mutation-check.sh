#!/usr/bin/env bash
# 变异验证：故意把修复改坏，确认守卫测试变红，再还原。
#
# 用法（在 payload-office-platform 目录下）：
#   DATABASE_URL=postgres://…本地库… PAYLOAD_SECRET=… bash ../artifacts/verification/articles-draft-read/mutation-check.sh
#
# 只允许本地库（DATABASE_URL 主机必须是 localhost / 127.0.0.1）。
# 每个变异：改一处源码 → 跑 articles-read-access 单测 + 真库 REST 层测试 → 记录红/绿 → 立刻还原。
# 结束时校验两个被改文件的内容与开始时逐字节一致；任何一步异常也会在 trap 里还原。
set -uo pipefail

case "${DATABASE_URL:-}" in
  postgres://*@localhost:*|postgres://*@127.0.0.1:*|postgres://*@localhost/*|postgres://*@127.0.0.1/*) ;;
  *) echo "拒绝：DATABASE_URL 缺失或不是本地库" >&2; exit 2 ;;
esac

ACCESS=src/domain/public-catalog/article-read-access.ts
ARTICLES=src/collections/Articles.ts
BACKUP="$(mktemp -d)"
cp "$ACCESS" "$BACKUP/access.ts"
cp "$ARTICLES" "$BACKUP/Articles.ts"
restore() { cp "$BACKUP/access.ts" "$ACCESS"; cp "$BACKUP/Articles.ts" "$ARTICLES"; }
trap restore EXIT

mutate() { # $1 文件 $2 旧串 $3 新串
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, old, new = sys.argv[1:4]
s = open(path, encoding='utf-8').read()
if s.count(old) != 1:
    sys.exit(f"变异失败：{path} 里「{old}」出现 {s.count(old)} 次，应为 1 次")
open(path, 'w', encoding='utf-8').write(s.replace(old, new))
PY
}

run_tests() {
  arch -arm64 pnpm exec vitest run --pool=forks --no-file-parallelism \
    tests/articles-read-access.test.ts tests/articles-read-access-postgres.test.ts 2>&1 \
    | grep -E "^\s+(Tests|Test Files)|FAIL " | sed -E 's/\x1b\[[0-9;]*m//g' | sed -E 's/^ +//' | sort -u
}

check() { # $1 名称 $2 期望（red|green）
  local out; out="$(run_tests)"
  local verdict="green"
  echo "$out" | grep -q "failed" && verdict="red"
  local mark="✔"; [ "$verdict" = "$2" ] || mark="✘ 与预期不符"
  echo "### $1 → 实际 $verdict（期望 $2） $mark"
  echo "$out" | sed 's/^/    /'
  echo
  restore
}

echo "## 基线（未变异，期望全绿）"; check "基线" green

echo "## 变异"
mutate "$ARTICLES" "read: createArticleReadAccess(canManageArticle)," "read: () => true,"
check "M1 还原成原 bug：read: () => true" red

mutate "$ACCESS" "    deletedAt: { exists: false }," ""
check "M2 Where 里去掉 deletedAt（?trash=true 能读回收站）" red

mutate "$ACCESS" "    status: { equals: 'published' }," ""
check "M3 Where 里去掉 status（草稿对匿名可见）" red

mutate "$ARTICLES" "read: createArticleReadAccess(canManageArticle)," "read: createArticleReadAccess(async ({ req }) => Boolean(req.user)),"
check "M4 放宽成「任何登录账号全读」（BRK / MGR / CSR 能读草稿）" red

mutate "$ACCESS" "((await canViewAll(args)) ? true : getPublishedArticleWhere())" "((await canViewAll(args)) ? getPublishedArticleWhere() : getPublishedArticleWhere())"
check "M5 收得太死：持菜单码的 ADM / OPS 也被收窄（后台读不到草稿）" red

mutate "$ACCESS" "export function getPublishedArticleWhere(): Where {
  return {
    status: { equals: 'published' },
    deletedAt: { exists: false },
  }
}" "const SHARED: Where = { status: { equals: 'published' }, deletedAt: { exists: false } }
export function getPublishedArticleWhere(): Where {
  return SHARED
}"
check "M6 返回共享对象（被 Payload 合并改写会污染后续请求）" red

# 还原校验
restore
cmp "$ACCESS" "$BACKUP/access.ts" && cmp "$ARTICLES" "$BACKUP/Articles.ts" && echo "已还原：两个源文件与变异前逐字节一致"
echo "## 还原后复跑（期望全绿）"; check "还原后" green
