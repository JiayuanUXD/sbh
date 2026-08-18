/**
 * seed 目标环境守卫（真实事故驱动）
 *
 * 2026-08-15 17:10:59Z，本地一次 `pnpm seed:media` 用主工作树 .env.local 里的
 * **生产 COS 凭据**跑了起来：DB 写进了本地库（生产 media 表的 filesize 至今未变），
 * 但 COS 对象按同名 key 直接覆盖，把生产的 hero-bg.mp4（1,232,907 字节真视频）
 * 换成了 15,269 字节的纯音轨 E2E 占位 fixture，首页 hero 视频从此不再出画。
 * 同批被覆盖的还有 landing-hero-publish/entrust-20260810.jpg。
 *
 * 守卫是纯函数：只看 env 快照判定目标是不是生产，不做任何 IO。
 */

import { describe, expect, it } from 'vitest'

import {
  PRODUCTION_COS_BUCKET,
  assertSeedTargetNotProduction,
  detectProductionSeedTargets,
} from '@/lib/runtime/seed-target-guard'

const LOCAL_DB = 'postgres://postgres:root@localhost:5432/sbh_dev'

describe('detectProductionSeedTargets', () => {
  it('生产 COS 桶被识别为生产目标', () => {
    expect(
      detectProductionSeedTargets({ cosBucket: PRODUCTION_COS_BUCKET, databaseUrl: LOCAL_DB }),
    ).toEqual(['COS 桶 sbh-1253925058'])
  })

  it('非本地数据库主机被识别为生产目标', () => {
    const targets = detectProductionSeedTargets({
      databaseUrl: 'postgres://u:p@gz-postgres-abc123.sql.tencentcdb.com:5432/sbh',
    })
    expect(targets).toEqual(['数据库主机 gz-postgres-abc123.sql.tencentcdb.com'])
  })

  it('两者同时命中时都要报出来，不能只报第一个', () => {
    const targets = detectProductionSeedTargets({
      cosBucket: PRODUCTION_COS_BUCKET,
      databaseUrl: 'postgres://u:p@gz-postgres-abc123.sql.tencentcdb.com:5432/sbh',
    })
    expect(targets).toHaveLength(2)
  })

  it('本地与 CI 的常见形态一律放行', () => {
    // 本地：无 COS（媒体落磁盘）
    expect(detectProductionSeedTargets({ databaseUrl: LOCAL_DB })).toEqual([])
    // 本地：占位 COS 桶（CLAUDE.md 推荐写法，防止 generate:types 删掉 Media.prefix）
    expect(
      detectProductionSeedTargets({ cosBucket: 'local-dev-1250000000', databaseUrl: LOCAL_DB }),
    ).toEqual([])
    // CI：quality.yml 的 service 容器
    expect(
      detectProductionSeedTargets({
        databaseUrl: 'postgres://payload:payload@127.0.0.1:5432/payload_m0',
      }),
    ).toEqual([])
    // 其它 worktree 的独立库
    expect(
      detectProductionSeedTargets({ databaseUrl: 'postgres://postgres:root@::1:5432/sbh_dev_x' }),
    ).toEqual([])
  })

  it('DATABASE_URL 缺失或无法解析时不误判为生产', () => {
    expect(detectProductionSeedTargets({})).toEqual([])
    expect(detectProductionSeedTargets({ databaseUrl: '' })).toEqual([])
    expect(detectProductionSeedTargets({ databaseUrl: '这不是连接串' })).toEqual([])
  })
})

describe('assertSeedTargetNotProduction', () => {
  it('命中生产目标 → 抛错，且错误信息点名具体目标与逃生舱', () => {
    expect(() =>
      assertSeedTargetNotProduction({ cosBucket: PRODUCTION_COS_BUCKET, databaseUrl: LOCAL_DB }),
    ).toThrow(/sbh-1253925058[\s\S]*ALLOW_PRODUCTION_SEED/)
  })

  it('显式逃生舱 ALLOW_PRODUCTION_SEED=1 时放行', () => {
    expect(() =>
      assertSeedTargetNotProduction({
        cosBucket: PRODUCTION_COS_BUCKET,
        databaseUrl: LOCAL_DB,
        allowProductionSeed: '1',
      }),
    ).not.toThrow()
  })

  it('逃生舱取其它值不放行——只认 "1"，避免 ALLOW_PRODUCTION_SEED=false 误放行', () => {
    for (const v of ['0', 'false', 'true', 'yes', '']) {
      expect(() =>
        assertSeedTargetNotProduction({
          cosBucket: PRODUCTION_COS_BUCKET,
          databaseUrl: LOCAL_DB,
          allowProductionSeed: v,
        }),
      ).toThrow()
    }
  })

  it('本地目标直接放行', () => {
    expect(() => assertSeedTargetNotProduction({ databaseUrl: LOCAL_DB })).not.toThrow()
  })
})
