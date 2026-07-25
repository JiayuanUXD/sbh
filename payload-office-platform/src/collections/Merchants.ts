import type { CollectionConfig } from 'payload'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import {
  MERCHANT_STATUS_LABELS,
  MERCHANT_STATUSES,
  MERCHANT_TYPE_LABELS,
  MERCHANT_TYPES,
  QUALIFICATION_STATUS_LABELS,
  QUALIFICATION_STATUSES,
} from '@/domain/supply/merchant'
import { protectMerchant } from '@/domain/supply/merchant-protect'
import { protectMerchantStop } from '@/domain/supply/merchant-stop-guard'

/** 从固定枚举生成 select options，保持类型与标签单一真源 */
const TYPE_OPTIONS = MERCHANT_TYPES.map((value) => ({
  label: MERCHANT_TYPE_LABELS[value],
  value,
}))
const STATUS_OPTIONS = MERCHANT_STATUSES.map((value) => ({
  label: MERCHANT_STATUS_LABELS[value],
  value,
}))
const QUALIFICATION_OPTIONS = QUALIFICATION_STATUSES.map((value) => ({
  label: QUALIFICATION_STATUS_LABELS[value],
  value,
}))

export const Merchants: CollectionConfig = {
  slug: 'merchants',
  labels: {
    singular: '商户',
    plural: '商户管理',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'status', 'qualificationStatus', 'qualificationExpiresAt'],
  },
  access: {
    read: () => true,
  },
  hooks: {
    // 先跑业务校验（类型/电话/服务城市/资质/版本），再跑停用影响保护
    beforeChange: [protectMerchant, protectMerchantStop],
  },
  fields: [
    {
      name: 'name',
      label: '商户名称',
      type: 'text',
      required: true,
    },
    {
      name: 'type',
      label: '商户类型',
      type: 'select',
      required: true,
      options: TYPE_OPTIONS,
      admin: {
        description: '业主 / 中介 / 灵活办公品牌 / 渠道，创建后可改但属固定枚举',
      },
    },
    {
      name: 'contactName',
      label: '联系人',
      type: 'text',
    },
    {
      name: 'contactPhone',
      label: '联系电话',
      type: 'text',
      admin: {
        description: '中国大陆手机号，保存时自动规范化（去空格/横线/+86）',
      },
    },
    {
      name: 'serviceCities',
      label: '服务城市',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      // 仅启用的城市节点进候选；停用城市不进新增，历史已存值仍展示
      filterOptions: () => activeLocationFilter(['city']),
    },
    {
      name: 'status',
      label: '状态',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: STATUS_OPTIONS,
      admin: {
        description: '停用前若仍有有效供给关系将被拦截，需先完成影响确认与转派',
      },
    },
    {
      name: 'qualificationStatus',
      label: '资质状态',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: QUALIFICATION_OPTIONS,
    },
    {
      name: 'qualificationExpiresAt',
      label: '资质到期时间',
      type: 'date',
      admin: {
        description: '资质状态为「已通过」时必填；到期后不再进入有效供给谓词',
        date: { pickerAppearance: 'dayAndTime' },
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
