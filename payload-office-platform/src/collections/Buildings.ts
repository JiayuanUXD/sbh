import type { CollectionBeforeChangeHook, CollectionConfig, Field } from 'payload'
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
import { protectBuilding } from '@/domain/supply/building-protect'
import { createBuildingDedupCheckEndpoint } from '@/endpoints/building-dedup-check-endpoint'
import { createBuildingMergeEndpoint } from '@/endpoints/building-merge-endpoint'
import { createBuildingDeactivationImpactEndpoint } from '@/endpoints/building-deactivation-impact-endpoint'
import { createBuildingOperationalToggleEndpoint } from '@/endpoints/building-operational-toggle-endpoint'

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
    },
  },
  trash: true,
  access: {
    read: () => true,
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
              admin: { readOnly: true, description: '乐观锁版本号，系统维护' },
            },
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
          description: '维护竣工时间、楼层、物业和停车等楼宇明细（design §3.4）。',
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
                    { name: 'verifiedAt', label: '信息核验时间', type: 'date' },
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
