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

interface HostMethodContext {
  data: Record<string, unknown>
  setData(data: Record<string, unknown>): void
}

interface HostEvent {
  detail: Record<string, unknown>
}

interface FilterSheetMethods {
  handleDistrict(event: WechatMiniprogram.BaseEvent): void
  handleType(event: WechatMiniprogram.BaseEvent): void
  handlePriceUnit(event: WechatMiniprogram.BaseEvent): void
  handleAvailableBefore(event: WechatMiniprogram.CustomEvent<{ value: string }>): void
  handleApply(): void
}

const projectRoot = resolve(import.meta.dirname, '..')
const componentRoot = resolve(projectRoot, 'miniprogram/components')
const domainRoot = resolve(projectRoot, 'miniprogram/domain')
const filterBarRoot = resolve(componentRoot, 'filter-bar')
const filterSheetRoot = resolve(componentRoot, 'filter-sheet')
const generatedPaths = [
  resolve(filterBarRoot, 'index.js'),
  resolve(filterSheetRoot, 'index.js'),
]
const require = createRequire(import.meta.url)
const jsdom: JsdomModule = require('jsdom')
const originalGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>()
let simulate: typeof Simulate
let dom: TestDom
let filterBarId: string
let filterSheetId: string

const originalQuery = {
  district: ['jingan'],
  priceMin: 3,
  priceMax: 7,
  priceUnit: 'rmb-sqm-day',
  sort: 'recommended',
  page: 3,
}

const filters = [
  {
    id: 'district',
    label: '区域',
    options: [
      { value: 'jingan', label: '静安区', count: 12 },
      { value: 'xuhui', label: '徐汇区', count: 9 },
    ],
  },
  {
    id: 'listingType',
    label: '类型',
    options: [
      { value: 'traditional-office', label: '传统办公', count: 18 },
      { value: 'coworking', label: '联合办公', count: 3 },
    ],
  },
  {
    id: 'priceUnit',
    label: '计价单位',
    options: [
      { value: 'rmb-sqm-day', label: '元/㎡/天', count: 14 },
      { value: 'rmb-month', label: '元/月', count: 7 },
    ],
  },
] as const

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

