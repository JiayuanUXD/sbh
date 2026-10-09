import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
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
  ACCEPTANCE_FIXTURE_ID: string
  createAcceptanceServer(port?: number): Promise<Readonly<{
    server: Server
    close(): Promise<void>
  }>>
}>

type Mp109RunnerModule = Readonly<{
  probeAcceptanceServer(port: number): Promise<void>
  fingerprintEvidenceSources(sources: readonly Readonly<{ path: string; content: string }>[] ): string
  evaluateProfileReports(
    reports: Readonly<Record<'small' | 'large', unknown>>,
    expectedRevision: string,
  ): Readonly<{ status: string; failures: readonly string[] }>
  resolveRequestedProfile(environment: Readonly<Record<string, string | undefined>>): 'small' | 'large'
  buildInvalidInvocationReport(reason: string): Readonly<{ status: string; reason: string; states: unknown }>
}>

async function loadAcceptanceResult(): Promise<AcceptanceResultModule> {
  return await import('../scripts/acceptance-result.mjs' as never) as AcceptanceResultModule
}

async function loadAcceptanceMockServer(): Promise<AcceptanceMockServerModule> {
  return await import('../scripts/acceptance-mock-server.mjs' as never) as AcceptanceMockServerModule
}

async function loadMp109Runner(): Promise<Mp109RunnerModule> {
  return await import('../scripts/mp109-sheet-acceptance-runner.mjs' as never) as Mp109RunnerModule
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

const acceptanceMetadata = {
  environment: 'local-wechat-devtools-develop-with-controlled-mock',
  evidenceRevision: 'a'.repeat(16),
  limitations: ['仅覆盖 develop 与受控 Mock，不等同于 trial 或真实写入'],
} as const

describe('验收报告 fail-closed', () => {
  it('递归发现任意 passed:false，并在错误中列出完整路径', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      ...acceptanceMetadata,
      requiredInteractions: ['filter'],
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
      ...acceptanceMetadata,
      requiredInteractions: ['smoke'],
      testCases: {
        group: {
          passed: true,
          child: { passed: false },
        },
      },
      interactions: { smoke: { passed: true } },
    })).toThrow(/testCases\.group\.child\.passed/)
  })

  it('叶节点中不含 passed 标记的普通元数据不作为验收子节点', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      ...acceptanceMetadata,
      requiredInteractions: ['smoke'],
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
      interactions: { smoke: { passed: true } },
    })).not.toThrow()
  })

  it('无 passed 的 group 可同时包含普通对象元数据与合法验收 child', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      ...acceptanceMetadata,
      requiredInteractions: ['smoke'],
      testCases: {
        suite: {
          details: {
            viewport: { width: 375, height: 812 },
          },
          child: { passed: true },
        },
      },
      interactions: { smoke: { passed: true } },
    })).not.toThrow()
  })

  it('testCases 整棵树没有任何 passed 标记时 fail-closed', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      ...acceptanceMetadata,
      requiredInteractions: ['smoke'],
      testCases: {
        suite: {
          details: { state: 'ready' },
        },
      },
      interactions: { smoke: { passed: true } },
    })).toThrow(/testCases 没有验收结果/)
  })

  it('声明必需交互后，空 interactions 明确失败', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      ...acceptanceMetadata,
      requiredInteractions: ['filterSheet'],
      testCases: { listings: { passed: true } },
      interactions: {},
    })).toThrow(/interactions\.filterSheet/)
  })

  it('testCases 与 interactions 所有递归叶节点通过时不抛错', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed({
      ...acceptanceMetadata,
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

  it.each(['environment', 'evidenceRevision', 'limitations', 'requiredInteractions'] as const)(
    '缺失权威证据字段 %s 时 fail-closed',
    async (field) => {
      const { assertAcceptancePassed } = await loadAcceptanceResult()
      const report: Record<string, unknown> = {
        ...acceptanceMetadata,
        requiredInteractions: ['filter'],
        testCases: { home: { passed: true } },
        interactions: { filter: { passed: true } },
      }
      delete report[field]

      expect(() => assertAcceptancePassed(report)).toThrow(new RegExp(field))
    },
  )

  it('拒绝非普通对象报告', async () => {
    const { assertAcceptancePassed } = await loadAcceptanceResult()

    expect(() => assertAcceptancePassed([])).toThrow(/普通对象/)
    expect(() => assertAcceptancePassed(null)).toThrow(/普通对象/)
  })
})

describe('MP-106/107 legacy runner 退役', () => {
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
  ] as const)('%s 启动时先使旧报告失效并 fail-closed', (filename, _selectors) => {
    const source = readScript(filename)
    expect(source).toContain('LEGACY_ACCEPTANCE_RETIRED')
    expect(source).toContain("rmSync(reportPath, { force: true })")
    expect(source).toContain('process.exitCode = 1')
    expect(source).not.toContain('miniprogram-automator')
    expect(source).not.toContain('passed: true')
  })

  it('MP-106 对 q、无单位排序保护和价格升降序真实交互 fail-closed', () => {
    const runner = readScript('mp106-acceptance-runner.mjs')
    expect(runner).toContain('由 MP-109 验收替代')
    expect(runner).not.toContain('sortToggle')
  })

  it('MP-107 不再调用或依赖页面测试专用留资方法', () => {
    const runner = readScript('mp107-acceptance-runner.mjs')
    const profile = readFileSync(
      resolve(projectRoot, 'miniprogram/pages/profile/index.ts'),
      'utf8',
    )

    expect(runner).not.toContain('addSampleInquiryForDemo')
    expect(runner).not.toContain('profileData.summary')
    expect(profile).not.toContain('addSampleInquiryForDemo')
    expect(profile).not.toContain('req_demo_01')
  })
})

