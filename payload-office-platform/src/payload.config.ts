import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { mediaGalleryPlugin } from 'payload-media-gallery'
import { searchPlugin } from '@payloadcms/plugin-search'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { importExportPlugin } from '@payloadcms/plugin-import-export'
import { zh } from '@payloadcms/translations/languages/zh'
import { auditFieldsPlugin } from '@payload-bites/audit-fields'
import { blurDataUrlsPlugin } from '@oversightstudio/blur-data-urls'
import { s3Storage } from '@payloadcms/storage-s3'
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
import { CitySiteProfiles } from './collections/CitySiteProfiles'
import { Merchants } from './collections/Merchants'
import { BuildingMerchantRelations } from './collections/BuildingMerchantRelations'
import { Teams } from './collections/Teams'
import { Brokers } from './collections/Brokers'
import { Pages } from './collections/Pages'
import { Articles } from './collections/Articles'
import { DisplayTags } from './collections/DisplayTags'
import { ListingReviews } from './collections/ListingReviews'
import { ListingReports } from './collections/ListingReports'
import { InformationCorrections } from './collections/InformationCorrections'
import { SupplySubmissions } from './collections/SupplySubmissions'
import { CityPartnerApplications } from './collections/CityPartnerApplications'
import { DomainEvents } from './collections/DomainEvents'
import { AuditLogs } from './collections/AuditLogs'
import { Tasks } from './collections/Tasks'
import { Notifications } from './collections/Notifications'
import { SupplyImportBatches } from './collections/SupplyImportBatches'
import { LocationAliases } from './collections/LocationAliases'
import { AdvisorServiceHours } from './globals/AdvisorServiceHours'
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
import { createDashboardStatsEndpoint } from './endpoints/dashboard-stats-endpoint'
import { createBulkImportEndpoints } from './endpoints/bulk-import-endpoint'
import {
  FORM_SUBMISSION_DEFAULT_COLUMNS,
  appendFormSubmissionStatusFields,
  formSubmissionUpdateAccess,
  protectFormSubmissionStatus,
} from './domain/forms/submission-status'
import { domainErrorAfterError } from './domain/shared/payload-after-error'
import { assertProductionConfig } from './lib/runtime/config-guard'
import { attachPoolErrorHandler } from './lib/runtime/pool-error-handler'
import { MEDIA_COS_PREFIX, parseCosStorageConfig } from './lib/storage/cos-config'
import {
  SUPPLY_SUBMISSION_NOTIFICATION_QUEUE,
  supplySubmissionNotificationTask,
} from './domain/supply-submission/submission-notify'
import {
  CITY_PARTNER_NOTIFICATION_QUEUE,
  cityPartnerApplicationNotificationTask,
  cityPartnerNotificationOutboxTask,
  recoverStaleCityPartnerNotificationJobs,
} from './domain/city-partner-application/application-notify'
import {
  SUPPLY_IMPORT_QUEUE,
  recoverStaleSupplyImportJobs,
  supplyImportTask,
} from './domain/supply-import/import-task'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// 本地/CI/生产统一 PostgreSQL（push: false，只走显式迁移），已移除 SQLite 回退。
// DATABASE_URL 必须是 postgres://。fail-fast 放在 onInit（连库时）而非模块加载期——因为
// generate:types / generate:importmap / build / migrate:dry-run 只加载 config、不调 getPayload，
// 这些纯静态命令无需 DATABASE_URL 即可运行；dev / start / migrate / seed 等连库命令走
// getPayload → onInit，缺省/非 postgres 时在那里抛错（见下方 onInit）。
const databaseUrl = process.env.DATABASE_URL || ''
const cosStorageConfig = parseCosStorageConfig(process.env)

// 应用启动时注册内置指标到单例 metricRegistry（幂等：已注册跳过）
// 供 GET /api/dashboard 角色化工作台与 M7.3-M7.5 看板复用
if (!metricRegistry.has('listings.total')) {
  registerBuiltinMetrics(metricRegistry)
}

