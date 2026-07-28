import { NumberField } from '@nouance/payload-better-fields-plugin/Number'
import type { CollectionConfig } from 'payload'

import { REVIEW_STATUSES, REVIEW_STATUS_LABELS } from '@/domain/review/review-status'
import {
  PUBLICATION_STATUSES,
  PUBLICATION_STATUS_LABELS,
  SUPPLY_VISIBILITY_HOLDS,
  SUPPLY_VISIBILITY_HOLD_LABELS,
} from '@/domain/review/publication-status'
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  DECORATION_STATUSES,
  DECORATION_STATUS_LABELS,
} from '@/domain/review/listing-fields'
import { PRICING_PERIODS_UI, PRICING_UNITS_UI } from '@/domain/review/pricing-options'
import { protectListing } from '@/domain/review/listing-protect'
import { createListingPublishEndpoint } from '@/endpoints/listing-publish-endpoint'
import { createListingReviewDecisionEndpoint } from '@/endpoints/listing-review-decision-endpoint'

export const Listings: CollectionConfig = {
  slug: 'listings',
  labels: {
    singular: '房源',
    plural: '房源列表',
  },
  admin: {
    group: false,
    useAsTitle: 'title',
    defaultColumns: ['title', 'building', 'reviewStatus', 'publicationStatus', 'isFeatured'],
    preview: (doc) => (doc?.slug ? `/listings/${doc.slug}` : null),
  },
  trash: true,
  access: {
    read: () => true,
  },
  // M4.6 显式动作端点：审核轴与发布轴各走独立端点，权限/前置门/乐观锁在 handler 内守护。
  endpoints: [createListingReviewDecisionEndpoint(), createListingPublishEndpoint()],
  hooks: {
    beforeChange: [protectListing],
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
                  label: '状态（旧字段，过渡期保留）',
                  type: 'select',
                  defaultValue: 'available',
                  admin: {
                    description: '发布/审核状态已迁移至“审核与发布”页，此字段仅供过渡期兼容。',
                  },
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
            {
              type: 'row',
              fields: [
                {
                  name: 'businessType',
                  label: '租售类型',
                  type: 'select',
                  defaultValue: 'lease',
                  options: BUSINESS_TYPES.map((value) => ({
                    label: BUSINESS_TYPE_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'decorationStatus',
                  label: '装修状态',
                  type: 'select',
                  options: DECORATION_STATUSES.map((value) => ({
                    label: DECORATION_STATUS_LABELS[value],
                    value,
                  })),
                },
              ],
            },
          ],
        },
        {
          label: '租赁参数',
          description: '集中维护结构化价格、面积、工位、楼层、租期和付款条件。',
          fields: [
            {
              name: 'price',
              label: '结构化价格',
              type: 'group',
              admin: {
                description: '价格必须保存金额、币种、周期和单位,禁止仅存展示文本。',
              },
              fields: [
                {
                  type: 'row',
                  fields: [
                    ...NumberField(
                      {
                        name: 'amount',
                        label: '金额',
                        admin: { width: '50%' },
                      },
                      {
                        thousandSeparator: ',',
                        decimalScale: 2,
                      },
                    ),
                    {
                      name: 'currency',
                      label: '币种',
                      type: 'select',
                      defaultValue: 'CNY',
                      admin: { width: '50%' },
                      options: [{ label: '人民币', value: 'CNY' }],
                    },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'period',
                      label: '计价周期',
                      type: 'select',
                      defaultValue: 'month',
                      admin: { width: '50%' },
                      options: PRICING_PERIODS_UI.map(({ label, value }) => ({ label, value })),
                    },
                    {
                      name: 'unit',
                      label: '计价单位',
                      type: 'select',
                      defaultValue: 'sqm',
                      admin: { width: '50%' },
                      options: PRICING_UNITS_UI.map(({ label, value }) => ({ label, value })),
                    },
                  ],
                },
              ],
            },
            {
              type: 'row',
              fields: [
                ...NumberField(
                  {
                    name: 'rent',
                    label: '租金（旧字段,过渡期保留）',
                    admin: {
                      width: '50%',
                      description: '价格已迁移至上方结构化价格,此字段仅供过渡期兼容。',
                    },
                  },
                  {
                    thousandSeparator: ',',
                    decimalScale: 2,
                  },
                ),
                {
                  name: 'rentUnit',
                  label: '租金单位（旧字段）',
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
                  name: 'floor',
                  label: '楼层',
                  type: 'text',
                  admin: { width: '50%' },
                },
                ...NumberField(
                  {
                    name: 'minimumLeaseMonths',
                    label: '最短租期（月）',
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
                  name: 'paymentTerms',
                  label: '付款条件',
                  type: 'text',
                  admin: { width: '50%' },
                },
                {
                  name: 'availableFrom',
                  label: '可入驻日期',
                  type: 'date',
                  admin: { width: '50%' },
                },
              ],
            },
            {
              name: 'isFeatured',
              label: '首页推荐',
              type: 'checkbox',
              defaultValue: false,
            },
          ],
        },
        {
          label: '审核与发布',
          description: '三轴状态由审核/发布流程驱动,此处只读;版本号用于并发乐观锁。',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'reviewStatus',
                  label: '审核状态',
                  type: 'select',
                  defaultValue: 'not_submitted',
                  admin: {
                    width: '50%',
                    readOnly: true,
                    description: '由提交/审核流程驱动。',
                  },
                  options: REVIEW_STATUSES.map((value) => ({
                    label: REVIEW_STATUS_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'publicationStatus',
                  label: '发布状态',
                  type: 'select',
                  defaultValue: 'draft',
                  admin: {
                    width: '50%',
                    readOnly: true,
                    description: '由显式发布/下架动作驱动,审核通过不自动上架。',
                  },
                  options: PUBLICATION_STATUSES.map((value) => ({
                    label: PUBLICATION_STATUS_LABELS[value],
                    value,
                  })),
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'supplyVisibilityHold',
                  label: '供给可见性冻结',
                  type: 'select',
                  defaultValue: 'normal',
                  admin: {
                    width: '50%',
                    readOnly: true,
                    description: '商户停用等场景批量置为待复核,不改动审核/发布状态。',
                  },
                  options: SUPPLY_VISIBILITY_HOLDS.map((value) => ({
                    label: SUPPLY_VISIBILITY_HOLD_LABELS[value],
                    value,
                  })),
                },
                {
                  name: 'version',
                  label: '版本号',
                  type: 'number',
                  defaultValue: 1,
                  admin: {
                    width: '50%',
                    readOnly: true,
                    description: '乐观锁版本号,系统维护。',
                  },
                },
              ],
            },
            {
              name: 'merchant',
              label: '供给商户',
              type: 'relationship',
              relationTo: 'merchants',
              admin: {
                description: '房源供给关系的当前商户;有效期与快照规则见供给关系。',
              },
            },
            {
              name: 'contactBroker',
              label: '联系经纪人',
              type: 'relationship',
              relationTo: 'brokers',
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
              name: 'gallery',
              label: '图片相册',
              type: 'array',
              admin: {
                description: '提交审核要求至少 3 张有效图片。',
              },
              fields: [
                {
                  name: 'image',
                  label: '图片',
                  type: 'upload',
                  relationTo: 'media',
                  required: true,
                },
              ],
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
