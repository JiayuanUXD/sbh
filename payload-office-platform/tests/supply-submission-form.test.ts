import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import SupplySubmissionForm, {
  SupplySubmissionSuccessCard,
  buildSupplySubmissionBody,
  createSupplySubmissionCoordinator,
  getFirstSupplyErrorField,
  getSupplyFieldErrors,
  getSupplyStatusMessage,
  getSupplySubmitLabel,
  submitSupplySubmission,
  type SupplyFormState,
  type SupplyFormValues,
} from '@/components/frontend/landing/SupplySubmissionForm'
import {
  createSupplyPendingRequestStore,
  getSupplyIntentIdentity,
} from '@/lib/frontend/supply-submission-request'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import type { LandingAnalyticsRecord } from '@/lib/frontend/analytics/landing'

const VALID_VALUES: SupplyFormValues = {
  buildingName: ' 世纪商贸广场 ',
  address: ' 长宁区延安西路 2299 号 ',
  areaSqm: ' 268.5 ',
  rentAmount: ' 7.8 ',
  rentUnit: 'rmb-sqm-day',
  commissionMonths: '1',
  contactPhone: ' +86 138-0000-1111 ',
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('SupplySubmissionForm validation and request boundary', () => {
  it('derives friendly submit labels and status messages from submission state', () => {
    const idle: SupplyFormState = {
      status: 'idle',
      fieldErrors: {},
      formError: null,
      errorReason: null,
    }
    const submitting: SupplyFormState = {
      status: 'submitting',
      fieldErrors: {},
      formError: null,
      errorReason: null,
    }
    const rateLimited: SupplyFormState = {
      status: 'error',
      fieldErrors: {},
      formError: '刚才提交得有点频繁，请稍后再试。',
      errorReason: 'rate_limited',
    }
    const genericFailure: SupplyFormState = {
      status: 'error',
      fieldErrors: {},
      formError: '暂时没有提交成功，已填写的内容还在，请稍后再试。',
      errorReason: 'server_error',
    }

    expect(getSupplySubmitLabel(idle)).toBe('立即投放')
    expect(getSupplySubmitLabel(submitting)).toBe('提交中...')
    expect(getSupplySubmitLabel(rateLimited)).toBe('稍后重试')
    expect(getSupplySubmitLabel(genericFailure)).toBe('重新提交')
    expect(getSupplyStatusMessage(submitting)).toBe('正在提交，我们会为您保留已填写的信息。')
    expect(getSupplyStatusMessage(genericFailure)).toBe('暂时没有提交成功，已填写的内容还在，请稍后再试。')
  })

  it('returns the first invalid supply field in visual order', () => {
    expect(getFirstSupplyErrorField({ address: '请输入详细地址', contactPhone: '请输入正确的 11 位手机号' }))
      .toBe('address')
    expect(getFirstSupplyErrorField({ rentAmount: '租金数值不合法', contactPhone: '请输入正确的 11 位手机号' }))
      .toBe('rentAmount')
    expect(getFirstSupplyErrorField({})).toBeNull()
  })

  it('returns field-level errors without discarding the supplied values', () => {
    const values: SupplyFormValues = {
      ...VALID_VALUES,
      buildingName: ' ',
      address: '',
      areaSqm: '0',
      rentAmount: '-1',
      contactPhone: '123',
    }

    expect(getSupplyFieldErrors(values)).toEqual({
      buildingName: '请输入楼盘名称',
      address: '请输入详细地址',
      areaSqm: '出租面积需为正数',
      rentAmount: '租金数值不合法',
      contactPhone: '请输入正确的 11 位手机号',
    })
    expect(values.address).toBe('')
    expect(values.contactPhone).toBe('123')
  })

  it('builds the exact normalized body required by the supply endpoint', () => {
    expect(buildSupplySubmissionBody(VALID_VALUES, 'publish-fixed-request', 'hangzhou')).toEqual({
      requestId: 'publish-fixed-request',
      city: 'hangzhou',
      buildingName: '世纪商贸广场',
      address: '长宁区延安西路 2299 号',
      areaSqm: 268.5,
      rentAmount: 7.8,
      rentUnit: 'rmb-sqm-day',
      commissionMonths: '1',
      contactPhone: '13800001111',
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: { path: '/publish' },
    })
  })

  it('omits both optional rent fields when no rent amount is supplied', () => {
    const body = buildSupplySubmissionBody(
      { ...VALID_VALUES, rentAmount: '', rentUnit: 'rmb-month' },
      'publish-without-rent',
    )

    expect(body).not.toHaveProperty('rentAmount')
    expect(body).not.toHaveProperty('rentUnit')
  })

  it('accepts only an ok JSON response and maps safe API failures', async () => {
    const body = buildSupplySubmissionBody(VALID_VALUES, 'publish-response-contract')

    await expect(
      submitSupplySubmission(body, async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    ).resolves.toEqual({ ok: true })
    await expect(
      submitSupplySubmission(body, async () =>
        new Response(JSON.stringify({ ok: false, errors: ['building_name_required'] }), {
          status: 422,
        }),
      ),
    ).resolves.toEqual({ ok: false, error: 'validation_error', errors: ['building_name_required'] })
    await expect(
      submitSupplySubmission(body, async () => new Response('{}', { status: 429 })),
    ).resolves.toEqual({ ok: false, error: 'rate_limited' })
    await expect(
      submitSupplySubmission(body, async () =>
        new Response(JSON.stringify({ ok: true }), { status: 500 }),
      ),
    ).resolves.toEqual({ ok: false, error: 'failed' })
    await expect(
      submitSupplySubmission(body, async () => new Response('not-json', { status: 200 })),
    ).resolves.toEqual({ ok: false, error: 'failed' })
    await expect(
      submitSupplySubmission(body, async () => {
        throw new Error('offline')
      }),
    ).resolves.toEqual({ ok: false, error: 'network_error' })
  })

  it('creates one request ID, deduplicates an in-flight double submit, and reaches success', async () => {
    const storage = new MemoryStorage()
    const requestIdFactory = vi.fn(() => 'publish-one-mount')
    const requestBodies: string[] = []
    let resolveResponse: (response: Response) => void = () => undefined
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const requester = (_url: string, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body === 'string') requestBodies.push(init.body)
      return response
    }
    const events: LandingAnalyticsRecord[] = []
    let resolveIntentKey: (value: string) => void = () => undefined
    const intentKey = new Promise<string>((resolve) => {
      resolveIntentKey = resolve
    })
    const coordinator = createSupplySubmissionCoordinator(
      requestIdFactory,
      requester,
      undefined,
      (name, props) => events.push({ name, props }),
      {
        pendingRequestStore: createSupplyPendingRequestStore(storage),
        intentKeyFactory: () => intentKey,
      },
    )

    const first = coordinator.submit(VALID_VALUES, 'hangzhou', 'coming-soon')
    const second = coordinator.submit(VALID_VALUES, 'hangzhou', 'coming-soon')

    expect(first).toBe(second)
    expect(requestIdFactory).not.toHaveBeenCalled()
    expect(requestBodies).toHaveLength(0)

    resolveIntentKey('a'.repeat(64))
    await vi.waitFor(() => expect(requestBodies).toHaveLength(1))

    expect(requestIdFactory).toHaveBeenCalledTimes(1)
    expect(coordinator.getState().status).toBe('submitting')

    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await first

    expect(coordinator.getState()).toEqual({
      status: 'success',
      fieldErrors: {},
      formError: null,
      errorReason: null,
    })
    expect(events).toEqual([
      {
        name: 'landing_form_submit',
        props: {
          page_type: 'publish',
          field_completeness: 6,
          commission_months: '1',
        },
      },
      { name: 'landing_form_success', props: { page_type: 'publish' } },
      {
        name: 'city_lead_submitted',
        props: { city: 'hangzhou', status: 'coming-soon', form_type: 'publish' },
      },
    ])
    expect(JSON.stringify(events)).not.toMatch(/涓栫邯|13800001111|2299|\/publish/)
  })

  it('does not persist a request ID on mount or for a client-invalid attempt', async () => {
    const storage = new MemoryStorage()
    const requestIdFactory = vi.fn(() => 'publish-valid-only')
    const intentKeyFactory = vi.fn(async () => 'intent-valid-only')
    const coordinator = createSupplySubmissionCoordinator(
      requestIdFactory,
      async () => new Response('{}', { status: 500 }),
      undefined,
      undefined,
      {
        pendingRequestStore: createSupplyPendingRequestStore(storage),
        intentKeyFactory,
      },
    )

    expect(storage.length).toBe(0)
    await coordinator.submit({ ...VALID_VALUES, contactPhone: '123' })

    expect(storage.length).toBe(0)
    expect(requestIdFactory).not.toHaveBeenCalled()
    expect(intentKeyFactory).not.toHaveBeenCalled()
  })

  it('reuses the same request ID after a successful submit and a simulated refresh', async () => {
    const storage = new MemoryStorage()
    const requestBodies: string[] = []
    const requester = async (_url: string, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body === 'string') requestBodies.push(init.body)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    const firstFactory = vi.fn(() => 'publish-before-refresh')
    const secondFactory = vi.fn(() => 'publish-must-not-be-used')
    const options = { pendingRequestStore: createSupplyPendingRequestStore(storage) }

    await createSupplySubmissionCoordinator(
      firstFactory,
      requester,
      undefined,
      undefined,
      options,
    ).submit(VALID_VALUES)
    await createSupplySubmissionCoordinator(
      secondFactory,
      requester,
      undefined,
      undefined,
      options,
    ).submit({
      ...VALID_VALUES,
      buildingName: '世纪商贸广场',
      contactPhone: '13800001111',
    })

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).toContain('"requestId":"publish-before-refresh"')
    expect(requestBodies[1]).toContain('"requestId":"publish-before-refresh"')
    expect(firstFactory).toHaveBeenCalledTimes(1)
    expect(secondFactory).not.toHaveBeenCalled()
    expect(storage.length).toBe(1)
    const persistedValue = storage.getItem(storage.key(0) ?? '') ?? ''
    expect(persistedValue).not.toContain('13800001111')
    expect(persistedValue).not.toContain('世纪商贸广场')
  })

  it('rotates the persisted request ID when the normalized phone or building intent changes', async () => {
    const storage = new MemoryStorage()
    const requestBodies: string[] = []
    const requestIdFactory = vi
      .fn<() => string>()
      .mockReturnValueOnce('publish-intent-a')
      .mockReturnValueOnce('publish-intent-b')
      .mockReturnValueOnce('publish-intent-c')
    const coordinator = createSupplySubmissionCoordinator(
      requestIdFactory,
      async (_url, init) => {
        if (typeof init?.body === 'string') requestBodies.push(init.body)
        return new Response('{}', { status: 500 })
      },
      undefined,
      undefined,
      {
        pendingRequestStore: createSupplyPendingRequestStore(storage),
      },
    )

    await coordinator.submit(VALID_VALUES)
    await coordinator.submit({ ...VALID_VALUES, contactPhone: '13900002222' })
    await coordinator.submit({
      ...VALID_VALUES,
      contactPhone: '13900002222',
      buildingName: '另一栋楼',
    })

    expect(requestBodies[0]).toContain('"requestId":"publish-intent-a"')
    expect(requestBodies[1]).toContain('"requestId":"publish-intent-b"')
    expect(requestBodies[2]).toContain('"requestId":"publish-intent-c"')
    expect(requestIdFactory).toHaveBeenCalledTimes(3)
  })

  it('falls back to mount-local retry idempotency when sessionStorage is unavailable', async () => {
    const unavailableStorage: Storage = {
      get length(): number {
        throw new Error('storage unavailable')
      },
      clear() {
        throw new Error('storage unavailable')
      },
      getItem() {
        throw new Error('storage unavailable')
      },
      key(): string | null {
        throw new Error('storage unavailable')
      },
      removeItem() {
        throw new Error('storage unavailable')
      },
      setItem() {
        throw new Error('storage unavailable')
      },
    }
    const requestBodies: string[] = []
    const requestIdFactory = vi.fn(() => 'publish-storage-fallback')
    const coordinator = createSupplySubmissionCoordinator(
      requestIdFactory,
      async (_url, init) => {
        if (typeof init?.body === 'string') requestBodies.push(init.body)
        return new Response('{}', { status: 500 })
      },
      undefined,
      undefined,
      {
        pendingRequestStore: createSupplyPendingRequestStore(unavailableStorage),
        intentKeyFactory: async () => 'intent-fallback',
      },
    )

    await coordinator.submit(VALID_VALUES)
    await coordinator.submit(VALID_VALUES)

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).toContain('"requestId":"publish-storage-fallback"')
    expect(requestBodies[1]).toContain('"requestId":"publish-storage-fallback"')
    expect(requestIdFactory).toHaveBeenCalledTimes(1)
  })

  it('tracks a partial client-side attempt before validation without making a request', async () => {
    let requests = 0
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createSupplySubmissionCoordinator(
      () => 'publish-invalid',
      async () => {
        requests += 1
        return new Response('{}', { status: 500 })
      },
      undefined,
      (name, props) => events.push({ name, props }),
    )

    await coordinator.submit({ ...VALID_VALUES, buildingName: '', contactPhone: '123' })

    expect(requests).toBe(0)
    expect(events).toEqual([
      {
        name: 'landing_form_submit',
        props: {
          page_type: 'publish',
          field_completeness: 5,
          commission_months: '1',
        },
      },
      {
        name: 'landing_form_error',
        props: { page_type: 'publish', error_code: 'validation_failed' },
      },
    ])
  })

  it('counts the default rent unit as the sole completed field on an otherwise empty attempt', async () => {
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createSupplySubmissionCoordinator(
      () => 'publish-empty',
      async () => new Response('{}', { status: 500 }),
      undefined,
      (name, props) => events.push({ name, props }),
    )

    await coordinator.submit({
      buildingName: '',
      address: '',
      areaSqm: '',
      rentAmount: '',
      rentUnit: 'rmb-sqm-day',
      commissionMonths: 'none',
      contactPhone: '',
    })

    expect(events).toEqual([
      {
        name: 'landing_form_submit',
        props: {
          page_type: 'publish',
          field_completeness: 1,
          commission_months: 'none',
        },
      },
      {
        name: 'landing_form_error',
        props: { page_type: 'publish', error_code: 'validation_failed' },
      },
    ])
  })

  it('uses fixed safe error codes for rate-limit, network, and generic failures', async () => {
    let attempt = 0
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createSupplySubmissionCoordinator(
      () => 'publish-safe-errors',
      async () => {
        attempt += 1
        if (attempt === 1) return new Response('{}', { status: 429 })
        if (attempt === 2) throw new Error('private network detail')
        return new Response('{}', { status: 500 })
      },
      undefined,
      (name, props) => events.push({ name, props }),
    )

    await coordinator.submit(VALID_VALUES)
    await coordinator.submit(VALID_VALUES)
    await coordinator.submit(VALID_VALUES)

    expect(events.filter((event) => event.name === 'landing_form_error')).toEqual([
      { name: 'landing_form_error', props: { page_type: 'publish', error_code: 'rate_limited' } },
      { name: 'landing_form_error', props: { page_type: 'publish', error_code: 'network_error' } },
      { name: 'landing_form_error', props: { page_type: 'publish', error_code: 'submit_failed' } },
    ])
    expect(events.filter((event) => event.name === 'landing_form_submit')).toHaveLength(3)
    expect(JSON.stringify(events)).not.toContain('private network detail')
  })

  it('keeps submission successful when analytics throws', async () => {
    const coordinator = createSupplySubmissionCoordinator(
      () => 'publish-analytics-failure',
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      undefined,
      () => {
        throw new Error('analytics unavailable')
      },
    )

    await expect(coordinator.submit(VALID_VALUES)).resolves.toMatchObject({ status: 'success' })
  })

  it('reuses the mounted request ID after failure and maps 422 errors to fields', async () => {
    const requestBodies: string[] = []
    const requester = (_url: string, init?: RequestInit): Promise<Response> => {
      if (typeof init?.body === 'string') requestBodies.push(init.body)
      if (requestBodies.length === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: false, errors: ['address_required', 'phone_invalid'] }), {
            status: 422,
          }),
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    }
    const events: LandingAnalyticsRecord[] = []
    const coordinator = createSupplySubmissionCoordinator(
      () => 'publish-retry-id',
      requester,
      undefined,
      (name, props) => events.push({ name, props }),
    )

    await coordinator.submit(VALID_VALUES)
    expect(coordinator.getState()).toEqual({
      status: 'error',
      fieldErrors: {
        address: '请输入详细地址',
        contactPhone: '请输入正确的 11 位手机号',
      },
      formError: '有几项信息还需要调整，请检查后再提交。',
      errorReason: 'server_validation',
    })

    await coordinator.submit(VALID_VALUES)

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).toContain('"requestId":"publish-retry-id"')
    expect(requestBodies[1]).toContain('"requestId":"publish-retry-id"')
    expect(coordinator.getState().status).toBe('success')
    expect(events.map((event) => event.name)).toEqual([
      'landing_form_submit',
      'landing_form_error',
      'landing_form_submit',
      'landing_form_success',
      'city_lead_submitted',
    ])
    expect(events[1].props).toEqual({ page_type: 'publish', error_code: 'validation_failed' })
  })

  it('renders labels, controls, defaults, descriptions, and live regions accessibly', () => {
    const markup = renderToStaticMarkup(React.createElement(SupplySubmissionForm))

    expect(markup).toContain('<form class="publish-card"')
    expect(markup).toContain('id="publish-building"')
    expect(markup).toContain('id="publish-address"')
    expect(markup).toContain('id="publish-area"')
    expect(markup).toMatch(
      /class="input-suffix"[^>]*>.*id="publish-area".*class="input-suffix__unit"[^>]*aria-hidden="true"[^>]*>㎡<\/span>/,
    )
    expect(markup).toContain('id="publish-phone"')
    expect(markup).toContain('name="commissionMonths"')
    expect(markup).toMatch(
      /<input(?=[^>]*name="commissionMonths")(?=[^>]*value="none")(?=[^>]*checked="")[^>]*>/,
    )
    expect(markup).toContain('aria-describedby="publish-contact-note"')
    expect(markup).not.toContain('publish-card__status')
    expect(markup).toContain('href="/pages/privacy"')
  })

  it('renders a success card with a return-home action', () => {
    const markup = renderToStaticMarkup(React.createElement(SupplySubmissionSuccessCard))

    expect(markup).toContain('role="status"')
    expect(markup).toContain('tabindex="-1"')
    expect(markup).toContain('已收到您的房源')
    expect(markup).toContain('href="/"')
    expect(markup).toContain('返回首页')
    expect(markup).not.toContain('继续投放另一套')
  })

  it('keeps the six user-facing field groups in the required order with five commission choices', () => {
    const markup = renderToStaticMarkup(React.createElement(SupplySubmissionForm))
    const orderedLabels = ['楼盘名称', '详细地址', '出租面积', '租金', '佣金', '手机号']
    let previousIndex = -1

    for (const label of orderedLabels) {
      const currentIndex = markup.indexOf(label, previousIndex + 1)
      expect(currentIndex, `${label} should follow the previous field group`).toBeGreaterThan(
        previousIndex,
      )
      previousIndex = currentIndex
    }

    expect(markup.match(/name="commissionMonths"/g)).toHaveLength(5)
    expect(markup).toContain('<h2 class="publish-card__title">免费投放房源</h2>')
  })

  it('raises the overlapping publish card above the centered hero stacking layer', () => {
    const css = readFileSync(
      new URL('../src/app/(frontend)/styles.css', import.meta.url),
      'utf8',
    )

    expect(css).toMatch(
      /\.publish-card\s*\{(?=[^}]*position:\s*relative)(?=[^}]*z-index:\s*calc\(var\(--z-raised\)\s*\+\s*1\))[^}]*\}/,
    )
    expect(css).toMatch(
      /\.input-suffix \.filter-bar__input\s*\{(?=[^}]*width:\s*100%)(?=[^}]*padding-right:\s*var\(--sp-7\))[^}]*\}/,
    )
  })
})

describe('getSupplyIntentIdentity', () => {
  const base = { buildingName: '静安嘉里中心', address: '3 号楼 12 层 1203 室', contactPhone: '13800001111' }

  it('归一化手机号并 trim 各段，同一意图得到同一身份', () => {
    expect(getSupplyIntentIdentity(base)).toBe(
      getSupplyIntentIdentity({
        buildingName: ' 静安嘉里中心 ',
        address: ' 3 号楼 12 层 1203 室 ',
        contactPhone: ' 138-0000-1111 ',
      }),
    )
  })

  /**
   * 同一业主在同一楼盘有多套在租房源是商办常态。地址若不参与身份，第二套会复用
   * sessionStorage 里的 requestId，被服务端判为重放、返回 ok 但不落库（审查发现）。
   */
  it('同人同楼盘但地址不同则身份不同', () => {
    expect(getSupplyIntentIdentity({ ...base, address: '3 号楼 15 层 1505 室' })).not.toBe(
      getSupplyIntentIdentity(base),
    )
  })
})
