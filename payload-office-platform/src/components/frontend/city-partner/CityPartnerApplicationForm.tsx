'use client'

import Link from 'next/link'
import React, { useRef, useState } from 'react'

import { Button, Field, Input, Select, Textarea } from '@/components/frontend/ui'
import {
  CITY_PARTNER_IDENTITIES,
  CITY_PARTNER_RESOURCE_TYPES,
  type CityPartnerIdentity,
  type CityPartnerResourceType,
} from '@/domain/city-partner-application/schema'
import { normalizePhone, isValidCnMobile } from '@/domain/shared/phone'
import { track } from '@/lib/frontend/analytics'
import {
  safeTrackCityPartnerEvent,
  type CityPartnerAnalyticsTrack,
} from '@/lib/frontend/analytics/landing'
import {
  CITY_PARTNER_COPY,
  CITY_PARTNER_IDENTITY_OPTIONS,
  CITY_PARTNER_RESOURCE_OPTIONS,
} from '@/lib/frontend/city-partner-config'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import type { PublicCityOption } from '@/app/(frontend)/_lib/city-context'

export type CityPartnerStageOneValues = Readonly<{
  city: string
  applicantName: string
  contactPhone: string
  applicantIdentity: CityPartnerIdentity | ''
  otherIdentity: string
  consentAccepted: boolean
}>

export type CityPartnerStageTwoValues = Readonly<{
  organizationName?: string
  resourceTypes?: readonly CityPartnerResourceType[]
  otherResource?: string
  experienceSummary?: string
  cooperationPlan?: string
}>

type StageOneErrors = Partial<Record<keyof CityPartnerStageOneValues, string>>
type StageTwoErrors = Partial<Record<keyof CityPartnerStageTwoValues, string>>
type Requester = (url: string, init?: RequestInit) => Promise<Response>

type StageOneBody = Readonly<{
  requestId: string
  city: string
  applicantName: string
  contactPhone: string
  applicantIdentity: CityPartnerIdentity
  otherIdentity?: string
  consent: Readonly<{ accepted: true; policyVersion: string }>
  source: Readonly<{ path: '/city-partner' }>
}>

type StageTwoBody = Readonly<{
  requestId: string
  contactPhone: string
  organizationName?: string
  resourceTypes?: readonly CityPartnerResourceType[]
  otherResource?: string
  experienceSummary?: string
  cooperationPlan?: string
}>

export type CityPartnerFormState = Readonly<{
  status: 'idle' | 'submitting' | 'stage-two' | 'completing' | 'complete' | 'error'
  errorCode?: 'validation_failed' | 'network_error' | 'rate_limited' | 'submit_failed'
}>

export type CityPartnerApplicationCoordinator = Readonly<{
  getState: () => CityPartnerFormState
  hasSavedStageOne: () => boolean
  start: (citySlug: string) => void
  submitStageOne: (
    values: CityPartnerStageOneValues,
    cities: readonly PublicCityOption[],
  ) => Promise<CityPartnerFormState>
  submitStageTwo: (values: CityPartnerStageTwoValues) => Promise<CityPartnerFormState>
  skipStageTwo: () => CityPartnerFormState
}>

const ERROR_MESSAGES = {
  network_error: '网络异常，请稍后重试。您填写的内容仍保留在本页。',
  rate_limited: '提交过于频繁，请稍后再试。您填写的内容仍保留在本页。',
  submit_failed: '暂时无法提交，请稍后重试。您填写的内容仍保留在本页。',
  validation_failed: '请检查标注的字段后再提交。',
} as const

function trimmedOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function isSuccessfulResponse(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === true
}

