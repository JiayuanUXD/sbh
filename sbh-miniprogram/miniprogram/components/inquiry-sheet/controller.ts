import {
  createPhoneCodeAttempt,
  type InquiryInput,
  type InquiryResult,
} from '../../services/inquiry.js'

export type InquirySheetState =
  | 'closed'
  | 'preparing'
  | 'choosing-phone'
  | 'manual'
  | 'authorizing'
  | 'submitting'
  | 'success'
  | 'recoverable-error'

export type InquirySheetErrorReason =
  | 'session-invalid'
  | 'rate-limited'
  | 'phone-code-consumed'
  | 'inquiry-submit-failed'
  | 'network'
  | 'service'

export type InquirySheetPrivacyStatus =
  | 'unchecked'
  | 'checking'
  | 'available'
  | 'unavailable'

export type InquirySheetContext = Readonly<{
  listingSlug: string
  buildingSlug?: string
  title: string
  area: string
  unitPrice: string
  monthlyEstimate: string
  policyVersion: string
}>

export type InquirySheetSnapshot = Readonly<{
  state: InquirySheetState
  context: InquirySheetContext | null
  submissionRequestId: string | null
  moveInTime: string
  phone: string
  consentAccepted: boolean
  privacyStatus: InquirySheetPrivacyStatus
  phoneMode: 'wechat' | 'manual'
  errorReason: InquirySheetErrorReason | null
  errorMessage: string
  requiresNewPhoneAuthorization: boolean
  successMessage: string
  successFollowUp: string
  busy: boolean
  submitDisabled: boolean
  phoneSubmitDisabled: boolean
  manualSubmitDisabled: boolean
}>

export type InquirySheetControllerDependencies = Readonly<{
  openIntent(target: string): Promise<string | null>
  invalidateIntent(): void
  ensureAnonymousContext(): Promise<string | null>
  openPrivacyContract(): Promise<void>
  submit(input: InquiryInput): Promise<InquiryResult>
  onChange?(snapshot: InquirySheetSnapshot): void
}>

export type InquirySheetController = Readonly<{
  open(context: InquirySheetContext): Promise<void>
  syncContext(context: InquirySheetContext): Promise<void>
  close(): void
  dispose(): void
  verifyPrivacy(): Promise<boolean>
  selectManual(): void
  selectPhoneAuthorization(): void
  rejectPhoneAuthorization(): void
  setMoveInTime(value: string): void
  setPhone(value: string): void
  setConsent(accepted: boolean): void
  submitManual(): Promise<boolean>
  submitPhoneCode(phoneCode: string): Promise<boolean>
  snapshot(): InquirySheetSnapshot
}>

type MutableSnapshot = Omit<
  InquirySheetSnapshot,
  'busy' | 'submitDisabled' | 'phoneSubmitDisabled' | 'manualSubmitDisabled'
>

const PHONE = /^1[3-9]\d{9}$/
const ERROR_MESSAGES: Readonly<Record<InquirySheetErrorReason, string>> = {
  'session-invalid': '匿名会话已失效，请重新授权或继续手动填写',
  'rate-limited': '提交较频繁，请稍后再试',
  'phone-code-consumed': '本次微信手机号授权已失效，请重新授权或手动填写',
  'inquiry-submit-failed': '咨询暂未提交成功，请保留当前内容后重试',
  network: '网络连接失败，请检查网络后重试',
  service: '咨询服务暂不可用，请稍后再试',
}

function normalizePhone(value: string): string {
  return value.replace(/[\s\-().]+/g, '').replace(/^(?:\+?86)+/, '')
}

function isBusy(state: InquirySheetState): boolean {
  return state === 'preparing'
    || state === 'authorizing'
    || state === 'submitting'
}

function blocksClose(state: InquirySheetState): boolean {
  return state === 'authorizing' || state === 'submitting'
}

function isActionable(state: InquirySheetState): boolean {
  return state === 'choosing-phone'
    || state === 'manual'
    || state === 'recoverable-error'
}

