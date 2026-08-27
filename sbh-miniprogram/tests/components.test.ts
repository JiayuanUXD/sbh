import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type * as Simulate from 'miniprogram-simulate'

type AttachTarget = Parameters<
  Simulate.RootComponent<
    WechatMiniprogram.Component.DataOption,
    WechatMiniprogram.Component.PropertyOption,
    WechatMiniprogram.Component.MethodOption
  >['attach']
>[0]

interface TestDom {
  window: {
    document: { body: AttachTarget }
    Event: unknown
    CustomEvent: unknown
    close(): void
  }
}

interface JsdomModule {
  JSDOM: new (html?: string) => TestDom
}

interface HostMethodContext {
  data: Record<string, unknown>
  setData(data: Record<string, unknown>): void
}

const projectRoot = resolve(import.meta.dirname, '..')
const componentRoot = resolve(projectRoot, 'miniprogram/components')
const require = createRequire(import.meta.url)
const jsdom: JsdomModule = require('jsdom')
const originalGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>()
let simulate: typeof Simulate
let dom: TestDom
const loadedComponents = new Map<string, string>()

function replaceGlobal(key: PropertyKey, value: unknown): void {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  })
}

function restoreGlobals(): void {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor)
    } else {
      Reflect.deleteProperty(globalThis, key)
    }
  }
}

function loadComponent(name: string): string {
  const loaded = loadedComponents.get(name)
  if (loaded) {
    return loaded
  }

  const basePath = resolve(componentRoot, name, 'index')
  const componentId = simulate.load(basePath, { compiler: 'simulate', rootPath: componentRoot })
  loadedComponents.set(name, componentId)
  return componentId
}

function renderHost(
  childName: string,
  template: string,
  data: Record<string, unknown>,
  methods: Record<string, (this: HostMethodContext) => void> = {},
): Simulate.RootComponent<WechatMiniprogram.Component.DataOption, WechatMiniprogram.Component.PropertyOption, WechatMiniprogram.Component.MethodOption> {
  const childId = loadComponent(childName)
  const hostId = simulate.load({
    template,
    data,
    methods,
    usingComponents: {
      [childName]: childId,
    },
  })
  const host = simulate.render(hostId)
  host.attach(dom.window.document.body)
  return host
}

beforeAll(() => {
  dom = new jsdom.JSDOM('<!doctype html><html><body></body></html>')
  replaceGlobal('window', dom.window)
  replaceGlobal('document', dom.window.document)
  replaceGlobal('Event', dom.window.Event)
  replaceGlobal('CustomEvent', dom.window.CustomEvent)

  simulate = require('miniprogram-simulate')
})

afterAll(() => {
  dom.window.close()
  restoreGlobals()
})

describe('sbh-button', () => {
  it('默认渲染 primary 按钮并触发 tap', async () => {
    const host = renderHost(
      'sbh-button',
      '<sbh-button id="subject" bindtap="onTap">查看方案</sbh-button>',
      { tapCount: 0 },
      {
        onTap() {
          this.setData({ tapCount: Number(this.data.tapCount) + 1 })
        },
      },
    )
    const subject = host.querySelector('#subject')
    const control = subject?.querySelector('.sbh-button')

    expect(subject?.data.variant).toBe('primary')
    expect(control).toBeDefined()
    control?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.tapCount).toBe(1)
    host.detach()
  })

  it('secondary 使用规范化后的变体和受控 hover', () => {
    const host = renderHost(
      'sbh-button',
      '<sbh-button id="subject" variant="secondary">次要操作</sbh-button>',
      {},
    )
    const subject = host.querySelector('#subject')
    const control = subject?.querySelector('.sbh-button')
    const attributes = control?.toJSON().attrs ?? []

    expect(subject?.data.resolvedVariant).toBe('secondary')
    expect(control?.dom?.className).toContain('sbh-button--secondary')
    expect(attributes).toContainEqual({ name: 'hover-class', value: 'sbh-button--pressed' })
    expect(attributes).toContainEqual({ name: 'hover-stay-time', value: '70' })
    host.detach()
  })

  it('非法 variant 只规范化展示值，不回写 property 形成 observer 循环', () => {
    const host = renderHost(
      'sbh-button',
      '<sbh-button id="subject" variant="danger">操作</sbh-button>',
      {},
    )
    const subject = host.querySelector('#subject')

    expect(subject?.data.variant).toBe('danger')
    expect(subject?.data.resolvedVariant).toBe('primary')
    expect(subject?.querySelector('.sbh-button')?.dom?.className).toContain('sbh-button--primary')
    host.detach()
  })

  it('disabled 按钮显示不可用提示且不触发 tap', async () => {
    const host = renderHost(
      'sbh-button',
      '<sbh-button id="subject" disabled bindtap="onTap">查看方案</sbh-button>',
      { tapCount: 0 },
      {
        onTap() {
          this.setData({ tapCount: Number(this.data.tapCount) + 1 })
        },
      },
    )
    const subject = host.querySelector('#subject')
    const attributes = subject?.querySelector('.sbh-button')?.toJSON().attrs ?? []

    subject?.querySelector('.sbh-button')?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.tapCount).toBe(0)
    expect(attributes).toContainEqual({ name: 'hover-class', value: 'none' })
    expect(subject?.querySelector('.sbh-button__status')?.dom?.textContent).toContain('不可用')
    host.detach()
  })

  it('loading 按钮显示处理中提示且不触发 tap', async () => {
    const host = renderHost(
      'sbh-button',
      '<sbh-button id="subject" loading bindtap="onTap">提交</sbh-button>',
      { tapCount: 0 },
      {
        onTap() {
          this.setData({ tapCount: Number(this.data.tapCount) + 1 })
        },
      },
    )
    const subject = host.querySelector('#subject')
    const attributes = subject?.querySelector('.sbh-button')?.toJSON().attrs ?? []

    subject?.querySelector('.sbh-button')?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.tapCount).toBe(0)
    expect(attributes).toContainEqual({ name: 'hover-class', value: 'none' })
    expect(subject?.querySelector('.sbh-button__status')?.dom?.textContent).toContain('处理中')
    host.detach()
  })
})

