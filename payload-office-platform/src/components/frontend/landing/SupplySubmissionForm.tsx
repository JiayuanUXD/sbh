'use client'

import Link from 'next/link'
import React, { useEffect, useId, useRef, useState } from 'react'
import ProcessSteps from '@/components/frontend/landing/ProcessSteps'
import { Button, Field, Input, Select } from '@/components/frontend/ui'
import type { InquiryPriceUnit } from '@/domain/inquiry/schema'
import { isValidCnMobile, normalizePhone } from '@/domain/shared/phone'
import {
  COMMISSION_MONTHS,
  COMMISSION_MONTHS_LABELS,
  type CommissionMonths,
} from '@/domain/supply-submission/schema'
import { PUBLISH_COPY, PUBLISH_STEPS } from '@/lib/frontend/landing-config'
import { track } from '@/lib/frontend/analytics'
import {
  createLandingOnceTracker,
  safeTrackCityEvent,
  safeTrackLandingEvent,
  type CityServiceStatus,
  type LandingAnalyticsTrack,
} from '@/lib/frontend/analytics/landing'
import { PRIVACY_POLICY_VERSION, siteConfig } from '@/lib/frontend/site-config'
import LeadCitySelect, { type LeadCityOption } from './LeadCitySelect'
import {
  createBrowserSupplyPendingRequestStore,
  createSupplyIntentFingerprint,
  getSupplyIntentIdentity,
  type SupplyPendingRequestStore,
} from '@/lib/frontend/supply-submission-request'

const RENT_UNIT_OPTIONS = [
  { value: 'rmb-sqm-day', label: '元/㎡/天' },
  { value: 'rmb-month', label: '元/月' },
  { value: 'rmb-seat-month', label: '元/工位/月' },
  { value: 'rmb-total', label: '元/总价' },
] as const satisfies readonly Readonly<{ value: InquiryPriceUnit; label: string }>[]

export type SupplyFormValues = Readonly<{
  buildingName: string
  address: string
  areaSqm: string
  rentAmount: string
  rentUnit: InquiryPriceUnit
  commissionMonths: CommissionMonths
  contactPhone: string
}>

export type SupplyFieldErrors = Partial<
  Record<'buildingName' | 'address' | 'areaSqm' | 'rentAmount' | 'contactPhone', string>
>

export type SupplySubmissionBody = Readonly<{
  city: string
  requestId: string
  buildingName: string
  address: string
  areaSqm: number
  rentAmount?: number
  rentUnit?: InquiryPriceUnit
  commissionMonths: CommissionMonths
  contactPhone: string
  consent: Readonly<{ accepted: true; policyVersion: string }>
  source: Readonly<{ path: '/publish' }>
}>

type SupplyRequester = (url: string, init?: RequestInit) => Promise<Response>

type SupplySubmissionError = 'validation_error' | 'rate_limited' | 'failed' | 'network_error'

export type SupplySubmissionResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: SupplySubmissionError; errors?: readonly string[] }>

export type SupplyFormErrorReason =
  | 'client_validation'
  | 'server_validation'
  | 'rate_limited'
  | 'network_error'
  | 'server_error'

export type SupplyFormState = Readonly<{
  status: 'idle' | 'submitting' | 'success' | 'error'
  fieldErrors: SupplyFieldErrors
  formError: string | null
  errorReason: SupplyFormErrorReason | null
}>

export type SupplySubmissionCoordinator = Readonly<{
  getState: () => SupplyFormState
  submit: (
    values: SupplyFormValues,
    city?: string,
    cityStatus?: CityServiceStatus,
  ) => Promise<SupplyFormState>
}>

type SupplySubmissionCoordinatorOptions = Readonly<{
  pendingRequestStore?: SupplyPendingRequestStore
  intentKeyFactory?: (values: SupplyFormValues) => Promise<string | null>
}>

const ERROR_CODE_MAP: Readonly<
  Record<string, Readonly<{ field: keyof SupplyFieldErrors; message: string }>>
> = {
  building_name_required: { field: 'buildingName', message: '请输入楼盘名称' },
  building_name_too_long: { field: 'buildingName', message: '楼盘名称过长' },
  address_required: { field: 'address', message: '请输入详细地址' },
  address_too_long: { field: 'address', message: '详细地址过长' },
  area_required: { field: 'areaSqm', message: '请输入出租面积' },
  area_invalid: { field: 'areaSqm', message: '出租面积需为正数' },
  rent_amount_invalid: { field: 'rentAmount', message: '租金数值不合法' },
  phone_invalid: { field: 'contactPhone', message: '请输入正确的 11 位手机号' },
}