function project(snapshot: MutableSnapshot): InquirySheetSnapshot {
  const busy = isBusy(snapshot.state)
  const commonDisabled = busy
    || !isActionable(snapshot.state)
    || snapshot.submissionRequestId === null
    || snapshot.privacyStatus !== 'available'
    || !snapshot.consentAccepted
  const phoneSubmitDisabled = commonDisabled
  const manualSubmitDisabled = commonDisabled || !PHONE.test(normalizePhone(snapshot.phone))
  return Object.freeze({
    ...snapshot,
    busy,
    phoneSubmitDisabled,
    manualSubmitDisabled,
    submitDisabled: snapshot.phoneMode === 'manual'
      ? manualSubmitDisabled
      : phoneSubmitDisabled,
  })
}

function emptySnapshot(): MutableSnapshot {
  return {
    state: 'closed',
    context: null,
    submissionRequestId: null,
    moveInTime: '',
    phone: '',
    consentAccepted: false,
    privacyStatus: 'unchecked',
    phoneMode: 'wechat',
    errorReason: null,
    errorMessage: '',
    requiresNewPhoneAuthorization: false,
    successMessage: '',
    successFollowUp: '',
  }
}

function errorReason(result: Extract<InquiryResult, { ok: false }>): InquirySheetErrorReason {
  if (result.code === 'session_invalid') return 'session-invalid'
  if (result.code === 'rate_limited') return 'rate-limited'
  if (result.code === 'phone_code_consumed') return 'phone-code-consumed'
  if (result.code === 'inquiry_submit_failed') return 'inquiry-submit-failed'
  if (result.code === 'network_error' || result.code === 'request_timeout') return 'network'
  return 'service'
}

function successMessage(result: Extract<InquiryResult, { ok: true }>): string {
  if (result.acceptedExisting) {
    return '已按首次提交的联系方式受理；如需更换号码，请关闭后重新发起'
  }
  if (result.targetResolution === 'building') return '已转为该楼盘需求'
  if (result.targetResolution === 'general') return '已收到找房需求'
  return '已收到该房源咨询'
}

