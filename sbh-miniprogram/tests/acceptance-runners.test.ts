import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

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
  it('从请求参数返回 canonicalQuery、currentPriceUnit 和匹配计价单位', async () => {
    const { createAcceptanceServer } = await loadAcceptanceMockServer()
    const mockServer = await createAcceptanceServer(0)

    try {
      const address = mockServer.server.address()
      if (!address || typeof address === 'string') throw new Error('Mock 服务未返回 TCP 监听地址')
      const query = new URLSearchParams({
        q: '静安',
        priceUnit: 'rmb-sqm-day',
        sort: 'price-asc',
      })
      const response = await fetch(`http://127.0.0.1:${address.port}/api/mini/v1/listings?${query}`)
      const payload: unknown = await response.json()

      expect(payload).toMatchObject({
        ok: true,
        data: {
          canonicalQuery: query.toString(),
          currentPriceUnit: 'rmb-sqm-day',
        },
      })
      const listingItems = (payload as Readonly<{
        data: Readonly<{
          items: readonly Readonly<{
            price: Readonly<{ displayUnit: string }>
          }>[]
        }>
      }>).data.items
      expect(listingItems.length).toBeGreaterThan(0)
      expect(listingItems.every((item) => item.price.displayUnit === 'rmb-sqm-day')).toBe(true)

      const initialResponse = await fetch(`http://127.0.0.1:${address.port}/api/mini/v1/listings`)
      const initialPayload: unknown = await initialResponse.json()
      expect(initialPayload).toMatchObject({
        data: {
          canonicalQuery: '',
          currentPriceUnit: null,
        },
      })
    } finally {
      await mockServer.close()
    }
  })
})
