import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_GROUPS } from '@/domain/admin-navigation/navigation-config'

type NavigationItem = {
  id: string
  label: string
  href?: string
  menuCodes?: readonly string[]
  collectionSlug?: string
  children?: readonly NavigationItem[]
}

function collectItems(items: readonly NavigationItem[]): readonly NavigationItem[] {
  return items.flatMap((item) => [item, ...(item.children ? collectItems(item.children) : [])])
}

type NavigationTreeItem = {
  id: string
  label: string
  href?: string
  menuCodes?: readonly string[]
  children?: readonly NavigationTreeItem[]
}

function normalizeNavigationTree(items: readonly NavigationItem[]): readonly NavigationTreeItem[] {
  return items.map((item) => {
    if (item.children) {
      return {
        id: item.id,
        label: item.label,
        children: normalizeNavigationTree(item.children),
      }
    }

    return {
      id: item.id,
      label: item.label,
      href: item.href,
      menuCodes: item.menuCodes,
    }
  })
}

function expectedLeaf(
  id: string,
  label: string,
  href: string,
  menuCodes: readonly string[],
): NavigationTreeItem {
  return { id, label, href, menuCodes }
}

function expectedGroup(
  id: string,
  label: string,
  children: readonly NavigationTreeItem[],
): NavigationTreeItem {
  return { id, label, children }
}