async function postJson(
  url: string,
  body: StageOneBody | StageTwoBody,
  requester: Requester,
): Promise<'ok' | 'network_error' | 'rate_limited' | 'submit_failed'> {
  try {
    const response = await requester(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data: unknown = await response.json().catch(() => null)
    if (response.ok && isSuccessfulResponse(data)) return 'ok'
    return response.status === 429 ? 'rate_limited' : 'submit_failed'
  } catch {
    return 'network_error'
  }
}

export function getStageOneErrors(
  values: CityPartnerStageOneValues,
  cities: readonly PublicCityOption[],
): StageOneErrors {
  const errors: StageOneErrors = {}
  if (!cities.some((city) => city.slug === values.city)) errors.city = '请选择当前可申请的城市'
  const name = values.applicantName.trim()
  if (!name || name.length > 50) errors.applicantName = '请输入 1–50 个字符的姓名'
  if (!isValidCnMobile(normalizePhone(values.contactPhone))) {
    errors.contactPhone = '请输入正确的 11 位手机号'
  }
  if (!(CITY_PARTNER_IDENTITIES as readonly string[]).includes(values.applicantIdentity)) {
    errors.applicantIdentity = '请选择您的合作身份'
  }
  if (values.applicantIdentity === 'other' && !trimmedOptional(values.otherIdentity)) {
    errors.otherIdentity = '请补充您的合作身份'
  }
  if (values.applicantIdentity === 'other' && values.otherIdentity.trim().length > 100) {
    errors.otherIdentity = '其他身份最多 100 个字符'
  }
  if (!values.consentAccepted) errors.consentAccepted = '请阅读并同意隐私政策'
  return errors
}

export function getStageTwoErrors(values: CityPartnerStageTwoValues): StageTwoErrors {
  const errors: StageTwoErrors = {}
  const resourceTypes = values.resourceTypes ?? []
  if (resourceTypes.includes('other') && !trimmedOptional(values.otherResource)) {
    errors.otherResource = '请补充其他资源类型'
  }
  if ((values.organizationName?.trim().length ?? 0) > 100) errors.organizationName = '机构名称最多 100 个字符'
  if (resourceTypes.includes('other') && (values.otherResource?.trim().length ?? 0) > 200) {
    errors.otherResource = '其他资源最多 200 个字符'
  }
  if ((values.experienceSummary?.trim().length ?? 0) > 2_000) errors.experienceSummary = '经验说明最多 2000 个字符'
  if ((values.cooperationPlan?.trim().length ?? 0) > 2_000) errors.cooperationPlan = '合作设想最多 2000 个字符'
  return errors
}

export function buildStageOneBody(
  values: CityPartnerStageOneValues,
  requestId: string,
): StageOneBody {
  const otherIdentity = values.applicantIdentity === 'other'
    ? trimmedOptional(values.otherIdentity)
    : undefined
  return {
    requestId,
    city: values.city,
    applicantName: values.applicantName.trim(),
    contactPhone: normalizePhone(values.contactPhone),
    applicantIdentity: values.applicantIdentity as CityPartnerIdentity,
    ...(otherIdentity ? { otherIdentity } : {}),
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: { path: '/city-partner' },
  }
}

export function buildStageTwoBody(
  values: CityPartnerStageTwoValues,
  requestId: string,
  contactPhone: string,
): StageTwoBody {
  const organizationName = trimmedOptional(values.organizationName)
  const resourceTypes = values.resourceTypes?.length ? [...values.resourceTypes] : undefined
  const otherResource = resourceTypes?.includes('other')
    ? trimmedOptional(values.otherResource)
    : undefined
  const experienceSummary = trimmedOptional(values.experienceSummary)
  const cooperationPlan = trimmedOptional(values.cooperationPlan)
  return {
    requestId,
    contactPhone,
    ...(organizationName ? { organizationName } : {}),
    ...(resourceTypes ? { resourceTypes } : {}),
    ...(otherResource ? { otherResource } : {}),
    ...(experienceSummary ? { experienceSummary } : {}),
    ...(cooperationPlan ? { cooperationPlan } : {}),
  }
}

export function resolveCityPartnerSelection(
  cities: readonly PublicCityOption[],
  explicitCity: string | undefined,
  defaultCity: string,
): Readonly<{ selectedCity: string; invalidExplicitCity: boolean }> {
  if (explicitCity !== undefined) {
    const valid = cities.some((city) => city.slug === explicitCity)
    return { selectedCity: valid ? explicitCity : '', invalidExplicitCity: !valid }
  }
  const fallback = cities.find((city) => city.slug === defaultCity) ?? cities[0]
  return { selectedCity: fallback?.slug ?? '', invalidExplicitCity: false }
}

export function createCityPartnerApplicationCoordinator(
  requestIdFactory: () => string,
  requester: Requester,
  onStateChange: (state: CityPartnerFormState) => void = () => undefined,
  analyticsTrack: CityPartnerAnalyticsTrack = track,
): CityPartnerApplicationCoordinator {
  const requestId = requestIdFactory()
  let state: CityPartnerFormState = { status: 'idle' }
  let submitted: Readonly<{ citySlug: string; contactPhone: string }> | null = null
  let pendingStageOne: Promise<CityPartnerFormState> | null = null
  let pendingStageTwo: Promise<CityPartnerFormState> | null = null
  let started = false

  const update = (next: CityPartnerFormState) => {
    state = next
    onStateChange(next)
    return next
  }

  const start = (citySlug: string) => {
    if (started) return
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(citySlug)) return
    started = true
    safeTrackCityPartnerEvent(analyticsTrack, 'city_partner_application_started', {
      city_slug: citySlug,
      stage: 'stage-one',
    })
  }

  const submitStageOne = (
    values: CityPartnerStageOneValues,
    cities: readonly PublicCityOption[],
  ): Promise<CityPartnerFormState> => {
    if (pendingStageOne) return pendingStageOne
    const errors = getStageOneErrors(values, cities)
    if (Object.keys(errors).length > 0) return Promise.resolve(update({ status: 'error', errorCode: 'validation_failed' }))
    update({ status: 'submitting' })
    pendingStageOne = postJson(
      '/api/city-partner-applications',
      buildStageOneBody(values, requestId),
      requester,
    ).then((result) => {
      if (result !== 'ok') return update({ status: 'error', errorCode: result })
      submitted = { citySlug: values.city, contactPhone: normalizePhone(values.contactPhone) }
      safeTrackCityPartnerEvent(analyticsTrack, 'city_partner_application_submitted', {
        city_slug: values.city,
        stage: 'stage-one',
      })
      return update({ status: 'stage-two' })
    }).finally(() => { pendingStageOne = null })
    return pendingStageOne
  }

  const submitStageTwo = (values: CityPartnerStageTwoValues): Promise<CityPartnerFormState> => {
    if (pendingStageTwo) return pendingStageTwo
    if (!submitted || Object.keys(getStageTwoErrors(values)).length > 0) {
      return Promise.resolve(update({ status: 'error', errorCode: 'validation_failed' }))
    }
    update({ status: 'completing' })
    pendingStageTwo = postJson(
      '/api/city-partner-applications/details',
      buildStageTwoBody(values, requestId, submitted.contactPhone),
      requester,
    ).then((result) => {
      if (result !== 'ok') return update({ status: 'error', errorCode: result })
      safeTrackCityPartnerEvent(analyticsTrack, 'city_partner_application_completed', {
        city_slug: submitted!.citySlug,
        stage: 'stage-two',
      })
      return update({ status: 'complete' })
    }).finally(() => { pendingStageTwo = null })
    return pendingStageTwo
  }

  const skipStageTwo = () => {
    if (pendingStageTwo || state.status === 'completing') return state
    return update({ status: 'complete' })
  }
  return {
    getState: () => state,
    hasSavedStageOne: () => submitted !== null,
    start,
    submitStageOne,
    submitStageTwo,
    skipStageTwo,
  }
}

