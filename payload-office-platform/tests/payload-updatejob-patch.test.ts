/**
 * 守护 `patches/payload@3.86.0.patch`（OPT-046）。
 *
 * ## 为什么需要这个测试
 *
 * patch 改的是 node_modules 里的文件，**没有任何编译期或类型层面的保护**。
 * 升级 payload 时 pnpm 会因为版本号变化直接丢掉这个 patch（或 patch 应用失败），
 * 而症状——多实例并发下事务泄漏、连接停在 idle in transaction——只在生产
 * 切流量的几分钟窗口里出现，本地稳态复现不出来。等发现时已经是线上半瘫。
 *
 * 所以这里直接读 node_modules 里的实际产物，断言 patch 在位。
 *
 * ## patch 修的是什么
 *
 * `queues/utilities/updateJob.js` 在 `beginTransaction()` 之后没有任何错误保护：
 * `db.updateJobs()` 一旦抛错，事务既不 commit 也不 rollback，连接永久泄漏。
 *
 * 上游状态（2026-08-24 核实）：
 *   - 触发器之一（多 worker 争抢，payloadcms/payload#16043）由 #17441 修复，
 *     但那是 `feat!`，**只在 4.0 分支**，任何 3.x 发布版都没有；
 *   - 缺 try/catch 本身**连 4.0.0-canary.29 都还没修**（另见上游 #17645）。
 *
 * 升级 payload 时：先按上面两条重新核实上游是否已修，确认修了再删本测试与 patch。
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/** 解析到应用实际加载的那份 payload（pnpm 下打过 patch 的副本带 patch_hash 后缀）。 */
function resolveUpdateJobSource(): string {
  // payload 的 exports 不暴露 ./package.json，用一个确定导出的子路径反推包根。
  const entry = require_.resolve('payload')
  const distIndex = entry.lastIndexOf(`${path.sep}dist${path.sep}`)
  expect(distIndex, `无法从 ${entry} 定位 payload 包根`).toBeGreaterThan(-1)
  const pkgRoot = entry.slice(0, distIndex)
  return readFileSync(path.join(pkgRoot, 'dist/queues/utilities/updateJob.js'), 'utf8')
}

describe('payload updateJob.js patch（OPT-046 事务泄漏）', () => {
  const source = resolveUpdateJobSource()

  it('db.updateJobs 被 try/catch 包住', () => {
    // 断言的是「有保护」而非具体写法，留出 patch 微调的余地。
    expect(source).toMatch(/try\s*\{[\s\S]*db\.updateJobs\(/)
  })

  it('出错路径会回滚事务', () => {
    expect(source).toContain('rollbackTransaction')
  })

  it('回滚之后把原始错误重新抛出（不吞错）', () => {
    expect(source).toMatch(/catch[\s\S]*throw err/)
  })

  it('带着可追溯的 patch 标记，方便升级时定位', () => {
    expect(source).toContain('[sbh patch]')
  })
})
