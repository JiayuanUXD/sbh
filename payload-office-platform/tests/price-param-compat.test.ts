/**
 * 搜索参数改名的向后兼容单测（批次 5）
 *
 * 改名本身零功能变更，风险全在兼容边界：`rentMin` / `rentMax` / `rent-asc` /
 * `rent-desc` 这些 URL 参数已经被搜索引擎收录、被站内链接和用户书签引用。解析层
 * 必须继续认它们，同时 canonical 只输出新名，让索引逐步收敛。
 *
 * 守护不变量：
 *   - 旧参数仍可解析，语义与改名前一致
 *   - 新参数可解析
 *   - 新旧同时出现时新参数优先（canonical 才有唯一解）
 *   - canonical 只输出新名，绝不回吐旧名
 *   - 旧 URL 经解析 → canonical 往返后落到新名，且筛选语义不变
 */

import { describe, expect, it } from 'vitest'

import {
  buildCanonicalSearchParams,
  parseListingSearchInput,
} from '@/domain/public-catalog'

const parse = (query: string) => parseListingSearchInput(new URLSearchParams(query))
const canonical = (query: string) => buildCanonicalSearchParams(parse(query)).toString()

describe('price-param/旧参数兼容', () => {
  it('rentMin / rentMax 仍可解析', () => {
    const input = parse('rentMin=100&rentMax=500')
    expect(input.priceMin).toBe(100)
    expect(input.priceMax).toBe(500)
  })

  it('sort=rent-asc / rent-desc 仍可解析', () => {
    expect(parse('rentUnit=rmb-sqm-day&sort=rent-asc').sort).toBe('price-asc')
    expect(parse('rentUnit=rmb-sqm-day&sort=rent-desc').sort).toBe('price-desc')
  })

  it('已收录的完整旧 URL 不失效', () => {
    const input = parse('rentUnit=rmb-sqm-day&sort=rent-asc&rentMin=100&areaMin=50')
    expect(input.priceMin).toBe(100)
    expect(input.areaMin).toBe(50)
    expect(input.sort).toBe('price-asc')
    expect(input.priceUnit).toBe('rmb-sqm-day')
  })
})

describe('price-param/新参数', () => {
  it('priceMin / priceMax 可解析', () => {
    const input = parse('priceMin=100&priceMax=500')
    expect(input.priceMin).toBe(100)
    expect(input.priceMax).toBe(500)
  })

  it('sort=price-asc / price-desc 可解析', () => {
    expect(parse('priceUnit=rmb-sqm-day&sort=price-asc').sort).toBe('price-asc')
    expect(parse('priceUnit=rmb-sqm-day&sort=price-desc').sort).toBe('price-desc')
  })

  it('priceUnit 支持出售单位（旧 rentUnit 白名单没有的）', () => {
    expect(parse('priceUnit=rmb-total').priceUnit).toBe('rmb-total')
    expect(parse('priceUnit=rmb-sqm-total').priceUnit).toBe('rmb-sqm-total')
  })
})

describe('price-param/新旧同存', () => {
  it('新参数优先于旧参数', () => {
    const input = parse('rentMin=100&priceMin=200')
    expect(input.priceMin).toBe(200)
  })

  it('新排序优先于旧排序', () => {
    expect(parse('priceUnit=rmb-sqm-day&sort=price-desc&sort=rent-asc').sort).toBe('price-desc')
  })
})

describe('price-param/canonical 收敛', () => {
  it('canonical 只输出新名，不回吐 rentMin', () => {
    const query = canonical('rentMin=100&rentMax=500')
    expect(query).toContain('priceMin=100')
    expect(query).toContain('priceMax=500')
    expect(query).not.toContain('rentMin')
    expect(query).not.toContain('rentMax')
  })

  it('canonical 输出 price-asc 而非 rent-asc', () => {
    const query = canonical('rentUnit=rmb-sqm-day&sort=rent-asc')
    expect(query).toContain('sort=price-asc')
    expect(query).not.toContain('rent-asc')
  })

  it('canonical 输出 priceUnit 而非 rentUnit', () => {
    const query = canonical('rentUnit=rmb-sqm-day')
    expect(query).toContain('priceUnit=rmb-sqm-day')
    expect(query).not.toContain('rentUnit')
  })

  it('旧 URL 与等价新 URL 产出同一份 canonical（索引可归并）', () => {
    const fromLegacy = canonical('rentUnit=rmb-sqm-day&sort=rent-asc&rentMin=100')
    const fromNew = canonical('priceUnit=rmb-sqm-day&sort=price-asc&priceMin=100')
    expect(fromLegacy).toBe(fromNew)
  })

  it('canonical 幂等：对自身再解析一次结果不变', () => {
    const once = canonical('rentUnit=rmb-sqm-day&sort=rent-asc&rentMin=100&areaMin=50')
    const twice = canonical(once)
    expect(twice).toBe(once)
  })
})

describe('price-param/排序降级不受改名影响', () => {
  it('未指定计价单位时价格排序降级为 recommended', () => {
    expect(parse('sort=price-asc').sort).toBe('recommended')
    expect(parse('sort=rent-asc').sort).toBe('recommended')
  })
})
