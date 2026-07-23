import type { CollectionConfig } from 'payload'

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: {
    singular: '页面',
    plural: '页面内容',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'status'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'title',
      label: '页面标题',
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
      ],
    },
    {
      name: 'hero',
      label: '头图区域',
      type: 'group',
      fields: [
        { name: 'eyebrow', label: '辅助标题', type: 'text' },
        { name: 'heading', label: '主标题', type: 'text' },
        { name: 'summary', label: '摘要', type: 'textarea' },
        { name: 'image', label: '背景图', type: 'upload', relationTo: 'media' },
      ],
    },
    {
      name: 'content',
      label: '正文',
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
