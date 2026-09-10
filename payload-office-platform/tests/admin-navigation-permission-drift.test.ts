/**
 * 导航重组不得顺带改权限（OPT-084 Phase 1 的 G1 守卫）
 *
 * 本次改的是分组、顺序、层级和渲染规则，**每片叶子的权限判据一个字都不该动**。
 * 但把四十条 leaf(...) 在文件里搬来搬去时，漏抄一个 requiredOperationCode、
 * 把 menuCodes 抄成隔壁那条的，都不会有任何红灯：typecheck 过、既有单测按标签断言
 * 也过——只有真的用某个角色登录才看得出「某个入口凭空多出来/凭空消失」。
 *
 * 所以把 master 那一版的叶子定义原样固化在下面，逐字段比对。这不是快照测试的
 * 「把现状固化成期望」——固化的是**改动前**的状态，正好是本次不允许变的那部分。
 *
 * fixture 来源：`git show c76e6d9:payload-office-platform/src/domain/admin-navigation/navigation-config.ts`
 * （c76e6d9 = 本分支的 origin/master 基线）。collectionSlug 一栏写的是 leaf() 助手
 * 推导之后的实际值（`/admin/collections/<slug>` 形态会自动补上）。
 *
 * 允许的差异只有三处，全部在下面的常量里显式列出：
 *   1. `domain-events` 叶退出导航（裁定 2：collection 与权限码都保留，只是不再有入口）
 *   2. `information-corrections` 新增 badgeKey
 *   3. `supply-submissions` 新增 badgeKey
 * 除此之外任何一处不同都应判红——包括「看起来更合理」的修改。
 */

import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'
import type { AdminNavLeaf } from '@/domain/admin-navigation/navigation-types'

type LeafFixture = {
  id: string
  label: string
  href: string
  menuCodes: readonly string[]
  collectionSlug?: string
  requiredOperationCode?: string
  badgeKey?: string
}

