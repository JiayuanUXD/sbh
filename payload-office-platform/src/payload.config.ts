import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mediaGalleryPlugin } from 'payload-media-gallery'
import { searchPlugin } from '@payloadcms/plugin-search'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { importExportPlugin } from '@payloadcms/plugin-import-export'
import { zh } from '@payloadcms/translations/languages/zh'
import { auditFieldsPlugin } from '@payload-bites/audit-fields'
import { blurDataUrlsPlugin } from '@oversightstudio/blur-data-urls'
import {
  TextColorFeature,
  TextSizeFeature,
  TextLetterSpacingFeature,
  TextLineHeightFeature,
} from 'payload-lexical-typography'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Roles } from './collections/Roles'
import { Media } from './collections/Media'
import { Amenities } from './collections/Amenities'
import { Buildings } from './collections/Buildings'
import { Leads } from './collections/Leads'
import { Customers } from './collections/Customers'
import { FollowUps } from './collections/FollowUps'
import { LeadOwnershipHistory } from './collections/LeadOwnershipHistory'
import { Listings } from './collections/Listings'
import { Locations } from './collections/Locations'
import { BusinessAreaExtensions } from './collections/BusinessAreaExtensions'
import { Merchants } from './collections/Merchants'
import { BuildingMerchantRelations } from './collections/BuildingMerchantRelations'
import { ListingMerchantRelations } from './collections/ListingMerchantRelations'
import { Teams } from './collections/Teams'
import { Brokers } from './collections/Brokers'
import { Pages } from './collections/Pages'
import { DisplayTags } from './collections/DisplayTags'
import { ListingReviews } from './collections/ListingReviews'
import { ListingReports } from './collections/ListingReports'
import { DomainEvents } from './collections/DomainEvents'
import { AuditLogs } from './collections/AuditLogs'
import { Tasks } from './collections/Tasks'
import { Notifications } from './collections/Notifications'
import {
  EXPORT_LIMIT,
  createExportAuditHook,
  overrideExportsCollection,
  overrideImportsCollection,
} from './domain/audit/export-controls'
import { metricRegistry } from './domain/analytics/metric-registry'
import { registerBuiltinMetrics } from './domain/analytics/metrics/builtin'
import { createDashboardEndpoint } from './endpoints/dashboard-endpoint'
import { createOverviewEndpoint } from './endpoints/overview-endpoint'
import { createListingAnalyticsEndpoint } from './endpoints/listing-analytics-endpoint'
import { createLeadAnalyticsEndpoint } from './endpoints/lead-analytics-endpoint'
import { createDictionariesEndpoint } from './endpoints/dictionaries-endpoint'
import { createAdminNavigationEndpoint } from './endpoints/admin-navigation-endpoint'
import {
  FORM_SUBMISSION_DEFAULT_COLUMNS,
  appendFormSubmissionStatusFields,
  formSubmissionUpdateAccess,
  protectFormSubmissionStatus,
} from './domain/forms/submission-status'
import { serializedSQLiteAdapter } from './lib/serialized-sqlite-adapter'
import { assertProductionConfig } from './lib/runtime/config-guard'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// 生产 / CloudBase：设了 postgres:// 连接串 → 用 PostgreSQL（TencentDB）
// 本地开发：不设 DATABASE_URL → 用 SQLite 本地文件，零外部依赖
const databaseUrl = process.env.DATABASE_URL || ''
const usePostgres = databaseUrl.startsWith('postgres')

// SQLite 本地文件路径（放在项目根目录，已在 .gitignore 忽略）
const sqliteFilePath = path.resolve(dirname, '..', 'payload.db.sqlite').replace(/\\/g, '/')
const sqliteUrl = process.env.SQLITE_URL || `file:${sqliteFilePath}`

// 应用启动时注册内置指标到单例 metricRegistry（幂等：已注册跳过）
// 供 GET /api/dashboard 角色化工作台与 M7.3-M7.5 看板复用
if (!metricRegistry.has('listings.total')) {
  registerBuiltinMetrics(metricRegistry)
}

