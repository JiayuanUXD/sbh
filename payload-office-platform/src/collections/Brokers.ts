import type { CollectionConfig } from 'payload'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
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
    useAsTitle: 'displayName',
    defaultColumns: ['displayName', 'user', 'team', 'employmentStatus'],
  },
  access: {
    read: () => true,
  },
  hooks: {
    // 先跑业务校验（user 唯一/城市/商圈/团队/版本），再跑停用守卫（未完成线索）
    beforeChange: [protectBroker, protectBrokerStop],
  },
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
    {
      name: 'team',
      label: '所属团队',
      type: 'relationship',
      relationTo: 'teams',
    },
    {
      name: 'serviceCities',
      label: '服务城市',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      filterOptions: () => activeLocationFilter(['city']),
    },
    {
      name: 'serviceBusinessAreas',
      label: '服务商圈',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      filterOptions: () => activeLocationFilter(['business_area']),
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
    {
      name: 'version',
      label: '版本号',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '乐观锁版本，保存时自动递增',
      },
    },
  ],
}
