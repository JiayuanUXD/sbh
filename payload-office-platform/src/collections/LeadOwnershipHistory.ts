import type { CollectionConfig } from 'payload'

import { protectOwnershipHistory } from '@/domain/crm/ownership-history-protect'
import {
  OWNERSHIP_ACTIONS,
  OWNERSHIP_ACTION_LABELS,
  OWNERSHIP_STATUSES,
  OWNERSHIP_STATUS_LABELS,
} from '@/domain/crm/ownership'

/**
 * 归属历史（tasks.md M5.4/M5.8 / design §3.6 lead_ownership_history / R6, R8）
 *
 * 追加式不可改写：分配 / 认领 / 转派 / 进入公海 / 回收各写一条记录，记录当时的
 * from/to 归属人与原因，不覆盖既往归属。一经创建即不可修改、不可物理删除，由
 * access.update/delete=false（挡后台 UI + REST）叠加 protectOwnershipHistory（挡
 * Local API）双重兜底。ownershipStatus 由动作单一推导，不信任外部传入。
 */
export const LeadOwnershipHistory: CollectionConfig = {
  slug: 'lead-ownership-history',
  labels: {
    singular: '归属记录',
    plural: '线索归属历史',
  },
  admin: {
    // group:false 让本集合退出 Payload 原生导航（3.86 的 groupNavItems 对
    // group===false 直接跳过），同时**保留直达路由**用于排障。
    // 按既有产品决定它也不进自定义导航，见 admin-navigation-config.test 的
    // 「不在主导航暴露归属历史或技术分组名」。
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'id',
    defaultColumns: ['lead', 'action', 'fromOwner', 'toOwner', 'createdAt'],
    description: '线索归属流水：分配/认领/转派/进入公海/回收。记录创建后不可修改或删除。',
  },
  access: {
    read: () => true,
    // append-only：归属历史不可修改、不可物理删除（design §3.6）
    update: () => false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectOwnershipHistory],
  },
  fields: [
    {
      name: 'lead',
      label: '线索',
      type: 'relationship',
      relationTo: 'leads',
      required: true,
    },
    {
      name: 'action',
      label: '归属动作',
      type: 'select',
      required: true,
      options: OWNERSHIP_ACTIONS.map((value) => ({
        value,
        label: OWNERSHIP_ACTION_LABELS[value],
      })),
    },
    {
      name: 'ownershipStatus',
      label: '归属状态',
      type: 'select',
      options: OWNERSHIP_STATUSES.map((value) => ({
        value,
        label: OWNERSHIP_STATUS_LABELS[value],
      })),
      admin: {
        readOnly: true,
        description: '由归属动作单一推导，不可外部指定。',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'fromOwner',
          label: '原负责人',
          type: 'relationship',
          relationTo: 'brokers',
        },
        {
          name: 'toOwner',
          label: '新负责人',
          type: 'relationship',
          relationTo: 'brokers',
        },
      ],
    },
    {
      name: 'reason',
      label: '原因',
      type: 'textarea',
      admin: {
        description: '进入公海 / 回收必填；分配 / 认领 / 转派可选。',
      },
    },
    {
      name: 'operatedBy',
      label: '操作人',
      type: 'relationship',
      relationTo: 'users',
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
