/**
 * F6.1 单测：Page mapper + Facade（getPageBySlug / listPublishedPages）
 *
 * 设计依据：specs/frontend-mvp/tasks.md F6.1、F6.4
 *           specs/frontend-mvp/design.md §3.1、§7、§11
 *           docs/prd/前台网站_MVP_页面PRD/06-内容页_PRD.md §2–§5
 *
 * 守护不变量：
 *   - PageDetailViewModel 字段白名单：不暴露 _status / trash / createdBy /
 *     lastModifiedBy / deletedAt / createdAt 等内部字段；
 *   - 草稿、删除或未发布的页面不应进入 DTO（由 SupplyAdapter 过滤）；
 *   - mapper 接收 unknown，类型守卫收窄，任何字段缺失都返回 null 而非抛错；
 *   - listPublishedPages 返回摘要 DTO（仅 id / slug / updatedAt）。
 */

import { describe, expect, it } from 'vitest'
import {
  getPageBySlug,
  listPublishedPages,
  mapPageDetail,
  mapPageSummary,
  type SupplyAdapter,
} from '@/domain/public-catalog'
import { defaultSearchContext } from '@/domain/public-catalog'
import type { Page } from '@/payload-types'
import {
  PAGE_DELETED,
  PAGE_DRAFT,
  PAGE_PUBLISHED_GUIDE,
  PAGE_PUBLISHED_HOME,
} from '@/test/frontend/payload-documents'

const ctx = defaultSearchContext(new Date('2026-07-25T00:00:00Z'))

// ---------------------------------------------------------------------------
// 内存版 SupplyAdapter（仅覆盖 Page 方法）
// ---------------------------------------------------------------------------

function createFakePageAdapter(options: {
  pages: readonly Page[]
}): SupplyAdapter {
  return {
    async findEffectiveListings() {
      return []
    },
    async findEffectiveListingBySlug() {
      return null
    },
    async findEffectiveBuildingBySlug() {
      return null
    },
    async findEffectiveListingsByBuilding() {
      return []
    },
    async sumEffectiveLeasableAreaByBuildings() {
      return new Map<string, number>()
    },
    async findEffectiveBuildingsNear() {
      return []
    },
    async findEffectiveBuildings() {
      return []
    },
    async findFeaturedListings() {
      return []
    },
    async findFeaturedBuildings() {
      return []
    },
    async findLatestArticles() {
      return []
    },
    async findPublishedArticles() {
      return { docs: [], totalDocs: 0 }
    },
    async findPublishedArticleBySlug() {
      return null
    },
    async findEffectiveDistricts() {
      return []
    },
    async assertEffectiveListingBySlug() {
      return null
    },
    async findPublishedPageBySlug(slug) {
      const p = options.pages.find((x) => x.slug === slug)
      if (!p) return null
      if (p.status !== 'published') return null
      if (p.deletedAt) return null
      return p
    },
    async findPublishedPages() {
      return options.pages.filter((p) => p.status === 'published' && !p.deletedAt)
    },
  }
}

// ---------------------------------------------------------------------------
// mapPageDetail
// ---------------------------------------------------------------------------

