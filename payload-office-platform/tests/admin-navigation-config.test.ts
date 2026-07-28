import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'

type NavigationItem = {
  id: string
  href?: string
  menuCodes?: readonly string[]
  collectionSlug?: string
  children?: readonly NavigationItem[]
}

function collectItems(items: readonly NavigationItem[]): readonly NavigationItem[] {
  return items.flatMap((item) => [item, ...(item.children ? collectItems(item.children) : [])])
}

describe('admin navigation config', () => {
  it('按已确认顺序提供九个一级分组', () => {
    expect(ADMIN_NAV_GROUPS.map((group) => group.label)).toEqual([
      '工作台',
      '房源运营',
      '审核与风控',
      '客户运营',
      '商户合作',
      '团队管理',
      '内容管理',
      '表单中心',
      '系统管理',
    ])
  })

  it('不在主导航暴露归属历史或技术分组名', () => {
    const serialized = JSON.stringify(ADMIN_NAV_GROUPS)
    expect(serialized).not.toContain('lead-ownership-history')
    expect(serialized).not.toContain('workflow')
    expect(serialized).not.toContain('"集合"')
  })

  it('把技术入口收进系统管理的高级工具', () => {
    const system = ADMIN_NAV_GROUPS.find((group) => group.id === 'system')
    const advanced = system?.children.find((item) => item.id === 'advanced-tools')
    expect(advanced?.children?.map((item) => item.collectionSlug)).toEqual([
      'search',
      'domain-events',
      'audit-logs',
    ])
  })

  it('保持唯一 ID、唯一叶子路径和完整菜单权限编码', () => {
    const items = collectItems(ADMIN_NAV_GROUPS)
    const leaves = items.filter((item) => !item.children)

    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
    expect(new Set(leaves.map((item) => item.href)).size).toBe(leaves.length)
    expect(leaves.every((item) => item.menuCodes && item.menuCodes.length > 0)).toBe(true)
  })

  it('从稳定 Collection 路径解析集合标识', () => {
    const collectionLeaves = collectItems(ADMIN_NAV_GROUPS).filter((item) =>
      /^\/admin\/collections\/[^/]+$/.test(item.href ?? ''),
    )

    expect(collectionLeaves.map((item) => item.collectionSlug)).toEqual(
      collectionLeaves.map((item) => item.href?.split('/').at(-1)),
    )
  })

  it('只指向 Payload 配置或插件集合清单中的集合', () => {
    const configuredCollectionSlugs = new Set([
      'users',
      'roles',
      'media',
      'locations',
      'business-area-extensions',
      'merchants',
      'teams',
      'brokers',
      'amenities',
      'buildings',
      'listings',
      'leads',
      'customers',
      'follow-ups',
      'pages',
      'listing-reviews',
      'listing-reports',
      'domain-events',
      'audit-logs',
      'tasks',
      'notifications',
      'search',
      'forms',
      'form-submissions',
    ])
    const collectionSlugs = collectItems(ADMIN_NAV_GROUPS)
      .map((item) => item.collectionSlug)
      .filter((slug): slug is string => typeof slug === 'string')

    expect(collectionSlugs.every((slug) => configuredCollectionSlugs.has(slug))).toBe(true)
  })
})
