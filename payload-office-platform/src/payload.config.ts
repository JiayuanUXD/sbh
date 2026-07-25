import { postgresAdapter } from '@payloadcms/db-postgres'
import { sqliteAdapter } from '@payloadcms/db-sqlite'
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
import { Listings } from './collections/Listings'
import { Locations } from './collections/Locations'
import { BusinessAreaExtensions } from './collections/BusinessAreaExtensions'
import { Merchants } from './collections/Merchants'
import { BuildingMerchantRelations } from './collections/BuildingMerchantRelations'
import { Teams } from './collections/Teams'
import { Brokers } from './collections/Brokers'
import { Pages } from './collections/Pages'
import { DisplayTags } from './collections/DisplayTags'
import { createRoleCopyEndpoint } from './endpoints/role-copy-endpoint'
import { createLocationReferencesEndpoint } from './endpoints/location-references-endpoint'
import { createBuildingDedupCheckEndpoint } from './endpoints/building-dedup-check-endpoint'
import { createBuildingMergeEndpoint } from './endpoints/building-merge-endpoint'
import { createBuildingDeactivationImpactEndpoint } from './endpoints/building-deactivation-impact-endpoint'
import { createBuildingOperationalToggleEndpoint } from './endpoints/building-operational-toggle-endpoint'
import {
  EXPORT_LIMIT,
  createExportAuditHook,
  overrideExportsCollection,
} from './domain/audit/export-controls'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// 生产 / CloudBase：设了 postgres:// 连接串 → 用 PostgreSQL（TencentDB）
// 本地开发：不设 DATABASE_URL → 用 SQLite 本地文件，零外部依赖
const databaseUrl = process.env.DATABASE_URL || ''
const usePostgres = databaseUrl.startsWith('postgres')

// SQLite 本地文件路径（放在项目根目录，已在 .gitignore 忽略）
const sqliteFilePath = path.resolve(dirname, '..', 'payload.db.sqlite').replace(/\\/g, '/')
const sqliteUrl = process.env.SQLITE_URL || `file:${sqliteFilePath}`

export default buildConfig({
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
        { widgetSlug: 'collections', width: 'full' },
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
    Listings,
    Leads,
    Pages,
    DisplayTags,
  ],
  endpoints: [
    // M1.5 角色复制：POST /api/roles/:id/copy
    createRoleCopyEndpoint(),
    // M2.2 区域引用数量：GET /api/locations/:id/references
    createLocationReferencesEndpoint(),
    // M3.2 楼盘查重：GET /api/buildings/dedup-check
    createBuildingDedupCheckEndpoint(),
    // M3.2 楼盘合并：POST /api/buildings/:id/merge
    createBuildingMergeEndpoint(),
    // M3.5 楼盘停用影响预检：GET /api/buildings/:id/deactivation-impact
    createBuildingDeactivationImpactEndpoint(),
    // M3.4 楼盘启停：POST /api/buildings/:id/toggle-operational-status
    createBuildingOperationalToggleEndpoint(),
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
    : sqliteAdapter({
        client: {
          url: sqliteUrl,
        },
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
        labels: {
          singular: '搜索记录',
          plural: '搜索索引',
        },
      },
    }),
    // Form Builder:后台可视化表单构建(leads 咨询表单可用它替代手写)
    formBuilderPlugin({
      formOverrides: {
        labels: {
          singular: '表单',
          plural: '表单管理',
        },
      },
      formSubmissionOverrides: {
        labels: {
          singular: '表单提交',
          plural: '表单提交记录',
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
