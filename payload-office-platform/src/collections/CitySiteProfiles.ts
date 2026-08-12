import type { CollectionConfig } from 'payload'

import { createCollectionAccess } from '@/domain/auth/access'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import { protectCitySiteProfile } from '@/domain/city-site-profile/profile-protect'
import { CITY_SERVICE_STATUSES } from '@/domain/city-site-profile/schema'

export const CitySiteProfiles: CollectionConfig = {
  slug: 'city-site-profiles',
  labels: {
    singular: '城市站点配置',
    plural: '城市站点配置',
  },
  admin: {
    group: false,
    useAsTitle: 'seoTitle',
    defaultColumns: ['city', 'serviceStatus', 'switcherVisible', 'sortOrder', 'updatedAt'],
  },
  access: {
    ...createCollectionAccess({
      create: 'location:manage',
      update: 'location:manage',
    }),
    read: () => true,
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectCitySiteProfile],
  },
  fields: [
    {
      name: 'city',
      label: '城市',
      type: 'relationship',
      relationTo: 'locations',
      required: true,
      unique: true,
      filterOptions: () => activeLocationFilter(['city']),
    },
    {
      name: 'serviceStatus',
      label: '服务状态',
      type: 'select',
      required: true,
      options: CITY_SERVICE_STATUSES.map((value) => ({ value, label: value === 'live' ? '已开通' : '筹备中' })),
    },
    {
      name: 'switcherVisible',
      label: '在城市切换器中显示',
      type: 'checkbox',
      required: true,
      defaultValue: true,
    },
    {
      name: 'sortOrder',
      label: '排序',
      type: 'number',
      required: true,
      defaultValue: 100,
      min: 0,
    },
    {
      name: 'seoTitle',
      label: 'SEO 标题',
      type: 'text',
      required: true,
      maxLength: 60,
    },
    {
      name: 'seoDescription',
      label: 'SEO 描述',
      type: 'textarea',
      required: true,
      minLength: 70,
      maxLength: 160,
    },
    { name: 'heroEyebrow', label: 'Hero 眉题', type: 'text' },
    { name: 'heroHeading', label: 'Hero 标题', type: 'text' },
    { name: 'heroBody', label: 'Hero 正文', type: 'textarea' },
    { name: 'heroMedia', label: 'Hero 媒体', type: 'relationship', relationTo: 'media' },
    { name: 'introHeading', label: '简介标题', type: 'text' },
    { name: 'introBody', label: '简介正文', type: 'textarea' },
    { name: 'contactHeading', label: '委托卡片标题', type: 'text' },
    { name: 'contactBody', label: '委托卡片说明', type: 'textarea' },
    {
      name: 'featuredRegions',
      label: '精选区域',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      maxRows: 12,
      filterOptions: () => activeLocationFilter(['district', 'business_area']),
    },
  ],
}
