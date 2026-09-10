import type { AdminNavGroup, AdminNavLeaf, AdminNavIconKey } from './navigation-types'

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

function group(
  id: string,
  label: string,
  icon: AdminNavIconKey,
  children: readonly AdminNavLeaf[],
): AdminNavGroup {
  return { id, label, icon, children }
}

/**
 * 后台左侧导航树（OPT-084 Phase 1：8 组 / 39 叶 / 最多两级）。
 *
 * 分组按**「谁来用、什么时候用」**切，不按数据表切——上一版按对象切成十个组
 * （房源运营 / 审核与风控 / 商户合作 / 表单中心 …），结果是每天都要处理的几件事
 * （待办、审核队列、举报、纠错、投放申请、合伙人申请、表单提交）散在四个组里，
 * 而它们其实是同一件事：**有人提交了东西等我处理**。现在统一收进「待处理」。
 *
 * 另外三条同源的调整：
 *   - 商户与楼盘商户关系并进「房源与楼盘」——商户在本平台的意义就是「谁在供给」，
 *     单独成组会让人以为那是另一条业务线。
 *   - 表单管理并进「站点与内容」（表单是站点的一部分），提交数据进「待处理」。
 *   - 「系统管理」拆成「团队与账号」（人）与「设置与工具」（配置/排障）。
 *
 * **叶子的定义一律从上一版原样搬运**：label / href / menuCodes / collectionSlug /
 * requiredOperationCode 一个字都不改，只换所属组与顺序（唯一例外是两处新增 badgeKey）。
 * 重排时最容易发生的错误是抄漏一个权限码，而那不会有任何红灯——
 * `tests/admin-navigation-permission-drift.test.ts` 就是为这件事存在的。
 */
