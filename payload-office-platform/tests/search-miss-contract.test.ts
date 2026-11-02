/**
 * OPT-126 P1 边界契约：查询文本只走自有端点，永远不进 Umami。
 *
 * 配合 #243 的 `search-analytics-contract.test.ts`（守住 Umami 白名单里没有文本属性），
 * 这里守住另一侧：采集信标不碰统计管道，也不被并进 SearchAnalytics。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { SEARCH_MISS_RETENTION_DAYS } from '@/lib/search-miss/prune-search-miss'

const read = (relative: string) => readFileSync(path.join(__dirname, '..', relative), 'utf8')

describe('SearchMissBeacon 边界', () => {
  const beacon = read('src/components/frontend/search/SearchMissBeacon.tsx')
  const beaconPlan = read('src/lib/search-miss/beacon-plan.ts')

  it('不引用埋点管道，不调用 track()', () => {
    for (const source of [beacon, beaconPlan]) {
      expect(source).not.toMatch(/from ['"]@\/lib\/frontend\/analytics/)
      expect(source).not.toMatch(/\btrack\s*\(/)
    }
  })

  it('请求体只有 { city, q }，端点是自有 /api/search-misses', () => {
    expect(beaconPlan).toContain("'/api/search-misses'")
    expect(beacon).toContain('JSON.stringify(plan.body)')
  })

  it('由 SiteSearchView 独立挂载，SearchAnalytics 里没有 beacon', () => {
    const view = read('src/components/frontend/search/SiteSearchView.tsx')
    const analytics = read('src/components/frontend/search/SearchAnalytics.tsx')
    expect(view).toContain('<SearchMissBeacon')
    expect(analytics).not.toMatch(/sendBeacon|search-misses|SearchMissBeacon/)
  })
})

describe('隐私政策页', () => {
  const privacy = read('src/app/(frontend)/pages/privacy/page.tsx')

  it('说明了未命中关键词的记录、过滤与不关联身份', () => {
    expect(privacy).toContain('未检索到结果的搜索关键词')
    expect(privacy).toContain('不关联您的身份')
    expect(privacy).toContain('不会保存')
  })

  it('保留期天数与清理常量一致（改一边必须改另一边）', () => {
    expect(privacy).toContain(`满 ${SEARCH_MISS_RETENTION_DAYS.once} 天后删除`)
    expect(privacy).toContain(`最长保留 ${SEARCH_MISS_RETENTION_DAYS.repeated} 天`)
  })

  it('不再声称「统计里完全不含搜索词」而与采集矛盾', () => {
    expect(privacy).not.toMatch(/不记录您输入的搜索词、留言或联系方式。统计标识/)
  })
})
