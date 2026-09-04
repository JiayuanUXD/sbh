import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as Simulate from 'miniprogram-simulate'

import {
  createInquirySheetController,
  type InquirySheetContext,
  type InquirySheetSnapshot,
} from '../miniprogram/components/inquiry-sheet/controller.js'
import {
  createInquiryService,
  type InquiryInput,
  type InquiryResult,
} from '../miniprogram/services/inquiry.js'
import type { RequestOptions } from '../miniprogram/services/mini-api-contracts.js'

const SUBMISSION_A = '550e8400-e29b-41d4-a716-446655440000'
const SUBMISSION_B = '8d5d0b04-7982-4ac9-940b-68ee15568f31'

const context = Object.freeze({
  target: {
    targetType: 'listing' as const,
    listingSlug: 'jing-an-tower-101',
    buildingSlug: 'jing-an-tower',
  },
  title: '静安中心 101',
  facts: {
    area: '100 ㎡',
    unitPrice: '8.5 元/㎡/天',
    monthlyEstimate: '约 ¥25,500/月',
  },
  policyVersion: '2026-08-27',
}) satisfies InquirySheetContext

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function success(
  targetResolution: 'listing' | 'building' | 'general' = 'listing',
  acceptedExisting = false,
): InquiryResult {
  return {
    ok: true,
    accepted: true,
    acceptedExisting,
    targetResolution,
  }
}

function setup(overrides: Partial<Parameters<typeof createInquirySheetController>[0]> = {}) {
  const snapshots: InquirySheetSnapshot[] = []
  const openIntent = vi.fn(async () => SUBMISSION_A)
  const invalidateIntent = vi.fn()
  const ensureAnonymousContext = vi.fn(async () => 'anonymous-token')
  const openPrivacyContract = vi.fn(async () => undefined)
  const submit = vi.fn(async () => success())
  const dependencies = {
    openIntent,
    invalidateIntent,
    ensureAnonymousContext,
    openPrivacyContract,
    submit,
    onChange: (snapshot: InquirySheetSnapshot) => snapshots.push(snapshot),
    ...overrides,
  }
  const controller = createInquirySheetController(dependencies)
  return {
    controller,
    snapshots,
    openIntent: dependencies.openIntent,
    invalidateIntent: dependencies.invalidateIntent,
    ensureAnonymousContext: dependencies.ensureAnonymousContext,
    openPrivacyContract: dependencies.openPrivacyContract,
    submit: dependencies.submit,
  }
}

async function prepareManual(
  controller: ReturnType<typeof createInquirySheetController>,
): Promise<void> {
  await controller.open(context)
  await controller.verifyPrivacy()
  controller.setMoveInTime(' 2026 年 10 月 ')
  controller.selectManual()
  controller.setPhone('+86 138-0013-(8000)')
  controller.setConsent(true)
}

