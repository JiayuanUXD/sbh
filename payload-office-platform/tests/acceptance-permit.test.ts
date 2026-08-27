import { describe, expect, it } from 'vitest'
import {
  acceptanceFixtureNamespace,
  issueAcceptancePermit,
  verifyAcceptancePermit,
  parseAcceptancePermitContext,
  signAcceptancePermitPayloadForTests,
  verifyAcceptancePermitToken,
} from '@/domain/mini-program/acceptance-permit'

const context = {
  runId: '550e8400-e29b-41d4-a716-446655440000',
  fixtureNamespace: acceptanceFixtureNamespace('550e8400-e29b-41d4-a716-446655440000'),
  expectedGitCommitSha: 'a'.repeat(40),
  expectedDeploymentRevision: 'rev-1',
  expectedDbFingerprint: 'b'.repeat(64),
}
const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1)

function signedPayload(changes: Record<string, unknown> = {}): string {
  const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 7))
  return signAcceptancePermitPayloadForTests({ ...issued.payload, ...changes }, secret)
}

describe('acceptance permit', () => {
  it('签发后可在同一上下文验证，且跨上下文/篡改拒绝', () => {
    const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 7))
    expect(verifyAcceptancePermit(issued.token, context, secret, 1_700_000_001_000)).toMatchObject({
      purpose: 'acceptance-write',
      runId: context.runId,
    })
    expect(verifyAcceptancePermit(`${issued.token}x`, context, secret, 1_700_000_001_000)).toBeNull()
    expect(verifyAcceptancePermit(`${issued.token}.`, context, secret, 1_700_000_001_000)).toBeNull()
    expect(verifyAcceptancePermit(`${issued.token}..junk`, context, secret, 1_700_000_001_000)).toBeNull()
    expect(
      verifyAcceptancePermit(
        `${issued.token.split('.')[0]}..${issued.token.split('.')[1]}`,
        context,
        secret,
        1_700_000_001_000,
      ),
    ).toBeNull()
    expect(
      verifyAcceptancePermit(
        issued.token,
        { ...context, expectedDeploymentRevision: 'other' },
        secret,
        1_700_000_001_000,
      ),
    ).toBeNull()
  })

  it('独立 token verifier 接受有效 token 并校验 intrinsic context', () => {
    const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 7))
    expect(verifyAcceptancePermitToken(issued.token, secret, 1_700_000_001_000)).toEqual(issued.payload)
    expect(
      verifyAcceptancePermitToken(
        signedPayload({ runId: '650e8400-e29b-41d4-a716-446655440000' }),
        secret,
        1_700_000_001_000,
      ),
    ).toBeNull()
    expect(
      verifyAcceptancePermitToken(signedPayload({ fixtureNamespace: 'wrong' }), secret, 1_700_000_001_000),
    ).toBeNull()
    expect(verifyAcceptancePermitToken(signedPayload({ gitSHA: 'bad' }), secret, 1_700_000_001_000)).toBeNull()
    expect(
      verifyAcceptancePermitToken(signedPayload({ revision: 'bad revision' }), secret, 1_700_000_001_000),
    ).toBeNull()
    expect(verifyAcceptancePermitToken(signedPayload({ dbFingerprint: 'bad' }), secret, 1_700_000_001_000)).toBeNull()
    expect(
      verifyAcceptancePermitToken(signedPayload({ exp: issued.payload.exp + 1 }), secret, 1_700_000_001_000),
    ).toBeNull()
  })

  it('过期、未来 iat 与非法 namespace 拒绝', () => {
    const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 8))
    expect(verifyAcceptancePermit(issued.token, context, secret, issued.payload.exp + 1)).toBeNull()
    const future = issueAcceptancePermit(context, secret, 1_700_000_100_000, () => Buffer.alloc(16, 9))
    expect(verifyAcceptancePermit(future.token, context, secret, 1_700_000_000_000)).toBeNull()
    expect(() => issueAcceptancePermit({ ...context, fixtureNamespace: 'wrong' }, secret)).toThrow()
  })

  it.each([
    [
      'run',
      {
        runId: '650e8400-e29b-41d4-a716-446655440000',
        fixtureNamespace: acceptanceFixtureNamespace('650e8400-e29b-41d4-a716-446655440000'),
      },
    ],
    ['SHA', { expectedGitCommitSha: 'c'.repeat(40) }],
    ['revision', { expectedDeploymentRevision: 'other' }],
    ['fingerprint', { expectedDbFingerprint: 'c'.repeat(64) }],
  ])('拒绝跨上下文 %s', (_label, change) => {
    const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 7))
    const candidate = { ...context, ...change }
    expect(verifyAcceptancePermit(issued.token, candidate, secret, 1_700_000_001_000)).toBeNull()
  })

  it('严格拒绝额外/缺失字段与错误 context 类型', () => {
    expect(parseAcceptancePermitContext({ ...context, extra: true })).toBeNull()
    expect(parseAcceptancePermitContext({ ...context, expectedDbFingerprint: undefined })).toBeNull()
    expect(parseAcceptancePermitContext({ ...context, runId: 1 })).toBeNull()
  })

  it.each(['runId', 'fixtureNamespace', 'expectedDbFingerprint'])('parser 拒绝缺失字段 %s', (field) => {
    const candidate = { ...context }
    delete (candidate as Record<string, unknown>)[field]
    expect(parseAcceptancePermitContext(candidate)).toBeNull()
  })

  it('parser 拒绝继承字段', () => {
    const inherited = Object.create({ expectedDbFingerprint: context.expectedDbFingerprint })
    Object.assign(inherited, {
      runId: context.runId,
      fixtureNamespace: context.fixtureNamespace,
      expectedGitCommitSha: context.expectedGitCommitSha,
      expectedDeploymentRevision: context.expectedDeploymentRevision,
    })
    expect(parseAcceptancePermitContext(inherited)).toBeNull()
  })

  it.each([15, 17])('随机 jti 必须恰好 16 bytes：%s', (length) => {
    expect(() => issueAcceptancePermit(context, secret, Date.now(), () => Buffer.alloc(length))).toThrow()
  })

  it.each([
    ['已签名 extra key', { extra: true }],
    ['已签名 missing key', { __missing: true }],
    ['已签名 jti empty', { jti: '' }],
    ['已签名 jti noncanonical', { jti: Buffer.alloc(16, 7).toString('base64') }],
    ['已签名 jti15', { jti: Buffer.alloc(15, 7).toString('base64url') }],
    ['已签名 jti17', { jti: Buffer.alloc(17, 7).toString('base64url') }],
    ['已签名 iat decimal', { iat: 1_700_000_000_000.5 }],
    ['已签名 exp decimal', { exp: 1_700_000_600_000.5 }],
  ])('%s verify 为 null', (_label, change) => {
    const changeRecord = change as Record<string, unknown>
    if (changeRecord.__missing) {
      const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 7))
      const payload: Record<string, unknown> = { ...issued.payload }
      delete payload.jti
      expect(
        verifyAcceptancePermit(
          signAcceptancePermitPayloadForTests(payload, secret),
          context,
          secret,
          1_700_000_001_000,
        ),
      ).toBeNull()
      return
    }
    expect(verifyAcceptancePermit(signedPayload(changeRecord), context, secret, 1_700_000_001_000)).toBeNull()
  })

  it('超长 token、body 篡改、signature 篡改均拒绝', () => {
    const token = signedPayload()
    expect(verifyAcceptancePermit(`${token}${'x'.repeat(4097)}`, context, secret, 1_700_000_001_000)).toBeNull()
    const [body, signature] = token.split('.')
    expect(verifyAcceptancePermit(`x${body.slice(1)}.${signature}`, context, secret, 1_700_000_001_000)).toBeNull()
    expect(verifyAcceptancePermit(`${body}.${signature.slice(0, -1)}x`, context, secret, 1_700_000_001_000)).toBeNull()
  })

  it.each([-1, 1_700_000_000_000.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    'issue 非法 now %s 抛错',
    (now) => {
      expect(() => issueAcceptancePermit(context, secret, now)).toThrow()
    },
  )

  it.each([-1, 1_700_000_000_000.5, Number.MAX_SAFE_INTEGER + 1])('verify 非法 now %s 返回 null', (now) => {
    expect(verifyAcceptancePermit(signedPayload(), context, secret, now)).toBeNull()
  })

  it('verify 使用格式非法 context 返回 null', () => {
    const invalidContext = { ...context, expectedGitCommitSha: 'bad' }
    const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 7))
    const malicious = signAcceptancePermitPayloadForTests({ ...issued.payload, gitSHA: 'bad' }, secret)
    expect(verifyAcceptancePermit(malicious, invalidContext, secret, 1_700_000_001_000)).toBeNull()
  })

  it.each([null, [], 'payload'])('已签名非对象 payload %j 返回 null', (payload) => {
    const token = signAcceptancePermitPayloadForTests(payload, secret)
    expect(() => verifyAcceptancePermit(token, context, secret, 1_700_000_001_000)).not.toThrow()
    expect(verifyAcceptancePermit(token, context, secret, 1_700_000_001_000)).toBeNull()
  })
})
