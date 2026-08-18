/**
 * 出售频道功能开关单测
 *
 * 守护不变量：
 *   - 不设变量即关闭（默认安全，忘记配置不会意外放出功能）
 *   - 只有精确的 'true' 才算开启，避免 '1' / 'yes' / 'TRUE' 这类值被误判
 *   - 开关只影响可见性，不影响数据层的租售隔离
 */

import { afterEach, describe, expect, it } from 'vitest'

import { getSaleChannelEnabled } from '@/lib/frontend/site-config'

const KEY = 'NEXT_PUBLIC_SALE_CHANNEL_ENABLED'
const original = process.env[KEY]

afterEach(() => {
  if (original === undefined) delete process.env[KEY]
  else process.env[KEY] = original
})

describe('sale-channel-flag', () => {
  it('未设置时关闭（默认安全）', () => {
    delete process.env[KEY]
    expect(getSaleChannelEnabled()).toBe(false)
  })

  it("精确的 'true' 才开启", () => {
    process.env[KEY] = 'true'
    expect(getSaleChannelEnabled()).toBe(true)
  })

  it.each(['1', 'yes', 'TRUE', 'True', 'on', '', ' true '])(
    '值为 %j 时保持关闭（不做宽松解析）',
    (value) => {
      process.env[KEY] = value
      expect(getSaleChannelEnabled()).toBe(false)
    },
  )

  it("'false' 关闭", () => {
    process.env[KEY] = 'false'
    expect(getSaleChannelEnabled()).toBe(false)
  })
})