describe('MP-105/106/107 旧证据不再冒充当前权威验收', () => {
  it('退役 MP-106/107 runner 并删除旧全绿报告，只保留明确的 legacy 说明', () => {
    for (const task of ['MP-106', 'MP-107']) {
      const root = resolve(projectRoot, `../artifacts/verification/${task}`)
      expect(existsSync(resolve(root, 'acceptance-report.json'))).toBe(false)
      expect(existsSync(resolve(root, 'screenshots'))).toBe(false)
      const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
      expect(readme).toMatch(/legacy/i)
      expect(readme).toMatch(/non-authoritative/i)
      expect(readme).toMatch(/incomplete/i)
    }
  })

  it('MP-105 手工手机反馈不冒充 trial、callContainer、设备矩阵或发布条件', () => {
    const root = resolve(projectRoot, '../artifacts/verification/MP-105')
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
    const summary = readme.split('## 2026-09-02 develop')[0]
    const task6 = readFileSync(resolve(root, 'task6-real-device.md'), 'utf8')

    expect(summary).toMatch(/用户手工冒烟反馈/)
    expect(summary).toMatch(/不可审计/)
    expect(task6).toMatch(/平台.*未知|设备.*未知/)
    expect(task6).not.toContain('wx.cloud.callContainer')
    expect(task6).not.toContain('具备发布条件')
    expect(task6).not.toMatch(/真机验收通过|顺利通过/)
  })

  it('路线图不再用历史 MP-105 门阻止已完成的代码实现，只保留真实集成与发布门', () => {
    const roadmap = readFileSync(
      resolve(projectRoot, '../specs/work-items/MP-002-miniprogram-delivery-roadmap.md'),
      'utf8',
    )
    const mp105Plan = readFileSync(
      resolve(projectRoot, '../specs/work-items/MP-105-miniprogram-integration-acceptance-plan.md'),
      'utf8',
    )
    expect(roadmap).not.toContain('MP-106/107 不进入实现、集成或合并')
    expect(roadmap).toMatch(/MP-106\/107.*不得进入真实集成验收或合并发布/)
    expect(mp105Plan).not.toContain('不得开始 MP-106/107 的实现、集成或合并')
    expect(mp105Plan).toMatch(/MP-106\/107.*不得进入真实集成验收或合并发布/)
  })
})