describe('咨询半屏状态机', () => {
  it('按 closed→preparing→choosing-phone 打开，并发预取 session 但不阻断弹层', async () => {
    const intent = deferred<string | null>()
    const session = deferred<string | null>()
    const { controller, snapshots, ensureAnonymousContext } = setup({
      openIntent: vi.fn(() => intent.promise),
      ensureAnonymousContext: vi.fn(() => session.promise),
    })

    const opening = controller.open(context)
    expect(controller.snapshot()).toMatchObject({
      state: 'preparing',
      context,
      submissionRequestId: null,
      moveInTime: '',
      phone: '',
      consentAccepted: false,
      privacyStatus: 'unchecked',
    })
    await Promise.resolve()
    expect(ensureAnonymousContext).toHaveBeenCalledOnce()

    intent.resolve(SUBMISSION_A)
    await opening
    expect(controller.snapshot()).toMatchObject({
      state: 'choosing-phone',
      submissionRequestId: SUBMISSION_A,
    })
    expect(snapshots.map((snapshot) => snapshot.state)).toEqual([
      'preparing',
      'choosing-phone',
    ])

    session.resolve('anonymous-token')
    await Promise.resolve()
    expect(controller.snapshot().state).toBe('choosing-phone')
  })

  it('session 预取同步异常也不阻断 submission ID 与 choosing-phone', async () => {
    const { controller } = setup({
      ensureAnonymousContext: vi.fn(() => { throw new Error('login adapter failed') }),
    })

    await expect(controller.open(context)).resolves.toBeUndefined()
    expect(controller.snapshot()).toMatchObject({
      state: 'choosing-phone',
      submissionRequestId: SUBMISSION_A,
    })
  })

  it('每次提交前重新确保 session，失败可原表单重试且不调用 inquiry service', async () => {
    const ensureAnonymousContext = vi.fn()
      .mockRejectedValueOnce(new Error('prefetch failed'))
      .mockRejectedValueOnce(new Error('submit session failed'))
      .mockResolvedValueOnce('anonymous-token')
    const submit = vi.fn(async () => success())
    const { controller } = setup({ ensureAnonymousContext, submit })
    await prepareManual(controller)

    await expect(controller.submitManual()).resolves.toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expect(controller.snapshot()).toMatchObject({
      state: 'recoverable-error',
      errorReason: 'session-invalid',
      phone: '+86 138-0013-(8000)',
      consentAccepted: true,
    })

    await expect(controller.submitManual()).resolves.toBe(true)
    expect(ensureAnonymousContext).toHaveBeenCalledTimes(3)
    expect(submit).toHaveBeenCalledOnce()
    expect(controller.snapshot().state).toBe('success')
  })

  it('手工路径精确保留 moveIn/phone/consent/submissionId，并防重复提交', async () => {
    const pending = deferred<InquiryResult>()
    const { controller, submit } = setup({ submit: vi.fn(() => pending.promise) })
    await prepareManual(controller)

    const first = controller.submitManual()
    const second = controller.submitManual()

    expect(controller.snapshot()).toMatchObject({
      state: 'submitting',
      moveInTime: '2026 年 10 月',
      phone: '+86 138-0013-(8000)',
      consentAccepted: true,
      submissionRequestId: SUBMISSION_A,
      busy: true,
      submitDisabled: true,
    })
    await Promise.resolve()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ target: context.target }))
    await expect(second).resolves.toBe(false)

    pending.resolve(success())
    await expect(first).resolves.toBe(true)
    expect(controller.snapshot()).toMatchObject({
      state: 'success',
      submissionRequestId: SUBMISSION_A,
      successMessage: '已收到该房源咨询',
    })
  })

  it('微信授权从 choosing-phone 经过 authorizing/submitting，且拒绝或失败转 manual 不丢表单', async () => {
    const pending = deferred<InquiryResult>()
    const { controller, snapshots } = setup({ submit: vi.fn(() => pending.promise) })
    await controller.open(context)
    await controller.verifyPrivacy()
    controller.setMoveInTime('2026 年 11 月')
    controller.setConsent(true)

    controller.rejectPhoneAuthorization()
    expect(controller.snapshot()).toMatchObject({
      state: 'manual',
      moveInTime: '2026 年 11 月',
      consentAccepted: true,
      submissionRequestId: SUBMISSION_A,
    })

    const submitting = controller.submitPhoneCode('phone-code-once')
    expect(snapshots.slice(-2).map((snapshot) => snapshot.state)).toEqual([
      'authorizing',
      'submitting',
    ])
    pending.resolve({
      ok: false,
      code: 'phone_code_consumed',
      requiresNewPhoneAuthorization: true,
    })
    await submitting

    expect(controller.snapshot()).toMatchObject({
      state: 'recoverable-error',
      errorReason: 'phone-code-consumed',
      phoneMode: 'manual',
      requiresNewPhoneAuthorization: true,
      moveInTime: '2026 年 11 月',
      consentAccepted: true,
      submissionRequestId: SUBMISSION_A,
    })
  })

  it('隐私合同失败/缺 API 时禁用同意和全部提交，重试成功不替用户勾选', async () => {
    const openPrivacyContract = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('privacy api unavailable'))
      .mockResolvedValueOnce(undefined)
    const { controller } = setup({ openPrivacyContract })
    await controller.open(context)
    controller.selectManual()
    controller.setPhone('13800138000')

    await expect(controller.verifyPrivacy()).resolves.toBe(false)
    expect(controller.snapshot()).toMatchObject({
      privacyStatus: 'unavailable',
      consentAccepted: false,
      submitDisabled: true,
    })
    controller.setConsent(true)
    expect(controller.snapshot().consentAccepted).toBe(false)

    await expect(controller.verifyPrivacy()).resolves.toBe(true)
    expect(controller.snapshot()).toMatchObject({
      privacyStatus: 'available',
      consentAccepted: false,
      submitDisabled: true,
    })
    controller.setConsent(true)
    expect(controller.snapshot().submitDisabled).toBe(false)
  })

  it('隐私合同检查中重复点击只调用一次平台 API', async () => {
    const opening = deferred<void>()
    const openPrivacyContract = vi.fn(() => opening.promise)
    const { controller } = setup({ openPrivacyContract })
    await controller.open(context)

    const first = controller.verifyPrivacy()
    const second = controller.verifyPrivacy()
    expect(openPrivacyContract).toHaveBeenCalledOnce()
    await expect(second).resolves.toBe(false)

    opening.resolve()
    await expect(first).resolves.toBe(true)
    expect(controller.snapshot().privacyStatus).toBe('available')
  })

  it('政策版本变化使旧同意失效但保留同一目标的输入和 submission ID', async () => {
    const { controller, openIntent } = setup()
    await prepareManual(controller)

    await controller.syncContext({ ...context, policyVersion: '2026-09-01' })

    expect(openIntent).toHaveBeenCalledTimes(1)
    expect(controller.snapshot()).toMatchObject({
      state: 'manual',
      context: { policyVersion: '2026-09-01' },
      submissionRequestId: SUBMISSION_A,
      moveInTime: '2026 年 10 月',
      phone: '+86 138-0013-(8000)',
      consentAccepted: false,
      privacyStatus: 'unchecked',
    })
  })

  it.each([
    ['session_invalid', 'session-invalid', true],
    ['rate_limited', 'rate-limited', false],
    ['phone_code_consumed', 'phone-code-consumed', true],
    ['inquiry_submit_failed', 'inquiry-submit-failed', false],
    ['network_error', 'network', false],
    ['request_timeout', 'network', false],
    ['service_unavailable', 'service', false],
  ] as const)('只按稳定错误码映射 %s', async (code, reason, requiresAuthorization) => {
    const { controller } = setup({
      submit: vi.fn(async () => ({
        ok: false as const,
        code,
        ...(requiresAuthorization ? { requiresNewPhoneAuthorization: true as const } : {}),
      })),
    })
    await prepareManual(controller)
    await controller.submitManual()

    expect(controller.snapshot()).toMatchObject({
      state: 'recoverable-error',
      errorReason: reason,
      requiresNewPhoneAuthorization: false,
      phone: '+86 138-0013-(8000)',
      submissionRequestId: SUBMISSION_A,
    })
  })

  it.each([
    ['listing', '已收到该房源咨询'],
    ['building', '已转为该楼盘需求'],
    ['general', '已收到找房需求'],
  ] as const)('显示 %s 目标解析的诚实成功文案', async (targetResolution, message) => {
    const { controller } = setup({ submit: vi.fn(async () => success(targetResolution)) })
    await prepareManual(controller)
    await controller.submitManual()

    expect(controller.snapshot()).toMatchObject({
      state: 'success',
      successMessage: message,
      successFollowUp: '已记录本次提交，可稍后查看处理进度',
    })
  })

  it('acceptedExisting 不覆盖服务端 targetResolution 成功语义，并提示号码未更新', async () => {
    const { controller } = setup({ submit: vi.fn(async () => success('general', true)) })
    await prepareManual(controller)
    await controller.submitManual()

    expect(controller.snapshot().successMessage).toBe('已收到找房需求')
    expect(controller.snapshot().successMessage).not.toContain('13800138000')
    expect(controller.snapshot().successFollowUp).toBe(
      '本次未更新首次提交的联系方式',
    )
  })

  it('可恢复失败及授权/手填切换、号码变化保留 ID；关闭/取消/成功后重开生成新 ID', async () => {
    const ids = [SUBMISSION_A, SUBMISSION_B]
    const { controller, invalidateIntent } = setup({
      openIntent: vi.fn(async () => ids.shift() ?? null),
      submit: vi.fn(async () => ({ ok: false as const, code: 'network_error' as const })),
    })
    await prepareManual(controller)
    await controller.submitManual()
    controller.setPhone('13900139000')
    controller.selectPhoneAuthorization()
    controller.selectManual()
    expect(controller.snapshot().submissionRequestId).toBe(SUBMISSION_A)

    controller.close()
    expect(controller.snapshot()).toMatchObject({
      state: 'closed',
      context: null,
      submissionRequestId: null,
      moveInTime: '',
      phone: '',
      consentAccepted: false,
    })
    expect(invalidateIntent).toHaveBeenCalled()

    await controller.open(context)
    expect(controller.snapshot().submissionRequestId).toBe(SUBMISSION_B)
  })

  it('新 target 以 owner guard 阻止旧 open 回写', async () => {
    const oldIntent = deferred<string | null>()
    const newIntent = deferred<string | null>()
    let call = 0
    const { controller } = setup({
      openIntent: vi.fn(() => {
        call += 1
        return call === 1 ? oldIntent.promise : newIntent.promise
      }),
    })

    const older = controller.open(context)
    const newerContext = {
      ...context,
      target: { ...context.target, listingSlug: 'jing-an-tower-102' },
      title: '静安中心 102',
    }
    const newer = controller.open(newerContext)
    newIntent.resolve(SUBMISSION_B)
    await newer
    oldIntent.resolve(SUBMISSION_A)
    await older
    expect(controller.snapshot()).toMatchObject({
      state: 'choosing-phone',
      context: { target: { targetType: 'listing', listingSlug: 'jing-an-tower-102' } },
      submissionRequestId: SUBMISSION_B,
    })

  })

  it('preparing 可关闭并失效 intent，迟到打开结果不得重开弹层', async () => {
    const intent = deferred<string | null>()
    const { controller, invalidateIntent } = setup({
      openIntent: vi.fn(() => intent.promise),
    })
    const opening = controller.open(context)

    controller.close()
    expect(controller.snapshot().state).toBe('closed')
    expect(invalidateIntent).toHaveBeenCalledOnce()

    intent.resolve(SUBMISSION_A)
    await opening
    expect(controller.snapshot()).toMatchObject({ state: 'closed', submissionRequestId: null })
  })

  it('submitting 忙态 close 是 no-op，不失效 intent，迟到成功仍呈现', async () => {
    const submission = deferred<InquiryResult>()
    const { controller, invalidateIntent } = setup({
      submit: vi.fn(() => submission.promise),
    })
    await prepareManual(controller)
    const submitting = controller.submitManual()

    controller.close()
    expect(controller.snapshot().state).toBe('submitting')
    expect(invalidateIntent).not.toHaveBeenCalled()

    submission.resolve(success())
    await submitting
    expect(controller.snapshot().state).toBe('success')
    expect(invalidateIntent).toHaveBeenCalledOnce()
  })

  it('authorizing 忙态 onChange 内 close 也是 no-op，随后提交成功', async () => {
    const states: InquirySheetSnapshot['state'][] = []
    const invalidateIntent = vi.fn()
    let controller!: ReturnType<typeof createInquirySheetController>
    controller = createInquirySheetController({
      openIntent: async () => SUBMISSION_A,
      invalidateIntent,
      ensureAnonymousContext: async () => 'anonymous-token',
      openPrivacyContract: async () => undefined,
      submit: async () => success(),
      onChange(snapshot) {
        states.push(snapshot.state)
        if (snapshot.state === 'authorizing') controller.close()
      },
    })
    await controller.open(context)
    await controller.verifyPrivacy()
    controller.setConsent(true)

    await controller.submitPhoneCode('phone-code-once')

    expect(states).toContain('authorizing')
    expect(states).toContain('submitting')
    expect(controller.snapshot().state).toBe('success')
    expect(invalidateIntent).toHaveBeenCalledOnce()
  })

  it('page unload dispose 失效旧 owner，且不在销毁阶段再发布 setData', async () => {
    const intent = deferred<string | null>()
    const { controller, snapshots, invalidateIntent } = setup({
      openIntent: vi.fn(() => intent.promise),
    })
    const opening = controller.open(context)
    expect(snapshots).toHaveLength(1)

    controller.dispose()
    expect(invalidateIntent).toHaveBeenCalledOnce()
    expect(snapshots).toHaveLength(1)

    intent.resolve(SUBMISSION_A)
    await opening
    expect(snapshots).toHaveLength(1)
    expect(controller.snapshot().state).toBe('closed')
  })
})

