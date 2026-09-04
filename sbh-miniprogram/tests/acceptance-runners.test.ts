import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  parseMiniHomeData,
  parseMiniListingsData,
} from '../miniprogram/services/catalog-contracts.js'

const projectRoot = resolve(import.meta.dirname, '..')
const scriptsRoot = resolve(projectRoot, 'scripts')

type AcceptanceResultModule = Readonly<{
  assertAcceptancePassed(report: unknown): void
}>

type AcceptanceMockServerModule = Readonly<{
  createAcceptanceServer(port?: number): Promise<Readonly<{
    server: Server
    close(): Promise<void>
  }>>
}>

async function loadAcceptanceResult(): Promise<AcceptanceResultModule> {
  return await import('../scripts/acceptance-result.mjs' as never) as AcceptanceResultModule
}

async function loadAcceptanceMockServer(): Promise<AcceptanceMockServerModule> {
  return await import('../scripts/acceptance-mock-server.mjs' as never) as AcceptanceMockServerModule
}

function readScript(filename: string): string {
  return readFileSync(resolve(scriptsRoot, filename), 'utf8')
}

function responseData(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !('data' in payload)) {
    throw new Error('Mock 响应缺少 data')
  }
  return payload.data
}

describe('验收报告 fail-closed', () => {
  it('递归发现任意 passed:false，并在错误中列出完整路径', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      testCases: {
        home: { passed: true },
        listing: {
          detail: { passed: false },
        },
      },
      interactions: {
        filter: { passed: true },
      },
    })).toThrow(/testCases\.listing\.detail/)
  })

  it('带 passed:true 的中间节点仍递归检查失败子节点', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      testCases: {
        group: {
          passed: true,
          child: { passed: false },
        },
      },
      interactions: {},
    })).toThrow(/testCases\.group\.child\.passed/)
  })

  it('叶节点中不含 passed 标记的普通元数据不作为验收子节点', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      testCases: {
        home: {
          passed: true,
          state: 'ready',
          totalDocs: 3,
          screenshots: ['home.png'],
          details: {
            viewport: { width: 375, height: 812 },
          },
        },
      },
      interactions: {},
    })).not.toThrow()
  })

  it('无 passed 的 group 可同时包含普通对象元数据与合法验收 child', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      testCases: {
        suite: {
          details: {
            viewport: { width: 375, height: 812 },
          },
          child: { passed: true },
        },
      },
      interactions: {},
    })).not.toThrow()
  })

  it('testCases 整棵树没有任何 passed 标记时 fail-closed', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      testCases: {
        suite: {
          details: { state: 'ready' },
        },
      },
      interactions: {},
    })).toThrow(/testCases 没有验收结果/)
  })

  it('声明必需交互后，空 interactions 明确失败', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      requiredInteractions: ['filterSheet'],
      testCases: { listings: { passed: true } },
      interactions: {},
    })).toThrow(/interactions\.filterSheet/)
  })

  it('testCases 与 interactions 所有递归叶节点通过时不抛错', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      requiredInteractions: ['filter.sheet'],
      testCases: {
        home: { passed: true },
        listing: { detail: { passed: true } },
      },
      interactions: {
        filter: { sheet: { passed: true } },
      },
    })).not.toThrow()
  })

  it('拒绝非普通对象报告', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed([])).toThrow(/普通对象/)
    expect(() => assertAcceptancePassed(null)).toThrow(/普通对象/)
  })
})

