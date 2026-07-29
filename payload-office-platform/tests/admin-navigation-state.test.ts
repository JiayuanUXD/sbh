import { describe, expect, it } from 'vitest'

import type { ResolvedAdminNavGroup } from '@/domain/admin-navigation/resolve-navigation'
import {
  deriveOpenGroupId,
  findActiveLeaf,
  shouldCloseNavAfterLeafClick,
  toggleOpenGroup,
} from '@/domain/admin-navigation/navigation-state'

const groups: readonly ResolvedAdminNavGroup[] = [
  {
    id: 'supply',
    label: '房源运营',
    children: [
      {
        id: 'listings',
        label: '房源列表',
        href: '/admin/collections/listings',
      },
      {
        id: 'supply-settings',
        label: '基础配置',
        children: [
          {
            id: 'locations',
            label: '行政区域',
            href: '/admin/collections/locations',
          },
        ],
      },
    ],
  },
  {
    id: 'crm',
    label: '客户运营',
    children: [
      {
        id: 'leads',
        label: '咨询线索',
        href: '/admin/collections/leads',
      },
    ],
  },
  {
    id: 'system',
    label: '系统管理',
    children: [
      {
        id: 'advanced-tools',
        label: '高级工具',
        children: [
          {
            id: 'audit-logs',
            label: '审计日志',
            href: '/admin/collections/audit-logs',
          },
        ],
      },
    ],
  },
]

describe('admin navigation state', () => {
  it('详情路径自动展开客户运营并高亮咨询线索', () => {
    const pathname = '/admin/collections/leads/123'

    expect(findActiveLeaf(groups, pathname)?.id).toBe('leads')
    expect(deriveOpenGroupId(groups, pathname)).toBe('crm')
  })

  it('打开房源运营会关闭客户运营，再次点击当前组会折叠', () => {
    expect(toggleOpenGroup('crm', 'supply')).toBe('supply')
    expect(toggleOpenGroup('supply', 'supply')).toBeNull()
  })

  it('基础配置与高级工具不成为默认展开的一级组', () => {
    expect(deriveOpenGroupId(groups, '/admin/collections/locations/2')).toBe('supply')
    expect(deriveOpenGroupId(groups, '/admin/collections/audit-logs/8')).toBe('system')
  })

  it('路径前缀只在完整分段边界上匹配', () => {
    expect(findActiveLeaf(groups, '/admin/collections/leads-archive')).toBeNull()
    expect(findActiveLeaf(groups, '/admin/collections/leads/123')?.id).toBe('leads')
  })

  it('仅在 Payload smallBreak 移动端抽屉中点击叶子后关闭导航', () => {
    expect(shouldCloseNavAfterLeafClick(true)).toBe(true)
    expect(shouldCloseNavAfterLeafClick(false)).toBe(false)
    expect(shouldCloseNavAfterLeafClick(undefined)).toBe(false)
  })
})