export const ADMIN_NAV_GROUPS = [
  group('workspace', '工作台', 'dashboard', [
    leaf('overview', '运营概览', '/admin', ['dashboard']),
    leaf('notifications', '消息通知', '/admin/collections/notifications', ['notifications'], {
      collectionSlug: 'notifications',
      requiredOperationCode: 'notification:read',
      badgeKey: 'notifications',
    }),
    // OPT-065 数据看板。只挂菜单码 analytics（permission-codes.ts 早已注册），
    // 不挂 requiredOperationCode——导航层不跑 metric registry，块级权限在页面内部
    // 按 canViewOverviewDashboard 降级（与 /api/overview 同源判据）。
    leaf('analytics', '数据看板', '/admin/analytics', ['analytics']),
  ]),
  // 「待处理」是本次重组的核心：凡是「有人提交了东西、等着我处理」的入口都在这里，
  // 不论它落在哪张表上。这一组的叶子几乎都带角标，是每天第一个要看的地方。
  group('inbox', '待处理', 'inbox', [
    leaf('my-tasks', '我的待办', '/admin/collections/tasks', ['todos'], {
      collectionSlug: 'tasks',
      requiredOperationCode: 'task:read',
      badgeKey: 'tasks',
    }),
    leaf('listing-reviews', '审核队列', '/admin/collections/listing-reviews', ['listing-reviews'], {
      badgeKey: 'listingReviews',
    }),
    leaf('listing-reports', '举报处理', '/admin/collections/listing-reports', ['reports'], {
      badgeKey: 'listingReports',
    }),
    // OPT-049：前台访客提交的信息纠错，追加式审计轨迹。
    // badgeKey 是本次新增（对应查询由 Task 3 补）——它和审核队列一样是待办流量，
    // 之前没有角标纯属遗漏。
    leaf('information-corrections', '信息纠错', '/admin/collections/information-corrections', ['reports'], {
      collectionSlug: 'information-corrections',
      badgeKey: 'informationCorrections',
    }),
    // badgeKey 同上为本次新增。
    leaf('supply-submissions', '房源投放申请', '/admin/collections/supply-submissions', [
      'supply-submissions',
    ], {
      collectionSlug: 'supply-submissions',
      requiredOperationCode: 'supply_submission:read',
      badgeKey: 'supplySubmissions',
    }),
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
    leaf('form-submissions', '提交数据', '/admin/collections/form-submissions', ['form-submissions'], {
      badgeKey: 'formSubmissions',
    }),
  ]),
  group('supply', '房源与楼盘', 'building', [
    leaf('listings', '房源列表', '/admin/collections/listings', ['listings']),
    leaf('buildings', '楼盘库', '/admin/collections/buildings', ['buildings']),
    leaf('merchants', '商户管理', '/admin/collections/merchants', ['merchants']),
    // OPT-045 D4：楼盘商户关系此前不在导航里，**任何角色包括 ADM 都看不到**，
    // 只能直敲 URL。而它是有效供给 §8 的关键配置——楼盘没有生效商户关系，
    // 其下房源就进不了前台。紧跟「商户管理」，因为它俩要连着配。
    leaf(
      'building-merchant-relations',
      '楼盘商户关系',
      '/admin/collections/building-merchant-relations',
      ['merchants'],
      { collectionSlug: 'building-merchant-relations' },
    ),
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
    // 与其它分组风格明显不一致的「集合」区块——那不是样式没写好，
    // 是它根本不走自定义导航那套。收编进正常分组，兜底区块自然消失。
    leaf('supply-import-batches', '导入批次', '/admin/collections/supply-import-batches', ['listings'], {
      collectionSlug: 'supply-import-batches',
      requiredOperationCode: 'data:import',
    }),
  ]),
  group('crm', '客户与线索', 'user', [
    leaf('leads', '咨询线索', '/admin/collections/leads', ['leads', 'my-leads'], {
      badgeKey: 'leads',
    }),
    leaf('customers', '客户档案', '/admin/collections/customers', ['customers', 'my-customers']),
    leaf('follow-ups', '跟进记录', '/admin/collections/follow-ups', ['follow-ups']),
  ]),
  group('content', '站点与内容', 'file', [
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
    // 表单的「定义」属于站点内容，表单的「提交」属于待处理——两者按使用场景分开，
    // 不再共用一个「表单中心」组。
    leaf('forms', '表单管理', '/admin/collections/forms', ['forms']),
  ]),
  group('geography', '城市与区域', 'location', [
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
    // 归这里：它存的就是城市/行政区/商圈/地铁的别名，导入时按它做名称解析。
    leaf('location-aliases', '地理别名', '/admin/collections/location-aliases', ['locations'], {
      collectionSlug: 'location-aliases',
      requiredOperationCode: 'location:manage',
    }),
  ]),
  // 「人」的入口集中在这一组：账号、角色、团队、经纪人，以及顾问服务时间
  // （它配的是顾问的可服务时段，属于人员配置而非站点设置）。
  group('org', '团队与账号', 'team', [
    leaf('users', '用户管理', '/admin/collections/users', ['users']),
    leaf('roles', '角色管理', '/admin/collections/roles', ['roles']),
    leaf('teams', '团队管理', '/admin/collections/teams', ['teams']),
    leaf('brokers', '经纪人管理', '/admin/collections/brokers', ['brokers']),
    leaf('advisor-service-hours', '顾问服务时间', '/admin/globals/advisor-service-hours', [
      'teams',
      'brokers',
    ]),
  ]),
  // 低频的配置与排障入口。ADM 之外的角色通常只剩一片（如 OPS 只有配套字典），
  // 那时解析器会把整组扁平成一个顶级叶子，见 resolve-navigation.ts。
  //
  // 「领域事件」不在这里：OPT-084 裁定 2 让它退出导航（collection 仍是
  // group:false，`/admin/collections/domain-events` 可直达，菜单码与 events:read 不动）。
  group('system', '设置与工具', 'settings', [
    leaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
    leaf('audit-logs', '审计日志', '/admin/collections/audit-logs', ['audit-logs'], {
      requiredOperationCode: 'audit:view',
    }),
    leaf('search', '搜索索引', '/admin/collections/search', ['search']),
  ]),
] as const satisfies readonly AdminNavGroup[]
