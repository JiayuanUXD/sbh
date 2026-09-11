/**
 * `scripts/test-changed.mjs` 的纯决策逻辑。拆出来只为一件事：能被 vitest 直接 import。
 * 入口脚本顶层就调 git / spawn / process.exit，作为模块根本载不起来；而这里的几条
 * 规则（哪些文件一变就退回全量、什么样的测试算「读源码的契约测试」）恰恰是改错了
 * **不报错、只是 pre-push 静默少跑一批守卫**的那类，必须有测试钉住。
 *
 * 本模块不碰 git、不 spawn、不 exit；文件系统只经参数注入，默认用 node:fs。
 */

import { readdirSync as nodeReaddirSync, readFileSync as nodeReadFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 超过这个数就别算图了，全量更快也更稳。 */
export const MAX_CHANGED = 200

/** 这些文件一变，import 图 / 测试配置本身就可能变了，只能全量。只认应用目录根下的同名文件。 */
export const FULL_RUN_TRIGGERS = ['vitest.config.ts', 'package.json', 'pnpm-lock.yaml']

/**
 * 读源码的契约测试特征：**调用**了同步或 `node:fs/promises` 的读文件 / 列目录 / glob。
 * 必须是调用形状（带 `(`），只 import 不调用不算——参照 e2e-console-guard 的教训。
 * `existsSync` / `stat` 之类不算——那不是在读内容。
 *
 * 首版只认 `*Sync`，漏掉了 17 个用 `fs/promises` 的 `readFile(` / `readdir(` 的守卫
 *（client-components-no-server-imports、sale-channel-always-on、frontend-shell-hydration……），
 * 它们既不在 import 图里也不被点名，pre-push 就静默不跑。2026-09-11 审计时补上。
 */
export const CONTRACT_RE = /\b(readFileSync|readdirSync|globSync|readFile|readdir|glob)\s*\(/

/** git 的 stdout → 一行一个路径。兼容 CRLF（Windows 上 core.autocrlf 会给出 \r\n）。 */
export function parseGitLines(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 去重 + 只留仍存在的文件。删除 / 改名走掉的旧路径 `vitest related` 会当成找不到而报错。
 * @param {string[]} files 相对应用目录的路径
 * @param {(relPath: string) => boolean} exists
 */
export function normalizeChanged(files, exists) {
  return [...new Set(files)].filter((f) => exists(f))
}

/**
 * 需要退回全量时返回原因文案，否则 null。
 * 触发器判定是**整串相等**：`scripts/package.json` 这类子目录同名文件不算。
 */
export function fullRunReason(changed) {
  const trigger = changed.find((f) => FULL_RUN_TRIGGERS.includes(f))
  if (trigger) return `改了 ${trigger}`
  if (changed.length > MAX_CHANGED) return `改动 ${changed.length} 个文件（> ${MAX_CHANGED}）`
  return null
}

/** 这份测试源码是不是「读源码的契约测试」。 */
export function isContractTest(source) {
  return CONTRACT_RE.test(source)
}

/**
 * 扫 `tests/` 顶层的 `*.test.ts`，挑出契约测试，返回 `tests/<file>` 形式（vitest 要相对应用目录）。
 * 只看顶层：`tests/e2e/` 是 Playwright，不归 vitest。
 * @param {string} testsDir 绝对路径
 * @param {{ readdirSync?: (dir: string) => string[]; readFileSync?: (file: string, encoding: 'utf8') => string }} [fs]
 *   测试注入用；默认 node:fs
 * @returns {string[]}
 */
export function collectContractTests(
  testsDir,
  { readdirSync = nodeReaddirSync, readFileSync = nodeReadFileSync } = {},
) {
  return readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.ts'))
    .filter((f) => isContractTest(readFileSync(resolve(testsDir, f), 'utf8')))
    .map((f) => `tests/${f}`)
}
