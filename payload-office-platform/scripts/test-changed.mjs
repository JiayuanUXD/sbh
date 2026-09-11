/**
 * 只跑与本次改动相关的单测。`.githooks/pre-push` 与 `pnpm test:changed` 共用。
 *
 * 为什么不跑全量：全量 `pnpm test` 约 70s，其中用例本身只占 50s（各文件之和），
 * 大头是 58 个文件各自冷加载一遍 `payload.config`（每次 6~8s，互不共享）。
 * 按 import 图只挑受影响的文件后：改一个叶子组件 ≈ 20s（含启动），动到 collection 的 PR ≈ 50s。
 * 全量单测 / build / 迁移 / E2E 留给 CI（quality.yml 在 PR 与 master 上都跑全量）。
 *
 * 选取规则（取并集，一次 vitest 调用）：
 *   1. `vitest related`：import 图里含改动文件的测试。改动 = 相对基线的已提交 +
 *      工作区 + 未跟踪，只看应用目录；
 *   2. 用 fs 读源码 / 判断文件存在的契约测试**常驻**。它们守的文件不在 import 图里
 *      （admin-nav-hidden-selectors 读 custom.scss、preflight-migrations 读 migrations/、
 *      production-deploy-config 读 deploy.yml……），按图永远选不中，而它们恰恰守的是
 *      「不报错、只是静默失效」的那类回归。用 grep 现算，不维护清单；
 *      判据在 lib/test-changed-plan.mjs 的 CONTRACT_RE。
 *
 * 退回全量的情形：算不出基线（没有 origin/master）、改动超过 200 个文件、
 * 改了 vitest.config / package.json / pnpm-lock（import 图本身可能变了）、
 * 有文件被删除（import 它的测试按图已经找不到了，只有全量会报 Cannot find module）、
 * 改动文件名以 `-` 开头（会被 vitest 当成选项）。
 *
 * 已知盲区（未处理）：靠 child_process 跑夹具的测试（tests/migrate-exit.test.ts）既不在
 * 图里也不读源码，改 src/lib/runtime/migrate-lock.ts 时本地不会跑到它——CI 全量兜底。
 *
 * 用法：
 *   pnpm test:changed          # 基线 = git merge-base origin/master HEAD
 *   pnpm test:changed <ref>    # 指定基线，如 HEAD~3
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 触发器 / 契约测试判据 / 上限等纯决策逻辑在 lib 里，由 tests/test-changed-plan.test.ts 钉住。
import {
  collectContractTests,
  fullRunReason,
  normalizeChanged,
  parseGitLines,
  vitestMode,
} from './lib/test-changed-plan.mjs'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const vitestPkgPath = require.resolve('vitest/package.json')
const vitestPkg = require(vitestPkgPath)
// 走 package.json 的 bin 字段，不写死产物文件名
const vitestBin = resolve(
  dirname(vitestPkgPath),
  typeof vitestPkg.bin === 'string' ? vitestPkg.bin : vitestPkg.bin.vitest,
)

const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

/**
 * 在应用目录里调 git。
 *
 * 必须剥掉 GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_PREFIX：pre-push hook 运行时 git
 * 会把它们导出进环境，而在 linked worktree（本仓库 E:\wt-<名> 的标准工作流）里 GIT_DIR 指向
 * `.git/worktrees/<名>`，带着它 `-C appDir` 会把应用目录当成顶层——`ls-files --others`
 * 把 1313 个已跟踪文件全报成未跟踪，于是永远「改了 package.json，退回全量」，
 * 本脚本在它最该生效的地方从不生效（2026-09-11 红队实测）。
 */
const GIT_ENV_OVERRIDES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !GIT_ENV_OVERRIDES.includes(k)),
)
const git = (...args) =>
  parseGitLines(execFileSync('git', ['-C', appDir, ...args], { encoding: 'utf8', env: gitEnv }))

function runVitest(args) {
  const r = spawnSync(process.execPath, [vitestBin, ...args], { cwd: appDir, stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

function runFull(reason) {
  console.log(yellow(`! ${reason}，退回全量 vitest run`))
  runVitest(['run'])
}

// ── 1. 基线 ─────────────────────────────────────────────────────────────────
let base = process.argv[2]
if (!base) {
  try {
    base = git('merge-base', 'origin/master', 'HEAD')[0]
  } catch {
    runFull('算不出与 origin/master 的 merge-base')
  }
}

// ── 2. 改动文件：已提交 + 工作区（相对基线）∪ 未跟踪，只看应用目录 ────────────
// `--relative` 让 diff 只输出应用目录下的路径且相对应用目录；ls-files 本就按 cwd 限定。
// `-z`：路径含非 ASCII / 引号时 git 默认会 C 转义，只有 NUL 分隔拿到的是原样路径。
let changed
let deleted
try {
  changed = [
    ...git('diff', '--name-only', '--relative', '-z', base),
    ...git('ls-files', '--others', '--exclude-standard', '-z'),
  ]
  deleted = git('diff', '--name-only', '--diff-filter=D', '--relative', '-z', base)
} catch {
  runFull(`基线 ${base} 无法比对`)
}
changed = normalizeChanged(changed, (f) => existsSync(resolve(appDir, f)))

if (deleted.length > 0) {
  const more = deleted.length > 1 ? ` 等 ${deleted.length} 个` : ''
  runFull(`有文件被删除或改名（${deleted[0]}${more}）`)
}
const reason = fullRunReason(changed)
if (reason) runFull(reason)

// ── 3. 常驻的契约测试：现算，不维护清单 ────────────────────────────────────
const contract = collectContractTests(resolve(appDir, 'tests'))

// ── 4. 一次调用：related 接受源码文件（按图找测试）与测试文件（直接跑）混排；
//       改动只在 tests/ 里时不必重建依赖图，直接 run ─────────────────────────
const mode = vitestMode(changed)
console.log(
  cyan(`→ vitest ${mode}：基线 ${base.slice(0, 7)}，改动 ${changed.length} 个文件，常驻契约测试 ${contract.length} 个`),
)
if (changed.length === 0) console.log(yellow('  应用目录相对基线没有改动，只跑契约测试'))
runVitest(mode === 'related' ? ['related', '--run', ...changed, ...contract] : ['run', ...changed, ...contract])
