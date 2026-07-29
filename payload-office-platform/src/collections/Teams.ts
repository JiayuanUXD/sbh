import type { CollectionConfig } from 'payload'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import { TEAM_STATUS_LABELS, TEAM_STATUSES } from '@/domain/auth/org'
import { protectTeam } from '@/domain/auth/team-protect'

const STATUS_OPTIONS = TEAM_STATUSES.map((value) => ({
  label: TEAM_STATUS_LABELS[value],
  value,
}))

export const Teams: CollectionConfig = {
  slug: 'teams',
  labels: {
    singular: '团队',
    plural: '团队管理',
  },
  admin: {
    group: false,
    useAsTitle: 'name',
    defaultColumns: ['name', 'manager', 'status'],
  },
  access: {
    read: () => true,
  },
  hooks: {
    beforeChange: [protectTeam],
  },
  fields: [
    {
      name: 'name',
      label: '团队名称',
      type: 'text',
      required: true,
    },
    {
      name: 'manager',
      label: '主管',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        description: '团队主管账号；主管须具备 MGR 角色属分配/团队管理门禁（M5）',
      },
    },
    {
      name: 'cityScope',
      label: '服务城市范围',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      // 仅启用城市进候选；停用城市不进新增，历史已存值仍展示
      filterOptions: () => activeLocationFilter(['city']),
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: STATUS_OPTIONS,
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
