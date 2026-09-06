import type { CollectionConfig } from 'payload'
import { createLocationFieldGuard } from '@/domain/geography/location-field-guard'
import { locationTypeFilter } from '@/domain/geography/location-hierarchy'
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUSES } from '@/domain/auth/org'
import { protectBroker } from '@/domain/auth/broker-protect'
import { protectBrokerStop } from '@/domain/auth/broker-stop-guard'

const STATUS_OPTIONS = EMPLOYMENT_STATUSES.map((value) => ({
  label: EMPLOYMENT_STATUS_LABELS[value],
  value,
}))

export const Brokers: CollectionConfig = {
  slug: 'brokers',
  labels: {
    singular: '经纪人',
    plural: '经纪人管理',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'displayName',
    defaultColumns: ['displayName', 'user', 'team', 'employmentStatus'],
  },
  access: {
    read: () => true,
  },
  hooks: {
    // 先跑业务校验（user 唯一/城市/商圈/团队/版本），再跑停用守卫（未完成线索）
    beforeChange: [
      // OPT-074：服务商圈只校验类型与启用。「必须落在 serviceCities 之内」是
      // 多值对多值的关系，parentField 表达不了；组件层用 scopeCitiesField 裁剪候选。
      createLocationFieldGuard([
        { field: 'serviceCities', type: 'city', many: true, label: '服务城市' },
        { field: 'serviceBusinessAreas', type: 'business_area', many: true, label: '服务商圈' },
      ]),
      protectBroker,
      protectBrokerStop,
    ],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'displayName',
          label: '姓名',
          type: 'text',
          required: true,
          admin: {
            description: '经纪人展示名，可与账号姓名不同（对外昵称）',
          },
        },
        {
          name: 'user',
          label: '关联账号',
          type: 'relationship',
          relationTo: 'users',
          required: true,
          admin: {
            description: '一名用户至多绑定一个经纪人档案',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'team',
          label: '所属团队',
          type: 'relationship',
          relationTo: 'teams',
        },
        {
          name: 'employmentStatus',
          label: '在职状态',
          type: 'select',
          required: true,
          defaultValue: 'active',
          options: STATUS_OPTIONS,
          admin: {
            description: '停用前若仍有未完成线索将被拦截，需先完成转派',
          },
        },
      ],
    },
    {
      name: 'serviceCities',
      label: '服务城市',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      filterOptions: () => locationTypeFilter(['city']),
    },
    {
      name: 'serviceBusinessAreas',
      label: '服务商圈',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      filterOptions: () => locationTypeFilter(['business_area']),
      // OPT-074：级联多选，候选按该经纪人的服务城市裁剪。
      // 只选叶子，故 changeOnSelect 关闭（组件按 selectableTypes 自行推导）。
      admin: {
        components: {
          Field: {
            path: '/components/admin/LocationCascadeField',
            clientProps: {
              selectableTypes: ['business_area'],
              many: true,
              scopeCitiesField: 'serviceCities',
              placeholder: '选择服务商圈',
            },
          },
        },
      },
    },
    {
      name: 'version',
      label: '版本号',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
      },
    },
  ],
}
