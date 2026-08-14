/**
 * 按命名规范创建分支：<类型>/<kebab 描述>-<4位随机 hex>
 *
 * 用法：
 *   pnpm branch:new feat 多城市搜索            # → feat/duo-cheng-shi-sou-suo-... 不推荐，描述请用英文
 *   pnpm branch:new feat multi city search    # → feat/multi-city-search-9f3a
 *   pnpm branch:new fix OPT-022 dashboard perf # → fix/opt-022-dashboard-perf-1c7e
 *
 * 顺带执行"永远从最新 master 开分支"：先 fetch，再基于 origin/master 创建。
 * 规范与 .githooks/pre-commit 的 BRANCH_RE 保持一致，改一处要同步另一处。
 */

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const TYPES = ['feat', 'fix', 'refactor', 'perf', 'docs', 'chore', 'ci', 'data']
const BRANCH_RE =
  /^(feat|fix|refactor|perf|docs|chore|ci|data)\/[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{4,8}$/

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const die = (msg) => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const [type, ...rest] = process.argv.slice(2)

if (!type || rest.length === 0) {
  console.error('用法：pnpm branch:new <类型> <短描述...>')
  console.error(`类型：${TYPES.join(' ')}`)
  console.error('例子：pnpm branch:new feat multi city search')
  process.exit(1)
}

if (!TYPES.includes(type)) {
  die(`未知类型 "${type}"，可用：${TYPES.join(' ')}`)
}

const slug = rest
  .join('-')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

if (!slug) die('描述里没有可用的 ASCII 字符，请用英文或工作项编号（如 OPT-022）')
if (slug.length > 40) die(`描述过长（${slug.length} > 40），请精简`)

const name = `${type}/${slug}-${randomBytes(2).toString('hex')}`

if (!BRANCH_RE.test(name)) die(`生成的分支名不合规范：${name}`)

try {
  git('rev-parse', '--verify', '--quiet', `refs/heads/${name}`)
  die(`分支已存在：${name}（重跑一次会换一个随机后缀）`)
} catch {
  // rev-parse 失败即不存在，正是我们要的
}

console.log('→ git fetch origin')
git('fetch', 'origin', '--quiet')

console.log(`→ git switch -c ${name} origin/master`)
git('switch', '-c', name, 'origin/master')

console.log(`\n✓ 已基于最新 origin/master 创建 ${name}`)
console.log(`  尽早推送以避免本地黑洞：git push -u origin ${name}`)
