import type { CollectionConfig } from 'payload'

export const MINI_USER_ASSET_KINDS = [
  'favorite-listing',
  'favorite-building',
  'inquiry',
] as const

export const MINI_USER_ASSET_TARGET_TYPES = ['listing', 'building', 'general'] as const

/** 本集合没有公共读写面；只有校验 Mini session 后的服务端门面可 override access。 */
export function denyMiniUserAssetAccess(): false {
  return false
}

export const MiniUserAssets: CollectionConfig = {
  slug: 'mini-user-assets',
  lockDocuments: false,
  labels: { singular: '小程序用户资产', plural: '小程序用户资产' },
  admin: {
    group: false,
    hidden: true,
    useAsTitle: 'assetKey',
    description: '内部集合：以不可逆 Mini session subject 关联收藏与咨询记录。',
  },
  access: {
    read: denyMiniUserAssetAccess,
    create: denyMiniUserAssetAccess,
    update: denyMiniUserAssetAccess,
    delete: denyMiniUserAssetAccess,
  },
  versions: false,
  fields: [
    {
      name: 'assetKey',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'subject',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: '收藏房源', value: 'favorite-listing' },
        { label: '收藏楼盘', value: 'favorite-building' },
        { label: '咨询记录', value: 'inquiry' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'targetType',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: '房源', value: 'listing' },
        { label: '楼盘', value: 'building' },
        { label: '通用需求', value: 'general' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'targetSlug',
      type: 'text',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'lead',
      type: 'relationship',
      relationTo: 'leads',
      index: true,
      admin: { readOnly: true },
    },
  ],
  indexes: [
    { fields: ['subject', 'kind'] },
    { fields: ['subject', 'targetType', 'targetSlug'] },
  ],
}
