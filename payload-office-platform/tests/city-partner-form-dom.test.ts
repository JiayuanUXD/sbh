// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const trackSpy = vi.hoisted(() => vi.fn())
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('@/lib/frontend/analytics', () => ({ track: trackSpy }))

import CityPartnerApplicationForm from '@/components/frontend/city-partner/CityPartnerApplicationForm'

const cities = [
  { slug: 'shanghai', name: '上海', serviceStatus: 'live' as const, sortOrder: 10 },
  { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon' as const, sortOrder: 20 },
]

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  trackSpy.mockReset()
  vi.unstubAllGlobals()
})

async function renderForm(options: { initialCity?: string; invalid?: boolean } = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(React.createElement(CityPartnerApplicationForm, {
      cities,
      initialCity: options.initialCity ?? 'shanghai',
      invalidExplicitCity: options.invalid ?? false,
    }))
  })
  return container
}

function input(id: string): HTMLInputElement {
  const element = document.querySelector(`#${id}`)
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing input ${id}`)
  return element
}

async function change(element: HTMLInputElement | HTMLSelectElement, value: string | boolean) {
  await act(async () => {
    if (typeof value === 'boolean') {
      if (element instanceof HTMLInputElement && element.checked !== value) element.click()
    } else {
      const prototype = element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      setter?.call(element, value)
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
}

describe('city partner form DOM accessibility', () => {
  it.each([
    ['phone focus', '#partner-phone', 'focus'],
    ['identity change', '#partner-identity', 'change'],
    ['consent focus', '.city-partner-form__consent input', 'focus'],
  ] as const)('tracks once when the first interaction is %s', async (_label, selector, interaction) => {
    await renderForm()
    expect(trackSpy).not.toHaveBeenCalled()
    const element = document.querySelector(selector)
    if (!(element instanceof HTMLElement)) throw new Error(`missing ${selector}`)
    await act(async () => {
      if (interaction === 'change' && element instanceof HTMLSelectElement) element.value = 'local-operations'
      const eventName = interaction === 'focus' ? 'focusin' : interaction
      element.dispatchEvent(new Event(eventName, { bubbles: true }))
      element.dispatchEvent(new Event(eventName, { bubbles: true }))
    })
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith('city_partner_application_started', {
      city_slug: 'shanghai', stage: 'stage-one',
    })
    expect(JSON.stringify(trackSpy.mock.calls)).not.toMatch(/phone|identity|consent/)
  })

  it('waits for a canonical city when city selection is the first interaction', async () => {
    await renderForm({ initialCity: '', invalid: true })
    const city = document.querySelector('#partner-city')
    if (!(city instanceof HTMLSelectElement)) throw new Error('missing city select')
    expect(trackSpy).not.toHaveBeenCalled()
    await change(city, 'hangzhou')
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith('city_partner_application_started', {
      city_slug: 'hangzhou', stage: 'stage-one',
    })
  })

  it('focuses consent and exposes a stable error description only while invalid', async () => {
    await renderForm()
    await change(input('partner-name'), '申请人')
    await change(input('partner-phone'), '13800001111')
    const identity = document.querySelector('#partner-identity')
    if (!(identity instanceof HTMLSelectElement)) throw new Error('missing identity')
    await change(identity, 'local-operations')
    const form = document.querySelector('form')
    if (!(form instanceof HTMLFormElement)) throw new Error('missing form')
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    const consent = input('partner-consent')
    expect(document.activeElement).toBe(consent)
    expect(consent.getAttribute('aria-invalid')).toBe('true')
    expect(consent.getAttribute('aria-describedby')).toBe('partner-consent-error')
    expect(document.querySelector('#partner-consent-error')?.textContent).toContain('隐私政策')

    await change(consent, true)
    expect(consent.hasAttribute('aria-invalid')).toBe(false)
    expect(consent.hasAttribute('aria-describedby')).toBe(false)
    expect(document.querySelector('#partner-consent-error')).toBeNull()
  })

  it('announces pending stage two, preserves the submit name, and disables skip', async () => {
    let resolveDetails: (response: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/details')) return new Promise<Response>((resolve) => { resolveDetails = resolve })
      return new Response(JSON.stringify({ ok: true }), { status: 201 })
    }))
    await renderForm()
    await change(input('partner-name'), '申请人')
    await change(input('partner-phone'), '13800001111')
    const identity = document.querySelector('#partner-identity')
    if (!(identity instanceof HTMLSelectElement)) throw new Error('missing identity')
    await change(identity, 'local-operations')
    await change(input('partner-consent'), true)
    const firstForm = document.querySelector('form') as HTMLFormElement
    await act(async () => { firstForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })

    const secondForm = document.querySelector('form') as HTMLFormElement
    await act(async () => { secondForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
    expect(document.querySelector('[role="status"]')?.textContent).toContain('正在提交补充信息')
    const submit = document.querySelector('button[type="submit"]')
    const skip = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('暂不补充'))
    expect(submit?.getAttribute('aria-label')).toBe('正在提交补充信息')
    expect(skip?.hasAttribute('disabled')).toBe(true)

    resolveDetails(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await act(async () => { await Promise.resolve() })
  })
})
