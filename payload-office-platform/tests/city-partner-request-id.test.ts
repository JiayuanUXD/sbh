/**
 * 城市合伙人申请 requestId 的强度回归测试
 *
 * requestId 不只是幂等键：第二阶段按 `request_id AND contact_phone` 定位申请
 * （domain/city-partner-application/public-service.ts），实际承担能力凭据的作用。
 * 曾经的降级路径是 `Date.now()-Math.random()*1e6`（约 20 bit 且非密码学随机），
 * 知道对方手机号的人可以在限流允许的范围内枚举，从而补写他人申请的补充信息。
 *
 * 本测试锁定：任何降级路径都不得产出可猜测的 requestId。
 */
// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { newRequestId } from '@/components/frontend/city-partner/CityPartnerApplicationForm'

/** 与 api/city-partner-applications/request-guards.ts 中的校验保持一致。 */
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('城市合伙人 requestId', () => {
  it('有 randomUUID 时使用它，并满足服务端格式校验', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      getRandomValues: () => {
        throw new Error('不应走到 getRandomValues')
      },
    })
    const id = newRequestId()
    expect(id).toBe('city-partner-11111111-2222-4333-8444-555555555555')
    expect(REQUEST_ID.test(id)).toBe(true)
  })

  it('缺少 randomUUID（非安全上下文）时退到 getRandomValues，保留 128 bit', () => {
    const fill = vi.fn((bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = i + 1
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues: fill })

    const id = newRequestId()
    expect(fill).toHaveBeenCalledTimes(1)
    // 请求了 16 字节 = 128 bit
    expect(fill.mock.calls[0]?.[0]).toHaveLength(16)
    expect(id).toBe('city-partner-0102030405060708090a0b0c0d0e0f10')
    expect(REQUEST_ID.test(id)).toBe(true)
  })

  it('完全没有 WebCrypto 时抛错，绝不发放可猜测凭据', () => {
    vi.stubGlobal('crypto', undefined)
    expect(() => newRequestId()).toThrow('city_partner_secure_request_id_unavailable')
  })

  it('不得再出现基于时间戳/Math.random 的降级路径', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    // happy-dom 环境下 import.meta.url 不是 file:// URL，这里用项目根目录定位。
    const path = join(
      process.cwd(),
      'src/components/frontend/city-partner/CityPartnerApplicationForm.tsx',
    )
    // 去掉注释：注释里会说明历史成因时提到这些标识符。
    const source = (await readFile(path, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(source).not.toContain('Math.random')
    expect(source).not.toContain('Date.now')
  })

  it('两次调用不重复（真实 WebCrypto）', () => {
    expect(newRequestId()).not.toBe(newRequestId())
  })
})