export function createInquirySheetController(
  dependencies: InquirySheetControllerDependencies,
): InquirySheetController {
  let version = 0
  let current = project(emptySnapshot())

  const publish = (patch: Partial<MutableSnapshot>): void => {
    current = project({ ...current, ...patch })
    dependencies.onChange?.(current)
  }

  const reset = (): void => {
    current = project(emptySnapshot())
    dependencies.onChange?.(current)
  }

  const open = async (context: InquirySheetContext): Promise<void> => {
    const previousTarget = current.context?.listingSlug ?? null
    version += 1
    const owner = version
    if (previousTarget !== null && previousTarget !== context.listingSlug) {
      dependencies.invalidateIntent()
    }
    publish({
      ...emptySnapshot(),
      state: 'preparing',
      context,
    })

    void Promise.resolve()
      .then(() => dependencies.ensureAnonymousContext())
      .catch(() => null)

    try {
      const submissionRequestId = await dependencies.openIntent(context.listingSlug)
      if (owner !== version || submissionRequestId === null) return
      publish({ state: 'choosing-phone', submissionRequestId })
    } catch {
      if (owner !== version) return
      publish({
        state: 'recoverable-error',
        errorReason: 'service',
        errorMessage: ERROR_MESSAGES.service,
      })
    }
  }

  const syncContext = async (context: InquirySheetContext): Promise<void> => {
    if (current.state === 'closed') return
    if (current.context?.listingSlug !== context.listingSlug) {
      await open(context)
      return
    }
    const policyChanged = current.context.policyVersion !== context.policyVersion
    publish({
      context,
      ...(policyChanged
        ? {
            consentAccepted: false,
            privacyStatus: 'unchecked' as const,
          }
        : {}),
    })
  }

  const close = (): void => {
    if (blocksClose(current.state)) return
    version += 1
    dependencies.invalidateIntent()
    reset()
  }

  const dispose = (): void => {
    version += 1
    dependencies.invalidateIntent()
    current = project(emptySnapshot())
  }

  const verifyPrivacy = async (): Promise<boolean> => {
    if (
      current.state === 'closed'
      || isBusy(current.state)
      || current.privacyStatus === 'checking'
    ) return false
    const owner = version
    publish({
      privacyStatus: 'checking',
      consentAccepted: false,
    })
    try {
      await dependencies.openPrivacyContract()
      if (owner !== version) return false
      publish({ privacyStatus: 'available', consentAccepted: false })
      return true
    } catch {
      if (owner !== version) return false
      publish({ privacyStatus: 'unavailable', consentAccepted: false })
      return false
    }
  }

  const selectManual = (): void => {
    if (current.state === 'closed' || isBusy(current.state) || current.state === 'success') return
    publish({
      state: 'manual',
      phoneMode: 'manual',
      errorReason: null,
      errorMessage: '',
      requiresNewPhoneAuthorization: false,
    })
  }

  const selectPhoneAuthorization = (): void => {
    if (current.state === 'closed' || isBusy(current.state) || current.state === 'success') return
    publish({
      state: 'choosing-phone',
      phoneMode: 'wechat',
      errorReason: null,
      errorMessage: '',
      requiresNewPhoneAuthorization: false,
    })
  }

  const rejectPhoneAuthorization = (): void => {
    selectManual()
  }

  const setMoveInTime = (value: string): void => {
    if (current.state === 'closed' || isBusy(current.state) || current.state === 'success') return
    publish({ moveInTime: typeof value === 'string' ? value.trim().slice(0, 100) : '' })
  }

  const setPhone = (value: string): void => {
    if (current.state === 'closed' || isBusy(current.state) || current.state === 'success') return
    publish({
      phone: typeof value === 'string' ? value : '',
      ...(current.state === 'recoverable-error'
        ? {
            state: 'manual' as const,
            phoneMode: 'manual' as const,
            errorReason: null,
            errorMessage: '',
            requiresNewPhoneAuthorization: false,
          }
        : {}),
    })
  }

  const setConsent = (accepted: boolean): void => {
    if (
      current.state === 'closed'
      || isBusy(current.state)
      || current.state === 'success'
      || current.privacyStatus !== 'available'
    ) return
    publish({ consentAccepted: accepted === true })
  }

  const performSubmit = async (
    path: 'manual' | 'phone',
    phoneCode?: string,
  ): Promise<boolean> => {
    if (
      current.context === null
      || current.submissionRequestId === null
      || current.privacyStatus !== 'available'
      || !current.consentAccepted
      || !isActionable(current.state)
    ) return false

    if (path === 'manual' && !PHONE.test(normalizePhone(current.phone))) return false
    if (path === 'phone' && (typeof phoneCode !== 'string' || phoneCode.length < 1 || phoneCode.length > 128)) {
      rejectPhoneAuthorization()
      return false
    }

    const owner = version
    const context = current.context
    const submissionRequestId = current.submissionRequestId
    const moveInTime = current.moveInTime
    if (path === 'phone') publish({ state: 'authorizing', phoneMode: 'wechat' })
    publish({ state: 'submitting' })

    const result = await dependencies.submit({
      submissionRequestId,
      listingSlug: context.listingSlug,
      ...(context.buildingSlug ? { buildingSlug: context.buildingSlug } : {}),
      ...(moveInTime ? { moveInTime } : {}),
      ...(path === 'phone'
        ? { phoneCode: createPhoneCodeAttempt(phoneCode as string) }
        : { phone: current.phone }),
      consent: { accepted: true, policyVersion: context.policyVersion },
    })
    if (owner !== version) return false

    if (result.ok) {
      dependencies.invalidateIntent()
      publish({
        state: 'success',
        successMessage: successMessage(result),
        successFollowUp: result.acceptedExisting
          ? '顾问将按首次提交的联系方式后续联系'
          : '顾问将通过您提交的联系方式后续联系',
        errorReason: null,
        errorMessage: '',
        requiresNewPhoneAuthorization: false,
      })
      return true
    }

    const reason = errorReason(result)
    publish({
      state: 'recoverable-error',
      phoneMode: reason === 'phone-code-consumed' ? 'manual' : current.phoneMode,
      errorReason: reason,
      errorMessage: ERROR_MESSAGES[reason],
      requiresNewPhoneAuthorization: path === 'phone'
        && result.requiresNewPhoneAuthorization === true,
    })
    return false
  }

  return {
    open,
    syncContext,
    close,
    dispose,
    verifyPrivacy,
    selectManual,
    selectPhoneAuthorization,
    rejectPhoneAuthorization,
    setMoveInTime,
    setPhone,
    setConsent,
    submitManual: () => performSubmit('manual'),
    submitPhoneCode: (phoneCode) => performSubmit('phone', phoneCode),
    snapshot: () => current,
  }
}
