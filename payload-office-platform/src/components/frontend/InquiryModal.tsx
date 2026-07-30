'use client'

import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { SourceSection } from '@/domain/inquiry/schema'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import { track } from '@/lib/frontend/analytics'

/**
 * F5.2 可访问咨询 Modal（多入口）
 *
 * 设计依据：specs/frontend-mvp/design.md §10、§12.1、§14.2
 *           Page PRD: FP-05 §2–§4、§8
 *           tasks/F5-inquiry.md 5.2
 *
 * 守护不变量：
 *   - 多入口：pageType ∈ home/search/listing/building/content；
 *   - 携带目标对象（listingSlug / buildingSlug）或通用需求（none）；
 *   - 表单字段：name(必填) / phone(必填) / company(选填) / message(选填) / demand(选填)；
 *   - 隐私同意：必须主动勾选，记录 policyVersion；
 *   - 焦点锁定、Esc 关闭、焦点归还、滚动恢复；
 *   - 软键盘适配：使用 dvh + viewport 高度回退；
 *   - 提交时构造完整 InquiryRequest（含 requestId / source / consent / campaign）；
 *   - 重复提交进入不可重复点击状态；
 *   - 房源失效 → 提示转为通用需求（保留已填内容）；
 *   - 限流 → 提示稍后重试（不清空已填内容）；
 *   - 分析事件：inquiry_open / inquiry_submit / inquiry_success / inquiry_error，
 *     仅记录枚举与上下文，不记录姓名/手机号/留言正文。
 */
type PageType = 'home' | 'search' | 'listing' | 'building' | 'content'
type TargetType = 'listing' | 'building' | 'none'

type Props = {
  /** 入口页面类型（FP-05 §2） */
  pageType: PageType
  /** 目标房源 slug（pageType=listing 时必填） */
  targetListingSlug?: string
  /** 目标楼盘 slug（pageType=building 时必填） */
  targetBuildingSlug?: string
  /** 目标摘要（房源标题 / 楼盘名 / 内容页标题）；用于弹层副标题 */
  targetSummary?: string
  /** 触发按钮文案 */
  triggerLabel?: string
  /** 触发按钮 variant */
  triggerVariant?: 'primary' | 'ghost' | 'ink'
  /** 触发按钮附加 className */
  triggerClassName?: string
  /** 可分析的产品入口区块（与询盘 schema 的枚举保持一致） */
  sourceSection?: SourceSection
}

export type InquiryStep = 'contact' | 'requirements' | 'success'
type SubmitStatus = 'idle' | 'submitting' | 'error'
export type TargetResolution = 'listing' | 'building' | 'general'
export type InquiryFocusTarget = 'none' | 'contact-name' | 'requirements-heading' | 'success-heading' | 'error'

/** UTM 参数白名单（与 domain/inquiry/campaign.ts CAMPAIGN_KEYS 对齐） */
const CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

/** 客户端字段长度限制（与 domain/inquiry/schema.ts LIMITS 对齐） */
const LIMITS = {
  NAME_MAX: 50,
  COMPANY_MAX: 100,
  MESSAGE_MAX: 1000,
  TEAM_SIZE_MAX: 50,
} as const

/** 错误码 → 中文提示（不暴露内部信息） */
const ERROR_MESSAGES: Record<string, string> = {
  invalid_body: '请求数据格式错误',
  invalid_json: '请求数据格式错误',
  invalid_content_type: '请求数据格式错误',
  body_too_large: '请求数据过大',
  name_required: '请填写姓名',
  name_too_long: `姓名不能超过 ${LIMITS.NAME_MAX} 字`,
  phone_invalid: '请填写有效的中国大陆手机号',
  team_size_required: '请填写团队规模',
  team_size_too_long: `团队规模不能超过 ${LIMITS.TEAM_SIZE_MAX} 字`,
  company_too_long: `公司名不能超过 ${LIMITS.COMPANY_MAX} 字`,
  message_too_long: `留言不能超过 ${LIMITS.MESSAGE_MAX} 字`,
  consent_required: '请勾选隐私政策同意',
  consent_version_invalid: '隐私政策版本不匹配，请刷新页面后重试',
  source_required: '入口信息缺失',
  source_page_type_invalid: '入口类型无效',
  source_path_required: '入口路径缺失',
  source_path_too_long: '入口路径过长',
  request_id_required: '请求标识缺失',
  request_id_too_long: '请求标识过长',
  campaign_invalid: '活动参数无效',
  listing_not_found: '该房源状态已变化，可提交通用选址需求',
  rate_limited: '提交过于频繁，请稍后重试',
  server_error: '系统暂时不可用，请稍后重试',
  forbidden: '请求不被允许',
}

