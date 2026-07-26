import type { CollectionConfig } from 'payload'
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
    plural: '区域管理',
  },
  // 自定义端点挂 collection（不能放顶层 config.endpoints，否则被 slug 路由遮蔽 → 404）。
  endpoints: [
    // M2.2 区域引用数量：GET /api/locations/:id/references
    createLocationReferencesEndpoint(),
  ],
  admin: {
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
  ],
}
