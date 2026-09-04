import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import ts from 'typescript'

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
const componentScriptPath = resolve(componentRoot, 'listing-card', 'index.ts')
const simulatedScriptPath = resolve(componentRoot, 'listing-card', 'index.js')
const componentTemplatePath = resolve(componentRoot, 'listing-card', 'index.wxml')
const componentStylePath = resolve(componentRoot, 'listing-card', 'index.wxss')
const require = createRequire(import.meta.url)
const jsdom: JsdomModule = require('jsdom')
const originalGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>()
let simulate: typeof Simulate
let dom: TestDom
let listingCardId: string

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

function prepareComponentScript(): void {
  const output = ts.transpileModule(
    readFileSync(componentScriptPath, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  writeFileSync(simulatedScriptPath, output)
}

function renderHost(
  data: Record<string, unknown>,
  methods: Record<string, (this: HostMethodContext, event: { detail: { slug: string } }) => void> = {},
): Simulate.RootComponent<WechatMiniprogram.Component.DataOption, WechatMiniprogram.Component.PropertyOption, WechatMiniprogram.Component.MethodOption> {
  const componentId = listingCardId
  const hostId = simulate.load({
    template: '<listing-card id="subject" listing="{{item}}" bindopen="onOpen" />',
    data,
    methods,
    usingComponents: { 'listing-card': componentId },
  })
  const host = simulate.render(hostId)
  host.attach(dom.window.document.body)
  return host
}

const item = {
  id: 'listing-101',
  slug: 'jing-an-center-101',
  title: '静安中心 101 室，精装带家具',
  imageUrl: 'https://cdn.example/jing-an-center.jpg',
  imageAlt: '静安中心外观',
  primaryPrice: '约 ¥36,500/月',
  secondaryPrice: '4.5 元/㎡/天',
  facts: '1,860 ㎡ · 120 席 · 传统办公',
  location: '静安区 · 静安中心',
  tags: ['近地铁', '精装修', '可注册'],
}

beforeAll(() => {
  dom = new jsdom.JSDOM('<!doctype html><html><body></body></html>')
  replaceGlobal('window', dom.window)
  replaceGlobal('document', dom.window.document)
  replaceGlobal('Event', dom.window.Event)
  replaceGlobal('CustomEvent', dom.window.CustomEvent)
  simulate = require('miniprogram-simulate')
  prepareComponentScript()
  listingCardId = simulate.load(resolve(componentRoot, 'listing-card', 'index'), {
    compiler: 'simulate',
    rootPath: componentRoot,
  })
})

afterAll(() => {
  dom.window.close()
  if (existsSync(simulatedScriptPath)) {
    rmSync(simulatedScriptPath)
  }
  restoreGlobals()
})

describe('listing-card', () => {
  it('渲染左图右文、两行标题、价格和至多三枚中性标签', () => {
    const host = renderHost({ item: { ...item, tags: [...item.tags, '高区景观'] } })
    const subject = host.querySelector('#subject')
    const card = subject?.querySelectorAll('.listing-card')[0]
    const media = subject?.querySelectorAll('.listing-card__media')[0]
    const body = subject?.querySelectorAll('.listing-card__body')[0]
    const title = subject?.querySelectorAll('.listing-card__title')[0]
    const price = subject?.querySelectorAll('.listing-card__price')[0]
    const quote = subject?.querySelectorAll('.listing-card__quote')[0]

    expect(subject?.querySelectorAll('.listing-card')).toHaveLength(1)
    expect(media).toBeDefined()
    expect(body).toBeDefined()
    expect(title?.dom?.textContent).toContain(item.title)
    expect(price?.dom?.textContent).toContain(item.primaryPrice)
    expect(quote?.dom?.textContent).toContain(item.secondaryPrice)
    expect(subject?.querySelectorAll('.listing-card__tag')).toHaveLength(3)
    expect(subject?.querySelectorAll('.listing-card__image')[0]).toBeDefined()

    const attributes = card?.toJSON().attrs ?? []
    expect(attributes).toContainEqual({ name: 'hover-class', value: 'listing-card--pressed' })
    expect(attributes).toContainEqual({ name: 'hover-start-time', value: '70' })
    expect(attributes).toContainEqual({ name: 'hover-stay-time', value: '120' })
    host.detach()
  })

  it('图片失败后显示文字占位，点击仍携带 slug', async () => {
    const host = renderHost(
      { item, openedSlug: '' },
      {
        onOpen(event) {
          this.setData({ openedSlug: event.detail.slug })
        },
      },
    )
    const subject = host.querySelector('#subject')
    const image = subject?.querySelectorAll('.listing-card__image')[0]
    const card = subject?.querySelectorAll('.listing-card')[0]

    image?.dispatchEvent('error')
    await simulate.sleep(0)
    card?.dispatchEvent('tap')
    await simulate.sleep(0)

    expect(subject?.data.imageFailed).toBe(true)
    expect(subject?.querySelectorAll('.listing-card__placeholder')[0]?.dom?.textContent).toContain('尚办好')
    expect(host.data.openedSlug).toBe('jing-an-center-101')
    host.detach()
  })

  it('切换到新 slug 或图片后重置图片失败状态并重新显示图片', async () => {
    const host = renderHost({ item })
    const subject = host.querySelector('#subject')
    const firstImage = subject?.querySelectorAll('.listing-card__image')[0]

    firstImage?.dispatchEvent('error')
    await simulate.sleep(0)
    expect(subject?.data.imageFailed).toBe(true)

    host.setData({
      item: {
        ...item,
        slug: 'jing-an-center-102',
        imageUrl: 'https://cdn.example/jing-an-center-102.jpg',
      },
    })
    await simulate.sleep(0)

    expect(subject?.data.imageFailed).toBe(false)
    expect(subject?.querySelectorAll('.listing-card__image')[0]?.toJSON().attrs).toContainEqual({
      name: 'src',
      value: 'https://cdn.example/jing-an-center-102.jpg',
    })
    expect(subject?.querySelectorAll('.listing-card__placeholder')).toHaveLength(0)
    host.detach()
  })

  it('非数组标签降级为空，超过三枚时防御性截断', () => {
    const host = renderHost({ item: { ...item, tags: 'invalid-tags' } })
    const subject = host.querySelector('#subject')

    expect(subject?.data.displayTags).toEqual([])
    expect(subject?.querySelectorAll('.listing-card__tag')).toHaveLength(0)
    host.detach()
  })

  it('WXML 与 WXSS 锁定紧凑卡片、按压时序和中性标签合同', () => {
    const template = readFileSync(componentTemplatePath, 'utf8')
    const styles = readFileSync(componentStylePath, 'utf8')

    expect(template).toContain('hover-start-time="70"')
    expect(template).toContain('hover-stay-time="120"')
    expect(template).toMatch(/listing-card__price-row[\s\S]*listing-card__price[\s\S]*listing-card__quote/)
    expect(template).toContain('wx:for="{{displayTags}}"')
    expect(styles).toMatch(/\.listing-card \{[\s\S]*height: 216rpx;[\s\S]*min-height: var\(--sbh-size-touch-target\);[\s\S]*overflow: hidden;/)
    expect(styles).toMatch(/\.listing-card \{[\s\S]*transition: background var\(--sbh-motion-interaction-duration\) ease, transform var\(--sbh-motion-interaction-duration\) ease;/)
    expect(styles).toMatch(/\.listing-card__media \{[\s\S]*width: 224rpx;[\s\S]*height: 168rpx;/)
    expect(styles).toMatch(/\.listing-card__title \{[\s\S]*-webkit-line-clamp: 2;/)
    expect(styles).toMatch(/\.listing-card__tag \{[\s\S]*color: var\(--sbh-text-secondary\);[\s\S]*background: var\(--sbh-surface-pressed\);/)
    expect(styles).toMatch(/\.listing-card__price[\s\S]*\.listing-card__quote[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/)
  })
})