describe('Task7 真实咨询服务接线', () => {
  it.each(['manual', 'phone'] as const)('%s 路径只发送一次精确 POST', async (path) => {
    const requests: RequestOptions<unknown>[] = []
    const service = createInquiryService({
      request: async (options) => {
        requests.push(options)
        return options.parse({
          accepted: true,
          acceptedExisting: false,
          targetResolution: 'listing',
        })
      },
      getAnonymousContextToken: () => 'anonymous-token',
    })
    const { controller } = setup({ submit: service.submit })
    await controller.open(context)
    await controller.verifyPrivacy()
    controller.setMoveInTime('2026 年 10 月')
    controller.setConsent(true)

    if (path === 'manual') {
      controller.selectManual()
      controller.setPhone('+86 138-0013-8000')
      await controller.submitManual()
    } else {
      await controller.submitPhoneCode('phone-code-once')
    }

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      path: '/api/mini/v1/inquiries',
      method: 'POST',
      anonymousContextToken: 'anonymous-token',
      data: {
        submissionRequestId: SUBMISSION_A,
        targetType: 'listing',
        listingSlug: context.target.listingSlug,
        buildingSlug: context.target.buildingSlug,
        moveInTime: '2026 年 10 月',
        ...(path === 'manual'
          ? { phone: '13800138000' }
          : { phoneCode: 'phone-code-once' }),
        consent: { accepted: true, policyVersion: context.policyVersion },
      },
    })
    expect(controller.snapshot().state).toBe('success')
  })

  it('微信手机号 POST 网络失败不自动重试，并要求新用户手势授权', async () => {
    const request = vi.fn(async () => { throw new Error('network disconnected') })
    const service = createInquiryService({
      request,
      getAnonymousContextToken: () => 'anonymous-token',
    })
    const { controller } = setup({ submit: service.submit })
    await controller.open(context)
    await controller.verifyPrivacy()
    controller.setConsent(true)

    await controller.submitPhoneCode('phone-code-once')

    expect(request).toHaveBeenCalledOnce()
    expect(controller.snapshot()).toMatchObject({
      state: 'recoverable-error',
      errorReason: 'network',
      requiresNewPhoneAuthorization: true,
      submissionRequestId: SUBMISSION_A,
    })
  })
})

