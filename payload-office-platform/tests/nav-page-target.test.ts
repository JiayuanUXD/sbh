/**
 * 导航「内容页」目标（2026-09-11）
 *
 * 背景：运营在「页面内容」里新建了「加入我们」，页脚配置却选不到它——目标池是
 * 固定枚举，`/pages/[slug]` 在 OPT-054 被列进豁免名单。线上只好拿「城市合伙人」
 * 顶替，结果是一条错链。
 *
 * 这里锁四件事：
 *   1. 目标池多了 `page`，但**不进** `NAV_TARGETS`（否则「池 → 路由」守卫会拿一个
 *      没有固定 href 的目标去比对，要么假红要么被迫豁免）；
 *   2. `resolveNavRow` 对内容页的判据与 C 端 `/pages/[slug]` 的可见条件一致：
 *      未发布 / 已删 / 未展开 / 未选 一律不渲染，不会产出 404 死链；
 *   3. Global 两处（主导航、页脚链接）都挂了 `page` 关联，且只在 target=page 时
 *      出现与校验；
 *   4. 迁移把 `page` 加进两个 PG 枚举并给两张表加了 `page_id`——加进 options
 *      不加枚举值，保存时 PG 直接拒绝。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import {
  NAV_TARGETS,
  NAV_TARGET_OPTIONS,
  PAGE_TARGET_ID,
  resolveNavRow,
} from '@/lib/frontend/nav-targets'
import { SiteSettings } from '@/globals/SiteSettings'

const PUBLISHED_PAGE = {
  id: 7,
  slug: 'join-us',
  title: '加入我们',
  status: 'published',
  deletedAt: null,
}

describe('目标池：page 只进 options，不进 NAV_TARGETS', () => {
  it('后台下拉里能选到「内容页」', () => {
    expect(NAV_TARGET_OPTIONS.some((o) => o.value === PAGE_TARGET_ID)).toBe(true)
  })

  it('NAV_TARGETS 里没有 page（它没有固定 href，进去会污染路由守卫）', () => {
    expect(NAV_TARGETS.some((t) => t.id === PAGE_TARGET_ID)).toBe(false)
  })

  it('options 的 value 唯一', () => {
    const values = NAV_TARGET_OPTIONS.map((o) => o.value)
    expect(values).toEqual([...new Set(values)])
  })
})

describe('resolveNavRow：固定目标（回归）', () => {
  it('已知目标解析成真实 href，label 缺省用目标默认名', () => {
    expect(resolveNavRow({ target: 'entrust' })).toEqual({ href: '/entrust', label: '委托找房' })
    expect(resolveNavRow({ target: 'entrust', label: '找我们帮忙' })).toEqual({
      href: '/entrust',
      label: '找我们帮忙',
    })
  })

  it('隐藏行 / 未知目标 / 非法行都返回 null', () => {
    expect(resolveNavRow({ target: 'entrust', visible: false })).toBeNull()
    expect(resolveNavRow({ target: 'not-a-target' })).toBeNull()
    expect(resolveNavRow({ label: '没有 target' })).toBeNull()
    expect(resolveNavRow(null)).toBeNull()
    expect(resolveNavRow('entrust')).toBeNull()
  })
})

describe('resolveNavRow：内容页', () => {
  it('已发布页面解析成 /pages/<slug>，label 缺省用页面标题', () => {
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page: PUBLISHED_PAGE })).toEqual({
      href: '/pages/join-us',
      label: '加入我们',
    })
  })

  it('运营填了显示文字就用运营的', () => {
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page: PUBLISHED_PAGE, label: '招聘' })).toEqual({
      href: '/pages/join-us',
      label: '招聘',
    })
  })

  it('slug 会做 URL 编码（与 /pages/[slug] 的 canonical 一致）', () => {
    const page = { ...PUBLISHED_PAGE, slug: '关于 我们' }
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page })?.href).toBe(
      `/pages/${encodeURIComponent('关于 我们')}`,
    )
  })

  it('草稿页不渲染——导航里出现的链接点进去必须是 200', () => {
    const page = { ...PUBLISHED_PAGE, status: 'draft' }
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page })).toBeNull()
  })

  it('回收站里的页面不渲染', () => {
    const page = { ...PUBLISHED_PAGE, deletedAt: '2026-09-11T00:00:00.000Z' }
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page })).toBeNull()
  })

  it('关联没展开（只拿到数字 id）或没选页面时不渲染，也不抛错', () => {
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page: 7 })).toBeNull()
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page: null })).toBeNull()
    expect(resolveNavRow({ target: PAGE_TARGET_ID })).toBeNull()
  })

  it('页面没有 slug 时不渲染（拼不出合法路径）', () => {
    const page = { ...PUBLISHED_PAGE, slug: '' }
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page })).toBeNull()
  })

  it('隐藏优先于一切', () => {
    expect(resolveNavRow({ target: PAGE_TARGET_ID, page: PUBLISHED_PAGE, visible: false })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Global 字段结构
// ---------------------------------------------------------------------------

type AnyField = Record<string, unknown> & { fields?: AnyField[]; tabs?: AnyField[] }

function findField(name: string, root: AnyField[] = SiteSettings.fields as AnyField[]): AnyField | null {
  const stack: AnyField[] = [...root]
  while (stack.length > 0) {
    const f = stack.pop()!
    if (f.name === name) return f
    if (Array.isArray(f.fields)) stack.push(...f.fields)
    if (Array.isArray(f.tabs)) stack.push(...f.tabs)
  }
  return null
}

function linkRowFields(): Array<{ where: string; fields: AnyField[] }> {
  const mainNav = findField('mainNav')
  const footerColumns = findField('footerColumns')
  const links = footerColumns ? findField('links', footerColumns.fields ?? []) : null
  expect(mainNav?.fields).toBeDefined()
  expect(links?.fields).toBeDefined()
  return [
    { where: 'mainNav', fields: mainNav!.fields! },
    { where: 'footerColumns.links', fields: links!.fields! },
  ]
}

describe('SiteSettings：主导航与页脚链接都挂了 page 关联', () => {
  it('page 是指向 pages 的 relationship，紧跟 target 之后', () => {
    for (const { where, fields } of linkRowFields()) {
      const names = fields.map((f) => f.name)
      const targetIdx = names.indexOf('target')
      const pageIdx = names.indexOf('page')
      expect(pageIdx, `${where} 缺 page 字段`).toBeGreaterThan(-1)
      expect(pageIdx, `${where} 的 page 应紧跟 target`).toBe(targetIdx + 1)
      const page = fields[pageIdx]
      expect(page.type).toBe('relationship')
      expect(page.relationTo).toBe('pages')
      expect(page.required, '不能 required：非内容页的行没有页面可选').not.toBe(true)
      expect(page.filterOptions, 'filterOptions 是保存时硬校验，已链接页转草稿会让整份设置改不动').toBeUndefined()
    }
  })

  it('target 的 options 与 NAV_TARGET_OPTIONS 同源', () => {
    for (const { fields } of linkRowFields()) {
      const target = fields.find((f) => f.name === 'target')
      expect(target?.options).toBe(NAV_TARGET_OPTIONS)
    }
  })

  it('page 只在 target=page 时显示', () => {
    for (const { fields } of linkRowFields()) {
      const page = fields.find((f) => f.name === 'page')!
      const condition = (page.admin as { condition: (d: unknown, s: unknown) => boolean }).condition
      expect(condition({}, { target: PAGE_TARGET_ID })).toBe(true)
      expect(condition({}, { target: 'entrust' })).toBe(false)
      expect(condition({}, undefined)).toBe(false)
    }
  })

  it('选了「内容页」却没指定页面 → 保存被拦；其它目标不管 page 是否为空', () => {
    for (const { fields } of linkRowFields()) {
      const page = fields.find((f) => f.name === 'page')!
      const validate = page.validate as (
        value: unknown,
        opts: { siblingData?: unknown },
      ) => true | string
      expect(typeof validate(null, { siblingData: { target: PAGE_TARGET_ID } })).toBe('string')
      expect(validate(undefined, { siblingData: { target: PAGE_TARGET_ID } })).not.toBe(true)
      expect(validate(7, { siblingData: { target: PAGE_TARGET_ID } })).toBe(true)
      expect(validate(null, { siblingData: { target: 'entrust' } })).toBe(true)
      expect(validate(null, { siblingData: undefined })).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Pages 变更要一起失效站点设置缓存
// ---------------------------------------------------------------------------

vi.mock('@/lib/frontend/public-cache-revalidation', () => ({
  invalidatePagePublicCache: vi.fn(),
  invalidateSiteSettingsPublicCache: vi.fn(),
}))

describe('Pages 的 afterChange / afterDelete 同时失效站点设置', () => {
  it('页面转草稿或删除后，导航里的入口不用等 60 秒过期', async () => {
    const revalidation = await import('@/lib/frontend/public-cache-revalidation')
    const { Pages } = await import('@/collections/Pages')
    const hooks = [...(Pages.hooks?.afterChange ?? []), ...(Pages.hooks?.afterDelete ?? [])]
    expect(hooks.length).toBe(2)
    for (const hook of hooks) {
      await (hook as () => Promise<void>)()
    }
    expect(vi.mocked(revalidation.invalidatePagePublicCache)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(revalidation.invalidateSiteSettingsPublicCache)).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// 迁移
// ---------------------------------------------------------------------------

describe('迁移：page 进两个 PG 枚举，两张表加 page_id', () => {
  it('20260911_031639_nav_page_target 的 up() 覆盖主导航与页脚链接', async () => {
    const file = fileURLToPath(
      new URL('../src/migrations/20260911_031639_nav_page_target.ts', import.meta.url),
    )
    const src = await readFile(file, 'utf8')
    const up = src.slice(src.indexOf('export async function up'), src.indexOf('export async function down'))
    expect(up).toMatch(/ALTER TYPE "public"\."enum_site_settings_main_nav_target" ADD VALUE 'page'/)
    expect(up).toMatch(
      /ALTER TYPE "public"\."enum_site_settings_footer_columns_links_target" ADD VALUE 'page'/,
    )
    expect(up).toMatch(/ALTER TABLE "site_settings_main_nav" ADD COLUMN "page_id" integer/)
    expect(up).toMatch(/ALTER TABLE "site_settings_footer_columns_links" ADD COLUMN "page_id" integer/)
    // 页面被硬删时把引用置空，而不是让删除失败或留下悬空 id
    expect(up.match(/REFERENCES "public"\."pages"\("id"\) ON DELETE set null/g)?.length).toBe(2)
  })
})
