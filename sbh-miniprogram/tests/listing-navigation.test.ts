import { describe, expect, it } from 'vitest'

import {
  createListingNavigation,
  type NavigateToOptions,
  type SwitchTabOptions,
} from '../miniprogram/services/listing-navigation.js'

function captureTransport() {
  const calls: SwitchTabOptions[] = []
  return {
    calls,
    transport(options: SwitchTabOptions) {
      calls.push(options)
    },
  }
}

function captureDetailTransport() {
  const calls: NavigateToOptions[] = []
  return {
    calls,
    transport(options: NavigateToOptions) {
      calls.push(options)
    },
  }
}

describe('列表 tab 导航状态', () => {
  it('保存 canonical query，switchTab 不带 query，且 query 只能消费一次', async () => {
    const captured = captureTransport()
    const navigation = createListingNavigation(captured.transport)
    const opened = navigation.open('page=1&q=%20%E5%8D%97%E4%BA%AC%E8%A5%BF%E8%B7%AF%20')

    expect(captured.calls).toHaveLength(1)
    expect(captured.calls[0]?.url).toBe('/pages/listings/index')
    captured.calls[0]?.success()
    await expect(opened).resolves.toBeUndefined()
    expect(navigation.consume()).toBe('q=%E5%8D%97%E4%BA%AC%E8%A5%BF%E8%B7%AF')
    expect(navigation.consume()).toBeNull()
  })

  it('空 query 仍保存为明确的无筛选导航', async () => {
    const captured = captureTransport()
    const navigation = createListingNavigation(captured.transport)
    const opened = navigation.open('')

    captured.calls[0]?.success()
    await opened
    expect(navigation.consume()).toBe('')
    expect(navigation.consume()).toBeNull()
  })

  it('switchTab 失败时清除本次 pending 并拒绝 open', async () => {
    const captured = captureTransport()
    const navigation = createListingNavigation(captured.transport)
    const opened = navigation.open('district=jingan')
    const failure = new Error('transport secret')

    captured.calls[0]?.fail(failure)
    await expect(opened).rejects.toBe(failure)
    expect(navigation.consume()).toBeNull()
  })

  it('较旧 open 失败时不清除较新的 pending query', async () => {
    const captured = captureTransport()
    const navigation = createListingNavigation(captured.transport)
    const older = navigation.open('q=older')
    const newer = navigation.open('q=newer')

    captured.calls[0]?.fail(new Error('older failed'))
    await expect(older).rejects.toThrow('older failed')
    expect(navigation.consume()).toBe('q=newer')

    captured.calls[1]?.success()
    await expect(newer).resolves.toBeUndefined()
  })

  it('安全 slug 只导航到详情页且 URL 不携带其他查询', async () => {
    const tabs = captureTransport()
    const details = captureDetailTransport()
    const navigation = createListingNavigation(tabs.transport, details.transport)
    const opened = navigation.openDetail('jing-an-tower-101')

    expect(details.calls).toHaveLength(1)
    expect(details.calls[0]?.url).toBe('/pages/listing-detail/index?slug=jing-an-tower-101')
    expect(details.calls[0]?.url).not.toMatch(/phone|token|submission|city/)
    details.calls[0]?.success()
    await expect(opened).resolves.toBeUndefined()
    expect(tabs.calls).toHaveLength(0)
  })

  it.each(['', '../secret', 'UPPER-CASE', 'has space', 'a/b', 'a%2fb'])(
    '拒绝不安全详情 slug %s 且不调用 navigateTo',
    async (slug) => {
      const details = captureDetailTransport()
      const navigation = createListingNavigation(captureTransport().transport, details.transport)

      await expect(navigation.openDetail(slug)).rejects.toThrow('房源标识无效')
      expect(details.calls).toHaveLength(0)
    },
  )

  it('navigateTo 失败或同步抛错时拒绝 openDetail', async () => {
    const details = captureDetailTransport()
    const navigation = createListingNavigation(captureTransport().transport, details.transport)
    const failure = new Error('navigate failed secret')
    const opened = navigation.openDetail('jing-an-tower-101')

    details.calls[0]?.fail(failure)
    await expect(opened).rejects.toBe(failure)

    const throwing = createListingNavigation(captureTransport().transport, () => {
      throw failure
    })
    await expect(throwing.openDetail('jing-an-tower-102')).rejects.toBe(failure)
  })
})
