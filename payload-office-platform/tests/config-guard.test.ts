import { describe, it, expect } from 'vitest'
import {
  validateProductionConfig,
  assertProductionConfig,
  type ConfigGuardEnv,
} from '../src/lib/runtime/config-guard'

const VALID: ConfigGuardEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://user:pass@host:5432/db',
  PAYLOAD_SECRET: 'a'.repeat(40),
  NEXT_PUBLIC_SITE_URL: 'https://sbh.example.com',
  COS_BUCKET: 'sbh-media-1253925058',
  COS_REGION: 'ap-shanghai',
  COS_ENDPOINT: 'https://cos.ap-shanghai.myqcloud.com',
  COS_SECRET_ID: 'secret-id',
  COS_SECRET_KEY: 'secret-key',
}

describe('config-guard: dev/test 环境不阻断', () => {
  it('NODE_ENV=development 时返回空违例列表（允许 SQLite + 默认密钥）', () => {
    expect(validateProductionConfig({ NODE_ENV: 'development' })).toEqual([])
    expect(validateProductionConfig({})).toEqual([])
  })

  it('dev 模式 assertProductionConfig 不抛错，即使 env 全空', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'test' })).not.toThrow()
    expect(() => assertProductionConfig({})).not.toThrow()
  })
})

describe('config-guard: 生产 DATABASE_URL 必须是 PostgreSQL', () => {
  it('缺失 -> 违例（拒绝降级 SQLite）', () => {
    const v = validateProductionConfig({ ...VALID, DATABASE_URL: undefined })
    expect(v.some((x) => x.field === 'DATABASE_URL' && /缺少/.test(x.reason))).toBe(true)
  })
  it('非 postgres 开头 -> 违例', () => {
    const v = validateProductionConfig({ ...VALID, DATABASE_URL: 'file:./local.db' })
    expect(v.some((x) => x.field === 'DATABASE_URL' && /PostgreSQL/.test(x.reason))).toBe(true)
  })
  it('合法 postgres 连接串 -> 无 DATABASE_URL 违例', () => {
    const v = validateProductionConfig(VALID)
    expect(v.filter((x) => x.field === 'DATABASE_URL')).toEqual([])
  })
})

describe('config-guard: 生产 PAYLOAD_SECRET 强密钥', () => {
  it('缺失 -> 违例', () => {
    const v = validateProductionConfig({ ...VALID, PAYLOAD_SECRET: undefined })
    expect(v.some((x) => x.field === 'PAYLOAD_SECRET' && /缺少/.test(x.reason))).toBe(true)
  })
  it('长度不足 32 -> 违例', () => {
    const v = validateProductionConfig({ ...VALID, PAYLOAD_SECRET: 'short' })
    expect(v.some((x) => x.field === 'PAYLOAD_SECRET' && /长度/.test(x.reason))).toBe(true)
  })
  it('已知弱默认值 -> 违例（即使长度足够）', () => {
    const weak = 'local-dev-secret-change-me' // 27 字符，但属弱默认
    const v = validateProductionConfig({ ...VALID, PAYLOAD_SECRET: weak })
    expect(v.some((x) => x.field === 'PAYLOAD_SECRET' && /弱默认值/.test(x.reason))).toBe(true)
  })
  it('合法强密钥 -> 无违例', () => {
    const v = validateProductionConfig({ ...VALID, PAYLOAD_SECRET: 'x'.repeat(48) })
    expect(v.filter((x) => x.field === 'PAYLOAD_SECRET')).toEqual([])
  })
})

describe('config-guard: 生产 NEXT_PUBLIC_SITE_URL 合法 https', () => {
  it('缺失 -> 违例', () => {
    const v = validateProductionConfig({ ...VALID, NEXT_PUBLIC_SITE_URL: undefined })
    expect(v.some((x) => x.field === 'NEXT_PUBLIC_SITE_URL' && /缺少/.test(x.reason))).toBe(true)
  })
  it('非 https -> 违例', () => {
    const v = validateProductionConfig({ ...VALID, NEXT_PUBLIC_SITE_URL: 'http://sbh.example.com' })
    expect(v.some((x) => x.field === 'NEXT_PUBLIC_SITE_URL' && /https/.test(x.reason))).toBe(true)
  })
  it('localhost -> 违例', () => {
    const v = validateProductionConfig({ ...VALID, NEXT_PUBLIC_SITE_URL: 'https://localhost:3000' })
    expect(v.some((x) => x.field === 'NEXT_PUBLIC_SITE_URL' && /localhost/.test(x.reason))).toBe(true)
  })
  it('非法 URL -> 违例', () => {
    const v = validateProductionConfig({ ...VALID, NEXT_PUBLIC_SITE_URL: 'not-a-url' })
    expect(v.some((x) => x.field === 'NEXT_PUBLIC_SITE_URL' && /合法 URL/.test(x.reason))).toBe(true)
  })
})

describe('config-guard: 生产媒体必须使用 COS', () => {
  it('未配置 COS 时拒绝启动，避免上传落到 CloudRun 临时磁盘', () => {
    const v = validateProductionConfig({
      ...VALID,
      COS_BUCKET: undefined,
      COS_REGION: undefined,
      COS_ENDPOINT: undefined,
      COS_SECRET_ID: undefined,
      COS_SECRET_KEY: undefined,
    })
    expect(v.some((x) => x.field === 'COS_STORAGE' && /临时磁盘/.test(x.reason))).toBe(true)
  })
  it('CI e2e（CI=true）未配置 COS 不拒绝：媒体走 seed-media 离线 sharp，非 CloudRun 部署', () => {
    const v = validateProductionConfig({
      ...VALID,
      COS_BUCKET: undefined,
      COS_REGION: undefined,
      COS_ENDPOINT: undefined,
      COS_SECRET_ID: undefined,
      COS_SECRET_KEY: undefined,
      CI: 'true',
    })
    expect(v.some((x) => x.field === 'COS_STORAGE')).toBe(false)
  })
})

describe('config-guard: assertProductionConfig 整体行为', () => {
  it('生产全部合法时不抛错', () => {
    expect(() => assertProductionConfig(VALID)).not.toThrow()
  })
  it('生产多项缺失时抛错，且错误信息含所有违例字段', () => {
    try {
      assertProductionConfig({
        NODE_ENV: 'production',
        DATABASE_URL: undefined,
        PAYLOAD_SECRET: 'short',
        NEXT_PUBLIC_SITE_URL: 'http://localhost',
      })
      expect.fail('应抛错')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('fail-closed')
      expect(msg).toContain('DATABASE_URL')
      expect(msg).toContain('PAYLOAD_SECRET')
      expect(msg).toContain('NEXT_PUBLIC_SITE_URL')
    }
  })
  it('生产缺 DATABASE_URL 时抛错（拒绝静默降级 SQLite）', () => {
    expect(() =>
      assertProductionConfig({ ...VALID, DATABASE_URL: undefined }),
    ).toThrow(/DATABASE_URL/)
  })
})
