import type { CollectionConfig } from 'payload'

import { protectListingMerchantRelation } from '@/domain/supply/listing-merchant-relation-protect'

/**
 * 房源-商户有效期关系（tasks.md M4.2 / design §3.3 供给关系 / R2, R4）
 *
 * 一条记录 = 某房源在某有效期内由某商户供给。与 building-merchant-relations 同构,
 * 但商户可在创建时“继承所属楼盘当前默认商户的快照”——故 merchant **非必填**,
 * 缺省时由 protect hook 解析并写回快照值（见 protectListingMerchantRelation）。
 *
 * 不变量、准入门禁、区间合法、同房源不重叠、版本乐观锁全部在 beforeChange hook 守护。
 * 生产 PG 另有 EXCLUDE USING gist 兜底同房源区间不重叠;SQLite 只靠 hook 校验。
 *
 * admin.group:false —— 供给关系通过房源侧维护，由自定义导航承载直接路由。
 */
export const ListingMerchantRelations: CollectionConfig = {
  slug: 'listing-merchant-relations',
  labels: {
    singular: '房源商户关系',
    plural: '房源商户关系',
  },
  admin: {
    group: false,
    useAsTitle: 'id',
    defaultColumns: ['listing', 'merchant', 'effectiveFrom', 'effectiveTo'],
  },
  access: {
    read: () => true,
  },
  hooks: {
    beforeChange: [protectListingMerchantRelation],
  },
  fields: [
    {
      name: 'listing',
      label: '房源',
      type: 'relationship',
      relationTo: 'listings',
      required: true,
    },
    {
      name: 'merchant',
      label: '供给商户',
      type: 'relationship',
      relationTo: 'merchants',
      admin: {
        description: '留空则创建时继承所属楼盘当前默认商户的快照;准入门禁由 hook 校验。',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'effectiveFrom',
          label: '生效起始',
          type: 'date',
          required: true,
          admin: {
            width: '50%',
            date: { pickerAppearance: 'dayAndTime' },
          },
        },
        {
          name: 'effectiveTo',
          label: '生效结束',
          type: 'date',
          admin: {
            width: '50%',
            date: { pickerAppearance: 'dayAndTime' },
            description: '留空表示无限期。',
          },
        },
      ],
    },
    {
      name: 'createdReason',
      label: '创建原因',
      type: 'textarea',
    },
    {
      name: 'version',
      label: '版本号',
      type: 'number',
      defaultValue: 1,
      admin: {
        readOnly: true,
        description: '乐观锁版本号,系统维护。',
      },
    },
  ],
}
