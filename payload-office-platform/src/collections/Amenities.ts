import type { CollectionConfig } from 'payload'

export const Amenities: CollectionConfig = {
  slug: 'amenities',
  labels: {
    singular: '配套',
    plural: '配套字典',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'category'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'name',
      label: '配套名称',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'category',
      label: '分类',
      type: 'select',
      options: [
        { label: '办公服务', value: 'office-service' },
        { label: '空间设施', value: 'space' },
        { label: '楼宇配套', value: 'building' },
        { label: '交通生活', value: 'lifestyle' },
      ],
    },
  ],
}
