import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import SupplySubmissionForm, {
  buildSupplySubmissionBody,
  createSupplySubmissionCoordinator,
  getSupplyFieldErrors,
  submitSupplySubmission,
  type SupplyFormValues,
} from '@/components/frontend/landing/SupplySubmissionForm'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

const VALID_VALUES: SupplyFormValues = {
  buildingName: ' 世纪商贸广场 ',
  address: ' 长宁区延安西路 2299 号 ',
  areaSqm: ' 268.5 ',
  rentAmount: ' 7.8 ',
  rentUnit: 'rmb-sqm-day',
  commissionMonths: '1',
  contactPhone: ' +86 138-0000-1111 ',
}

describe('SupplySubmissionForm validation and request boundary', () => {
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
    expect(buildSupplySubmissionBody(VALID_VALUES, 'publish-fixed-request')).toEqual({
      requestId: 'publish-fixed-request',
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
    const coordinator = createSupplySubmissionCoordinator(requestIdFactory, requester)

    const first = coordinator.submit(VALID_VALUES)
    const second = coordinator.submit(VALID_VALUES)

    expect(first).toBe(second)
    expect(requestIdFactory).toHaveBeenCalledTimes(1)
    expect(requestBodies).toHaveLength(1)
    expect(coordinator.getState().status).toBe('submitting')

    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await first

    expect(coordinator.getState()).toEqual({
      status: 'success',
      fieldErrors: {},
      formError: null,
    })
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
    const coordinator = createSupplySubmissionCoordinator(() => 'publish-retry-id', requester)

    await coordinator.submit(VALID_VALUES)
    expect(coordinator.getState()).toEqual({
      status: 'error',
      fieldErrors: {
        address: '请输入详细地址',
        contactPhone: '请输入正确的 11 位手机号',
      },
      formError: null,
    })

    await coordinator.submit(VALID_VALUES)

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]).toContain('"requestId":"publish-retry-id"')
    expect(requestBodies[1]).toContain('"requestId":"publish-retry-id"')
    expect(coordinator.getState().status).toBe('success')
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
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('href="/pages/privacy"')
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
  })
})
