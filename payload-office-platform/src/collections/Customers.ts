import type { CollectionConfig } from 'payload'

/**
 * 客户档案（tasks.md M5.1 / design §3.6 customers / R6）
 *
 * 手机号用于查重但**不作为业务主键**（design §3.6）：phoneNormalized 存规范化后的号码
 * 供 30 天窗口查重（domain/crm/dedup.ts），phoneMaskedSnapshot 存脱敏快照供列表展示。
 * 一个客户可关联多条线索（leads.customer 反向），合并/新建需求由领域服务在查重时决策。
 */
export const Customers: CollectionConfig = {
  slug: 'customers',
  labels: {
    singular: '客户',
    plural: '客户档案',
  },
  admin: {
    group: false,
    useAsTitle: 'name',
    defaultColumns: ['name', 'phoneMaskedSnapshot', 'company', 'status', 'createdAt'],
    description: '客户档案：手机号用于查重但不作为业务主键，一个客户可关联多条线索。',
  },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'name', label: '姓名', type: 'text', required: true },
        { name: 'company', label: '公司', type: 'text' },
      ],
    },
    {
      name: 'phoneNormalized',
      label: '规范化手机号',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: '规范化后的手机号，用于 30 天窗口查重（不作为业务主键）。',
      },
    },
    {
      name: 'phoneMaskedSnapshot',
      label: '脱敏手机号',
      type: 'text',
      admin: {
        readOnly: true,
        description: '脱敏快照（如 138****1111），供列表展示，不含完整号码。',
      },
    },
    {
      name: 'status',
      label: '客户状态',
      type: 'select',
      defaultValue: 'active',
      options: [
        { label: '活跃', value: 'active' },
        { label: '已成交', value: 'converted' },
        { label: '流失', value: 'lost' },
      ],
    },
  ],
}