type RootComponent = Simulate.RootComponent<
  WechatMiniprogram.Component.DataOption,
  WechatMiniprogram.Component.PropertyOption,
  WechatMiniprogram.Component.MethodOption
>
type AttachTarget = Parameters<RootComponent['attach']>[0]
interface TestDom {
  window: {
    document: { body: AttachTarget }
    Event: unknown
    CustomEvent: unknown
    close(): void
  }
}
interface JsdomModule { JSDOM: new (html?: string) => TestDom }
interface HostMethodContext {
  data: Record<string, unknown>
  setData(data: Record<string, unknown>): void
}
interface HostEvent { detail: Record<string, unknown> }

const projectRoot = resolve(import.meta.dirname, '..')
const componentRoot = resolve(projectRoot, 'miniprogram/components')
const sheetRoot = resolve(componentRoot, 'inquiry-sheet')
const generatedScript = resolve(sheetRoot, 'index.js')
const require = createRequire(import.meta.url)
const jsdom: JsdomModule = require('jsdom')
const originalGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>()
let simulate: typeof Simulate
let dom: TestDom
let sheetId: string

function replaceGlobal(key: PropertyKey, value: unknown): void {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

beforeAll(() => {
  dom = new jsdom.JSDOM('<!doctype html><html><body></body></html>')
  replaceGlobal('window', dom.window)
  replaceGlobal('document', dom.window.document)
  replaceGlobal('Event', dom.window.Event)
  replaceGlobal('CustomEvent', dom.window.CustomEvent)
  simulate = require('miniprogram-simulate')

  const source = readFileSync(resolve(sheetRoot, 'index.ts'), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  writeFileSync(generatedScript, output)
  sheetId = simulate.load(resolve(sheetRoot, 'index'), {
    compiler: 'simulate',
    rootPath: componentRoot,
  })
})

afterAll(() => {
  if (existsSync(generatedScript)) rmSync(generatedScript)
  dom?.window.close()
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

function renderSheet(snapshot: InquirySheetSnapshot): RootComponent {
  const hostId = simulate.load({
    template: [
      '<inquiry-sheet id="subject" snapshot="{{snapshot}}"',
      ' bindphoneauthorize="onPhone" bindphonerejected="onRejected"',
      ' bindmanualsubmit="onManual" bindclose="onClose" />',
    ].join(''),
    data: { snapshot, phoneCode: '', rejected: 0, manual: 0, closed: 0 },
    methods: {
      onPhone(this: HostMethodContext, event: HostEvent) {
        this.setData({ phoneCode: event.detail.phoneCode })
      },
      onRejected(this: HostMethodContext) {
        this.setData({ rejected: Number(this.data.rejected) + 1 })
      },
      onManual(this: HostMethodContext) {
        this.setData({ manual: Number(this.data.manual) + 1 })
      },
      onClose(this: HostMethodContext) {
        this.setData({ closed: Number(this.data.closed) + 1 })
      },
    },
    usingComponents: { 'inquiry-sheet': sheetId },
  })
  const host = simulate.render(hostId)
  host.attach(dom.window.document.body)
  return host
}

describe('inquiry-sheet 组件运行时与视觉合同', () => {
  it('初始同时呈现微信授权与手填入口，并展示可信详情摘要', async () => {
    const { controller } = setup()
    await controller.open(context)
    const host = renderSheet(controller.snapshot())
    const subject = host.querySelector('#subject')

    expect(subject?.dom?.textContent).toContain(context.title)
    expect(subject?.dom?.textContent).toContain(context.facts.area)
    expect(subject?.dom?.textContent).toContain(context.facts.unitPrice)
    expect(subject?.dom?.textContent).toContain(context.facts.monthlyEstimate)
    expect(subject?.querySelector('.inquiry-sheet__wechat')).toBeDefined()
    expect(subject?.querySelector('.inquiry-sheet__manual-entry')).toBeDefined()
    expect(readFileSync(resolve(sheetRoot, 'index.wxml'), 'utf8')).toContain(
      'open-type="getPhoneNumber"',
    )
    host.detach()
  })

  it('getPhoneNumber 用户事件只发 phoneCode；拒绝转独立事件且不缓存 code', async () => {
    const { controller } = setup()
    await controller.open(context)
    const host = renderSheet(controller.snapshot())
    const subject = host.querySelector('#subject')
    const authorization = subject?.querySelector('.inquiry-sheet__wechat')

    authorization?.dispatchEvent('getphonenumber', {
      detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code-once' },
    })
    await simulate.sleep(0)
    expect(host.data.phoneCode).toBe('phone-code-once')
    expect(subject?.data).not.toHaveProperty('phoneCode')

    for (const errMsg of [
      'getPhoneNumber:fail user deny',
      'getPhoneNumber:fail system error',
      'getPhoneNumber:fail account balance insufficient',
    ]) {
      authorization?.dispatchEvent('getphonenumber', { detail: { errMsg } })
      await simulate.sleep(0)
    }
    expect(host.data.rejected).toBe(3)
    host.detach()
  })

  it('提交中关闭按钮与 backdrop 都不发 close；成功后可关闭', async () => {
    const pending = deferred<InquiryResult>()
    const { controller } = setup({ submit: vi.fn(() => pending.promise) })
    await prepareManual(controller)
    const submitting = controller.submitManual()
    const host = renderSheet(controller.snapshot())
    const subject = host.querySelector('#subject')

    expect((subject?.data.snapshot as InquirySheetSnapshot).busy).toBe(true)
    expect((subject?.data.snapshot as InquirySheetSnapshot).submitDisabled).toBe(true)
    const markup = readFileSync(resolve(sheetRoot, 'index.wxml'), 'utf8')
    expect(markup).toContain('aria-busy="{{snapshot.busy}}"')
    expect(markup).toContain('disabled="{{snapshot.phoneSubmitDisabled}}"')
    expect(markup).toContain('disabled="{{snapshot.manualSubmitDisabled}}"')

    subject?.querySelector('.inquiry-sheet__close')?.dispatchEvent('tap')
    subject?.querySelector('.inquiry-sheet__backdrop')?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.closed).toBe(0)

    pending.resolve(success())
    await submitting
    host.setData({ snapshot: controller.snapshot() })
    await simulate.sleep(0)
    subject?.querySelector('.inquiry-sheet__backdrop')?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.closed).toBe(1)
    host.detach()
  })

  it('preparing 尚未发起不可取消请求，关闭按钮与 backdrop 都可请求关闭', async () => {
    const { controller } = setup()
    const snapshot = {
      ...controller.snapshot(),
      state: 'preparing' as const,
      context,
      busy: true,
    }
    const host = renderSheet(snapshot)
    const subject = host.querySelector('#subject')

    subject?.querySelector('.inquiry-sheet__close')?.dispatchEvent('tap')
    subject?.querySelector('.inquiry-sheet__backdrop')?.dispatchEvent('tap')
    await simulate.sleep(0)

    expect(host.data.closed).toBe(2)
    host.detach()
  })

  it('使用 token、半屏 fixed overlay、安全区、滚动锁定和 44px 触达，不含裸色值', () => {
    const markup = readFileSync(resolve(sheetRoot, 'index.wxml'), 'utf8')
    const styles = readFileSync(resolve(sheetRoot, 'index.wxss'), 'utf8')

    expect(markup).toContain('aria-role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain('catchtouchmove="handleTouchMove"')
    expect(markup).toContain('adjust-position="{{true}}"')
    expect(markup).toContain(
      'disabled="{{snapshot.state === \'authorizing\' || snapshot.state === \'submitting\'}}"',
    )
    expect(styles).toMatch(/\.inquiry-sheet\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;/)
    expect(styles).toMatch(/\.inquiry-sheet__panel\s*\{[\s\S]*bottom:\s*0;[\s\S]*max-height:\s*72vh;/)
    expect(styles).toContain('env(safe-area-inset-bottom)')
    expect(styles).toContain('var(--sbh-size-touch-target)')
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(styles).not.toMatch(/rgba?\s*\(/i)
  })
})
