import type { CollectionConfig } from 'payload'

export const Leads: CollectionConfig = {
  slug: 'leads',
  labels: {
    singular: '线索',
    plural: '咨询线索',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'phone', 'company', 'budget', 'status', 'createdAt'],
  },
  fields: [
    {
      name: 'name',
      label: '姓名',
      type: 'text',
      required: true,
    },
    {
      name: 'phone',
      label: '联系电话',
      type: 'text',
      required: true,
    },
    {
      name: 'company',
      label: '公司',
      type: 'text',
    },
    {
      name: 'status',
      label: '跟进状态',
      type: 'select',
      defaultValue: 'new',
      options: [
        { label: '新线索', value: 'new' },
        { label: '已联系', value: 'contacted' },
        { label: '已看房', value: 'visited' },
        { label: '已成交', value: 'won' },
        { label: '无效', value: 'lost' },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'district',
          label: '意向区域',
          type: 'relationship',
          relationTo: 'locations',
        },
        {
          name: 'budget',
          label: '预算',
          type: 'text',
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'area',
          label: '需求面积',
          type: 'text',
        },
        {
          name: 'moveInTime',
          label: '入驻时间',
          type: 'text',
        },
      ],
    },
    {
      name: 'interestedListing',
      label: '意向房源',
      type: 'relationship',
      relationTo: 'listings',
    },
    {
      name: 'notes',
      label: '跟进记录',
      type: 'textarea',
    },
  ],
}