/**
 * 生成第二阶段的写入凭据。
 *
 * requestId 不只是幂等键：第二阶段按 `request_id AND contact_phone` 定位申请
 * （见 domain/city-partner-application/public-service.ts），所以它实际承担
 * 能力凭据（capability token）的作用。知道对方手机号的人若能猜中 requestId，
 * 就能补写/覆盖他人申请的补充信息，因此必须使用密码学随机源。
 *
 * 降级顺序：
 *   1. crypto.randomUUID —— 需要安全上下文（https / localhost）
 *   2. crypto.getRandomValues —— 128 bit，不要求安全上下文，覆盖 http:// 场景
 *   3. 抛错 —— fail-closed，宁可让表单报错也不发放弱凭据
 *
 * 第 3 条在任何带 WebCrypto 的浏览器上都不可达（getRandomValues 自 IE11 起可用），
 * 保留它是为了杜绝「静默降级成可猜测 ID」这条路径。
 */
export function newRequestId(): string {
  const webCrypto = typeof crypto !== 'undefined' ? crypto : undefined
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return `city-partner-${webCrypto.randomUUID()}`
  }
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    webCrypto.getRandomValues(bytes)
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `city-partner-${hex}`
  }
  throw new Error('city_partner_secure_request_id_unavailable')
}

