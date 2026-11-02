import type { CollectionConfig, Field } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { MISS_KINDS, type MissKind } from '@/domain/search/miss-term'

export const SEARCH_MISS_STATUSES = ['new', 'handled', 'ignored'] as const
export const SEARCH_MISS_RESOLUTIONS = ['alias-added', 'data-gap', 'out-of-scope', 'noise'] as const

const MISS_KIND_LABELS: Record<MissKind, string> = {
  zero: '零结果',
  'entity-no-supply': '楼盘存在但无在租房源',
  relaxed: '放宽后才有结果',
}

/** 事实字段：由 /api/search-misses 写入，后台只读，API 也不允许改。 */
const factField = <T extends Field>(field: T): T => ({
  ...field,
  access: { update: () => false },
  admin: { ...('admin' in field ? field.admin : {}), readOnly: true },
})

/**
 * 站内搜索「未命中词」聚合（OPT-126 P1）。
 *
 * 只存脱敏归一化后的词 × 次数 × 首末次时间：不存会话 / IP / UA / 时间序列明细。
 * 写入**不走 Payload**——`/api/search-misses` 用一条原生 `INSERT … ON CONFLICT`
 * 累加计数，避免 Local API 读改写在并发下丢计数。所以这里 `create` 对所有人关闭，
 * 后台只能看、改处置状态、删除（运营点「忽略并删除」）。
 *
 * 权限：`search_miss:manage`（ADM 通配 + OPS）。聚合词无个人信息，OPS 的数据范围是全局，
 * 不再按城市收窄。
 *
 * 保留期（§9）清理尚未接入定时任务，见 specs/work-items/OPT-126-search-miss-terms.md。
 */
export const SearchMissTerms: CollectionConfig = {
  slug: 'search-miss-terms',
  labels: { singular: '未命中搜索词', plural: '未命中搜索词' },
  admin: {
    group: false,
    useAsTitle: 'term',
    defaultColumns: ['term', 'missKind', 'count', 'status', 'resolution', 'lastSeenAt', 'city'],
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    description:
      '用户在站内搜索却没搜到的词（脱敏、归一化、仅聚合）。建议筛选「状态=新建」且「次数≥2」，按次数降序处理；处理后改状态与处置结果；确认是噪音 / 疑似个人信息的词直接删除。',
  },
  defaultSort: '-count',
  access: {
    ...createCollectionAccess({
      read: 'search_miss:manage',
      update: 'search_miss:manage',
      delete: 'search_miss:manage',
    }),
    // 写入只走原生 upsert 端点；后台与 REST 都不能手工新建。
    create: () => false,
  },
  // 唯一键 (city, term, missKind)：upsert 的冲突目标。
  indexes: [{ fields: ['city', 'term', 'missKind'], unique: true }],
  fields: [
    {
      type: 'row',
      fields: [
        factField({ name: 'city', label: '城市', type: 'text', required: true, maxLength: 64, index: true }),
        factField({ name: 'term', label: '搜索词', type: 'text', required: true, maxLength: 80 }),
        factField({
          name: 'missKind',
          label: '未命中类型',
          type: 'select',
          required: true,
          index: true,
          options: MISS_KINDS.map((value) => ({ value, label: MISS_KIND_LABELS[value] })),
        }),
      ],
    },
    {
      type: 'row',
      fields: [
        factField({ name: 'count', label: '累计次数', type: 'number', required: true, defaultValue: 1, index: true }),
        factField({ name: 'lastResultTotal', label: '最近一次结果总数', type: 'number', defaultValue: 0 }),
        factField({ name: 'firstSeenAt', label: '首次出现', type: 'date', required: true }),
        factField({ name: 'lastSeenAt', label: '最近出现', type: 'date', required: true, index: true }),
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'status',
          label: '状态',
          type: 'select',
          required: true,
          defaultValue: 'new',
          index: true,
          options: [
            { value: 'new', label: '新建' },
            { value: 'handled', label: '已处理' },
            { value: 'ignored', label: '已忽略' },
          ],
        },
        {
          name: 'resolution',
          label: '处置结果',
          type: 'select',
          options: [
            { value: 'alias-added', label: '已补别名' },
            { value: 'data-gap', label: '数据缺口' },
            { value: 'out-of-scope', label: '超出范围' },
            { value: 'noise', label: '噪音' },
          ],
        },
      ],
    },
    { name: 'note', label: '备注', type: 'text', maxLength: 200 },
  ],
}
