import type { CollectionConfig } from 'payload'

/**
 * 资讯（Articles）collection
 *
 * 用途：前台「资讯中心」分区 + `/news` 列表 + `/news/[slug]` 详情的内容来源。
 * 立场：纯展示型内容集合，前台只读 `status=published`；无评论/标签/搜索（见 redesign PRD §19）。
 * 数据：新增 collection，须由 `migrate:create` 生成迁移（迁移正文不可手改）。
 *
 * 缓存失效说明：首页 / /news / /news/[slug] 均为 force-dynamic（直接调 getHomepage /
 * listPublishedArticles / getArticleBySlug，未走 unstable_cache），文章变更即时可见，
 * 无需 revalidateTag 失效。若未来首页改用 getCachedHomepage 启用 unstable_cache，
 * 需在此补 afterChange/afterDelete hook 调 revalidateTag(homeTag('shanghai'), 'max')。
 */
export const Articles: CollectionConfig = {
  slug: 'articles',
  labels: {
    singular: '资讯',
    plural: '资讯中心',
  },
  admin: {
    group: false,
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'status', 'publishedAt'],
    listSearchableFields: ['title', 'slug'],
  },
  trash: true,
  access: {
    // 与 Pages 一致：前台读公开；published 过滤由 facade 查询承担。
    read: () => true,
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '基本信息',
          description: '维护标题、地址、分类与发布状态。',
          fields: [
            { name: 'title', label: '标题', type: 'text', required: true },
            {
              type: 'row',
              fields: [
                {
                  name: 'slug',
                  label: 'URL 标识',
                  type: 'text',
                  required: true,
                  unique: true,
                  admin: {
                    description: '用于 /news/[slug] 路由，唯一不可重复。',
                  },
                },
                {
                  name: 'status',
                  label: '状态',
                  type: 'select',
                  defaultValue: 'draft',
                  options: [
                    { label: '草稿', value: 'draft' },
                    { label: '已发布', value: 'published' },
                  ],
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'category',
                  label: '分类',
                  type: 'select',
                  options: [
                    { label: '市场动态', value: 'market' },
                    { label: '选址指南', value: 'guide' },
                    { label: '楼盘解读', value: 'building' },
                    { label: '行业资讯', value: 'industry' },
                  ],
                },
                {
                  name: 'publishedAt',
                  label: '发布日期',
                  type: 'date',
                  admin: {
                    date: {
                      pickerAppearance: 'dayAndTime',
                      displayFormat: 'yyyy-MM-dd HH:mm',
                    },
                  },
                },
                {
                  name: 'featuredOrder',
                  label: '首页排序',
                  type: 'number',
                  defaultValue: 0,
                  admin: {
                    description: '首页资讯区策展权重，越小越靠前；0 表示按发布时间倒序。',
                  },
                },
              ],
            },
          ],
        },
        {
          label: '封面与摘要',
          description: '用于首页资讯头条与列表卡片。',
          fields: [
            {
              name: 'coverImage',
              label: '封面图',
              type: 'upload',
              relationTo: 'media',
            },
            {
              name: 'excerpt',
              label: '摘要',
              type: 'textarea',
              admin: {
                description: '列表/SEO 用，建议 60–120 字。',
              },
            },
          ],
        },
        {
          label: '正文',
          fields: [{ name: 'content', label: '正文', type: 'richText' }],
        },
        {
          label: '关联',
          description: '可选：关联相关楼盘与商圈，便于详情页交叉导流。',
          fields: [
            {
              name: 'relatedBuildings',
              label: '关联楼盘',
              type: 'relationship',
              relationTo: 'buildings',
              hasMany: true,
            },
            {
              name: 'relatedDistricts',
              label: '关联商圈',
              type: 'relationship',
              relationTo: 'locations',
              hasMany: true,
            },
          ],
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