const INITIAL_VALUES: SupplyFormValues = {
  buildingName: '',
  address: '',
  areaSqm: '',
  rentAmount: '',
  rentUnit: 'rmb-sqm-day',
  commissionMonths: 'none',
  contactPhone: '',
}

const INITIAL_STATE: SupplyFormState = {
  status: 'idle',
  fieldErrors: {},
  formError: null,
  errorReason: null,
}

export function getSupplyFieldErrors(values: SupplyFormValues): SupplyFieldErrors {
  const errors: SupplyFieldErrors = {}
  if (!values.buildingName.trim()) errors.buildingName = '请输入楼盘名称'
  if (!values.address.trim()) errors.address = '请输入详细地址'

  const area = Number(values.areaSqm)
  if (!values.areaSqm.trim()) errors.areaSqm = '请输入出租面积'
  else if (!Number.isFinite(area) || area <= 0) errors.areaSqm = '出租面积需为正数'

  if (values.rentAmount.trim()) {
    const rent = Number(values.rentAmount)
    if (!Number.isFinite(rent) || rent < 0) errors.rentAmount = '租金数值不合法'
  }

  if (!isValidCnMobile(values.contactPhone.trim())) {
    errors.contactPhone = '请输入正确的 11 位手机号'
  }
  return errors
}