/** master（c76e6d9）上的 40 片叶子，按配置文件里的出现顺序。 */
const MASTER_LEAVES: readonly LeafFixture[] = [
  { id: 'overview', label: '运营概览', href: '/admin', menuCodes: ['dashboard'] },
  {
    id: 'my-tasks',
    label: '我的待办',
    href: '/admin/collections/tasks',
    menuCodes: ['todos'],
    collectionSlug: 'tasks',
    requiredOperationCode: 'task:read',
    badgeKey: 'tasks',
  },
  {
    id: 'notifications',
    label: '消息通知',
    href: '/admin/collections/notifications',
    menuCodes: ['notifications'],
    collectionSlug: 'notifications',
    requiredOperationCode: 'notification:read',
    badgeKey: 'notifications',
  },
  { id: 'analytics', label: '数据看板', href: '/admin/analytics', menuCodes: ['analytics'] },
  {
    id: 'listings',
    label: '房源列表',
    href: '/admin/collections/listings',
    menuCodes: ['listings'],
    collectionSlug: 'listings',
  },
  {
    id: 'buildings',
    label: '楼盘库',
    href: '/admin/collections/buildings',
    menuCodes: ['buildings'],
    collectionSlug: 'buildings',
  },
  {
    id: 'supply-submissions',
    label: '房源投放申请',
    href: '/admin/collections/supply-submissions',
    menuCodes: ['supply-submissions'],
    collectionSlug: 'supply-submissions',
    requiredOperationCode: 'supply_submission:read',
  },
  {
    id: 'import-buildings',
    label: '楼盘批量导入',
    href: '/admin/import/buildings',
    menuCodes: ['buildings'],
    requiredOperationCode: 'data:import',
  },
  {
    id: 'import-listings',
    label: '房源批量导入',
    href: '/admin/import/listings',
    menuCodes: ['listings'],
    requiredOperationCode: 'data:import',
  },
  {
    id: 'supply-import-batches',
    label: '导入批次',
    href: '/admin/collections/supply-import-batches',
    menuCodes: ['listings'],
    collectionSlug: 'supply-import-batches',
    requiredOperationCode: 'data:import',
  },
  {
    id: 'cities',
    label: '城市管理',
    href: '/admin/geography/cities',
    menuCodes: ['locations'],
    collectionSlug: 'locations',
  },
  {
    id: 'districts',
    label: '行政区域',
    href: '/admin/geography/districts',
    menuCodes: ['locations'],
    collectionSlug: 'locations',
  },
  {
    id: 'business-areas',
    label: '商圈管理',
    href: '/admin/geography/business-areas',
    menuCodes: ['business-areas'],
    collectionSlug: 'locations',
  },
  {
    id: 'metro-lines',
    label: '地铁管理',
    href: '/admin/geography/metro-lines',
    menuCodes: ['locations'],
    collectionSlug: 'locations',
  },
  {
    id: 'location-aliases',
    label: '地理别名',
    href: '/admin/collections/location-aliases',
    menuCodes: ['locations'],
    collectionSlug: 'location-aliases',
    requiredOperationCode: 'location:manage',
  },
  {
    id: 'listing-reviews',
    label: '审核队列',
    href: '/admin/collections/listing-reviews',
    menuCodes: ['listing-reviews'],
    collectionSlug: 'listing-reviews',
    badgeKey: 'listingReviews',
  },
  {
    id: 'listing-reports',
    label: '举报处理',
    href: '/admin/collections/listing-reports',
    menuCodes: ['reports'],
    collectionSlug: 'listing-reports',
    badgeKey: 'listingReports',
  },
  {
    id: 'information-corrections',
    label: '信息纠错',
    href: '/admin/collections/information-corrections',
    menuCodes: ['reports'],
    collectionSlug: 'information-corrections',
  },
  {
    id: 'leads',
    label: '咨询线索',
    href: '/admin/collections/leads',
    menuCodes: ['leads', 'my-leads'],
    collectionSlug: 'leads',
    badgeKey: 'leads',
  },
  {
    id: 'customers',
    label: '客户档案',
    href: '/admin/collections/customers',
    menuCodes: ['customers', 'my-customers'],
    collectionSlug: 'customers',
  },
  {
    id: 'follow-ups',
    label: '跟进记录',
    href: '/admin/collections/follow-ups',
    menuCodes: ['follow-ups'],
    collectionSlug: 'follow-ups',
  },
  {
    id: 'merchants',
    label: '商户管理',
    href: '/admin/collections/merchants',
    menuCodes: ['merchants'],
    collectionSlug: 'merchants',
  },
  {
    id: 'city-partner-applications',
    label: '城市合伙人申请',
    href: '/admin/collections/city-partner-applications',
    menuCodes: ['city-partner-applications'],
    collectionSlug: 'city-partner-applications',
    requiredOperationCode: 'city_partner_application:read',
    badgeKey: 'cityPartnerApplications',
  },
  {
    id: 'building-merchant-relations',
    label: '楼盘商户关系',
    href: '/admin/collections/building-merchant-relations',
    menuCodes: ['merchants'],
    collectionSlug: 'building-merchant-relations',
  },
  {
    id: 'teams',
    label: '团队管理',
    href: '/admin/collections/teams',
    menuCodes: ['teams'],
    collectionSlug: 'teams',
  },
  {
    id: 'brokers',
    label: '经纪人管理',
    href: '/admin/collections/brokers',
    menuCodes: ['brokers'],
    collectionSlug: 'brokers',
  },
  {
    id: 'advisor-service-hours',
    label: '顾问服务时间',
    href: '/admin/globals/advisor-service-hours',
    menuCodes: ['teams', 'brokers'],
  },
  {
    id: 'site-settings',
    label: '站点设置',
    href: '/admin/globals/site-settings',
    menuCodes: ['site-settings'],
    requiredOperationCode: 'site_settings:manage',
  },
  {
    id: 'city-site-profiles',
    label: '城市站点配置',
    href: '/admin/collections/city-site-profiles',
    menuCodes: ['locations'],
    collectionSlug: 'city-site-profiles',
    requiredOperationCode: 'location:manage',
  },
  {
    id: 'pages',
    label: '页面内容',
    href: '/admin/collections/pages',
    menuCodes: ['pages'],
    collectionSlug: 'pages',
  },
  {
    id: 'articles',
    label: '资讯中心',
    href: '/admin/collections/articles',
    menuCodes: ['articles'],
    collectionSlug: 'articles',
  },
  {
    id: 'media',
    label: '素材库',
    href: '/admin/collections/media',
    menuCodes: ['media'],
    collectionSlug: 'media',
  },
  {
    id: 'forms',
    label: '表单管理',
    href: '/admin/collections/forms',
    menuCodes: ['forms'],
    collectionSlug: 'forms',
  },
  {
    id: 'form-submissions',
    label: '提交数据',
    href: '/admin/collections/form-submissions',
    menuCodes: ['form-submissions'],
    collectionSlug: 'form-submissions',
    badgeKey: 'formSubmissions',
  },
  {
    id: 'users',
    label: '用户管理',
    href: '/admin/collections/users',
    menuCodes: ['users'],
    collectionSlug: 'users',
  },
  {
    id: 'roles',
    label: '角色管理',
    href: '/admin/collections/roles',
    menuCodes: ['roles'],
    collectionSlug: 'roles',
  },
  {
    id: 'amenities',
    label: '配套字典',
    href: '/admin/collections/amenities',
    menuCodes: ['dictionaries'],
    collectionSlug: 'amenities',
  },
  {
    id: 'search',
    label: '搜索索引',
    href: '/admin/collections/search',
    menuCodes: ['search'],
    collectionSlug: 'search',
  },
  {
    id: 'domain-events',
    label: '领域事件',
    href: '/admin/collections/domain-events',
    menuCodes: ['domain-events'],
    collectionSlug: 'domain-events',
    requiredOperationCode: 'events:read',
  },
  {
    id: 'audit-logs',
    label: '审计日志',
    href: '/admin/collections/audit-logs',
    menuCodes: ['audit-logs'],
    collectionSlug: 'audit-logs',
    requiredOperationCode: 'audit:view',
  },
]

