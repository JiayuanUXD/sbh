import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const scriptsRoot = resolve(projectRoot, 'scripts')

type AcceptanceResultModule = Readonly<{
  assertAcceptancePassed(report: unknown): void
}>

async function loadAcceptanceResult(): Promise<AcceptanceResultModule> {
  return await import('../scripts/acceptance-result.mjs' as never) as AcceptanceResultModule
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