const DEFAULT_TRIGGER_LABEL = '在线询价 / 留电'

const resolutionCopy: Record<TargetResolution, string> = {
  listing: '已记录这套房源，顾问将与您确认看房。',
  building: '该房源状态已变化，已为您登记同楼盘需求。',
  general: '目标状态已变化，已为您登记通用选址需求。',
}

export function buildInquiryMessage(teamSize: string, message: string): string {
  const teamSizePrefix = `团队规模：${teamSize.trim()}`
  const userMessage = message.trim()
  return userMessage.startsWith(teamSizePrefix)
    ? userMessage
    : [teamSizePrefix, userMessage].filter(Boolean).join('\n')
}

export function validateInquiryContact(input: Readonly<{
  name: string
  phone: string
  teamSize: string
  consentAccepted: boolean
}>): string[] {
  const errors: string[] = []
  if (!input.name.trim()) errors.push('name_required')
  else if (input.name.trim().length > LIMITS.NAME_MAX) errors.push('name_too_long')
  const phoneTrimmed = input.phone.replace(/[\s\-()]/g, '')
  if (!/^1[3-9]\d{9}$/.test(phoneTrimmed)) errors.push('phone_invalid')
  if (!input.teamSize.trim()) errors.push('team_size_required')
  else if (input.teamSize.trim().length > LIMITS.TEAM_SIZE_MAX) errors.push('team_size_too_long')
  if (!input.consentAccepted) errors.push('consent_required')
  return errors
}

export function validateInquiryRequirements(input: Readonly<{
  name: string
  phone: string
  teamSize: string
  consentAccepted: boolean
  company: string
  message: string
}>): string[] {
  const errors = validateInquiryContact(input)
  if (input.company.length > LIMITS.COMPANY_MAX) errors.push('company_too_long')
  if (buildInquiryMessage(input.teamSize, input.message).length > LIMITS.MESSAGE_MAX) {
    errors.push('message_too_long')
  }
  return errors
}

export function reduceInquiryStep(
  step: InquiryStep,
  action: Readonly<{ type: 'continue'; errors: readonly string[] } | { type: 'back' } | { type: 'submitted' }>,
): InquiryStep {
  if (action.type === 'continue') return step === 'contact' && action.errors.length === 0 ? 'requirements' : step
  if (action.type === 'back') return step === 'requirements' ? 'contact' : step
  return step === 'requirements' ? 'success' : step
}

export function resolveTargetResolution(value: unknown): TargetResolution {
  return value === 'listing' || value === 'building' || value === 'general' ? value : 'general'
}

