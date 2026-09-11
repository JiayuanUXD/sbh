import type { CollectionConfig } from 'payload'

/** 收藏（OPT-088 §4.3）。唯一性由 targetKey 承载，Payload 配置声明不了复合唯一。 */
export const MemberFavorites: CollectionConfig = {
  slug: 'member-favorites',
  labels: { singular: '会员收藏', plural: '会员收藏' },
  admin: { hidden: true },
  graphQL: false,
  trash: false,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  hooks: {
    beforeChange: [
      ({ data }) => {
        const d = data as Record<string, unknown>
        const member = typeof d.member === 'object' && d.member !== null ? (d.member as { id?: unknown }).id : d.member
        d.targetKey = `${String(member)}:${String(d.targetType)}:${String(d.targetId)}`
        return data
      },
    ],
  },
  fields: [
    { name: 'member', type: 'relationship', relationTo: 'members', required: true, index: true },
    {
      name: 'targetType',
      type: 'select',
      required: true,
      options: [
        { label: '房源', value: 'listing' },
        { label: '楼盘', value: 'building' },
      ],
    },
    { name: 'targetId', type: 'number', required: true },
    { name: 'targetSlug', type: 'text', required: true },
    { name: 'titleSnapshot', type: 'text', required: true },
    { name: 'savedAt', type: 'date', required: true },
    { name: 'targetKey', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
  ],
}
