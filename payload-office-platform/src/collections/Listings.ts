import type { CollectionConfig } from 'payload'

export const Listings: CollectionConfig = {
  slug: 'listings',
  labels: {
    singular: '房源',
    plural: '可租房源',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'building', 'rent', 'area', 'status', 'isFeatured'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'title',
      label: '房源标题',
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
      name: 'status',
      label: '状态',
      type: 'select',
      defaultValue: 'available',
      options: [
        { label: '可租', value: 'available' },
        { label: '预留', value: 'reserved' },
        { label: '已租', value: 'leased' },
        { label: '下架', value: 'archived' },
      ],
    },
    {
      name: 'listingType',
      label: '类型',
      type: 'select',
      required: true,
      defaultValue: 'private-office',
      options: [
        { label: '传统办公室', value: 'traditional-office' },
        { label: '服务式办公室', value: 'serviced-office' },
        { label: '共享办公', value: 'coworking' },
        { label: '整层办公', value: 'full-floor' },
      ],
    },
    {
      name: 'building',
      label: '所属楼盘',
      type: 'relationship',
      relationTo: 'buildings',
      required: true,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'rent',
          label: '租金',
          type: 'number',
          required: true,
        },
        {
          name: 'rentUnit',
          label: '租金单位',
          type: 'select',
          defaultValue: 'rmb-sqm-day',
          options: [
            { label: '元/㎡/天', value: 'rmb-sqm-day' },
            { label: '元/月', value: 'rmb-month' },
            { label: '元/工位/月', value: 'rmb-seat-month' },
          ],
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'area',
          label: '面积（㎡）',
          type: 'number',
        },
        {
          name: 'seats',
          label: '建议工位数',
          type: 'number',
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'availableFrom',
          label: '可入驻日期',
          type: 'date',
        },
        {
          name: 'isFeatured',
          label: '首页推荐',
          type: 'checkbox',
          defaultValue: false,
        },
      ],
    },
    {
      name: 'coverImage',
      label: '封面图',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'highlights',
      label: '亮点',
      type: 'array',
      fields: [
        {
          name: 'text',
          label: '亮点文案',
          type: 'text',
        },
      ],
    },
    {
      name: 'description',
      label: '房源说明',
      type: 'richText',
    },
  ],
}
