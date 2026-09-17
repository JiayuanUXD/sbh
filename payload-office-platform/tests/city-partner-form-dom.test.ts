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

async function renderForm(options: { initialCity?: string; invalid?: boolean; lockCity?: boolean; unavailable?: string } = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(React.createElement(CityPartnerApplicationForm, {
      cities,
      initialCity: options.initialCity ?? 'shanghai',
      invalidExplicitCity: options.invalid ?? false,
      ...(options.unavailable ? { cityUnavailableMessage: options.unavailable } : {}),
      ...(options.lockCity ? { lockCity: true } : {}),
    }))
  })
  return container
}

function input(id: string): HTMLInputElement {
  const element = document.querySelector(`#${id}`)
  if (!(element instanceof HTMLInputElement)) throw new Error(`missing input ${id}`)
  return element
}

/** 填满第一步的姓名 / 手机号 / 身份；`consent` 为 true 时连隐私勾选一起打上。 */
async function fillStageOne(options: { consent?: boolean } = {}) {
  await change(input('partner-name'), '申请人')
  await change(input('partner-phone'), '13800001111')
  const identity = document.querySelector('#partner-identity')
  if (!(identity instanceof HTMLSelectElement)) throw new Error('missing identity')
  await change(identity, 'local-operations')
  if (options.consent) await change(input('partner-consent'), true)
}

/** 对当前渲染的 `<form>` 派发 submit（每次重新查询：第一步成功后会换成第二步的表单）。 */
async function submitForm() {
  const form = document.querySelector('form')
  if (!(form instanceof HTMLFormElement)) throw new Error('missing form')
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
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

  it('attributes a default-to-different city first interaction to the newly selected city once', async () => {
    await renderForm({ initialCity: 'shanghai' })
    const city = document.querySelector('#partner-city')
    if (!(city instanceof HTMLSelectElement)) throw new Error('missing city select')
    city.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(trackSpy).not.toHaveBeenCalled()
    await change(city, 'hangzhou')
    city.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(trackSpy).toHaveBeenCalledTimes(1)
    expect(trackSpy).toHaveBeenCalledWith('city_partner_application_started', {
      city_slug: 'hangzhou', stage: 'stage-one',
    })
  })

  it('focuses consent and exposes a stable error description only while invalid', async () => {
    await renderForm()
    await fillStageOne()
    await submitForm()

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
    await fillStageOne({ consent: true })
    await submitForm()
    await submitForm()
    expect(document.querySelector('[role="status"]')?.textContent).toContain('正在提交补充信息')
    const submit = document.querySelector('button[type="submit"]')
    const skip = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('暂不补充'))
    expect(submit?.getAttribute('aria-label')).toBe('正在提交补充信息')
    expect(skip?.hasAttribute('disabled')).toBe(true)

    resolveDetails(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    await act(async () => { await Promise.resolve() })
  })

  it('omits the city selector when the route locks the city, yet still submits that city', async () => {
    // OPT-101：城市路由的内嵌表单不再渲染「申请城市」（此前是一个 disabled 的下拉）。
    // 守两头：字段整个不在 DOM（不是 disabled / 视觉隐藏），且第一步请求体仍带路由的城市。
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ ok: true }), { status: 201 })
    }))
    await renderForm({ initialCity: 'hangzhou', lockCity: true })
    expect(document.querySelector('#partner-city')).toBeNull()
    expect(document.querySelector('select[name="city"]')).toBeNull()
    expect(document.body.textContent).not.toContain('申请城市')
    // 第一步只剩标题，不再带「此步成功保存后……」的引导句。
    expect(document.querySelector('.city-partner-form header h2')?.textContent).toBe('请留下联系信息')
    expect(document.querySelector('.city-partner-form header p')).toBeNull()

    await fillStageOne({ consent: true })
    await submitForm()

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ city: 'hangzhou', applicantName: '申请人', contactPhone: '13800001111' })
    expect(trackSpy).toHaveBeenCalledWith('city_partner_application_started', {
      city_slug: 'hangzhou', stage: 'stage-one',
    })
  })

  it('never dead-ends a locked form on the page-level city gates', async () => {
    // 锁城时页面级的「无效 ?city= / 默认城市不可申请」既无处显示、也没有交互能解除
    // cityBlocked。组合钉死为「锁城即不受城市门控」：提交按钮不灰、无城市错误、正常提交。
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }))
    vi.stubGlobal('fetch', fetchSpy)
    await renderForm({ initialCity: 'hangzhou', lockCity: true, invalid: true, unavailable: '当前默认城市暂不可申请' })
    expect(document.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(false)
    expect(document.body.textContent).not.toMatch(/链接中的城市无效|暂不可申请/)
    await fillStageOne({ consent: true })
    await submitForm()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the city selector on the global page where it is the only city entry', async () => {
    // `/city-partner` 不传 lockCity：选择器是那一面唯一的城市入口，不能随城市路由一起消失。
    await renderForm({ initialCity: 'shanghai' })
    const city = document.querySelector('#partner-city')
    expect(city).toBeInstanceOf(HTMLSelectElement)
    expect(city?.hasAttribute('disabled')).toBe(false)
  })
})
