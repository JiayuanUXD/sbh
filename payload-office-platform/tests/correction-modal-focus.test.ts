// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const trackSpy = vi.hoisted(() => vi.fn())
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
vi.mock('@/lib/frontend/analytics', () => ({ track: trackSpy }))

import CorrectionModal from '@/components/frontend/CorrectionModal'

/**
 * 守护「加载即抢焦点」缺陷：
 * 详情页首次渲染（用户零交互）时，纠错触发按钮不得成为 document.activeElement，
 * 否则页面中部会常驻 :focus-visible 蓝框，且键盘用户的 Tab 起点被劫持。
 * 归还焦点只应发生在「由 open=true 变为 false」时。
 */

let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  trackSpy.mockReset()
  vi.restoreAllMocks()
})

async function renderModal() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      React.createElement(CorrectionModal, {
        targetType: 'listing' as const,
        targetSlug: 'jingan-serviced-office-42-seats',
        targetSummary: '静安服务式办公 42 工位',
      }),
    )
  })
  const trigger = container.querySelector('button')
  if (!trigger) throw new Error('触发按钮未渲染')
  return { container, trigger }
}

describe('CorrectionModal 焦点归还时机', () => {
  it('首次挂载不调用 focus()，触发按钮不抢焦点', async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')

    const { trigger } = await renderModal()

    expect(focusSpy).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body)
    expect(document.activeElement).not.toBe(trigger)
  })

  it('弹层由打开变为关闭时，焦点归还触发按钮', async () => {
    const { trigger } = await renderModal()

    await act(async () => trigger.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    const closeButton = document.querySelector<HTMLButtonElement>('.modal__close')
    if (!closeButton) throw new Error('关闭按钮未渲染')
    await act(async () => closeButton.click())

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
