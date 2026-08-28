import type { AdminNavGroup, AdminNavLeaf, AdminNavSubgroup, AdminNavIconKey } from './navigation-types'

type AdminNavLeafOptions = Pick<
  AdminNavLeaf,
  'collectionSlug' | 'requiredOperationCode' | 'badgeKey'
>

function collectionSlugFromHref(href: string): string | undefined {
  return /^\/admin\/collections\/([^/]+)$/.exec(href)?.[1]
}

function leaf(
  id: string,
  label: string,
  href: string,
  menuCodes: readonly string[],
  options: AdminNavLeafOptions = {},
): AdminNavLeaf {
  const collectionSlug = options.collectionSlug ?? collectionSlugFromHref(href)

  return {
    id,
    label,
    href,
    menuCodes,
    ...(collectionSlug ? { collectionSlug } : {}),
    ...options,
  }
}

function subgroup(id: string, label: string, children: readonly AdminNavLeaf[]): AdminNavSubgroup {
  return { id, label, children }
}

function group(
  id: string,
  label: string,
  icon: AdminNavIconKey,
  children: readonly (AdminNavLeaf | AdminNavSubgroup)[],
): AdminNavGroup {
  return { id, label, icon, children }
}

export const ADMIN_NAV_GROUPS = [
  group('workspace', '工作台', 'dashboard', [
    leaf('overview', '运营概览', '/admin', ['dashboard']),
    leaf('my-tasks', '我的待办', '/admin/collections/tasks', ['todos'], {
      collectionSlug: 'tasks',
      requiredOperationCode: 'task:read',
      badgeKey: 'tasks',
    }),
    leaf('notifications', '消息通知', '/admin/collections/notifications', ['notifications'], {
      collectionSlug: 'notifications',
      requiredOperationCode: 'notification:read',
      badgeKey: 'notifications',
    }),
  ]),
  group('supply', '房源运营', 'building', [
    leaf('listings', '房源列表', '/admin/collections/listings', ['listings']),
    leaf('buildings', '楼盘库', '/admin/collections/buildings', ['buildings']),
    leaf('supply-submissions', '房源投放申请', '/admin/collections/supply-submissions', [
      'supply-submissions',
    ], {
      collectionSlug: 'supply-submissions',
      requiredOperationCode: 'supply_submission:read',
    }),
    // OPT-041 批量导入：两个自定义视图，非 collection 路由，不设 collectionSlug。
    // menuCodes 沿用对应业务对象的既有码，requiredOperationCode 再收窄到 data:import
    // ——与 BulkImportView 的 requireImportAccess / endpoint 的 guardImport 判据一致。
    leaf('import-buildings', '楼盘批量导入', '/admin/import/buildings', ['buildings'], {
      requiredOperationCode: 'data:import',
    }),
    leaf('import-listings', '房源批量导入', '/admin/import/listings', ['listings'], {
      requiredOperationCode: 'data:import',
    }),
    // OPT-045 D4：导入批次此前**不在导航配置里**，只能直敲 URL 才能看到。
    // 未被自定义导航收编的 collection 会被兜底渲染成后台左下角那个挤成一团、
    // 与上面九个分组风格明显不一致的「集合」区块——那不是样式没写好，
    // 是它根本不走自定义导航那套。收编进正常分组，兜底区块自然消失。
    leaf('supply-import-batches', '导入批次', '/admin/collections/supply-import-batches', ['listings'], {
      collectionSlug: 'supply-import-batches',
      requiredOperationCode: 'data:import',
    }),
  ]),
  group('region-management', '区域管理', 'location', [
    leaf('cities', '城市管理', '/admin/geography/cities', ['locations'], {
      collectionSlug: 'locations',
    }),
    leaf('districts', '行政区域', '/admin/geography/districts', ['locations'], {
      collectionSlug: 'locations',
    }),
    leaf('business-areas', '商圈管理', '/admin/geography/business-areas', ['business-areas'], {
      collectionSlug: 'locations',
    }),
    leaf('metro-lines', '地铁管理', '/admin/geography/metro-lines', ['locations'], {
      collectionSlug: 'locations',
    }),
    // OPT-045 D4：地理别名同样是漏收编的集合（理由见 supply-import-batches 那条）。
    // 归区域管理：它存的就是城市/行政区/商圈/地铁的别名，导入时按它做名称解析。
    leaf('location-aliases', '地理别名', '/admin/collections/location-aliases', ['locations'], {
      collectionSlug: 'location-aliases',
      requiredOperationCode: 'location:manage',
    }),
  ]),
  group('risk', '审核与风控', 'shield', [
    leaf('listing-reviews', '审核队列', '/admin/collections/listing-reviews', ['listing-reviews'], {
      badgeKey: 'listingReviews',
    }),
    leaf('listing-reports', '举报处理', '/admin/collections/listing-reports', ['reports'], {
      badgeKey: 'listingReports',
    }),
    // OPT-049：前台访客提交的信息纠错，追加式审计轨迹。此前未收编，
    // 只能靠 Payload 原生导航才看得到——而原生导航本该是隐藏的。
    leaf('information-corrections', '信息纠错', '/admin/collections/information-corrections', ['reports'], {
      collectionSlug: 'information-corrections',
    }),
  ]),
  group('crm', '客户运营', 'user', [
    leaf('leads', '咨询线索', '/admin/collections/leads', ['leads', 'my-leads'], {
      badgeKey: 'leads',
    }),
    leaf('customers', '客户档案', '/admin/collections/customers', ['customers', 'my-customers']),
    leaf('follow-ups', '跟进记录', '/admin/collections/follow-ups', ['follow-ups']),
  ]),
  group('partners', '商户合作', 'shop', [
    leaf('merchants', '商户管理', '/admin/collections/merchants', ['merchants']),
    leaf(
      'city-partner-applications',
      '城市合伙人申请',
      '/admin/collections/city-partner-applications',
      ['city-partner-applications'],
      {
        collectionSlug: 'city-partner-applications',
        requiredOperationCode: 'city_partner_application:read',
        badgeKey: 'cityPartnerApplications',
      },
    ),
    // OPT-045 D4：楼盘商户关系此前不在导航里，**任何角色包括 ADM 都看不到**，
    // 只能直敲 URL。而它是有效供给 §8 的关键配置——楼盘没有生效商户关系，
    // 其下房源就进不了前台。实测手工补三个楼盘约 18 次点击且没有批量入口，
    // 这正是 OPT-045 要加默认商户回落的直接动因（§2.2）。
    leaf(
      'building-merchant-relations',
      '楼盘商户关系',
      '/admin/collections/building-merchant-relations',
      ['merchants'],
      { collectionSlug: 'building-merchant-relations' },
    ),
  ]),
  group('team-management', '团队管理', 'team', [
    leaf('teams', '团队管理', '/admin/collections/teams', ['teams']),
    leaf('brokers', '经纪人管理', '/admin/collections/brokers', ['brokers']),
    leaf('advisor-service-hours', '顾问服务时间', '/admin/globals/advisor-service-hours', [
      'teams',
      'brokers',
    ]),
  ]),
  group('content', '内容管理', 'file', [
    // OPT-053：站点设置是 Global，`custom.scss` 隐藏了 Payload 原生导航，
    // 不在这里收编就**彻底不可发现**——集合漏收编还有左下角那个兜底区块
    // （见 supply-import-batches 那条），Global 连兜底都没有。
    // requiredOperationCode 必须与 `SiteSettings.access.update` 用同一个码：
    // 菜单看得见的人和 API 改得动的人得是同一批。
    leaf('site-settings', '站点设置', '/admin/globals/site-settings', ['site-settings'], {
      requiredOperationCode: 'site_settings:manage',
    }),
    // OPT-062：紧挨「站点设置」。两者是「全局默认 → 单城覆盖/单城独有」的两层
    // （类型卡封面走覆盖，SEO 与开城状态是单城独有）。
    //
    // 它此前在「区域管理」里——那组另外五项全是地理层级（城市/行政区/商圈/地铁/别名），
    // 唯独它是运营配置，名字又与「城市管理」相似且相邻，于是被当成同一件事的两个入口。
    //
    // requiredOperationCode 保持 location:manage 不变（与 CitySiteProfiles.access 同码）：
    // 菜单看得见的人和 API 改得动的人必须是同一批。挪位置不等于放权——「谁该有权把一个
    // 城市下线」是业务判断，见 spec OPT-062 §5。
    leaf('city-site-profiles', '城市站点配置', '/admin/collections/city-site-profiles', ['locations'], {
      collectionSlug: 'city-site-profiles',
      requiredOperationCode: 'location:manage',
    }),
    leaf('pages', '页面内容', '/admin/collections/pages', ['pages']),
    leaf('articles', '资讯中心', '/admin/collections/articles', ['articles']),
    leaf('media', '素材库', '/admin/collections/media', ['media']),
  ]),
  group('form-center', '表单中心', 'form', [
    leaf('forms', '表单管理', '/admin/collections/forms', ['forms']),
    leaf('form-submissions', '提交数据', '/admin/collections/form-submissions', ['form-submissions'], {
      badgeKey: 'formSubmissions',
    }),
  ]),
  group('system', '系统管理', 'settings', [
    leaf('users', '用户管理', '/admin/collections/users', ['users']),
    leaf('roles', '角色管理', '/admin/collections/roles', ['roles']),
    subgroup('supply-settings', '基础配置', [
      leaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
    ]),
    subgroup('advanced-tools', '高级工具', [
      leaf('search', '搜索索引', '/admin/collections/search', ['search']),
      leaf('domain-events', '领域事件', '/admin/collections/domain-events', ['domain-events'], {
        requiredOperationCode: 'events:read',
      }),
      leaf('audit-logs', '审计日志', '/admin/collections/audit-logs', ['audit-logs'], {
        requiredOperationCode: 'audit:view',
      }),
    ]),
  ]),
] as const satisfies readonly AdminNavGroup[]
