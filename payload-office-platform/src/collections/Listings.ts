import { NumberField } from '@nouance/payload-better-fields-plugin/Number'
import type { CollectionConfig } from 'payload'

export const Listings: CollectionConfig = {
  slug: 'listings',
  labels: {
    singular: '房源',
    plural: '房源列表',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'building', 'rent', 'area', 'status', 'isFeatured'],
    preview: (doc) => (doc?.slug ? `/listings/${doc.slug}` : null),
  },
  trash: true,
  access: {
    read: () => true,
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '基本信息',
          description: '维护房源名称、状态、类型和所属楼盘。',
          fields: [
            {
              name: 'title',
              label: '房源标题',
              type: 'text',
              required: true,
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'slug',
                  label: 'URL 标识',
                  type: 'text',
                  required: true,
                  unique: true,
                },
                {
                  name: 'status',
                  label: '状态',
                  type: 'select',
                  defaultValue: 'available',
                  options: [
                    { label: '可租', value: 'available' },
                    { label: '预留', value: 'reserved' },
                    { label: '已租', value: 'leased' },
                    { label: '下架', value: 'archived' },
                  ],
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'listingType',
                  label: '类型',
                  type: 'select',
                  required: true,
                  defaultValue: 'traditional-office',
                  options: [
                    { label: '传统办公室', value: 'traditional-office' },
                    { label: '服务式办公室', value: 'serviced-office' },
                    { label: '共享办公', value: 'coworking' },
                    { label: '整层办公', value: 'full-floor' },
                  ],
                },
                {
                  name: 'building',
                  label: '所属楼盘',
                  type: 'relationship',
                  relationTo: 'buildings',
                  required: true,
                },
              ],
            },
          ],
        },
        {
          label: '租赁参数',
          description: '集中维护价格、面积、工位和可入驻时间。',
          fields: [
            {
              type: 'row',
              fields: [
                ...NumberField(
                  {
                    name: 'rent',
                    label: '租金',
                    required: true,
                    admin: { width: '50%' },
                  },
                  {
                    thousandSeparator: ',',
                    decimalScale: 2,
                  },
                ),
                {
                  name: 'rentUnit',
                  label: '租金单位',
                  type: 'select',
                  defaultValue: 'rmb-sqm-day',
                  admin: { width: '50%' },
                  options: [
                    { label: '元/㎡/天', value: 'rmb-sqm-day' },
                    { label: '元/月', value: 'rmb-month' },
                    { label: '元/工位/月', value: 'rmb-seat-month' },
                  ],
                },
              ],
            },
            {
              type: 'row',
              fields: [
                ...NumberField(
                  {
                    name: 'area',
                    label: '面积（㎡）',
                    admin: { width: '50%' },
                  },
                  {
                    thousandSeparator: ',',
                    decimalScale: 1,
                  },
                ),
                ...NumberField(
                  {
                    name: 'seats',
                    label: '建议工位数',
                    admin: { width: '50%' },
                  },
                  {
                    thousandSeparator: ',',
                    decimalScale: 0,
                  },
                ),
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'availableFrom',
                  label: '可入驻日期',
                  type: 'date',
                },
                {
                  name: 'isFeatured',
                  label: '首页推荐',
                  type: 'checkbox',
                  defaultValue: false,
                },
              ],
            },
          ],
        },
        {
          label: '展示内容',
          description: '维护前台卡片和详情页使用的图片、亮点与介绍。',
          fields: [
            {
              name: 'coverImage',
              label: '封面图',
              type: 'upload',
              relationTo: 'media',
            },
            {
              name: 'highlights',
              label: '亮点',
              type: 'array',
              fields: [
                {
                  name: 'text',
                  label: '亮点文案',
                  type: 'text',
                },
              ],
            },
            {
              name: 'description',
              label: '房源说明',
              type: 'richText',
            },
          ],
        },
      ],
    },
  ],
}
