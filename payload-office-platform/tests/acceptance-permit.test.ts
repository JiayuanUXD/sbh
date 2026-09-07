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
  submissionRequestId: '650e8400-e29b-41d4-a716-446655440000',
  listingSlug: 'jingan-center-100-monthly',
  fixtureNamespace: acceptanceFixtureNamespace('550e8400-e29b-41d4-a716-446655440000'),
  expectedGitCommitSha: 'a'.repeat(40),
  expectedDeploymentRevision: 'rev-1',
  expectedDbFingerprint: 'b'.repeat(64),
}
const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1)

type IssueResult = Readonly<{
  token: string
  payload: Readonly<Record<string, unknown>>
}>
type WriteIssueResult = IssueResult & Readonly<{
  recoveryReceipt: string
  recoveryReceiptPayload: Readonly<Record<string, unknown>>
}>
type IssueInspect = (
  candidate: typeof context,
  signingSecret: Uint8Array,
  now: number,
  random: (size: number) => Buffer,
) => IssueResult
type IssueRecovery = (
  candidate: typeof context,
  recoveryReceipt: string,
  recovery: Readonly<{
    recoveryMode: 'unknown-first-write' | 'known-lead'
    expectedLeadId: string | null
  }>,
  signingSecret: Uint8Array,
  now: number,
  random: (size: number) => Buffer,
) => IssueResult
type VerifyToken = (token: string, signingSecret: Uint8Array, now: number) => Readonly<Record<string, unknown>> | null
type VerifyReceipt = (
  token: string,
  candidate: typeof context,
  signingSecret: Uint8Array,
) => Readonly<Record<string, unknown>> | null
type SignReceiptForTests = (payload: unknown, signingSecret: Uint8Array) => string

function requiredExport<T>(domainModule: object, name: string): T {
  const value = (domainModule as Record<string, unknown>)[name]
  expect(value, `missing domain export ${name}`).toBeTypeOf('function')
  if (typeof value !== 'function') throw new Error(`missing domain export ${name}`)
  return value as T
}

function signedPayload(changes: Record<string, unknown> = {}): string {
  const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 7))
  return signAcceptancePermitPayloadForTests({ ...issued.payload, ...changes }, secret)
}