function transpileComponent(sourcePath: string, outputPath: string): void {
  const domainSource = readFileSync(resolve(domainRoot, 'listing-query.ts'), 'utf8')
    .replace(/^export /gm, '')
  const componentSource = readFileSync(sourcePath, 'utf8')
    .replace(/import(?:\s+type)?\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*/g, '')
  const catalogType = `
    type MiniQuickFilter = Readonly<{
      id: 'district' | 'listingType' | 'priceUnit'
      label: string
      options: readonly Readonly<{ value: string; label: string; count: number }>[]
    }>
  `
  const output = ts.transpileModule(
    `${domainSource}\n${catalogType}\n${componentSource}`,
    { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  writeFileSync(outputPath, output)
}

function prepareComponentScripts(): void {
  transpileComponent(resolve(filterBarRoot, 'index.ts'), resolve(filterBarRoot, 'index.js'))
  transpileComponent(resolve(filterSheetRoot, 'index.ts'), resolve(filterSheetRoot, 'index.js'))
}

function renderHost(
  template: string,
  data: Record<string, unknown>,
  methods: Record<string, (this: HostMethodContext, event: HostEvent) => void> = {},
): RootComponent {
  const hostId = simulate.load({
    template,
    data,
    methods,
    usingComponents: {
      'filter-bar': filterBarId,
      'filter-sheet': filterSheetId,
    },
  })
  const host = simulate.render(hostId)
  host.attach(dom.window.document.body)
  return host
}

function findByText(subject: RootComponent, selector: string, text: string) {
  return subject.querySelectorAll(selector).find((node) => node.dom?.textContent?.includes(text))
}

function datasetEvent(value: string): WechatMiniprogram.BaseEvent {
  return {
    currentTarget: { dataset: { value } },
  } as unknown as WechatMiniprogram.BaseEvent
}

beforeAll(() => {
  dom = new jsdom.JSDOM('<!doctype html><html><body></body></html>')
  replaceGlobal('window', dom.window)
  replaceGlobal('document', dom.window.document)
  replaceGlobal('Event', dom.window.Event)
  replaceGlobal('CustomEvent', dom.window.CustomEvent)
  simulate = require('miniprogram-simulate')
  prepareComponentScripts()
  filterBarId = simulate.load(resolve(filterBarRoot, 'index'), {
    compiler: 'simulate',
    rootPath: componentRoot,
  })
  filterSheetId = simulate.load(resolve(filterSheetRoot, 'index'), {
    compiler: 'simulate',
    rootPath: componentRoot,
  })
})

afterAll(() => {
  dom.window.close()
  for (const path of generatedPaths) {
    if (existsSync(path)) rmSync(path)
  }
  restoreGlobals()
})

describe('filter-bar', () => {
  it('渲染四个 88rpx 入口、总角标，并携带打开的 section', async () => {
    const host = renderHost(
      '<filter-bar id="subject" query="{{query}}" active-count="{{activeCount}}" bindopen="onOpen" />',
      { query: originalQuery, activeCount: 3, openedSection: '' },
      {
        onOpen(event) {
          this.setData({ openedSection: event.detail.section })
        },
      },
    )
    const subject = host.querySelector('#subject')
    const items = subject?.querySelectorAll('.filter-bar__item') ?? []

    expect(items).toHaveLength(4)
    expect(subject?.dom?.textContent).toContain('筛选')
    expect(subject?.querySelector('.filter-bar__badge')?.dom?.textContent).toBe('3')

    items[1]?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.openedSection).toBe('price')

    const styles = readFileSync(resolve(filterBarRoot, 'index.wxss'), 'utf8')
    expect(styles).toMatch(/\.filter-bar__item \{[\s\S]*height: 88rpx;/)
    expect(styles).toMatch(/\.filter-bar__item--active \{[\s\S]*background:[\s\S]*font-weight:/)
    expect(styles.match(/\.filter-bar__item--active \{[^}]*color:/)).toBeNull()
    host.detach()
  })

  it('按已应用查询为位置、价格、面积和全部入口提供非颜色激活态', () => {
    const host = renderHost(
      '<filter-bar id="subject" query="{{query}}" active-count="4" />',
      { query: { ...originalQuery, areaMin: 100 } },
    )
    const subject = host.querySelector('#subject')

    expect(subject?.querySelectorAll('.filter-bar__item--active')).toHaveLength(4)
    host.detach()
  })
})

describe('filter-sheet', () => {
  it('打开价格面板先呈现计价单位；换单位清价格区间并估算，取消不污染 applied query', async () => {
    const host = renderHost(
      [
        '<filter-sheet id="subject" open="{{sheetOpen}}" section="price" query="{{appliedQuery}}"',
        ' filters="{{filters}}" result-count="21" bindestimate="onEstimate" bindapply="onApply" bindclose="onClose" />',
      ].join(''),
      {
        sheetOpen: true,
        appliedQuery: originalQuery,
        filters,
        estimateQuery: null,
        applyCount: 0,
      },
      {
        onEstimate(event) {
          this.setData({ estimateQuery: event.detail.query })
        },
        onApply() {
          this.setData({ applyCount: Number(this.data.applyCount) + 1 })
        },
        onClose() {
          this.setData({ sheetOpen: false })
        },
      },
    )
    const subject = host.querySelector('#subject')
    const unit = subject?.querySelector('.filter-sheet__unit')
    const priceRange = subject?.querySelector('.filter-sheet__price-range')

    expect(unit).toBeDefined()
    expect(priceRange).toBeDefined()

    findByText(subject as RootComponent, '.filter-sheet__option', '元/月')?.dispatchEvent('tap')
    await simulate.sleep(0)

    expect(subject?.data.draft).toEqual({
      district: ['jingan'],
      priceUnit: 'rmb-month',
      sort: 'recommended',
      page: 1,
    })
    expect(host.data.estimateQuery).toEqual(subject?.data.draft)

    subject?.querySelector('.filter-sheet__close')?.dispatchEvent('tap')
    await simulate.sleep(0)

    expect(host.data.appliedQuery).toEqual(originalQuery)
    expect(host.data.applyCount).toBe(0)
    expect(host.data.sheetOpen).toBe(false)
    host.detach()
  })

  it('每次重新打开都从最新 applied query 深拷贝 draft', async () => {
    const host = renderHost(
      '<filter-sheet id="subject" open="{{sheetOpen}}" section="all" query="{{appliedQuery}}" filters="{{filters}}" />',
      { sheetOpen: true, appliedQuery: originalQuery, filters },
    )
    const subject = host.querySelector('#subject')

    expect(subject?.data.draft).toEqual(originalQuery)
    expect((subject?.data.draft as typeof originalQuery).district).not.toBe(originalQuery.district)

    host.setData({ sheetOpen: false })
    await simulate.sleep(0)
    host.setData({
      appliedQuery: { type: ['coworking'], sort: 'newest', page: 2 },
      sheetOpen: true,
    })
    await simulate.sleep(0)

    expect(subject?.data.draft).toEqual({ type: ['coworking'], sort: 'newest', page: 2 })
    host.detach()
  })

  it('区域与类型候选只使用 API filters，draft 变化触发 estimate', async () => {
    const host = renderHost(
      '<filter-sheet id="subject" open="true" section="all" query="{{query}}" filters="{{filters}}" bindestimate="onEstimate" />',
      { query: { sort: 'recommended', page: 1 }, filters, estimateQuery: null },
      {
        onEstimate(event) {
          this.setData({ estimateQuery: event.detail.query })
        },
      },
    )
    const subject = host.querySelector('#subject')
    const text = subject?.dom?.textContent ?? ''

    expect(text).toContain('静安区')
    expect(text).toContain('徐汇区')
    expect(text).toContain('联合办公')
    expect(text).not.toContain('商圈')
    expect(text).not.toContain('地铁')

    findByText(subject as RootComponent, '.filter-sheet__option', '静安区')?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.estimateQuery).toEqual({ district: ['jingan'], sort: 'recommended', page: 1 })
    host.detach()
  })

  it('丢弃 malformed filter options，只渲染逐项验证通过的候选', () => {
    const malformedFilters = [
      {
        id: 'district',
        label: '区域',
        options: [
          null,
          {},
          { value: '', label: '空值', count: 1 },
          { value: 'empty-label', label: '', count: 1 },
          { value: 'negative-count', label: '负数', count: -1 },
          { value: 'fraction-count', label: '小数', count: 1.5 },
          { value: 'unsafe-count', label: '超界', count: Number.MAX_SAFE_INTEGER + 1 },
          { value: 'pudong', label: '浦东新区', count: 8 },
        ],
      },
      { id: 'listingType', label: '', options: [{ value: 'coworking', label: '错误分组', count: 1 }] },
    ]
    const host = renderHost(
      '<filter-sheet id="subject" open="true" section="all" query="{{query}}" filters="{{filters}}" />',
      { query: { sort: 'recommended', page: 1 }, filters: malformedFilters },
    )
    const subject = host.querySelector('#subject')
    const text = subject?.dom?.textContent ?? ''

    expect(subject?.querySelectorAll('.filter-sheet__option')).toHaveLength(1)
    expect(text).toContain('浦东新区')
    expect(text).not.toContain('空值')
    expect(text).not.toContain('负数')
    expect(text).not.toContain('小数')
    expect(text).not.toContain('超界')
    expect(text).not.toContain('错误分组')
    host.detach()
  })

  it('三个 option handler 拒绝当前投影中不存在的 stale 或伪造 value', async () => {
    const host = renderHost(
      '<filter-sheet id="subject" open="true" section="all" query="{{query}}" filters="{{filters}}" bindestimate="onEstimate" />',
      { query: originalQuery, filters, estimateCount: 0 },
      {
        onEstimate() {
          this.setData({ estimateCount: Number(this.data.estimateCount) + 1 })
        },
      },
    )
    const subject = host.querySelector('#subject') as RootComponent
    const methods = subject.instance as unknown as FilterSheetMethods

    methods.handleDistrict(datasetEvent('pudong'))
    methods.handleType(datasetEvent('full-floor'))
    methods.handlePriceUnit(datasetEvent('rmb-year'))
    await simulate.sleep(0)

    expect(subject.data.draft).toEqual(originalQuery)
    expect(host.data.estimateCount).toBe(0)
    host.detach()
  })

  it('type、价格、面积和最晚入驻时间的每次有效变化都产出规范化 estimate', async () => {
    const host = renderHost(
      '<filter-sheet id="subject" open="true" section="all" query="{{query}}" filters="{{filters}}" bindestimate="onEstimate" />',
      { query: originalQuery, filters, estimateCount: 0, estimateQuery: null },
      {
        onEstimate(event) {
          this.setData({
            estimateCount: Number(this.data.estimateCount) + 1,
            estimateQuery: event.detail.query,
          })
        },
      },
    )
    const subject = host.querySelector('#subject') as RootComponent

    findByText(subject, '.filter-sheet__option', '联合办公')?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.estimateCount).toBe(1)
    expect(host.data.estimateQuery).toEqual({
      district: ['jingan'],
      type: ['coworking'],
      priceMin: 3,
      priceMax: 7,
      priceUnit: 'rmb-sqm-day',
      sort: 'recommended',
      page: 1,
    })

    const inputs = subject.querySelectorAll('.filter-sheet__input')
    inputs[0]?.dispatchEvent('input', { detail: { value: '4' } })
    await simulate.sleep(0)
    expect(host.data.estimateCount).toBe(2)
    expect(host.data.estimateQuery).toMatchObject({ priceMin: 4, priceMax: 7, page: 1 })

    inputs[1]?.dispatchEvent('input', { detail: { value: '9' } })
    await simulate.sleep(0)
    expect(host.data.estimateCount).toBe(3)
    expect(host.data.estimateQuery).toMatchObject({ priceMin: 4, priceMax: 9, page: 1 })

    inputs[2]?.dispatchEvent('input', { detail: { value: '100' } })
    await simulate.sleep(0)
    expect(host.data.estimateCount).toBe(4)
    expect(host.data.estimateQuery).toMatchObject({ areaMin: 100, page: 1 })

    inputs[3]?.dispatchEvent('input', { detail: { value: '500' } })
    await simulate.sleep(0)
    expect(host.data.estimateCount).toBe(5)
    expect(host.data.estimateQuery).toMatchObject({ areaMin: 100, areaMax: 500, page: 1 })

    const methods = subject.instance as unknown as FilterSheetMethods
    methods.handleAvailableBefore({
      detail: { value: '2026-09-01' },
    } as unknown as WechatMiniprogram.CustomEvent<{ value: string }>)
    await simulate.sleep(0)
    expect(host.data.estimateCount).toBe(6)
    expect(host.data.estimateQuery).toEqual({
      district: ['jingan'],
      type: ['coworking'],
      areaMin: 100,
      areaMax: 500,
      priceMin: 4,
      priceMax: 9,
      priceUnit: 'rmb-sqm-day',
      availableBefore: '2026-09-01',
      sort: 'recommended',
      page: 1,
    })
    host.detach()
  })

  it('点击遮罩只关闭面板，不触发 apply 或污染 applied query', async () => {
    const host = renderHost(
      '<filter-sheet id="subject" open="true" section="all" query="{{appliedQuery}}" filters="{{filters}}" bindclose="onClose" bindapply="onApply" />',
      { appliedQuery: originalQuery, filters, closeCount: 0, applyCount: 0 },
      {
        onClose() {
          this.setData({ closeCount: Number(this.data.closeCount) + 1 })
        },
        onApply() {
          this.setData({ applyCount: Number(this.data.applyCount) + 1 })
        },
      },
    )
    const subject = host.querySelector('#subject')

    subject?.querySelector('.filter-sheet__backdrop')?.dispatchEvent('tap')
    await simulate.sleep(0)

    expect(host.data.closeCount).toBe(1)
    expect(host.data.applyCount).toBe(0)
    expect(host.data.appliedQuery).toEqual(originalQuery)
    host.detach()
  })

  it('清空只重置 draft 并产出 clear/estimate，确认才产出 apply', async () => {
    const host = renderHost(
      [
        '<filter-sheet id="subject" open="true" section="all" query="{{appliedQuery}}" filters="{{filters}}"',
        ' bindclear="onClear" bindestimate="onEstimate" bindapply="onApply" />',
      ].join(''),
      { appliedQuery: originalQuery, filters, cleared: null, estimated: null, applied: null },
      {
        onClear(event) {
          this.setData({ cleared: event.detail.query })
        },
        onEstimate(event) {
          this.setData({ estimated: event.detail.query })
        },
        onApply(event) {
          this.setData({ applied: event.detail.query })
        },
      },
    )
    const subject = host.querySelector('#subject')

    subject?.querySelector('.filter-sheet__clear')?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.appliedQuery).toEqual(originalQuery)
    expect(host.data.cleared).toEqual({ priceUnit: 'rmb-sqm-day', sort: 'recommended', page: 1 })
    expect(host.data.estimated).toEqual({ priceUnit: 'rmb-sqm-day', sort: 'recommended', page: 1 })

    subject?.querySelector('.filter-sheet__apply')?.dispatchEvent('tap')
    await simulate.sleep(0)
    expect(host.data.applied).toEqual({ priceUnit: 'rmb-sqm-day', sort: 'recommended', page: 1 })
    host.detach()
  })

  it('结果按钮区分实时套数、计算中和暂不可用，并在不可用时禁用 apply', async () => {
    const host = renderHost(
      [
        '<filter-sheet id="subject" open="true" section="price" query="{{query}}" filters="{{filters}}"',
        ' result-count="{{count}}" estimating="{{estimating}}" estimate-unavailable="{{estimateUnavailable}}"',
        ' bindapply="onApply" />',
      ].join(''),
      {
        query: originalQuery,
        filters,
        count: 21,
        estimating: false,
        estimateUnavailable: false,
        applyCount: 0,
      },
      {
        onApply() {
          this.setData({ applyCount: Number(this.data.applyCount) + 1 })
        },
      },
    )
    const subject = host.querySelector('#subject')

    expect(subject?.querySelector('.filter-sheet__apply')?.dom?.textContent).toContain('查看 21 套')

    host.setData({ estimating: true })
    await simulate.sleep(0)
    expect(subject?.querySelector('.filter-sheet__apply')?.dom?.textContent).toContain('正在计算')

    host.setData({ estimating: false, estimateUnavailable: true })
    await simulate.sleep(0)
    expect(subject?.querySelector('.filter-sheet__apply')?.dom?.textContent).toContain('暂时无法计算')

    const methods = (subject as RootComponent).instance as unknown as FilterSheetMethods
    methods.handleApply()
    await simulate.sleep(0)
    expect(host.data.applyCount).toBe(0)

    host.setData({ estimateUnavailable: false, count: 8 })
    await simulate.sleep(0)
    expect(subject?.querySelector('.filter-sheet__apply')?.dom?.textContent).toContain('查看 8 套')
    methods.handleApply()
    await simulate.sleep(0)
    expect(host.data.applyCount).toBe(1)
    host.detach()
  })

  it('半屏面板底栏处理安全区，WXML 不内置商圈或地铁假候选', () => {
    const template = readFileSync(resolve(filterSheetRoot, 'index.wxml'), 'utf8')
    const styles = readFileSync(resolve(filterSheetRoot, 'index.wxss'), 'utf8')

    expect(styles).toMatch(/\.filter-sheet__panel \{[\s\S]*height: auto;[\s\S]*max-height: calc\(100vh - 160rpx\);/)
    expect(styles).toMatch(/\.filter-sheet__footer \{[\s\S]*env\(safe-area-inset-bottom\)/)
    expect(template.indexOf('filter-sheet__unit')).toBeLessThan(template.indexOf('filter-sheet__price-range'))
    expect(template).toContain('catchtouchmove="handleBackdropTouchMove"')
    expect(template).not.toContain('商圈')
    expect(template).not.toContain('地铁')
  })

  it('最晚入驻时间使用只产出完整值的日期选择器并保持 88rpx 触达', () => {
    const template = readFileSync(resolve(filterSheetRoot, 'index.wxml'), 'utf8')
    const styles = readFileSync(resolve(filterSheetRoot, 'index.wxss'), 'utf8')

    expect(template).toMatch(/<picker[\s\S]*mode="date"[\s\S]*bindchange="handleAvailableBefore"/)
    expect(styles).toMatch(/\.filter-sheet__date \{[\s\S]*min-height: var\(--sbh-size-touch-target\);/)
  })

  it('组件样式隔离下各自定义 tabular nums，估算禁用态使用 class 而非属性选择器', () => {
    const barStyles = readFileSync(resolve(filterBarRoot, 'index.wxss'), 'utf8')
    const sheetStyles = readFileSync(resolve(filterSheetRoot, 'index.wxss'), 'utf8')
    const template = readFileSync(resolve(filterSheetRoot, 'index.wxml'), 'utf8')

    expect(barStyles).toMatch(/\.num \{[\s\S]*font-variant-numeric: tabular-nums;/)
    expect(sheetStyles).toMatch(/\.num \{[\s\S]*font-variant-numeric: tabular-nums;/)
    expect(template).toContain("estimating || estimateUnavailable ? 'filter-sheet__apply--disabled' : ''")
    expect(template).toContain('disabled="{{estimating || estimateUnavailable}}"')
    expect(sheetStyles).toContain('.filter-sheet__apply--disabled')
    expect(sheetStyles).not.toContain('[disabled]')
  })

  it('真实打开态使用共享抽屉骨架、拖拽把手、固定安全区底栏与键盘避让', () => {
    const template = readFileSync(resolve(filterSheetRoot, 'index.wxml'), 'utf8')
    const styles = readFileSync(resolve(filterSheetRoot, 'index.wxss'), 'utf8')

    expect(template).toContain('class="filter-sheet sbh-sheet"')
    expect(template).toContain('class="filter-sheet__backdrop sbh-sheet__backdrop"')
    expect(template).toContain('class="filter-sheet__panel sbh-sheet__panel"')
    expect(template).toContain('filter-sheet__grabber')
    expect(template).toContain('class="filter-sheet__body sbh-sheet__body"')
    expect(template).toContain('class="filter-sheet__footer sbh-sheet__footer"')
    expect(template).toMatch(/<scroll-view[\s\S]*scroll-y="true"[\s\S]*enhanced="true"/)
    expect(template).toMatch(/class="filter-sheet__input num"[\s\S]*adjust-position="\{\{true\}\}"[\s\S]*cursor-spacing="24"/)
    expect(styles).toContain('var(--sbh-sheet-panel-radius)')
    expect(styles).toContain('var(--sbh-sheet-motion-duration)')
    expect(styles).toMatch(/\.filter-sheet__close\s*\{[\s\S]*width:\s*var\(--sbh-sheet-close-size\);[\s\S]*height:\s*var\(--sbh-sheet-close-size\);/)
    expect(styles).toMatch(/\.filter-sheet__footer\s*\{[\s\S]*position:\s*relative;[\s\S]*env\(safe-area-inset-bottom\)/)
  })

  it('价格入口仅渲染价格分区，全部入口才渲染区域、面积、类型和日期', () => {
    const template = readFileSync(resolve(filterSheetRoot, 'index.wxml'), 'utf8')

    expect(template).toContain("resolvedSection === 'price' || resolvedSection === 'all'")
    expect(template).toContain("resolvedSection === 'location' || resolvedSection === 'all'")
    expect(template).toContain("resolvedSection === 'area' || resolvedSection === 'all'")
    expect(template).toContain("resolvedSection === 'all'")
  })
})