/** 裁定 2：领域事件退出导航，其余 39 片必须一片不少。 */
const REMOVED_LEAF_IDS = new Set(['domain-events'])

/** 允许新增 badgeKey 的两片叶子（Task 3 会补上对应的角标查询）。 */
const ALLOWED_NEW_BADGE_KEYS: Readonly<Record<string, string>> = {
  'information-corrections': 'informationCorrections',
  'supply-submissions': 'supplySubmissions',
}

function currentLeaves(): readonly AdminNavLeaf[] {
  return ADMIN_NAV_GROUPS.flatMap((group) => group.children)
}

/** 只取参与权限判定的字段，比较时不受对象键顺序影响。 */
function comparable(leaf: LeafFixture | AdminNavLeaf) {
  return {
    label: leaf.label,
    href: leaf.href,
    menuCodes: [...leaf.menuCodes],
    collectionSlug: leaf.collectionSlug,
    requiredOperationCode: leaf.requiredOperationCode,
  }
}

describe('导航重组不得改动叶子的权限判据（G1）', () => {
  it('叶子集合 = master 的集合减去退出导航的那片', () => {
    const expected = MASTER_LEAVES.map((leaf) => leaf.id).filter((id) => !REMOVED_LEAF_IDS.has(id))

    expect([...currentLeaves().map((leaf) => leaf.id)].sort()).toEqual([...expected].sort())
  })

  it('每片叶子的 label / href / menuCodes / collectionSlug / requiredOperationCode 与 master 逐字相同', () => {
    const master = new Map(MASTER_LEAVES.map((leaf) => [leaf.id, leaf]))

    for (const leaf of currentLeaves()) {
      const baseline = master.get(leaf.id)
      expect(baseline, `${leaf.id} 不在 master 基线里——新增入口需要单独评审权限`).toBeDefined()
      if (!baseline) continue

      expect(comparable(leaf), `${leaf.id}（${leaf.label}）的权限判据发生了漂移`).toEqual(
        comparable(baseline),
      )
    }
  })

  it('badgeKey 只允许两处新增，其余与 master 一致', () => {
    const master = new Map(MASTER_LEAVES.map((leaf) => [leaf.id, leaf]))

    for (const leaf of currentLeaves()) {
      const baseline = master.get(leaf.id)
      if (!baseline) continue

      const expected = baseline.badgeKey ?? ALLOWED_NEW_BADGE_KEYS[leaf.id]

      expect(leaf.badgeKey, `${leaf.id}（${leaf.label}）的 badgeKey 与允许范围不符`).toBe(expected)
    }
  })

  it('退出导航的领域事件只是没了入口，权限码不受影响（裁定 2）', () => {
    expect(currentLeaves().some((leaf) => leaf.id === 'domain-events')).toBe(false)
    expect(JSON.stringify(ADMIN_NAV_GROUPS)).not.toContain('events:read')
  })
})