describe('acceptance permit', () => {
  it('完整 identity 要求 submissionRequestId/listingSlug，缺失、错格式与额外字段拒绝', () => {
    expect(parseAcceptancePermitContext(context)).toEqual(context)
    for (const field of ['submissionRequestId', 'listingSlug'] as const) {
      const missing: Record<string, unknown> = { ...context }
      delete missing[field]
      expect(parseAcceptancePermitContext(missing)).toBeNull()
    }
    expect(parseAcceptancePermitContext({ ...context, submissionRequestId: 'bad' })).toBeNull()
    expect(parseAcceptancePermitContext({ ...context, listingSlug: 'Jingan-Center' })).toBeNull()
    expect(parseAcceptancePermitContext({ ...context, listingSlug: 'jingan-center/' })).toBeNull()
  })

  it('write 同时签发独立 recovery receipt，并绑定 writer 时间与完整 identity', async () => {
    const issued = issueAcceptancePermit(
      context,
      secret,
      1_700_000_000_000,
      () => Buffer.alloc(16, 7),
    ) as WriteIssueResult
    expect(issued.payload).toMatchObject({
      purpose: 'acceptance-write',
      runId: context.runId,
      submissionRequestId: context.submissionRequestId,
      listingSlug: context.listingSlug,
    })
    expect(issued.recoveryReceipt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(issued.recoveryReceiptPayload).toMatchObject({
      purpose: 'acceptance-recovery-fence',
      writerJti: issued.payload.jti,
      writerIat: issued.payload.iat,
      writerExp: issued.payload.exp,
      runId: context.runId,
      submissionRequestId: context.submissionRequestId,
      listingSlug: context.listingSlug,
    })

    const domainModule = await import('@/domain/mini-program/acceptance-permit')
    const verifyReceipt = requiredExport<VerifyReceipt>(domainModule, 'verifyAcceptanceRecoveryReceipt')
    expect(verifyReceipt(issued.recoveryReceipt, context, secret)).toEqual(issued.recoveryReceiptPayload)
    expect(verifyReceipt(issued.recoveryReceipt, { ...context, submissionRequestId: '750e8400-e29b-41d4-a716-446655440000' }, secret)).toBeNull()
    expect(verifyReceipt(issued.recoveryReceipt, { ...context, listingSlug: 'other-listing' }, secret)).toBeNull()
  })

  it('write、inspect、recovery scope 与 recovery receipt 的 verifier 严格互斥', async () => {
    const domainModule = await import('@/domain/mini-program/acceptance-permit')
    const issueInspect = requiredExport<IssueInspect>(domainModule, 'issueAcceptanceInspectPermit')
    const issueRecovery = requiredExport<IssueRecovery>(domainModule, 'issueAcceptanceRecoveryPermit')
    const verifyInspect = requiredExport<VerifyToken>(domainModule, 'verifyAcceptanceInspectPermitToken')
    const verifyRecovery = requiredExport<VerifyToken>(domainModule, 'verifyAcceptanceRecoveryPermitToken')
    const verifyReceipt = requiredExport<VerifyReceipt>(domainModule, 'verifyAcceptanceRecoveryReceipt')

    const write = issueAcceptancePermit(
      context,
      secret,
      1_700_000_000_000,
      () => Buffer.alloc(16, 1),
    ) as WriteIssueResult
    const inspect = issueInspect(context, secret, 1_700_000_600_000, () => Buffer.alloc(16, 2))
    const recovery = issueRecovery(
      context,
      write.recoveryReceipt,
      { recoveryMode: 'unknown-first-write', expectedLeadId: null },
      secret,
      1_700_000_600_000,
      () => Buffer.alloc(16, 3),
    )

    expect(verifyAcceptancePermitToken(write.token, secret, 1_700_000_001_000)).toEqual(write.payload)
    expect(verifyInspect(write.token, secret, 1_700_000_001_000)).toBeNull()
    expect(verifyRecovery(write.token, secret, 1_700_000_001_000)).toBeNull()
    expect(verifyReceipt(write.token, context, secret)).toBeNull()

    expect(verifyAcceptancePermitToken(inspect.token, secret, 1_700_000_600_001)).toBeNull()
    expect(verifyInspect(inspect.token, secret, 1_700_000_600_001)).toEqual(inspect.payload)
    expect(verifyRecovery(inspect.token, secret, 1_700_000_600_001)).toBeNull()
    expect(verifyReceipt(inspect.token, context, secret)).toBeNull()

    expect(verifyAcceptancePermitToken(recovery.token, secret, 1_700_000_600_001)).toBeNull()
    expect(verifyInspect(recovery.token, secret, 1_700_000_600_001)).toBeNull()
    expect(verifyRecovery(recovery.token, secret, 1_700_000_600_001)).toEqual(recovery.payload)
    expect(verifyReceipt(recovery.token, context, secret)).toBeNull()
    expect(verifyAcceptancePermitToken(write.recoveryReceipt, secret, 1_700_000_600_001)).toBeNull()
  })

  it('receipt 使用独立领域派生 HMAC key，raw permit key 签名不能伪造 receipt', async () => {
    const domainModule = await import('@/domain/mini-program/acceptance-permit')
    const verifyReceipt = requiredExport<VerifyReceipt>(domainModule, 'verifyAcceptanceRecoveryReceipt')
    const signReceiptForTests = requiredExport<SignReceiptForTests>(
      domainModule,
      'signAcceptanceRecoveryReceiptPayloadForTests',
    )
    const issued = issueAcceptancePermit(
      context,
      secret,
      1_700_000_000_000,
      () => Buffer.alloc(16, 7),
    ) as WriteIssueResult

    const rawKeyForgery = signAcceptancePermitPayloadForTests(issued.recoveryReceiptPayload, secret)
    expect(verifyReceipt(rawKeyForgery, context, secret)).toBeNull()
    const receiptKeyForgery = signReceiptForTests(issued.payload, secret)
    expect(verifyAcceptancePermitToken(receiptKeyForgery, secret, 1_700_000_001_000)).toBeNull()
  })

  it('recovery 必须等旧 writer 到期，并把 receipt digest/mode/expectedLeadId 固化进 token', async () => {
    const domainModule = await import('@/domain/mini-program/acceptance-permit')
    const issueRecovery = requiredExport<IssueRecovery>(domainModule, 'issueAcceptanceRecoveryPermit')
    const verifyRecovery = requiredExport<VerifyToken>(domainModule, 'verifyAcceptanceRecoveryPermitToken')
    const receiptDigest = requiredExport<(token: string) => string>(
      domainModule,
      'acceptanceRecoveryReceiptDigest',
    )
    const issued = issueAcceptancePermit(
      context,
      secret,
      1_700_000_000_000,
      () => Buffer.alloc(16, 7),
    ) as WriteIssueResult

    expect(() => issueRecovery(
      context,
      issued.recoveryReceipt,
      { recoveryMode: 'unknown-first-write', expectedLeadId: null },
      secret,
      1_700_000_599_999,
      () => Buffer.alloc(16, 8),
    )).toThrow('recovery receipt not expired')

    const unknown = issueRecovery(
      context,
      issued.recoveryReceipt,
      { recoveryMode: 'unknown-first-write', expectedLeadId: null },
      secret,
      1_700_000_600_000,
      () => Buffer.alloc(16, 8),
    )
    expect(verifyRecovery(unknown.token, secret, 1_700_000_600_001)).toMatchObject({
      purpose: 'acceptance-recovery',
      recoveryReceiptDigest: receiptDigest(issued.recoveryReceipt),
      recoveryMode: 'unknown-first-write',
      expectedLeadId: null,
    })

    const known = issueRecovery(
      context,
      issued.recoveryReceipt,
      { recoveryMode: 'known-lead', expectedLeadId: 'n:42' },
      secret,
      1_700_000_600_000,
      () => Buffer.alloc(16, 9),
    )
    expect(verifyRecovery(known.token, secret, 1_700_000_600_001)).toMatchObject({
      recoveryMode: 'known-lead',
      expectedLeadId: 'n:42',
    })
    expect(() => issueRecovery(
      context,
      issued.recoveryReceipt,
      { recoveryMode: 'known-lead', expectedLeadId: null },
      secret,
      1_700_000_600_000,
      () => Buffer.alloc(16, 9),
    )).toThrow('invalid recovery context')
    expect(() => issueRecovery(
      context,
      issued.recoveryReceipt,
      { recoveryMode: 'unknown-first-write', expectedLeadId: 'n:42' },
      secret,
      1_700_000_600_000,
      () => Buffer.alloc(16, 9),
    )).toThrow('invalid recovery context')
    expect(() => issueRecovery(
      context,
      issued.recoveryReceipt,
      {
        recoveryMode: 'known-lead',
        expectedLeadId: `s:${Buffer.from([0xff]).toString('base64url')}`,
      },
      secret,
      1_700_000_600_000,
      () => Buffer.alloc(16, 9),
    )).toThrow('invalid recovery context')
  })

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

  it('拒绝 uppercase run UUID，避免签发无法 fixture 清理的 permit', () => {
    const uppercaseRunId = context.runId.toUpperCase()
    const uppercaseContext = {
      ...context,
      runId: uppercaseRunId,
      fixtureNamespace: acceptanceFixtureNamespace(uppercaseRunId),
    }
    expect(() => issueAcceptancePermit(uppercaseContext, secret)).toThrow('invalid permit context')
    expect(parseAcceptancePermitContext(uppercaseContext)).toBeNull()

    const issued = issueAcceptancePermit(context, secret, 1_700_000_000_000, () => Buffer.alloc(16, 7))
    const uppercaseToken = signAcceptancePermitPayloadForTests({
      ...issued.payload,
      runId: uppercaseRunId,
      fixtureNamespace: acceptanceFixtureNamespace(uppercaseRunId),
    }, secret)
    expect(verifyAcceptancePermitToken(uppercaseToken, secret, 1_700_000_001_000)).toBeNull()
  })

  it.each([
    [
      'run',
      {
        runId: '650e8400-e29b-41d4-a716-446655440000',
        fixtureNamespace: acceptanceFixtureNamespace('650e8400-e29b-41d4-a716-446655440000'),
      },
    ],
    ['submission', { submissionRequestId: '750e8400-e29b-41d4-a716-446655440000' }],
    ['listing', { listingSlug: 'other-listing' }],
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
      submissionRequestId: context.submissionRequestId,
      listingSlug: context.listingSlug,
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