export default buildConfig({
  // Dedicated CloudRun / Next container: Payload's persistent Jobs Queue is
  // safe to auto-run here (unlike request-only serverless runtimes).
  jobs: {
    access: {
      cancel: () => false,
      queue: () => false,
      // Keep the public REST/GraphQL runner closed. Payload autoRun uses its
      // trusted Local API path (which may override access); explicit internal
      // calls with access enabled are also limited to Local API requests.
      run: ({ req }) => req.payloadAPI === 'local',
    },
    tasks: [
      supplySubmissionNotificationTask,
      cityPartnerApplicationNotificationTask,
      cityPartnerNotificationOutboxTask,
      supplyImportTask,
    ],
    shouldAutoRun: async (payload) => {
      if (process.env.PAYLOAD_DISABLE_JOB_AUTORUN === '1') return false
      await recoverStaleCityPartnerNotificationJobs(payload)
      await recoverStaleSupplyImportJobs(payload)
      return true
    },
    autoRun: () => [
      {
        // 30 秒一次：投放申请是低频事件（日均个位数），而每个 CloudRun 实例都会
        // 各自轮询同一个共享生产库。5 秒一次是纯粹的常态负载浪费。
        cron: '*/30 * * * * *',
        queue: SUPPLY_SUBMISSION_NOTIFICATION_QUEUE,
        disableScheduling: true,
        limit: 10,
        silent: true,
      },
      {
        cron: '*/30 * * * * *',
        queue: CITY_PARTNER_NOTIFICATION_QUEUE,
        ...(process.env.PAYLOAD_DISABLE_JOB_AUTORUN === '1'
          ? { disableScheduling: true }
          : {}),
        limit: 10,
        silent: true,
      },
      {
        // 导入是人触发的低频操作，但用户在页面上等结果，10 秒一轮兼顾响应与负载。
        cron: '*/10 * * * * *',
        queue: SUPPLY_IMPORT_QUEUE,
        ...(process.env.PAYLOAD_DISABLE_JOB_AUTORUN === '1' ? { disableScheduling: true } : {}),
        limit: 5,
        silent: true,
      },
    ],
  },
  // OPT-015 生产 fail-closed：onInit 在 getPayload 时执行（db 连接成功后），
  // 生产缺强密钥 / 合法站点 URL 时抛错拒绝启动。
  // 统一 PG：onInit 是 DATABASE_URL 必须为 postgres 的 fail-fast 点。onInit 只在 getPayload
  // （dev/start/migrate/seed 等连库命令）触发，不影响 generate/build 等纯静态命令加载 config。
  onInit: (payload) => {
    const dbUrl = process.env.DATABASE_URL?.trim()
    if (!dbUrl || !dbUrl.startsWith('postgres')) {
      throw new Error(
        '[db] 必须提供 PostgreSQL 的 DATABASE_URL（postgres://...）；已移除 SQLite 回退',
      )
    }
    assertProductionConfig(process.env)
    attachPoolErrorHandler(payload)
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
      actions: [
        '/components/admin/ThemeToggle',
        '/components/admin/AccountMenu',
        // Task 13 全局地理搜索：Cmd/Ctrl+K 唤起（挂 action 才能常驻监听）
        '/components/admin/GeographyQuickSearch',
      ],
      beforeNavLinks: ['/components/admin/EnvBadge', '/components/admin/AdminNavigation'],
      // Arco × React 19 兼容补丁：setCreateRoot 注入 createRoot，修复
      // Message/Modal 等 portal 组件在 React 19 下静默不渲染（见组件内注释）。
      providers: [
        '/components/admin/ArcoReact19Provider',
        // OPT-030 P0-2：表单有未保存改动时拦截站内 <a> 跳转（beforeunload 管不到站内路由）。
        '/components/admin/unsaved-changes/UnsavedChangesGuardProvider',
      ],
      // 地理四模块自定义 admin 视图（Task 6）：共享同一列表组件，按 pathname 解析模块。
      // 注册键 + path 写法以安装版本 3.86 的 AdminViewConfig 为准。
      // 列表视图 exact: true，否则前缀匹配会吞掉 /geography/cities/:id（Task 7 详情页）。
      views: {
        GeographyCities: {
          Component: '/components/admin/geography/GeographyListView',
          path: '/geography/cities',
          exact: true,
        },
        GeographyDistricts: {
          Component: '/components/admin/geography/GeographyListView',
          path: '/geography/districts',
          exact: true,
        },
        GeographyBusinessAreas: {
          Component: '/components/admin/geography/GeographyListView',
          path: '/geography/business-areas',
          exact: true,
        },
        GeographyMetroLines: {
          Component: '/components/admin/geography/GeographyListView',
          path: '/geography/metro-lines',
          exact: true,
        },
        // Task 7 城市详情页：/geography/cities/:id（动态段，path-to-regexp 解析）。
        GeographyCityDetail: {
          Component: '/components/admin/geography/GeographyCityDetail',
          path: '/geography/cities/:id',
        },
        // Task 8 行政区「新建」轻量视图：/geography/districts/new（预填 type+parent，
        // 提交过 protectLocation hook）。列表视图已 exact:true，不会误吞 /new。
        GeographyDistrictCreate: {
          Component: '/components/admin/geography/GeographyCreateView',
          path: '/geography/districts/new',
        },
        // OPT-041 Task 8 批量导入两个视图：共享同一组件，按 pathname 解析模式。
        BulkImportBuildings: {
          Component: '/components/admin/bulk-import/BulkImportView',
          path: '/import/buildings',
          exact: true,
        },
        BulkImportListings: {
          Component: '/components/admin/bulk-import/BulkImportView',
          path: '/import/listings',
          exact: true,
        },
      },
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
    CitySiteProfiles,
    Merchants,
    Teams,
    Brokers,
    Amenities,
    Buildings,
    BuildingMerchantRelations,
    Listings,
    Leads,
    Customers,
    LeadOwnershipHistory,
    FollowUps,
    Pages,
    Articles,
    DisplayTags,
    ListingReviews,
    ListingReports,
    InformationCorrections,
    SupplySubmissions,
    CityPartnerApplications,
    DomainEvents,
    AuditLogs,
    Tasks,
    Notifications,
    SupplyImportBatches,
    LocationAliases,
  ],
  globals: [AdvisorServiceHours],
  // M7.2 角色化工作台 endpoint（GET /api/dashboard）
  // M7.3 经营概览 endpoint（GET /api/overview，返回卡 / 趋势 / 分布 + asOf）
  // M7.4 房源分析 endpoint（GET /api/listings/analytics，复用统一有效供给谓词）
  // M7.5 线索分析 endpoint（GET /api/leads/analytics，统一用 createdAt 作为有效创建时间）
  // 均注册在顶层 endpoints，不绑定具体 collection
  endpoints: [
    createDashboardStatsEndpoint(),
    createDashboardEndpoint(),
    createOverviewEndpoint(),
    createListingAnalyticsEndpoint(),
    createLeadAnalyticsEndpoint(),
    // M2.6 字典发布基线 endpoint（GET /api/dictionaries，只读枚举 + 可选展示标签）
    createDictionariesEndpoint(),
    // OPT-021 后台导航行动数量（按当前用户权限与数据范围安全聚合）
    createAdminNavigationEndpoint(),
    // OPT-041 批量导入（预检 / 执行 / 轮询 / 下载）
    ...createBulkImportEndpoints(),
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
  db: postgresAdapter({
    pool: {
      connectionString: databaseUrl,
      // 事故防线（2026-08-24 生产故障）：Payload Jobs 的定时轮询会**泄漏事务**——
      // 每次泄漏留下一个 `idle in transaction` 连接，PG 侧停在 wait_event=ClientRead
      // 等一条永远不会来的 COMMIT/ROLLBACK。node-postgres 的池默认 max=10，
      // 泄漏攒到 9 个时只剩 1 个可用连接，凡是要查库的请求全部排队到超时：
      // 线上 /api/health 与 /shanghai/listings 挂死 120s+，而 Next 缓存命中的
      // / 与 /shanghai/buildings 照常 200——「一半页面好、一半页面死」就是这个指纹。
      //
      // 泄漏本身在 Payload 的 job runner 内部，未修（见 specs/work-items/OPT-046）。
      // 这里加的是止损：让 PG 自己回收超时的空闲事务，池子就打不满。
      // 泄漏速率与数据库延迟正相关——本地 localhost 19 小时才漏 5 个，
      // 生产走公网 TencentDB 8 分钟漏 9 个，所以这条防线对生产尤其必要。
      //
      // 取值 120s：正常事务里两条语句之间的空闲远小于此（导入按 20 行分片，
      // 每行若干条查询，间隔都是亚秒级）；空闲超过两分钟的事务本身就是缺陷。
      // 注意这只管「事务内空闲」，正在执行的长语句（如迁移）不受影响。
      options: '-c idle_in_transaction_session_timeout=120000',
    },
    // CloudBase PG 是共享库，public schema 里除 Payload 表外还有腾讯云拨测表
    // (tencentdb_tbl_dial_test_*)。dev 模式下 Payload 默认会 pushDevSchema 扫全库，
    // 发现“多余”表会提示 DROP 并在非 TTY 下卡死。本地/CI/生产统一只走显式迁移，禁止 dev push。
    push: false,
  }),
  sharp,
  hooks: {
    // 领域错误 → HTTP 状态码与文案映射（routeError 兜底后执行）。
    // 否则 DomainError 会被 Payload 替换成 500 "Something went wrong."，
    // 前端拿不到版本冲突等业务文案（见 domain/shared/payload-after-error.ts）。
    afterError: [domainErrorAfterError],
  },
  plugins: [
    // 腾讯云 COS 使用 S3 兼容接口。生产由 config-guard 强制完整配置；开发环境只有在
    // 五项 COS_* 全部缺省时才允许本地上传。保留 Payload 文件路由与 access control，
    // 因此既有 media.url 和业务关系无需改写；专用桶内 object key 统一置于 media/ 前缀。
    s3Storage({
      enabled: cosStorageConfig.enabled,
      collections: { media: { prefix: MEDIA_COS_PREFIX } },
      bucket: cosStorageConfig.enabled ? cosStorageConfig.bucket : 'local-storage-disabled',
      config: cosStorageConfig.enabled
        ? {
            credentials: {
              accessKeyId: cosStorageConfig.accessKeyId,
              secretAccessKey: cosStorageConfig.secretAccessKey,
            },
            endpoint: cosStorageConfig.endpoint,
            forcePathStyle: false,
            region: cosStorageConfig.region,
          }
        : {},
    }),
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
          components: {
            edit: {
              beforeDocumentControls: [
                '/components/admin/FormSubmissionsLink',
              ],
            },
          },
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
    // Audit fields:已关闭（enabled: false）——sidebar 的「最后修改人」占据约 1/3 表单宽度,
    // 短期价值低;移除 enabled: false 即可恢复 createdBy / lastModifiedBy 注入与展示。
    // 注意:关闭后新保存不再写入这两字段,DB 列与存量数据保留,重新启用即续写。
    auditFieldsPlugin({
      enabled: false,
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
        // P1 Task 6 纠错:追加式审计轨迹,事实字段创建后不可改(P1 §7);
        // 创建人为匿名前台提交,createdBy/lastModifiedBy 恒空,不注入审计字段。
        'information-corrections',
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