describe('MP-106/107 runner 失败传播', () => {
  it.each([
    ['mp106-acceptance-runner.mjs', [
      '.home-search__input',
      '.home-search__submit',
      '.listings-filter-shell',
      '.listings-summary__sort',
      'filter-bar',
      'filter-sheet',
      '.filter-sheet__option',
      '.filter-sheet__apply',
      '.building-listing-row',
      '.listing-detail__bar-action--inquiry',
    ]],
    ['mp107-acceptance-runner.mjs', [
      '.building-bottom-fav',
      '.listing-detail__bar-fav',
      '.listing-detail__bar-action--inquiry',
    ]],
  ] as const)('%s 对关键 selector 缺失显式抛错，并在写报告前断言通过', (filename, selectors) => {
    const source = readScript(filename)
    const assertionOffset = source.lastIndexOf('assertAcceptancePassed(results)')
    const reportWriteOffset = source.lastIndexOf('writeFileSync(reportPath')

    expect(source).toContain("import { assertAcceptancePassed } from './acceptance-result.mjs'")
    expect(source).toMatch(/function requireSelector[\s\S]*throw new Error/)
    for (const selector of selectors) {
      expect(source).toMatch(new RegExp(`requireSelector\\([^\\n]*['\"]${selector.replaceAll('.', '\\.')}`))
    }
    expect(assertionOffset).toBeGreaterThan(-1)
    expect(reportWriteOffset).toBeGreaterThan(assertionOffset)
  })

  it('MP-106 对 q、无单位排序保护和价格升降序真实交互 fail-closed', () => {
    const runner = readScript('mp106-acceptance-runner.mjs')

    expect(runner).toContain("'sortGuard'")
    expect(runner).toContain("'sortAsc'")
    expect(runner).toContain("'sortDesc'")
    expect(runner).not.toContain("'sortToggle'")
    expect(runner).toMatch(/homeSearch\s*=\s*\{[\s\S]*queryQ:\s*lData\.query\.q[\s\S]*passed:[\s\S]*lData\.query\.q\s*===\s*'静安'/)
    expect(runner).toMatch(/sortGuard\s*=\s*\{[\s\S]*passed:\s*guardData\.query\.sort\s*===\s*'recommended'/)
    expect(runner).toContain("const filterBar = await requireSelector(listings, 'filter-bar')")
    expect(runner).toContain("const priceFilter = await requireSelector(filterBar, '.filter-bar__item[data-section=\"price\"]')")
    expect(runner).toContain('await priceFilter.tap()')
    expect(runner).toContain("const sheet = await requireSelector(listings, 'filter-sheet')")
    expect(runner).toContain("const option = await requireSelector(sheet, '.filter-sheet__option')")
    expect(runner).toContain('await option.tap()')
    expect(runner).toContain("const apply = await requireSelector(sheet, '.filter-sheet__apply')")
    expect(runner).toContain('await apply.tap()')
    expect(runner).not.toContain("callMethod('handleOpenFilter'")
    expect(runner).not.toContain("callMethod('handleFilterApply'")
    expect(runner).toMatch(/priceUnit:\s*filteredData\.query\.priceUnit[\s\S]*passed:\s*typeof filteredData\.query\.priceUnit === 'string'/)
    expect(runner).toMatch(/sortAsc\s*=\s*\{[\s\S]*passed:\s*ascendingData\.query\.sort\s*===\s*'price-asc'/)
    expect(runner).toMatch(/sortDesc\s*=\s*\{[\s\S]*passed:\s*descendingData\.query\.sort\s*===\s*'price-desc'/)
  })

  it('MP-107 不再调用或依赖页面测试专用留资方法', () => {
    const runner = readScript('mp107-acceptance-runner.mjs')
    const profile = readFileSync(
      resolve(projectRoot, 'miniprogram/pages/profile/index.ts'),
      'utf8',
    )

    expect(runner).not.toContain('addSampleInquiryForDemo')
    expect(profile).not.toContain('addSampleInquiryForDemo')
    expect(profile).not.toContain('req_demo_01')
  })
})

describe('验收 Mock 列表查询合同', () => {
  it('所有广告计价单位都返回可解析且语义一致的价格投影', async () => {
    const { createAcceptanceServer } = await loadAcceptanceMockServer()
    const mockServer = await createAcceptanceServer(0)

    try {
      const address = mockServer.server.address()
      if (!address || typeof address === 'string') throw new Error('Mock 服务未返回 TCP 监听地址')
      const baseUrl = `http://127.0.0.1:${address.port}/api/mini/v1`
      const homeResponse = await fetch(`${baseUrl}/home`)
      const homePayload: unknown = await homeResponse.json()
      const home = parseMiniHomeData(responseData(homePayload))
      const advertisedPriceUnits = home.quickFilters
        .find((filter) => filter.id === 'priceUnit')
        ?.options ?? []

      expect(advertisedPriceUnits.map((option) => option.value)).toEqual([
        'rmb-sqm-day',
        'rmb-month',
      ])

      for (const option of advertisedPriceUnits) {
        const query = new URLSearchParams({
          q: '静安',
          priceUnit: option.value,
          sort: 'price-asc',
        })
        const response = await fetch(`${baseUrl}/listings?${query}`)
        const payload: unknown = await response.json()
        const listings = parseMiniListingsData(responseData(payload))

        expect(listings.canonicalQuery, option.value).toBe(query.toString())
        expect(listings.currentPriceUnit, option.value).toBe(option.value)
        expect(listings.items.length, option.value).toBeGreaterThan(0)
        expect(
          listings.items.every((item) => item.price?.displayUnit === option.value),
          option.value,
        ).toBe(true)

        for (const item of listings.items) {
          if (option.value === 'rmb-sqm-day') {
            expect(item.price, option.value).toMatchObject({
              period: 'day',
              basis: 'sqm',
            })
            expect(item.price?.text, option.value).toContain('元/㎡/天')
          } else if (option.value === 'rmb-month') {
            expect(item.price, option.value).toMatchObject({
              amount: item.price?.monthlyEstimate,
              period: 'month',
              basis: 'total',
            })
            expect(item.price?.text, option.value).toContain('元/月')
          }
        }
      }

      const initialResponse = await fetch(`${baseUrl}/listings`)
      const initialPayload: unknown = await initialResponse.json()
      const initialListings = parseMiniListingsData(responseData(initialPayload))
      expect(initialListings.canonicalQuery).toBe('')
      expect(initialListings.currentPriceUnit).toBeNull()
    } finally {
      await mockServer.close()
    }
  })
})
