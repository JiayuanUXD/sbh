import type { CollectionConfig } from 'payload'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import { protectBusinessAreaExtension } from '@/domain/geography/business-area-extension-protect'

/**
 * 商圈扩展（tasks.md M2.3 / PRD 02-02 商圈配置）
 *
 * 只承接商圈的空间与展示扩展：边界多边形、扩展中心点、别名、同城既有站点关联。
 * 基础字段（名称/代码/层级/启停/排序/可见性）由「城市区域」页唯一维护，本表不存储、
 * 只按不可变 ID 引用 → 「禁止在扩展页修改基础字段」由结构天然保证。
 *
 * 写侧不变量统一由 protectBusinessAreaExtension 把关（自身及祖先启用、同城站点、版本锁等）。
 */
export const BusinessAreaExtensions: CollectionConfig = {
  slug: 'business-area-extensions',
  labels: {
    singular: '商圈扩展',
    plural: '商圈管理',
  },
  admin: {
    group: false,
    useAsTitle: 'businessArea',
    defaultColumns: ['businessArea', 'extendedCenterLatitude', 'extendedCenterLongitude', 'version'],
    description:
      '仅维护已启用商圈的边界、扩展中心点、别名与同城站点关联；基础字段在「城市区域」页维护。',
  },
  access: {
    read: () => true,
  },
  hooks: {
    beforeChange: [protectBusinessAreaExtension],
  },
  fields: [
    {
      name: 'businessArea',
      label: '所属商圈',
      type: 'relationship',
      relationTo: 'locations',
      required: true,
      unique: true,
      // 仅启用的商圈可配置扩展；创建后不可改（保护 hook 兜底）
      filterOptions: () => activeLocationFilter(['business_area']),
      admin: {
        description: '仅可选择已启用商圈；创建后不可更改。基础字段只读同步，不在此页编辑。',
      },
    },
    {
      name: 'boundary',
      label: '边界多边形',
      type: 'json',
      admin: {
        description: 'GeoJSON Polygon；外环须闭合、坐标合法且不自交。可留空。',
      },
    },
    {
      name: 'extendedCenterLatitude',
      label: '扩展中心纬度',
      type: 'number',
      admin: {
        description: '-90 ~ 90，需与经度成对填写；可留空。',
      },
    },
    {
      name: 'extendedCenterLongitude',
      label: '扩展中心经度',
      type: 'number',
      admin: {
        description: '-180 ~ 180，需与纬度成对填写；可留空。',
      },
    },
    {
      name: 'aliases',
      label: '别名',
      type: 'array',
      admin: {
        description: '单项 1–50 字，去首尾空格，同商圈内自动去重。',
      },
      fields: [
        {
          name: 'alias',
          label: '别名',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'metroStations',
      label: '关联站点',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      // 仅启用站点候选；同城校验在保护 hook（需解析商圈城市，属副作用）
      filterOptions: () => activeLocationFilter(['metro_station']),
      admin: {
        description: '仅可关联同城、已启用的既有地铁站；不改变站点基础属性。',
      },
    },
    {
      name: 'version',
      label: '版本号',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '乐观锁版本，由系统维护',
      },
    },
  ],
}
