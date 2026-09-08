import type { CollectionConfig } from 'payload'
import { protectBuildingMerchantRelation } from '@/domain/supply/building-merchant-relation-protect'
import {
  resolveDefaultSupplyMerchant,
  type MerchantLookupPort,
} from '@/domain/supply/default-merchant'
import { createMenuAccess } from '@/domain/auth/access'

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
/**
 * 写侧准入（2026-09-08 收口）
 *
 * 此前只写了 `read`，其余三个动作落到 Payload 3.86 的 `defaultAccess`
 * （判据仅 `Boolean(req.user)`）——任何登录账号都能增删改楼盘与商户的绑定关系。
 * 这条关系直接决定房源能不能进前台（OPT-045 §2.2），不是无关紧要的连接表。
 *
 * 与 Merchants 同口径（菜单码 `merchants`）：导航里「楼盘商户关系」这个叶子用的
 * 就是它。delete 这里**保留**——删掉一行正是「解绑某楼盘的某商户」的正常操作，
 * 外键只级联到 Payload 自己的 rels 表，不会波及别的业务对象。导入链路
 * （import-task / building-dedup-service / building-delete-cleanup）全部显式
 * `overrideAccess: true`，不受影响。
 */
const canManageBuildingMerchantRelation = createMenuAccess(['merchants'])

export const BuildingMerchantRelations: CollectionConfig = {
  slug: 'building-merchant-relations',
  labels: {
    singular: '楼盘商户关系',
    plural: '楼盘商户关系',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'id',
    defaultColumns: ['building', 'merchant', 'effectiveFrom', 'effectiveTo'],
  },
  access: {
    read: () => true,
    create: canManageBuildingMerchantRelation,
    update: canManageBuildingMerchantRelation,
    delete: canManageBuildingMerchantRelation,
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
      // 新建楼盘默认商户关系时预选「官网」，免去每次手点同一个值。
      // 只挑合格商户（启用 + 资质有效）；解析不到就不给默认值，
      // 仍由 required 与 protect hook 的准入门禁把关。
      defaultValue: async ({ req }) =>
        await resolveDefaultSupplyMerchant(
          req.payload as unknown as MerchantLookupPort,
          req,
        ),
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
      },
    },
  ],
}
