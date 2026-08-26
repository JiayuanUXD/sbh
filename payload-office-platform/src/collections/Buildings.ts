import type { CollectionBeforeChangeHook, CollectionConfig, Field } from 'payload'
import { createCollectionAccess } from '@/domain/auth/access'
import { DETAIL_MEDIA_KINDS, DETAIL_MEDIA_KIND_LABELS } from '@/domain/review/listing-fields'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getBuildingMaskRules } from '@/domain/auth/field-mask'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import {
  invalidateBuildingPublicCacheAfterChange,
  invalidateBuildingPublicCacheAfterDelete,
} from '@/domain/public-catalog/supply-cache-hook'
import {
  BUILDING_GALLERY_MAX,
  BUILDING_OPERATIONAL_STATUSES,
  BUILDING_OPERATIONAL_STATUS_LABELS,
  BUILDING_TYPES,
  BUILDING_TYPE_LABELS,
  REGISTRATION_CAPABILITIES,
  REGISTRATION_CAPABILITY_LABELS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_LABELS,
} from '@/domain/supply/building'
import { guardBuildingDelete } from '@/domain/supply/building-delete-cleanup'
import { protectBuilding } from '@/domain/supply/building-protect'
import { createBuildingDedupCheckEndpoint } from '@/endpoints/building-dedup-check-endpoint'
import { createBuildingMergeEndpoint } from '@/endpoints/building-merge-endpoint'
import { createBuildingDeactivationImpactEndpoint } from '@/endpoints/building-deactivation-impact-endpoint'
import { createBuildingOperationalToggleEndpoint } from '@/endpoints/building-operational-toggle-endpoint'
import { createDataSourceGroup } from '@/domain/supply-import/data-source-field'

const BUILDING_MEDIA_CATEGORIES = ['exterior', 'lobby', 'common-area', 'facilities'] as const

/** 楼盘媒体分类中文标签，与 BuildingMediaManager 的 categoryLabels 保持一致。 */
const BUILDING_MEDIA_CATEGORY_LABELS: Record<(typeof BUILDING_MEDIA_CATEGORIES)[number], string> = {
  exterior: '外立面/建筑外观',
  lobby: '大堂/前台',
  'common-area': '公区/电梯厅',
  facilities: '配套设施/周边',
}

type MediaItemInput = { kind?: unknown; resource?: unknown }

const toMediaId = (resource: unknown): number | string | null => {
  if (resource === null || resource === undefined) return null
  if (typeof resource === 'object') {
    const id = (resource as { id?: unknown }).id
    return typeof id === 'number' || typeof id === 'string' ? id : null
  }
  return typeof resource === 'number' || typeof resource === 'string' ? resource : null
}

const syncBuildingMedia: CollectionBeforeChangeHook = async ({ data, originalDoc }) => {
  if (Array.isArray(data?.mediaItems)) {
    // 1. 同步 gallery 数组（向后兼容）
    const imageIds = (data.mediaItems as MediaItemInput[])
      .filter((m) => m && m.kind === 'image' && m.resource)
      .map((m) => toMediaId(m.resource))
      .filter((id): id is number | string => id !== null)

    data.gallery = imageIds.map((image) => ({ image }))

    // 2. 仅在文档此前也没有封面时才自动取第一张图片。
    //    coverImage 字段是 admin.hidden，不随表单提交，data.coverImage 恒为 undefined；
    //    必须回退看 originalDoc，否则每次保存都会把运营手动选定的封面重置为第一张。
    const existingCover = data.coverImage ?? originalDoc?.coverImage
    if (!existingCover && imageIds.length > 0) {
      data.coverImage = imageIds[0]
    }
  }
  return data
}

