import { describe, expect, it } from 'vitest'

import { resolveSiteVerification } from '@/lib/frontend/site-verification'

describe('resolveSiteVerification', () => {
  it('全部缺省时不输出任何验证标记', () => {
    expect(resolveSiteVerification({})).toBeUndefined()
    expect(resolveSiteVerification({ SITE_VERIFY_GOOGLE: '', SITE_VERIFY_BAIDU: '  ' })).toBeUndefined()
  })

  it('三个平台各自映射到对应的 meta 名', () => {
    expect(
      resolveSiteVerification({
        SITE_VERIFY_GOOGLE: 'g-token_123',
        SITE_VERIFY_BAIDU: 'codeva-AbC123',
        SITE_VERIFY_BING: 'ABCDEF0123456789',
      }),
    ).toEqual({
      google: 'g-token_123',
      other: { 'baidu-site-verification': 'codeva-AbC123', 'msvalidate.01': 'ABCDEF0123456789' },
    })
  })

  it('只配了一个平台时只输出它', () => {
    expect(resolveSiteVerification({ SITE_VERIFY_BAIDU: 'codeva-AbC123' })).toEqual({
      other: { 'baidu-site-verification': 'codeva-AbC123' },
    })
  })

  it('首尾空白会被去掉', () => {
    expect(resolveSiteVerification({ SITE_VERIFY_GOOGLE: '  g-token_123\n' })).toEqual({ google: 'g-token_123' })
  })

  it('含引号、尖括号或空格的值视为配错并丢弃，不会写坏 meta 标签', () => {
    expect(resolveSiteVerification({ SITE_VERIFY_GOOGLE: '"><script>alert(1)</script>' })).toBeUndefined()
    expect(resolveSiteVerification({ SITE_VERIFY_BAIDU: 'has space inside' })).toBeUndefined()
    expect(resolveSiteVerification({ SITE_VERIFY_BING: 'short' })).toBeUndefined()
  })
})
