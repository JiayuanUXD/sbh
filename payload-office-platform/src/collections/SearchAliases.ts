import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { ALIAS_MAX_LENGTH, validateSearchAlias } from '@/domain/search/alias-rules'

/**
 * 站内搜索别名：运营维护的口语 / 简称写法（OPT-126 后续）。
 *
 * 一行 = 一个别名：「规范名称」是词表里某个实体（楼盘 / 商圈 / 地铁 / 行政区）的名称，
 * 「别名」是用户可能输入的其它写法。词表加载时与代码里的别名（`aliases.ts`）合并，
 * 之后别名同时影响 拼音 / 首字母扩展、长句分词、错字纠错、联想（见 `buildSearchVocabulary`）。
 *
 * 生效时间：词表按城市缓存 5 分钟（`getCachedSearchVocabulary` 的 `revalidate: 300`），
 * 运营新增 / 修改后最多 5 分钟生效，不需要发版。
 *
 * 规范名称对不上任何实体时无副作用（被忽略），不在这里做存在性校验：词表按城市构建，
 * 同一个名称在不同城市可以是不同实体，集合本身不分城市。
 *
 * 权限：`search_alias:manage`（ADM 通配 + OPS）。聚合信息无个人数据，数据范围全局。
 */
export const SearchAliases: CollectionConfig = {
  slug: 'search-aliases',
  labels: { singular: '搜索别名', plural: '搜索别名' },
  admin: {
    group: false,
    useAsTitle: 'alias',
    defaultColumns: ['alias', 'canonicalName', 'note', 'updatedAt'],
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    description:
      '让用户的口语 / 简称写法也能搜到对应的楼盘、商圈、地铁或行政区。「规范名称」要与前台显示的名称完全一致；保存后最多 5 分钟生效，不需要发版。可对照「未命中搜索词」里次数高的词来补。',
  },
  defaultSort: 'canonicalName',
  access: createCollectionAccess({
    read: 'search_alias:manage',
    create: 'search_alias:manage',
    update: 'search_alias:manage',
    delete: 'search_alias:manage',
  }),
  // 同一规范名下别名不重复。比较键的大小写 / 空白差异在词表合并时再去重。
  indexes: [{ fields: ['canonicalName', 'alias'], unique: true }],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data
        return {
          ...data,
          ...(typeof data.canonicalName === 'string' ? { canonicalName: data.canonicalName.trim() } : {}),
          ...(typeof data.alias === 'string' ? { alias: data.alias.trim() } : {}),
        }
      },
    ],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'canonicalName',
          label: '规范名称',
          type: 'text',
          required: true,
          maxLength: 80,
          index: true,
          admin: {
            description: '与前台显示的楼盘 / 商圈 / 地铁站 / 行政区名称完全一致，如「上海国金中心」。',
          },
        },
        {
          name: 'alias',
          label: '别名',
          type: 'text',
          required: true,
          maxLength: ALIAS_MAX_LENGTH,
          admin: { description: '用户可能输入的其它写法，如「国金」「IFC」。至少 2 个字。' },
          validate: (value: string | null | undefined, { siblingData }: { siblingData: Record<string, unknown> }) => {
            const canonicalName = typeof siblingData?.canonicalName === 'string' ? siblingData.canonicalName : ''
            return validateSearchAlias(canonicalName, typeof value === 'string' ? value : '')
          },
        },
      ],
    },
    { name: 'note', label: '备注', type: 'text', maxLength: 200, admin: { description: '为什么加这条（可选），如「未命中词里出现 38 次」。' } },
  ],
}
