import type { CollectionConfig } from 'payload'

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: {
    singular: '页面',
    plural: '页面内容',
  },
  admin: {
    group: false,
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'status'],
    preview: (doc) => (doc?.slug === 'home' ? '/' : null),
  },
  trash: true,
  access: {
    read: () => true,
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '页面设置',
          description: '维护页面标题、地址和发布状态。',
          fields: [
            { name: 'title', label: '页面标题', type: 'text', required: true },
            {
              type: 'row',
              fields: [
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
              ],
            },
          ],
        },
        {
          label: '首屏内容',
          description: '控制页面顶部的标题、摘要和背景图。',
          fields: [
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
          ],
        },
        {
          label: '正文',
          fields: [{ name: 'content', label: '正文', type: 'richText' }],
        },
        {
          label: 'SEO',
          description: '设置搜索结果中使用的标题和描述。',
          fields: [
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
        },
      ],
    },
  ],
}