describe('验收 Mock 列表查询合同', () => {
  it('MP-109 证据索引与任务包必须引用聚合报告的当前源码指纹', () => {
    const report = JSON.parse(readFileSync(
      resolve(projectRoot, '../artifacts/verification/MP-109/sheet-acceptance-report.json'),
      'utf8',
    )) as { evidenceRevision?: unknown }
    const readme = readFileSync(
      resolve(projectRoot, '../artifacts/verification/MP-109/README.md'),
      'utf8',
    )
    const taskPacket = readFileSync(
      resolve(projectRoot, '../specs/work-items/MP-109-miniprogram-closure-and-sheet-plan.md'),
      'utf8',
    )

    expect(report.evidenceRevision).toMatch(/^[a-f0-9]{16,64}$/)
    expect(readme).toContain(`\`${String(report.evidenceRevision)}\``)
    expect(taskPacket).toContain(`\`${String(report.evidenceRevision)}\``)
  })

  it('MP-109 UI 任一源码变化都会使旧 profile 指纹失效', async () => {
    const { fingerprintEvidenceSources } = await loadMp109Runner()
    const sources = [
      { path: 'runner.mjs', content: 'runner' },
      { path: 'filter/index.wxss', content: '.option{width:100%}' },
      { path: 'pages/home/index.ts', content: 'Page({})' },
      { path: 'acceptance-mock-server.mjs', content: 'fixture-v1' },
    ]
    const baseline = fingerprintEvidenceSources(sources)
    const uiChanged = fingerprintEvidenceSources(sources.map((source) => source.path === 'pages/home/index.ts'
      ? { ...source, content: 'Page({changed:true})' }
      : source))
    const mockChanged = fingerprintEvidenceSources(sources.map((source) => source.path === 'acceptance-mock-server.mjs'
      ? { ...source, content: 'fixture-v2' }
      : source))

    expect(uiChanged).not.toBe(baseline)
    expect(mockChanged).not.toBe(baseline)
  })

  it('MP-109 中途失败 profile 会覆盖同指纹旧通过态并使聚合保持 incomplete', async () => {
    const { evaluateProfileReports } = await loadMp109Runner()
    const names = [
      'filterPrice', 'filterAll', 'homeInquiry', 'buildingsInquiry', 'inquiryWechat',
      'inquiryManual', 'inquiryKeyboard', 'inquiryError', 'inquirySubmitting', 'inquirySuccess',
    ]
    const states = Object.fromEntries(names.map((name) => [name, { passed: true }]))
    const stalePassed = {
      status: 'passed', evidenceRevision: 'same-revision', viewportProfile: { name: 'small' }, states,
    }
    const failedReplacement = {
      ...stalePassed,
      status: 'failed',
      reason: 'mid-run selector failure',
      states: {},
    }
    const largePassed = {
      status: 'passed', evidenceRevision: 'same-revision', viewportProfile: { name: 'large' }, states,
    }

    expect(evaluateProfileReports({ small: stalePassed, large: largePassed }, 'same-revision').status).toBe('passed')
    const aggregate = evaluateProfileReports({ small: failedReplacement, large: largePassed }, 'same-revision')
    expect(aggregate.status).toBe('incomplete')
    expect(aggregate.failures.join('\n')).toContain('small')
  })

  it('MP-109 缺少视口参数时生成 invalid-invocation 报告而不是保留旧聚合', async () => {
    const { resolveRequestedProfile, buildInvalidInvocationReport } = await loadMp109Runner()
    expect(() => resolveRequestedProfile({})).toThrow('MP109_VIEWPORT_PROFILE')
    const report = buildInvalidInvocationReport('missing profile')
    expect(report).toMatchObject({
      status: 'invalid-invocation',
      reason: 'missing profile',
      states: {},
    })
  })

  it('暴露可探测且不可混淆的验收 fixture 身份', async () => {
    const { ACCEPTANCE_FIXTURE_ID, createAcceptanceServer } = await loadAcceptanceMockServer()
    const mockServer = await createAcceptanceServer(0)

    try {
      const address = mockServer.server.address()
      if (!address || typeof address === 'string') throw new Error('Mock 服务未返回 TCP 监听地址')
      const response = await fetch(`http://127.0.0.1:${address.port}/__acceptance-health`)
      expect(response.headers.get('x-sbh-acceptance-fixture-id')).toBe(ACCEPTANCE_FIXTURE_ID)
      await expect(response.json()).resolves.toEqual({
        ok: true,
        fixtureId: ACCEPTANCE_FIXTURE_ID,
      })
    } finally {
      await mockServer.close()
    }
  })

  it('拒绝复用占用端口但身份不匹配的任意旧服务', async () => {
    const staleServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true, fixtureId: 'stale-or-unrelated' }))
    })
    await new Promise<void>((resolveListen) => staleServer.listen(0, '127.0.0.1', resolveListen))

    try {
      const address = staleServer.address()
      if (!address || typeof address === 'string') throw new Error('旧服务未返回 TCP 监听地址')
      const { probeAcceptanceServer } = await loadMp109Runner()
      await expect(probeAcceptanceServer(address.port)).rejects.toThrow('不是受控 MP-109 fixture')
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => staleServer.close((error) => {
        if (error) rejectClose(error)
        else resolveClose()
      }))
    }
  })

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
