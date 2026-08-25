import { describe, expect, it } from 'vitest'

/**
 * autoRun cron 不得吞掉 job 错误（OPT-046 §6.6）。
 *
 * ## 守的是什么
 *
 * `silent` 在 Payload 3.86 里是 `{ error?: boolean; info?: boolean } | boolean`，
 * 而 `silent: true` 会把**两类日志一起**压掉：
 *
 * | 类别 | 出处 | 内容 | 该不该压 |
 * |---|---|---|---|
 * | `info` | `operations/runJobs/index.js:229` | 每轮「跑了几个 job」的汇总 | **该压**——30s/10s 一轮常驻空转，纯噪音 |
 * | `error` | `errors/handleTaskError.js:67,96`、`handleWorkflowError.js:45` | 任务/工作流抛的错 | **不该压**——通知没发出去、导入炸了 |
 *
 * 三个 cron 原先都写 `silent: true`，于是生产上**任务失败是完全静默的**：
 * 没有日志、没有告警，只有运营发现「通知怎么没来」。
 *
 * ## 为什么这条测试有必要
 *
 * `silent: true` 看起来无害，因为**确实有错误照常打印**——
 * `Error in job queue cron job handler` 来自 Croner 包装层的 catch
 *（`payload/dist/index.js:267`），无条件输出，不受 `silent` 影响。
 * OPT-046 那个多实例争抢错误走的正是这条。
 *
 * 所以现场看到的是「job 出错时日志里有东西」，很容易据此认定 `silent` 没问题——
 * 而被吞掉的是另一类、且恰恰是业务上更要紧的那类。**这条测试断言的就是这个区分。**
 */

/** 复刻 Payload 的判据：`!silent || (typeof silent === 'object' && !silent.error)`。 */
function errorsAreLogged(silent: unknown): boolean {
  if (!silent) return true
  return typeof silent === 'object' && !(silent as { error?: boolean }).error
}

/** info 侧的同款判据，用于确认我们没有把噪音一并放出来。 */
function infoIsLogged(silent: unknown): boolean {
  if (!silent) return true
  return typeof silent === 'object' && !(silent as { info?: boolean }).info
}

describe('autoRun cron 的日志开关', () => {
  it('没有任何一个 cron 会吞掉 job 错误', { timeout: 30_000 }, async () => {
    const { default: configPromise } = await import('@/payload.config')
    const cfg = await configPromise

    const autoRun = cfg.jobs?.autoRun
    expect(autoRun, 'jobs.autoRun 不见了 —— 本守卫需要同步更新').toBeTypeOf('function')

    const crons = await (autoRun as (payload: unknown) => Promise<unknown[]> | unknown[])(
      {} as never,
    )
    expect(Array.isArray(crons) && crons.length > 0, 'autoRun 返回空数组').toBe(true)

    const swallowed = (crons as Array<{ queue?: string; silent?: unknown }>)
      .filter((c) => !errorsAreLogged(c.silent))
      .map((c) => c.queue ?? '(未命名队列)')

    expect(
      swallowed,
      `这些队列的 job 错误会被静默吞掉，生产上任务失败将没有任何日志：${swallowed.join('、')}。` +
        '把 `silent: true` 换成 `{ info: true, error: false }` —— 压掉每轮的 info 汇总，但放行错误。',
    ).toEqual([])
  })

  it('info 汇总仍然是压掉的 —— 别为了放行错误把噪音一起放出来', { timeout: 30_000 }, async () => {
    // 反向边界：只断言「错误没被吞」的话，`silent: false` 也能过，
    // 而那会让 30s/10s 一轮的空转汇总刷屏，把真错误埋回去。
    const { default: configPromise } = await import('@/payload.config')
    const cfg = await configPromise
    const crons = (await (cfg.jobs!.autoRun as (p: unknown) => never)({} as never)) as unknown as Array<{
      queue?: string
      silent?: unknown
    }>

    const noisy = crons.filter((c) => infoIsLogged(c.silent)).map((c) => c.queue ?? '(未命名队列)')
    expect(noisy, `这些队列会把每轮的 info 汇总打进日志：${noisy.join('、')}`).toEqual([])
  })
})
