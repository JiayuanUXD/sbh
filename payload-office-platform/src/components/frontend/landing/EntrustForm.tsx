'use client'

import Link from 'next/link'
import React, { useId, useState } from 'react'
import { Button, Field, Input } from '@/components/frontend/ui'
import { ENTRUST_COPY } from '@/lib/frontend/landing-config'
import { track } from '@/lib/frontend/analytics'
import {
  createLandingOnceTracker,
  safeTrackLandingEvent,
  type LandingAnalyticsTrack,
} from '@/lib/frontend/analytics/landing'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

export type EntrustInquiryBody = Readonly<{
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
  submit: (phone: string) => Promise<EntrustFormState>
}>

const PHONE_ERROR = '请输入正确的 11 位手机号'

/** 与服务端一致：去除常见格式分隔符与中国区号后再校验。 */
export function normalizeEntrustPhone(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, '').replace(/^(?:\+?86)+/, '')
}

export function isValidEntrustPhone(raw: string): boolean {
  return /^1[3-9]\d{9}$/.test(normalizeEntrustPhone(raw))
}

export function buildEntrustInquiryBody(phone: string, requestId: string): EntrustInquiryBody {
  return {
    phone: normalizeEntrustPhone(phone),
    requestId,
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

  const updateState = (nextState: EntrustFormState) => {
    state = nextState
    onStateChange(state)
  }

  const submit = (phone: string): Promise<EntrustFormState> => {
    if (pendingSubmission) return pendingSubmission
    if (!isValidEntrustPhone(phone)) {
      updateState({ status: 'error', error: PHONE_ERROR })
      safeTrackLandingEvent(analyticsTrack, 'landing_form_error', {
        page_type: 'entrust',
        error_code: 'validation_failed',
      })
      return Promise.resolve(state)
    }

    updateState({ status: 'submitting', error: null })
    pendingSubmission = submitEntrustInquiry(buildEntrustInquiryBody(phone, requestId), requester)
      .then((result) => {
        if (result.ok) {
          updateState({ status: 'success', error: null })
          safeTrackLandingEvent(analyticsTrack, 'landing_form_success', {
            page_type: 'entrust',
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
    safeTrackLandingEvent(analyticsTrack, 'landing_form_submit', {
      page_type: 'entrust',
      field_completeness: 1,
    })
    return pendingSubmission
  }

  return { getState: () => state, submit }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `entrust-${crypto.randomUUID()}`
  }
  return `entrust-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

/** /entrust 首屏仅采集手机号；一次挂载内重试沿用同一幂等 requestId。 */
export default function EntrustForm() {
  const inputId = 'entrust-phone'
  const noteId = useId()
  const [phone, setPhone] = useState('')
  const [formState, setFormState] = useState<EntrustFormState>({ status: 'idle', error: null })
  const [coordinator] = useState(() => createEntrustSubmissionCoordinator(newRequestId, fetch, setFormState))
  const [trackFormStart] = useState(() =>
    createLandingOnceTracker('landing_form_start', 'entrust', track),
  )

  if (formState.status === 'success') {
    return (
      <div className="entrust-form__success" role="status" aria-live="polite">
        <h2>{ENTRUST_COPY.successTitle}</h2>
        <p>{ENTRUST_COPY.successBody}</p>
      </div>
    )
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await coordinator.submit(phone)
  }

  return (
    <form className="entrust-form" onSubmit={onSubmit} noValidate>
      <Field label="手机号" id={inputId} error={formState.error} required className="entrust-form__field">
        <Input
          type="tel"
          name="phone"
          inputMode="numeric"
          autoComplete="tel"
          placeholder={ENTRUST_COPY.formPlaceholder}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          onFocus={trackFormStart}
          aria-describedby={noteId}
        />
      </Field>
      <Button type="submit" variant="primary" loading={formState.status === 'submitting'}>
        {ENTRUST_COPY.formSubmit}
      </Button>
      <p className="entrust-form__note" id={noteId}>
        提交即表示同意
        <Link href="/pages/privacy">《隐私政策》</Link>
        ，并授权我们与您联系
      </p>
    </form>
  )
}
