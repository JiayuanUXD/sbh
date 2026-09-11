import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'

type NavigationLeaf = {
  id: string
  label: string
  href: string
  menuCodes: readonly string[]
  collectionSlug?: string
  requiredOperationCode?: string
}

/** 导航只有两级，组的 children 就是全部叶子（OPT-084 Phase 1 起）。 */
function allLeaves(): readonly NavigationLeaf[] {
  return ADMIN_NAV_GROUPS.flatMap((group) => group.children)
}

type NavigationTreeGroup = {
  id: string
  label: string
  children: readonly Pick<NavigationLeaf, 'id' | 'label' | 'href' | 'menuCodes'>[]
}

function normalizeNavigationTree(): readonly NavigationTreeGroup[] {
  return ADMIN_NAV_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    children: group.children.map((leaf) => ({
      id: leaf.id,
      label: leaf.label,
      href: leaf.href,
      menuCodes: leaf.menuCodes,
    })),
  }))
}

function expectedLeaf(
  id: string,
  label: string,
  href: string,
  menuCodes: readonly string[],
): Pick<NavigationLeaf, 'id' | 'label' | 'href' | 'menuCodes'> {
  return { id, label, href, menuCodes }
}

function expectedGroup(
  id: string,
  label: string,
  children: readonly Pick<NavigationLeaf, 'id' | 'label' | 'href' | 'menuCodes'>[],
): NavigationTreeGroup {
  return { id, label, children }
}

