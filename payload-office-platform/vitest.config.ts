import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

/**
 * `tests/*-postgres.test.ts` 要的是 migrate + seed 过的真库，各自用
 * `describe.skipIf(!DATABASE_URL)` 自我禁用。但它们顶层就 `import config from '@/payload.config'`，
 * 整文件跳过也得先付 6~8s 的冷加载——8 个文件约占全量 15% 的时长，全部白付。
 * 没有库就干脆不收集。CI 里真正跑它们的是 `postgres-migrations` 作业：带 DATABASE_URL
 * 且按路径显式点名，不受影响。判据与用例内的 skipIf 保持一致。
 */
const hasPostgres =
  typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: hasPostgres
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'tests/*-postgres.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    // 线程池省掉每个 worker 的子进程启动（默认 forks）。全量实测 74s → 66s，4796 用例全绿；
    // 前提是测试里没有 process.chdir 这类线程不支持的调用（2026-09-11 核对：没有）。
    pool: 'threads',
  },
})
