import { describe, expect, it, vi } from 'vitest'

const { revalidateTag } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidateTag }))

import { IMMEDIATE_CACHE_EXPIRE_PROFILE } from '@/domain/public-catalog'
import { invalidateSupplyImportPublicCache } from '@/lib/frontend/public-cache-revalidation'

/**
 * OPT-041 D11：批量导入写入 Job 完成后 / 批次回滚成功后的缓存失效。
 * 复用 cache-tags.ts 的 cityLevelSafeInvalidationTags——这里只验证
 * invalidateSupplyImportPublicCache 正确调用了 revalidateTag，不重新断言
 * cityLevelSafeInvalidationTags 本身的 tag 组成（那是它自己的测试范围）。
 */
describe('invalidateSupplyImportPublicCache', () => {
  it('给出一个城市 slug → 失效该城市的 home/facets/listings/buildings + sitemap', () => {
    revalidateTag.mockClear()
    invalidateSupplyImportPublicCache(['shanghai'], 'supply_import')
    const calledTags = revalidateTag.mock.calls.map((call) => call[0])
    expect(calledTags).toEqual(
      expect.arrayContaining([
        'public:home:shanghai',
        'public:facets:shanghai',
        'public:listings:city:shanghai',
        'public:buildings:city:shanghai',
        'public:sitemap',
      ]),
    )
    // 档位必须是硬失效（{ expire: 0 }），不是 'max'——'max' 会放行一次陈旧读，
    // 而导入落地的是「确认后立即对外可见」，回滚落地的是止血。
    // 语义与「不要为了消 deprecation 警告改回 'max'」的理由见
    // domain/public-catalog/cache-tags.ts 的 IMMEDIATE_CACHE_EXPIRE_PROFILE 注释。
    expect(revalidateTag).toHaveBeenCalledWith(expect.any(String), IMMEDIATE_CACHE_EXPIRE_PROFILE)
  })

  it('给出多个城市 slug → 每个城市各自失效，去重后调用', () => {
    revalidateTag.mockClear()
    invalidateSupplyImportPublicCache(['shanghai', 'beijing', 'shanghai'], 'supply_import')
    const calledTags = revalidateTag.mock.calls.map((call) => call[0])
    expect(calledTags).toContain('public:home:shanghai')
    expect(calledTags).toContain('public:home:beijing')
    // 去重：'shanghai' 出现两次，但 public:home:shanghai 只应该被调用一次
    expect(calledTags.filter((t) => t === 'public:home:shanghai')).toHaveLength(1)
  })

  it('没有可解析的城市 slug（比如批次快照已被 7 天清理）→ 退化为类目级 + sitemap 全城市兜底', () => {
    revalidateTag.mockClear()
    invalidateSupplyImportPublicCache([], 'supply_import_rollback')
    const calledTags = revalidateTag.mock.calls.map((call) => call[0])
    expect(calledTags).toEqual(
      expect.arrayContaining(['public:listings', 'public:buildings', 'public:sitemap']),
    )
    // 全城市兜底不应该出现具体城市的 home/facets tag
    expect(calledTags.some((t) => t.startsWith('public:home:'))).toBe(false)
  })

  it('全是空白字符串的 slug → 同样退化为全城市兜底，不产出 public:home: 这类畸形 tag', () => {
    revalidateTag.mockClear()
    invalidateSupplyImportPublicCache(['  ', ''], 'supply_import')
    const calledTags = revalidateTag.mock.calls.map((call) => call[0])
    expect(calledTags.some((t) => t.startsWith('public:home:'))).toBe(false)
    expect(calledTags).toContain('public:sitemap')
  })
})
