import { describe, expect, it } from 'vitest'
import {
  computeAcceptanceFixtureLocator,
  encodeAcceptanceFixtureLeadId,
  parseAcceptanceFixtureRequest,
  type AcceptanceFixtureRequest,
} from '@/domain/mini-program/acceptance-fixture'

const runId = '550e8400-e29b-41d4-a716-446655440000'
const submissionRequestId = '650e8400-e29b-41d4-a716-446655440000'
const listingSlug = 'jingan-center-100-monthly'

describe('acceptance fixture request', () => {
  it('inspect 只接受 action、submissionRequestId、listingSlug', () => {
    expect(parseAcceptanceFixtureRequest({ action: 'inspect', submissionRequestId, listingSlug })).toEqual({
      ok: true,
      data: { action: 'inspect', submissionRequestId, listingSlug },
    })
  })

  it('cleanup 额外要求不透明 Lead ID，拒绝额外字段', () => {
    expect(parseAcceptanceFixtureRequest({
      action: 'cleanup',
      submissionRequestId,
      listingSlug,
      leadId: encodeAcceptanceFixtureLeadId(42),
    })).toMatchObject({ ok: true })
    expect(parseAcceptanceFixtureRequest({
      action: 'cleanup',
      submissionRequestId,
      listingSlug,
      leadId: encodeAcceptanceFixtureLeadId('42'),
    })).toMatchObject({ ok: true })
    expect(parseAcceptanceFixtureRequest({ action: 'inspect', submissionRequestId, listingSlug, leadId: 'not-allowed' })).toMatchObject({ ok: false })
    expect(parseAcceptanceFixtureRequest({ action: 'cleanup', submissionRequestId, listingSlug, leadId: '' })).toMatchObject({ ok: false })
    expect(parseAcceptanceFixtureRequest({ action: 'cleanup', submissionRequestId, listingSlug, leadId: '42' })).toMatchObject({ ok: false })
    expect(parseAcceptanceFixtureRequest({ action: 'cleanup', submissionRequestId, listingSlug, leadId: 'n:042' })).toMatchObject({ ok: false })
    expect(parseAcceptanceFixtureRequest({ action: 'cleanup', submissionRequestId, listingSlug, leadId: 'n:4.2e1' })).toMatchObject({ ok: false })
  })

  it('拒绝非法 UUID/slug 与继承字段', () => {
    expect(parseAcceptanceFixtureRequest({ action: 'inspect', submissionRequestId: 'bad', listingSlug })).toMatchObject({ ok: false })
    expect(parseAcceptanceFixtureRequest({ action: 'inspect', submissionRequestId, listingSlug: 'Jingan Center' })).toMatchObject({ ok: false })
    const inherited = Object.create({ listingSlug })
    Object.assign(inherited, { action: 'inspect', submissionRequestId })
    expect(parseAcceptanceFixtureRequest(inherited)).toMatchObject({ ok: false })
  })

  it('Reflect own-key 拒绝 symbol 与非枚举额外字段', () => {
    const symbolExtra = { action: 'inspect', submissionRequestId, listingSlug, [Symbol('locator')]: 'attacker' }
    expect(parseAcceptanceFixtureRequest(symbolExtra)).toMatchObject({ ok: false })

    const hiddenExtra = Object.defineProperty(
      { action: 'inspect', submissionRequestId, listingSlug },
      'idempotencyKey',
      { value: 'attacker', enumerable: false },
    )
    expect(parseAcceptanceFixtureRequest(hiddenExtra)).toMatchObject({ ok: false })
  })

  it('cleanup 是要求 leadId 的严格联合类型', () => {
    // @ts-expect-error cleanup 在编译期必须携带规范 leadId
    const invalid: AcceptanceFixtureRequest = { action: 'cleanup', submissionRequestId, listingSlug }
    expect(invalid.action).toBe('cleanup')
  })

  it('Lead ID codec 区分 number 42 与 string 42，并只接受安全正整数', () => {
    expect(encodeAcceptanceFixtureLeadId(42)).toBe('n:42')
    expect(encodeAcceptanceFixtureLeadId('42')).toBe('s:NDI')
    expect(encodeAcceptanceFixtureLeadId(42)).not.toBe(encodeAcceptanceFixtureLeadId('42'))
    expect(encodeAcceptanceFixtureLeadId(Number.MAX_SAFE_INTEGER)).toBe(`n:${Number.MAX_SAFE_INTEGER}`)
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => encodeAcceptanceFixtureLeadId(invalid)).toThrow('invalid acceptance fixture lead id')
    }
  })

  it('string Lead ID 按 UTF-8 bytes 锁定 1/128/129 边界并拒绝控制与空白歧义', () => {
    expect(encodeAcceptanceFixtureLeadId('a')).toBe('s:YQ')
    expect(encodeAcceptanceFixtureLeadId('a'.repeat(128))).toMatch(/^s:/)
    expect(encodeAcceptanceFixtureLeadId('界'.repeat(42))).toMatch(/^s:/) // 126 UTF-8 bytes
    for (const invalid of ['', 'a'.repeat(129), '界'.repeat(43), ' lead', 'lead ', 'lead\n', 'lead\u0085']) {
      expect(() => encodeAcceptanceFixtureLeadId(invalid)).toThrow('invalid acceptance fixture lead id')
    }
  })

  it('同 run 同输入稳定，跨 run 隔离且客户端不能提供 locator', async () => {
    const input: AcceptanceFixtureRequest = { action: 'inspect', submissionRequestId, listingSlug }
    const first = await computeAcceptanceFixtureLocator(runId, input)
    expect(first).toBe(await computeAcceptanceFixtureLocator(runId, input))
    expect(first).not.toBe(await computeAcceptanceFixtureLocator('750e8400-e29b-41d4-a716-446655440000', input))
    expect(() => computeAcceptanceFixtureLocator('not-a-run', input)).toThrow('invalid acceptance fixture locator')
    expect(() => computeAcceptanceFixtureLocator(runId.toUpperCase(), input))
      .toThrow('invalid acceptance fixture locator')
    expect(() => computeAcceptanceFixtureLocator(runId, {
      ...input,
      idempotencyKey: 'attacker',
    } as AcceptanceFixtureRequest)).toThrow('invalid acceptance fixture locator')
  })
})
