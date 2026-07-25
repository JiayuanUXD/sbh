import type { CollectionConfig } from 'payload'
import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getBuildingMaskRules } from '@/domain/auth/field-mask'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
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
    useAsTitle: 'name',
    defaultColumns: ['name', 'city', 'district', 'grade', 'status', 'operationalStatus'],
    preview: (doc) => (doc?.slug ? `/buildings/${doc.slug}` : null),
    components: {
      edit: {
        // 编辑视图控件区上方（M3.4 / R3）：启停按钮 + 有效房源聚合卡片（含查看房源）。
        // 权限门与状态翻转全在对应 endpoint 服务端强制，组件仅展示与触发。
        beforeDocumentControls: [
          '/components/admin/BuildingOperationalToggle',
          '/components/admin/BuildingAggregateCard',
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
    beforeChange: [protectBuilding],
    // 字段脱敏（tasks.md M1.4）：缺 building:coordinate 权限 → 坐标清空
    afterRead: createFieldMaskHooks(getBuildingMaskRules()),
  },
  fields: [
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
            },
            {
              name: 'gallery',
              label: '空间图集',
              type: 'array',
              // M3.1：图集上限 20 张；array 顺序即展示顺序（后台可拖拽排序）。
              // protect hook 二次兜底上限（防 API 直传绕过 UI 限制）。
              maxRows: BUILDING_GALLERY_MAX,
              admin: { description: `最多 ${BUILDING_GALLERY_MAX} 张，可拖拽调整顺序` },
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
              name: 'amenities',
              label: '楼宇配套',
              type: 'relationship',
              relationTo: 'amenities',
              hasMany: true,
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
