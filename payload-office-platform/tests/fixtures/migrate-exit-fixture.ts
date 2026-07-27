/**
 * 子进程级 fixture：复现 scripts/migrate-locked.ts 的退出契约。
 *
 * 刻意重建线上那两种"钉住进程"的条件（sbh-011 / sbh-012）：
 *   1. pool.end() 永远 pending —— Payload 3.86 adapter 永久占用一个 client 不 release，
 *      pg 的 pool.end() 会一直等它归还。
 *   2. 存在未 unref 的活跃句柄 —— 模拟 adapter 留下的 socket，事件循环不会自然清空。
 *
 * 断言由 tests/migrate-exit.test.ts 通过真实 spawn 完成：进程必须以 0 退出，
 * 且最后一行日志不能被 process.exit 截断。
 */
import { closeMigrationDb, flushProcessOutput } from '../../src/lib/runtime/migrate-lock'

// 条件 2：未 unref 的计时器，若没有显式 process.exit，进程会永远活着
const lingering = setInterval(() => {}, 1_000)
void lingering

async function main(): Promise<void> {
  console.log('[fixture] 迁移完成')

  // 条件 1：pool.end() 永不 resolve
  const closed = await closeMigrationDb({
    destroy: async () => undefined,
    pool: { end: () => new Promise<void>(() => {}) },
  })

  console.log(`[fixture] close=${closed}`)
  // 与脚本入口相同的收尾：冲刷日志后确定性退出
  console.log('[fixture] 即将退出')
  await flushProcessOutput()
  process.exit(0)
}

main().catch(async (err) => {
  console.error('[fixture] 失败', err)
  await flushProcessOutput()
  process.exit(1)
})
