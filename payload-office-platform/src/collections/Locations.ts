import type { CollectionConfig } from 'payload'

export const Locations: CollectionConfig = {
  slug: 'locations',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'parent', 'sortOrder'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'name',
      label: '名称',
      type: 'text',
      required: true,
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
      options: [
        { label: '城市', value: 'city' },
        { label: '行政区', value: 'district' },
        { label: '商圈', value: 'business-district' },
        { label: '地铁站', value: 'metro' },
      ],
    },
    {
      name: 'parent',
      label: '上级区域',
      type: 'relationship',
      relationTo: 'locations',
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
    },
  ],
}
