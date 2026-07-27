/**
 * 迁移进程退出契约的**子进程级**验证。
 *
 * 为什么不能只写 mock 单测：sbh-011 / sbh-012 的失败恰恰是"单测全绿但真实容器挂住"——
 * mock 掉 pool.end() 就永远测不出进程退不出去。这里真的 spawn 一个 Node 进程，
 * 用真实的 closeMigrationDb / flushProcessOutput，断言它在残留活跃句柄且
 * pool.end() 永不返回的情况下仍然以退出码 0 结束。
 *
 * 退出码 0 是硬约束：Dockerfile 的 `... migrate-locked.ts && pnpm start` 靠它继续执行，
 * 否则容器不监听 80，健康检查必然失败。
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(here, '..')
const fixture = resolve(here, 'fixtures/migrate-exit-fixture.ts')

/** 留足冷启动 + tsx 编译时间；真实退出是毫秒级，超时即代表进程挂住 */
const TIMEOUT_MS = 60_000

type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean }

function runFixture(): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fixture], {
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    const killer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT_MS - 5_000)

    child.on('close', (code) => {
      clearTimeout(killer)
      resolveRun({ code, stdout, stderr, timedOut })
    })
  })
}

describe('迁移进程退出契约（真实子进程）', () => {
  it(
    '即使 pool.end() 永不返回且存在活跃句柄，进程仍以退出码 0 结束',
    async () => {
      const { code, stdout, stderr, timedOut } = await runFixture()

      expect(timedOut, `进程未退出，stdout=${stdout} stderr=${stderr}`).toBe(false)
      expect(code, `退出码非 0，stderr=${stderr}`).toBe(0)
      // 关闭连接池确实超时了 —— 证明测的是真实的挂起场景，而非被 mock 绕过
      expect(stdout).toContain('close=timeout')
    },
    TIMEOUT_MS,
  )

  it(
    'process.exit 前的最后一行日志不被截断',
    async () => {
      const { stdout } = await runFixture()

      // 容器里 stdout 是管道（异步写），没有 flush 就会丢掉这行——
      // 而它正是线上判断"迁移阶段是否真的走完"的证据
      expect(stdout).toContain('[fixture] 即将退出')
    },
    TIMEOUT_MS,
  )
})