export function getInquiryFocusTarget(
  previousStep: InquiryStep | null,
  nextStep: InquiryStep,
  hasError: boolean,
): InquiryFocusTarget {
  if (hasError) return 'error'
  if (previousStep === 'contact' && nextStep === 'requirements') return 'requirements-heading'
  if (previousStep === 'requirements' && nextStep === 'contact') return 'contact-name'
  if (previousStep === 'requirements' && nextStep === 'success') return 'success-heading'
  return 'none'
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 回退：时间戳 + 随机数（不依赖 Web Crypto）
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** 从当前 URL 提取白名单化的 UTM 参数（不包含个人信息） */
function extractCampaign(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const result: Record<string, string> = {}
  for (const key of CAMPAIGN_KEYS) {
    const v = sp.get(key)
    if (v) {
      // 客户端预截断，服务端会再次校验
      result[key] = v.slice(0, 100)
    }
  }
  return result
}

function getTargetType(props: Props): TargetType {
  if (props.targetListingSlug) return 'listing'
  if (props.targetBuildingSlug) return 'building'
  return 'none'
}

function getTargetSummary(props: Props): string | undefined {
  if (props.targetSummary) return props.targetSummary
  return undefined
}

export default function InquiryModal(props: Props) {
  const {
    pageType,
    targetListingSlug,
    targetBuildingSlug,
    sourceSection,
    triggerLabel = DEFAULT_TRIGGER_LABEL,
    triggerVariant = 'primary',
    triggerClassName,
  } = props

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<InquiryStep>('contact')
  const [status, setStatus] = useState<SubmitStatus>('idle')
  const [errors, setErrors] = useState<string[]>([])
  const [serverError, setServerError] = useState<string | null>(null)
  const [listingFallback, setListingFallback] = useState<boolean>(false)

  // 表单字段
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [company, setCompany] = useState('')
  const [message, setMessage] = useState('')
  const [demandDistrict, setDemandDistrict] = useState('')
  const [demandBudget, setDemandBudget] = useState('')
  const [demandArea, setDemandArea] = useState('')
  const [demandMoveInTime, setDemandMoveInTime] = useState('')
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [targetResolution, setTargetResolution] = useState<TargetResolution>('general')

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const contactNameRef = useRef<HTMLInputElement | null>(null)
  const requirementsHeadingRef = useRef<HTMLParagraphElement | null>(null)
  const successHeadingRef = useRef<HTMLHeadingElement | null>(null)
  const feedbackRef = useRef<HTMLDivElement | null>(null)
  const previousStepRef = useRef<InquiryStep | null>(null)
  const titleId = useId()
  const consentId = useId()

  // 入口路径（白名单化，仅 pathname，不含 query）
  const sourcePath = useMemo(() => {
    if (typeof window === 'undefined') return '/'
    return window.location.pathname || '/'
  }, [open]) // 打开时刷新一次

  // 目标类型在打开时确定；listing 失效后切换为 none（fallback）
  const targetType = useMemo(
    () => (listingFallback ? 'none' : getTargetType(props)),
    [listingFallback, props],
  )

  const targetSummary = getTargetSummary(props)

  function openModal() {
    setErrors([])
    setServerError(null)
    setListingFallback(false)
    setStatus('idle')
    setStep('contact')
    setTargetResolution('general')
    setOpen(true)
    track('inquiry_open', {
      page_type: pageType,
      target_type: getTargetType(props),
      has_target: getTargetType(props) !== 'none',
    })
  }

  function closeModal() {
    setOpen(false)
    // 焦点归还触发器
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  // Esc 关闭 + 焦点锁定 + 滚动锁 + 滚动恢复
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeModal()
        return
      }
      if (e.key === 'Tab') {
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    const prevOverflow = document.body.style.overflow
    const prevScrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => titleRef.current?.focus())

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      window.scrollTo(0, prevScrollY)
    }
  }, [open])

  // Step/error focus moves after React commits the new form; no timeout race.
  useEffect(() => {
    const previousStep = previousStepRef.current
    previousStepRef.current = step
    if (!open) return
    const focusTarget = getInquiryFocusTarget(previousStep, step, errors.length > 0 || serverError !== null)
    if (focusTarget === 'requirements-heading') requirementsHeadingRef.current?.focus()
    if (focusTarget === 'contact-name') contactNameRef.current?.focus()
    if (focusTarget === 'success-heading') successHeadingRef.current?.focus()
    if (focusTarget === 'error') feedbackRef.current?.focus()
  }, [errors, open, serverError, step])

  function messageForRequest(): string {
    return buildInquiryMessage(teamSize, message)
  }

  // 第一步与 API 的必填字段对齐；团队规模存入已有的 message 白名单字段，避免发送未定义字段。
  function validateContact(): string[] {
    return validateInquiryContact({ name, phone, teamSize, consentAccepted })
  }

  function validateRequirements(): string[] {
    return validateInquiryRequirements({ name, phone, teamSize, consentAccepted, company, message })
  }

  function advanceToRequirements(e: React.FormEvent) {
    e.preventDefault()
    const clientErrors = validateContact()
    setErrors(clientErrors)
    setServerError(null)
    setStep(reduceInquiryStep(step, { type: 'continue', errors: clientErrors }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'submitting') return

    const clientErrors = validateRequirements()
    setErrors(clientErrors)
    if (clientErrors.length > 0) {
      return
    }

    setStatus('submitting')
    setServerError(null)

    const requestId = generateRequestId()
    const campaign = extractCampaign()
    const phoneNormalized = phone.replace(/[\s\-()]/g, '').replace(/^(?:\+?86)+/, '')

    // 构造 InquiryRequest（与 domain/inquiry/schema.ts 对齐）
    const requestBody = {
      requestId,
      name: name.trim(),
      phone: phoneNormalized,
      company: company.trim() || undefined,
      message: messageForRequest(),
      listingSlug: targetListingSlug || undefined,
      buildingSlug: targetBuildingSlug || undefined,
      demand: {
        district: demandDistrict.trim() || undefined,
        budget: demandBudget.trim() || undefined,
        area: demandArea.trim() || undefined,
        moveInTime: demandMoveInTime.trim() || undefined,
      },
      consent: {
        accepted: true,
        policyVersion: PRIVACY_POLICY_VERSION,
      },
      source: {
        pageType,
        path: sourcePath,
        section: sourceSection ?? null,
        campaign,
      },
    }

    // 分析事件：提交（仅记录字段完整度枚举，不含值）
    const fieldCompleteness = deriveFieldCompleteness({
      company: !!company.trim(),
      message: !!message.trim(),
      demand: !!(
        demandDistrict.trim() ||
        demandBudget.trim() ||
        demandArea.trim() ||
        demandMoveInTime.trim()
      ),
    })
    track('inquiry_submit', {
      page_type: pageType,
      target_type: targetType,
      field_completeness: fieldCompleteness,
    })

    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const data = (await res.json().catch(() => ({}))) as {
        errors?: string[]
        error?: string
        targetResolution?: TargetResolution
      }

      if (res.ok) {
        setTargetResolution(resolveTargetResolution(data.targetResolution))
        setStatus('idle')
        setStep(reduceInquiryStep(step, { type: 'submitted' }))
        track('inquiry_success', {
          page_type: pageType,
          target_type: targetType,
          idempotent: false,
        })
        return
      }

      // 房源失效：提示用户转为通用需求（保留已填内容）
      if (data.error === 'listing_not_found') {
        setListingFallback(true)
        setServerError(ERROR_MESSAGES.listing_not_found)
        setStatus('error')
        track('inquiry_error', {
          page_type: pageType,
          error_code: 'listing_not_found',
        })
        return
      }

      // 限流：不清空已填内容
      if (data.error === 'rate_limited') {
        setServerError(ERROR_MESSAGES.rate_limited)
        setStatus('error')
        track('inquiry_error', {
          page_type: pageType,
          error_code: 'rate_limited',
        })
        return
      }

      // 字段错误
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setErrors(data.errors)
        setServerError(null)
        setStatus('error')
        track('inquiry_error', {
          page_type: pageType,
          error_code: data.errors[0],
        })
        return
      }

      // 其他服务端错误
      const errorCode = data.error ?? 'server_error'
      setServerError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.server_error)
      setStatus('error')
      track('inquiry_error', {
        page_type: pageType,
        error_code: errorCode,
      })
    } catch {
      // 网络失败：保留内容，允许重试
      setServerError('网络异常，请检查后重试')
      setStatus('error')
      track('inquiry_error', {
        page_type: pageType,
        error_code: 'network_error',
      })
    }
  }

  function resetForm() {
    setName('')
    setPhone('')
    setTeamSize('')
    setCompany('')
    setMessage('')
    setDemandDistrict('')
    setDemandBudget('')
    setDemandArea('')
    setDemandMoveInTime('')
    setConsentAccepted(false)
    setErrors([])
    setServerError(null)
    setListingFallback(false)
    setStatus('idle')
    setStep('contact')
    setTargetResolution('general')
  }

  function handleSuccessClose() {
    resetForm()
    closeModal()
  }

  const triggerClass = [
    'btn',
    `btn--${triggerVariant}`,
    triggerClassName ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const modalTitle = '询价 / 预约看房'
  const subtitle = listingFallback
    ? '已切换为通用选址需求'
    : targetSummary ?? '请填写以下信息，顾问将在 1 个工作日内联系你'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        onClick={openModal}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={titleId}
        data-event-name="inquiry_open_trigger"
        data-page-type={pageType}
        data-source-section={sourceSection ?? undefined}
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          className="modal__overlay"
          onClick={closeModal}
        >
          <div
            ref={dialogRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="modal__close"
              aria-label="关闭询价弹层"
              onClick={closeModal}
            >
              <span aria-hidden="true">×</span>
            </button>

            <h3 id={titleId} ref={titleRef} tabIndex={-1} className="modal__title">
              {modalTitle}
            </h3>
            <p className="modal__subtitle">{subtitle}</p>

            {step === 'success' ? (
              <div className="modal__success" role="status" aria-live="polite">
                <h4 ref={successHeadingRef} tabIndex={-1}>已收到你的需求</h4>
                <p className="modal__success-detail">
                  {resolutionCopy[targetResolution]}
                </p>
                <div className="modal__footer">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={handleSuccessClose}
                  >
                    继续浏览
                  </button>
                </div>
              </div>
            ) : step === 'contact' ? (
              <form
                ref={formRef}
                className="modal__form"
                onSubmit={advanceToRequirements}
                noValidate
              >
                <p className="modal__step" aria-current="step">第一步：联系方式</p>
                <label className="modal__label" htmlFor={`f-name-${titleId}`}>
                  称呼
                  <span className="modal__required" aria-hidden="true">*</span>
                  <input
                    ref={contactNameRef}
                    id={`f-name-${titleId}`}
                    className="modal__input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={LIMITS.NAME_MAX}
                    autoComplete="name"
                    aria-required="true"
                    aria-invalid={errors.includes('name_required') || errors.includes('name_too_long')}
                  />
                </label>

                <label className="modal__label" htmlFor={`f-phone-${titleId}`}>
                  手机号
                  <span className="modal__required" aria-hidden="true">*</span>
                  <input
                    id={`f-phone-${titleId}`}
                    className="modal__input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="11 位中国大陆手机号"
                    maxLength={15}
                    aria-required="true"
                    aria-invalid={errors.includes('phone_invalid')}
                  />
                </label>

                <label className="modal__label" htmlFor={`f-team-size-${titleId}`}>
                  团队规模
                  <span className="modal__required" aria-hidden="true">*</span>
                  <input
                    id={`f-team-size-${titleId}`}
                    className="modal__input"
                    value={teamSize}
                    onChange={(e) => setTeamSize(e.target.value)}
                    required
                    maxLength={LIMITS.TEAM_SIZE_MAX}
                    placeholder="如：10-20 人"
                    aria-required="true"
                    aria-invalid={errors.includes('team_size_required') || errors.includes('team_size_too_long')}
                  />
                </label>

                <label className="modal__consent" htmlFor={consentId}>
                  <input
                    id={consentId}
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    required
                    aria-required="true"
                    aria-invalid={errors.includes('consent_required')}
                  />
                  <span>
                    我已阅读并同意
                    <a
                      href="/pages/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      data-event-name="inquiry_privacy_link_click"
                    >
                      《隐私政策》
                    </a>
                  </span>
                </label>

                {(errors.length > 0 || serverError) && (
                  <div ref={feedbackRef} tabIndex={-1}>
                    {errors.length > 0 && (
                      <ul className="modal__error-list" role="alert" aria-live="polite">
                        {errors.map((code) => <li key={code}>{ERROR_MESSAGES[code] ?? code}</li>)}
                      </ul>
                    )}
                    {serverError && <p className="modal__error" role="alert" aria-live="polite">{serverError}</p>}
                  </div>
                )}

                <button type="submit" className="btn btn--primary btn--block">
                  下一步
                </button>

                <p className="modal__hint">
                  我们仅在必要时使用你的联系方式与你沟通房源信息。
                </p>
              </form>
            ) : (
              <form ref={formRef} className="modal__form" onSubmit={submit} noValidate>
                <p ref={requirementsHeadingRef} className="modal__step" aria-current="step" tabIndex={-1}>
                  第二步：需求补充（选填）
                </p>
                <label className="modal__label" htmlFor={`f-company-${titleId}`}>
                  公司名称（选填）
                  <input
                    id={`f-company-${titleId}`}
                    className="modal__input"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    maxLength={LIMITS.COMPANY_MAX}
                    autoComplete="organization"
                  />
                </label>

                <details className="modal__advanced" open>
                  <summary className="modal__advanced-summary">需求详情（选填）</summary>
                  <div className="modal__advanced-body">
                    <label className="modal__label" htmlFor={`f-district-${titleId}`}>
                      意向区域
                      <input id={`f-district-${titleId}`} className="modal__input" value={demandDistrict} onChange={(e) => setDemandDistrict(e.target.value)} maxLength={50} placeholder="如：静安、浦东" />
                    </label>
                    <label className="modal__label" htmlFor={`f-budget-${titleId}`}>
                      预算
                      <input id={`f-budget-${titleId}`} className="modal__input" value={demandBudget} onChange={(e) => setDemandBudget(e.target.value)} maxLength={50} placeholder="如：1-2 万元/月" />
                    </label>
                    <label className="modal__label" htmlFor={`f-area-${titleId}`}>
                      需求面积
                      <input id={`f-area-${titleId}`} className="modal__input" value={demandArea} onChange={(e) => setDemandArea(e.target.value)} maxLength={50} placeholder="如：100-200 ㎡" />
                    </label>
                    <label className="modal__label" htmlFor={`f-movein-${titleId}`}>
                      计划入驻时间
                      <input id={`f-movein-${titleId}`} className="modal__input" value={demandMoveInTime} onChange={(e) => setDemandMoveInTime(e.target.value)} maxLength={50} placeholder="如：2026 年 9 月" />
                    </label>
                  </div>
                </details>

                <label className="modal__label" htmlFor={`f-message-${titleId}`}>
                  留言（选填）
                  <textarea id={`f-message-${titleId}`} className="modal__input modal__textarea" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={LIMITS.MESSAGE_MAX} placeholder="如：希望有落地窗、可立即入驻" />
                </label>

                {(errors.length > 0 || serverError) && (
                  <div ref={feedbackRef} tabIndex={-1}>
                    {errors.length > 0 && (
                      <ul className="modal__error-list" role="alert" aria-live="polite">
                        {errors.map((code) => <li key={code}>{ERROR_MESSAGES[code] ?? code}</li>)}
                      </ul>
                    )}
                    {serverError && <p className="modal__error" role="alert" aria-live="polite">{serverError}</p>}
                  </div>
                )}

                <div className="modal__footer">
                  <button type="button" className="btn btn--ghost" onClick={() => setStep(reduceInquiryStep(step, { type: 'back' }))} disabled={status === 'submitting'}>
                    上一步
                  </button>
                  <button type="submit" className="btn btn--primary" disabled={status === 'submitting'} data-event-name="inquiry_submit_click" data-page-type={pageType}>
                    {status === 'submitting' ? '提交中…' : '提交'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** 派生字段完整度枚举（与 privacy-log.ts FIELD_COMPLETENESS 对齐） */
function deriveFieldCompleteness(opts: {
  company: boolean
  message: boolean
  demand: boolean
}): string {
  const { company, message, demand } = opts
  if (company && message && demand) return 'full'
  if (demand) return 'with_demand'
  if (company && message) return 'with_company_and_message'
  if (message) return 'with_message'
  if (company) return 'with_company'
  return 'required_only'
}
