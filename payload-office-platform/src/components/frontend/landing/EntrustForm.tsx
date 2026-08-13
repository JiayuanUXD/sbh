'use client'

import Link from 'next/link'
import React, { useEffect, useId, useState } from 'react'
import { Button, Field, Input } from '@/components/frontend/ui'
import { ENTRUST_COPY } from '@/lib/frontend/landing-config'
import { track } from '@/lib/frontend/analytics'
import {
  createLandingOnceTracker,
  dispatchLandingConverted,
  safeTrackCityEvent,
  safeTrackLandingEvent,
  type CityServiceStatus,
  type LandingAnalyticsTrack,
} from '@/lib/frontend/analytics/landing'
import { PRIVACY_POLICY_VERSION, siteConfig } from '@/lib/frontend/site-config'
import LeadCitySelect, { type LeadCityOption } from './LeadCitySelect'

export type EntrustInquiryBody = Readonly<{
  city: string
  phone: string
  requestId: string
  targetType: 'none'
  consent: Readonly<{
    accepted: true
    policyVersion: string
  }>
  source: Readonly<{
    pageType: 'entrust'
    path: '/entrust'
  }>
}>

export type EntrustSubmissionError = 'rate_limited' | 'failed' | 'network_error'

export type EntrustSubmissionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: EntrustSubmissionError }>

type EntrustRequester = (url: string, init?: RequestInit) => Promise<Response>

export type EntrustFormState = Readonly<{
  status: 'idle' | 'submitting' | 'success' | 'error'
  error: string | null
}>

export type EntrustSubmissionCoordinator = Readonly<{
  getState: () => EntrustFormState
  submit: (phone: string, city?: string, cityStatus?: CityServiceStatus) => Promise<EntrustFormState>
  /** 两步留电第二步：成功建 Lead 后补充可选需求；复用首步的 requestId 与已留电手机号。 */
  submitDemand: (demand: EntrustDemandInput) => Promise<EntrustDemandResult>
}>

const PHONE_ERROR = '请输入正确的 11 位手机号'

/** 与服务端一致：去除常见格式分隔符与中国区号后再校验。 */
export function normalizeEntrustPhone(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, '').replace(/^(?:\+?86)+/, '')
}

export function isValidEntrustPhone(raw: string): boolean {
  return /^1[3-9]\d{9}$/.test(normalizeEntrustPhone(raw))
}

export function buildEntrustInquiryBody(
  phone: string,
  requestId: string,
  city: string = siteConfig.defaultCity,
): EntrustInquiryBody {
  return {
    phone: normalizeEntrustPhone(phone),
    requestId,
    city,
    targetType: 'none',
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: { pageType: 'entrust', path: '/entrust' },
  }
}

function isSuccessfulInquiryResponse(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === true
}