export function buildSupplySubmissionBody(
  values: SupplyFormValues,
  requestId: string,
  city: string = siteConfig.defaultCity,
): SupplySubmissionBody {
  const hasRentAmount = values.rentAmount.trim().length > 0
  return {
    requestId,
    city,
    buildingName: values.buildingName.trim(),
    address: values.address.trim(),
    areaSqm: Number(values.areaSqm),
    ...(hasRentAmount
      ? { rentAmount: Number(values.rentAmount), rentUnit: values.rentUnit }
      : {}),
    commissionMonths: values.commissionMonths,
    contactPhone: normalizePhone(values.contactPhone.trim()),
    consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
    source: { path: '/publish' },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSuccessfulResponse(value: unknown): boolean {
  return isRecord(value) && value.ok === true
}

function readErrorCodes(value: unknown): readonly string[] | null {
  if (!isRecord(value) || !Array.isArray(value.errors)) return null
  return value.errors.every((error) => typeof error === 'string') ? value.errors : null
}

export async function submitSupplySubmission(
  body: SupplySubmissionBody,
  requester: SupplyRequester = fetch,
): Promise<SupplySubmissionResult> {
  try {
    const response = await requester('/api/supply-submissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data: unknown = await response.json().catch(() => null)
    if (response.ok && isSuccessfulResponse(data)) return { ok: true }
    if (response.status === 422) {
      const errors = readErrorCodes(data)
      if (errors) return { ok: false, error: 'validation_error', errors }
    }
    if (response.status === 429) return { ok: false, error: 'rate_limited' }
    return { ok: false, error: 'failed' }
  } catch {
    return { ok: false, error: 'network_error' }
  }
}

function mapSupplyValidationErrors(codes: readonly string[]): SupplyFieldErrors {
  const errors: SupplyFieldErrors = {}
  for (const code of codes) {
    const mapped = ERROR_CODE_MAP[code]
    if (mapped) errors[mapped.field] = mapped.message
  }
  return errors
}

function getSubmissionFormError(result: Exclude<SupplySubmissionResult, { ok: true }>): string {
  if (result.error === 'rate_limited') return '刚才提交得有点频繁，请稍后再试。'
  if (result.error === 'network_error') return '网络好像不太稳定，已填写的内容还在，请检查网络后再试。'
  if (result.error === 'validation_error') return '提交内容有误，请检查后重试'
  return '暂时没有提交成功，已填写的内容还在，请稍后再试。'
}

const SUBMIT_LABELS: Record<SupplyFormState['status'], string> = {
  idle: PUBLISH_COPY.submit,
  submitting: '提交中...',
  success: PUBLISH_COPY.submit,
  error: '重新提交',
}

const FIELD_ERROR_ORDER = [
  'buildingName',
  'address',
  'areaSqm',
  'rentAmount',
  'contactPhone',
] as const satisfies readonly (keyof SupplyFieldErrors)[]

export function getSupplySubmitLabel(state: SupplyFormState): string {
  if (state.status === 'error' && state.errorReason === 'rate_limited') return '稍后重试'
  return SUBMIT_LABELS[state.status]
}

export function getSupplyStatusMessage(state: SupplyFormState): string | null {
  if (state.status === 'submitting') return '正在提交，我们会为您保留已填写的信息。'
  return state.formError
}

export function getFirstSupplyErrorField(
  errors: SupplyFieldErrors,
): keyof SupplyFieldErrors | null {
  for (const field of FIELD_ERROR_ORDER) {
    if (errors[field]) return field
  }
  return null
}

function getSupplyErrorReason(
  result: Exclude<SupplySubmissionResult, { ok: true }>,
  fieldErrors: SupplyFieldErrors,
): SupplyFormErrorReason {
  if (result.error === 'rate_limited') return 'rate_limited'
  if (result.error === 'network_error') return 'network_error'
  if (result.error === 'validation_error' && Object.keys(fieldErrors).length > 0) {
    return 'server_validation'
  }
  return 'server_error'
}

export function createSupplySubmissionCoordinator(
  requestIdFactory: () => string,
  requester: SupplyRequester,
  onStateChange: (state: SupplyFormState) => void = () => undefined,
  analyticsTrack: LandingAnalyticsTrack = track,
  options: SupplySubmissionCoordinatorOptions = {},
): SupplySubmissionCoordinator {
  let state = INITIAL_STATE
  let pendingSubmission: Promise<SupplyFormState> | null = null
  let activeIntentIdentity: string | null = null
  let activeRequestId: string | null = null
  const pendingRequestStore = options.pendingRequestStore
  const intentKeyFactory = options.intentKeyFactory ?? createSupplyIntentFingerprint

  const updateState = (nextState: SupplyFormState) => {
    state = nextState
    onStateChange(state)
  }

  const submit = (
    values: SupplyFormValues,
    city: string = siteConfig.defaultCity,
    cityStatus: CityServiceStatus = 'live',
  ): Promise<SupplyFormState> => {
    if (pendingSubmission) return pendingSubmission

    const filledCount = [
      values.buildingName.trim(),
      values.address.trim(),
      values.areaSqm.trim(),
      values.rentAmount.trim(),
      values.rentUnit,
      values.contactPhone.trim(),
    ].filter(Boolean).length
    safeTrackLandingEvent(analyticsTrack, 'landing_form_submit', {
      page_type: 'publish',
      field_completeness: filledCount,
      commission_months: values.commissionMonths,
    })

    const clientErrors = getSupplyFieldErrors(values)
    if (Object.keys(clientErrors).length > 0) {
      updateState({
        status: 'error',
        fieldErrors: clientErrors,
        formError: '还有几项信息需要补充，请检查后再提交。',
        errorReason: 'client_validation',
      })
      safeTrackLandingEvent(analyticsTrack, 'landing_form_error', {
        page_type: 'publish',
        error_code: 'validation_failed',
      })
      return Promise.resolve(state)
    }

    updateState({ status: 'submitting', fieldErrors: {}, formError: null, errorReason: null })
    const intentIdentity = getSupplyIntentIdentity(values)
    const submitWithRequestId = (requestId: string) => {
      activeIntentIdentity = intentIdentity
      activeRequestId = requestId
      return submitSupplySubmission(
        buildSupplySubmissionBody(values, requestId, city),
        requester,
      )
    }
    const submissionResult = pendingRequestStore
      ? (async () => {
          const intentFingerprint = await intentKeyFactory(values)
          const storedRequestId = intentFingerprint
            ? pendingRequestStore.readRequestId(intentFingerprint)
            : null
          const requestId =
            activeIntentIdentity === intentIdentity && activeRequestId
              ? activeRequestId
              : storedRequestId ?? requestIdFactory()
          if (intentFingerprint) pendingRequestStore.rememberRequestId(intentFingerprint, requestId)
          return submitWithRequestId(requestId)
        })()
      : submitWithRequestId(
          activeIntentIdentity === intentIdentity && activeRequestId
            ? activeRequestId
            : requestIdFactory(),
        )

    pendingSubmission = submissionResult
      .then((result) => {
        if (result.ok) {
          updateState({ status: 'success', fieldErrors: {}, formError: null, errorReason: null })
          safeTrackLandingEvent(analyticsTrack, 'landing_form_success', {
            page_type: 'publish',
          })
          safeTrackCityEvent(analyticsTrack, 'city_lead_submitted', {
            city,
            status: cityStatus,
            form_type: 'publish',
          })
          return state
        }

        const fieldErrors =
          result.error === 'validation_error' ? mapSupplyValidationErrors(result.errors ?? []) : {}
        const errorReason = getSupplyErrorReason(result, fieldErrors)
        updateState({
          status: 'error',
          fieldErrors,
          formError:
            errorReason === 'server_validation'
              ? '有几项信息还需要调整，请检查后再提交。'
              : getSubmissionFormError(result),
          errorReason,
        })
        safeTrackLandingEvent(analyticsTrack, 'landing_form_error', {
          page_type: 'publish',
          error_code:
            result.error === 'validation_error'
              ? 'validation_failed'
              : result.error === 'rate_limited'
                ? 'rate_limited'
                : result.error === 'network_error'
                  ? 'network_error'
                  : 'submit_failed',
        })
        return state
      })
      .finally(() => {
        pendingSubmission = null
      })
    return pendingSubmission
  }

  return { getState: () => state, submit }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `publish-${crypto.randomUUID()}`
  }
  return `publish-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/** 让 Field 注入的 id/aria 属性直达真实 input，同时保留输入框内单位后缀。 */
const AreaInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function AreaInput(props, ref) {
    return (
      <span className="input-suffix">
        <Input {...props} ref={ref} />
        <span className="input-suffix__unit" aria-hidden="true">
          ㎡
        </span>
      </span>
    )
  },
)

export const SupplySubmissionSuccessCard = React.forwardRef<HTMLDivElement>(
  function SupplySubmissionSuccessCard(_props, ref) {
  return (
    <div
      className="publish-card"
      role="status"
      aria-live="polite"
      tabIndex={-1}
      ref={ref}
    >
      <h2 className="publish-card__title">{PUBLISH_COPY.successTitle}</h2>
      <p className="publish-card__footer">{PUBLISH_COPY.successBody}</p>
      <div className="publish-card__actions">
        <Button as="link" href="/" variant="primary">
          返回首页
        </Button>
      </div>
    </div>
  )
  },
)

/** 房源投放卡片；一次挂载内的失败重试沿用同一幂等 requestId。 */
export default function SupplySubmissionForm({
  citySlug = siteConfig.defaultCity,
  cities = [{ slug: siteConfig.defaultCity, name: siteConfig.defaultCity, serviceStatus: 'live' }],
  cityError,
}: Readonly<{
  citySlug?: string
  cities?: readonly LeadCityOption[]
  cityError?: string
}>) {
  const commissionId = useId()
  const contactNoteId = 'publish-contact-note'
  const successRef = useRef<HTMLDivElement>(null)
  const buildingNameRef = useRef<HTMLInputElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const areaSqmRef = useRef<HTMLInputElement>(null)
  const rentAmountRef = useRef<HTMLInputElement>(null)
  const contactPhoneRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<SupplyFormValues>(INITIAL_VALUES)
  const [selectedCity, setSelectedCity] = useState(citySlug)
  const [activeCityError, setActiveCityError] = useState(cityError)
  const [formState, setFormState] = useState<SupplyFormState>(INITIAL_STATE)
  const [coordinator] = useState(() =>
    createSupplySubmissionCoordinator(newRequestId, fetch, setFormState, track, {
      pendingRequestStore: createBrowserSupplyPendingRequestStore(),
    }),
  )
  const [trackFormStart] = useState(() =>
    createLandingOnceTracker('landing_form_start', 'publish', track),
  )

  useEffect(() => {
    if (formState.status === 'success') {
      successRef.current?.focus()
      return
    }
    if (formState.status !== 'error') return
    const firstErrorField = getFirstSupplyErrorField(formState.fieldErrors)
    if (firstErrorField === 'buildingName') buildingNameRef.current?.focus()
    if (firstErrorField === 'address') addressRef.current?.focus()
    if (firstErrorField === 'areaSqm') areaSqmRef.current?.focus()
    if (firstErrorField === 'rentAmount') rentAmountRef.current?.focus()
    if (firstErrorField === 'contactPhone') contactPhoneRef.current?.focus()
  }, [formState])

  if (formState.status === 'success') {
    return <SupplySubmissionSuccessCard ref={successRef} />
  }

  const updateValue = <Key extends keyof SupplyFormValues>(
    key: Key,
    value: SupplyFormValues[Key],
  ) => setValues((current) => ({ ...current, [key]: value }))

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selectedOption = cities.find((city) => city.slug === selectedCity)
    if (!selectedOption) return
    await coordinator.submit(values, selectedOption.slug, selectedOption.serviceStatus)
  }
  const statusMessage = getSupplyStatusMessage(formState)

  return (
    <form className="publish-card" onSubmit={onSubmit} noValidate>
      <h2 className="publish-card__title">{PUBLISH_COPY.cardTitle}</h2>
      <LeadCitySelect
        pageType="publish"
        cities={cities}
        selectedCity={selectedCity}
        error={activeCityError}
        onChange={(nextCity) => {
          setSelectedCity(nextCity)
          setActiveCityError(undefined)
        }}
      />
      <ProcessSteps steps={PUBLISH_STEPS} size="compact" />

      <div className="publish-card__group">
        <h3 className="publish-card__group-title">{PUBLISH_COPY.groupBuilding}</h3>
        <Field
          label="楼盘名称"
          id="publish-building"
          required
          error={formState.fieldErrors.buildingName}
        >
          <Input
            ref={buildingNameRef}
            name="buildingName"
            autoComplete="off"
            maxLength={100}
            placeholder="请输入楼盘名称…"
            value={values.buildingName}
            onChange={(event) => updateValue('buildingName', event.target.value)}
            onFocus={trackFormStart}
          />
        </Field>

        <Field
          label="详细地址"
          id="publish-address"
          required
          error={formState.fieldErrors.address}
        >
          <Input
            ref={addressRef}
            name="address"
            autoComplete="street-address"
            maxLength={200}
            placeholder="请输入楼号、单元号或房间号…"
            value={values.address}
            onChange={(event) => updateValue('address', event.target.value)}
            onFocus={trackFormStart}
          />
        </Field>

        <Field
          label="出租面积"
          id="publish-area"
          required
          error={formState.fieldErrors.areaSqm}
        >
          <AreaInput
            ref={areaSqmRef}
            name="areaSqm"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="请输入出租面积…"
            value={values.areaSqm}
            onChange={(event) => updateValue('areaSqm', event.target.value)}
            onFocus={trackFormStart}
          />
        </Field>

        <div className="publish-card__row">
          <Field label="租金" id="publish-rent" error={formState.fieldErrors.rentAmount}>
            <Input
              ref={rentAmountRef}
              name="rentAmount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="请输入期望价格…"
              value={values.rentAmount}
              onChange={(event) => updateValue('rentAmount', event.target.value)}
              onFocus={trackFormStart}
            />
          </Field>
          <Field label="租金单位" id="publish-rent-unit">
            <Select
              name="rentUnit"
              value={values.rentUnit}
              onFocus={trackFormStart}
              onChange={(event) =>
                updateValue('rentUnit', event.target.value as InquiryPriceUnit)
              }
            >
              {RENT_UNIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <fieldset className="publish-card__group">
        <legend className="publish-card__group-title">{PUBLISH_COPY.groupCommission}</legend>
        <p className="publish-card__group-note">{PUBLISH_COPY.commissionNote}</p>
        <div className="commission-options">
          {COMMISSION_MONTHS.map((value) => (
            <span key={value} className="commission-options__item">
              <input
                className="commission-options__input"
                type="radio"
                id={`${commissionId}-${value}`}
                name="commissionMonths"
                value={value}
                checked={values.commissionMonths === value}
                onChange={() => updateValue('commissionMonths', value)}
              />
              <label className="commission-options__label" htmlFor={`${commissionId}-${value}`}>
                {COMMISSION_MONTHS_LABELS[value]}
              </label>
            </span>
          ))}
        </div>
      </fieldset>

      <div className="publish-card__group">
        <h3 className="publish-card__group-title">{PUBLISH_COPY.groupContact}</h3>
        <p className="publish-card__group-note" id={contactNoteId}>
          {PUBLISH_COPY.contactNote}提交即表示同意
          <Link href="/pages/privacy" target="_blank" rel="noopener noreferrer">《隐私政策》</Link>。
        </p>
        <Field
          label="手机号"
          id="publish-phone"
          required
          error={formState.fieldErrors.contactPhone}
        >
          <Input
            ref={contactPhoneRef}
            name="contactPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={17}
            placeholder="请输入手机号…"
            value={values.contactPhone}
            onChange={(event) => updateValue('contactPhone', event.target.value)}
            onFocus={trackFormStart}
            aria-describedby={contactNoteId}
          />
        </Field>
      </div>

      {statusMessage ? (
        <div
          className="publish-card__status"
          role={formState.status === 'error' ? 'alert' : 'status'}
          aria-live={formState.status === 'error' ? 'assertive' : 'polite'}
        >
          {statusMessage}
        </div>
      ) : null}

      <div className="publish-card__actions">
        <Button
          type="submit"
          variant="primary"
          loading={formState.status === 'submitting'}
          disabled={Boolean(activeCityError) || !selectedCity}
        >
          {getSupplySubmitLabel(formState)}
        </Button>
        <p className="publish-card__footer">{PUBLISH_COPY.cardFooter}</p>
      </div>
    </form>
  )
}
