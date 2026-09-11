import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionConfig,
} from 'payload'

import {
  invalidatePagePublicCache as revalidatePagePublicCache,
  invalidateSiteSettingsPublicCache,
} from '@/lib/frontend/public-cache-revalidation'
import { createMenuAccess } from '@/domain/auth/access'

const invalidatePagePublicCache: CollectionAfterChangeHook & CollectionAfterDeleteHook = async () => {
  revalidatePagePublicCache()
  // 主导航 / 页脚可链到内容页（target=page），链接的可见性由页面的 status 决定，
  // 而解析结果缓存在站点设置里——页面转草稿 / 删除后要让入口立刻消失，
  // 得把站点设置一起失效，否则要等它 60 秒自然过期。
  invalidateSiteSettingsPublicCache()
}

/**
 * 写侧准入（2026-09-08 收口）
 *
 * 此前只写了 `read`，其余三个动作落到 Payload 3.86 的 `defaultAccess`
 * （判据仅 `Boolean(req.user)`）——任何登录账号都能增删改前台页面内容。
 *
 * 没有 `page:*` 操作码，故取承载它的模块菜单码 `pages`（导航「内容管理 →
 * 页面内容」叶子，持有者是 ADM 与 OPS）。
 */
const canManagePage = createMenuAccess(['pages'])

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: {
    singular: '页面',
    plural: '页面内容',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'status'],
    preview: (doc) => (doc?.slug === 'home' ? '/' : null),
  },
  trash: true,
  access: {
    // 读侧维持公开：C 端页面渲染直接读它。
    read: () => true,
    create: canManagePage,
    update: canManagePage,
    // delete 保留：内容页就是要能删的，外键只级联到 Payload 自己的 rels 表；
    // afterDelete 已挂前台缓存失效。`trash: true` 只影响后台按钮语义，
    // 不参与 access.delete 判定（OPT-051 的结论，本轮在 Leads 上实测复验过）。
    delete: canManagePage,
  },
  hooks: {
    afterChange: [invalidatePagePublicCache],
    afterDelete: [invalidatePagePublicCache],
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
