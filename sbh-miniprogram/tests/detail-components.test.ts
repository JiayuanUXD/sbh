import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type * as Simulate from 'miniprogram-simulate'

type RootComponent = Simulate.RootComponent<
  WechatMiniprogram.Component.DataOption,
  WechatMiniprogram.Component.PropertyOption,
  WechatMiniprogram.Component.MethodOption
>

type AttachTarget = Parameters<RootComponent['attach']>[0]

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

const projectRoot = resolve(import.meta.dirname, '..')
const componentRoot = resolve(projectRoot, 'miniprogram/components')
const componentNames = ['detail-gallery', 'monthly-cost-card', 'spec-grid'] as const
const require = createRequire(import.meta.url)
const jsdom: JsdomModule = require('jsdom')
const originalGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>()
let simulate: typeof Simulate
let dom: TestDom
const componentIds = new Map<typeof componentNames[number], string>()

function replaceGlobal(key: PropertyKey, value: unknown): void {
  originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

function restoreGlobals(): void {
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
}

function componentFile(name: typeof componentNames[number], extension: string): string {
  return resolve(componentRoot, name, `index.${extension}`)
}

function readComponent(name: typeof componentNames[number], extension: string): string {
  return readFileSync(componentFile(name, extension), 'utf8')
}

function prepareScripts(): void {
  for (const name of componentNames) {
    const output = ts.transpileModule(readComponent(name, 'ts'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    writeFileSync(componentFile(name, 'js'), output)
  }
}

function render(
  name: typeof componentNames[number],
  template: string,
  data: Record<string, unknown>,
): RootComponent {
  let childId = componentIds.get(name)
  if (!childId) {
    childId = simulate.load(resolve(componentRoot, name, 'index'), {
      compiler: 'simulate',
      rootPath: componentRoot,
    })
    componentIds.set(name, childId)
  }
  const hostId = simulate.load({
    template,
    data,
    usingComponents: { [name]: childId },
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
  prepareScripts()
})

afterAll(() => {
  for (const name of componentNames) {
    const script = componentFile(name, 'js')
    if (existsSync(script)) rmSync(script)
  }
  dom?.window.close()
  restoreGlobals()
})

describe('detail-gallery', () => {
  const images = [
    { src: 'https://cdn.example/one.jpg', alt: '大堂' },
    { src: 'https://cdn.example/two.jpg', alt: '办公区' },
  ]

  it('使用原生 swiper、稳定宽高比和页码，且明确禁止自动轮播', () => {
    const host = render(
      'detail-gallery',
      '<detail-gallery id="subject" images="{{images}}" />',
      { images },
    )
    const subject = host.querySelector('#subject')

    expect(subject?.data.displayImages).toEqual(images)
    expect(subject?.querySelectorAll('.detail-gallery__swiper')).toHaveLength(1)
    expect(subject?.querySelectorAll('.detail-gallery__item')).toHaveLength(2)
    expect(subject?.querySelector('.detail-gallery__counter')?.dom?.textContent).toContain('1 / 2')
    expect(readComponent('detail-gallery', 'wxml')).toMatch(/<swiper[\s\S]*autoplay="\{\{false\}\}"/)
    expect(readComponent('detail-gallery', 'wxss')).toMatch(/height:\s*auto;[\s\S]*aspect-ratio:\s*4\s*\/\s*3;/)
    host.detach()
  })

  it('单张图片失败显示占位，切换新数据会重置失败状态和页码', async () => {
    const host = render(
      'detail-gallery',
      '<detail-gallery id="subject" images="{{images}}" />',
      { images },
    )
    const subject = host.querySelector('#subject')

    subject?.querySelector('.detail-gallery__swiper')?.dispatchEvent('change', {
      detail: { current: 1 },
    })
    await simulate.sleep(0)
    expect(subject?.data.current).toBe(1)
    expect(subject?.querySelector('.detail-gallery__counter')?.dom?.textContent).toContain('2 / 2')

    subject?.querySelector('.detail-gallery__image')?.dispatchEvent('error')
    await simulate.sleep(0)
    expect(subject?.querySelector('.detail-gallery__placeholder')?.dom?.textContent).toContain('尚办好')
    expect(subject?.data.failedImages).toEqual([true])

    host.setData({ images: [{ src: 'https://cdn.example/new.jpg', alt: '新房源' }] })
    await simulate.sleep(0)

    expect(subject?.data.failedImages).toEqual([])
    expect(subject?.data.current).toBe(0)
    expect(subject?.querySelector('.detail-gallery__image')).toBeDefined()
    expect(subject?.querySelector('.detail-gallery__counter')?.dom?.textContent).toContain('1 / 1')
    host.detach()
  })
})

describe('monthly-cost-card', () => {
  it('固定呈现三项 API 金额、包含标签和原始计算条件', () => {
    const cost = {
      rent: '¥25,500',
      propertyFee: '¥2,800',
      total: '¥25,500',
      inclusionLabel: '物业费已包含',
      assumptions: ['日租按 30 天折算月租', '物业费已包含在租金中，不重复加总'],
    }
    const host = render(
      'monthly-cost-card',
      '<monthly-cost-card id="subject" cost="{{cost}}" />',
      { cost },
    )
    const subject = host.querySelector('#subject')

    expect(subject?.querySelector('.monthly-cost-card__rent')?.dom?.textContent).toContain('¥25,500')
    expect(subject?.querySelector('.monthly-cost-card__property-fee')?.dom?.textContent).toContain('¥2,800')
    expect(subject?.querySelector('.monthly-cost-card__total')?.dom?.textContent).toContain('¥25,500')
    expect(subject?.querySelector('.monthly-cost-card__inclusion')?.dom?.textContent).toContain('物业费已包含')
    expect(subject?.querySelectorAll('.monthly-cost-card__assumption')).toHaveLength(2)
    host.detach()
  })
})

describe('spec-grid', () => {
  const items = [
    { id: 'area', label: '面积', value: '100 ㎡', estimated: false },
    { id: 'seats', label: '工位', value: '—', estimated: false },
    { id: 'type', label: '类型', value: '传统办公', estimated: false },
    {
      id: 'delivery',
      label: '交付标准',
      value: '精装修并配备可容纳跨部门协作与访客接待的完整办公家具',
      estimated: true,
    },
  ]

  it('固定四列且空值格不塌缩，长中文仍完整进入 DOM', () => {
    const host = render(
      'spec-grid',
      '<spec-grid id="subject" items="{{items}}" />',
      { items },
    )
    const subject = host.querySelector('#subject')

    expect(subject?.querySelectorAll('.spec-grid__item')).toHaveLength(4)
    expect(subject?.querySelectorAll('.spec-grid__value')[1]?.dom?.textContent).toContain('—')
    expect(subject?.querySelectorAll('.spec-grid__value')[3]?.dom?.textContent).toContain(items[3]?.value)
    expect(subject?.querySelectorAll('.spec-grid__estimated')).toHaveLength(1)
    host.detach()
  })

  it('字体放大与 Android 窄屏下保留四列并允许长中文换行、不横向溢出', () => {
    const styles = readComponent('spec-grid', 'wxss')

    expect(styles).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/)
    expect(styles).toMatch(/\.spec-grid__item\s*\{[\s\S]*?min-width:\s*0;/)
    expect(styles).toMatch(/\.spec-grid__value\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?word-break:\s*break-word;/)
    expect(styles).not.toMatch(/\.spec-grid(?:__item|__value)?\s*\{[\s\S]*?white-space:\s*nowrap;/)
    expect(styles).not.toMatch(/\.spec-grid(?:__item|__value)?\s*\{[\s\S]*?height:\s*\d/)
  })
})

describe('详情组件视觉与触达合同', () => {
  it('卡片、图片和标签分别使用 8px、6px、3px token', () => {
    expect(readComponent('monthly-cost-card', 'wxss')).toMatch(/\.monthly-cost-card\s*\{[\s\S]*?border-radius:\s*var\(--sbh-shape-surface-radius\);/)
    expect(readComponent('spec-grid', 'wxss')).toMatch(/\.spec-grid\s*\{[\s\S]*?border-radius:\s*var\(--sbh-shape-surface-radius\);/)
    expect(readComponent('detail-gallery', 'wxss')).toMatch(/\.detail-gallery__media\s*\{[\s\S]*?border-radius:\s*var\(--sbh-shape-control-radius\);/)
    expect(readComponent('monthly-cost-card', 'wxss')).toMatch(/\.monthly-cost-card__inclusion\s*\{[\s\S]*?border-radius:\s*var\(--sbh-shape-label-radius\);/)
  })

  it('可滑动画廊至少 44px，全部数字采用等宽数字', () => {
    expect(readComponent('detail-gallery', 'wxss')).toMatch(/\.detail-gallery__swiper\s*\{[\s\S]*?min-height:\s*var\(--sbh-size-touch-target\);/)

    for (const name of componentNames) {
      expect(readComponent(name, 'wxml'), `${name} 缺少 num 标记`).toContain(' num')
      expect(readComponent(name, 'wxss'), `${name} 缺少等宽数字`).toMatch(/\.num\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/)
    }
  })

  it('三个组件均限制在父级宽度内并以 border-box 计算窄屏宽度', () => {
    for (const name of componentNames) {
      const styles = readComponent(name, 'wxss')
      expect(styles, `${name} 未限制窄屏宽度`).toMatch(/max-width:\s*100%;/)
      expect(styles, `${name} 未使用 border-box`).toMatch(/box-sizing:\s*border-box;/)
    }
  })
})
