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
 *   2. 用 readFileSync / readdirSync（或 fs/promises 的 readFile / readdir）读源码的契约
 *      测试**常驻**。它们守的文件不在 import 图里（admin-nav-hidden-selectors 读 custom.scss、
 *      preflight-migrations 读 migrations/、production-deploy-config 读 deploy.yml……），
 *      按图永远选不中，而它们恰恰守的是「不报错、只是静默失效」的那类回归。
 *      用 grep 现算，不维护清单；判据在 lib/test-changed-plan.mjs 的 CONTRACT_RE。
 *
 * 退回全量的情形：算不出基线（没有 origin/master）、改动超过 200 个文件、
 * 改了 vitest.config / package.json / pnpm-lock（import 图本身可能变了）。
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
} from './lib/test-changed-plan.mjs'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const vitestBin = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')

const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`

/** `--relative` 让 git 只输出应用目录下的路径，且相对应用目录——正是 vitest 要的形式。 */
const git = (...args) =>
  parseGitLines(execFileSync('git', ['-C', appDir, ...args], { encoding: 'utf8' }))

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
let changed
try {
  changed = [
    ...git('diff', '--name-only', '--relative', base),
    ...git('ls-files', '--others', '--exclude-standard'),
  ]
} catch {
  runFull(`基线 ${base} 无法比对`)
}
changed = normalizeChanged(changed, (f) => existsSync(resolve(appDir, f)))

const reason = fullRunReason(changed)
if (reason) runFull(reason)

// ── 3. 常驻的契约测试：现算，不维护清单 ────────────────────────────────────
const contract = collectContractTests(resolve(appDir, 'tests'))

// ── 4. 一次调用：related 接受源码文件（按图找测试）与测试文件（直接跑）混排 ──
console.log(
  cyan(`→ vitest related：基线 ${base.slice(0, 7)}，改动 ${changed.length} 个文件，常驻契约测试 ${contract.length} 个`),
)
if (changed.length === 0) console.log(yellow('  应用目录相对基线没有改动，只跑契约测试'))
runVitest(['related', '--run', ...changed, ...contract])
