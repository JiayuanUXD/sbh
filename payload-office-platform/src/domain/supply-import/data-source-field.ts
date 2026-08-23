import type { Field } from 'payload'

// Listings.ts:191 里的 COL_4 是该文件的局部 const（值为 '25%'），没有导出。
// 本工厂自带一份同值常量，不去改 Listings 的导出面——那超出本任务范围。
const COL_4 = '25%'

/**
 * 「数据来源」字段组（Listings 与 Buildings 共用）。
 *
 * 抽成工厂而非各写一份：两处的字段结构必须逐字一致，否则
 * (dataSource.source, dataSource.externalId) 的幂等语义会在两个集合间漂移。
 * 只有 admin.description 里的主语不同。
 */
export function createDataSourceGroup(subject: '房源' | '楼盘'): Field {
  return {
    name: 'dataSource',
    label: '数据来源',
    type: 'group',
    admin: {
      hideGutter: true,
      // 仅外部来源已有数据时显示；手工新建的对象不需要维护此组字段
      condition: (data) => {
        const ds = data?.dataSource as
          | { source?: string | null; externalId?: string | null; sourceUrl?: string | null; syncedAt?: string | null }
          | null
          | undefined
        return Boolean(ds && (ds.source || ds.externalId || ds.sourceUrl || ds.syncedAt))
      },
    },
    fields: [
      {
        type: 'row',
        fields: [
          {
            name: 'source',
            label: '来源平台',
            type: 'select',
            options: [
              { label: '汇租选址', value: 'huizuxuanzhi' },
              { label: '批量导入', value: 'manual-import' },
            ],
            admin: { description: '外部抓取或批量导入来源标识', width: COL_4 },
          },
          {
            name: 'externalId',
            label: '外部 ID',
            type: 'text',
            admin: { description: `源平台或导入表里的原始${subject}编号`, width: COL_4 },
          },
          {
            name: 'syncedAt',
            label: '同步时间',
            type: 'date',
            admin: { readOnly: true, description: '最后一次同步/导入的时间', width: COL_4 },
          },
          {
            name: 'sourceUrl',
            label: '源地址',
            type: 'text',
            admin: { description: '详情页原始 URL', width: COL_4 },
          },
        ],
      },
    ],
  }
}
