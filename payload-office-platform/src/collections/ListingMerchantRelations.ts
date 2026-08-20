import type { CollectionConfig } from 'payload'

/**
 * 房源-商户有效期关系（OPT-034 起已停用，仅为兼容删表前的过渡态而保留）
 *
 * OPT-034 Task 1-4 已把所有读侧代码改成看 `listings.merchant`，本 collection
 * 不再有任何业务读写消费者——**唯一例外**是
 * `src/domain/supply/listing-delete-cleanup.ts` 的 `beforeDelete` hook：硬删房源前
 * 仍要 `payload.delete({ collection: 'listing-merchant-relations', ... })` 清关系行，
 * 因为 `listing_merchant_relations.listing_id` 现在还是 NOT NULL 而外键
 * `ON DELETE SET NULL`，删了这张 collection 的注册（哪怕只删 payload.config 里的
 * 一行）硬删房源就会立刻重新报 PG 23502——这正是 PR #71 刚修好的问题。
 *
 * 因此本任务只摘掉了写侧校验（原 beforeChange hook `protectListingMerchantRelation`
 * 及其 domain 模块，随同的 `merchant` 字段准入门禁/区间重叠/乐观锁校验一并失效）——
 * 反正这张表已经没人再新建/编辑关系行了。collection 本体、字段与 payload.config 里
 * 的注册**留到 Task 6**（删表时）与 hook 一起摘掉。
 *
 * admin.group:false —— 直接路由仍可访问，纯粹是为了排障，不代表功能仍在使用。
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
        description: 'OPT-034 起已停用，字段与校验 hook 均不再生效，仅保留至 Task 6 删表。',
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
            date: { pickerAppearance: 'dayAndTime' },
          },
        },
        {
          name: 'effectiveTo',
          label: '生效结束',
          type: 'date',
          admin: {
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