describe('admin navigation config', () => {
  it('按已确认顺序提供十个一级分组', () => {
    expect(ADMIN_NAV_GROUPS.map((group) => group.label)).toEqual([
      '工作台',
      '房源运营',
      '区域管理',
      '审核与风控',
      '客户运营',
      '商户合作',
      '团队管理',
      '内容管理',
      '表单中心',
      '系统管理',
    ])
  })

  it('按已确认树提供每组子项、基础配置和高级工具映射', () => {
    expect(normalizeNavigationTree(ADMIN_NAV_GROUPS)).toEqual([
      expectedGroup('workspace', '工作台', [
        expectedLeaf('overview', '运营概览', '/admin', ['dashboard']),
        expectedLeaf('my-tasks', '我的待办', '/admin/collections/tasks', ['todos']),
        expectedLeaf('notifications', '消息通知', '/admin/collections/notifications', [
          'notifications',
        ]),
        // OPT-065 数据看板：挂菜单码 analytics，不挂 requiredOperationCode
        expectedLeaf('analytics', '数据看板', '/admin/analytics', ['analytics']),
      ]),
      expectedGroup('supply', '房源运营', [
        expectedLeaf('listings', '房源列表', '/admin/collections/listings', ['listings']),
        expectedLeaf('buildings', '楼盘库', '/admin/collections/buildings', ['buildings']),
        expectedLeaf(
          'supply-submissions',
          '房源投放申请',
          '/admin/collections/supply-submissions',
          ['supply-submissions'],
        ),
        expectedLeaf('import-buildings', '楼盘批量导入', '/admin/import/buildings', ['buildings']),
        expectedLeaf('import-listings', '房源批量导入', '/admin/import/listings', ['listings']),
        expectedLeaf('supply-import-batches', '导入批次', '/admin/collections/supply-import-batches', ['listings']),
      ]),
      expectedGroup('region-management', '区域管理', [
        expectedLeaf('cities', '城市管理', '/admin/geography/cities', ['locations']),
        expectedLeaf('districts', '行政区域', '/admin/geography/districts', ['locations']),
        expectedLeaf('business-areas', '商圈管理', '/admin/geography/business-areas', [
          'business-areas',
        ]),
        expectedLeaf('metro-lines', '地铁管理', '/admin/geography/metro-lines', ['locations']),
        expectedLeaf('location-aliases', '地理别名', '/admin/collections/location-aliases', ['locations']),
      ]),
      expectedGroup('risk', '审核与风控', [
        expectedLeaf('listing-reviews', '审核队列', '/admin/collections/listing-reviews', [
          'listing-reviews',
        ]),
        expectedLeaf('listing-reports', '举报处理', '/admin/collections/listing-reports', ['reports']),
        expectedLeaf('information-corrections', '信息纠错', '/admin/collections/information-corrections', ['reports']),
      ]),
      expectedGroup('crm', '客户运营', [
        expectedLeaf('leads', '咨询线索', '/admin/collections/leads', ['leads', 'my-leads']),
        expectedLeaf('customers', '客户档案', '/admin/collections/customers', [
          'customers',
          'my-customers',
        ]),
        expectedLeaf('follow-ups', '跟进记录', '/admin/collections/follow-ups', ['follow-ups']),
      ]),
      expectedGroup('partners', '商户合作', [
        expectedLeaf('merchants', '商户管理', '/admin/collections/merchants', ['merchants']),
        expectedLeaf(
          'city-partner-applications',
          '城市合伙人申请',
          '/admin/collections/city-partner-applications',
          ['city-partner-applications'],
        ),
        expectedLeaf(
          'building-merchant-relations',
          '楼盘商户关系',
          '/admin/collections/building-merchant-relations',
          ['merchants'],
        ),
      ]),
      expectedGroup('team-management', '团队管理', [
        expectedLeaf('teams', '团队管理', '/admin/collections/teams', ['teams']),
        expectedLeaf('brokers', '经纪人管理', '/admin/collections/brokers', ['brokers']),
        expectedLeaf('advisor-service-hours', '顾问服务时间', '/admin/globals/advisor-service-hours', [
          'teams',
          'brokers',
        ]),
      ]),
      expectedGroup('content', '内容管理', [
        // OPT-053：站点设置是 Global，不收编进自定义导航就彻底不可发现
        // （custom.scss 隐藏了原生导航，而 Global 连集合那个左下角兜底区块都没有）。
        expectedLeaf('site-settings', '站点设置', '/admin/globals/site-settings', ['site-settings']),
        // OPT-062：紧挨「站点设置」——两者是「全局默认 → 单城覆盖/单城独有」的两层
        // （类型卡封面、SEO、开城状态）。此前它在「区域管理」里夹在五个地理项中间，
        // 与「城市管理」名字相似又相邻，被误认为是同一件事的两个入口。
        expectedLeaf(
          'city-site-profiles',
          '城市站点配置',
          '/admin/collections/city-site-profiles',
          ['locations'],
        ),
        expectedLeaf('pages', '页面内容', '/admin/collections/pages', ['pages']),
        expectedLeaf('articles', '资讯中心', '/admin/collections/articles', ['articles']),
        expectedLeaf('media', '素材库', '/admin/collections/media', ['media']),
      ]),
      expectedGroup('form-center', '表单中心', [
        expectedLeaf('forms', '表单管理', '/admin/collections/forms', ['forms']),
        expectedLeaf('form-submissions', '提交数据', '/admin/collections/form-submissions', [
          'form-submissions',
        ]),
      ]),
      expectedGroup('system', '系统管理', [
        expectedLeaf('users', '用户管理', '/admin/collections/users', ['users']),
        expectedLeaf('roles', '角色管理', '/admin/collections/roles', ['roles']),
        expectedGroup('supply-settings', '基础配置', [
          expectedLeaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
        ]),
        expectedGroup('advanced-tools', '高级工具', [
          expectedLeaf('search', '搜索索引', '/admin/collections/search', ['search']),
          expectedLeaf('domain-events', '领域事件', '/admin/collections/domain-events', [
            'domain-events',
          ]),
          expectedLeaf('audit-logs', '审计日志', '/admin/collections/audit-logs', ['audit-logs']),
        ]),
      ]),
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
    const collectionSlugs = collectItems(ADMIN_NAV_GROUPS)
      .map((item) => item.collectionSlug)
      .filter((slug): slug is string => typeof slug === 'string')

    // 报出具体是哪个 slug 不在清单里。原写法是 `.every(...)` → `expected false to be true`，
    // 拿到红灯也不知道该去看哪一条，只能自己 diff 两个列表。
    const unknown = collectionSlugs.filter((slug) => !configuredCollectionSlugs.has(slug))
    expect(unknown, `导航指向了不存在于 Payload 配置的集合：${unknown.join('、')}`).toEqual([])
  })

  it('城市站点配置与站点设置权限码不因相邻而混同（挪位置 ≠ 放权）', () => {
    // OPT-062：city-site-profiles 从「区域管理」挪进「内容管理」、紧跟 site-settings
    // 之后，两者视觉相邻但权限必须保持独立。role-matrix 测试只按一级分组
    // （visibleTopGroups）断言可见性，组内任一叶子可见即算整组可见，从未单独
    // 校验过某个叶子自己的 requiredOperationCode；expectedLeaf 助手也不接收这个
    // 字段。也就是说，在这条断言补上之前，「挪位置不放权」这个核心裁定
    // 没有任何测试防线——把这里的 requiredOperationCode 顺手改成
    // 'site_settings:manage'，14 个导航测试和全量用例都不会变红。
    //
    // 菜单看得见的人和 API 改得动的人必须是同一批（navigation-config.ts 里
    // city-site-profiles 那条注释是同一个道理）：能改全站默认站点设置的人，
    // 不该因为这次挪动就顺带拿到「下线某个城市」（location:manage）的权限，反之亦然。
    const leaves = collectItems(ADMIN_NAV_GROUPS) as ReadonlyArray<
      NavigationItem & { requiredOperationCode?: string }
    >
    const citySiteProfiles = leaves.find((item) => item.id === 'city-site-profiles')
    const siteSettings = leaves.find((item) => item.id === 'site-settings')

    expect(citySiteProfiles?.requiredOperationCode).toBe('location:manage')
    expect(siteSettings?.requiredOperationCode).toBe('site_settings:manage')
  })
})