describe('admin navigation config', () => {
  it('按已确认顺序提供八个一级分组', () => {
    expect(ADMIN_NAV_GROUPS.map((group) => group.label)).toEqual([
      '工作台',
      '待处理',
      '房源与楼盘',
      '客户与线索',
      '站点与内容',
      '城市与区域',
      '团队与账号',
      '设置与工具',
    ])
  })

  it('按已确认树提供每组叶子（顺序、id、标签、路径、菜单码）', () => {
    expect(normalizeNavigationTree()).toEqual([
      expectedGroup('workspace', '工作台', [
        expectedLeaf('overview', '运营概览', '/admin', ['dashboard']),
        expectedLeaf('notifications', '消息通知', '/admin/collections/notifications', [
          'notifications',
        ]),
        // OPT-065 数据看板：挂菜单码 analytics，不挂 requiredOperationCode
        expectedLeaf('analytics', '数据看板', '/admin/analytics', ['analytics']),
      ]),
      // OPT-084：所有「等我处理」的入口收进一组，不再按数据表散在四个组里
      expectedGroup('inbox', '待处理', [
        expectedLeaf('my-tasks', '我的待办', '/admin/collections/tasks', ['todos']),
        expectedLeaf('listing-reviews', '审核队列', '/admin/collections/listing-reviews', [
          'listing-reviews',
        ]),
        expectedLeaf('listing-reports', '举报处理', '/admin/collections/listing-reports', [
          'reports',
        ]),
        expectedLeaf(
          'information-corrections',
          '信息纠错',
          '/admin/collections/information-corrections',
          ['reports'],
        ),
        expectedLeaf(
          'supply-submissions',
          '房源投放申请',
          '/admin/collections/supply-submissions',
          ['supply-submissions'],
        ),
        expectedLeaf(
          'city-partner-applications',
          '城市合伙人申请',
          '/admin/collections/city-partner-applications',
          ['city-partner-applications'],
        ),
        expectedLeaf('form-submissions', '提交数据', '/admin/collections/form-submissions', [
          'form-submissions',
        ]),
      ]),
      expectedGroup('supply', '房源与楼盘', [
        expectedLeaf('listings', '房源列表', '/admin/collections/listings', ['listings']),
        expectedLeaf('buildings', '楼盘库', '/admin/collections/buildings', ['buildings']),
        expectedLeaf('merchants', '商户管理', '/admin/collections/merchants', ['merchants']),
        expectedLeaf(
          'building-merchant-relations',
          '楼盘商户关系',
          '/admin/collections/building-merchant-relations',
          ['merchants'],
        ),
        expectedLeaf('import-buildings', '楼盘批量导入', '/admin/import/buildings', ['buildings']),
        expectedLeaf('import-listings', '房源批量导入', '/admin/import/listings', ['listings']),
        expectedLeaf(
          'supply-import-batches',
          '导入批次',
          '/admin/collections/supply-import-batches',
          ['listings'],
        ),
      ]),
      expectedGroup('crm', '客户与线索', [
        expectedLeaf('leads', '咨询线索', '/admin/collections/leads', ['leads', 'my-leads']),
        expectedLeaf('customers', '客户档案', '/admin/collections/customers', [
          'customers',
          'my-customers',
        ]),
        expectedLeaf('follow-ups', '跟进记录', '/admin/collections/follow-ups', ['follow-ups']),
        expectedLeaf('members', '会员', '/admin/collections/members', ['members']),
      ]),
      expectedGroup('content', '站点与内容', [
        // OPT-053：站点设置是 Global，不收编进自定义导航就彻底不可发现
        // （custom.scss 隐藏了原生导航，而 Global 连集合那个左下角兜底区块都没有）。
        expectedLeaf('site-settings', '站点设置', '/admin/globals/site-settings', ['site-settings']),
        // OPT-062：紧挨「站点设置」——两者是「全局默认 → 单城覆盖/单城独有」的两层
        // （类型卡封面、SEO、开城状态）。
        expectedLeaf(
          'city-site-profiles',
          '城市站点配置',
          '/admin/collections/city-site-profiles',
          ['locations'],
        ),
        expectedLeaf('pages', '页面内容', '/admin/collections/pages', ['pages']),
        expectedLeaf('articles', '资讯中心', '/admin/collections/articles', ['articles']),
        expectedLeaf('media', '素材库', '/admin/collections/media', ['media']),
        expectedLeaf('forms', '表单管理', '/admin/collections/forms', ['forms']),
      ]),
      expectedGroup('geography', '城市与区域', [
        expectedLeaf('cities', '城市管理', '/admin/geography/cities', ['locations']),
        expectedLeaf('districts', '行政区域', '/admin/geography/districts', ['locations']),
        expectedLeaf('business-areas', '商圈管理', '/admin/geography/business-areas', [
          'business-areas',
        ]),
        expectedLeaf('metro-lines', '地铁管理', '/admin/geography/metro-lines', ['locations']),
        expectedLeaf('location-aliases', '地理别名', '/admin/collections/location-aliases', [
          'locations',
        ]),
      ]),
      expectedGroup('org', '团队与账号', [
        expectedLeaf('users', '用户管理', '/admin/collections/users', ['users']),
        expectedLeaf('roles', '角色管理', '/admin/collections/roles', ['roles']),
        expectedLeaf('teams', '团队管理', '/admin/collections/teams', ['teams']),
        expectedLeaf('brokers', '经纪人管理', '/admin/collections/brokers', ['brokers']),
        expectedLeaf('advisor-service-hours', '顾问服务时间', '/admin/globals/advisor-service-hours', [
          'teams',
          'brokers',
        ]),
      ]),
      expectedGroup('system', '设置与工具', [
        expectedLeaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
        expectedLeaf('audit-logs', '审计日志', '/admin/collections/audit-logs', ['audit-logs']),
        expectedLeaf('search', '搜索索引', '/admin/collections/search', ['search']),
      ]),
    ])
  })

  it('不在主导航暴露归属历史或技术分组名', () => {
    const serialized = JSON.stringify(ADMIN_NAV_GROUPS)
    expect(serialized).not.toContain('lead-ownership-history')
    expect(serialized).not.toContain('workflow')
    expect(serialized).not.toContain('"集合"')
  })

  it('保持唯一 ID、唯一叶子路径和完整菜单权限编码', () => {
    const leaves = allLeaves()
    const ids = [...ADMIN_NAV_GROUPS.map((group) => group.id), ...leaves.map((leaf) => leaf.id)]

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(leaves.map((leaf) => leaf.href)).size).toBe(leaves.length)
    expect(leaves.every((leaf) => leaf.menuCodes.length > 0)).toBe(true)
  })

  it('从稳定 Collection 路径解析集合标识', () => {
    const collectionLeaves = allLeaves().filter((leaf) =>
      /^\/admin\/collections\/[^/]+$/.test(leaf.href),
    )

    expect(collectionLeaves.map((leaf) => leaf.collectionSlug)).toEqual(
      collectionLeaves.map((leaf) => leaf.href.split('/').at(-1)),
    )
  })

  it('只指向 Payload 配置或插件集合清单中的集合', () => {
    const configuredCollectionSlugs = new Set([
      'members',
      'users',
      'roles',
      'media',
      'locations',
      'city-site-profiles',
      'city-partner-applications',
      'business-area-extensions',
      'merchants',
      'teams',
      'brokers',
      'amenities',
      'buildings',
      'supply-submissions',
      'listings',
      'leads',
      'customers',
      'follow-ups',
      'pages',
      'articles',
      'listing-reviews',
      'listing-reports',
      'domain-events',
      'audit-logs',
      'tasks',
      'notifications',
      'search',
      'forms',
      'form-submissions',
      // OPT-045 D4：这三个此前不在导航里（未被收编的集合会被兜底渲染成后台左下角
      // 那个风格不一致的「集合」区块），现已收编进正常分组。
      'supply-import-batches',
      'location-aliases',
      'building-merchant-relations',
      // OPT-049：三个此前只能靠 Payload 原生导航看到的集合
      'information-corrections',
    ])
    const collectionSlugs = allLeaves()
      .map((leaf) => leaf.collectionSlug)
      .filter((slug): slug is string => typeof slug === 'string')

    // 报出具体是哪个 slug 不在清单里。原写法是 `.every(...)` → `expected false to be true`，
    // 拿到红灯也不知道该去看哪一条，只能自己 diff 两个列表。
    const unknown = collectionSlugs.filter((slug) => !configuredCollectionSlugs.has(slug))
    expect(unknown, `导航指向了不存在于 Payload 配置的集合：${unknown.join('、')}`).toEqual([])
  })

  it('城市站点配置与站点设置权限码不因相邻而混同（挪位置 ≠ 放权）', () => {
    // OPT-062：city-site-profiles 与 site-settings 视觉相邻但权限必须保持独立。
    // role-matrix 测试只按一级分组断言可见性，组内任一叶子可见即算整组可见，从未单独
    // 校验过某个叶子自己的 requiredOperationCode；expectedLeaf 助手也不接收这个字段。
    // 也就是说，在这条断言补上之前，「挪位置不放权」这个核心裁定没有任何测试防线——
    // 把这里的 requiredOperationCode 顺手改成 'site_settings:manage'，导航测试全都不会变红。
    //
    // 菜单看得见的人和 API 改得动的人必须是同一批（navigation-config.ts 里
    // city-site-profiles 那条注释是同一个道理）：能改全站默认站点设置的人，
    // 不该因为相邻就顺带拿到「下线某个城市」（location:manage）的权限，反之亦然。
    const leaves = allLeaves()

    expect(leaves.find((leaf) => leaf.id === 'city-site-profiles')?.requiredOperationCode).toBe(
      'location:manage',
    )
    expect(leaves.find((leaf) => leaf.id === 'site-settings')?.requiredOperationCode).toBe(
      'site_settings:manage',
    )
  })
})
