import { describe, expect, it } from 'vitest'

import type { AdminNavigationBadgeCounts } from '@/domain/admin-navigation/navigation-badge-request'
import {
  DEFAULT_OPEN_GROUP_IDS,
  defaultOpenGroupIds,
  groupHasWarningBadge,
  parseStoredOpenGroups,
  sumGroupBadges,
} from '@/domain/admin-navigation/navigation-state'
import type {
  ResolvedAdminNavEntry,
  ResolvedAdminNavGroup,
} from '@/domain/admin-navigation/resolve-navigation'

const WARNING_KEYS: ReadonlySet<string> = new Set([
  'listingReviews',
  'listingReports',
  'leads',
  'formSubmissions',
  'supplySubmissions',
  'informationCorrections',
])

const inboxGroup: ResolvedAdminNavGroup = {
  kind: 'group',
  id: 'inbox',
  label: '待处理',
  icon: 'inbox',
  children: [
    {
      id: 'listing-reviews',
      label: '房源审核',
      href: '/admin/collections/listings',
      badgeKey: 'listingReviews',
    },
    {
      id: 'notifications',
      label: '消息通知',
      href: '/admin/collections/notifications',
      badgeKey: 'notifications',
    },
    // 没有 badgeKey 的叶子：求和时必须被跳过，而不是当成 0 之外的任何东西
    {
      id: 'my-todos',
      label: '我的待办',
      href: '/admin/my-todos',
    },
  ],
}

const supplyGroup: ResolvedAdminNavGroup = {
  kind: 'group',
  id: 'supply',
  label: '房源与楼盘',
  icon: 'building',
  children: [
    { id: 'listings', label: '房源列表', href: '/admin/collections/listings' },
    { id: 'buildings', label: '楼盘库', href: '/admin/collections/buildings' },
  ],
}

const crmGroup: ResolvedAdminNavGroup = {
  kind: 'group',
  id: 'crm',
  label: '客户与线索',
  icon: 'user',
  children: [
    { id: 'leads', label: '咨询线索', href: '/admin/collections/leads', badgeKey: 'leads' },
    { id: 'customers', label: '客户档案', href: '/admin/collections/customers' },
  ],
}

const entries: readonly ResolvedAdminNavEntry[] = [
  inboxGroup,
  supplyGroup,
  crmGroup,
  // 单叶组被解析器扁平化后的顶级项：它没有可展开的面板，因此永远不能进展开集
  {
    kind: 'leaf',
    id: 'amenities',
    label: '配套字典',
    href: '/admin/collections/amenities',
    icon: 'settings',
  },
]

describe('sumGroupBadges', () => {
  it('把子叶的角标计数求和', () => {
    const counts: AdminNavigationBadgeCounts = { listingReviews: 3, notifications: 2 }

    expect(sumGroupBadges(inboxGroup, counts)).toBe(5)
  })

  it('缺席的计数按 0 计，不影响其它子叶', () => {
    // Task 3 之前 supplySubmissions / informationCorrections 这类 key 根本不会返回，
    // 缺席必须等价于 0——否则组头会因为一个未实现的查询而整体不显示。
    const counts: AdminNavigationBadgeCounts = { listingReviews: 4 }

    expect(sumGroupBadges(inboxGroup, counts)).toBe(4)
  })

  it('忽略没有 badgeKey 的叶子', () => {
    expect(sumGroupBadges(supplyGroup, { listingReviews: 9 })).toBe(0)
  })

  it('全组无数据时为 0', () => {
    expect(sumGroupBadges(inboxGroup, {})).toBe(0)
  })
})

describe('groupHasWarningBadge', () => {
  it('任一 warning 子叶计数大于 0 即为 true', () => {
    expect(groupHasWarningBadge(inboxGroup, { listingReviews: 1 }, WARNING_KEYS)).toBe(true)
  })

  it('warning 子叶计数为 0 时为 false', () => {
    // 组头只在「真的有待处理」时变警示色；计数为 0 的 warning key 不算
    expect(
      groupHasWarningBadge(inboxGroup, { listingReviews: 0, notifications: 7 }, WARNING_KEYS),
    ).toBe(false)
  })

  it('只有非 warning 子叶有数据时为 false', () => {
    expect(groupHasWarningBadge(inboxGroup, { notifications: 7 }, WARNING_KEYS)).toBe(false)
  })

  it('组内没有任何角标键时为 false', () => {
    expect(groupHasWarningBadge(supplyGroup, { listingReviews: 5 }, WARNING_KEYS)).toBe(false)
  })
})

describe('defaultOpenGroupIds', () => {
  it('默认展开「待处理」与「房源与楼盘」', () => {
    expect(DEFAULT_OPEN_GROUP_IDS).toEqual(['inbox', 'supply'])
    expect([...defaultOpenGroupIds(entries, '/admin')].sort()).toEqual(['inbox', 'supply'])
  })

  it('默认集里的组当前不存在（权限筛掉或被扁平化）时不出现在结果里', () => {
    const withoutInbox = entries.filter((entry) => entry.id !== 'inbox')

    expect([...defaultOpenGroupIds(withoutInbox, '/admin')]).toEqual(['supply'])
  })

  it('并入当前激活路径所在的组', () => {
    expect([...defaultOpenGroupIds(entries, '/admin/collections/leads/123')].sort()).toEqual([
      'crm',
      'inbox',
      'supply',
    ])
  })

  it('激活的是扁平叶时不额外展开任何组', () => {
    expect([...defaultOpenGroupIds(entries, '/admin/collections/amenities')].sort()).toEqual([
      'inbox',
      'supply',
    ])
  })
})

describe('parseStoredOpenGroups', () => {
  it('读回合法的组 id 数组', () => {
    expect([...(parseStoredOpenGroups('["inbox","crm"]', entries) ?? [])].sort()).toEqual([
      'crm',
      'inbox',
    ])
  })

  it('过滤掉当前已不存在的组 id', () => {
    // 权限变化或导航改版后，存储里会残留早已不存在的组 id
    expect([...(parseStoredOpenGroups('["inbox","legacy-group"]', entries) ?? [])]).toEqual([
      'inbox',
    ])
  })

  it('过滤掉扁平叶的 id——它没有可展开的面板', () => {
    expect([...(parseStoredOpenGroups('["amenities"]', entries) ?? [])]).toEqual([])
  })

  it('空数组是合法的「用户把所有组都收起来了」，不是首次进入', () => {
    // 必须与 null 区分开：返回 null 会让调用方回落到默认展开集，
    // 用户每次刷新都会看到自己刚刚关掉的两个组又展开了。
    const parsed = parseStoredOpenGroups('[]', entries)

    expect(parsed).not.toBeNull()
    expect([...(parsed ?? [])]).toEqual([])
  })

  it('没有存储值时返回 null', () => {
    expect(parseStoredOpenGroups(null, entries)).toBeNull()
    expect(parseStoredOpenGroups(undefined, entries)).toBeNull()
  })

  it('坏 JSON 返回 null', () => {
    expect(parseStoredOpenGroups('{not json', entries)).toBeNull()
  })

  it('JSON 合法但不是数组时返回 null', () => {
    expect(parseStoredOpenGroups('{"inbox":true}', entries)).toBeNull()
    expect(parseStoredOpenGroups('"inbox"', entries)).toBeNull()
  })

  it('数组里的非字符串元素被过滤，不影响其余合法 id', () => {
    expect([...(parseStoredOpenGroups('["inbox",1,null,{}]', entries) ?? [])]).toEqual(['inbox'])
  })
})