export const Buildings: CollectionConfig = {
  slug: 'buildings',
  // 自定义端点必须挂在 collection 上（不能放顶层 config.endpoints）：
  // Payload handleEndpoints 会在路径首段命中 collection slug 时，把匹配范围切到
  // collection.config.endpoints 并剥掉 /{slug} 前缀 → 顶层同前缀端点永远匹配不到（404）。
  endpoints: [
    // M3.2 楼盘查重：GET /api/buildings/dedup-check
    createBuildingDedupCheckEndpoint(),
    // M3.2 楼盘合并：POST /api/buildings/:id/merge
    createBuildingMergeEndpoint(),
    // M3.5 楼盘停用影响预检：GET /api/buildings/:id/deactivation-impact
    createBuildingDeactivationImpactEndpoint(),
    // M3.4 楼盘启停：POST /api/buildings/:id/toggle-operational-status
    createBuildingOperationalToggleEndpoint(),
  ],
  labels: {
    singular: '楼盘',
    plural: '楼盘库',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'city', 'district', 'grade', 'status', 'operationalStatus'],
    preview: (doc) => (doc?.slug ? `/buildings/${doc.slug}` : null),
    components: {
      edit: {
        // 编辑视图控件区上方（M3.4）：启停按钮。
        // 权限门与状态翻转全在对应 endpoint 服务端强制，组件仅展示与触发。
        beforeDocumentControls: [
          '/components/admin/BuildingOperationalToggle',
          // OPT-030 P0-2：表单修改态桥，把 useFormModified 同步给根部离开守卫。
          '/components/admin/unsaved-changes/FormModifiedBridge',
        ],
      },
      // OPT-056：整页替换默认列表视图（Arco 表格 + 状态标签）。
      views: {
        list: {
          Component: '/components/admin/BuildingsListView',
        },
      },
    },
  },
  trash: true,
  access: {
    // 前台匿名可读——公开站点靠有效供给谓词在查询层收窄，不靠 access.read。
    read: () => true,
    /**
     * OPT-051：删除必须显式收口。
     *
     * 此前这里**只有 `read`**，`delete` 缺省 → Payload 默认「任何登录用户都能删」。
     * 而其余十个集合都显式收了口（`delete: () => false` 或绑权限码），
     * 供给侧最核心的这两个反倒是例外。
     *
     * 三点让它比看起来更危险：
     *   1. `trash: true` 只影响后台按钮语义，**不影响 `access.delete` 的判定**；
     *   2. 本项目 `payload.delete` 恒为硬删（`trash` 参数只是查询过滤器），
     *      任何直接调 API 的路径都是真删；
     *   3. 这个库上已经真实发生过一次房源硬删。
     *
     * `listing:delete` / `building:delete` 两个权限码**早在 permission-codes.ts
     * 里定义好了**（access.ts 的文档注释甚至拿它当示例），只是从没被任何
     * collection 消费、也没授予任何角色——一对彻底的死代码。这里把它接上。
     *
     * 当前只有 ADM（`operationPermissions: ['*']`）能通过，**无需迁移**：
     * 通配符由 `hasOperationPermission` 内部处理。将来要放给 OPS，
     * 走迁移授权 + 同步 `src/test/factory/roles.ts`（不同步会被 seed 擦掉，
     * 见 OPT-045 §9 的实测教训）。
     */
    delete: createCollectionAccess({ delete: 'building:delete' }).delete,
  },
  hooks: {
    // 楼盘保护（M3.1）：枚举双保险、city 校验、图集上限、版本乐观锁
    // syncBuildingMedia 必须排在 protectBuilding 之前：gallery 由 mediaItems 派生，
    // 只有先派生再校验，protectBuilding 的 BUILDING_GALLERY_MAX 兜底才拦得住 API 直传。
    beforeChange: [syncBuildingMedia, protectBuilding],
    // 字段脱敏（tasks.md M1.4）：缺 building:coordinate 权限 → 坐标清空
    afterRead: createFieldMaskHooks(getBuildingMaskRules()),
    // 楼盘停用 / 换城市 / 改展示字段都会改变前台可见性与楼盘详情，必须失效公开缓存。
    afterChange: [invalidateBuildingPublicCacheAfterChange],
    // OPT-050：楼盘删除守护。还有房源挂着就拦下并说清原因；没有房源则顺手清掉
    // building-merchant-relations 那些纯关系行。
    //
    // 不接这个钩子的后果不是「删不掉」，而是「删不掉且看不懂」——外键
    // SET NULL 撞上 NOT NULL，PG 中止事务，运营只看到 500，日志里也只剩
    // `current transaction is aborted`。详见该文件头注释。
    beforeDelete: [guardBuildingDelete],
    afterDelete: [invalidateBuildingPublicCacheAfterDelete],
  },
  fields: [
    {
      // 有效房源聚合卡片（M3.4 / R3）：渲染在表单顶部，占满主内容区宽度。
      type: 'ui',
      admin: {
        components: {
          Field: '/components/admin/BuildingAggregateCard',
        },
      },
    } as unknown as Field,
    {
      type: 'tabs',
      tabs: [
        {
          label: '基本信息',
          description: '维护楼盘名称、发布状态和楼宇等级。',
          fields: [
            {
              name: 'name',
              label: '楼盘名称',
              type: 'text',
              required: true,
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'slug',
                  label: 'URL 标识',
                  type: 'text',
                  required: true,
                  unique: true,
                },
                {
                  name: 'status',
                  label: '发布状态',
                  type: 'select',
                  defaultValue: 'published',
                  options: [
                    { label: '草稿', value: 'draft' },
                    { label: '已发布', value: 'published' },
                    { label: '下架', value: 'archived' },
                  ],
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  // M3.1：启停轴，独立于发布状态（design §3.4 active|disabled）。
                  // 停用只撤销前台有效性，不隐式改写关联房源状态（R3）。
                  name: 'operationalStatus',
                  label: '启停状态',
                  type: 'select',
                  defaultValue: 'active',
                  options: BUILDING_OPERATIONAL_STATUSES.map((value) => ({
                    label: BUILDING_OPERATIONAL_STATUS_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'buildingType',
                  label: '物业类型',
                  type: 'select',
                  options: BUILDING_TYPES.map((value) => ({
                    label: BUILDING_TYPE_LABELS[value],
                    value,
                  })),
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'grade',
                  label: '楼宇等级',
                  type: 'select',
                  options: [
                    { label: '甲级', value: 'grade-a' },
                    { label: '超甲级', value: 'super-grade-a' },
                    { label: '创意园区', value: 'creative-park' },
                    { label: '服务式办公', value: 'serviced-office' },
                  ],
                },
                {
                  name: 'verificationStatus',
                  label: '认证状态',
                  type: 'select',
                  defaultValue: 'unverified',
                  options: VERIFICATION_STATUSES.map((value) => ({
                    label: VERIFICATION_STATUS_LABELS[value],
                    value,
                  })),
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'registrationCapability',
                  label: '注册能力',
                  type: 'select',
                  options: REGISTRATION_CAPABILITIES.map((value) => ({
                    label: REGISTRATION_CAPABILITY_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'recommendedOrder',
                  label: '推荐排序',
                  type: 'number',
                  defaultValue: 0,
                  admin: { description: '数值越小越靠前' },
                },
              ],
            },
            {
              name: 'version',
              type: 'number',
              defaultValue: 1,
              admin: { readOnly: true },
            },
            createDataSourceGroup('楼盘'),
          ],
        },
        {
          label: '位置交通',
          description: '维护城市、行政区、商圈、地址、地铁和地图坐标。',
          fields: [
            {
              // M3.1：城市维度（design §3.4 buildings.city）。protect hook 校验
              // 存在 + type=city + 启用；仅启用城市可作为新建候选。
              name: 'city',
              label: '城市',
              type: 'relationship',
              relationTo: 'locations',
              filterOptions: () => activeLocationFilter(['city']),
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'district',
                  label: '行政区',
                  type: 'relationship',
                  relationTo: 'locations',
                  required: true,
                  // M2.2：仅启用的行政区可作为新建候选；历史已存值不受影响
                  filterOptions: () => activeLocationFilter(['district']),
                },
                {
                  name: 'businessDistrict',
                  label: '商圈',
                  type: 'relationship',
                  relationTo: 'locations',
                  filterOptions: () => activeLocationFilter(['business_area']),
                },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'address', label: '地址', type: 'text' },
                {
                  name: 'nearestMetro',
                  label: '最近地铁',
                  type: 'relationship',
                  relationTo: 'locations',
                  filterOptions: () => activeLocationFilter(['metro_station']),
                },
              ],
            },
            {
              type: 'row',
              fields: [
                { name: 'latitude', label: '纬度', type: 'number' },
                { name: 'longitude', label: '经度', type: 'number' },
              ],
            },
          ],
        },
        {
          label: '楼宇属性',
          description: '维护竣工时间、楼层、物业和停车等楼宇明细。',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'completionDate',
                  label: '竣工时间',
                  type: 'date',
                  admin: { date: { pickerAppearance: 'monthOnly' } },
                },
                {
                  name: 'totalFloors',
                  label: '总楼层',
                  type: 'number',
                  min: 0,
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'propertyCompany',
                  label: '物业公司',
                  type: 'text',
                },
                {
                  name: 'propertyFee',
                  label: '物业费',
                  type: 'number',
                  min: 0,
                  admin: { description: '元/㎡/月' },
                },
              ],
            },
            {
              name: 'parkingSpaces',
              label: '停车位数量',
              type: 'number',
              min: 0,
            },
            {
              /**
               * 在售单价（OPT-045 D1）。
               *
               * **单值，不是区间**，也不做「在售房源单价区间」的派生展示——用户裁定。
               * 楼盘表此前没有任何价格字段（只有 `totalFloors` 与
               * `verification_info_price_verified_at`），出售类楼盘无处填单价。
               *
               * **口径固定为「元/㎡」**，不带周期与单位选择：
               * 楼盘层面的在售单价是一个招商口径的参考值，不是可成交的结构化价格。
               * 真正参与前台价格展示、排序、筛选的是**房源**的
               * `price.{amount,currency,period,unit}` 四件套（出售走
               * `period='one-time'` + `unit='sqm'|'suite'`）。这里刻意不做成四件套，
               * 免得两处价格来源打架——楼盘页的价格聚合一直来自其下房源，
               * 本字段不进任何聚合。
               */
              name: 'saleUnitPrice',
              label: '在售单价（元/㎡）',
              type: 'number',
              min: 0,
              admin: {
                description:
                  '招商参考口径的在售单价，单值。前台价格展示与筛选一律来自房源的结构化价格，本字段不参与聚合。',
              },
            },
            {
              name: 'developerAndScale',
              label: '开发商与规模',
              type: 'group',
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'developer', label: '开发商', type: 'text', maxLength: 100 },
                    { name: 'grossFloorArea', label: '总建筑面积（㎡）', type: 'number', min: 0 },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    { name: 'typicalFloorArea', label: '标准层面积（㎡）', type: 'number', min: 0 },
                    { name: 'standardFloorHeight', label: '标准层高（m）', type: 'number', min: 0 },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    { name: 'netCeilingHeight', label: '净层高（m）', type: 'number', min: 0 },
                    { name: 'efficiencyRate', label: '得房率（%）', type: 'number', min: 0, max: 100 },
                  ],
                },
              ],
            },
            {
              name: 'verticalTransport',
              label: '垂直交通',
              type: 'group',
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'passengerElevators', label: '客梯数量', type: 'number', min: 0 },
                    { name: 'freightElevators', label: '货梯数量', type: 'number', min: 0 },
                  ],
                },
                { name: 'zoningNote', label: '分区说明', type: 'textarea', maxLength: 300 },
              ],
            },
            {
              name: 'buildingServices',
              label: '楼宇服务',
              type: 'group',
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'airConditioning', label: '空调', type: 'text', maxLength: 100 },
                    { name: 'network', label: '网络', type: 'text', maxLength: 100 },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    { name: 'powerSupply', label: '供电', type: 'text', maxLength: 100 },
                    { name: 'accessControl', label: '门禁', type: 'text', maxLength: 100 },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    { name: 'parkingFee', label: '停车费', type: 'text', maxLength: 100 },
                    { name: 'serviceHours', label: '服务时间', type: 'text', maxLength: 100 },
                  ],
                },
              ],
            },
            {
              name: 'certifications',
              label: '楼盘认证',
              type: 'array',
              fields: [
                { name: 'name', label: '认证名称', type: 'text', required: true },
                { name: 'certificateNumber', label: '证书编号', type: 'text' },
                { name: 'validFrom', label: '有效期开始', type: 'date' },
                { name: 'validTo', label: '有效期结束', type: 'date' },
                { name: 'publicVisible', label: '公开展示', type: 'checkbox', defaultValue: false },
              ],
            },
            {
              name: 'verificationInfo',
              label: '核验信息',
              type: 'group',
              fields: [
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'verifiedAt',
                      label: '信息核验时间',
                      type: 'date',
                      defaultValue: () => new Date().toISOString(),
                    },
                    { name: 'priceVerifiedAt', label: '价格核验时间', type: 'date' },
                  ],
                },
              ],
            },
          ],
        },
        {
          label: '媒体与配套',
          description: '维护楼盘封面、空间图集和楼宇配套。',
          fields: [
            {
              name: 'coverImage',
              label: '封面图',
              type: 'upload',
              relationTo: 'media',
              admin: {
                hidden: true,
              },
            },
            {
              name: 'gallery',
              label: '空间图集',
              type: 'array',
              maxRows: BUILDING_GALLERY_MAX,
              admin: {
                hidden: true,
              },
              fields: [
                {
                  name: 'image',
                  label: '图片',
                  type: 'upload',
                  relationTo: 'media',
                },
              ],
            },
            {
              name: 'mediaItems',
              label: '楼盘媒体资源',
              type: 'array',
              maxRows: 40,
              admin: {
                components: {
                  Field: '/components/admin/BuildingMediaManager',
                },
              },
              fields: [
                { name: 'resource', label: '资源', type: 'upload', relationTo: 'media', required: true },
                {
                  name: 'kind',
                  label: '类型',
                  type: 'select',
                  required: true,
                  options: DETAIL_MEDIA_KINDS.map((value) => ({
                    label: DETAIL_MEDIA_KIND_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'category',
                  label: '分类',
                  type: 'select',
                  required: true,
                  options: BUILDING_MEDIA_CATEGORIES.map((value) => ({
                    label: BUILDING_MEDIA_CATEGORY_LABELS[value],
                    value,
                  })),
                },
                { name: 'alt', label: '替代文本', type: 'text', required: true, maxLength: 160 },
                { name: 'capturedAt', label: '拍摄时间', type: 'date' },
                { name: 'isSchematic', label: '示意图', type: 'checkbox', defaultValue: false },
              ],
            },
            {
              name: 'amenities',
              label: '楼宇配套',
              type: 'relationship',
              relationTo: 'amenities',
              hasMany: true,
              admin: {
                components: {
                  Field: '/components/admin/AmenitiesChipSelector',
                },
              },
            },
          ],
        },
        {
          label: '介绍与 SEO',
          description: '维护详情页内容和搜索引擎摘要。',
          fields: [
            { name: 'summary', label: '摘要', type: 'textarea' },
            { name: 'description', label: '详细介绍', type: 'richText' },
            {
              name: 'seo',
              label: 'SEO',
              type: 'group',
              fields: [
                { name: 'title', label: '标题', type: 'text' },
                { name: 'description', label: '描述', type: 'textarea' },
              ],
            },
          ],
        },
      ],
    },
  ],
}