export async function submitEntrustInquiry(
  body: EntrustInquiryBody,
  requester: EntrustRequester = fetch,
): Promise<EntrustSubmissionResult> {
  try {
    const response = await requester('/api/inquiries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data: unknown = await response.json().catch(() => null)
    if (response.ok && isSuccessfulInquiryResponse(data)) return { ok: true }
    return { ok: false, error: response.status === 429 ? 'rate_limited' : 'failed' }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export type EntrustDemandInput = Readonly<Partial<Record<'district' | 'area' | 'budget' | 'moveInTime', string>>>

export type EntrustDemandBody = Readonly<{
  requestId: string
  phone: string
  demand: EntrustDemandInput
}>

export type EntrustDemandError = 'rate_limited' | 'not_found' | 'failed' | 'network_error'

export type EntrustDemandResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: EntrustDemandError }>

/** 把表单原始输入收窄为仅非空字段，避免发送空字符串。 */
export function buildEntrustDemandBody(
  requestId: string,
  phone: string,
  input: EntrustDemandInput,
): EntrustDemandBody {
  const demand: Record<string, string> = {}
  for (const key of ['district', 'area', 'budget', 'moveInTime'] as const) {
    const value = (input[key] ?? '').trim()
    if (value) demand[key] = value
  }
  return { requestId, phone, demand }
}

export async function submitEntrustDemand(
  body: EntrustDemandBody,
  requester: EntrustRequester = fetch,
): Promise<EntrustDemandResult> {
  try {
    const response = await requester('/api/inquiries/demand', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data: unknown = await response.json().catch(() => null)
    if (response.ok && isSuccessfulInquiryResponse(data)) return { ok: true }
    const error: EntrustDemandError =
      response.status === 429 ? 'rate_limited' : response.status === 404 ? 'not_found' : 'failed'
    return { ok: false, error }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

export function getEntrustSubmissionError(error: EntrustSubmissionError): string {
  if (error === 'rate_limited') return '提交过于频繁，请稍后再试'
  if (error === 'network_error') return '网络异常，请稍后重试'
  return '提交失败，请稍后重试'
}

export function createEntrustSubmissionCoordinator(
  requestIdFactory: () => string,
  requester: EntrustRequester,
  onStateChange: (state: EntrustFormState) => void = () => undefined,
  analyticsTrack: LandingAnalyticsTrack = track,
): EntrustSubmissionCoordinator {
  const requestId = requestIdFactory()
  let state: EntrustFormState = { status: 'idle', error: null }
  let pendingSubmission: Promise<EntrustFormState> | null = null
  // 首步成功后才记录手机号，供第二步 demand 更新复用（同 requestId 幂等命中规则）。
  let submittedPhone: string | null = null
  let pendingDemand: Promise<EntrustDemandResult> | null = null

  const updateState = (nextState: EntrustFormState) => {
    state = nextState
    onStateChange(state)
  }

  const submit = (
    phone: string,
    city: string = siteConfig.defaultCity,
    cityStatus: CityServiceStatus = 'live',
  ): Promise<EntrustFormState> => {
    if (pendingSubmission) return pendingSubmission
    safeTrackLandingEvent(analyticsTrack, 'landing_form_submit', {
      page_type: 'entrust',
      field_completeness: phone.trim() ? 1 : 0,
    })
    if (!isValidEntrustPhone(phone)) {
      updateState({ status: 'error', error: PHONE_ERROR })
      safeTrackLandingEvent(analyticsTrack, 'landing_form_error', {
        page_type: 'entrust',
        error_code: 'validation_failed',
      })
      return Promise.resolve(state)
    }

    updateState({ status: 'submitting', error: null })
    pendingSubmission = submitEntrustInquiry(
      buildEntrustInquiryBody(phone, requestId, city),
      requester,
    )
      .then((result) => {
        if (result.ok) {
          submittedPhone = normalizeEntrustPhone(phone)
          updateState({ status: 'success', error: null })
          safeTrackLandingEvent(analyticsTrack, 'landing_form_success', {
            page_type: 'entrust',
          })
          safeTrackCityEvent(analyticsTrack, 'city_lead_submitted', {
            city,
            status: cityStatus,
            form_type: 'entrust',
          })
        }
        else {
          updateState({ status: 'error', error: getEntrustSubmissionError(result.error) })
          safeTrackLandingEvent(analyticsTrack, 'landing_form_error', {
            page_type: 'entrust',
            error_code:
              result.error === 'rate_limited'
                ? 'rate_limited'
                : result.error === 'network_error'
                  ? 'network_error'
                  : 'submit_failed',
          })
        }
        return state
      })
      .finally(() => {
        pendingSubmission = null
      })
    return pendingSubmission
  }

  const submitDemand = (demand: EntrustDemandInput): Promise<EntrustDemandResult> => {
    if (pendingDemand) return pendingDemand
    if (!submittedPhone) {
      return Promise.resolve({ ok: false, error: 'not_found' })
    }
    pendingDemand = submitEntrustDemand(
      buildEntrustDemandBody(requestId, submittedPhone, demand),
      requester,
    ).finally(() => {
      pendingDemand = null
    })
    return pendingDemand
  }

  return { getState: () => state, submit, submitDemand }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `entrust-${crypto.randomUUID()}`
  }
  return `entrust-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/** /entrust 首屏仅采集手机号；一次挂载内重试沿用同一幂等 requestId。 */
export default function EntrustForm({
  citySlug = siteConfig.defaultCity,
  cities = [{ slug: siteConfig.defaultCity, name: siteConfig.defaultCity, serviceStatus: 'live' }],
  cityError,
}: Readonly<{
  citySlug?: string
  cities?: readonly LeadCityOption[]
  cityError?: string
}>) {
  const inputId = 'entrust-phone'
  const noteId = useId()
  const [phone, setPhone] = useState('')
  const [selectedCity, setSelectedCity] = useState(citySlug)
  const [activeCityError, setActiveCityError] = useState(cityError)
  const [formState, setFormState] = useState<EntrustFormState>({ status: 'idle', error: null })
  const [coordinator] = useState(() => createEntrustSubmissionCoordinator(
    newRequestId,
    fetch,
    setFormState,
    track,
  ))
  const [trackFormStart] = useState(() =>
    createLandingOnceTracker('landing_form_start', 'entrust', track),
  )

  // 成功态广播：吸底/收束 CTA 切换「已收到」并停止吸底。
  useEffect(() => {
    if (formState.status === 'success') dispatchLandingConverted('entrust')
  }, [formState.status])

  if (formState.status === 'success') {
    return (
      <div className="entrust-form__success" role="status" aria-live="polite">
        <h2>{ENTRUST_COPY.successTitle}</h2>
        <p>{ENTRUST_COPY.successBody}</p>
        <EntrustDemandForm coordinator={coordinator} />
      </div>
    )
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selectedOption = cities.find((city) => city.slug === selectedCity)
    if (!selectedOption) return
    await coordinator.submit(phone, selectedOption.slug, selectedOption.serviceStatus)
  }

  return (
    <form className="entrust-form" onSubmit={onSubmit} noValidate>
      <LeadCitySelect
        pageType="entrust"
        cities={cities}
        selectedCity={selectedCity}
        error={activeCityError}
        onChange={(nextCity) => {
          setSelectedCity(nextCity)
          setActiveCityError(undefined)
        }}
      />
      <Field label="手机号" id={inputId} error={formState.error} required className="entrust-form__field">
        <Input
          type="tel"
          name="phone"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={11}
          placeholder={ENTRUST_COPY.formPlaceholder}
          value={phone}
          onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
          onFocus={trackFormStart}
          aria-describedby={noteId}
        />
      </Field>
      <Button
        type="submit"
        variant="primary"
        loading={formState.status === 'submitting'}
        disabled={Boolean(activeCityError) || !selectedCity}
      >
        {ENTRUST_COPY.formSubmit}
      </Button>
      <p className="entrust-form__note" id={noteId}>
        提交即表示同意
        <Link href="/pages/privacy" target="_blank" rel="noopener noreferrer">《隐私政策》</Link>
        ，并授权我们与您联系
      </p>
    </form>
  )
}

type DemandFieldKey = 'district' | 'area' | 'budget' | 'moveInTime'
const DEMAND_FIELD_KEYS: readonly DemandFieldKey[] = ['district', 'area', 'budget', 'moveInTime']

type DemandFormStatus = 'idle' | 'submitting' | 'done' | 'error'

function EntrustDemandForm({
  coordinator,
}: {
  coordinator: Pick<EntrustSubmissionCoordinator, 'submitDemand'>
}) {
  const [values, setValues] = useState<Record<DemandFieldKey, string>>({
    district: '',
    area: '',
    budget: '',
    moveInTime: '',
  })
  const [status, setStatus] = useState<DemandFormStatus>('idle')

  if (status === 'done') return null

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('submitting')
    const result = await coordinator.submitDemand(values)
    setStatus(result.ok ? 'done' : 'error')
  }

  return (
    <form className="entrust-demand" onSubmit={onSubmit} noValidate aria-label={ENTRUST_COPY.demandTitle}>
      <div className="entrust-demand__head">
        <h2 className="entrust-demand__title">{ENTRUST_COPY.demandTitle}</h2>
        <p className="entrust-demand__hint">{ENTRUST_COPY.demandHint}</p>
      </div>
      <div className="entrust-demand__fields">
        {DEMAND_FIELD_KEYS.map((key) => {
          const field = ENTRUST_COPY.demandFields[key]
          const id = `entrust-demand-${key}`
          return (
            <Field key={key} label={field.label} id={id} className="entrust-demand__field">
              <Input
                type="text"
                name={key}
                inputMode="text"
                autoComplete="off"
                maxLength={100}
                placeholder={field.placeholder}
                value={values[key]}
                onChange={(event) => setValues((prev) => ({ ...prev, [key]: event.target.value }))}
              />
            </Field>
          )
        })}
      </div>
      {status === 'error' ? (
        <p className="entrust-demand__error" role="alert">{ENTRUST_COPY.demandError}</p>
      ) : null}
      <div className="entrust-demand__actions">
        <Button type="submit" variant="primary" size="sm" loading={status === 'submitting'}>
          {ENTRUST_COPY.demandSubmit}
        </Button>
        <button
          type="button"
          className="entrust-demand__skip"
          onClick={() => setStatus('done')}
        >
          {ENTRUST_COPY.demandSkip}
        </button>
      </div>
    </form>
  )
}
