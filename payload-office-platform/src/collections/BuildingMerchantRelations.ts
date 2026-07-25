import type { CollectionConfig } from 'payload'
import { protectBuildingMerchantRelation } from '@/domain/supply/building-merchant-relation-protect'

/**
 * 楼盘-商户有效期关系（tasks.md M3.3 / design §3.3 供给关系 / R2, R3）
 *
 * 一条记录 = 某楼盘在某有效期内由某商户供给。[start, end) 语义,
 * effectiveTo 为空表示无限期。写入前 protect hook 校验:
 *   商户存在且准入(启用+资质有效+服务城市覆盖楼盘城市)、区间合法、
 *   同楼盘区间不重叠、版本乐观锁。
 *
 * 生产 PostgreSQL 另有 EXCLUDE USING gist 区间排斥约束(单独手写迁移)兜底并发;
 * SQLite 无此约束,仅靠 protect hook 的事务内等价校验。
 */
export const BuildingMerchantRelations: CollectionConfig = {
  slug: 'building-merchant-relations',
  labels: {
    singular: '楼盘商户关系',
    plural: '楼盘商户关系',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['building', 'merchant', 'effectiveFrom', 'effectiveTo'],
    // M3.3 阶段先不进导航,关系维护入口在 M3.4/M4 挂接
    hidden: true,
  },
  access: {
    read: () => true,
  },
  hooks: {
    beforeChange: [protectBuildingMerchantRelation],
  },
  fields: [
    {
      name: 'building',
      label: '楼盘',
      type: 'relationship',
      relationTo: 'buildings',
      required: true,
    },
    {
      name: 'merchant',
      label: '商户',
      type: 'relationship',
      relationTo: 'merchants',
      required: true,
      // 仅启用城市对应候选由 protect hook 的准入门禁把关,此处不做 filterOptions
    },
    {
      type: 'row',
      fields: [
        {
          name: 'effectiveFrom',
          label: '生效时间',
          type: 'date',
          required: true,
          admin: {
            description: '关系生效起始时刻（含）',
            date: { pickerAppearance: 'dayAndTime' },
          },
        },
        {
          name: 'effectiveTo',
          label: '失效时间',
          type: 'date',
          admin: {
            description: '关系失效时刻（不含）；留空表示无限期',
            date: { pickerAppearance: 'dayAndTime' },
          },
        },
      ],
    },
    {
      name: 'createdReason',
      label: '建立原因',
      type: 'textarea',
      admin: {
        description: '记录该供给关系建立的业务背景，便于审计与转派追溯',
      },
    },
    {
      name: 'version',
      label: '版本号',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '乐观锁版本，保存时自动递增',
      },
    },
  ],
}
