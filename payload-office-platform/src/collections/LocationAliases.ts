import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { normalizeAliasText } from '@/domain/supply-import/normalize'

/** 别名只覆盖导入表里会出现的四类；metro_line 运营不会手填，不开放。 */
export const LOCATION_ALIAS_KINDS = ['city', 'district', 'business_area', 'metro_station'] as const

export const LocationAliases: CollectionConfig = {
  slug: 'location-aliases',
  labels: { singular: '地理别名', plural: '地理别名' },
  admin: {
    // OPT-049：`group: false` 让本集合退出 Payload **原生**导航
    // （3.86 的 groupNavItems 对 group===false 直接跳过）。
    //
    // 不设它的后果就是后台左下角那个「挤成一团、与上面九个分组风格不一致」的区块
    // ——那不是样式没写好，是本集合落进了 Payload 的默认分组，其 i18n 标签
    // 恰好就叫「集合」。入口由 navigation-config.ts 的自定义导航提供（OPT-045 D4），
    // 原生那份是纯粹的重复。
    group: false,
    useAsTitle: 'alias',
    defaultColumns: ['alias', 'kind', 'location'],
  },
  access: createCollectionAccess({
    read: 'data:import',
    create: 'location:manage',
    update: 'location:manage',
    delete: 'location:manage',
  }),
  hooks: {
    // 规范化在入库前完成：查询侧只用规范化值做等值匹配，不做运行时转换
    beforeValidate: [
      ({ data }) => {
        if (data && typeof data.alias === 'string') {
          data.normalizedAlias = normalizeAliasText(data.alias)
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'alias', label: '别名（原样）', type: 'text', required: true },
    {
      name: 'normalizedAlias',
      label: '规范化别名',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true, description: '由 alias 自动派生，导入匹配用的就是它' },
    },
    {
      name: 'kind',
      label: '类型',
      type: 'select',
      required: true,
      options: [
        { label: '城市', value: 'city' },
        { label: '行政区', value: 'district' },
        { label: '商圈', value: 'business_area' },
        { label: '地铁站', value: 'metro_station' },
      ],
    },
    { name: 'location', label: '指向区域', type: 'relationship', relationTo: 'locations', required: true },
  ],
  indexes: [{ fields: ['normalizedAlias', 'kind'], unique: true }],
}
