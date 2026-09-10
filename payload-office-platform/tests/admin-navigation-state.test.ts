import { describe, expect, it } from 'vitest'

import type { ResolvedAdminNavEntry } from '@/domain/admin-navigation/resolve-navigation'
import {
  deriveOpenGroupId,
  findActiveLeaf,
  findActiveParentKeys,
  shouldCloseNavAfterLeafClick,
  toggleGroupInSet,
  toggleOpenGroup,
} from '@/domain/admin-navigation/navigation-state'

const entries: readonly ResolvedAdminNavEntry[] = [
  {
    kind: 'group',
    id: 'supply',
    label: '房源与楼盘',
    icon: 'building',
    children: [
      {
        id: 'listings',
        label: '房源列表',
        href: '/admin/collections/listings',
      },
      {
        id: 'buildings',
        label: '楼盘库',
        href: '/admin/collections/buildings',
      },
    ],
  },
  {
    kind: 'group',
    id: 'crm',
    label: '客户与线索',
    icon: 'user',
    children: [
      {
        id: 'leads',
        label: '咨询线索',
        href: '/admin/collections/leads',
      },
      {
        id: 'customers',
        label: '客户档案',
        href: '/admin/collections/customers',
      },
    ],
  },
  // 单叶组被解析器扁平化后的形态：它是顶级项，但没有可展开的面板
  {
    kind: 'leaf',
    id: 'amenities',
    label: '配套字典',
    href: '/admin/collections/amenities',
    icon: 'settings',
  },
]

describe('admin navigation state', () => {
  it('详情路径自动展开客户与线索并高亮咨询线索', () => {
    const pathname = '/admin/collections/leads/123'

    expect(findActiveLeaf(entries, pathname)?.id).toBe('leads')
    expect(deriveOpenGroupId(entries, pathname)).toBe('crm')
    expect(findActiveParentKeys(entries, pathname)).toEqual(['crm'])
  })

  it('激活的是扁平叶时没有需要展开的组', () => {
    // 扁平叶不渲染组头，也就没有面板可展——返回它「原本属于哪个组」会让客户端
    // 去展开一个根本没渲染出来的面板。
    expect(findActiveLeaf(entries, '/admin/collections/amenities')?.id).toBe('amenities')
    expect(deriveOpenGroupId(entries, '/admin/collections/amenities')).toBeNull()
    expect(findActiveParentKeys(entries, '/admin/collections/amenities')).toEqual([])
  })

  it('没有任何叶子命中时不返回父级', () => {
    expect(findActiveLeaf(entries, '/admin/collections/unknown')).toBeNull()
    expect(deriveOpenGroupId(entries, '/admin/collections/unknown')).toBeNull()
    expect(findActiveParentKeys(entries, '/admin/collections/unknown')).toEqual([])
  })

  it('多展开模式：展开/收起单个组仅改变对应的 key，不影响其他组', () => {
    const openSet = new Set(['supply', 'crm'])
    const nextSet = toggleGroupInSet(openSet, 'crm')

    expect(nextSet.has('supply')).toBe(true)
    expect(nextSet.has('crm')).toBe(false)
  })

  it('单展开模式下打开一组会关闭另一组，再次点击当前组会折叠', () => {
    expect(toggleOpenGroup('crm', 'supply')).toBe('supply')
    expect(toggleOpenGroup('supply', 'supply')).toBeNull()
  })

  it('路径前缀只在完整分段边界上匹配', () => {
    expect(findActiveLeaf(entries, '/admin/collections/leads-archive')).toBeNull()
    expect(findActiveLeaf(entries, '/admin/collections/leads/123')?.id).toBe('leads')
  })

  it('仅在 Payload smallBreak 移动端抽屉中点击叶子后关闭导航', () => {
    expect(shouldCloseNavAfterLeafClick(true)).toBe(true)
    expect(shouldCloseNavAfterLeafClick(false)).toBe(false)
    expect(shouldCloseNavAfterLeafClick(undefined)).toBe(false)
  })
})
