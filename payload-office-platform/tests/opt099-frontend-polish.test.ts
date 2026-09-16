/**
 * OPT-099 前端优化五项的契约断言。
 *
 * 布局行为（投影是否真被切、下拉是否真收起）在 node 环境量不到，这里锁的是
 * 「让它成立的那几条规则还在、且顺序没被挪动」；真实证据在浏览器走查
 * （artifacts/verification/OPT-099/）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { buildFilterOptionHref } from '@/lib/frontend/listing-url'
import { buildListingFilterRows } from '@/lib/frontend/listing-filter-rows'
import ResultToolbar from '@/components/frontend/listing/ResultToolbar'
import type { DistrictViewModel, ListingSearchInput } from '@/domain/public-catalog'

const APP = path.resolve(__dirname, '..', 'src', 'app', '(frontend)')
const SRC = path.resolve(__dirname, '..', 'src')
const read = (rel: string) => readFileSync(path.join(APP, rel), 'utf8')
const readSrc = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

function ruleOf(css: string, selector: string): string {
  const index = css.indexOf(`${selector} {`)
  expect(index, `${selector} 未定义`).toBeGreaterThan(-1)
  return css.slice(index, css.indexOf('}', index)).replace(/\/\*[\s\S]*?\*\//g, '')
}

// ── ① hover 投影不被滚动容器裁切 ────────────────────────────────────────────
describe('OPT-099 ①：hover 投影的纵向出血', () => {
  const surface = read('styles/surface.css')

  it('出血 token 的取值与 --shadow-hover 对得上（上 6 / 下 30）', () => {
    // 推导：shadow `0 14px 36px` → 向下偏移 14、四周糊开 blur/2=18；hover 再抬 2px。
    // 上 = 18 − 14 + 2 = 6；下 = 18 + 14 − 2 = 30。改 --shadow-hover 要同时改这里。
    expect(read('styles.css')).toMatch(/--shadow-hover:\s*0\s+14px\s+36px/)
    expect(surface).toMatch(/--sf-card-shadow-bleed-block:\s*6px\s+30px/)
  })

  it('两个裁切型滚动容器都用了这个 token —— 它们是全站仅有的两个', () => {
    expect(ruleOf(read('styles/home.css'), '.hm-rail__track')).toMatch(
      /padding-block:\s*var\(--sf-card-shadow-bleed-block\)/,
    )
    expect(ruleOf(read('styles.css'), '.nearby-strip')).toMatch(
      /padding-block:\s*var\(--sf-card-shadow-bleed-block\)/,
    )
  })

  it('.sf-rail 仍是 overflow-x:auto —— 纵向裁切正是由它连带产生的', () => {
    expect(ruleOf(surface, '.sf-rail')).toMatch(/overflow-x:\s*auto/)
    expect(surface).toContain('overflow-y')
  })
})

// ── ② 排序文案 ──────────────────────────────────────────────────────────────
describe('OPT-099 ②：去掉可见「排序」文案但保住可访问名', () => {
  const toolbar = renderToStaticMarkup(
    React.createElement(ResultToolbar, {
      rangeStart: 1,
      rangeEnd: 24,
      totalDocs: 26,
      noun: '套',
      sorts: [
        { value: 'recommended', label: '推荐排序' },
        { value: 'newest', label: '最新' },
      ],
      activeSort: 'recommended',
      basePath: '/shanghai/listings',
      currentParams: new URLSearchParams(),
    }),
  )

  it('房源列表工具条不再渲染独立的「排序」标签', () => {
    expect(toolbar).not.toContain('ls-toolbar__sortlabel')
    // 「推荐排序」是选项自己的文案，不算标签；去掉的是那个孤立的 <span>排序</span>
    expect(toolbar).not.toMatch(/>排序</)
  })

  it('排序链接仍在一个具名分组里（可见文案没了，无障碍名不能一起没）', () => {
    expect(toolbar).toContain('aria-label="排序"')
    expect(toolbar).toContain('role="group"')
    expect(toolbar).toContain('ls-toolbar__sortgroup')
  })

  it('楼盘详情供给区同样去掉了可见文案，分组仍带 aria-label', () => {
    const src = readSrc('components/frontend/BuildingSupplyBrowser.tsx')
    expect(src).not.toContain('ls-toolbar__sortlabel')
    expect(src).toContain('aria-label="排序"')
  })

  it('零消费方的 .ls-toolbar__sortlabel 规则已删除，分组规则自带 gap', () => {
    const list = read('styles/list.css')
    expect(list).not.toMatch(/^\.ls-toolbar__sortlabel\s*\{/m)
    expect(ruleOf(list, '.ls-toolbar__sortgroup')).toMatch(/gap:/)
  })
})

// ── ③ 二级导航跳转后收起 ────────────────────────────────────────────────────
describe('OPT-099 ③：二级导航的抑制态', () => {
  const styles = read('styles.css')

  it('抑制规则存在且把菜单藏起来', () => {
    expect(styles).toMatch(
      /\.site-nav__group\[data-nav-suppressed\] \.site-nav__menu \{[^}]*visibility:\s*hidden/s,
    )
  })

  it('抑制规则必须排在 :hover / :focus-within 之后 —— 同特异度靠后来者胜，挪前面就静默失效', () => {
    const openAt = styles.indexOf('.site-nav__group:focus-within .site-nav__menu')
    const suppressAt = styles.indexOf('.site-nav__group[data-nav-suppressed] .site-nav__menu')
    expect(openAt).toBeGreaterThan(-1)
    expect(suppressAt).toBeGreaterThan(openAt)
    // 没有用 !important 绕过顺序（用了的话上面那条顺序断言就形同虚设）
    expect(styles.slice(suppressAt, styles.indexOf('}', suppressAt))).not.toContain('!important')
  })

  it('只有指针激活才抑制：键盘 Enter 的 click detail 为 0，此时焦点还在菜单里', () => {
    const src = readSrc('components/frontend/SiteNav.tsx')
    expect(src).toMatch(/e\.detail > 0/)
    expect(src).toContain('onPointerLeave')
    // 焦点进入本组要解除抑制，否则 Tab 会走进 visibility:hidden 的子项
    expect(src).toContain('onFocus')
  })
})

// ── ⑤ 商圈筛选行 ────────────────────────────────────────────────────────────
const DISTRICTS: readonly DistrictViewModel[] = [
  { id: 10, slug: 'jingan', name: '静安' },
  { id: 11, slug: 'pudong', name: '浦东' },
]
const AREA_FACETS = [
  { id: 20, slug: 'nanjing-west-road', name: '南京西路', count: 7 },
  { id: 21, slug: 'jingan-temple', name: '静安寺', count: 3 },
]

function rows(input: Partial<ListingSearchInput>) {
  return buildListingFilterRows({
    input: { page: 1, pageSize: 24, sort: 'recommended', ...input } as ListingSearchInput,
    districts: DISTRICTS,
    districtCounts: new Map([
      ['jingan', 10],
      ['pudong', 6],
    ]),
    typeCounts: new Map(),
    businessAreaFacets: AREA_FACETS,
    priceRowLabel: '租金上限',
    priceDimensionLabel: '租金',
  })
}

describe('OPT-099 ⑤：商圈行跟随位置级联', () => {
  it('未选行政区时整行无候选 —— FilterFormC 的「无候选值的行不渲染」会把它隐藏', () => {
    const row = rows({}).rows.find((r) => r.key === 'businessArea')
    expect(row).toBeDefined()
    expect(row!.options).toEqual([])
  })

  it('选定行政区后列出该区商圈并带计数', () => {
    const row = rows({ district: ['jingan'] }).rows.find((r) => r.key === 'businessArea')!
    expect(row.options.map((o) => o.value)).toEqual(['nanjing-west-road', 'jingan-temple'])
    expect(row.options[0]).toMatchObject({ label: '南京西路', count: 7 })
  })

  it('商圈行紧跟位置行', () => {
    const keys = rows({ district: ['jingan'] }).rows.map((r) => r.key)
    expect(keys.indexOf('businessArea')).toBe(keys.indexOf('district') + 1)
  })

  it('位置行声明 clearsKeys=[businessArea] —— 切区不清商圈就是「静安 + 陆家嘴」恒空组合', () => {
    const row = rows({ district: ['jingan'] }).rows.find((r) => r.key === 'district')!
    expect(row.clearsKeys).toEqual(['businessArea'])
  })

  it('商圈现在叫得出名字了（chip 不再只印维度名）', () => {
    const spec = rows({ district: ['jingan'], businessArea: ['jingan-temple'] }).dimensions.find(
      (d) => d.dimension === 'businessArea',
    )!
    expect(spec.active).toBe(true)
    expect(spec.activeText).toBe('静安寺')
  })

  it('词表里查不到的取值仍然生效、但绝不回显 slug', () => {
    const spec = rows({ businessArea: ['made-up'] }).dimensions.find((d) => d.dimension === 'businessArea')!
    expect(spec.active).toBe(true)
    expect(spec.activeText).toBeNull()
  })
})

describe('OPT-099 ⑤：href 构造收敛为一份', () => {
  const params = new URLSearchParams('district=jingan&businessArea=jingan-temple&page=3&type=coworking')

  it('切换位置时一并清掉商圈，并且永远删 page', () => {
    const href = buildFilterOptionHref('/shanghai/listings', params, 'district', 'pudong', false, [
      'businessArea',
    ])
    const sp = new URLSearchParams(href.split('?')[1])
    expect(sp.get('district')).toBe('pudong')
    expect(sp.has('businessArea')).toBe(false)
    expect(sp.has('page')).toBe(false)
    expect(sp.get('type')).toBe('coworking')
  })

  it('取消位置（再点已选项）同样清掉商圈 —— 否则会留下一个所属行已消失的生效条件', () => {
    const href = buildFilterOptionHref('/shanghai/listings', params, 'district', 'jingan', true, [
      'businessArea',
    ])
    const sp = new URLSearchParams(href.split('?')[1])
    expect(sp.has('district')).toBe(false)
    expect(sp.has('businessArea')).toBe(false)
  })

  it('桌面与移动抽屉必须用同一份实现，不得各自再内联一份', () => {
    for (const rel of [
      'components/frontend/listing/FilterFormC.tsx',
      'components/frontend/listing/MobileFilterSheet.tsx',
    ]) {
      const src = readSrc(rel)
      expect(src, `${rel} 应从 listing-url 导入`).toMatch(
        /import \{[^}]*buildFilterOptionHref[^}]*\} from '@\/lib\/frontend\/listing-url'/,
      )
      expect(src, `${rel} 不得再自己定义一份`).not.toMatch(/function buildOptionHref\(/)
    }
  })
})
