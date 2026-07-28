import type { AdminNavGroup, AdminNavLeaf, AdminNavSubgroup } from './navigation-types'

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
  children: readonly (AdminNavLeaf | AdminNavSubgroup)[],
): AdminNavGroup {
  return { id, label, children }
}

export const ADMIN_NAV_GROUPS = [
  group('workspace', '工作台', [
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
  group('supply', '房源运营', [
    leaf('listings', '房源列表', '/admin/collections/listings', ['listings']),
    leaf('buildings', '楼盘库', '/admin/collections/buildings', ['buildings']),
    subgroup('supply-settings', '基础配置', [
      leaf('locations', '行政区域', '/admin/collections/locations', ['locations']),
      leaf('business-areas', '商圈管理', '/admin/collections/business-area-extensions', [
        'business-areas',
      ]),
      leaf('amenities', '配套字典', '/admin/collections/amenities', ['dictionaries']),
    ]),
  ]),
  group('risk', '审核与风控', [
    leaf('listing-reviews', '审核队列', '/admin/collections/listing-reviews', ['listing-reviews'], {
      badgeKey: 'listingReviews',
    }),
    leaf('listing-reports', '举报处理', '/admin/collections/listing-reports', ['reports'], {
      badgeKey: 'listingReports',
    }),
  ]),
  group('crm', '客户运营', [
    leaf('leads', '咨询线索', '/admin/collections/leads', ['leads', 'my-leads'], {
      badgeKey: 'leads',
    }),
    leaf('customers', '客户档案', '/admin/collections/customers', ['customers', 'my-customers']),
    leaf('follow-ups', '跟进记录', '/admin/collections/follow-ups', ['follow-ups']),
  ]),
  group('partners', '商户合作', [
    leaf('merchants', '商户管理', '/admin/collections/merchants', ['merchants']),
  ]),
  group('team-management', '团队管理', [
    leaf('teams', '团队管理', '/admin/collections/teams', ['teams']),
    leaf('brokers', '经纪人管理', '/admin/collections/brokers', ['brokers']),
  ]),
  group('content', '内容管理', [
    leaf('pages', '页面内容', '/admin/collections/pages', ['pages']),
    leaf('media', '素材库', '/admin/collections/media', ['media']),
  ]),
  group('form-center', '表单中心', [
    leaf('forms', '表单管理', '/admin/collections/forms', ['forms']),
    leaf('form-submissions', '提交数据', '/admin/collections/form-submissions', ['form-submissions'], {
      badgeKey: 'formSubmissions',
    }),
  ]),
  group('system', '系统管理', [
    leaf('users', '用户管理', '/admin/collections/users', ['users']),
    leaf('roles', '角色管理', '/admin/collections/roles', ['roles']),
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