describe('sbh-card', () => {
  it('真实加载为单层白卡并透传 slot 内容', () => {
    const host = renderHost(
      'sbh-card',
      '<sbh-card id="subject"><view class="slot-content">卡片内容</view></sbh-card>',
      {},
    )
    const subject = host.querySelector('#subject')

    expect(subject?.querySelectorAll('.sbh-card')).toHaveLength(1)
    expect(subject?.dom?.textContent).toContain('卡片内容')
    host.detach()
  })
})

describe('sbh-skeleton', () => {
  it('按 rows 渲染骨架行并可选媒体占位', () => {
    const host = renderHost(
      'sbh-skeleton',
      '<sbh-skeleton id="subject" rows="3" with-media />',
      {},
    )
    const subject = host.querySelector('#subject')

    expect(subject?.querySelectorAll('.sbh-skeleton__row')).toHaveLength(3)
    expect(subject?.querySelector('.sbh-skeleton__media')).toBeDefined()
    host.detach()
  })

  it('支持非默认 rows 且 withMedia=false 不渲染媒体', () => {
    const host = renderHost(
      'sbh-skeleton',
      '<sbh-skeleton id="subject" rows="5" />',
      {},
    )
    const subject = host.querySelector('#subject')

    expect(subject?.querySelectorAll('.sbh-skeleton__row')).toHaveLength(5)
    expect(subject?.querySelector('.sbh-skeleton__media')).toBeUndefined()
    host.detach()
  })
})

describe('sbh-state', () => {
  it('error 操作触发 retry 事件', async () => {
    const host = renderHost(
      'sbh-state',
      '<sbh-state id="subject" kind="error" title="加载失败" action-label="重试" bindretry="onRetry" />',
      { retryCount: 0 },
      {
        onRetry() {
          this.setData({ retryCount: Number(this.data.retryCount) + 1 })
        },
      },
    )
    const subject = host.querySelector('#subject')
    const action = subject?.querySelector('.sbh-state__action')
    const attributes = action?.toJSON().attrs ?? []

    action?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.retryCount).toBe(1)
    expect(attributes).toContainEqual({ name: 'hover-class', value: 'sbh-state__action--pressed' })
    expect(attributes).toContainEqual({ name: 'hover-stay-time', value: '70' })
    host.detach()
  })

  it('empty 与 loading 具有可见的非颜色状态文字', () => {
    const emptyHost = renderHost(
      'sbh-state',
      '<sbh-state id="subject" kind="empty" title="暂无内容" />',
      {},
    )
    const loadingHost = renderHost(
      'sbh-state',
      '<sbh-state id="subject" kind="loading" title="正在加载" />',
      {},
    )

    expect(emptyHost.querySelector('#subject')?.querySelector('.sbh-state__marker')?.dom?.textContent).toContain('暂无')
    expect(loadingHost.querySelector('#subject')?.querySelector('.sbh-state__marker')?.dom?.textContent).toContain('加载中')
    emptyHost.detach()
    loadingHost.detach()
  })

  it('非法 kind 规范化为 empty，且不回写 property', () => {
    const host = renderHost(
      'sbh-state',
      '<sbh-state id="subject" kind="success" title="未知状态" />',
      {},
    )
    const subject = host.querySelector('#subject')

    expect(subject?.data.kind).toBe('success')
    expect(subject?.data.resolvedKind).toBe('empty')
    expect(subject?.querySelector('.sbh-state__marker')?.dom?.textContent).toContain('暂无')
    host.detach()
  })
})
