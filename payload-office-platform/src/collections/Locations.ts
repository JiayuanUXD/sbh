import type { CollectionConfig, Field } from 'payload'
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
} from '@/domain/geography/location-hierarchy'
import { protectLocation } from '@/domain/geography/location-protect'
import { protectLocationDelete } from '@/domain/geography/location-delete-guard'
import { createLocationReferencesEndpoint } from '@/endpoints/location-references-endpoint'

/** 从固定枚举生成 select options，保持类型与标签单一真源 */
const TYPE_OPTIONS = LOCATION_TYPES.map((value) => ({
  label: LOCATION_TYPE_LABELS[value],
  value,
}))

export const Locations: CollectionConfig = {
  slug: 'locations',
  labels: {
    singular: '区域',
    plural: '行政区域',
  },
  // 自定义端点挂 collection（不能放顶层 config.endpoints，否则被 slug 路由遮蔽 → 404）。
  endpoints: [
    // M2.2 区域引用数量：GET /api/locations/:id/references
    createLocationReferencesEndpoint(),
  ],
  admin: {
    group: false,
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'immutableCode', 'parent', 'status', 'sortOrder'],
    // M2.2：以树形管理视图整页替换默认列表（PRD 03_城市区域）
    components: {
      views: {
        list: {
          Component: '/components/admin/LocationTreeView',
        },
      },
    },
  },
  access: {
    read: () => true,
  },
  hooks: {
    beforeChange: [protectLocation],
    // M2.2 被引用节点保护：有下级或业务引用时禁止物理删除（PRD L114/L125）
    beforeDelete: [protectLocationDelete],
  },
  fields: [
    {
      name: 'name',
      label: '名称',
      type: 'text',
      required: true,
    },
    {
      name: 'immutableCode',
      label: '区域代码',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: '全局唯一，创建后不可修改（大写字母/数字开头，2–64 位）',
      },
    },
    {
      name: 'slug',
      label: 'URL 标识',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'type',
      label: '类型',
      type: 'select',
      required: true,
      options: TYPE_OPTIONS,
      admin: {
        description: '固定层级：城市>行政区>商圈；城市>地铁线路>地铁站。创建后不可修改。',
      },
    },
    {
      name: 'parent',
      label: '上级区域',
      type: 'relationship',
      relationTo: 'locations',
      admin: {
        description: '类型决定合法上级；移动不可跨城市。城市无上级。',
      },
    },
    // 反范式城市字段：解锁「按城市」索引查询，避免逐级上溯解析归属城市。
    // 语义约定（后续所有查询都依赖，勿手写各处）：
    //   - 非 city 节点：city = 所属城市 id（由 protectLocation hook 在 beforeChange 写入）
    //   - city 节点自身：city 留空，不自引用（创建时自身 id 未知，自引用需 afterChange 回写，
    //     活动部件更多、失败模式更隐蔽，故不自引用）
    //   - 「某城市的全部节点（含城市自身）」必须走 cityScopeWhere() 辅助函数（location-city.ts），
    //     条件为 { or: [{ id: equals cityId }, { city: equals cityId }] }，不要各处手写。
    // 关键前提：protectLocation 已有「移动不可跨城市」硬约束 -> 节点归属城市一经创建永不改变 ->
    // city 字段不需要任何级联更新逻辑。只读：UI 不可编辑，由系统维护。
    {
      name: 'city',
      label: '所属城市',
      type: 'relationship',
      relationTo: 'locations',
      index: true,
      admin: {
        readOnly: true,
        description: '由系统按层级自动维护；城市节点本身留空（其城市即自身）。',
      },
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: '启用', value: 'active' },
        { label: '停用', value: 'disabled' },
      ],
      admin: {
        description: '停用后不出现在新业务候选，但历史引用仍展示。',
      },
    },
    {
      name: 'frontendVisible',
      label: '前台可见',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: '仅启用节点可设为可见；停用时强制不可见。',
      },
    },
    {
      name: 'centerLatitude',
      label: '中心纬度',
      type: 'number',
      admin: {
        description: '-90 ~ 90，需与经度成对填写',
      },
    },
    {
      name: 'centerLongitude',
      label: '中心经度',
      type: 'number',
      admin: {
        description: '-180 ~ 180，需与纬度成对填写',
      },
    },
    {
      name: 'description',
      label: '区域介绍',
      type: 'textarea',
    },
    {
      name: 'coverImage',
      label: '封面图',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description:
          '首页商圈卡的背景图。留空时前台回退为该商圈下首个有封面的楼盘图片。',
      },
    },
    {
      name: 'sortOrder',
      label: '排序',
      type: 'number',
      defaultValue: 100,
      validate: (val: unknown) => {
        if (val === null || val === undefined) return true
        if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
          return '排序必须为非负整数'
        }
        return true
      },
    },
    {
      name: 'version',
      label: '版本号',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '乐观锁版本，由系统维护',
      },
    },
    {
      // 商圈空间扩展面板（Task 11）：内嵌进商圈编辑页，替代「商圈管理」独立页。
      // 条件只按 type 收敛（不看 id）：新建商圈无 id 时由面板自身提示「保存后可配置空间信息」。
      name: 'businessAreaExtension',
      type: 'ui',
      admin: {
        condition: (data: { type?: unknown }) => data?.type === 'business_area',
        components: { Field: '/components/admin/BusinessAreaExtensionPanel' },
      },
    } as unknown as Field,
  ],
}