export default buildConfig({
  // OPT-015 生产 fail-closed：onInit 在 getPayload 时执行（payload migrate / next start），
  // 生产缺 PostgreSQL / 强密钥 / 合法站点 URL 时抛错拒绝启动；dev/build 不触发。
  onInit: () => {
    assertProductionConfig(process.env)
  },
  i18n: {
    supportedLanguages: { zh },
    fallbackLanguage: 'zh',
  },
  admin: {
    user: Users.slug,
    livePreview: {
      collections: ['listings', 'buildings'],
      url: ({ data, collectionConfig }) => {
        const slug = typeof data?.slug === 'string' ? data.slug : ''

        if (!slug) return null
        if (collectionConfig?.slug === 'listings') return `/listings/${slug}`
        if (collectionConfig?.slug === 'buildings') return `/buildings/${slug}`

        return null
      },
      breakpoints: [
        { label: '手机', name: 'mobile', width: 390, height: 844 },
        { label: '平板', name: 'tablet', width: 820, height: 1180 },
        { label: '桌面', name: 'desktop', width: 1440, height: 900 },
      ],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    components: {
      actions: ['/components/admin/EnvBadge', '/components/admin/ThemeToggle'],
      beforeNavLinks: ['/components/admin/AdminNavigation'],
    },
    dashboard: {
      widgets: [
        {
          slug: 'core-stats',
          label: '运营概览',
          Component: '/components/admin/StatsWidget',
          minWidth: 'full',
          maxWidth: 'full',
        },
      ],
      defaultLayout: [
        { widgetSlug: 'core-stats', width: 'full' },
      ],
    },
  },
  collections: [
    Users,
    Roles,
    Media,
    Locations,
    BusinessAreaExtensions,
    Merchants,
    Teams,
    Brokers,
    Amenities,
    Buildings,
    BuildingMerchantRelations,
    ListingMerchantRelations,
    Listings,
    Leads,
    Customers,
    LeadOwnershipHistory,
    FollowUps,
    Pages,
    DisplayTags,
    ListingReviews,
    ListingReports,
    DomainEvents,
    AuditLogs,
    Tasks,
    Notifications,
  ],
  // M7.2 角色化工作台 endpoint（GET /api/dashboard）
  // M7.3 经营概览 endpoint（GET /api/overview，返回卡 / 趋势 / 分布 + asOf）
  // M7.4 房源分析 endpoint（GET /api/listings/analytics，复用统一有效供给谓词）
  // M7.5 线索分析 endpoint（GET /api/leads/analytics，统一用 createdAt 作为有效创建时间）
  // 均注册在顶层 endpoints，不绑定具体 collection
  endpoints: [
    createDashboardEndpoint(),
    createOverviewEndpoint(),
    createListingAnalyticsEndpoint(),
    createLeadAnalyticsEndpoint(),
    // M2.6 字典发布基线 endpoint（GET /api/dictionaries，只读枚举 + 可选展示标签）
    createDictionariesEndpoint(),
    // OPT-021 后台导航行动数量（按当前用户权限与数据范围安全聚合）
    createAdminNavigationEndpoint(),
  ],
  editor: lexicalEditor({
    features: ({ defaultFeatures }) => [
      ...defaultFeatures,
      // 富文本排版增强:文字颜色 / 字号 / 字距 / 行高
      TextColorFeature({
        colors: [
          { value: '#1a1a1a', label: '主文本' },
          { value: '#666666', label: '次文本' },
          { value: '#0b5fff', label: '链接蓝' },
          { value: '#e03131', label: '警示红' },
          { value: '#2f9e44', label: '成功绿' },
        ],
      }),
      TextSizeFeature(),
      TextLetterSpacingFeature(),
      TextLineHeightFeature(),
    ],
  }),
  secret: process.env.PAYLOAD_SECRET || 'local-dev-secret-change-me',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: usePostgres
    ? postgresAdapter({
        pool: {
          connectionString: databaseUrl,
        },
        // CloudBase PG 是共享库，public schema 里除 Payload 表外还有腾讯云拨测表
        // (tencentdb_tbl_dial_test_*)。dev 模式下 Payload 默认会 pushDevSchema 扫全库，
        // 发现“多余”表会提示 DROP 并在非 TTY 下卡死。共享库一律只走显式迁移，禁止 dev push。
        push: false,
      })
    : serializedSQLiteAdapter({
        client: {
          url: sqliteUrl,
        },
        busyTimeout: 10_000,
      }),
  sharp,
  plugins: [
    // 将 Media 后台列表页替换为响应式卡片网格视图(带 lightbox / 拖拽批量上传 / 元数据侧栏)
    mediaGalleryPlugin({
      collectionSlug: 'media',
    }),
    // Search:为指定 collection 自动生成可搜索文档,提速前台全文检索
    searchPlugin({
      collections: ['listings', 'buildings'],
      searchOverrides: {
        slug: 'search',
        admin: {
          group: false,
        },
        labels: {
          singular: '搜索记录',
          plural: '搜索索引',
        },
      },
    }),
    // Form Builder:后台可视化表单构建(leads 咨询表单可用它替代手写)
    formBuilderPlugin({
      formOverrides: {
        admin: {
          group: false,
        },
        labels: {
          singular: '表单',
          plural: '表单管理',
        },
      },
      formSubmissionOverrides: {
        labels: {
          singular: '表单提交',
          plural: '提交数据',
        },
        admin: {
          defaultColumns: [...FORM_SUBMISSION_DEFAULT_COLUMNS],
          group: false,
        },
        fields: appendFormSubmissionStatusFields,
        access: {
          update: formSubmissionUpdateAccess,
        },
        hooks: {
          beforeChange: [protectFormSubmissionStatus],
        },
      },
    }),
    // Import/Export:后台 CSV/JSON 导入导出(批量导入房源用)
    // 受控导出(M3.4 子项 4 / R3):exports 集合 create 挂 data:export 权限门、
    // 批量上限 EXPORT_LIMIT、每批 after hook 落审计日志。见 domain/audit/export-controls。
    importExportPlugin({
      collections: [
        { slug: 'listings', export: { hooks: { after: createExportAuditHook() } } },
        { slug: 'buildings', export: { hooks: { after: createExportAuditHook() } } },
        { slug: 'leads', export: { hooks: { after: createExportAuditHook() } } },
        { slug: 'locations', export: { hooks: { after: createExportAuditHook() } } },
        { slug: 'amenities', export: { hooks: { after: createExportAuditHook() } } },
      ],
      exportLimit: EXPORT_LIMIT,
      overrideExportCollection: overrideExportsCollection,
      overrideImportCollection: overrideImportsCollection,
    }),
    // Audit fields:给业务 collection 注入 createdBy / lastModifiedBy 追踪字段
    auditFieldsPlugin({
      excludedCollections: [
        'users',
        'locations',
        'amenities',
        'search',
        'forms',
        'form-submissions',
        'exports',
        'imports',
        // 追加式流水:创建后不可修改,lastModifiedBy 恒空;作者身份已由
        // broker / operatedBy 记录,无需再注入审计字段(M5 / design §3.6)。
        'follow-ups',
        'lead-ownership-history',
      ],
      createdByLabel: '创建人',
      lastModifiedByLabel: '最后修改人',
    }),
    // Blur data URLs:为 media 自动生成 blurDataUrl,前台 next/image 懒加载占位
    blurDataUrlsPlugin({
      enabled: true,
      collections: [{ slug: 'media' }],
      blurOptions: {
        blur: 18,
        width: 32,
        height: 'auto',
      },
    }),
  ],
})
