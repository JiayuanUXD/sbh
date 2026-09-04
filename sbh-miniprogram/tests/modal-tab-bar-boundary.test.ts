import { describe, expect, it, vi } from 'vitest'

import { createModalTabBarBoundary } from '../miniprogram/utils/modal-tab-bar-boundary.js'

function deferred(): Readonly<{
  promise: Promise<void>
  resolve(): void
  reject(error: Error): void
}> {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('原生 TabBar 模态边界', () => {
  it('hide 尚未完成时 restore 会串行补偿，不会遗留隐藏状态', async () => {
    const hide = deferred()
    const calls: string[] = []
    const onChange = vi.fn()
    const boundary = createModalTabBarBoundary({
      hideTabBar: async () => { calls.push('hide:start'); await hide.promise; calls.push('hide:end') },
      showTabBar: async () => { calls.push('show') },
      onChange,
    })

    const opening = boundary.hide()
    const restoring = boundary.restore()
    hide.resolve()

    await expect(opening).resolves.toBe(false)
    await restoring
    expect(calls).toEqual(['hide:start', 'hide:end', 'show'])
    expect(boundary.snapshot()).toEqual({ desired: 'visible', actual: 'visible' })
    expect(onChange).toHaveBeenLastCalledWith('visible')
  })

  it('restore 期间再次 hide 时以最后意图为准', async () => {
    const show = deferred()
    const calls: string[] = []
    const boundary = createModalTabBarBoundary({
      hideTabBar: async () => { calls.push('hide') },
      showTabBar: async () => { calls.push('show:start'); await show.promise; calls.push('show:end') },
    })

    await expect(boundary.hide()).resolves.toBe(true)
    const restoring = boundary.restore()
    const reopening = boundary.hide()
    show.resolve()

    await restoring
    await expect(reopening).resolves.toBe(true)
    expect(calls).toEqual(['hide', 'show:start', 'show:end', 'hide'])
    expect(boundary.snapshot()).toEqual({ desired: 'hidden', actual: 'hidden' })
  })

  it('原生 hide 失败时 fail-closed 为可见且返回 false', async () => {
    const boundary = createModalTabBarBoundary({
      hideTabBar: async () => { throw new Error('hide failed') },
      showTabBar: async () => undefined,
    })

    await expect(boundary.hide()).resolves.toBe(false)
    expect(boundary.snapshot()).toEqual({ desired: 'visible', actual: 'visible' })
  })
})
