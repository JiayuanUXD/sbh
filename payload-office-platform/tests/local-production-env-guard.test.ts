/**
 * 本机生产模式守卫（真实事故驱动）
 *
 * 2026-10-15 OPT-114 验收时，在主工作树起 `CI=1 pnpm start` 做性能复测。主树
 * `.env.production.local` 是全套生产凭据，`next start` 读它且优先于 `.env.local`，
 * 于是这个本地实例连着生产库在线约 1 分钟，并按 jobs.autoRun 轮询生产任务队列
 * （事后只读核查确认无写入）。
 *
 * 判定是纯函数：env 快照 + cwd 下实际存在的 env 文件名 → 命中与否，不做 IO；
 * 只有 listPresentEnvFiles 碰文件系统，单独用临时目录测。
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  NEXT_AUTOLOADED_ENV_FILES,
  assertNotLocalProductionEnv,
  detectLocalProductionEnv,
  listPresentEnvFiles,
} from '@/lib/runtime/local-production-env-guard'
import { PRODUCTION_COS_BUCKET } from '@/lib/runtime/seed-target-guard'

const PROD_DB = 'postgres://u:p@gz-postgres-abc123.sql.tencentcdb.com:5432/sbh'
const LOCAL_DB = 'postgres://postgres:root@localhost:5432/sbh_dev'

describe('detectLocalProductionEnv', () => {
  it('生产容器形态放行：cwd 下没有 Next 会自动加载的 env 文件，即使连的就是生产库与生产桶', () => {
    expect(
      detectLocalProductionEnv(
        { NODE_ENV: 'production', DATABASE_URL: PROD_DB, COS_BUCKET: PRODUCTION_COS_BUCKET },
        [],
      ),
    ).toBeNull()
  })

  it('主工作树形态命中：有 .env.production.local 且库主机不是环回地址（OPT-114 原样）', () => {
    expect(
      detectLocalProductionEnv({ NODE_ENV: 'production', DATABASE_URL: PROD_DB }, [
        '.env.production.local',
        '.env.local',
      ]),
    ).toEqual({
      envFiles: ['.env.production.local', '.env.local'],
      targets: ['数据库主机 gz-postgres-abc123.sql.tencentcdb.com'],
    })
  })

  it('「本地库 + 生产桶」同样命中（2026-08-15 覆盖生产 hero 视频的组合）', () => {
    expect(
      detectLocalProductionEnv(
        { NODE_ENV: 'production', DATABASE_URL: LOCAL_DB, COS_BUCKET: PRODUCTION_COS_BUCKET },
        ['.env.local'],
      ),
    ).toEqual({ envFiles: ['.env.local'], targets: ['COS 桶 sbh-1253925058'] })
  })

  it('干净 worktree / CI 等价 E2E 放行：有 .env.local，但库在环回地址、没配生产桶', () => {
    expect(
      detectLocalProductionEnv({ NODE_ENV: 'production', DATABASE_URL: LOCAL_DB }, ['.env.local']),
    ).toBeNull()
    expect(
      detectLocalProductionEnv(
        { NODE_ENV: 'production', DATABASE_URL: 'postgres://payload:payload@127.0.0.1:5432/payload_m0' },
        ['.env.local'],
      ),
    ).toBeNull()
  })

  it('非生产模式一律放行：dev 不读 .env.production*，test 下 vitest 会顶层 import payload.config', () => {
    for (const NODE_ENV of ['development', 'test', undefined]) {
      expect(
        detectLocalProductionEnv({ NODE_ENV, DATABASE_URL: PROD_DB }, ['.env.production.local']),
      ).toBeNull()
    }
  })

  it('next build（含 collectPageData worker）放行：构建期不连库，且主树本地 build 不该被拦', () => {
    expect(
      detectLocalProductionEnv(
        { NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build', DATABASE_URL: PROD_DB },
        ['.env.production.local'],
      ),
    ).toBeNull()
  })

  it('ALLOW_LOCAL_PRODUCTION_ENV 只认字面量 1，写成 true / 0 不能放行', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: PROD_DB }
    const files = ['.env.production.local']

    expect(detectLocalProductionEnv({ ...base, ALLOW_LOCAL_PRODUCTION_ENV: '1' }, files)).toBeNull()
    for (const value of ['true', '0', 'yes', '']) {
      expect(
        detectLocalProductionEnv({ ...base, ALLOW_LOCAL_PRODUCTION_ENV: value }, files),
      ).not.toBeNull()
    }
  })

  it('只有 Next 会自动加载的文件才算本机信号：.env.example 等不算', () => {
    expect(
      detectLocalProductionEnv({ NODE_ENV: 'production', DATABASE_URL: PROD_DB }, [
        '.env.example',
        '.env.prod-credentials',
      ]),
    ).toBeNull()
  })
})

describe('assertNotLocalProductionEnv', () => {
  it('命中时抛错，文案带上文件、目标、处置与放行开关', () => {
    let message = ''
    try {
      assertNotLocalProductionEnv({ NODE_ENV: 'production', DATABASE_URL: PROD_DB }, [
        '.env.production.local',
      ])
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('.env.production.local')
    expect(message).toContain('数据库主机 gz-postgres-abc123.sql.tencentcdb.com')
    expect(message).toContain('PAYLOAD_DISABLE_JOB_AUTORUN=1')
    expect(message).toContain('ALLOW_LOCAL_PRODUCTION_ENV=1')
    expect(message).toContain('.agent/testing.md')
  })

  it('不命中时不抛', () => {
    expect(() =>
      assertNotLocalProductionEnv({ NODE_ENV: 'production', DATABASE_URL: PROD_DB }, []),
    ).not.toThrow()
  })
})

describe('listPresentEnvFiles', () => {
  let dir = ''

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('按 Next 的加载顺序列出目录里实际存在的自动加载文件，忽略其它 .env*', () => {
    dir = mkdtempSync(join(tmpdir(), 'local-prod-env-guard-'))
    for (const name of ['.env.local', '.env.production.local', '.env.example']) {
      writeFileSync(join(dir, name), '')
    }

    expect(listPresentEnvFiles(dir)).toEqual(['.env.production.local', '.env.local'])
  })

  it('空目录返回空数组', () => {
    dir = mkdtempSync(join(tmpdir(), 'local-prod-env-guard-'))
    expect(listPresentEnvFiles(dir)).toEqual([])
  })

  it('覆盖 Next production 模式自动加载的全部四个文件', () => {
    expect([...NEXT_AUTOLOADED_ENV_FILES]).toEqual([
      '.env.production.local',
      '.env.local',
      '.env.production',
      '.env',
    ])
  })
})

describe('payload.config 接线', () => {
  const source = readFileSync(
    resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/payload.config.ts'),
    'utf8',
  )

  it('在顶层、buildConfig 之前调用守卫：onInit 在 db 连接之后才跑，jobs autoRun 也随 init 启动', () => {
    const call = source.indexOf('assertNotLocalProductionEnvFromProcess()')
    expect(call, 'payload.config.ts 未调用 assertNotLocalProductionEnvFromProcess()').toBeGreaterThan(-1)
    expect(call).toBeLessThan(source.indexOf('buildConfig({'))

    const onInit = source.indexOf('onInit:')
    expect(onInit).toBeGreaterThan(-1)
    expect(call).toBeLessThan(onInit)
  })
})
