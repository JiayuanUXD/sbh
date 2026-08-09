'use client'

import Link from 'next/link'
import React, { useId, useState } from 'react'
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
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

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

export type SupplyFormState = Readonly<{
  status: 'idle' | 'submitting' | 'success' | 'error'
  fieldErrors: SupplyFieldErrors
  formError: string | null
}>

export type SupplySubmissionCoordinator = Readonly<{
  getState: () => SupplyFormState
  submit: (values: SupplyFormValues) => Promise<SupplyFormState>
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
): SupplySubmissionBody {
  const hasRentAmount = values.rentAmount.trim().length > 0
  return {
    requestId,
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
  if (result.error === 'rate_limited') return '提交过于频繁，请稍后再试'
  if (result.error === 'network_error') return '网络异常，请稍后重试'
  if (result.error === 'validation_error') return '提交内容有误，请检查后重试'
  return '提交失败，请稍后重试'
}

export function createSupplySubmissionCoordinator(
  requestIdFactory: () => string,
  requester: SupplyRequester,
  onStateChange: (state: SupplyFormState) => void = () => undefined,
): SupplySubmissionCoordinator {
  const requestId = requestIdFactory()
  let state = INITIAL_STATE
  let pendingSubmission: Promise<SupplyFormState> | null = null

  const updateState = (nextState: SupplyFormState) => {
    state = nextState
    onStateChange(state)
  }

  const submit = (values: SupplyFormValues): Promise<SupplyFormState> => {
    if (pendingSubmission) return pendingSubmission

    const clientErrors = getSupplyFieldErrors(values)
    if (Object.keys(clientErrors).length > 0) {
      updateState({ status: 'error', fieldErrors: clientErrors, formError: null })
      return Promise.resolve(state)
    }

    updateState({ status: 'submitting', fieldErrors: {}, formError: null })
    pendingSubmission = submitSupplySubmission(
      buildSupplySubmissionBody(values, requestId),
      requester,
    )
      .then((result) => {
        if (result.ok) {
          updateState({ status: 'success', fieldErrors: {}, formError: null })
          return state
        }

        const fieldErrors =
          result.error === 'validation_error' ? mapSupplyValidationErrors(result.errors ?? []) : {}
        updateState({
          status: 'error',
          fieldErrors,
          formError:
            result.error === 'validation_error' && Object.keys(fieldErrors).length > 0
              ? null
              : getSubmissionFormError(result),
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
function AreaInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="input-suffix">
      <Input {...props} />
      <span className="input-suffix__unit" aria-hidden="true">
        ㎡
      </span>
    </span>
  )
}

/** 房源投放卡片；一次挂载内的失败重试沿用同一幂等 requestId。 */
export default function SupplySubmissionForm() {
  const commissionId = useId()
  const contactNoteId = 'publish-contact-note'
  const [values, setValues] = useState<SupplyFormValues>(INITIAL_VALUES)
  const [formState, setFormState] = useState<SupplyFormState>(INITIAL_STATE)
  const [coordinator] = useState(() =>
    createSupplySubmissionCoordinator(newRequestId, fetch, setFormState),
  )

  if (formState.status === 'success') {
    return (
      <div className="publish-card" role="status" aria-live="polite">
        <h2 className="publish-card__title">{PUBLISH_COPY.successTitle}</h2>
        <p className="publish-card__footer">{PUBLISH_COPY.successBody}</p>
      </div>
    )
  }

  const updateValue = <Key extends keyof SupplyFormValues>(
    key: Key,
    value: SupplyFormValues[Key],
  ) => setValues((current) => ({ ...current, [key]: value }))

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await coordinator.submit(values)
  }

  return (
    <form className="publish-card" onSubmit={onSubmit} noValidate>
      <h2 className="publish-card__title">{PUBLISH_COPY.cardTitle}</h2>
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
            name="buildingName"
            autoComplete="off"
            maxLength={100}
            placeholder="请输入楼盘名称…"
            value={values.buildingName}
            onChange={(event) => updateValue('buildingName', event.target.value)}
          />
        </Field>

        <Field
          label="详细地址"
          id="publish-address"
          required
          error={formState.fieldErrors.address}
        >
          <Input
            name="address"
            autoComplete="street-address"
            maxLength={200}
            placeholder="请输入楼号、单元号或房间号…"
            value={values.address}
            onChange={(event) => updateValue('address', event.target.value)}
          />
        </Field>

        <Field
          label="出租面积"
          id="publish-area"
          required
          error={formState.fieldErrors.areaSqm}
        >
          <AreaInput
            name="areaSqm"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="请输入出租面积…"
            value={values.areaSqm}
            onChange={(event) => updateValue('areaSqm', event.target.value)}
          />
        </Field>

        <div className="publish-card__row">
          <Field label="租金" id="publish-rent" error={formState.fieldErrors.rentAmount}>
            <Input
              name="rentAmount"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              placeholder="请输入期望价格…"
              value={values.rentAmount}
              onChange={(event) => updateValue('rentAmount', event.target.value)}
            />
          </Field>
          <Field label="租金单位" id="publish-rent-unit">
            <Select
              name="rentUnit"
              value={values.rentUnit}
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
          <Link href="/pages/privacy">《隐私政策》</Link>。
        </p>
        <Field
          label="手机号"
          id="publish-phone"
          required
          error={formState.fieldErrors.contactPhone}
        >
          <Input
            name="contactPhone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={17}
            placeholder="请输入手机号…"
            value={values.contactPhone}
            onChange={(event) => updateValue('contactPhone', event.target.value)}
            aria-describedby={contactNoteId}
          />
        </Field>
      </div>

      <div aria-live="polite">
        {formState.formError ? (
          <p className="publish-card__error" role="alert">
            {formState.formError}
          </p>
        ) : null}
      </div>

      <div className="publish-card__actions">
        <Button type="submit" variant="primary" loading={formState.status === 'submitting'}>
          {PUBLISH_COPY.submit}
        </Button>
        <p className="publish-card__footer">{PUBLISH_COPY.cardFooter}</p>
      </div>
    </form>
  )
}