describe('mapPageDetail', () => {
  it('已发布页面映射为 PageDetailViewModel，保留 hero / content / seo', () => {
    const vm = mapPageDetail(PAGE_PUBLISHED_GUIDE)
    expect(vm).not.toBeNull()
    if (!vm) return
    expect(vm.id).toBe(5001)
    expect(vm.slug).toBe('office-guide')
    expect(vm.title).toBe('上海办公选址指南')
    expect(vm.status).toBe('published')
    expect(vm.stableSortKey).toBe('page-5001')
    expect(vm.updatedAt).toBe('2026-07-20T00:00:00.000Z')

    expect(vm.hero.eyebrow).toBe('办公指南')
    expect(vm.hero.heading).toBe('上海办公选址指南')
    expect(vm.hero.summary).toContain('从区域到户型')
    expect(vm.hero.image).not.toBeNull()
    expect(vm.hero.image?.src).toBe('/media/cover-jingan-center.jpg')

    expect(vm.seo.title).toBe('上海办公选址指南 · 商办租赁')
    expect(vm.seo.description).toContain('上海办公选址完整指南')

    expect(vm.content).not.toBeNull()
  })

  it('字段白名单：不暴露内部敏感字段', () => {
    const vm = mapPageDetail(PAGE_PUBLISHED_GUIDE)
    if (!vm) return
    const vmKeys = Object.keys(vm)
    // 不应包含审核、删除、创建人等内部字段
    expect(vmKeys).not.toContain('createdBy')
    expect(vmKeys).not.toContain('lastModifiedBy')
    expect(vmKeys).not.toContain('deletedAt')
    expect(vmKeys).not.toContain('createdAt')
    expect(vmKeys).not.toContain('_status')
    expect(vmKeys).not.toContain('trash')
  })

  it('hero.image 为 null 时不抛错', () => {
    const vm = mapPageDetail(PAGE_PUBLISHED_HOME)
    expect(vm).not.toBeNull()
    if (!vm) return
    expect(vm.hero.image).toBeNull()
    expect(vm.hero.summary).toBeNull()
  })

  it('content 为 null 时 vm.content 也为 null', () => {
    const vm = mapPageDetail(PAGE_PUBLISHED_HOME)
    expect(vm).not.toBeNull()
    if (!vm) return
    expect(vm.content).toBeNull()
  })

  it('非法输入返回 null（不抛错）', () => {
    expect(mapPageDetail(null)).toBeNull()
    expect(mapPageDetail(undefined)).toBeNull()
    expect(mapPageDetail({})).toBeNull()
    expect(mapPageDetail({ id: 'x' })).toBeNull()
    expect(mapPageDetail({ id: 1, slug: 123, title: 'x' })).toBeNull()
    expect(mapPageDetail({ id: 1, slug: 's', title: 123 })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// mapPageSummary
// ---------------------------------------------------------------------------

describe('mapPageSummary', () => {
  it('摘要 DTO 仅暴露 id / slug / updatedAt', () => {
    const s = mapPageSummary(PAGE_PUBLISHED_GUIDE)
    expect(s).not.toBeNull()
    if (!s) return
    expect(s.id).toBe(5001)
    expect(s.slug).toBe('office-guide')
    expect(s.updatedAt).toBe('2026-07-20T00:00:00.000Z')
    const sKeys = Object.keys(s)
    expect(sKeys).toEqual(['id', 'slug', 'updatedAt'])
  })

  it('摘要 DTO 不暴露 content / hero / seo', () => {
    const s = mapPageSummary(PAGE_PUBLISHED_GUIDE)
    if (!s) return
    const sKeys = Object.keys(s)
    expect(sKeys).not.toContain('content')
    expect(sKeys).not.toContain('hero')
    expect(sKeys).not.toContain('seo')
  })

  it('非法输入返回 null', () => {
    expect(mapPageSummary(null)).toBeNull()
    expect(mapPageSummary({})).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getPageBySlug
// ---------------------------------------------------------------------------

describe('getPageBySlug', () => {
  it('已发布页面返回 PageDetailViewModel', async () => {
    const adapter = createFakePageAdapter({
      pages: [PAGE_PUBLISHED_GUIDE, PAGE_PUBLISHED_HOME],
    })
    const vm = await getPageBySlug('office-guide', ctx, adapter)
    expect(vm).not.toBeNull()
    if (!vm) return
    expect(vm.slug).toBe('office-guide')
    expect(vm.title).toBe('上海办公选址指南')
  })

  it('不存在的 slug 返回 null（路由层应 notFound）', async () => {
    const adapter = createFakePageAdapter({
      pages: [PAGE_PUBLISHED_GUIDE],
    })
    const vm = await getPageBySlug('not-exist', ctx, adapter)
    expect(vm).toBeNull()
  })

  it('草稿页面返回 null（不暴露草稿内容）', async () => {
    const adapter = createFakePageAdapter({
      pages: [PAGE_DRAFT],
    })
    const vm = await getPageBySlug('draft-page', ctx, adapter)
    expect(vm).toBeNull()
  })

  it('已删除页面返回 null（不暴露已删除内容）', async () => {
    const adapter = createFakePageAdapter({
      pages: [PAGE_DELETED],
    })
    const vm = await getPageBySlug('deleted-page', ctx, adapter)
    expect(vm).toBeNull()
  })

  it('home slug 同样经过发布过滤', async () => {
    const adapter = createFakePageAdapter({
      pages: [PAGE_PUBLISHED_HOME],
    })
    const vm = await getPageBySlug('home', ctx, adapter)
    expect(vm).not.toBeNull()
    if (!vm) return
    expect(vm.slug).toBe('home')
  })
})

// ---------------------------------------------------------------------------
// listPublishedPages
// ---------------------------------------------------------------------------

describe('listPublishedPages', () => {
  it('仅返回已发布且未删除的页面摘要', async () => {
    const adapter = createFakePageAdapter({
      pages: [PAGE_PUBLISHED_GUIDE, PAGE_PUBLISHED_HOME, PAGE_DRAFT, PAGE_DELETED],
    })
    const list = await listPublishedPages(ctx, {}, adapter)
    expect(list).toHaveLength(2)
    const slugs = list.map((p) => p.slug).sort()
    expect(slugs).toEqual(['home', 'office-guide'])
  })

  it('空数据集返回空数组', async () => {
    const adapter = createFakePageAdapter({ pages: [] })
    const list = await listPublishedPages(ctx, {}, adapter)
    expect(list).toEqual([])
  })

  it('摘要 DTO 仅暴露 id / slug / updatedAt', async () => {
    const adapter = createFakePageAdapter({
      pages: [PAGE_PUBLISHED_GUIDE],
    })
    const list = await listPublishedPages(ctx, {}, adapter)
    expect(list).toHaveLength(1)
    const keys = Object.keys(list[0])
    expect(keys).toEqual(['id', 'slug', 'updatedAt'])
  })

  it('limit 参数传递给 adapter', async () => {
    let capturedLimit: number | undefined
    const adapter: SupplyAdapter = {
      ...createFakePageAdapter({ pages: [PAGE_PUBLISHED_GUIDE] }),
      async findPublishedPages(_ctx, limit) {
        capturedLimit = limit
        return [PAGE_PUBLISHED_GUIDE]
      },
    }
    await listPublishedPages(ctx, { limit: 50 }, adapter)
    expect(capturedLimit).toBe(50)
  })
})
