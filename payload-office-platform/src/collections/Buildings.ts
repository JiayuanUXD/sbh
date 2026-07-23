import type { CollectionConfig } from 'payload'

export const Buildings: CollectionConfig = {
  slug: 'buildings',
  labels: {
    singular: '楼盘',
    plural: '楼盘库',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'district', 'grade', 'status'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'name',
      label: '楼盘名称',
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
      defaultValue: 'published',
      options: [
        { label: '草稿', value: 'draft' },
        { label: '已发布', value: 'published' },
        { label: '下架', value: 'archived' },
      ],
    },
    {
      name: 'grade',
      label: '楼宇等级',
      type: 'select',
      options: [
        { label: '甲级', value: 'grade-a' },
        { label: '超甲级', value: 'super-grade-a' },
        { label: '创意园区', value: 'creative-park' },
        { label: '服务式办公', value: 'serviced-office' },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'district',
          label: '行政区',
          type: 'relationship',
          relationTo: 'locations',
          required: true,
        },
        {
          name: 'businessDistrict',
          label: '商圈',
          type: 'relationship',
          relationTo: 'locations',
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'address',
          label: '地址',
          type: 'text',
        },
        {
          name: 'nearestMetro',
          label: '最近地铁',
          type: 'relationship',
          relationTo: 'locations',
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'latitude',
          label: '纬度',
          type: 'number',
        },
        {
          name: 'longitude',
          label: '经度',
          type: 'number',
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
      name: 'gallery',
      label: '空间图集',
      type: 'array',
      fields: [
        {
          name: 'image',
          label: '图片',
          type: 'upload',
          relationTo: 'media',
        },
      ],
    },
    {
      name: 'amenities',
      label: '楼宇配套',
      type: 'relationship',
      relationTo: 'amenities',
      hasMany: true,
    },
    {
      name: 'summary',
      label: '摘要',
      type: 'textarea',
    },
    {
      name: 'description',
      label: '详细介绍',
      type: 'richText',
    },
    {
      name: 'seo',
      label: 'SEO',
      type: 'group',
      fields: [
        { name: 'title', label: '标题', type: 'text' },
        { name: 'description', label: '描述', type: 'textarea' },
      ],
    },
  ],
}
