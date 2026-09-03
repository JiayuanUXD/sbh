/**
 * 线索访客标识 visitorRef（OPT-067）
 *
 * 用途：咨询提交成功时把「提交前的匿名浏览路径」接到线索上。
 * 客户端拿到后调 `umami.identify(visitorRef)`，后台线索详情据此深链到
 * Umami 的会话视图。
 *
 * ## 为什么是 HMAC 而不是普通哈希
 *
 * 派生源 `idempotencyKey` 本身是 `SHA-256(requestId|phone|targetType|targetSlug)`。
 * 这几项攻击者是可能知道的（自己的手机号、看的哪套房），若 visitorRef 用普通
 * 哈希派生，任何人都能算出别人的 visitorRef，进而在 Umami 里定位到那个人的
 * 完整浏览路径。加服务端密钥做 HMAC 才切断这条路。
 */

import { describe, expect, it } from 'vitest'

import {
  deriveVisitorRef,
  isVisitorRef,
  resolveVisitorRef,
  VISITOR_REF_LENGTH,
} from '@/domain/inquiry/visitor-ref'

const SECRET = 'test-secret-at-least-32-chars-long-000000'
const KEY_A = 'a'.repeat(64)
const KEY_B = 'b'.repeat(64)

describe('isVisitorRef', () => {
  it('只接受 32 位小写十六进制', () => {
    expect(isVisitorRef('0123456789abcdef0123456789abcdef')).toBe(true)
  })

  it('拒绝长度不对的', () => {
    expect(isVisitorRef('0123456789abcdef')).toBe(false)
    expect(isVisitorRef('0123456789abcdef0123456789abcdef0')).toBe(false)
  })

  it('拒绝大写与非十六进制字符', () => {
    // 大写一律拒绝而不是归一化：回传值只可能来自我们自己发出的小写串，
    // 出现大写说明它被改过，宁可当非法丢弃也不猜测意图
    expect(isVisitorRef('0123456789ABCDEF0123456789abcdef')).toBe(false)
    expect(isVisitorRef('0123456789abcdef0123456789abcdeg')).toBe(false)
    expect(isVisitorRef('0123456789abcdef0123456789abcde ')).toBe(false)
  })

  it('拒绝非字符串', () => {
    expect(isVisitorRef(null)).toBe(false)
    expect(isVisitorRef(undefined)).toBe(false)
    expect(isVisitorRef(123)).toBe(false)
    expect(isVisitorRef({})).toBe(false)
  })
})

describe('deriveVisitorRef', () => {
  it('产出 32 位小写十六进制', () => {
    const ref = deriveVisitorRef(SECRET, KEY_A)
    expect(ref).toHaveLength(VISITOR_REF_LENGTH)
    expect(isVisitorRef(ref)).toBe(true)
  })

  it('同输入稳定（幂等重放必须得到同一个值）', () => {
    // 幂等命中时会重新派生一次，两次不一致会让同一条线索前后拿到不同 ID
    expect(deriveVisitorRef(SECRET, KEY_A)).toBe(deriveVisitorRef(SECRET, KEY_A))
  })

  it('不同 idempotencyKey 得到不同值', () => {
    expect(deriveVisitorRef(SECRET, KEY_A)).not.toBe(deriveVisitorRef(SECRET, KEY_B))
  })

  it('换密钥则结果改变——证明密钥真的参与了运算', () => {
    // 若实现退化成 sha256(idempotencyKey)，这条会红：那样任何知道
    // requestId/手机号/房源 slug 的人都能算出别人的 visitorRef
    expect(deriveVisitorRef(SECRET, KEY_A)).not.toBe(
      deriveVisitorRef(SECRET + 'x', KEY_A),
    )
  })

  it('不是把 idempotencyKey 直接截断', () => {
    // 直接截断等于把幂等键泄露出去，而它可由已知输入复算
    expect(deriveVisitorRef(SECRET, KEY_A)).not.toBe(KEY_A.slice(0, VISITOR_REF_LENGTH))
  })

  it('缺密钥时抛错，而不是静默降级成弱哈希', () => {
    // 静默降级会产出「看起来正常但可被反推」的 ID，比直接失败危险得多
    expect(() => deriveVisitorRef('', KEY_A)).toThrow()
  })
})

describe('resolveVisitorRef', () => {
  it('客户端回传合法值时复用它', () => {
    // 同会话第二条线索要复用首个 ID，否则 umami.identify 的会话级后写覆盖
    // 会让第一条线索的深链失效
    const provided = '0123456789abcdef0123456789abcdef'
    expect(resolveVisitorRef(provided, SECRET, KEY_A)).toBe(provided)
  })

  it('回传非法值时忽略并回落到派生值，不报错', () => {
    // 非法回传只可能是被改过或旧版本客户端，不该让整个提交失败
    for (const bad of ['', 'nope', 'ABCDEF', null, undefined, 42, {}]) {
      expect(resolveVisitorRef(bad, SECRET, KEY_A)).toBe(deriveVisitorRef(SECRET, KEY_A))
    }
  })

  it('未回传时派生', () => {
    expect(resolveVisitorRef(undefined, SECRET, KEY_A)).toBe(deriveVisitorRef(SECRET, KEY_A))
  })
})
