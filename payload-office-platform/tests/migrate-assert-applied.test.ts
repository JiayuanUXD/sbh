/**
 * 守卫：`pnpm migrate:assert-applied` 的判据
 *
 * ## 这条守卫防的是什么
 *
 * `payload migrate` 存在**静默 no-op 且退出 0** 的形态。2026-09-04 PR #141 的
 * e2e job 实录：该步骤零输出（连 Payload init 的 "No email adapter" WARN 都没有）、
 * 3.5 秒退出 0、一条迁移都没跑。CI 判它成功，失败被推给下一步的 `pnpm seed`，
 * 报成 `relation "roles" does not exist`——排查得从 seed 一路倒推回 migrate
 * 才看得出真凶。重跑即过，所以那不是代码问题；但一个会静默什么都不做的步骤
 * 不该被判为成功。
 *
 * `quality.yml` 的 e2e job 现在在 migrate 之后跑 `migrate:assert-applied`，
 * 形状照抄同 job 的 generate:types（断言 → 重试一次 → 大声失败）。
 *
 * ## 为什么判据抽成纯函数
 *
 * CLI 本体要 `getPayload()` 连库读 `payload_migrations`，在测试进程里会挂住
 * （本仓库已知现象）。所以「什么算没应用完」这条判断单独抽出来，可以离线钉死；
 * 读库与打印留在 CLI 里。同时 `main()` 加了「只在直接执行时跑」的入口守卫，
 * 否则本测试 import 该模块就会触发连库。
 */
import { describe, expect, it } from 'vitest'

import { findUnappliedProblems } from '../scripts/migrate-status'

describe('migrate:assert-applied 的判据', () => {
  it('迁移全部应用完毕时无问题', () => {
    expect(findUnappliedProblems({ appliedCount: 57, pending: [] })).toEqual([])
  })

  it('一条都没应用时报错——这正是 PR #141 那次故障的指纹', () => {
    const problems = findUnappliedProblems({ appliedCount: 0, pending: ['20260723_160143_init'] })

    expect(problems.length).toBeGreaterThan(0)
    expect(problems.join('\n')).toContain('一条记录都没有')
  })

  it('应用了一部分就中断同样不放行', () => {
    const problems = findUnappliedProblems({
      appliedCount: 3,
      pending: ['20260901_021249_merchant_stop_cascade_job', '20260903_084339_opt_067_lead_visitor_ref'],
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('还有 2 条待应用')
    // 待应用的名字要列出来，否则 CI 日志上只能看到一个数字，还得自己去查是哪几条
    expect(problems[0]).toContain('opt_067_lead_visitor_ref')
  })

  /**
   * 两条判据缺一不可——这条用例锁住的正是"为什么不只判 pending"。
   * 代码侧迁移索引损坏（listMigrationNames 读不到任何 import）时 pending 恒空，
   * 只判 pending 会认为一切正常；而此时数据库其实是空的。
   */
  it('代码侧 0 条迁移 + 库里 0 条，不得被判为通过', () => {
    const problems = findUnappliedProblems({ appliedCount: 0, pending: [] })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('一条记录都没有')
  })
})