export default function CityPartnerApplicationForm({
  cities,
  initialCity,
  invalidExplicitCity,
  cityUnavailableMessage,
}: Readonly<{
  cities: readonly PublicCityOption[]
  initialCity: string
  invalidExplicitCity: boolean
  cityUnavailableMessage?: string
}>) {
  const [stageOne, setStageOne] = useState<CityPartnerStageOneValues>({
    city: initialCity,
    applicantName: '',
    contactPhone: '',
    applicantIdentity: '',
    otherIdentity: '',
    consentAccepted: false,
  })
  const [stageTwo, setStageTwo] = useState<CityPartnerStageTwoValues>({ resourceTypes: [] })
  const [state, setState] = useState<CityPartnerFormState>({ status: 'idle' })
  const [stageOneErrors, setStageOneErrors] = useState<StageOneErrors>(
    invalidExplicitCity
      ? { city: '链接中的城市无效，请重新选择城市' }
      : cityUnavailableMessage
        ? { city: cityUnavailableMessage }
        : {},
  )
  const [stageTwoErrors, setStageTwoErrors] = useState<StageTwoErrors>({})
  const [cityBlocked, setCityBlocked] = useState(
    invalidExplicitCity || Boolean(cityUnavailableMessage),
  )
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const [coordinator] = useState(() =>
    createCityPartnerApplicationCoordinator(newRequestId, fetch, setState),
  )

  const focusFirst = (errors: Record<string, string | undefined>) => {
    const key = Object.keys(errors).find((candidate) => Boolean(errors[candidate]))
    refs.current[key ?? '']?.focus()
  }

  const submitStageOne = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const errors = getStageOneErrors(stageOne, cities)
    setStageOneErrors(errors)
    if (Object.keys(errors).length > 0) {
      focusFirst(errors)
      return
    }
    coordinator.start(stageOne.city)
    await coordinator.submitStageOne(stageOne, cities)
  }

  const submitStageTwo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const errors = getStageTwoErrors(stageTwo)
    setStageTwoErrors(errors)
    if (Object.keys(errors).length > 0) {
      focusFirst(errors)
      return
    }
    await coordinator.submitStageTwo(stageTwo)
  }

  const isCityTarget = (target: EventTarget | null) => (
    target instanceof HTMLSelectElement && target.name === 'city'
  )
  const startFromCurrentCity = (event: React.SyntheticEvent<HTMLFormElement>) => {
    if (isCityTarget(event.target)) return
    coordinator.start(stageOne.city)
  }

  if (state.status === 'complete') {
    return <div className="city-partner-form__success" role="status" aria-live="polite"><h2>申请已收到</h2><p>我们会根据城市服务规划与双方资源情况进行沟通。</p></div>
  }

  if (state.status === 'stage-two' || state.status === 'completing' || (state.status === 'error' && coordinator.hasSavedStageOne())) {
    return (
      <form className="city-partner-form" onSubmit={submitStageTwo} noValidate>
        <header><span className="city-partner-form__step">第二步 · 可选</span><h2>{CITY_PARTNER_COPY.stageTwoTitle}</h2><p>{CITY_PARTNER_COPY.stageTwoHint}</p></header>
        <Field label="机构名称" id="partner-organization" error={stageTwoErrors.organizationName}>
          <Input ref={(node) => { refs.current.organizationName = node }} value={stageTwo.organizationName ?? ''} maxLength={100} onChange={(event) => setStageTwo((prev) => ({ ...prev, organizationName: event.target.value }))} />
        </Field>
        <fieldset className="city-partner-form__fieldset"><legend>可提供的资源（可多选）</legend><div className="city-partner-form__checks">
          {CITY_PARTNER_RESOURCE_OPTIONS.map((option) => <label key={option.value}><input type="checkbox" value={option.value} checked={stageTwo.resourceTypes?.includes(option.value) ?? false} onChange={(event) => setStageTwo((prev) => ({ ...prev, resourceTypes: event.target.checked ? [...(prev.resourceTypes ?? []), option.value] : (prev.resourceTypes ?? []).filter((value) => value !== option.value) }))} /> <span>{option.label}</span></label>)}
        </div></fieldset>
        {stageTwo.resourceTypes?.includes('other') ? <Field label="其他资源" id="partner-other-resource" error={stageTwoErrors.otherResource} required><Input ref={(node) => { refs.current.otherResource = node }} value={stageTwo.otherResource ?? ''} maxLength={200} onChange={(event) => setStageTwo((prev) => ({ ...prev, otherResource: event.target.value }))} /></Field> : null}
        <Field label="相关经验" id="partner-experience"><Textarea rows={4} maxLength={2000} value={stageTwo.experienceSummary ?? ''} onChange={(event) => setStageTwo((prev) => ({ ...prev, experienceSummary: event.target.value }))} /></Field>
        <Field label="合作设想" id="partner-plan"><Textarea rows={4} maxLength={2000} value={stageTwo.cooperationPlan ?? ''} onChange={(event) => setStageTwo((prev) => ({ ...prev, cooperationPlan: event.target.value }))} /></Field>
        {state.errorCode && state.errorCode !== 'validation_failed' ? <p role="alert">{ERROR_MESSAGES[state.errorCode]}</p> : null}
        <p className="city-partner-form__status" role="status" aria-live="polite">
          {state.status === 'completing' ? '正在提交补充信息…' : ''}
        </p>
        <div className="city-partner-form__actions"><Button type="submit" loading={state.status === 'completing'} aria-label={state.status === 'completing' ? '正在提交补充信息' : undefined}>提交补充信息</Button><button type="button" className="city-partner-form__skip" disabled={state.status === 'completing'} onClick={() => coordinator.skipStageTwo()}>暂不补充，完成申请</button></div>
      </form>
    )
  }

  return (
    <form
      className="city-partner-form"
      onSubmit={submitStageOne}
      onFocusCapture={startFromCurrentCity}
      onChangeCapture={startFromCurrentCity}
      noValidate
    >
      <header><span className="city-partner-form__step">第一步 · 必填</span><h2>{CITY_PARTNER_COPY.stageOneTitle}</h2><p>{CITY_PARTNER_COPY.stageOneHint}</p></header>
      <Field label="申请城市" id="partner-city" error={stageOneErrors.city} required>
        <Select ref={(node) => { refs.current.city = node }} name="city" value={stageOne.city} onChange={(event) => { coordinator.start(event.target.value); setStageOne((prev) => ({ ...prev, city: event.target.value })); setStageOneErrors((prev) => ({ ...prev, city: undefined })); setCityBlocked(false) }}>
          <option value="">请选择城市</option>{cities.map((city) => <option key={city.slug} value={city.slug}>{city.name}{city.serviceStatus === 'coming-soon' ? '（筹备中）' : ''}</option>)}
        </Select>
      </Field>
      <Field label="姓名" id="partner-name" error={stageOneErrors.applicantName} required><Input ref={(node) => { refs.current.applicantName = node }} name="applicantName" autoComplete="name" maxLength={50} value={stageOne.applicantName} onChange={(event) => setStageOne((prev) => ({ ...prev, applicantName: event.target.value }))} /></Field>
      <Field label="手机号" id="partner-phone" error={stageOneErrors.contactPhone} required><Input ref={(node) => { refs.current.contactPhone = node }} type="tel" name="contactPhone" autoComplete="tel" inputMode="numeric" maxLength={20} value={stageOne.contactPhone} onChange={(event) => setStageOne((prev) => ({ ...prev, contactPhone: event.target.value }))} /></Field>
      <Field label="合作身份" id="partner-identity" error={stageOneErrors.applicantIdentity} required><Select ref={(node) => { refs.current.applicantIdentity = node }} name="applicantIdentity" value={stageOne.applicantIdentity} onChange={(event) => setStageOne((prev) => ({ ...prev, applicantIdentity: event.target.value as CityPartnerIdentity | '' }))}><option value="">请选择</option>{CITY_PARTNER_IDENTITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
      {stageOne.applicantIdentity === 'other' ? <Field label="其他身份" id="partner-other-identity" error={stageOneErrors.otherIdentity} required><Input ref={(node) => { refs.current.otherIdentity = node }} maxLength={100} value={stageOne.otherIdentity} onChange={(event) => setStageOne((prev) => ({ ...prev, otherIdentity: event.target.value }))} /></Field> : null}
      <label className="city-partner-form__consent"><input id="partner-consent" ref={(node) => { refs.current.consentAccepted = node }} type="checkbox" checked={stageOne.consentAccepted} aria-invalid={stageOneErrors.consentAccepted ? true : undefined} aria-describedby={stageOneErrors.consentAccepted ? 'partner-consent-error' : undefined} onChange={(event) => { setStageOne((prev) => ({ ...prev, consentAccepted: event.target.checked })); setStageOneErrors((prev) => ({ ...prev, consentAccepted: undefined })) }} /><span>我已阅读并同意 <Link href="/pages/privacy" target="_blank">隐私政策</Link>，并授权工作人员联系我。</span></label>
      {stageOneErrors.consentAccepted ? <p id="partner-consent-error" className="field__error" role="alert">{stageOneErrors.consentAccepted}</p> : null}
      {state.errorCode && state.errorCode !== 'validation_failed' ? <p role="alert">{ERROR_MESSAGES[state.errorCode]}</p> : null}
      <Button type="submit" block loading={state.status === 'submitting'} disabled={cityBlocked}>保存并继续</Button>
      <p className="city-partner-form__status" role="status" aria-live="polite">{state.status === 'submitting' ? '正在安全保存申请…' : ''}</p>
    </form>
  )
}
